-- Marketplace payouts and seller verification (KYC), reviewed by a human.
-- Apply once after 012. This does NOT move money: a superadmin marks a payout
-- as paid after transferring it out-of-band, and the row keeps the reference.
-- Balances are derived from marketplace_sales, so there is no second ledger to
-- drift: available = accrued net − pending/approved − already paid.
begin;
create table public.seller_verifications (
  user_id uuid primary key references auth.users(id) on delete cascade,
  status text not null default 'unverified' check (status in ('unverified','pending','verified','rejected')),
  legal_name text check (legal_name is null or char_length(legal_name) between 2 and 120),
  business_name text check (business_name is null or char_length(business_name) between 1 and 120),
  tax_id text check (tax_id is null or char_length(tax_id) between 1 and 40),
  country text check (country is null or char_length(country) between 2 and 56),
  note text check (note is null or char_length(note) <= 500),
  submitted_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);
create table public.marketplace_payouts (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references auth.users(id),
  amount integer not null check (amount between 50000 and 50000000),
  method text not null check (method in ('bank','ewallet')),
  destination text not null check (char_length(destination) between 4 and 120),
  status text not null default 'requested' check (status in ('requested','approved','paid','rejected')),
  reference text check (reference is null or char_length(reference) between 4 and 120),
  note text check (note is null or char_length(note) <= 500),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id),
  paid_at timestamptz
);
create index marketplace_payouts_seller on public.marketplace_payouts(seller_id, created_at desc);
create index marketplace_payouts_queue on public.marketplace_payouts(status, created_at);
alter table public.seller_verifications enable row level security;
alter table public.marketplace_payouts enable row level security;
revoke all on public.seller_verifications, public.marketplace_payouts from public, anon, authenticated;
grant select on public.seller_verifications, public.marketplace_payouts to authenticated;
grant all on public.seller_verifications, public.marketplace_payouts to service_role;
create policy seller_verifications_read on public.seller_verifications for select to authenticated
  using (user_id = (select auth.uid()) and public.piwu_user_active((select auth.uid())));
create policy marketplace_payouts_read on public.marketplace_payouts for select to authenticated
  using (seller_id = (select auth.uid()) and public.piwu_user_active((select auth.uid())));

-- Derived balance. Reads are cheap and there is no materialised balance that a
-- failed payout could desynchronise.
create function public.piwu_seller_balance(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare accrued integer; pending integer; paid integer;
begin
  if p_user is null then
    return jsonb_build_object('accrued',0,'pending',0,'paid',0,'available',0,'currency','IDR');
  end if;
  select coalesce(sum(net),0)::integer into accrued
    from public.marketplace_sales where seller_id = p_user and status = 'accrued';
  select coalesce(sum(amount),0)::integer into pending
    from public.marketplace_payouts where seller_id = p_user and status in ('requested','approved');
  select coalesce(sum(amount),0)::integer into paid
    from public.marketplace_payouts where seller_id = p_user and status = 'paid';
  return jsonb_build_object(
    'accrued', accrued,
    'pending', pending,
    'paid', paid,
    'available', greatest(0, accrued - pending - paid),
    'currency', 'IDR'
  );
end $$;

create function public.piwu_seller_kyc_submit(
  p_user uuid,
  p_legal_name text,
  p_business_name text default null,
  p_tax_id text default null,
  p_country text default null
) returns text language plpgsql security definer set search_path = '' as $$
declare current_status text;
begin
  if p_user is null or not public.piwu_user_active(p_user) then
    raise exception 'PIWU_FORBIDDEN' using errcode = '42501';
  end if;
  if p_legal_name is null or char_length(btrim(p_legal_name)) not between 2 and 120
    or (p_business_name is not null and char_length(btrim(p_business_name)) > 120)
    or (p_tax_id is not null and char_length(btrim(p_tax_id)) > 40)
    or p_country is null or char_length(btrim(p_country)) not between 2 and 56 then
    raise exception 'PIWU_INVALID';
  end if;
  select status into current_status from public.seller_verifications where user_id = p_user for update;
  -- A verified seller does not lose that status by editing the form; a
  -- rejected seller may submit again and returns to the review queue.
  if current_status = 'verified' then return 'verified'; end if;
  insert into public.seller_verifications(
    user_id, status, legal_name, business_name, tax_id, country, note, submitted_at
  ) values (
    p_user, 'pending', btrim(p_legal_name),
    nullif(btrim(coalesce(p_business_name,'')),''),
    nullif(btrim(coalesce(p_tax_id,'')),''),
    btrim(p_country), null, now()
  )
  on conflict(user_id) do update set
    status = 'pending',
    legal_name = excluded.legal_name,
    business_name = excluded.business_name,
    tax_id = excluded.tax_id,
    country = excluded.country,
    note = null,
    reviewed_at = null,
    reviewed_by = null,
    submitted_at = now(),
    updated_at = now();
  return 'pending';
end $$;

create function public.piwu_request_payout(
  p_user uuid,
  p_amount integer,
  p_method text,
  p_destination text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare available integer; created uuid;
begin
  if p_user is null or not public.piwu_user_active(p_user) then
    raise exception 'PIWU_FORBIDDEN' using errcode = '42501';
  end if;
  if not exists(
    select 1 from public.seller_verifications
    where user_id = p_user and status = 'verified'
  ) then
    raise exception 'PIWU_KYC_REQUIRED';
  end if;
  if p_amount is null or p_amount < 50000 or p_amount > 50000000
    or p_method is null or p_method not in ('bank','ewallet')
    or p_destination is null
    or char_length(btrim(p_destination)) not between 4 and 120 then
    raise exception 'PIWU_INVALID';
  end if;
  -- Serialise requests per seller so two tabs cannot both spend the same
  -- available balance.
  perform pg_advisory_xact_lock(71008, hashtext(p_user::text));
  select (public.piwu_seller_balance(p_user)->>'available')::integer into available;
  if p_amount > available then
    raise exception 'PIWU_INSUFFICIENT';
  end if;
  insert into public.marketplace_payouts(seller_id, amount, method, destination)
  values (p_user, p_amount, p_method, btrim(p_destination))
  returning id into created;
  return created;
end $$;

create function public.piwu_review_kyc(
  p_actor uuid,
  p_request uuid,
  p_user uuid,
  p_status text,
  p_note text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor_role text;
  request_hash text;
  previous public.platform_audit%rowtype;
  result jsonb;
  current_status text;
begin
  select role into actor_role from public.platform_admins where user_id = p_actor;
  if actor_role is null or actor_role <> 'superadmin' or not public.piwu_user_active(p_actor) then
    raise exception 'ADMIN_FORBIDDEN' using errcode = '42501';
  end if;
  if p_request is null or p_user is null
    or p_status is null or p_status not in ('verified','rejected')
    or (p_note is not null and char_length(btrim(p_note)) > 500)
    or (p_status = 'rejected' and (p_note is null or char_length(btrim(p_note)) < 8)) then
    raise exception 'ADMIN_INVALID';
  end if;
  request_hash = md5('kyc_review' || p_user::text || p_status || coalesce(p_note,''));
  select * into previous from public.platform_audit where id = p_request;
  if found then
    if previous.actor_id <> p_actor or previous.request_hash <> request_hash then
      raise exception 'ADMIN_DUPLICATE';
    end if;
    return previous.result;
  end if;
  select status into current_status from public.seller_verifications where user_id = p_user for update;
  if current_status is null then raise exception 'ADMIN_NOT_FOUND'; end if;
  if current_status not in ('pending','rejected') then
    raise exception 'ADMIN_INVALID';
  end if;
  update public.seller_verifications set
    status = p_status,
    note = nullif(btrim(coalesce(p_note,'')),''),
    reviewed_at = now(),
    reviewed_by = p_actor,
    updated_at = now()
  where user_id = p_user;
  result = jsonb_build_object('status', p_status, 'user_id', p_user);
  insert into public.platform_audit(id, actor_id, action, target_id, reason, request_hash, result)
  values (p_request, p_actor, 'kyc_review', p_user, coalesce(p_note,''), request_hash, result);
  return result;
end $$;

create function public.piwu_review_payout(
  p_actor uuid,
  p_request uuid,
  p_payout uuid,
  p_status text,
  p_reference text,
  p_note text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor_role text;
  request_hash text;
  previous public.platform_audit%rowtype;
  result jsonb;
  row public.marketplace_payouts%rowtype;
begin
  select role into actor_role from public.platform_admins where user_id = p_actor;
  if actor_role is null or actor_role <> 'superadmin' or not public.piwu_user_active(p_actor) then
    raise exception 'ADMIN_FORBIDDEN' using errcode = '42501';
  end if;
  if p_request is null or p_payout is null
    or p_status is null or p_status not in ('approved','paid','rejected')
    or (p_note is not null and char_length(btrim(p_note)) > 500)
    or (p_status = 'paid' and (p_reference is null or char_length(btrim(p_reference)) not between 4 and 120))
    or (p_status = 'rejected' and (p_note is null or char_length(btrim(p_note)) < 8)) then
    raise exception 'ADMIN_INVALID';
  end if;
  request_hash = md5(
    'payout_review' || p_payout::text || p_status ||
    coalesce(p_reference,'') || coalesce(p_note,'')
  );
  select * into previous from public.platform_audit where id = p_request;
  if found then
    if previous.actor_id <> p_actor or previous.request_hash <> request_hash then
      raise exception 'ADMIN_DUPLICATE';
    end if;
    return previous.result;
  end if;
  select * into row from public.marketplace_payouts where id = p_payout for update;
  if not found then raise exception 'ADMIN_NOT_FOUND'; end if;
  if (p_status = 'approved' and row.status <> 'requested')
    or (p_status = 'paid' and row.status not in ('requested','approved'))
    or (p_status = 'rejected' and row.status not in ('requested','approved')) then
    raise exception 'ADMIN_INVALID';
  end if;
  update public.marketplace_payouts set
    status = p_status,
    reference = case when p_status = 'paid' then btrim(p_reference) else reference end,
    note = nullif(btrim(coalesce(p_note,'')),''),
    reviewed_at = now(),
    reviewed_by = p_actor,
    paid_at = case when p_status = 'paid' then now() else paid_at end
  where id = p_payout;
  result = jsonb_build_object(
    'status', p_status,
    'amount', row.amount,
    'seller_id', row.seller_id
  );
  insert into public.platform_audit(id, actor_id, action, target_id, reason, request_hash, result)
  values (p_request, p_actor, 'payout_review', p_payout, coalesce(p_note,''), request_hash, result);
  return result;
end $$;

-- Account deletion runs piwu_admin_delete_account() (011), then the server calls
-- this helper so KYC rows and transfer destinations do not outlive the account.
-- Amounts, status and transfer references stay: they are the financial record.
create function public.piwu_purge_seller_pii(p_user uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare removed integer; redacted integer;
begin
  if p_user is null then
    return jsonb_build_object('verification',0,'payouts',0);
  end if;
  delete from public.seller_verifications where user_id = p_user;
  get diagnostics removed = row_count;
  update public.marketplace_payouts
    set destination = '[dihapus]', note = null
    where seller_id = p_user and destination <> '[dihapus]';
  get diagnostics redacted = row_count;
  return jsonb_build_object('verification',removed,'payouts',redacted);
end $$;

revoke all on function
  public.piwu_seller_balance(uuid),
  public.piwu_seller_kyc_submit(uuid,text,text,text,text),
  public.piwu_request_payout(uuid,integer,text,text),
  public.piwu_review_kyc(uuid,uuid,uuid,text,text),
  public.piwu_review_payout(uuid,uuid,uuid,text,text,text),
  public.piwu_purge_seller_pii(uuid)
from public, anon, authenticated;
grant execute on function
  public.piwu_seller_balance(uuid),
  public.piwu_seller_kyc_submit(uuid,text,text,text,text),
  public.piwu_request_payout(uuid,integer,text,text),
  public.piwu_review_kyc(uuid,uuid,uuid,text,text),
  public.piwu_review_payout(uuid,uuid,uuid,text,text,text),
  public.piwu_purge_seller_pii(uuid)
to service_role;
commit;
