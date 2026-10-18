# Jenis project

Pilih Web App / Aplikasi Mobile / Roblox Game melalui selector di dalam composer landing atau formulir Project baru. Pilihan disimpan ketika pengguna perlu login. Template web tetap membuat Web App; project lama tanpa `kind` tetap kompatibel.

- **Web App**: React/TypeScript/Vite; editor, iframe preview, canvas/design web, dan sandbox. Tidak ada hosting: kode keluar lewat Export ZIP.
- **Aplikasi Mobile**: scaffold Expo SDK 57 / React Native dengan `App.tsx`, entry `index.ts`, konfigurasi Expo dan TypeScript. `lib/piwu.ts` menyediakan klien API data project (migration 016): daftar tabel, baca, tambah, ubah, dan hapus baris, dengan `EXPO_PUBLIC_PIWU_API_URL`/`EXPO_PUBLIC_PIWU_PROJECT_ID`/`EXPO_PUBLIC_PIWU_KEY` yang diisi dari `env.example`. Nilai `EXPO_PUBLIC_*` tertanam di bundle APK/IPA, jadi scaffold menganjurkan **kunci baca saja**; penulisan sebaiknya lewat server operator. Ekspor ZIP → `npm install` → `npx expo start`; jalankan di Expo Go versi kompatibel/development build/perangkat. Browser tidak menampilkan simulator native palsu. EAS signing/build, QR tunnel otomatis, APK/IPA, dan distribusi toko belum disediakan. Runtime E2B/Vite dan hosting web ditolak untuk project native agar source tidak diam-diam dikonversi menjadi web.
- **Roblox Game**: Luau, Explorer layanan Studio, builder geometri/mesh dasar dan bridge plugin. Plugin v2.2.0 punya **sinkron langsung opt-in**: bundle yang sudah dikirim dari PiwuApp diterapkan otomatis dalam ~5 detik (default mati, kegagalan mematikan mode, script baru tetap Disabled). Baca ROBLOX.md untuk pairing, migration 006, batas instance/property, review dan konflik.

Backend AI menentukan target dari snapshot project terautorisasi, bukan parameter client. Instruksi model disesuaikan dengan React web / React Native / Luau. Ini tidak mengaktifkan provider AI yang belum terkonfigurasi, atau membuktikan bahwa kode hasil model sudah lolos pengujian perangkat/Studio.

## Verifikasi scaffold native terbaru

Scaffold baru memakai Expo SDK 57 dengan React/RN yang sesuai template resmi, hanya platform Android/iOS. Perintah web tanpa dependency web dihapus. Export Metro/Hermes dua platform dan TypeScript lulus, tetapi belum uji perangkat/Store build. Audit scaffold masih memiliki 15 paket terdampak advisory high transitif; jangan menyamakannya dengan audit dependency utama PiwuApp yang nol. Project lama tidak diperbarui otomatis. Rincian: [ADMIN_PRODUCTION_VERIFICATION.md](ADMIN_PRODUCTION_VERIFICATION.md).
