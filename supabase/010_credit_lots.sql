-- 010: credit lots, the daily allowance and expiry.
--
-- Until 009 a balance was one number: nothing to expire, nothing to reset. This
-- migration gives credits the rules the pricing page states:
--   * a daily allowance that refills to its cap at 00:00 UTC and never
--     accumulates -- unused daily credits are gone at the next reset,
--   * plan credits that roll over while the subscription runs but expire two
--     months after they are issued,
--   * top-up and referral credits valid twelve months,
--   * every spend draws from the lot that expires soonest, and a failed
--     operation returns credits under the same policy it took them from.
--
-- `credit_accounts.balance` stays the number the API and the UI read; the lots
-- are the record behind it. The two are kept in step by every function below
-- (tests/credit-lots.test.ts asserts it), and a chargeback that outlives the
-- credits is allowed to push the balance negative, the way it did before 010.

begin;
create table public.credit_lots (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 source text not null check (source in ('daily','plan','topup','bonus','admin','refund')),
 amount integer not null check (amount > 0),
 remaining integer not null check (remaining >= 0),
 granted_at timestamptz not null default now(),
 expires_at timestamptz,
 reference text
);
create index credit_lots_user_expiry on public.credit_lots(user_id, expires_at nulls last, granted_at);
alter table public.credit_lots enable row level security;
create policy credit_lots_read on public.credit_lots for select to authenticated using(user_id=(select auth.uid()));
grant select on public.credit_lots to authenticated;
alter table public.credit_reservations add column lots jsonb;

-- The numbers the pricing page prints. shared/credits.mjs mirrors them and
-- tests/credits-model.test.ts fails if the two drift apart.
create function public.piwu_credit_policy() returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_object(
  'dailyFree',20,'dailyPro',30,'dailyTeam',40,'freeMonthlyCap',600,
  'planMonths',2,'topupMonths',12,'resetUtcHour',0);
$$;

-- When a lot of this source stops being spendable, measured from p_at.
create function public.piwu_lot_expiry(p_source text,p_at timestamptz) returns timestamptz language sql stable set search_path='' as $$
with policy as (
 select (public.piwu_credit_policy()->>'resetUtcHour')::integer as h,
        (public.piwu_credit_policy()->>'planMonths')::integer as pm,
        (public.piwu_credit_policy()->>'topupMonths')::integer as tm)
select case p_source
 when 'daily' then ((date_trunc('day',(p_at at time zone 'utc')-make_interval(hours=>h))+interval '1 day'+make_interval(hours=>h)) at time zone 'utc')
 when 'plan' then p_at+make_interval(months=>pm)
 when 'topup' then p_at+make_interval(months=>tm)
 when 'bonus' then p_at+make_interval(months=>tm)
 when 'refund' then p_at+make_interval(months=>tm)
 else null
end from policy;
$$;

-- Add credits: one lot, the balance, and one ledger row. Never called with a
-- non-positive amount; callers check first so a no-op writes nothing.
create function public.piwu_grant_credits(p_user uuid,p_amount integer,p_source text,p_reason text,p_expires_at timestamptz,p_reference text) returns integer language plpgsql security definer set search_path='' as $$
declare result integer;begin
 if p_amount is null or p_amount<=0 then raise exception 'PIWU_INVALID';end if;
 insert into public.credit_lots(user_id,source,amount,remaining,expires_at,reference) values(p_user,p_source,p_amount,p_amount,p_expires_at,p_reference);
 update public.credit_accounts set balance=balance+p_amount where user_id=p_user;
 insert into public.credit_ledger(user_id,delta,reason,reference) values(p_user,p_amount,p_reason,p_reference) on conflict do nothing;
 select balance into result from public.credit_accounts where user_id=p_user;return result;
end;$$;

-- Take credits away (chargeback, referral reversal, admin correction): the
-- soonest-expiring lots give first, and a shortfall is left as a negative
-- balance because the money really did leave the account.
create function public.piwu_revoke_credits(p_user uuid,p_amount integer,p_reason text,p_reference text) returns integer language plpgsql security definer set search_path='' as $$
declare need integer;p_lot record;taken integer;result integer;begin
 if p_amount is null or p_amount<=0 then raise exception 'PIWU_INVALID';end if;
 need:=p_amount;
 for p_lot in select id,remaining from public.credit_lots where user_id=p_user and remaining>0 order by expires_at nulls last,granted_at asc,id for update loop
  exit when need<=0;
  taken:=least(p_lot.remaining,need);
  update public.credit_lots set remaining=remaining-taken where id=p_lot.id;
  need:=need-taken;
 end loop;
 update public.credit_accounts set balance=balance-p_amount where user_id=p_user;
 insert into public.credit_ledger(user_id,delta,reason,reference) values(p_user,-p_amount,p_reason,p_reference) on conflict do nothing;
 select balance into result from public.credit_accounts where user_id=p_user;return result;
end;$$;

-- The daily allowance. Refills to the cap once per UTC day, never accumulates,
-- and stops for Free accounts once the month's cap is reached. Returns what was
-- granted (0 when today's allowance is already in the account).
create function public.piwu_claim_daily(p_user uuid) returns integer language plpgsql security definer set search_path='' as $$
declare policy jsonb;day_key text;plan_name text;allowance integer;month_total integer;granted integer;begin
 policy:=public.piwu_credit_policy();
 insert into public.credit_accounts(user_id,balance) values(p_user,0) on conflict do nothing;
 day_key:=to_char((now() at time zone 'utc'),'YYYY-MM-DD');
 if exists(select 1 from public.credit_lots where user_id=p_user and source='daily' and reference='daily:'||day_key) then return 0;end if;
 select plan into plan_name from public.subscriptions where user_id=p_user and status='active' and current_period_end>now() order by current_period_end desc limit 1;
 if plan_name='Team' then allowance:=(policy->>'dailyTeam')::integer;
 elsif plan_name='Pro' then allowance:=(policy->>'dailyPro')::integer;
 else
  allowance:=(policy->>'dailyFree')::integer;
  select coalesce(sum(amount),0) into month_total from public.credit_lots where user_id=p_user and source='daily' and (granted_at at time zone 'utc')>=date_trunc('month',(now() at time zone 'utc'));
  if month_total>=(policy->>'freeMonthlyCap')::integer then return 0;end if;
  allowance:=least(allowance,(policy->>'freeMonthlyCap')::integer-month_total);
 end if;
 granted:=public.piwu_grant_credits(p_user,allowance,'daily','Jatah harian',public.piwu_lot_expiry('daily',now()),'daily:'||day_key);
 return allowance;
end;$$;

-- Read-only facts about today's allowance, for GET /api/account: what the plan
-- grants per day, how much of it is still unspent, how far the Free cap is, and
-- when the next reset happens. The reset instant is exactly the daily lot's
-- expiry (piwu_lot_expiry), so a countdown in the UI cannot point at a time the
-- database does not use. Writes nothing: call piwu_ensure_credits first if the
-- day has not been claimed yet.
create function public.piwu_credit_status(p_user uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare policy jsonb;plan_name text;allowance integer;claimed integer;left_over integer;month_total integer;h integer;begin
 policy:=public.piwu_credit_policy();h:=(policy->>'resetUtcHour')::integer;
 select plan into plan_name from public.subscriptions where user_id=p_user and status='active' and current_period_end>now() order by current_period_end desc limit 1;
 if plan_name='Team' then allowance:=(policy->>'dailyTeam')::integer;
 elsif plan_name='Pro' then allowance:=(policy->>'dailyPro')::integer;
 else allowance:=(policy->>'dailyFree')::integer;end if;
 select coalesce(sum(l.remaining),0),coalesce(sum(l.amount),0) into left_over,claimed from public.credit_lots l
  where l.user_id=p_user and l.source='daily' and l.reference='daily:'||to_char((now() at time zone 'utc'),'YYYY-MM-DD');
 select coalesce(sum(l.amount),0) into month_total from public.credit_lots l
  where l.user_id=p_user and l.source='daily' and (l.granted_at at time zone 'utc')>=date_trunc('month',(now() at time zone 'utc'));
 return jsonb_build_object(
  'applied',true,'source','database',
  'plan',coalesce(plan_name,'Free'),
  'daily',allowance,'dailyClaimed',claimed,'dailyRemaining',left_over,
  'monthlyCap',case when plan_name in('Pro','Team') then null else (policy->>'freeMonthlyCap')::integer end,
  'monthlyUsed',month_total,
  'resetUtcHour',h,'resetAt',public.piwu_lot_expiry('daily',now()),
  'planMonths',(policy->>'planMonths')::integer,'topupMonths',(policy->>'topupMonths')::integer);
end;$$;

create or replace function public.piwu_ensure_credits(p_user uuid) returns integer language plpgsql security definer set search_path='' as $$
declare result integer;begin
 insert into public.credit_accounts(user_id,balance) values(p_user,0) on conflict do nothing;
 perform public.piwu_claim_daily(p_user);
 select balance into result from public.credit_accounts where user_id=p_user;return result;
end;$$;

create or replace function public.piwu_reserve_credits(p_user uuid,p_id uuid,p_amount integer,p_purpose text) returns integer language plpgsql security definer set search_path='' as $$
declare available integer;need integer;p_lot record;taken integer;draws jsonb:='[]'::jsonb;begin
 if p_amount is null or p_amount<1 or p_amount>1000 or p_id is null then raise exception 'PIWU_INVALID';end if;
 perform public.piwu_ensure_credits(p_user);
 select balance into available from public.credit_accounts where user_id=p_user for update;
 if exists(select 1 from public.credit_reservations where id=p_id) then raise exception 'PIWU_DUPLICATE';end if;
 if available<p_amount then raise exception 'PIWU_CREDITS';end if;
 if (select count(*) from public.credit_reservations where user_id=p_user and created_at>now()-interval '1 hour')>=120 then raise exception 'PIWU_RATE';end if;
 need:=p_amount;
 for p_lot in select id,remaining from public.credit_lots where user_id=p_user and remaining>0 order by expires_at nulls last,granted_at asc,id for update loop
  exit when need<=0;
  taken:=least(p_lot.remaining,need);
  update public.credit_lots set remaining=remaining-taken where id=p_lot.id;
  draws:=draws||jsonb_build_object('lot',p_lot.id,'amount',taken);
  need:=need-taken;
 end loop;
 if need>0 then raise exception 'PIWU_CREDITS';end if;
 insert into public.credit_reservations(id,user_id,amount,purpose,lots) values(p_id,p_user,p_amount,p_purpose,draws);
 update public.credit_accounts set balance=balance-p_amount where user_id=p_user;
 insert into public.credit_ledger(user_id,delta,reason,reference) values(p_user,-p_amount,p_purpose,'reserve:'||p_id);
 return available-p_amount;
end;$$;

create or replace function public.piwu_finish_credits(p_id uuid,p_success boolean) returns void language plpgsql security definer set search_path='' as $$
declare r public.credit_reservations%rowtype;entry jsonb;v_lot public.credit_lots%rowtype;back timestamptz;begin
 select * into r from public.credit_reservations where id=p_id for update;
 if not found or r.status<>'reserved' then return;end if;
 if p_success then update public.credit_reservations set status='settled',updated_at=now() where id=p_id;
 else
  for entry in select * from jsonb_array_elements(coalesce(r.lots,'[]'::jsonb)) loop
   select * into v_lot from public.credit_lots where id=(entry->>'lot')::uuid for update;
   if found then
    back:=public.piwu_lot_expiry(v_lot.source,now());
    -- A refund must not die in the same minute it is issued: spendable again
    -- for at least an hour, then it follows the policy of its own lot.
    if back is not null and back<now()+interval '1 hour' then back:=now()+interval '1 hour';end if;
    update public.credit_lots set remaining=remaining+(entry->>'amount')::integer,expires_at=back where id=v_lot.id;
   else
    insert into public.credit_lots(user_id,source,amount,remaining,expires_at,reference) values(r.user_id,'refund',(entry->>'amount')::integer,(entry->>'amount')::integer,public.piwu_lot_expiry('refund',now()),'refund:'||p_id);
   end if;
  end loop;
  -- Reservations made before this migration carry no breakdown.
  if r.lots is null or r.lots='[]'::jsonb then
   insert into public.credit_lots(user_id,source,amount,remaining,expires_at,reference) values(r.user_id,'refund',r.amount,r.amount,public.piwu_lot_expiry('refund',now()),'refund:'||p_id);
  end if;
  update public.credit_accounts set balance=balance+r.amount where user_id=r.user_id;
  insert into public.credit_ledger(user_id,delta,reason,reference) values(r.user_id,r.amount,'Pengembalian proses gagal','refund:'||p_id) on conflict do nothing;
  update public.credit_reservations set status='refunded',updated_at=now() where id=p_id;
 end if;
end;$$;

-- Zero every lot whose time is up and tell each owner once. Called by
-- piwu_recover_credits and directly by the server's sweep.
create function public.piwu_expire_credits() returns integer language plpgsql security definer set search_path='' as $$
declare r record;total integer:=0;begin
 for r in select user_id,sum(remaining)::integer as lost,array_agg(id) as ids from public.credit_lots where remaining>0 and expires_at is not null and expires_at<=now() group by user_id loop
  update public.credit_lots set remaining=0 where id=any(r.ids);
  update public.credit_accounts set balance=balance-r.lost where user_id=r.user_id;
  insert into public.credit_ledger(user_id,delta,reason,reference) values(r.user_id,-r.lost,'Kredit kedaluwarsa','expire:'||r.user_id||':'||to_char(now(),'YYYY-MM-DD"T"HH24:MI:SS')) on conflict do nothing;
  total:=total+r.lost;
 end loop;
 return total;
end;$$;

-- Accounts that existed before 010 keep what they had, as a twelve-month lot:
-- nobody loses a credit to the migration.
insert into public.credit_lots(user_id,source,amount,remaining,expires_at,reference)
select a.user_id,'topup',a.balance,a.balance,public.piwu_lot_expiry('topup',now()),'migrasi-010:'||a.user_id
from public.credit_accounts a
where a.balance>0 and not exists(select 1 from public.credit_lots l where l.user_id=a.user_id);

create or replace function public.piwu_apply_payment(p_id uuid,p_amount integer,p_currency text,p_state text) returns text language plpgsql security definer set search_path='' as $$
declare o public.payment_orders%rowtype;ref public.referrals%rowtype;seller uuid;period_end timestamptz;cancelled_start timestamptz;cancelled_end timestamptz;unused interval;begin
 select * into o from public.payment_orders where id=p_id for update;
 if not found or p_amount is null or o.amount<>p_amount or o.currency is distinct from p_currency then raise exception 'PIWU_PAYMENT_MISMATCH';end if;
 if p_state='paid' then
 if o.refunded_at is not null then return 'refunded';end if;
 if o.fulfilled_at is not null then return 'already_paid';end if;
 perform public.piwu_ensure_credits(o.user_id);
 if o.credits>0 then
 perform public.piwu_grant_credits(o.user_id,o.credits,case when o.kind='topup' then 'topup' else 'plan' end,'Pembayaran terverifikasi',public.piwu_lot_expiry(case when o.kind='topup' then 'topup' else 'plan' end,now()),'payment:'||o.id);
 end if;
 if o.kind='plan' then
 select greatest(now(),coalesce(max(current_period_end),now()))+interval '30 days' into period_end from public.subscriptions where user_id=o.user_id and status='active';
 insert into public.subscriptions(user_id,plan,provider,status,current_period_start,current_period_end,order_id) values(o.user_id,o.plan,o.provider,'active',period_end-interval '30 days',period_end,o.id);
 elsif o.kind='template' then
 select owner_id into seller from public.templates where id=o.template_id;
 insert into public.template_entitlements(user_id,template_id,order_id) values(o.user_id,o.template_id,o.id) on conflict do nothing;
 insert into public.marketplace_sales(order_id,seller_id,buyer_id,gross,platform_fee,net) values(o.id,seller,o.user_id,o.amount,(o.amount*0.2)::integer,o.amount-(o.amount*0.2)::integer);
 end if;
 update public.payment_orders set status='paid',fulfilled_at=now() where id=o.id;
 select * into ref from public.referrals where referred_id=o.user_id and reward_status='pending' and o.kind in('plan','topup') and o.amount>=49000 for update;
 if found then
 perform public.piwu_ensure_credits(ref.referrer_id);
 perform public.piwu_grant_credits(ref.referrer_id,50,'bonus','Bonus referral',public.piwu_lot_expiry('bonus',now()),'referral:'||ref.id||':a');
 perform public.piwu_grant_credits(ref.referred_id,50,'bonus','Bonus referral',public.piwu_lot_expiry('bonus',now()),'referral:'||ref.id||':b');
 update public.referrals set reward_status='rewarded',reward_order_id=o.id where id=ref.id;
 end if;
 return 'paid';
 elsif p_state='refunded' then
 if o.refunded_at is not null then return 'already_refunded';end if;
 if o.fulfilled_at is not null then
 if o.credits>0 then perform public.piwu_revoke_credits(o.user_id,o.credits,'Pembatalan pembayaran','chargeback:'||o.id);end if;
 select current_period_start,current_period_end into cancelled_start,cancelled_end from public.subscriptions where order_id=o.id;
 unused=greatest(interval '0 seconds',cancelled_end-greatest(cancelled_start,now()));
 update public.subscriptions set status='refunded' where order_id=o.id;
 if unused>interval '0 seconds' then
 update public.subscriptions set current_period_start=current_period_start-unused,current_period_end=current_period_end-unused where user_id=o.user_id and status='active' and current_period_start>=cancelled_end;
 end if;
 delete from public.template_entitlements where order_id=o.id;
 update public.marketplace_sales set status='refunded' where order_id=o.id;
 select * into ref from public.referrals where reward_order_id=o.id and reward_status='rewarded' for update;
 if found then
 perform public.piwu_revoke_credits(ref.referrer_id,50,'Pembatalan bonus referral','referral_reversal:'||ref.id||':a');
 perform public.piwu_revoke_credits(ref.referred_id,50,'Pembatalan bonus referral','referral_reversal:'||ref.id||':b');
 update public.referrals set reward_status='revoked' where id=ref.id;
 end if;
 end if;
 update public.payment_orders set status='refunded',refunded_at=now() where id=o.id;return 'refunded';
 elsif p_state='review' then
 update public.payment_orders set status='review' where id=o.id;return 'review';
 elsif p_state in('pending','expired','failed') then
 if o.fulfilled_at is null and o.refunded_at is null then update public.payment_orders set status=p_state where id=o.id;end if;return p_state;
 end if;raise exception 'PIWU_INVALID';
end;$$;
create or replace function public.piwu_admin_action(p_actor uuid,p_request uuid,p_action text,p_target uuid,p_payload jsonb,p_reason text) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor_role text;request_hash text;previous record;result jsonb='{}';rev bigint;bal integer;delta integer;v_role text;job_record record;begin
 perform pg_advisory_xact_lock(918273645);
 select role into actor_role from public.platform_admins where user_id=p_actor;
 if actor_role is null or actor_role='auditor' or not public.piwu_user_active(p_actor) then raise exception 'ADMIN_FORBIDDEN' using errcode='42501';end if;
 if p_action is null or p_request is null or p_reason is null or char_length(btrim(p_reason)) not between 8 and 500 or p_payload is null or jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>100000 then raise exception 'ADMIN_INVALID';end if;
 request_hash=md5(p_action||coalesce(p_target::text,'')||p_payload::text||p_reason);
 select * into previous from public.platform_audit where id=p_request;
 if found then if previous.actor_id<>p_actor or previous.request_hash<>request_hash then raise exception 'ADMIN_DUPLICATE';end if;return previous.result;end if;
 if p_action in('admin_role','credits','user_suspend','settings','project_delete') and actor_role<>'superadmin' then raise exception 'ADMIN_FORBIDDEN' using errcode='42501';end if;
 case p_action
 when 'admin_role' then
 if not exists(select 1 from auth.users where id=p_target) then raise exception 'ADMIN_NOT_FOUND';end if;
 v_role=p_payload->>'role';if v_role not in('superadmin','operator','auditor','remove') or v_role is null then raise exception 'ADMIN_INVALID';end if;
 if exists(select 1 from public.platform_admins where user_id=p_target and role='superadmin') and v_role<>'superadmin' and (select count(*) from public.platform_admins where role='superadmin')<=1 then raise exception 'ADMIN_LAST_SUPERADMIN';end if;
 if v_role<>'remove' and not public.piwu_user_active(p_target) then raise exception 'ADMIN_INVALID';end if;
 if v_role='remove' then delete from public.platform_admins where user_id=p_target;
 else insert into public.platform_admins(user_id,role,granted_by) values(p_target,v_role,p_actor) on conflict(user_id) do update set role=excluded.role,granted_by=p_actor;end if;
 when 'user_suspend' then
 if not exists(select 1 from auth.users where id=p_target) then raise exception 'ADMIN_NOT_FOUND';end if;
 if p_payload->>'suspended' not in('true','false') or p_payload->>'suspended' is null then raise exception 'ADMIN_INVALID';end if;
 if exists(select 1 from public.platform_admins where user_id=p_target) then raise exception 'ADMIN_REMOVE_ROLE_FIRST';end if;
 insert into public.platform_user_controls(user_id,suspended,reason) values(p_target,(p_payload->>'suspended')::boolean,p_reason) on conflict(user_id) do update set suspended=excluded.suspended,reason=excluded.reason,updated_at=now();
 when 'credits' then
 if jsonb_typeof(p_payload->'delta') is distinct from 'number' then raise exception 'ADMIN_INVALID';end if;
 delta=(p_payload->>'delta')::integer;if delta=0 or abs(delta)>10000 or delta::numeric<>(p_payload->>'delta')::numeric then raise exception 'ADMIN_INVALID';end if;
 perform public.piwu_ensure_credits(p_target);select balance into bal from public.credit_accounts where user_id=p_target for update;
 if bal+delta<0 then raise exception 'ADMIN_NEGATIVE_BALANCE';end if;
 if delta>0 then perform public.piwu_grant_credits(p_target,delta,'admin','Penyesuaian admin: '||p_reason,null,'admin:'||p_request);
 else perform public.piwu_revoke_credits(p_target,-delta,'Penyesuaian admin: '||p_reason,'admin:'||p_request);end if;
 result=jsonb_build_object('balance',bal+delta);
 when 'project_lock' then
 if not exists(select 1 from public.projects where id=p_target) then raise exception 'ADMIN_NOT_FOUND';end if;
 if p_payload->>'locked' not in('true','false') or p_payload->>'locked' is null then raise exception 'ADMIN_INVALID';end if;
 insert into public.platform_project_controls(project_id,locked,reason) values(p_target,(p_payload->>'locked')::boolean,p_reason) on conflict(project_id) do update set locked=excluded.locked,reason=excluded.reason,updated_at=now();
 when 'project_delete' then
 for job_record in select id,status from public.publish_jobs where project_id=p_target and status in('queued','building') for update loop
 if job_record.status='building' then raise exception 'ADMIN_CONFLICT';end if;
 perform public.piwu_finish_credits(job_record.id,false);
 end loop;
 if p_payload->>'confirmation' is distinct from p_target::text then raise exception 'ADMIN_INVALID';end if;
 delete from public.projects where id=p_target;if not found then raise exception 'ADMIN_NOT_FOUND';end if;
 when 'template_status' then
 if p_payload->>'status' not in('published','archived') or p_payload->>'status' is null then raise exception 'ADMIN_INVALID';end if;
 update public.templates set status=p_payload->>'status' where id=p_target;if not found then raise exception 'ADMIN_NOT_FOUND';end if;
 when 'recording_revoke' then
 if not exists(select 1 from public.recording_shares where recording_id=p_target) then raise exception 'ADMIN_NOT_FOUND';end if;
 update public.recording_shares set revoked_at=now() where recording_id=p_target and revoked_at is null;
 when 'publish_cancel' then
 perform 1 from public.publish_jobs where id=p_target and status='queued' for update;if not found then raise exception 'ADMIN_CONFLICT';end if;
 update public.publish_jobs set status='failed',error='Dibatalkan administrator.',updated_at=now() where id=p_target;perform public.piwu_finish_credits(p_target,false);
 when 'hosting_retry' then
 update public.hosting_cleanup_jobs set attempts=0,error=null where id=p_target;if not found then raise exception 'ADMIN_NOT_FOUND';end if;
 when 'unpublish' then
 perform 1 from public.publish_jobs where project_id=p_target and status in('queued','building') for update;
 if found then raise exception 'ADMIN_CONFLICT';end if;
 if not exists(select 1 from public.project_sites where project_id=p_target) then raise exception 'ADMIN_NOT_FOUND';end if;
 insert into public.platform_project_controls(project_id,locked,reason) values(p_target,true,p_reason) on conflict(project_id) do update set locked=true,reason=p_reason,updated_at=now();
 delete from public.project_sites where project_id=p_target;update public.deployments set status='unpublish_queued' where project_id=p_target and status='ready';result='{"queued":true}';
 when 'payment_reconcile' then
 result=jsonb_build_object('status',public.piwu_apply_payment(p_target,(p_payload->>'amount')::integer,p_payload->>'currency',p_payload->>'state'));
 when 'broadcast_save' then
 if p_target is null or char_length(coalesce(p_payload->>'title','')) not between 1 and 120 or char_length(coalesce(p_payload->>'body','')) not between 1 and 4000 or p_payload->>'audience' not in('public','members','pro','team') or p_payload->>'status' not in('draft','published','archived') or p_payload->>'revision' is null then raise exception 'ADMIN_INVALID';end if;
 select revision into rev from public.platform_broadcasts where id=p_target for update;
 if coalesce(rev,0)<>(p_payload->>'revision')::bigint then raise exception 'ADMIN_CONFLICT';end if;
 insert into public.platform_broadcasts(id,title,body,audience,status,starts_at,ends_at,created_by) values(p_target,p_payload->>'title',p_payload->>'body',p_payload->>'audience',p_payload->>'status',(p_payload->>'starts_at')::timestamptz,(p_payload->>'ends_at')::timestamptz,p_actor)
 on conflict(id) do update set title=excluded.title,body=excluded.body,audience=excluded.audience,status=excluded.status,starts_at=excluded.starts_at,ends_at=excluded.ends_at,revision=public.platform_broadcasts.revision+1,updated_at=now();
 result=jsonb_build_object('revision',coalesce(rev,0)+1);
 when 'settings' then
 select revision into rev from public.site_configuration where id for update;
 if p_payload->>'revision' is null or rev<>(p_payload->>'revision')::bigint then raise exception 'ADMIN_CONFLICT';end if;
 if jsonb_typeof(p_payload->'value') is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_payload->'value') k where k not in('maintenance','maintenance_message','hero_title','hero_subtitle','support_email','enabled_services')) then raise exception 'ADMIN_INVALID';end if;
 if jsonb_typeof(p_payload->'value'->'maintenance') is distinct from 'boolean' then raise exception 'ADMIN_INVALID';end if;
 update public.site_configuration set value=p_payload->'value',revision=revision+1,updated_at=now() where id;result=jsonb_build_object('revision',rev+1);
 else raise exception 'ADMIN_INVALID';end case;
 insert into public.platform_audit(id,actor_id,action,target_id,reason,request_hash,result) values(p_request,p_actor,p_action,p_target,p_reason,request_hash,result);
 return result;
end;$$;
create or replace function public.piwu_recover_credits() returns void language plpgsql security definer set search_path='' as $$
declare r record;begin
 update public.publish_jobs set status='failed',error='Antrean publish kedaluwarsa; silakan coba kembali.',updated_at=now() where status='queued' and created_at<now()-interval '1 hour';
 for r in select c.id from public.credit_reservations c where c.status='reserved' and c.created_at<now()-interval '35 minutes' and not exists(select 1 from public.publish_jobs j where j.id=c.id and j.status in('queued','building')) loop
 perform public.piwu_finish_credits(r.id,exists(select 1 from public.publish_jobs j where j.id=r.id and j.status='ready'));
 end loop;
 perform public.piwu_expire_credits();
 delete from public.analytics_events where created_at<now()-interval '31 days';
end;$$;

revoke all on function public.piwu_grant_credits(uuid,integer,text,text,timestamptz,text) from public,anon,authenticated;
revoke all on function public.piwu_revoke_credits(uuid,integer,text,text) from public,anon,authenticated;
revoke all on function public.piwu_claim_daily(uuid) from public,anon,authenticated;
revoke all on function public.piwu_credit_status(uuid) from public,anon,authenticated;
revoke all on function public.piwu_expire_credits() from public,anon,authenticated;
revoke all on function public.piwu_credit_policy() from public,anon,authenticated;
revoke all on function public.piwu_lot_expiry(text,timestamptz) from public,anon,authenticated;
grant execute on function public.piwu_grant_credits(uuid,integer,text,text,timestamptz,text) to service_role;
grant execute on function public.piwu_revoke_credits(uuid,integer,text,text) to service_role;
grant execute on function public.piwu_claim_daily(uuid) to service_role;
grant execute on function public.piwu_credit_status(uuid) to service_role;
grant execute on function public.piwu_expire_credits() to service_role;
grant execute on function public.piwu_credit_policy() to service_role;
grant execute on function public.piwu_lot_expiry(text,timestamptz) to service_role;
grant all on public.credit_lots to service_role;
commit;
