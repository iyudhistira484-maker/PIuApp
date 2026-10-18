# Acceptance perangkat asli dan deployment — belum dijalankan

Tanggal: 15 Oktober 2026. Lingkungan pengujian adalah Linux, tanpa ADB/perangkat Android, macOS/Xcode, atau Roblox Studio. Tidak ada akun provider/deployment produksi terkonfigurasi. **Checklist kosong berarti belum diuji, bukan lulus.**

Bukti lokal dan risiko terbuka: [ADMIN_PRODUCTION_VERIFICATION.md](ADMIN_PRODUCTION_VERIFICATION.md).

## Expo Android/iOS

Prasyarat: project hasil ekspor, Node kompatibel SDK 57, perangkat dengan Expo Go yang sesuai SDK atau development build. Tinjau 15 paket terdampak advisory toolchain sebelum menerima project tak tepercaya. Jangan menaruh service-role/LLM key pada bundle mobile.

- [ ] Catat perangkat, OS, versi Expo Go/development build, SDK dan commit project.
- [ ] Install dependency terkunci, jalankan Metro pada jaringan uji, buka project di perangkat sungguhan.
- [ ] Cold launch berhasil tanpa red screen, klik **Coba interaksi** menghasilkan native Alert.
- [ ] Safe area, ukuran font, keyboard, orientasi yang didukung dan tema mengikuti konfigurasi.
- [ ] Background/foreground, kehilangan jaringan, restart aplikasi dan error recovery tidak kehilangan data yang seharusnya disimpan.
- [ ] Salin `env.example` menjadi `.env`, isi URL PiwuApp, ID project, dan kunci **baca saja** dari panel Database → API data, lalu uji `lib/piwu.ts` (daftar tabel dan baca baris) di perangkat. Scaffold **tidak punya login pengguna akhir**; operasi tulis harus diuji lewat server operator yang menyimpan kunci tulis, bukan dari kunci di APK/IPA.
- [ ] Jika memakai native build: signing, installation APK/AAB/IPA, izin perangkat dan build release diuji terpisah. Export Hermes bukan native signing/build.
- [ ] Simpan log Metro/perangkat yang sudah disanitasi dan video/screenshot hasil, tanpa token/QR berisi kredensial.

## Roblox Studio

Prasyarat: mesin Windows/macOS dengan Studio, tempat uji privat, deployment HTTPS yang dapat dijangkau Studio, cloud/migration 001–016, akun terverifikasi, plugin `public/plugins/PiwuStudio.rbxmx` (atau `.luau` sebagai cadangan). Jangan memakai place produksi pertama kali.

- [ ] Catat versi Studio/plugin, commit, place uji privat dan peran akun (tanpa token).
- [ ] Pairing memakai token terbatas/berumur pendek; verifikasi penolakan token kedaluwarsa/dicabut.
- [ ] Snapshot service yang didukung tampil; plugin tidak menjanjikan seluruh service internal/protected Roblox.
- [ ] Tambah/edit objek, transform, hierarki dan Luau → snapshot/draft → review → antrean → receipt terkonfirmasi.
- [ ] Draft belum diterima tidak mengubah Studio; script baru tetap dinonaktifkan sampai peninjauan yang sesuai.
- [ ] Edit objek langsung di Studio sebelum apply: konflik ditolak tanpa menimpa perubahan lokal.
- [ ] Uji Undo, kegagalan di tengah apply, reconnect dan retry; jangan menganggap apply/Undo sepenuhnya atomik.
- [ ] Nyatakan **Sinkron langsung** menyala, kirim satu bundle dari PiwuApp, dan pastikan plugin menerapkannya dalam ~5 detik, mengirim snapshot baru, lalu mematikan mode saat sengaja dibuat konflik (edit objek lokal sebelum bundle di-claim). Tidak boleh ada percobaan ulang otomatis setelah kegagalan.
- [ ] Jalankan **Play Test sungguhan**, periksa server/client Output, perilaku, collision dan physics. Geometri Three.js tidak membuktikan semua ini.
- [ ] Mesh OBJ diimpor manual dan material/ukuran diperiksa. Tidak ada automatic asset/game publish yang diklaim.

## Staging/produksi dan multi-instance

Prasyarat: URL target yang diizinkan, ruang lingkup pentest, data uji non-sensitif, backup, jadwal dan batas beban, kredensial lewat secret manager. Jangan memulai uji beban/pembayaran pada produksi tanpa batas dan izin operasional yang jelas.

- [ ] Terapkan migration berurutan **001–016**, uji RLS/RPC/Storage/Realtime melalui akun Owner, Editor, Viewer, outsider, auditor/operator/superadmin asli.
- [ ] Verifikasi signup, OAuth, recovery email benar-benar diterima, expiry/revocation, sesi lama dan perubahan peran.
- [ ] Jalankan dua proses/mesin API terhadap PostgreSQL/Supabase yang sama, `NODE_ENV=production`, reverse proxy dengan CIDR trust sempit.
- [ ] Beban bergantian antar-node tetap berbagi rate limit dan kuota sandbox; spoof forwarded header dari jalur tidak tepercaya tidak melewati batas.
- [ ] Terapkan sticky routing untuk sandbox. Node salah harus menolak, tidak membuat sesi duplikat/stop palsu. Uji restart pemilik dan expiry 20 menit.
- [ ] Putus koneksi database di tengah admission: permintaan baru fail-closed dan pulih setelah database kembali. Uji overload/latency/backoff dengan koneksi PostgreSQL independen.
- [ ] Bunuh worker saat build/publish/cleanup; periksa lease recovery, idempotency billing dan side effect provider. Uji cleanup konkuren dan rollback tanpa mengasumsikan exactly-once.
- [ ] Uji SSRF/rebinding/redirect, IDOR, bypass peran, XSS/CSV injection, payload/file limits, signature/replay webhook dan kebocoran secret pada target nyata.
- [ ] Periksa TLS, CSP/HSTS sesuai kebutuhan iframe/preview, logging teredaksi, alert, retensi, backup/restore dan rotasi key.
- [ ] Verifikasi inference AI, terminal E2B, deploy/domain/SSL, transaksi/webhook dan WhatsApp nyata dengan izin biaya/pesan yang jelas.
- [ ] Tutup advisory Expo atau dokumentasikan mitigasi/risk acceptance yang ditinjau. Nol temuan dependency utama bukan pengganti pentest.

## Format bukti per skenario

Catat: tanggal, versi/commit, lingkungan/perangkat, langkah, hasil yang diharapkan, hasil aktual, log tersanitasi, penanggung jawab, status **lulus / gagal / terblokir**. Jangan mengisi “lulus” hanya karena checkbox atau probe readiness tersedia.
