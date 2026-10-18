-- JALANKAN TERPISAH, setelah instalasi 001–010 dan setelah akun email terverifikasi dibuat.
-- SQL Editor Supabase, sebagai operator database tepercaya. Bukan lewat browser aplikasi.
-- Ganti SATU placeholder email di bawah secara lokal. Jangan commit email/kredensial pribadi.
-- Tidak membuat akun, tidak mengubah password, dan tidak melewati verifikasi email.
begin;
do $piwu_bootstrap$
declare
  admin_email text := 'GANTI_EMAIL_ADMIN_DI_SINI';
  target uuid;
  matches integer;
begin
  -- Same lock as piwu_admin_action: avoid concurrent role/bootstrap changes.
  perform pg_advisory_xact_lock(918273645);
  if position('@' in admin_email) = 0 then
    raise exception 'PIWU_EMAIL_REQUIRED: ganti placeholder dengan email akun Anda yang sudah terverifikasi';
  end if;
  if to_regclass('public.platform_admins') is null or to_regprocedure('public.piwu_admin_users(uuid,text,integer)') is null then
    raise exception 'PIWU_SETUP_REQUIRED: selesaikan migration 001–010 terlebih dahulu';
  end if;
  if exists(select 1 from public.platform_admins where role='superadmin') then
    raise exception 'PIWU_ADMIN_EXISTS: superadmin sudah ada. Kelola peran melalui panel admin; jangan ulang bootstrap';
  end if;
  select count(*), (array_agg(id))[1] into matches,target from auth.users
    where lower(email)=lower(trim(admin_email))
      and email_confirmed_at is not null and not coalesce(is_anonymous,false);
  if matches <> 1 then
    raise exception 'PIWU_VERIFIED_ACCOUNT_REQUIRED: harus ada tepat satu akun email non-anonim yang terverifikasi';
  end if;
  if not public.piwu_user_active(target) then
    raise exception 'PIWU_ACCOUNT_SUSPENDED: akun ditangguhkan; tinjau statusnya terlebih dahulu';
  end if;
  insert into public.platform_admins(user_id,role,granted_by)
    values(target,'superadmin',target)
    on conflict(user_id) do update set role=excluded.role,granted_by=excluded.granted_by;
  -- Bootstrap DBA does not use the app's admin mutation RPC; record an explicit audit event.
  insert into public.platform_audit(id,actor_id,action,target_id,reason,request_hash,result)
    values(gen_random_uuid(),target,'bootstrap_superadmin',target,
      'Bootstrap superadmin pertama melalui SQL Editor oleh operator database tepercaya.',
      'manual-bootstrap-first-admin',jsonb_build_object('role','superadmin','source','database_operator'));
end $piwu_bootstrap$;
commit;
select 'Superadmin pertama disiapkan. Login dengan akun yang sama, lalu buka /admin.' as hasil;
