-- App data API: let a project's own app (web, mobile, Roblox) read and write
-- its tables with a revocable project key instead of a user session.
-- Apply once after 015. Keys are stored only as SHA-256 hashes; the plaintext
-- is returned once by the server and never persisted. Read-only is the default.
begin;
create table public.project_api_keys (
  id uuid primary key,
  project_id uuid not null references public.projects(id) on delete cascade,
  label text not null check (char_length(label) between 1 and 60 and label = btrim(label)),
  key_hash text not null unique check (key_hash ~ '^[0-9a-f]{64}$'),
  scope text not null default 'read' check (scope in ('read','write')),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
create index project_api_keys_project on public.project_api_keys(project_id, created_at desc);
alter table public.project_api_keys enable row level security;
revoke all on public.project_api_keys from public, anon, authenticated;
grant all on public.project_api_keys to service_role;
-- No browser policy: the table is service-only. The owner/editor talks to the
-- server, which returns metadata and (once) the plaintext key.

create function public.piwu_app_editor(p_project uuid, p_actor uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(
    select 1 from public.projects p where p.id = p_project and p.owner_id = p_actor
  ) or exists(
    select 1 from public.collaborators c
    where c.project_id = p_project and c.user_id = p_actor and c.role = 'Editor'
  )
$$;

create function public.piwu_app_key_create(
  p_actor uuid,
  p_project uuid,
  p_id uuid,
  p_label text,
  p_hash text,
  p_scope text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare active integer; created timestamptz;
begin
  if p_actor is null or not public.piwu_user_active(p_actor)
    or p_project is null or not public.piwu_app_editor(p_project, p_actor) then
    raise exception 'PIWU_APP_FORBIDDEN' using errcode = '42501';
  end if;
  if p_id is null or p_label is null
    or char_length(btrim(p_label)) not between 1 and 60
    or p_hash is null or p_hash !~ '^[0-9a-f]{64}$'
    or p_scope is null or p_scope not in ('read','write') then
    raise exception 'PIWU_APP_INVALID';
  end if;
  select count(*)::integer into active
    from public.project_api_keys
    where project_id = p_project and revoked_at is null;
  if active >= 5 then
    raise exception 'PIWU_APP_LIMIT';
  end if;
  insert into public.project_api_keys(id, project_id, label, key_hash, scope, created_by)
  values (p_id, p_project, btrim(p_label), p_hash, p_scope, p_actor)
  returning created_at into created;
  return jsonb_build_object(
    'id', p_id,
    'label', btrim(p_label),
    'scope', p_scope,
    'created_at', created
  );
end $$;

create function public.piwu_app_key_list(p_actor uuid, p_project uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  -- Any member may read key metadata; creating and revoking stay Owner/Editor.
  if p_actor is null or not public.piwu_user_active(p_actor) or p_project is null
    or not (
      exists (select 1 from public.projects p where p.id = p_project and p.owner_id = p_actor)
      or exists (select 1 from public.collaborators c where c.project_id = p_project and c.user_id = p_actor)
    ) then
    raise exception 'PIWU_APP_FORBIDDEN' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', id,
      'label', label,
      'scope', scope,
      'created_at', created_at,
      'last_used_at', last_used_at,
      'revoked', revoked_at is not null
    ) order by created_at desc
  ), '[]'::jsonb) into result
  from (
    select * from public.project_api_keys
    where project_id = p_project
    order by created_at desc
    limit 20
  ) keys;
  return result;
end $$;

create function public.piwu_app_key_revoke(p_actor uuid, p_project uuid, p_id uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if p_actor is null or not public.piwu_user_active(p_actor)
    or p_project is null or not public.piwu_app_editor(p_project, p_actor) then
    raise exception 'PIWU_APP_FORBIDDEN' using errcode = '42501';
  end if;
  update public.project_api_keys set revoked_at = now()
    where id = p_id and project_id = p_project and revoked_at is null;
  if not found then
    raise exception 'PIWU_APP_NOT_FOUND';
  end if;
  return true;
end $$;

-- One call per public request: authenticates the key, enforces the scope, and
-- runs a row operation on a table owned by that project.
-- Ops: tables | list | insert | update | delete.
create function public.piwu_app_request(
  p_hash text,
  p_table uuid,
  p_op text,
  p_payload jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  k public.project_api_keys%rowtype;
  d public.project_datasets%rowtype;
  v_rows jsonb;
  item jsonb;
  merged jsonb;
  out_rows jsonb;
  row_found boolean := false;
  i integer;
  created_id uuid;
begin
  if p_hash is null or p_hash !~ '^[0-9a-f]{64}$'
    or p_op is null or p_op not in ('tables','list','insert','update','delete') then
    raise exception 'PIWU_APP_KEY' using errcode = '42501';
  end if;
  select * into k from public.project_api_keys
    where key_hash = p_hash and revoked_at is null;
  if not found then
    raise exception 'PIWU_APP_KEY' using errcode = '42501';
  end if;
  if p_op in ('insert','update','delete') and k.scope <> 'write' then
    raise exception 'PIWU_APP_READONLY' using errcode = '42501';
  end if;
  -- Cheap touch so "last used" is useful without writing on every request.
  update public.project_api_keys set last_used_at = now()
    where id = k.id
      and (last_used_at is null or last_used_at < now() - interval '30 seconds');

  if p_op = 'tables' then
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', id,
      'name', name,
      'revision', revision,
      'rows', jsonb_array_length(rows)
    ) order by name), '[]'::jsonb) into out_rows
    from public.project_datasets where project_id = k.project_id;
    return jsonb_build_object('tables', out_rows);
  end if;

  if p_table is null then
    raise exception 'PIWU_APP_NOT_FOUND';
  end if;
  select * into d from public.project_datasets
    where id = p_table and project_id = k.project_id
    for update;
  if not found then
    raise exception 'PIWU_APP_NOT_FOUND';
  end if;
  if p_op = 'list' then
    return jsonb_build_object(
      'id', d.id, 'name', d.name, 'columns', d.columns,
      'rows', d.rows, 'revision', d.revision
    );
  end if;

  v_rows := d.rows;
  if p_op = 'insert' then
    if p_payload is null or jsonb_typeof(p_payload) <> 'object'
      or jsonb_typeof(p_payload->'rows') <> 'array'
      or jsonb_array_length(p_payload->'rows') < 1
      or jsonb_array_length(p_payload->'rows') > 50 then
      raise exception 'PIWU_DATA_INVALID';
    end if;
    if jsonb_array_length(v_rows) + jsonb_array_length(p_payload->'rows') > 1000 then
      raise exception 'PIWU_DATA_LIMIT';
    end if;
    for item in select value from jsonb_array_elements(p_payload->'rows') loop
      if jsonb_typeof(item) <> 'object'
        or exists(select 1 from jsonb_object_keys(item) kname where kname not in ('id','values'))
        or (item ? 'id' and jsonb_typeof(item->'id') <> 'string')
        or (item ? 'values' and jsonb_typeof(item->'values') <> 'object') then
        raise exception 'PIWU_DATA_INVALID';
      end if;
      if item ? 'id' and exists (
        select 1 from jsonb_array_elements(v_rows) r where r->>'id' = item->>'id'
      ) then
        raise exception 'PIWU_DATA_INVALID';
      end if;
      v_rows := v_rows || jsonb_build_array(jsonb_build_object(
        'id', coalesce(nullif(item->>'id', ''), gen_random_uuid()::text),
        'values', coalesce(item->'values', '{}'::jsonb)
      ));
    end loop;
  elsif p_op = 'update' then
    if p_payload is null or jsonb_typeof(p_payload) <> 'object'
      or jsonb_typeof(p_payload->'id') <> 'string'
      or jsonb_typeof(p_payload->'values') <> 'object' then
      raise exception 'PIWU_DATA_INVALID';
    end if;
    for i in 0 .. jsonb_array_length(v_rows) - 1 loop
      if v_rows->i->>'id' = p_payload->>'id' then
        merged := coalesce(v_rows->i->'values', '{}'::jsonb) || (p_payload->'values');
        v_rows := jsonb_set(v_rows, array[i::text, 'values'], merged);
        row_found := true;
      end if;
    end loop;
    if not row_found then
      raise exception 'PIWU_APP_NOT_FOUND';
    end if;
  else
    if p_payload is null or jsonb_typeof(p_payload) <> 'object'
      or jsonb_typeof(p_payload->'id') <> 'string' then
      raise exception 'PIWU_DATA_INVALID';
    end if;
    select coalesce(jsonb_agg(value), '[]'::jsonb) into v_rows
      from jsonb_array_elements(v_rows)
      where value->>'id' <> p_payload->>'id';
    if jsonb_array_length(v_rows) = jsonb_array_length(d.rows) then
      raise exception 'PIWU_APP_NOT_FOUND';
    end if;
  end if;

  perform public.piwu_validate_dataset(d.columns, v_rows);
  update public.project_datasets set
    rows = v_rows,
    revision = d.revision + 1,
    updated_by = k.created_by,
    updated_at = now()
  where id = d.id;
  return jsonb_build_object(
    'id', d.id, 'name', d.name, 'columns', d.columns,
    'rows', v_rows, 'revision', d.revision + 1
  );
end $$;

revoke all on function
  public.piwu_app_editor(uuid,uuid),
  public.piwu_app_key_create(uuid,uuid,uuid,text,text,text),
  public.piwu_app_key_list(uuid,uuid),
  public.piwu_app_key_revoke(uuid,uuid,uuid),
  public.piwu_app_request(text,uuid,text,jsonb)
from public, anon, authenticated;
grant execute on function
  public.piwu_app_editor(uuid,uuid),
  public.piwu_app_key_create(uuid,uuid,uuid,text,text,text),
  public.piwu_app_key_list(uuid,uuid),
  public.piwu_app_key_revoke(uuid,uuid,uuid),
  public.piwu_app_request(text,uuid,text,jsonb)
to service_role;
commit;
