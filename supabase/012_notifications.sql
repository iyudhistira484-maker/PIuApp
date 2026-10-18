-- Per-account notifications for the bell in the dashboard and workspace.
-- Apply once after 011. Cross-device by construction: rows live on the server,
-- every device reads the same list, and Supabase Realtime pushes new rows when
-- the table is part of the realtime publication. No email/push provider is
-- required; a closed browser only sees them when it opens the app again.
begin;
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('payment','credits','project','marketplace','system')),
  title text not null check (char_length(title) between 1 and 120),
  body text not null check (char_length(body) between 1 and 500),
  href text not null default '' check (href = '' or (href like '/%' and href not like '//%' and char_length(href) <= 300)),
  dedupe_key text check (dedupe_key is null or char_length(dedupe_key) between 1 and 200),
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, dedupe_key)
);
create index notifications_user_date on public.notifications(user_id, created_at desc);
create index notifications_unread on public.notifications(user_id) where read_at is null;
alter table public.notifications enable row level security;
revoke all on public.notifications from public, anon, authenticated;
grant select on public.notifications to authenticated;
grant all on public.notifications to service_role;
-- Browsers may only read their own rows (needed for Realtime); writes go
-- through the service-role RPC below.
create policy notifications_read on public.notifications for select to authenticated
  using (user_id = (select auth.uid()) and public.piwu_user_active((select auth.uid())));

-- Add the table to the realtime publication when the project uses Postgres
-- Changes. A FOR ALL TABLES publication already covers it; a missing
-- publication (local PGlite tests) is left alone.
do $$ begin
  if exists(select 1 from pg_publication where pubname = 'supabase_realtime' and not puballtables)
    and not exists(select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications') then
    execute 'alter publication supabase_realtime add table public.notifications';
  end if;
end $$;

create function public.piwu_notification_add(
  p_user uuid,
  p_kind text,
  p_title text,
  p_body text,
  p_href text default '',
  p_dedupe text default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare created uuid;
begin
  -- Unknown accounts (deleted between the event and this call) are ignored:
  -- notifications are best-effort and must never fail the business action.
  if p_user is null or not exists(select 1 from auth.users where id = p_user) then
    return null;
  end if;
  if p_kind is null or p_kind not in ('payment','credits','project','marketplace','system')
    or p_title is null or char_length(btrim(p_title)) not between 1 and 120
    or p_body is null or char_length(btrim(p_body)) not between 1 and 500
    or p_href is null or (p_href <> '' and (p_href not like '/%' or p_href like '//%' or char_length(p_href) > 300))
    or (p_dedupe is not null and char_length(p_dedupe) not between 1 and 200) then
    raise exception 'NOTIFY_INVALID';
  end if;
  insert into public.notifications(user_id, kind, title, body, href, dedupe_key)
  values (p_user, p_kind, btrim(p_title), btrim(p_body), p_href, p_dedupe)
  on conflict (user_id, dedupe_key) do nothing
  returning id into created;
  return created;
end $$;

create function public.piwu_notifications(p_user uuid, p_limit integer default 20)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare items jsonb; unread integer;
begin
  if p_user is null or not public.piwu_user_active(p_user) then
    raise exception 'NOTIFY_FORBIDDEN' using errcode = '42501';
  end if;
  if p_limit is null or p_limit not between 1 and 50 then
    raise exception 'NOTIFY_INVALID';
  end if;
  select count(*)::integer into unread from public.notifications where user_id = p_user and read_at is null;
  select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) into items from (
    select id, kind, title, body, href, (read_at is not null) read, created_at
    from public.notifications
    where user_id = p_user
    order by created_at desc, id desc
    limit p_limit
  ) r;
  return jsonb_build_object('items', items, 'unread', unread);
end $$;

create function public.piwu_notification_read(p_user uuid, p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_user is null or not public.piwu_user_active(p_user) then
    raise exception 'NOTIFY_FORBIDDEN' using errcode = '42501';
  end if;
  update public.notifications set read_at = coalesce(read_at, now())
    where id = p_id and user_id = p_user;
  if not found then raise exception 'NOTIFY_NOT_FOUND'; end if;
end $$;

create function public.piwu_notification_read_all(p_user uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare changed integer;
begin
  if p_user is null or not public.piwu_user_active(p_user) then
    raise exception 'NOTIFY_FORBIDDEN' using errcode = '42501';
  end if;
  update public.notifications set read_at = now()
    where user_id = p_user and read_at is null;
  get diagnostics changed = row_count;
  return changed;
end $$;

revoke all on function public.piwu_notification_add(uuid,text,text,text,text,text),
  public.piwu_notifications(uuid,integer),
  public.piwu_notification_read(uuid,uuid),
  public.piwu_notification_read_all(uuid) from public, anon, authenticated;
grant execute on function public.piwu_notification_add(uuid,text,text,text,text,text),
  public.piwu_notifications(uuid,integer),
  public.piwu_notification_read(uuid,uuid),
  public.piwu_notification_read_all(uuid) to service_role;
commit;
