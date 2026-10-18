# Checklist Rilis PiwuApp

> Daftar tindakan operator untuk membawa PiwuApp dari kode siap-tes ke produksi.
> Kode & QA sudah hijau (405/405 unit, 121/121 e2e, build + bundle OK); semua item
> di bawah adalah **aktifasi layanan eksternal + infrastruktur + verifikasi live**.
> Detail tiap layanan: [REAL_SERVICES.md](REAL_SERVICES.md), [SERVICES_SETUP.md](SERVICES_SETUP.md),
> [CLOUD_SETUP.md](CLOUD_SETUP.md), [ADMIN.md](ADMIN.md), [SECURITY.md](SECURITY.md).

Status probe saat dokumen ini ditulis: `liveVerified: false`, semua layanan
`not_configured`, `paymentMode: "sandbox"`. Jalankan `npm run verify:readiness`
setelah tiap blok untuk melihat pergeseran status.

---

## 0. Keputusan & prasyarat

- [ ] Pilih nama domain produksi dan daftarkan (mis. `api.piwuapp.example` + frontend).
- [ ] Pilih hosting yang bisa: menjalankan Node + Postgres, **sticky session per akun**, dan reverse proxy HTTPS.
      (Sandbox E2B mewajibkan setiap request akun pergi ke proses/replica yang sama.)
- [ ] Pilih provider pembayaran: **Midtrans** atau **Xendit** (isi salah satu saja; `PAYMENT_PROVIDER` memilihnya).
- [ ] Siapkan secret manager (env hosting / Vault / sbr.) — **jangan** simpan kunci di chat, source, atau file project pengguna.
- [ ] Siapkan budget kredit AI provider (biaya per operasi: chat Cepat 1 / Seimbang 3 / Kuat 8, Ask 1, Plan 2, riset 1, build/preview 2, audit 3).

## 1. Infrastruktur

- [ ] Reverse proxy **HTTPS** di depan `npm start` (frontend + API produksi, port 3001).
- [ ] **Sticky routing** per akun terautentikasi untuk jalur sandbox (semua replica menunjuk database yang sama).
- [ ] `RATE_LIMIT_MODE=database` — produksi memakai admission control Postgres (migration 007); mode memori ditolak.
- [ ] Isi `TRUST_PROXY_CIDRS` sesuai CIDR proxy Anda (rate limiting bergantung padanya; jangan trust-all).
- [ ] `APP_BASE_URL` = URL publik frontend (dipakai redirect pembayaran & link email).
- [ ] Postgres: terapkan skema — database baru pakai **satu file** `supabase/install/INSTALL_NEW_DATABASE.sql` (001–016 atomik);
      database lama jalankan migration yang belum diterapkan saja (jangan installer baru). Verifikasi `CHECK_INSTALLATION.sql`.

## 2. Supabase (auth + database) — blocker inti

- [ ] Buat project Supabase; salin `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` (anon/publishable, **bukan** service role) ke env frontend.
- [ ] `SUPABASE_SERVICE_ROLE_KEY` hanya di env **server** (jangan pernah di browser).
- [ ] Terapkan migrations 001–016 (lihat blok 1); pastikan `piwu_credit_status`, `piwu_credit_policy`, realtime publication (003) hadir.
- [ ] Aktifkan provider login di Supabase Auth (email dan/atau Google) + **redirect URL domain produksi** terdaftar.
- [ ] Bootstrap superadmin pertama via `BOOTSTRAP_FIRST_ADMIN.sql` (akun email terverifikasi, tanpa password bawaan). Lengkapi alur di [ADMIN.md](ADMIN.md).
- [ ] Uji login akun baru → buat project → "Tersinkron ke cloud" → buka di browser kedua, perubahan remote diterima tanpa menimpa draft.

## 3. AI (nilai utama produk)

- [ ] `LLM_BASE_URL` (endpoint kompatibel OpenAI, mis. `https://provider/v1`) + `LLM_API_KEY` (server-only).
- [ ] `LLM_MODEL` opsional (kosong = model pertama dari `/models`); override per tier `LLM_MODEL_CEPAT/SEIMBANG/KUAT` jika ingin.
- [ ] Verifikasi nyata: satu inference Ask, satu Plan, satu Builder pada project tersinkron — cek diff, versi sebelum/sesudah, **dan reserve/settlement kredit di ledger** (bukan hanya teks UI).
- [ ] Panel admin **AI & model** (baca-saja) menampilkan status provider & katalog kredit sama dengan UI.

## 4. Riset & pencarian (opsional)

- [ ] `SEARCH_PROVIDER` (`tavily`/`exa`/`brave`/`parallel`) + `SEARCH_API_KEY`. Tanpa kunci, mode riset 503 jujur (fail-closed) — boleh dibiarkan off.
- [ ] `npm run verify:search` → OK per provider yang diaktifkan.
- [ ] Uji manual: toggle Mode riset → pertanyaan butuh sumber → periksa panel Sumber, sitasi `[1]`, dan laporan kueri gagal.

## 5. Sandbox E2B (terminal & build nyata)

- [ ] `E2B_API_KEY` + `E2B_TEMPLATE` (template wajib berisi Node, npm, Chromium, Lighthouse CLI; bangun via `scripts/` bila perlu).
- [ ] Uji satu perintah shell nyata: output + exit code asli, perubahan file masuk lewat import snapshot.

## 6. Secrets (master key enkripsi)

- [ ] **Untuk produksi: generate key baru** 32 byte → 64 hex di secret manager (`openssl rand -hex 32` atau setara); isi `SECRETS_ENCRYPTION_KEY`.
      (Di sandbox ini sudah ada key dev di `.env` — gitignored; **jangan** dipakai apa adanya di produksi, dan jangan pernah menuliskannya di repo/chat.)
- [ ] Simpan cadangan key; rotasi tanpa rencana migrasi ciphertext = secret lama tak terbaca.
- [ ] Setelah db + key terisi, `verify:readiness` harus melaporkan `secrets: configured`.

## 7. Pembayaran (dari sandbox ke live)

- [ ] Pilih provider, isi kunci: Midtrans → `MIDTRANS_SERVER_KEY`; Xendit → `XENDIT_SECRET_KEY` + `XENDIT_WEBHOOK_TOKEN`.
- [ ] Jalankan **sandbox provider dulu**: verifikasi signature callback + **idempotency** webhook sebelum uang sungguhan.
- [ ] Uji satu transaksi sandbox per SKU (Pro / Team / top-up) → notifikasi, ledger kredit, status pesanan benar.
- [ ] Baru set `PAYMENT_LIVE=true` setelah sandbox lulus. Setelah live: landing & `/upgrade` otomatis menjual (sumber harga satu: produk server).
- [ ] Ingatkan kebijakan: **tidak ada refund** untuk transaksi apa pun; "dibatalkan penyedia" bukan refund.

## 8. Email & WhatsApp (opsional)

- [ ] Email undangan/pulihkan: `RESEND_API_KEY` + `EMAIL_FROM` (+ `APP_BASE_URL`).
- [ ] OTP SMS: `SUPABASE_SMS_HOOK_SECRET` + `WHATSAPP_TOKEN` + `WHATSAPP_PHONE_ID` + `WHATSAPP_TEMPLATE`.
- [ ] Tanpa keduanya aplikasi tetap jalan (notifikasi in-app muncul saat browser dibuka lagi).

## 9. Verifikasi sebelum buka ke publik

- [ ] `npm run build && npm run check:bundle` hijau.
- [ ] `npm run verify:production` (server produksi lokal :3201) — 11 smoke HTTP lulus.
- [ ] `npm run verify:readiness` → seluruh layanan `configured`/`configured_unverified`; lakukan **uji live** tiap layanan (probe bukan bukti koneksi).
- [ ] Uji otorisasi: akun Viewer tidak bisa menulis/AI/audit; akun lain tidak bisa membaca project privat.
- [ ] Uji RLS + seluruh migration (bukan hanya `reachable`).
- [ ] Satu Export ZIP nyata → deploy di hosting Anda sendiri (PiwuApp tidak menghosting hasil build).
- [ ] Project Roblox: kirim bundle ke Studio nyata, termasuk mode sinkron langsung opt-in.
- [ ] **Pentest / review keamanan eksternal** sebelum publik (regresi lokal `npm run test:security` bukan pengganti).
- [ ] Siapkan runbook insiden: cara baca audit admin, tangguhkan akun, cabut API key project, matikan search (`SEARCH_ENABLED=false`).

## 10. Pengungkapan & kebijakan (sudah tertera di UI — pastikan konsisten saat rilis)

- [ ] Landing/`/upgrade`: harga & kredit dari produk server; sebelum pembayaran live, status "belum tersedia" tampil otomatis.
- [ ] Jatah harian reset 00:00 UTC tanpa tumpukan; Free plafon 600/bulan; kredit paket hangus 2 bulan; top-up 12 bulan.
- [ ] Penghapusan akun mandiri belum tersedia (dilakukan superadmin) — tetap tercantum jujur di profil.
- [ ] Marketplace: payout & KYC ditinjau manual; PiwuApp tidak memindahkan uang dan tidak memverifikasi rekening.
- [ ] Kunci API project (`x-piwu-key`): bukan autentikasi pengguna akhir; kunci tulis di klien bisa dibaca pengguna — disarankan kunci baca saja.
- [ ] Hero video: default Pixabay CDN; untuk produksi disarankan self-host (`VITE_HERO_VIDEO_URL`) agar tidak bergantung pihak ketiga.

## 11. Pasca-rilis

- [ ] Monitor: saldo kredit menipis (ambang 10), antrean KYC/payout/sengketa, status sandbox, sinkronisasi cloud.
- [ ] Audit dependency berkala (scaffold Expo masih punya 15 advisory transitif — kejar sebelum mempromosikan jalur mobile).
- [ ] Uji perangkat asli + signing/EAS sebelum mengiklankan aplikasi mobile.
- [ ] Cadangan: cadangan browser (JSON per akun) + dump Postgres terjadwal; uji pemulihan.

---

### Ringkasan env produksi (cek cepat)

| Variabel                                               | Sisi     | Wajib?                |
| ------------------------------------------------------ | -------- | --------------------- |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`          | Frontend | Ya                    |
| `SUPABASE_SERVICE_ROLE_KEY`                            | Server   | Ya                    |
| `LLM_BASE_URL`, `LLM_API_KEY` (+`LLM_MODEL*` opsional) | Server   | Ya (AI)               |
| `SECRETS_ENCRYPTION_KEY` (64 hex)                      | Server   | Ya                    |
| `APP_BASE_URL`                                         | Server   | Ya (pembayaran/email) |
| `E2B_API_KEY`, `E2B_TEMPLATE`                          | Server   | Ya (sandbox)          |
| `PAYMENT_PROVIDER` + kunci provider, `PAYMENT_LIVE`    | Server   | Ya (menjual)          |
| `SEARCH_PROVIDER`, `SEARCH_API_KEY`                    | Server   | Opsional              |
| `RESEND_API_KEY`, `EMAIL_FROM`                         | Server   | Opsional              |
| `WHATSAPP_*`, `SUPABASE_SMS_HOOK_SECRET`               | Server   | Opsional              |
| `RATE_LIMIT_MODE=database`, `TRUST_PROXY_CIDRS`        | Server   | Ya (produksi)         |
| `VITE_HERO_VIDEO_URL`                                  | Frontend | Opsional              |
