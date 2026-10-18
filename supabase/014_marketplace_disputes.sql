-- Marketplace disputes between buyer and seller, reviewed by a superadmin.
-- Apply once after 013. Approving a refund freezes the seller's share of that
-- sale until the payment provider confirms the refund; this migration never
-- moves money by itself.
begin;
create table public.marketplace_disputes (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.payment_orders(id),
  template_id uuid not null references public.templates(id),
  buyer_id uuid not null references auth.users(id),
  seller_id uuid not null references auth.users(id),
  category text not null check (category in ('not_as_described','broken','access','other')),
  body text not null check (char_length(body) between 20 and 2000),
  status text not null default 'open' check (status in ('open','seller_replied','refund_approved','rejected','withdrawn')),
  seller_reply text check (seller_reply is null or char_length(seller_reply) between 10 and 2000),
  resolution_note text check (resolution_note is null or char_length(resolution_note) between 8 and 500),
  opened_at timestamptz not null default now(),
  replied_at timestamptz,
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);
create index marketplace_disputes_seller on public.marketplace_disputes(seller_id, status, opened_at desc);
create index marketplace_disputes_buyer on public.marketplace_disputes(buyer_id, opened_at desc);
create index marketplace_disputes_queue on public.marketplace_disputes(status, opened_at);
alter table public.marketplace_disputes enable row level security;
revoke all on public.marketplace_disputes from public, anon, authenticated;
grant select on public.marketplace_disputes to authenticated;
grant all on public.marketplace_disputes to service_role;
create policy marketplace_disputes_read on public.marketplace_disputes for select to authenticated
  using (
    (buyer_id = (select auth.uid()) or seller_id = (select auth.uid()))
    and public.piwu_user_active((select auth.uid()))
  );

-- A dispute can only be opened for a purchase the caller made, within 30 days,
-- and only once per order. The buyer never supplies seller/template identity.
create function public.piwu_dispute_open(
  p_user uuid,
  p_order uuid,
  p_category text,
  p_body text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  sale public.marketplace_sales%rowtype;
  template uuid;
  new_id uuid;
begin
  if p_user is null or not public.piwu_user_active(p_user) then
    raise exception 'PIWU_FORBIDDEN' using errcode = '42501';
  end if;
  if p_category is null or p_category not in ('not_as_described','broken','access','other')
    or p_body is null or char_length(btrim(p_body)) not between 20 and 2000 then
    raise exception 'PIWU_INVALID';
  end if;
  select * into sale from public.marketplace_sales
    where order_id = p_order and buyer_id = p_user for update;
  if not found then
    raise exception 'PIWU_FORBIDDEN' using errcode = '42501';
  end if;
  if sale.status <> 'accrued' then
    raise exception 'PIWU_INVALID';
  end if;
  if sale.created_at < now() - interval '30 days' then
    raise exception 'PIWU_EXPIRED';
  end if;
  if exists(select 1 from public.marketplace_disputes where order_id = p_order) then
    raise exception 'PIWU_DUPLICATE';
  end if;
  select template_id into template
    from public.payment_orders where id = p_order;
  if template is null then
    raise exception 'PIWU_INVALID';
  end if;
  insert into public.marketplace_disputes(
    order_id, template_id, buyer_id, seller_id, category, body
  ) values (
    p_order, template, p_user, sale.seller_id, p_category, btrim(p_body)
  ) returning id into new_id;
  return new_id;
end $$;

create function public.piwu_dispute_reply(
  p_user uuid,
  p_dispute uuid,
  p_body text
) returns text language plpgsql security definer set search_path = '' as $$
declare row public.marketplace_disputes%rowtype;
begin
  if p_user is null or not public.piwu_user_active(p_user) then
    raise exception 'PIWU_FORBIDDEN' using errcode = '42501';
  end if;
  if p_body is null or char_length(btrim(p_body)) not between 10 and 2000 then
    raise exception 'PIWU_INVALID';
  end if;
  select * into row from public.marketplace_disputes where id = p_dispute for update;
  if not found or row.seller_id <> p_user then
    raise exception 'PIWU_FORBIDDEN' using errcode = '42501';
  end if;
  if row.status <> 'open' then
    raise exception 'PIWU_INVALID';
  end if;
  update public.marketplace_disputes set
    seller_reply = btrim(p_body),
    status = 'seller_replied',
    replied_at = now(),
    updated_at = now()
  where id = p_dispute;
  return 'seller_replied';
end $$;

create function public.piwu_dispute_withdraw(
  p_user uuid,
  p_dispute uuid
) returns text language plpgsql security definer set search_path = '' as $$
declare row public.marketplace_disputes%rowtype;
begin
  if p_user is null or not public.piwu_user_active(p_user) then
    raise exception 'PIWU_FORBIDDEN' using errcode = '42501';
  end if;
  select * into row from public.marketplace_disputes where id = p_dispute for update;
  if not found or row.buyer_id <> p_user then
    raise exception 'PIWU_FORBIDDEN' using errcode = '42501';
  end if;
  if row.status not in ('open','seller_replied') then
    raise exception 'PIWU_INVALID';
  end if;
  update public.marketplace_disputes set
    status = 'withdrawn',
    resolved_at = now(),
    updated_at = now()
  where id = p_dispute;
  return 'withdrawn';
end $$;

create function public.piwu_dispute_review(
  p_actor uuid,
  p_request uuid,
  p_dispute uuid,
  p_status text,
  p_note text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor_role text;
  request_hash text;
  previous public.platform_audit%rowtype;
  result jsonb;
  row public.marketplace_disputes%rowtype;
begin
  select role into actor_role from public.platform_admins where user_id = p_actor;
  if actor_role is null or actor_role <> 'superadmin' or not public.piwu_user_active(p_actor) then
    raise exception 'ADMIN_FORBIDDEN' using errcode = '42501';
  end if;
  if p_request is null or p_dispute is null
    or p_status is null or p_status not in ('refund_approved','rejected')
    or p_note is null or char_length(btrim(p_note)) not between 8 and 500 then
    raise exception 'ADMIN_INVALID';
  end if;
  request_hash = md5('dispute_review' || p_dispute::text || p_status || btrim(p_note));
  select * into previous from public.platform_audit where id = p_request;
  if found then
    if previous.actor_id <> p_actor or previous.request_hash <> request_hash then
      raise exception 'ADMIN_DUPLICATE';
    end if;
    return previous.result;
  end if;
  select * into row from public.marketplace_disputes where id = p_dispute for update;
  if not found then
    raise exception 'ADMIN_NOT_FOUND';
  end if;
  if row.status not in ('open','seller_replied') then
    raise exception 'ADMIN_INVALID';
  end if;
  update public.marketplace_disputes set
    status = p_status,
    resolution_note = btrim(p_note),
    resolved_at = now(),
    resolved_by = p_actor,
    updated_at = now()
  where id = p_dispute;
  result = jsonb_build_object(
    'status', p_status,
    'order_id', row.order_id,
    'buyer_id', row.buyer_id,
    'seller_id', row.seller_id
  );
  insert into public.platform_audit(id, actor_id, action, target_id, reason, request_hash, result)
  values (p_request, p_actor, 'dispute_review', p_dispute, btrim(p_note), request_hash, result);
  return result;
end $$;

-- Same balance contract as 013, but the seller's share of a sale under an
-- open, replied or refund-approved dispute is frozen (frozen is reported too).
create or replace function public.piwu_seller_balance(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare accrued integer; pending integer; paid integer; frozen integer;
begin
  if p_user is null then
    return jsonb_build_object('accrued',0,'pending',0,'paid',0,'available',0,'frozen',0,'currency','IDR');
  end if;
  select coalesce(sum(s.net),0)::integer into frozen
    from public.marketplace_sales s
    join public.marketplace_disputes d on d.order_id = s.order_id
    where s.seller_id = p_user and s.status = 'accrued'
      and d.status in ('open','seller_replied','refund_approved');
  select coalesce(sum(s.net),0)::integer into accrued
    from public.marketplace_sales s
    where s.seller_id = p_user and s.status = 'accrued'
      and not exists(
        select 1 from public.marketplace_disputes d
        where d.order_id = s.order_id
          and d.status in ('open','seller_replied','refund_approved')
      );
  select coalesce(sum(amount),0)::integer into pending
    from public.marketplace_payouts where seller_id = p_user and status in ('requested','approved');
  select coalesce(sum(amount),0)::integer into paid
    from public.marketplace_payouts where seller_id = p_user and status = 'paid';
  return jsonb_build_object(
    'accrued', accrued,
    'pending', pending,
    'paid', paid,
    'available', greatest(0, accrued - pending - paid),
    'frozen', frozen,
    'currency', 'IDR'
  );
end $$;

-- Account deletion (011) also calls piwu_purge_seller_pii. Migration 014
-- extends it: free-text disputes belong to the deleted account and must not
-- outlive it. Payout amounts/status/reference stay as the financial record.
create or replace function public.piwu_purge_seller_pii(p_user uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare removed integer; redacted integer; disputes integer;
begin
  if p_user is null then
    return jsonb_build_object('verification',0,'payouts',0,'disputes',0);
  end if;
  delete from public.seller_verifications where user_id = p_user;
  get diagnostics removed = row_count;
  update public.marketplace_payouts
    set destination = '[dihapus]', note = null
    where seller_id = p_user and destination <> '[dihapus]';
  get diagnostics redacted = row_count;
  delete from public.marketplace_disputes
    where buyer_id = p_user or seller_id = p_user;
  get diagnostics disputes = row_count;
  return jsonb_build_object(
    'verification', removed,
    'payouts', redacted,
    'disputes', disputes
  );
end $$;

revoke all on function
  public.piwu_dispute_open(uuid,uuid,text,text),
  public.piwu_dispute_reply(uuid,uuid,text),
  public.piwu_dispute_withdraw(uuid,uuid),
  public.piwu_dispute_review(uuid,uuid,uuid,text,text),
  public.piwu_seller_balance(uuid),
  public.piwu_purge_seller_pii(uuid)
from public, anon, authenticated;
grant execute on function
  public.piwu_dispute_open(uuid,uuid,text,text),
  public.piwu_dispute_reply(uuid,uuid,text),
  public.piwu_dispute_withdraw(uuid,uuid),
  public.piwu_dispute_review(uuid,uuid,uuid,text,text),
  public.piwu_seller_balance(uuid),
  public.piwu_purge_seller_pii(uuid)
to service_role;
commit;
