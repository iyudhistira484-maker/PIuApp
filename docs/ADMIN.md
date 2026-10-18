# Administrasi platform PiwuApp

Panel `/admin` mengelola platform, bukan panel admin aplikasi yang dibuat pengguna. UI Bahasa Indonesia, lazy-loaded, responsif. Tanpa konfigurasi/peran, akses ditolak dengan status yang jelas. **Tidak ada pratinjau admin atau akun superadmin demo.**

## Aktivasi aman

1. Backup database dan uji pada Supabase staging.
2. Terapkan migration **001 → … → 016**, sekali dan berurutan. 007 menyediakan koordinasi runtime produksi; 008 menyediakan pencarian direktori akun; 010 kredit berbasis lot; 011 penghapusan akun dari panel; 013 verifikasi penjual dan payout marketplace. Notifikasi per akun ada di 012. Migration 005 bersifat transaksional dan membungkus RPC workspace lama; jangan jalankan ulang atau melewati 004.
3. Atur `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, dan `SUPABASE_SERVICE_ROLE_KEY` di environment yang sesuai. Service role **hanya server**, jangan gunakan prefix `VITE_`.
4. Daftarkan akun admin melalui autentikasi biasa dan verifikasi email. Supabase Auth tetap menjadi mekanisme login; tidak ada password admin bawaan.
5. Operator database tepercaya menjalankan [`BOOTSTRAP_FIRST_ADMIN.sql`](../supabase/install/BOOTSTRAP_FIRST_ADMIN.sql) di SQL Editor/database, **bukan browser, endpoint publik, atau chat**. Ganti placeholder email hanya pada salinan di SQL Editor. Script menolak akun anonymous/belum terverifikasi/ditangguhkan serta superadmin yang sudah tersedia. Ikuti [panduan pemasangan SQL](../supabase/README.md) untuk membedakan database baru dan upgrade.

6. Login dengan akun tersebut, lalu buka `/admin`. Dashboard menampilkan tautan **Administrasi** hanya setelah server mengonfirmasi peran. Akun biasa tetap ditolak meskipun membuka URL langsung atau mengubah metadata/profile browser.
7. Simpan bukti bootstrap sesuai prosedur audit database organisasi. Script bootstrap yang disediakan tidak melewati RPC aplikasi, tetapi **mencatat event `bootstrap_superadmin` secara atomik**. SQL manual di luar script tidak otomatis diaudit. Pisahkan akses database/service key dari operator konten; aktifkan MFA sesuai kebijakan Supabase/deployment.

## Peran

| Tindakan                                                 | Auditor | Operator | Superadmin |
| -------------------------------------------------------- | ------- | -------- | ---------- |
| Ringkasan, daftar pengguna/transaksi, operasional, audit | Baca    | Baca     | Baca       |
| Broadcast, moderasi template, kunci project              | —       | Ya       | Ya         |
| Cabut tautan rekaman                                     | —       | Ya       | Ya         |
| Rekonsiliasi status pembayaran ke provider               | —       | Ya       | Ya         |
| Tangguhkan/hapus akun, sesuaikan kredit, hapus project   | —       | —        | Ya         |
| Konfigurasi situs/layanan dan peran admin                | —       | —        | Ya         |

Peran berasal dari `platform_admins`, tidak dari `user_metadata`. JWT diverifikasi ke Supabase Auth di server. Mutasi memeriksa ulang peran di database; pencabutan peran tidak bergantung pada login ulang. Superadmin terakhir tidak boleh dicabut/diturunkan. Cabut peran admin terlebih dahulu sebelum menangguhkan atau menghapus akun tersebut. Akun sendiri tidak dapat dihapus dari panel.

## Cakupan panel

- **Pengguna:** daftar akun Auth, identitas, status verifikasi/penangguhan, saldo, peran. Saldo awal tetap mengikuti ledger layanan. Penyesuaian ±10.000 kredit per tindakan; hasil negatif ditolak. **Hapus akun** (superadmin) meminta UUID pengguna diketik ulang dan alasan 8–500 karakter: project miliknya beserta turunannya, prompt, pengaturan, undangan, komentar, referral, bridge Studio, dan slot sandbox dihapus; template diarsipkan agar pembeli tetap memiliki akses; profil publik menjadi “Akun dihapus”. Invoice, ledger kredit, entitlement, penjualan marketplace, dan audit **tetap disimpan** (hanya berisi UUID, tanpa email). Server mengganti email Auth dengan `deleted+<uuid>@piwu.invalid` lalu soft-delete, sehingga akun tidak dapat masuk dan email asli bebas didaftarkan kembali. Ini bukan erase fisik atas backup/log provider; atur retensi di luar aplikasi.
- **Project:** metadata, pemilik, kunci/buka kunci, hapus permanen dengan konfirmasi UUID. Panel tidak membuka file, secrets, atau seluruh snapshot kode pengguna.
- **Transaksi:** riwayat pesanan dan rekonsiliasi berdasarkan respons provider asli. Tidak ada tombol “tandai lunas” secara manual. PiwuApp tidak menyediakan refund: tidak ada tombol atau endpoint pengembalian dana. Payout/KYC punya antrean tinjauan sendiri.
- **Verifikasi penjual & payout:** antrean di tab Marketplace menampilkan pengajuan KYC dan permintaan payout yang masih terbuka. Auditor hanya membaca; superadmin menyetujui/menolak KYC dan menyetujui, menandai dibayar, atau menolak payout. Status `paid` wajib referensi transfer 4–120 karakter; penolakan wajib catatan ≥8 karakter. Saldo yang ditahan sejak permintaan dilepas saat ditolak. Saat akun dihapus, KYC dan sengketa yang melibatkan akun itu dihapus, dan tujuan transfer diarsipkan sebagai `[dihapus]` oleh `piwu_purge_seller_pii`; jumlah/status/referensi payout tetap untuk catatan keuangan. Uang ditransfer di luar PiwuApp — panel hanya mencatat keputusan dan referensi; tidak ada verifikasi rekening, dokumen KYC, pajak, atau disbursement otomatis. Tab yang sama juga memuat **sengketa marketplace**: pembeli melapor sekali per pesanan dalam 30 hari, penjual membalas sekali, superadmin memilih **tutup laporan** atau **tolak**. Transaksi tidak dapat direfund dan panel tidak memindahkan uang: bagian penjual ditahan selama laporan belum selesai, lalu dilepas saat laporan ditutup/ditolak/ditarik.
- **Marketplace:** arsipkan/tayangkan template. Harga, revenue ledger, dan entitlement tetap mengikuti sistem layanan. Moderasi manual, bukan pemindaian konten otomatis.
- **Operasional:** kesiapan konfigurasi, kuota/rate sandbox, dan 30 recording share terbaru. Antrean publish/cleanup dan aksinya dihapus 17 Oktober 2026 karena PiwuApp tidak menghosting hasil build. Token share, secret, dan snapshot build tidak ditampilkan.
- **Pengaturan situs:** judul/deskripsi hero, email dukungan, mode pemeliharaan, sakelar AI/sandbox/checkout/marketplace/**Roblox Studio bridge**, serta **harga dan kredit paket** Pro, Team, dan dua top-up. Harga/kredit yang disimpan langsung dipakai checkout, halaman `/upgrade`, dan kartu landing; label top-up ikut menyesuaikan jumlah kreditnya. Nilai disimpan di dalam `enabled_services.plan_overrides` karena `piwu_admin_action()` (migration 005) hanya mengizinkan kunci level atas yang sudah ada — tanpa migration baru. Server menolak simpanan yang membuat Team memberi kredit tidak lebih banyak dari Pro, atau harga per kredit paket/top-up besar lebih mahal daripada paket kecilnya. Jatah harian, plafon Free, masa berlaku lot, batas foto (12 × 16 MB), dan biaya operasi ditampilkan sebagai **batas read-only** karena ditegakkan database/server, bukan pengaturan panel.
- **Administrator dan audit:** berikan/cabut peran dengan UUID pengguna, alasan, identitas aktor, target dan waktu. Daftar menggunakan pagination 25 data dengan pencarian server, filter status/tanggal/pelaku yang relevan dan urutan waktu + ID stabil. Ekspor CSV hanya halaman yang dimuat, bukan semua data, serta melindungi formula spreadsheet.

## Diagnostik dan pemeriksaan terbaru

Tab **Diagnostik** melakukan probe read-only layanan serta marker skema koordinasi, menampilkan mode rate limit/routing sandbox, dan menyediakan laporan JSON tanpa key. Hasil probe tidak membuktikan inference, transaksi, perangkat atau pentest berhasil. Form filter tetap dapat diubah saat backend gagal; region tabel bisa difokuskan/digulir lewat keyboard.

Laporan pengujian, batas multi-instance, dan temuan dependency native: [ADMIN_PRODUCTION_VERIFICATION.md](ADMIN_PRODUCTION_VERIFICATION.md).

## Broadcast in-app

- Judul 1–120 karakter, isi 1–4.000 karakter, teks biasa (bukan HTML yang dieksekusi).
- Audiens: **publik**, **semua member**, **Pro**, atau **Team**. Segmen paket berdasarkan langganan aktif dengan periode berlaku di database; bukan nilai plan di local storage. Pro dan Team merupakan segmen terpisah.
- Status: draf, dipublikasikan, diarsipkan. Pilih dipublikasikan + waktu mulai di masa depan untuk menjadwalkan; draf tidak pernah muncul di feed.
- Waktu input memakai zona lokal perangkat, dikirim sebagai UTC. Waktu mulai inklusif; akhir eksklusif dan harus setelah mulai. Penjadwalan dievaluasi database saat feed dibaca, bukan scheduler email.
- Feed maksimal 20 pengumuman aktif terbaru. `/api/public/site` **selalu** memakai identitas `null`, tidak menerima audience/user ID dari browser. Endpoint member mengambil identitas dari JWT.
- Pengumuman tampil pada beranda dan dashboard. Refresh saat mount/pergantian akun, lalu polling tiap 60 detik ketika tab terlihat. Sesi pengguna lama tidak ditampilkan ke akun baru.
- **Tandai dibaca** merupakan konfirmasi eksplisit member, unik per pesan/pengguna. Angka bukan jumlah terkirim, impression anonim, atau reach seluruh penerima. Pengeditan pesan yang sama mempertahankan read receipts; buat pesan baru bila membutuhkan konfirmasi ulang.
- Tidak mengirim email massal, WhatsApp broadcast, atau push notification. Kanal tersebut membutuhkan provider, consent/opt-out, template, antrean delivery, dan pelacakan kegagalan terpisah.

## Kontrol, audit, dan konsekuensi operasional

- Semua mutasi membutuhkan alasan 8–500 karakter dan UUID permintaan. Action/payload menggunakan whitelist Zod; actor berasal dari server. SQL `piwu_admin_action` hanya dapat dijalankan service role.
- SQL mengunci transaksi administrasi, memvalidasi peran terbaru, menyimpan hasil + hash permintaan dan audit secara atomik. Pengulangan request identik tidak menambah kredit dua kali. Mengubah isi dengan ID sama ditolak. Rekonsiliasi pembayaran menyimpan hasil sebelumnya agar retry tidak berubah mengikuti status provider baru; gunakan permintaan baru untuk pemeriksaan selanjutnya.
- Form mempertahankan UUID untuk retry tanpa perubahan. Menutup form atau mengubah input membuat permintaan baru. Jika respons hilang, periksa audit sebelum membuat tindakan baru. Audit aplikasi bukan log kebal perubahan oleh pemilik database.
- Broadcast/settings memakai optimistic revision; stale update ditolak, bukan menimpa diam-diam.
- Penangguhan diperiksa API dan restrictive RLS pada tabel saat migration 005 diterapkan. Workspace SECURITY DEFINER RPC juga dibungkus agar JWT lama tidak melewati pemeriksaan. Tabel baru pada migration berikutnya harus diberi kebijakan setara.
- Kunci project menghentikan mutasi workspace/dataset dan API project. Membaca/mengekspor data yang diizinkan tetap tersedia. Ini tidak menghapus salinan yang sudah diunduh atau data lokal browser.
- Pemeliharaan memblokir penulisan workspace/dataset dan mutasi layanan baru. Admin, callback pembayaran, dan pengumuman tetap dapat berjalan. Beberapa data privat lokal/preferensi tetap dapat diedit offline; sinkronisasi cloud ditolak sampai dibuka kembali.
- Pekerjaan build/sandbox memeriksa suspension/project lock sebelum berjalan. Request eksternal yang sudah berjalan bisa tetap selesai; tidak ada klaim cancellation/exactly-once provider. Hosting, unpublish, dan cleanup dihapus 17 Oktober 2026.
- Hapus project menolak build berjalan dan mengembalikan reservasi kredit job queued dalam transaksi sebelum cascade delete. Penghapusan permanen; backup terlebih dahulu.
- Pada produksi, skema suspension/lock/settings yang hilang memblokir operasi (fail-closed). Development mempertahankan kompatibilitas deployment bertahap. Terapkan 001–016 dan verifikasi hak RPC/RLS sebelum mengandalkan kontrol admin.

## Pengujian dan checklist staging

Lokal: migration 001–016 dieksekusi PGlite, termasuk role forgery, service-only RPC, last-superadmin, idempotensi/kredit, CAS, audience/jadwal/expiry/read receipts, suspension/RLS, workspace regression, penghapusan akun (konfirmasi UUID, penolakan akun admin/diri sendiri, data pribadi vs baris keuangan/audit) dan hosting cleanup. API memakai fixture Auth/PostgREST terkontrol. Browser menguji pratinjau mobile, navigasi seluruh bagian, axe WCAG A/AA ringkasan, form broadcast + retry, pembatasan role, pengumuman plain text, antrean payout (referensi transfer wajib untuk status dibayar), dan keputusan sengketa.

Sebelum produksi, uji **Supabase asli** dengan empat akun (superadmin/operator/auditor/member), akses REST langsung, role revocation, suspension, payment provider sandbox, worker terpisah/restart, dan kegagalan jaringan. Uji jadwal saat pergantian hari/zona waktu, expiry paket dan broadcast, serta anggota yang login/logout. Pantau audit, atur retention/backup, dan batasi akses infrastruktur.

Pengujian lokal bukan bukti provider live, penetration test, atau seluruh situs memenuhi aksesibilitas.

## Ketahanan landing saat database tidak tersedia

`GET /api/public/site` hanya memasok konten tampilan publik. Jika Supabase gagal dijangkau atau migration belum tersedia, endpoint mengembalikan konten bawaan (atau konfigurasi publik terakhir yang berhasil dibaca oleh proses server), daftar broadcast kosong, dan metadata `availability`, `issue`, `source`. HTTP 200 pada endpoint ini **bukan bukti database sehat**; periksa `availability: ready` dan `source: live`.

Query publik dibatasi 3 detik per tahap. Permintaan bersamaan digabung, lalu kegagalan diberi jeda retry 30 detik agar tidak membanjiri database. Broadcast tidak disimpan sebagai fallback agar pesan yang kedaluwarsa/dicabut tidak diputar ulang. Restart server menghapus cache konfigurasi terakhir.

Landing tetap memakai copy bawaan/terakhir tanpa banner error global yang berulang. Frontend mencoba ulang setiap 60 detik saat tab terlihat, membatasi waktu permintaan, dan tidak menumpuk request. Endpoint publik tidak menunggu/mengirim sesi Auth browser. Kegagalan pengumuman member masih dapat ditampilkan di dashboard akun.

Fallback ini **tidak digunakan untuk pemeriksaan role, suspension, maintenance, pembayaran, atau mutasi admin**. Jalur tersebut tetap menolak ketika status database tidak dapat diverifikasi. Ini perbaikan ketahanan tampilan, bukan perbaikan konektivitas Supabase atau bukti migration sudah diterapkan.
