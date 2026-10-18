-- Shared search cache. Apply after 001–008. Service role only: no browser access.
--
-- Why a table and not Redis: search results are already stored server-side, the
-- project already depends on Supabase, and a second instance that asks the same
-- question within 15 minutes must not pay the vendor twice. Without this
-- migration the app still works — it simply caches per process and says so in
-- the admin diagnostics endpoint.
begin;
create table if not exists public.runtime_search_cache (
  key text primary key,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists runtime_search_cache_expiry on public.runtime_search_cache(expires_at);
alter table public.runtime_search_cache enable row level security;
revoke all on public.runtime_search_cache from public, anon, authenticated;
grant select, insert, update, delete on public.runtime_search_cache to service_role;
commit;
