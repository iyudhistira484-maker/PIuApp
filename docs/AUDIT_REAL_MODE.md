# Audit perilaku nyata dan regresi — 15 Oktober 2026

## Kesimpulan

**Perbaikan kode dan pengujian lokal lulus; seluruh integrasi produksi belum terverifikasi.** Jalur aplikasi tidak boleh memberikan sukses palsu ketika provider tidak tersedia. Pemeriksaan langsung endpoint kesiapan berhasil, tetapi sebelas kapabilitas masih `not_configured` pada lingkungan ini. File `.env` tidak tersedia. Tidak ada kredensial yang direka ulang atau autentikasi yang dilewati.

Ini bukan pernyataan bahwa seluruh 13 tahap produk telah selesai, bebas semua bug, atau siap produksi. Selain aktivasi provider, beberapa fitur lanjutan memang belum diimplementasikan; lihat [STATUS.md](STATUS.md).

## Temuan dan perbaikan

| Area                | Perubahan                                                                                                                                                                                                                                                                                                                |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Pemulihan akun      | Form lupa/reset password memakai Supabase `resetPasswordForEmail` dan `updateUser`, event recovery mengarahkan ke halaman reset. Validasi sesi, konfirmasi password, busy state, dan kegagalan provider; tidak menampilkan berhasil saat update gagal.                                                                   |
| Navigasi            | Fragment URL yang tidak valid tidak lagi menjatuhkan aplikasi.                                                                                                                                                                                                                                                           |
| Dataset             | Panel Database tidak jatuh kembali ke database demo saat sesi/cloud tidak tersedia. Panel lokal lama yang tidak lagi digunakan dihapus; data project pengguna tidak dihapus.                                                                                                                                             |
| Scaffold bisnis     | Template baru tidak lagi berisi omzet, pelanggan, pesanan, produk, kontak contoh atau keranjang/like yang hanya menaikkan angka. Diganti keadaan kosong/belum terhubung. Navigasi bagian tetap berfungsi. Ini belum merupakan backend POS/toko.                                                                          |
| Ekspor scaffold web | Manifest memuat perintah dan dependency Vite yang diperlukan. Nama project di-escape untuk JSX/HTML. `PIWU.md` menjelaskan bahwa scaffold bukan keluaran inference dan belum terhubung ke data bisnis. Project lama tidak ditimpa.                                                                                       |
| API dan skema       | Respons 204, JSON tidak valid, kegagalan koneksi, serta skema PostgREST yang belum tersedia ditangani eksplisit. Permintaan API memiliki batas waktu (lebih panjang untuk operasi sandbox/audit); timeout tidak dianggap bukti operasi server dibatalkan, dan pesan meminta pengguna memeriksa status sebelum mengulang. |
| Terminal/sandbox    | Operasi project diserialkan, startup menunggu respons HTTP, sesi gagal dibersihkan, manifest tidak diperbarui saat install gagal, lifecycle scripts npm tidak dijalankan otomatis. Ini belum membuktikan ketahanan quota/locking lintas instance server.                                                                 |
| Batas target native | Preview web, npm/shell web, Lighthouse, dan impor snapshot web tidak digunakan untuk Expo/Roblox. Guard tersedia di UI dan API. Native build tetap memerlukan toolchain target.                                                                                                                                          |
| Replay              | Roblox merender scene tervalidasi secara read-only, Expo menampilkan sumber/batas runtime, bukan iframe React palsu. Rekaman tetap snapshot project, bukan video layar. Error daftar share/penghapusan lokal dilaporkan; callback daftar share yang sudah tidak relevan diabaikan.                                       |
| Preferensi IDE      | Pembacaan ukuran panel tahan terhadap storage gagal/nilai invalid; lebar dibatasi dan penyimpanan dijaga. Tema Terang/Gelap seluruh IDE tetap dipertahankan.                                                                                                                                                             |
| Diagnostik          | Pemeriksaan kesiapan menambah marker skema dataset/admin/Studio. `npm run verify:readiness` memberikan laporan read-only yang disanitasi dan berbatas waktu, tanpa inference, transaksi, deployment, atau email.                                                                                                         |

Penyimpanan browser, geometri Three.js, canvas, riwayat, ekspor dan compiler preview lokal adalah fungsi nyata di browser—bukan pengganti Supabase/Roblox Studio/provider. Fixture dalam tes serta penanda impor/rejection cache demo lama tetap dipertahankan untuk pengujian dan perlindungan data. Tidak ada akun demo/login bypass baru.

## Bukti pengujian

| Pemeriksaan                            | Hasil dan batas bukti                                                                                                                                                |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit/integrasi lokal terakhir          | **75/75 lulus**, 60 kelompok top-level, 53,84 detik. Mencakup regresi scaffold/nama berbahaya, sandbox, storage, skema, layanan dan invariant keamanan.              |
| Suite browser lengkap                  | **56/56 lulus**, 3,6 menit, setelah perbaikan awal audit. Memakai fixture provider, bukan layanan produksi.                                                          |
| Regresi setelah perubahan scaffold     | **16/16 lulus**, 1,5 menit: workflows, project-kinds, real-mode, audit-fixes. Ini subset yang tumpang tindih dengan suite lengkap, bukan 16 pengujian unik tambahan. |
| Regresi setelah perubahan API terakhir | **9/9 lulus**, 41,5 detik: audit-fixes, services-ui, real-mode. Suite lengkap tidak diulang setelah perubahan terakhir ini.                                          |
| Build PiwuApp                          | `npm run build` **lulus**: TypeScript + Vite produksi; Vite 47,79 detik. Warning ukuran chunk Monaco masih ada, bukan error build.                                   |
| Build project hasil scaffold           | Scaffold dashboard benar-benar dibangun dengan Vite: **lulus**. Bukan bukti seluruh project buatan pengguna pasti bisa dibangun.                                     |
| Audit dependency                       | `npm audit --json`: **0 kerentanan diketahui** pada instalasi ini; bukan pentest atau jaminan bebas kerentanan.                                                      |
| Preview pengembangan                   | HTTP **200** pada port **3001**; API kesiapan terjangkau pada **3002**.                                                                                              |

Satu kegagalan unit pada putaran antara berasal dari sumber scaffold yang masih memuat literal tag nama project; escaping Unicode diperbaiki dan suite penuh terakhir lulus. Race pada tes navigasi recovery juga diperbaiki dengan menunggu halaman recovery selesai tampil.

Log lokal berada di `.artifacts/` (diabaikan Git, bukan artefak produksi):

- `audit-unit-final.log`
- `audit-browser-final.log`
- `audit-workflows-final.log`
- `audit-final-api-ui.log`
- `audit-build-final.log`
- `starter-build.log`
- `audit-dependencies.json`
- `live-readiness.json`

## Pemeriksaan langsung: belum aktif

Endpoint readiness menjawab, tetapi hasilnya:

| Kapabilitas                    | Status                                                             |
| ------------------------------ | ------------------------------------------------------------------ |
| Autentikasi, database, dataset | `not_configured`                                                   |
| Administrasi dan bridge Studio | `not_configured`                                                   |
| AI dan sandbox E2B             | `not_configured`                                                   |
| Publish/hosting                | dihapus 17 Okt 2026 (capability tidak ada)                         |
| Pembayaran                     | `not_configured`; mode konfigurasi `sandbox`, belum transaksi live |
| WhatsApp dan encrypted secrets | `not_configured`                                                   |

`liveVerified: false`. Probe koneksi/marker skema bukan pemeriksaan seluruh migration/RPC/RLS, inference, pengiriman email, penerimaan pembayaran, domain/SSL, atau eksekusi plugin Roblox Studio. Akun uji yang diminta sebelumnya belum dibuat/diundang. Pengujian browser memakai akun fixture terisolasi, bukan bukti akun tersebut ada di Supabase.

## Langkah yang masih diperlukan sebelum dinyatakan live

1. Pasang konfigurasi melalui environment deployment/secret manager, **bukan chat atau file project pengguna**. Aktifkan auth, redirect recovery/OAuth dan koneksi backend; ikuti [REAL_SERVICES.md](REAL_SERVICES.md) dan [CLOUD_SETUP.md](CLOUD_SETUP.md).
2. Tinjau dan terapkan migration `001`–`006` berurutan pada database tujuan, verifikasi RLS dengan dua akun/role berbeda, bootstrap admin secara eksplisit. Jalankan `npm run verify:readiness`; gunakan `-- --strict` bila ingin exit nonzero untuk layanan belum siap. Command ini tetap bukan sertifikasi live.
3. Uji akun sungguhan: daftar/login, email recovery, sinkronisasi dua sesi, konflik revisi, isolasi pengguna, akses Viewer, administrasi/broadcast. Pastikan email benar-benar diterima.
4. Aktifkan dan uji AI/E2B dengan izin biaya: inference, review/restore, command nyata, paket, restart/stop, Lighthouse dan cleanup. Belum ada inference atau sesi E2B berbayar yang dijalankan dalam audit ini.
5. Uji webhook pembayaran dan WhatsApp di staging (deploy/domain sudah dihapus dari produk). Perpindahan pembayaran ke mode live memerlukan konfigurasi dan acceptance tersendiri; jangan menganggap sukses sandbox sebagai transaksi produksi.
6. Pasang plugin di Roblox Studio sungguhan, verifikasi konflik/review/receipt/Undo. Jalankan Expo di toolchain/perangkat asli. Preview geometri browser tidak menjalankan Luau, physics atau Play Test.
7. Selesaikan yang masih terblokir/terbatas: signing & build APK/IPA di perangkat asli, mesh/terrain tingkat lanjut, verifikasi kanal/policy CRDT untuk Viewer, serta acceptance live untuk GitHub push, backend data aplikasi, payout/KYC, dan CRDT dua tab. GitHub OAuth/push, presence + CRDT, backend data aplikasi, dan alur payout/KYC sudah dibangun, tetapi belum diuji terhadap layanan live dari lingkungan ini.

Tidak ada migration live, deploy publik, transaksi, pesan massal, atau perubahan akun yang dilakukan oleh audit ini.
