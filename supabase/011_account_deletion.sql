-- Account removal for the admin panel. Apply once after 005–010.
--
-- Deleting auth.users is not possible without losing invoices and the admin
-- audit trail: 24 columns across 18 tables reference auth.users(id) without
-- ON DELETE CASCADE. This migration therefore removes the account the way the
-- product can do it safely:
--   * the account is suspended first, so every API call and RLS policy stops;
--   * personal content (owned projects and their children, prompts, settings,
--     invites, comments, referral rows, Studio bridges, sandbox slots) is
--     deleted;
--   * templates are archived instead of deleted, so buyers keep what they
--     purchased;
--   * financial and audit rows (payment_orders, credit_ledger,
--     marketplace_sales, template_entitlements, platform_audit) are kept, with
--     no email in them — they only hold the user's UUID;
--   * the public profile is anonymised. The server then replaces the Auth
--     email with a tombstone and soft-deletes the Auth user through the Admin
--     API, which frees the original email for a new signup.
begin;
create or replace function public.piwu_admin_delete_account(
  p_actor uuid,
  p_request uuid,
  p_target uuid,
  p_payload jsonb,
  p_reason text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor_role text;
  request_hash text;
  previous public.platform_audit%rowtype;
  result jsonb;
  project_count integer;
  template_count integer;
begin
  perform pg_advisory_xact_lock(918273645);
  select role into actor_role from public.platform_admins where user_id = p_actor;
  if actor_role is null or actor_role <> 'superadmin' or not public.piwu_user_active(p_actor) then
    raise exception 'ADMIN_FORBIDDEN' using errcode = '42501';
  end if;
  if p_target is null or p_request is null or p_reason is null
    or char_length(btrim(p_reason)) not between 8 and 500
    or p_payload is null or jsonb_typeof(p_payload) <> 'object'
    or octet_length(p_payload::text) > 100000
    or p_payload->>'confirmation' is distinct from p_target::text then
    raise exception 'ADMIN_INVALID';
  end if;
  if p_target = p_actor then
    raise exception 'ADMIN_SELF' using errcode = '42501';
  end if;
  request_hash = md5('user_delete' || p_target::text || p_payload::text || p_reason);
  select * into previous from public.platform_audit where id = p_request;
  if found then
    if previous.actor_id <> p_actor or previous.request_hash <> request_hash then
      raise exception 'ADMIN_DUPLICATE';
    end if;
    return previous.result;
  end if;
  if not exists(select 1 from auth.users where id = p_target) then
    raise exception 'ADMIN_NOT_FOUND';
  end if;
  if exists(select 1 from public.platform_admins where user_id = p_target) then
    raise exception 'ADMIN_REMOVE_ROLE_FIRST';
  end if;

  -- Stop the account before touching any row. The function is one transaction:
  -- a failure rolls the removal back, and a commit leaves the account blocked
  -- even if retiring the Auth identity has to be retried by the server.
  insert into public.platform_user_controls(user_id, suspended, reason)
  values (p_target, true, 'Akun dihapus: ' || p_reason)
  on conflict(user_id) do update
    set suspended = true, reason = excluded.reason, updated_at = now();

  -- Operational rows that would otherwise keep a hold or a slot alive.
  delete from public.credit_reservations where user_id = p_target;
  delete from public.publish_jobs where user_id = p_target;
  delete from public.runtime_sandbox_slots where user_id = p_target;
  delete from public.studio_bridges where user_id = p_target;
  delete from public.broadcast_reads where user_id = p_target;
  delete from public.usage where user_id = p_target;

  -- Rows created by this account inside someone else's project keep existing,
  -- attributed to the project owner so NOT NULL ownership columns stay valid.
  update public.project_workspaces w
    set updated_by = p.owner_id
    from public.projects p
    where w.project_id = p.id and p.owner_id <> p_target and w.updated_by = p_target;
  update public.asset_records a
    set created_by = p.owner_id
    from public.projects p
    where a.project_id = p.id and p.owner_id <> p_target and a.created_by = p_target;
  update public.project_datasets d
    set created_by = case when d.created_by = p_target then p.owner_id else d.created_by end,
        updated_by = case when d.updated_by = p_target then p.owner_id else d.updated_by end
    from public.projects p
    where d.project_id = p.id and p.owner_id <> p_target
      and (d.created_by = p_target or d.updated_by = p_target);

  delete from public.comments where author_id = p_target;
  delete from public.project_invites where created_by = p_target or accepted_by = p_target;
  delete from public.recording_shares where created_by = p_target;

  -- Owned projects cascade to files, messages, plans, versions, memory,
  -- comments, recordings, env vars, deployments, analytics, scans, workspace,
  -- datasets, asset records, publish jobs and site rows.
  delete from public.projects where owner_id = p_target;
  get diagnostics project_count = row_count;

  delete from public.prompts where owner_id = p_target;
  delete from public.model_settings where user_id = p_target;
  delete from public.referral_codes where user_id = p_target;
  delete from public.referrals where referrer_id = p_target or referred_id = p_target;

  update public.subscriptions set status = 'canceled'
    where user_id = p_target and status = 'active';
  -- Templates stay for the people who bought them; they leave the catalogue.
  update public.templates set status = 'archived' where owner_id = p_target;
  get diagnostics template_count = row_count;

  update public.users set name = 'Akun dihapus', avatar_url = null where id = p_target;

  result = jsonb_build_object(
    'projects', project_count,
    'templates', template_count,
    'retained', jsonb_build_array('payment_orders', 'credit_ledger', 'marketplace_sales', 'template_entitlements', 'platform_audit')
  );
  insert into public.platform_audit(id, actor_id, action, target_id, reason, request_hash, result)
  values (p_request, p_actor, 'user_delete', p_target, p_reason, request_hash, result);
  return result;
end;
$$;

-- A soft-deleted Auth row must not keep appearing in the admin directory: the
-- tombstone is only kept so invoices and audit rows stay valid.
create or replace function public.piwu_admin_users(p_actor uuid, p_query text default '', p_page integer default 1)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare items jsonb;
begin
  if not exists(select 1 from platform_admins where user_id = p_actor) or not public.piwu_user_active(p_actor) then
    raise exception 'ADMIN_FORBIDDEN' using errcode = '42501';
  end if;
  if p_query is null or length(p_query) > 100 or p_page is null or p_page not between 1 and 10000 then
    raise exception 'ADMIN_INVALID';
  end if;
  select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) into items from (
    select u.id, coalesce(u.email, '') email, left(coalesce(u.raw_user_meta_data->>'name', ''), 100) name,
      u.created_at, u.last_sign_in_at, (u.email_confirmed_at is not null or u.phone_confirmed_at is not null) verified,
      c.balance, coalesce(g.suspended, false) suspended, coalesce(g.reason, '') suspended_reason, a.role admin_role
    from auth.users u left join credit_accounts c on c.user_id = u.id
    left join platform_user_controls g on g.user_id = u.id left join platform_admins a on a.user_id = u.id
    where (to_jsonb(u)->>'deleted_at') is null
      and (p_query = '' or position(lower(p_query) in lower(concat_ws(' ', u.id::text, u.email, u.raw_user_meta_data->>'name'))) > 0)
    order by u.created_at desc nulls last, u.id desc limit 26 offset (p_page - 1) * 25
  ) r;
  return jsonb_build_object('page', p_page, 'hasMore', jsonb_array_length(items) > 25, 'items', items - 25);
end $$;
revoke all on function public.piwu_admin_users(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.piwu_admin_users(uuid, text, integer) to service_role;

comment on function public.piwu_admin_delete_account(uuid,uuid,uuid,jsonb,text) is
  'Superadmin-only account removal: suspends, deletes personal rows, archives templates, keeps financial/audit rows and writes platform_audit. Auth identity is retired by the server through the Supabase Admin API.';
revoke all on function public.piwu_admin_delete_account(uuid,uuid,uuid,jsonb,text) from public, anon, authenticated;
grant execute on function public.piwu_admin_delete_account(uuid,uuid,uuid,jsonb,text) to service_role;
commit;
