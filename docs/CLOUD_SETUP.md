# Cloud workspace — konfigurasi dan perilaku

## Yang sudah diimplementasikan

- Workspace demo dipisahkan dari cache setiap akun Supabase. Pergantian akun dan logout mengganti daftar project serta prompt pribadi.
- Email/password dan Google menggunakan Supabase Auth. Session bootstrap juga berjalan ketika membuka URL project secara langsung.
- Repository Supabase menyimpan satu **snapshot workspace** secara atomik: metadata project, file, percakapan notebook, rencana, riwayat, dan komentar lokal. `project_files` serta `project_memory` diperbarui dalam transaksi yang sama.
- Snapshot disimpan di `project_workspaces`. Pesan/komentar di snapshot adalah konten yang bisa diedit user, **bukan bukti identitas, catatan audit tepercaya, atau ledger penggunaan**. Tabel `messages` belum menjadi sumber notebook; komentar cloud sekarang memakai tabel `comments` melalui service API migration 003.
- Autosave antrean tunggal setelah jeda 1 detik. Daftar cloud diperiksa kembali setiap 60 detik, saat koneksi pulih, atau saat tab aktif; dengan fallback polling. Migration 003 menambahkan Realtime invalidation dan presence privat; lihat SERVICES_SETUP.md.
- Kegagalan koneksi tidak menandai project sebagai tersinkron. Edit tetap di cache lokal bila kapasitas penyimpanan tersedia. Jika browser penuh/diblokir, UI memperingatkan untuk mengunduh cadangan sebelum menutup halaman.
- Setiap save/delete membawa revisi yang diketahui. Server mengunci row dan menolak revisi lama. Tidak ada last-write-wins diam-diam.
- Konflik menyediakan **Simpan keduanya** (salinan baru milik akun) atau **Gunakan versi cloud** dengan persetujuan eksplisit untuk mengganti edit lokal. Cadangan JSON tersedia sebelum memutuskan.
- Project demo tidak pernah otomatis diunggah saat login. Pilih di **Penyimpanan → Impor dari demo**; ID baru dibuat dan demo asli tetap ada.
- Tab **Dibagikan ke saya** menampilkan membership Supabase yang ada. Viewer dapat melihat/mengekspor, Editor dapat mengedit, hanya Owner dapat menghapus. UI undangan email/link tersedia setelah migration 003 dan konfigurasi service API.

## Mengaktifkan di Supabase

1. Buat project staging Supabase. Terapkan **secara berurutan dan sekali saja** melalui migration runner/SQL Editor:
   - `supabase/001_schema.sql`
   - `supabase/002_workspace_sync.sql`
   - `supabase/003_services.sql` (layanan backend, ledger, invites, marketplace; tabel publish lama dibiarkan inert)
   - `supabase/004_project_data.sql` (dataset cloud privat; lihat PROJECT_DATA.md)
2. Migration 002 menambahkan `project_workspaces` dengan RLS dan RPC:
   - `piwu_list_workspaces()`
   - `piwu_save_workspace(p_id, p_payload, p_expected_revision)`
   - `piwu_delete_workspace(p_id, p_expected_revision)`
3. Migration 002 mencabut insert/update/delete langsung untuk `projects`, `project_files`, dan `project_memory` dari client. Gunakan RPC agar pemeriksaan revisi tidak dapat dilewati. Owner/Editor tetap dapat mengedit melalui RPC.
4. Isi `.env` lokal/deployment (jangan commit):
   ```dotenv
   VITE_SUPABASE_URL=https://project-anda.supabase.co
   VITE_SUPABASE_ANON_KEY=publishable-atau-anon-key-anda
   ```
   Ini adalah nilai publik yang memang digunakan SDK frontend. **Jangan memakai service-role key.**
5. Aktifkan provider email/Google dan daftarkan origin aplikasi pada redirect allowlist. Callback Google saat ini `/projects`. Konfigurasi OAuth provider dilakukan di dashboard layanan, bukan di chat.
6. Restart `npm run dev` setelah mengganti environment. Preview aplikasi tetap port **3001**, backend pengembangan port **3002**.
7. Buat dua akun staging, satu Owner dan satu anggota. Uji login, create/save/reload, akses lintas akun, dua tab dengan revisi bertabrakan, dan pencabutan membership.
8. Gunakan Layanan → Anggota untuk mengundang akun kedua. Backend juga memerlukan `SUPABASE_SERVICE_ROLE_KEY` server-only; jangan memberikannya kepada pengguna. Detail setup dan acceptance tersedia di [SERVICES_SETUP.md](SERVICES_SETUP.md).

## Batas saat ini

- Cache browser tidak terenkripsi dan bukan kontrol keamanan terhadap orang yang mengakses profil browser/perangkat yang sama. Jangan menyimpan data sensitif. Logout memisahkan UI tetapi mempertahankan cache akun untuk menghindari hilangnya edit offline.
- Prompt library, data tabel demo, preferences, dan salinan rekaman IndexedDB masih lokal. Berbagi rekaman, package install E2B, billing, serta komentar cloud memakai service API terpisah; bukan semua entitas dimasukkan dalam snapshot workspace.
- Maksimum payload 8 MB, 200 file, 256 KB per file, 50 snapshot riwayat. Browser dapat memiliki batas penyimpanan yang lebih rendah.
- Data yang sebelumnya tersimpan oleh versi awal dianggap demo lokal karena kepemilikannya belum terverifikasi. Migrasi tidak menebak pemilik atau mengunggah otomatis.
- Kebijakan delete yang gagal mengembalikan project ke daftar untuk ditinjau, bukan menyembunyikan kegagalan. Jika akses dicabut, cache yang sebelumnya bersih dihapus dari daftar aktif setelah pull berhasil; edit belum tersinkron menjadi konflik agar bisa dicadangkan.
- Backup JSON saat ini dapat diunduh, belum ada restore file JSON melalui UI. Kode executable dapat diekspor sebagai ZIP.
- OTP WhatsApp, undangan/email, presence Realtime, credit ledger, dan pembayaran sudah memiliki implementasi di migration 003/service API. Aktivasi dan uji live mengikuti SERVICES_SETUP.md.

## Pengujian

`npm test` menjalankan state/reconciliation/antrean dan PostgreSQL PGlite. Test database menyiapkan skema minimal `auth`/`storage`, role authenticated/anon, dan helper `auth.uid()`. Migration 001–004 dijalankan dalam suite terkait; hanya deklarasi extension `pgcrypto` dihilangkan karena PGlite memakai `gen_random_uuid()` bawaan PostgreSQL.

Teruji: CRUD atomik, mirrored files/memory, row-level access, Owner/Editor/Viewer/outsider, larangan eskalasi role, larangan akses ciphertext, larangan write billing, pencabutan akses, stale save/delete, validasi path/secret, dan cascade delete.

Tes browser baru memakai state fixture terkontrol untuk UI impor, konflik, dan Viewer; ini **bukan** bukti koneksi Supabase live. Belum ada kredensial Supabase yang dikonfigurasi dalam preview, jadi OAuth live, PostgREST, dan sinkronisasi antarperangkat lewat jaringan harus diverifikasi di staging.

## Administrasi platform

Terapkan `005_admin.sql` setelah 001–004 sebelum mengaktifkan `/admin`. Bootstrap superadmin dan uji suspension/roles/broadcast mengikuti [ADMIN.md](ADMIN.md). Migration 005 juga diuji di PGlite; koneksi Supabase live tetap harus diuji di staging.
