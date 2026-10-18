-- PiwuApp does not refund transactions, so disputes cannot end in a refund.
-- Migration 014 shipped a "refund_approved" outcome; this migration replaces it
-- with "resolved" (report closed, no money moves) and releases the frozen share
-- as soon as the report is closed. Apply once after 014.
begin;
alter table public.marketplace_disputes
  drop constraint if exists marketplace_disputes_status_check;
update public.marketplace_disputes
  set status = 'resolved',
      resolution_note = left(
        btrim(coalesce(resolution_note, '') || ' [refund tidak tersedia; laporan ditutup]'),
        500
      ),
      updated_at = now()
  where status = 'refund_approved';
alter table public.marketplace_disputes
  add constraint marketplace_disputes_status_check
  check (status in ('open','seller_replied','resolved','rejected','withdrawn'));

-- A distinct, harmless marker so CHECK_INSTALLATION can tell 014 from 015.
create function public.piwu_dispute_outcomes() returns text[]
language sql immutable as $$
  select array['open','seller_replied','resolved','rejected','withdrawn']::text[]
$$;

create or replace function public.piwu_dispute_review(
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
    or p_status is null or p_status not in ('resolved','rejected')
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
    'seller_id', row.seller_id,
    'refund', false
  );
  insert into public.platform_audit(id, actor_id, action, target_id, reason, request_hash, result)
  values (p_request, p_actor, 'dispute_review', p_dispute, btrim(p_note), request_hash, result);
  return result;
end $$;

-- The seller's share is held only while a report is unresolved. Closing the
-- report (resolved, rejected, or withdrawn) releases it; nothing is refunded.
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
      and d.status in ('open','seller_replied');
  select coalesce(sum(s.net),0)::integer into accrued
    from public.marketplace_sales s
    where s.seller_id = p_user and s.status = 'accrued'
      and not exists(
        select 1 from public.marketplace_disputes d
        where d.order_id = s.order_id
          and d.status in ('open','seller_replied')
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

revoke all on function
  public.piwu_dispute_review(uuid,uuid,uuid,text,text),
  public.piwu_dispute_outcomes(),
  public.piwu_seller_balance(uuid)
from public, anon, authenticated;
grant execute on function
  public.piwu_dispute_review(uuid,uuid,uuid,text,text),
  public.piwu_dispute_outcomes(),
  public.piwu_seller_balance(uuid)
to service_role;
commit;
