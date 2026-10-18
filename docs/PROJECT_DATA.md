# Tabel data project (migration 004)

Panel Database sekarang membedakan **demo lokal** dan **dataset cloud** secara eksplisit. Akun nyata tidak beralih diam-diam ke tabel demo ketika layanan gagal.

## Aktivasi

1. Terapkan migration 001–003, lalu `supabase/004_project_data.sql` sekali pada Supabase staging.
2. Konfigurasi Supabase frontend dan service API seperti SERVICES_SETUP.md. Masuk dengan akun terverifikasi dan sinkronkan project terlebih dahulu.
3. Buka workspace → Database. Buat tabel, tambahkan kolom/baris, lalu pilih **Simpan ke cloud**.

Data disimpan sebagai JSONB terstruktur di `project_datasets`, bukan membuat tabel PostgreSQL/DDL dari input pengguna. Dataset hanya untuk anggota workspace. Sejak migration 016, **aplikasi hasil build** dapat memakai tabel yang sama lewat kunci API per project (lihat bagian di bawah), bukan dengan membuka akses anon ke `project_datasets`.

## Fitur dan batas

- Tipe teks, angka, ya/tidak; nilai kosong diizinkan. Kunci kolom berupa huruf kecil/angka/underscore, diawali huruf.
- Maksimal 20 tabel per project, 32 kolom per tabel, 1.000 baris, 2 MB, dan 4.000 karakter per nilai teks. Angka dibatasi ±10^15; bukan tipe desimal uang presisi arbitrer.
- Owner/Editor membuat dan mengubah tabel, kolom serta baris. Viewer membaca/mengekspor saja. Hanya Owner menghapus seluruh tabel cloud; Editor tetap dapat mengubah atau menghapus isi baris/kolom.
- Semua save/delete menyertakan revisi. RPC mengunci data dan menolak revisi lama; tidak ada force-overwrite. Delete tidak dapat dibatalkan oleh stale save yang membuat ulang ID lama.
- Konflik mempertahankan draft. Pilih ekspor JSON, muat ulang cloud dengan konfirmasi, atau simpan sebagai tabel baru. Simpan-sebagai-baru tetap tunduk pada nama unik dan batas jumlah tabel.
- Draft disimpan di IndexedDB menurut akun/project/tabel. **Tidak terenkripsi**; akun terpisah dalam UI bukan kerahasiaan terhadap pemilik profil browser. Kegagalan storage/validasi menampilkan peringatan. Ekspor JSON sebelum keluar jika draft belum tersimpan di perangkat.
- Pergantian tabel mempertahankan draft yang valid. Reload memulihkan draft tanpa otomatis mengirimnya ke server. Tombol **Buang draft lokal** tidak menghapus data cloud.
- Impor JSON berformat `piwu-data-v1` membuat draft baru dengan ID tabel/baris baru. Tidak menggabungkan atau menimpa tabel cloud. CSV/SQL import belum tersedia.
- Daftar metadata diperiksa setiap 30 detik. Perubahan remote memberi peringatan; isi draft tidak diganti otomatis. Ini bukan CRDT atau sinkronisasi sel realtime.
- Dataset bukan bagian snapshot kode, versi AI, ZIP kode, template marketplace, atau recording. Ekspor JSON adalah cadangan terpisah; versi tabel historis dan restore cloud belum dibangun.

## Otorisasi

RLS melindungi SELECT. Direct INSERT/UPDATE/DELETE dicabut dari authenticated/anon. RPC `piwu_save_dataset` dan `piwu_delete_dataset` menggunakan `auth.uid()`, search_path tetap, pemeriksaan role, validasi JSON/tipe/ukuran, dan revision check. Service API memakai **JWT client milik pemanggil** untuk RPC, bukan service-role client. Identitas author tidak diterima dari body.

## Bukti pengujian

- PostgreSQL PGlite menjalankan migration 001–004, menguji Owner/Editor/Viewer/outsider, revocation, direct-write denial, stale save/delete, tipe/ukuran, cross-project adoption, dan cascade.
- API test memastikan parameter actor tidak diambil dari body, hasil RPC diminta sebagai satu object, dan penghapusan memerlukan Owner.
- Browser test menggunakan repository fixture untuk UI save, Viewer, konflik/save-as-new, kegagalan jaringan, dan pemisahan draft akun. Ini bukan bukti koneksi Supabase live.

Penggunaan nyata masih memerlukan acceptance staging pada Supabase, backup database, kebijakan retensi/penghapusan, dan pembatasan kapasitas per akun. Jangan menyimpan credential atau data sensitif di demo/cache browser.

## API data untuk aplikasi hasil build (migration 016)

Aplikasi web/mobile yang dibuat di PiwuApp dapat membaca dan menulis tabel project tanpa sesi Supabase pengguna akhir. Kuncinya dibuat Owner/Editor di panel Database → **API data untuk aplikasi Anda**, maksimal **lima kunci aktif per project**, masing-masing **baca saja** atau **baca & tulis**.

- **Plaintext sekali.** Server membuat `piwu_sk_` + 24 byte acak base64url, menyimpan **SHA-256**-nya di `project_api_keys.key_hash`, dan menampilkan nilai aslinya hanya pada respons 201. Daftar kunci tidak pernah memuat hash. Kunci yang hilang tidak bisa dipulihkan; buat kunci baru lalu cabut yang lama.
- **Cakupan sempit.** Kunci hanya memetakan ke satu project dan tabel dataset di dalamnya. Tidak ada akses ke file kode, storage, akun, marketplace, atau RPC lain. Hanya superadmin/service role yang dapat memanggil RPC; RLS aktif tanpa policy browser.
- **Cabut langsung.** `revoked_at` diperiksa setiap permintaan. Permintaan dengan kunci yang dicabut ditolak `APP_KEY_INVALID` (401). `last_used_at` diperbarui paling sering sekali per 30 detik agar tidak menulis di setiap GET.
- **Operasi.** `tables` (daftar + jumlah baris), `list` (satu tabel), `insert` (1–50 baris per permintaan), `update`, dan `delete`. Validasi memakai aturan dataset yang sama: 20 tabel/project, 32 kolom, 1.000 baris, 2 MB, 4.000 karakter, tipe `text`/`number`/`boolean` (teks, angka, ya/tidak). Payload yang salah ditolak seluruhnya, tidak ada penyimpanan sebagian.
- **Revisi tetap dinaikkan.** Setiap tulis menaikkan `revision` dan mengembalikan tabel terbaru, sehingga panel Database pengguna melihat konflik seperti biasa. Insert dengan ID yang sudah ada ditolak; ID baru dibuat server.
- **HTTP.** `GET /api/public/app/:projectId` (daftar tabel), `GET/POST /api/public/app/:projectId/:tableId`, `PATCH/DELETE /api/public/app/:projectId/:tableId/:rowId`; kunci lewat header `x-piwu-key` atau `Authorization: Bearer`. CORS `*` dan preflight dibuka **hanya** untuk prefix itu. Rate limit per IP: 120 baca/menit dan 60 tulis/menit; insert dibatasi 50 baris.
- **Kunci tulis di klien bukan rahasia.** Siapa pun yang membuka DevTools dapat membacanya. Pakai kunci baca saja di aplikasi web dan simpan kunci tulis di server milik pengguna. Di Roblox, `HttpService` hanya berjalan di Script server dan memerlukan HTTP aktif; kunci yang tertanam di place tetap dapat dibaca dari file place.
- **Belum ada.** Autentikasi pengguna akhir, izin per baris/kolom, kuota per kunci, webhook, realtime, dan audit per permintaan. Kunci tidak menggantikan RLS untuk anggota workspace; ia adalah jalur terpisah yang hanya menyentuh dataset project.

Contoh permintaan:

```sh
curl -H "x-piwu-key: piwu_sk_..." \
  "https://app.example/api/public/app/<projectId>/<tableId>"
```

```lua
local HttpService = game:GetService("HttpService")
local res = HttpService:RequestAsync({
  Url = "https://app.example/api/public/app/<projectId>/<tableId>",
  Method = "GET",
  Headers = { ["x-piwu-key"] = "<kunci>" },
})
local data = HttpService:JSONDecode(res.Body).table
print(data.name, #data.rows)
```

Bukti: `tests/app-data.test.ts` (PGlite 001–016: peran, hash, cakupan, isolasi project, pencabutan, batas lima kunci) dan `tests/app-data-api.test.ts` (HTTP: pembuatan kunci, kunci hanya tampil sekali, CORS/preflight, pemetaan galat, kunci baca tidak bisa menulis, kunci dicabut langsung gagal).
