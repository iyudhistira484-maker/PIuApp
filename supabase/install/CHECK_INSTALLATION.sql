-- PEMERIKSAAN READ-ONLY. Aman diulang; jalankan di SQL Editor sebagai operator database.
-- Marker bukan bukti histori migration/checksum atau keberhasilan layanan produksi.
-- Tinjau hasil berbeda/hilang; jangan menghapus data atau mengulang installer baru.
begin transaction read only;

-- 1. Marker tiap tahap: sebagian objek penting, bukan seluruh isi migration.
with markers(migration,table_name,function_signature) as (values
 ('001','public.projects',null::text),('001','public.collaborators',null),
 ('002','public.project_workspaces','public.piwu_save_workspace(uuid,jsonb,bigint)'),
 ('003','public.payment_orders','public.piwu_apply_payment(uuid,integer,text,text)'),
 ('004','public.project_datasets','public.piwu_save_dataset(uuid,uuid,text,jsonb,jsonb,bigint)'),
 ('005','public.platform_admins','public.piwu_admin_action(uuid,uuid,text,uuid,jsonb,text)'),
 ('006','public.studio_bridges',null),
 ('007','public.runtime_rate_buckets','public.piwu_take_rate(text,integer,integer)'),
 ('007','public.runtime_sandbox_slots','public.piwu_sandbox_slot(uuid,uuid,uuid,boolean)'),
 ('008',null,'public.piwu_admin_users(uuid,text,integer)'),
 ('009','public.runtime_search_cache',null),
 ('010','public.credit_lots','public.piwu_claim_daily(uuid)'),
 ('010',null,'public.piwu_credit_status(uuid)'),
 ('011',null,'public.piwu_admin_delete_account(uuid,uuid,uuid,jsonb,text)'),
 ('012','public.notifications','public.piwu_notifications(uuid,integer)'),
 ('013','public.marketplace_payouts','public.piwu_request_payout(uuid,integer,text,text)'),
 ('013',null,'public.piwu_purge_seller_pii(uuid)'),
 ('014','public.marketplace_disputes','public.piwu_dispute_open(uuid,uuid,text,text)'),
 ('015',null,'public.piwu_dispute_outcomes()'),
 ('016','public.project_api_keys','public.piwu_app_request(text,uuid,text,jsonb)')
)
select migration,
  case when bool_and((table_name is null or to_regclass(table_name) is not null)
    and (function_signature is null or to_regprocedure(function_signature) is not null))
    then 'MARKER_TERDETEKSI' else 'BELUM_LENGKAP' end as status
from markers group by migration order by migration;

-- 2. Semua tabel PiwuApp wajib ada dan RLS aktif (tidak menguji isi tiap policy).
with required(name) as (values
 ('public.users'),
 ('public.projects'),
 ('public.collaborators'),
 ('public.project_files'),
 ('public.messages'),
 ('public.plans'),
 ('public.versions'),
 ('public.project_memory'),
 ('public.prompts'),
 ('public.model_settings'),
 ('public.comments'),
 ('public.session_recordings'),
 ('public.env_vars'),
 ('public.deployments'),
 ('public.analytics_events'),
 ('public.templates'),
 ('public.referrals'),
 ('public.subscriptions'),
 ('public.scan_reports'),
 ('public.usage'),
 ('public.project_workspaces'),
 ('public.project_invites'),
 ('public.credit_accounts'),
 ('public.credit_ledger'),
 ('public.credit_reservations'),
 ('public.payment_orders'),
 ('public.webhook_receipts'),
 ('public.referral_codes'),
 ('public.template_entitlements'),
 ('public.marketplace_sales'),
 ('public.project_sites'),
 ('public.publish_jobs'),
 ('public.recording_shares'),
 ('public.asset_records'),
 ('public.hosting_cleanup_jobs'),
 ('public.project_datasets'),
 ('public.platform_admins'),
 ('public.platform_user_controls'),
 ('public.platform_project_controls'),
 ('public.site_configuration'),
 ('public.platform_broadcasts'),
 ('public.broadcast_reads'),
 ('public.platform_audit'),
 ('public.studio_bridges'),
 ('public.runtime_rate_buckets'),
 ('public.runtime_sandbox_slots'),
 ('public.seller_verifications'),
 ('public.marketplace_payouts'),
 ('public.marketplace_disputes'),
 ('public.project_api_keys')
)
select r.name as object,
  case when c.oid is null then 'TABEL_BELUM_ADA'
    when not c.relrowsecurity then 'PERIKSA_RLS'
    else 'OK' end as status,
  (select count(*) from pg_policy p where p.polrelid=c.oid) as policy_count
from required r left join pg_class c on c.oid=to_regclass(r.name) order by r.name;
-- Nol policy wajar pada tabel service-only: browser tidak boleh mengaksesnya.

-- 3. RPC penting: anon ditolak, authenticated hanya untuk RPC workspace/dataset.
with required(signature,browser_allowed) as (values
 ('public.piwu_list_workspaces()',true),
 ('public.piwu_save_workspace(uuid,jsonb,bigint)',true),
 ('public.piwu_delete_workspace(uuid,bigint)',true),
 ('public.piwu_save_dataset(uuid,uuid,text,jsonb,jsonb,bigint)',true),
 ('public.piwu_delete_dataset(uuid,uuid,bigint)',true),
 ('public.piwu_admin_action(uuid,uuid,text,uuid,jsonb,text)',false),
 ('public.piwu_admin_delete_account(uuid,uuid,uuid,jsonb,text)',false),
 ('public.piwu_notifications(uuid,integer)',false),
 ('public.piwu_notification_read(uuid,uuid)',false),
 ('public.piwu_notification_read_all(uuid)',false),
 ('public.piwu_admin_users(uuid,text,integer)',false),
 ('public.piwu_take_rate(text,integer,integer)',false),
 ('public.piwu_sandbox_slot(uuid,uuid,uuid,boolean)',false),
 ('public.piwu_reserve_credits(uuid,uuid,integer,text)',false),
 ('public.piwu_finish_credits(uuid,boolean)',false),
 ('public.piwu_apply_payment(uuid,integer,text,text)',false),
 ('public.piwu_claim_publish()',false),
 ('public.piwu_dispute_open(uuid,uuid,text,text)',false),
 ('public.piwu_dispute_reply(uuid,uuid,text)',false),
 ('public.piwu_dispute_withdraw(uuid,uuid)',false),
 ('public.piwu_dispute_review(uuid,uuid,uuid,text,text)',false),
 ('public.piwu_seller_balance(uuid)',false),
 ('public.piwu_app_key_create(uuid,uuid,uuid,text,text,text)',false),
 ('public.piwu_app_key_list(uuid,uuid)',false),
 ('public.piwu_app_key_revoke(uuid,uuid,uuid)',false),
 ('public.piwu_app_request(text,uuid,text,jsonb)',false)
), checks as (
 select *,to_regprocedure(signature) as fn from required
)
select signature as object,
 case when fn is null then 'RPC_BELUM_ADA'
      when has_function_privilege('anon',fn,'EXECUTE') then 'PERIKSA_AKSES_ANON'
      when has_function_privilege('authenticated',fn,'EXECUTE') is distinct from browser_allowed then 'PERIKSA_AKSES_AUTHENTICATED'
      when not browser_allowed and not has_function_privilege('service_role',fn,'EXECUTE') then 'PERIKSA_AKSES_SERVICE_ROLE'
      else 'OK' end as status
from checks order by signature;

-- 4. Status bucket tanpa membaca file/object pengguna.
select 'storage.project-assets' as object,
 case when not exists(select 1 from storage.buckets where id='project-assets') then 'BUCKET_BELUM_ADA'
      when exists(select 1 from storage.buckets where id='project-assets' and public) then 'PERIKSA_BUCKET_PUBLIK'
      else 'OK' end as status;

-- 5. Hanya jumlah admin; tidak menampilkan email/identitas.
do $check_admin$
declare admins integer;
begin
 if to_regclass('public.platform_admins') is null then
   raise notice 'ADMIN_BELUM_DISIAPKAN: migration 005 belum tersedia';
 else
   execute 'select count(*) from public.platform_admins where role = ''superadmin''' into admins;
   raise notice 'Jumlah superadmin: %. Jika nol, buat akun terverifikasi lalu jalankan BOOTSTRAP_FIRST_ADMIN.sql.',admins;
 end if;
end $check_admin$;
commit;
