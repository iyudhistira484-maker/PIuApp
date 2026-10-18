# PiwuApp

> **Mode aplikasi saat ini: layanan nyata saja.** Login demo, AI preset lokal, shell simulasi, dan pratinjau admin telah dihapus dari jalur aplikasi. Workspace memerlukan login Supabase; AI/E2B memerlukan provider server yang aktif. **PiwuApp tidak menghosting hasil build:** tidak ada deploy website, domain kustom, hosting pihak ketiga, atau analytics pengunjung — kode keluar lewat Export ZIP, game Roblox lewat Studio. Jika layanan belum siap, aplikasi menampilkan error/status, bukan hasil sukses simulasi. Status koneksi ada di halaman login. Integrasi live belum terverifikasi di lingkungan ini; lihat [aktivasi layanan nyata](docs/REAL_SERVICES.md).

Chat-based app builder MVP berbahasa Indonesia. React 19, TypeScript, Vite, Tailwind, Zustand, Lucide, Monaco, xterm, Supabase/RLS, dan backend SSE OpenAI-compatible. Integrasi layanan nyata tersedia, tetapi **belum diaktifkan atau diverifikasi live** tanpa konfigurasi akun eksternal.

## Verifikasi terakhir — 17 Oktober 2026

**405/405 unit/integrasi lulus**, suite browser lengkap **121/121 lulus** (6,6 menit, 1 worker), lalu regresi native/tema **8/8 lulus**. Build produksi, 11 smoke HTTP, dan tes Chromium pada aset produksi/worker Monaco lulus. Admin kini memiliki pencarian server, filter, CSV aman, diagnostik, serta panel **AI & model**, **rincian kredit per akun** dan **runtime/sandbox** (semuanya baca-saja); migration **007–016** diperlukan. Model 3D dari foto juga bisa diekspor sebagai **GLB bertesktur**: atlas dibakar di browser dari piksel asli foto yang tersimpan (grup sisi menyimpan area fotonya), UV tiap sisi jatuh di sel grupnya, dan PNG 1024×1024 tertanam di satu berkas `.glb` — jalur yang dibaca importer Roblox, dengan catatan jujur **proyeksi kotak per sisi, bukan UV unwrap**. Jawaban riset yang **sudah selesai** kini bertahan lewat restart dan bisa diserahkan proses lain (tumpang tabel 009, prefiks `research-job:`, TTL 6 jam, diklaim sekali); ronde yang masih berjalan tetap tidak dilanjutkan setelah restart. [Laporan terbaru](docs/ADMIN_PRODUCTION_VERIFICATION.md).

Dashboard juga menjawab pertanyaan awal tanpa perlu membuka project: saldo dan rincian pemakaian kredit di sidebar (per jenis: percakapan AI, build & audit) dengan peringatan saldo menipis, panel **"Menunggu Anda"** yang mengumpulkan komentar belum selesai, undangan belum dijawab, bundle Studio menunggu, dan sinkronisasi berkonflik, kartu project yang menampilkan isi project dan tempat terakhir Anda berhenti, skor kualitas Lighthouse beserta arah perubahannya, feed aktivitas dari riwayat, pencarian sampai ke isi file dan percakapan, checklist kesiapan fitur yang menyebut persis apa yang belum dikonfigurasi, dan cadangan semua project + foto ke satu berkas JSON yang pemulihannya selalu menambah (tidak menimpa). Semuanya memakai endpoint yang sudah ada — **tanpa tabel atau migration baru**. Plugin Studio **v2.2.0** sekarang dipasang sekali sebagai `PiwuStudio.rbxmx` dengan izin HTTP lewat Plugin Management, dan punya **sinkron langsung opt-in**: bundle yang sudah Anda kirim dari PiwuApp diterapkan di Studio dalam ~5 detik, snapshot baru dikirim balik, dan mode mati sendiri pada kegagalan pertama. Default tetap dua klik konfirmasi; tidak ada push dari server. Perbaikan: unggah GLB ke Roblox dulu kehabisan waktu 30 detik dan melaporkan unggahan yang sudah masuk sebagai "belum terkonfirmasi" — sekarang 180 detik dan anggarannya diuji.

Deploy website, custom domain, dan analytics pengunjung sudah **dihapus total** dari aplikasi (17 Oktober 2026): route `/publish`, `/deployments`, `/analytics`, provider hosting Netlify, worker publish, panel Layanan Publish/Analytics, antrean admin, dan biaya 5 kreditnya tidak ada lagi. Tabel lama `project_sites`/`deployments`/`publish_jobs`/`analytics_events` dibiarkan inert di skema supaya migration tidak berubah.

Kartu paket di landing dan `/upgrade` memakai satu daftar benefit (`planBenefits()` di `src/lib/dashboard/plans.ts`) yang dibangun dari tangga kredit: Free menyebut yang memang terbuka untuk semua paket (template web/Roblox/mobile, editor, preview, Export ZIP, project lokal & cloud tanpa batas, kolaborasi Viewer/Editor, AI saat provider aktif), sedangkan Pro dan Team menyebut angka kredit, tarif per kredit, bonus harian, dan masa berlaku dari angka yang sama dengan checkout. Tidak ada fitur yang dikunci secara bawaan (matriks akses per paket di panel admin dibiarkan "Semua paket"); klaim lama "3 project lokal", "Workspace bersama", "Role & kontrol akses", dan "Tagihan terpusat" dihapus karena tidak ditegakkan, dan toggle "Tahunan −20%" dihapus karena katalog hanya menjual paket 30 hari — landing tidak lagi menampilkan harga yang tidak bisa dibeli.

Halaman **paket** (`/upgrade`) dan **profil** (`/profile`) melengkapi dashboard: harga, kredit per paket, tombol checkout, dan masa aktif dibaca dari `GET /api/account` (bukan ditulis ulang di UI) sehingga perubahan produk di server langsung terlihat, dan saat pembayaran belum dikonfigurasi halaman menjelaskannya alih-alih menampilkan tombol yang gagal; profil mengubah nama tampilan, email pengganti, dan kata sandi langsung lewat `supabase.auth.updateUser` (tanpa route server atau tabel baru), menampilkan verifikasi email, paket, kredit, pendapatan tercatat dan status sinkronisasi, serta menyatakan jujur bahwa penghapusan akun mandiri dari halaman ini belum tersedia (penghapusan akun dilakukan superadmin dari panel admin). **Pengaturan situs** di panel admin (superadmin) kini juga mengatur **harga dan kredit paket** Pro/Team/top-up serta sakelar **Roblox Studio bridge**; perubahan langsung dipakai checkout, `/upgrade`, dan kartu landing, sedangkan jatah harian/plafon/masa berlaku tetap kebijakan database 010. Dashboard pengguna kini disusun **project-first**: satu plat "Lanjutkan" untuk project terakhir, grid project dan penyaring tepat di bawah judul, serta rail ringkasan (kredit, kesiapan fitur, "Menunggu Anda", kualitas) yang turun ke bawah grid di layar sempit; banner promosi dan catatan kesiapan yang berulang dihapus, dan tab **Profil** yang memuat form nama, email, kata sandi, paket/kredit, dan sinkronisasi tanpa harus membuka halaman `/profile`. Lonceng **Notifikasi** kini ada di dashboard dan workspace: baris disimpan server (migration 012), jadi perangkat lain melihat daftar yang sama; pembayaran berhasil/dikembalikan, penyesuaian kredit admin, anggota baru project, dan template terjual dikirim sebagai notifikasi dengan dedupe agar retry tidak berbunyi dua kali. Tanpa provider email/push: browser yang tertutup melihatnya saat dibuka lagi. Panel admin kini juga punya tombol **Hapus akun** (superadmin): project dan data pribadi dihapus, profil dianonimkan, email Auth diganti token dan di-soft-delete, sedangkan invoice/ledger/audit tetap disimpan tanpa email. Tombol **Tangguhkan/Aktifkan akun** sudah ada sebelumnya. Panel admin ikut menyesuaikan: ringkasan menampilkan **akun kredit menipis** (ambang 10 yang sama dengan peringatan dashboard) dan **salinan cloud diam ≥7 hari**, daftar pengguna menandai saldo menipis, rincian akun menampilkan bridge Studio serta penyimpanan terakhir, Operasional menyertakan `search` di grid kapabilitas, dan Diagnostik menambahkan blok **Penyimpanan & cadangan** (hitungan salinan, dataset, catatan bahwa cadangan dibuat di peramban) dan **Roblox Studio & plugin** (versi 2.1.0, status bridge) — tetap baca-saja, tanpa migration baru.

Saat dua tab membuka file yang sama, editor kini **menggabungkan karakter dengan CRDT** ringan di klien: statusbar menulis `CRDT · N tab`, kursor dan undo tidak dikorbankan, dan teks hasil gabung tetap disimpan lewat autosave/revisi. Batasnya dinyatakan: ≤30.000 karakter, hanya selama rekan di file yang sama, dan sesi berhenti dengan label "teks berbeda" bila kedua tab tidak mulai dari teks dasar yang sama. Tidak ada migration baru. Kolaborasi realtime juga menunjukkan **siapa yang sedang di mana**: avatar anggota lain di statusbar workspace, tooltip nama + baris/kolom, dan sorotan baris kursor di Monaco untuk rekan yang membuka file yang sama. Kanal privat `piwu:project:<id>` tetap dijaga RLS `can_read_project`; payload kursor dikirim 220 ms setelah gerakan berhenti, nama/posisi dibersihkan sebelum ditampilkan, dan statusbar menyebut "Realtime terputus · polling aktif" bila WebSocket gagal. Saat rekan membuka **file yang sama**, editor juga menggabungkan karakter dengan **CRDT kecil di klien**: setiap karakter punya id dan induk, edit bersamaan bertemu pada urutan yang sama, dan statusbar menulis `CRDT · N tab`. Penggabungan hanya untuk file sampai 30.000 karakter/60.000 simpul, hanya selama sesi aktif — teks hasil gabung tetap disimpan lewat `writeFile`, jadi autosave, revisi, dan deteksi konflik tidak berubah. Bila dua tab memulai dari teks yang berbeda, CRDT dimatikan dengan label "teks berbeda" alih-alih menebak. Op tidak disimpan di server; tab yang baru bergabung menerima riwayat dari tab yang sedang aktif. Panel admin juga punya **matriks akses per paket** untuk sandbox/terminal, Studio bridge, dan penjualan template; bawaannya "Semua paket", dan bila operator menaikkan syarat, server menolak permintaan dari paket di bawahnya dengan `403 PLAN_REQUIRED`. Tanpa migration baru.

Penjual marketplace kini punya **saldo dan payout yang ditinjau manusia**: migration 013 menambah `seller_verifications` dan `marketplace_payouts`, RLS baca-sendiri, dan lima RPC service-only. Saldo dihitung dari penjualan `accrued` dikurangi payout yang diminta/disetujui/dibayar; permintaan butuh KYC `verified`, menahan saldo sejak diminta, dan ditolak bila melebihi saldo. Superadmin meninjau KYC/payout di tab Marketplace; status `paid` wajib menyertakan referensi transfer, dan penolakan mewajibkan alasan. PiwuApp tidak memindahkan uang dan tidak memverifikasi rekening — itu dicatat sebagai batas, bukan diklaim otomatis. Kartu pendapatan ada di `/profile`.

Sengketa marketplace kini punya alur sendiri (migration 014, disempurnakan 015): pembeli melaporkan satu pesanan dalam 30 hari, penjual membalas sekali, dan superadmin memilih **tutup laporan** atau **tolak** dengan catatan wajib. **PiwuApp tidak menyediakan refund** — semua pembelian (paket, top-up, template) bersifat final dan tidak ada tombol atau alur yang mengembalikan uang. Selama laporan belum selesai, bagian penjual dari penjualan itu **ditahan** dari saldo payout (terlihat sebagai `frozen`); menutup, menolak, atau menarik laporan melepas tahanan itu tanpa memindahkan uang. Pembeli/penjual melihat laporan di `/profile#sengketa`; admin melihat antreannya di tab Marketplace.

Scaffold **Aplikasi Mobile (Expo)** kini ikut memakai backend itu: project mobile mendapat `lib/piwu.ts` untuk daftar/baca/tambah/ubah/hapus baris lewat API data, `env.example` berisi tiga variabel `EXPO_PUBLIC_PIWU_*`, dan panel native menjelaskan cara mengisinya. Peringatannya eksplisit: nilai `EXPO_PUBLIC_*` tertanam di bundle APK/IPA, jadi aplikasi sebaiknya memakai kunci **baca saja** dan menaruh kunci tulis di server operator. Scaffold tetap tanpa login pengguna akhir; build APK/IPA, signing, EAS, dan uji perangkat belum dijalankan di lingkungan ini.

Panel **Database** kini juga menjadi backend untuk aplikasi yang dibuat: Owner/Editor membuat sampai lima kunci API per project (baca saja atau baca & tulis) di bagian **API data untuk aplikasi Anda** (migration 016). Kunci hanya ditampilkan sekali; server menyimpan hash SHA-256, kunci yang dicabut langsung berhenti bekerja, dan aplikasi memanggil endpoint `/api/public/app/...` dengan header `x-piwu-key` (atau Bearer) untuk membaca/menulis tabel. Ini **bukan autentikasi pengguna akhir**: tidak ada login aplikasi, izin per baris, kuota per kunci, atau webhook, dan kunci tulis yang ditanam di klien web/Roblox dapat dibaca pengguna. Rincian dan contoh `fetch`/`HttpService` ada di [PROJECT_DATA.md](docs/PROJECT_DATA.md).

**Roblox Studio** kini bisa mengikuti perubahan tanpa menekan tombol kedua: mode **Sinkron langsung PiwuApp → Studio** di plugin (v2.2.0) memeriksa antrean tiap ~5 detik dan menerapkan bundle yang **sudah Anda kirim dan review di PiwuApp**, lalu mengirim snapshot baru. Mode ini default mati, hanya berjalan saat Studio terbuka dan Edit Mode, tetap menolak konflik perubahan lokal, dan mematikan dirinya pada kegagalan pertama tanpa mencoba ulang. Script baru tetap `Disabled`. Tidak ada push server ke plugin dan ini bukan penggabungan file/CRDT.

Dialog **Repositori** kini benar-benar bekerja: project bisa di-push ke repositori GitHub yang sudah ada, langsung dari browser, lewat OAuth Supabase (cakupan `repo`) atau token fine-grained yang hanya hidup di memori tab. Push memakai Git Data API (satu tree, satu commit, lalu update ref), maksimum 200 file teks/4 MB; gambar, GLB, ZIP, dan `.env` dilewati, dan file yang dihapus di PiwuApp tidak dihapus dari GitHub. Server PiwuApp tidak pernah menerima token. Tanpa migration baru.

Harga paket tidak berubah, isinya menyesuaikan, dan setiap kredit kini punya masa berlaku yang ditegakkan database: Pro Rp 199.000 memberi **1.500 kredit/bulan** ditambah **30 kredit/hari** (Rp 133/kredit) dan Team Rp 499.000 memberi **4.500 kredit/bulan** ditambah **40 kredit/hari** (Rp 111/kredit) — makin besar paket, makin murah per kredit; top-up Rp 49.000 → **300** dan Rp 199.000 → **1.400** memang lebih mahal per kredit, karena naik paket adalah jalur yang lebih hemat. Jatah harian direset setiap hari pukul 00:00 UTC dan **tidak menumpuk** (Free dibatasi plafon 600/bulan); kredit paket boleh menumpuk antar bulan tetapi hangus 2 bulan setelah terbit, dan kredit top-up berlaku 12 bulan. Jatah harian dan sisa hari ini **dibaca dari server**: `GET /api/account` mengembalikan blok `credits` (paket, jatah harian, sisa hari ini, plafon Free beserta pemakaiannya, jam reset, instan reset berikutnya) dari fungsi read-only `public.piwu_credit_status(uuid)` di migration 010, dan halaman menampilkan kalimat migration bila database belum menerapkannya. Angka itu hidup di `shared/credits.mjs` bersama daftar harga per operasi (chat Cepat 1 / Seimbang 3 / Kuat 8, tanya-jawab 1, plan 2, ronde riset 1, perintah sandbox 1, build/preview 2, audit 3), dipakai server untuk menagih dan halaman untuk menampilkan, dan dijaga `tests/credits-model.test.ts`: katalog server harus sama dengan tangga publik, `piwu_credit_policy()` di migration 010 harus sama dengan model ini, dan paket besar tidak boleh lebih mahal per kredit. Kredit disimpan sebagai lot bertanggal: jatah harian hangus di akhir hari dan tidak menumpuk, kredit paket boleh menumpuk antar bulan tetapi hangus 2 bulan setelah terbit, dan top-up berlaku 12 bulan — aturan yang sama ditegakkan `piwu_claim_daily`/`piwu_expire_credits`, bukan hanya ditulis di halaman.

Audit dependency utama PiwuApp: **0 temuan diketahui**. **Scaffold Expo SDK 57 masih memiliki 15 paket terdampak severity high dari dua advisory transitif**; export Android/iOS dan TypeScript berhasil, tetapi belum uji perangkat asli. Dua belas kapabilitas layanan masih `not_configured` di lingkungan ini (termasuk `search`); belum sertifikasi produksi/pentest. [Acceptance yang masih terblokir](docs/NATIVE_PRODUCTION_ACCEPTANCE.md).

## Menjalankan

```sh
npm install
cp .env.example .env
npm run dev
```

Buka port **3001**. Vite meneruskan `/api` ke backend port 3002; browser tidak memanggil localhost untuk API. Server menerima host preview Arena.

- `/` — landing page lengkap
- `/login` — login/signup Supabase dan status kesiapan layanan
- `/forgot-password`, `/reset-password` — pemulihan password Supabase (memerlukan konfigurasi email/redirect)
- `/projects` — dashboard akun cloud dengan cache offline
- `/project/:id` — IDE, React live preview, AI panel, menu **Layanan**
- `/account` — kredit, checkout, pesanan, referral, pendapatan template
- `/upgrade` — halaman paket: perbandingan paket & top-up dari produk server, rincian kredit, checkout
- `/profile` — profil akun: nama tampilan, email pengganti, kata sandi, paket/kredit, keluar perangkat
- `/marketplace` — template komunitas gratis/berbayar
- `/admin` — administrasi pengguna/project/transaksi/broadcast/layanan/audit; memerlukan peran administrator yang diverifikasi server
- `/invite/:token`, `/recording/:token` — undangan dan replay read-only

## Alur setelah layanan diaktifkan

1. Tulis ide di landing → login akun terverifikasi → project tersinkron ke cloud.
2. Edit `src/App.tsx` atau CSS di Monaco; preview diperbarui otomatis.
3. Kirim instruksi ke provider AI aktif → lihat diff → **Terima semua**. Tanpa provider, tidak ada perubahan preset.
4. Pulihkan di **Riwayat**; coba **Plan**, edit checklist, **Setujui & Bangun**.
5. **Design** → klik teks → ubah style → terapkan ke kode.
6. **Canvas** → bandingkan frame desktop/tablet/ponsel, geser dan ubah ukuran frame, gunakan zoom/pan serta undo layout. [Panduan canvas](docs/CANVAS.md).
7. Export ZIP dari dropdown project atau tombol **Export ZIP** di toolbar (PiwuApp tidak menghosting hasil build).
8. Klik **Rekam**, edit kode, lalu **Stop** untuk player timeline.
9. **Layanan** menampilkan status konfigurasi, kolaborasi, sandbox/npm, storage/secrets, URL reference, audit dan marketplace.

Hero landing memakai video awan pilihan pengguna, dengan autoplay tanpa kontrol player dan fallback hemat gerak/data. Sumber dan opsi self-hosted: [MEDIA.md](docs/MEDIA.md).

Chat AI punya pemilih model: pilih preset tier (Otomatis/Cepat/Seimbang/Kuat) **atau** model mana pun yang dilayani `LLM_API_KEY` Anda — daftar diambil dari `GET {LLM_BASE_URL}/models`, jadi DeepSeek, Claude, GLM, Qwen, dan model lain di key itu semuanya muncul (dikelompokkan hanya untuk tampilan, pencarian, dan bisa di-scroll keyboard). Model yang dipilih dikirim apa adanya, balasan menampilkan nama model yang menjawab, dan **tiap model menyatakan biaya kreditnya** — harga per pesan itu datang dari katalog server (`costs[]`), jadi angka yang tertulis di pemilih persis angka yang ditagih: override `LLM_MODEL_KUAT` menaikkan harga di model yang dipetakan, bukan di salinan UI. Preset tier menulis rentangnya (Otomatis 1–8), estimasi di composer memakai angka yang sama, dan panel admin **AI & model** menambahkan kolom kredit/pesan per tier. Detail konfigurasi: [SERVICES_SETUP.md](docs/SERVICES_SETUP.md).

Untuk project **Roblox**, chat juga bisa membuat **model 3D dari foto**: lampirkan foto objeknya (maks. 3 lampiran per pesan, foto diberi nomor) dan minta modelnya — AI menjawab dengan op `scene.build` berisi bentuk (`box`, `sphere`, `cylinder`, `cone`, `wedge`, `plane`), ukuran dalam stud, dan warna, lalu **server yang membuat seluruh geometrinya** (`server/lib/lowpoly.mjs`, deterministik) menjadi Part Roblox, objek mesh, atau satu mesh gabungan siap ekspor OBJ. Foto yang tidak benar-benar dilampirkan **ditolak**, batas mesh scene ditegakkan sebelum menulis, dan laporan di chat menyebut foto asal, jumlah vertex/face, serta batas satu warna per mesh gabungan. **Warnanya datang dari piksel foto Anda:** browser menyampel tiap foto menjadi grid 16×16, AI menunjuk `region` (pecahan 0–1 foto) untuk tiap bagian, dan server memakai rata-rata area itu — termasuk warna per sisi pada mesh gabungan (Preview 3D dan ekspor OBJ). Laporan di chat menampilkan swatch warna beserta jumlah sisi tiap warna. Bila sampel warna tidak ada, operasi ber-region **ditolak**, bukan ditebak. Foto yang dipakai juga **disimpan sebagai aset project di browser ini** (panel **Foto project**: buka besar untuk membandingkan dengan modelnya, pakai lagi sebagai lampiran tanpa mengunggah ulang, atau hapus — 12 foto / 16 MB per project, dan UI menyebut terus terang bahwa foto tinggal di browser ini, bukan di cloud). Ini **blockout low-poly dari primitif, bukan fotogrametri**: yang dipindahkan adalah warna datar per sisi, **bukan peta tekstur UV, melainkan warna datar per sisi**. Untuk tekstur sungguhan, panel Properti objek mesh punya **Ekspor GLB**: atlas 1024×1024 dibakar di browser dari piksel asli foto project (tiap grup sisi menyimpan area fotonya), lalu ditanamkan di satu berkas `.glb` yang dibaca importer Roblox — dan UI menyebutnya apa adanya sebagai **proyeksi kotak per sisi, bukan unwrap**. Tanpa foto yang bisa dipastikan, tombol bertesktur nonaktif dan yang tersedia hanya warna vertex. AI wajib menyebut bagian yang tidak terlihat di foto. Detail: [STATUS.md](docs/STATUS.md).

Chat punya **mode riset** (toggle di toolbar komposer, diingat per akun): AI boleh meminta ronde pencarian berbatas (default 2, `SEARCH_ROUNDS_MAX`) lewat ops `search`, server yang benar-benar mencari dan membaca halaman, lalu balasan akhir wajib mengutip sumber bernomor `[1]`, `[2]` yang penomorannya stabil lintas ronde. Chat menampilkan panel **Sumber** (judul, URL asli, provider, jenis, cuplikan, dan mana yang dikutip) serta laporan jujur: kueri yang gagal, nomor sitasi yang tidak pernah dikembalikan (dilaporkan, bukan dianggap sumber), dan halaman yang tidak terbaca. Pencarian butuh provider web berkunci (`SEARCH_PROVIDER`+`SEARCH_API_KEY`); tanpa itu permintaan sumber ditolak dengan 503 jujur, bukan dijawab tanpa sumber. Kontrak tiap vendor (Tavily/Exa/Brave/Parallel) bisa diverifikasi dengan **panggilan nyata**: `npm run verify:search` melaporkan OK/GAGAL/DILEWATI per provider tanpa pernah mencetak kunci. Satu ronde = 1 kredit, dan **dikembalikan bila ronde itu tidak menambah sumber baru**; permintaan setelah batas ronde dijawab dengan sumber yang ada plus penjelasan, bukan jawaban palsu. Menutup tab **tidak** membuang riset yang sudah berjalan: rondenya tetap selesai di server, jawabannya disimpan sebagai job latar (30 menit, maksimum 20 job) dan diambil sekali begitu project dibuka lagi — kredit ronde yang selesai tetap terpakai dan itu dinyatakan di pemberitahuan. Detail: [STATUS.md](docs/STATUS.md), [REAL_SERVICES.md](docs/REAL_SERVICES.md).

Landing juga memakai lapisan animasi terisolasi (`landing-motion.css` + `useLandingMotion.ts`): entrance hero bertahap, reveal saat scroll, ambient gradien, indikator progres, dan micro-interaction hover. Konten hanya disembunyikan setelah JavaScript aktif (`html.js-reveal`), tanpa IntersectionObserver semua blok tetap tampil, dan `prefers-reduced-motion` mematikan seluruh gerakan.

**Tidak ada fallback AI atau shell simulasi.** Tidak ada pembayaran, email undangan, OTP, atau publikasi otomatis yang diaktifkan diam-diam.

## Paket SQL siap dipasang

Mulai dari **[supabase/README.md](supabase/README.md)**. Database baru memakai satu file `supabase/install/INSTALL_NEW_DATABASE.sql` (001–016, transaksi atomik). Database lama hanya menjalankan migration yang belum diterapkan—**jangan gunakan installer baru**. Paket juga menyediakan `CHECK_INSTALLATION.sql` yang read-only dan `BOOTSTRAP_FIRST_ADMIN.sql` untuk akun email terverifikasi, tanpa password bawaan.

## Konfigurasi cloud / provider

- `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`: URL project + anon/publishable key, bukan service role.
- Email/Google auth harus diaktifkan di Supabase, dengan redirect URL deployment terdaftar.
- `LLM_BASE_URL`: endpoint kompatibel OpenAI, mis. `https://your-provider.example/v1`.
- `LLM_API_KEY` dan `LLM_MODEL`: server-only.
- Terapkan `supabase/001_schema.sql` lalu `supabase/002_workspace_sync.sql` dan `supabase/003_services.sql`; tambahkan `supabase/004_project_data.sql` untuk dataset cloud dan `supabase/005_admin.sql` untuk administrasi platform; `supabase/006_studio_bridge.sql` diperlukan untuk bridge Roblox Studio. Tambahkan `supabase/007_runtime_coordination.sql` untuk rate limit/kuota bersama dan `supabase/008_admin_directory.sql` untuk pencarian akun admin. Migration menyediakan tabel, RLS, dan RPC cloud. Akun terverifikasi menggunakan antrean autosave; project demo hanya diunggah setelah impor eksplisit.
- Ikuti [panduan cloud](docs/CLOUD_SETUP.md) untuk konfigurasi, batasan, dan skenario pengujian staging.

Panduan lengkap environment, webhook, E2B template, pricing, limits, dan acceptance staging: **[SERVICES_SETUP.md](docs/SERVICES_SETUP.md)**. Payout/KYC marketplace dan sengketa kini tersedia tetapi **ditinjau manual** (payout ditransfer di luar aplikasi lalu referensinya dicatat; sengketa hanya menutup laporan), **refund tidak disediakan sama sekali**, dan backend data aplikasi pengguna tersedia lewat kunci API per project (migration 016, tanpa autentikasi pengguna akhir); GitHub push bersifat satu arah (tanpa pembuatan repo/PR/webhook). Panel Database sekarang mendukung dataset cloud privat dengan revision check; lihat [PROJECT_DATA.md](docs/PROJECT_DATA.md).

Aktivasi superadmin pertama, peran, broadcast terjadwal dan batas kontrol: **[ADMIN.md](docs/ADMIN.md)**. Tidak ada kredensial admin bawaan.

Baca [status tiap tahap](docs/STATUS.md) dan [keamanan](docs/SECURITY.md) sebelum deployment.

## Perintah

```sh
npm run build       # TypeScript check + production bundle
npm start           # frontend + API produksi, default 3001; reverse proxy HTTPS diperlukan
npm test            # unit/invariant tests
npm run verify:readiness  # diagnostik read-only; bukan sertifikasi integrasi live
npm run check:bundle      # anggaran ukuran setelah build
npm run test:security     # regresi keamanan lokal, bukan pentest penuh
npm run verify:production # smoke HTTP; server produksi lokal 3201 harus aktif
npm run test:e2e    # browser flows; requires Chromium
npm run test:e2e:sandbox  # Linux: Chromium + libraries dari dependency npm, tanpa CDN Playwright
```

## Struktur

```
src/components/    UI, prompt, template thumbnails
src/pages/         Landing, Auth, Dashboard, Workspace
src/workspace/     Explorer, Plan, Monaco, terminal, database, inspector
src/lib/           Types, store, templates, preview compiler, AI, Supabase
src/lib/cloud/     Repository, validation, sync queue, scope isolation, conflict reconciliation
src/components/storage/  Session bootstrap, status, import & conflict UI
server/            Authenticated service API, providers, SSE, credit sweeper
scripts/           Administrator E2B template build (explicit opt-in)
supabase/          Schema + RLS foundation
docs/              Honest delivery status, security checklist
```

Preview runtime `src/lib/preview-runtime.txt` adalah React/ReactDOM bundled lokal. Untuk regenerasi setelah upgrade React:

```sh
npx esbuild src/lib/preview-entry.ts --bundle --minify --format=iife --define:process.env.NODE_ENV='"production"' --outfile=src/lib/preview-runtime.txt
```

Tes browser memerlukan aplikasi aktif pada port 3001 (`npm run dev` di proses lain).

Monaco dan worker di-lazy-load. Ukuran bundle editor lebih besar dari UI utama; tidak menghambat landing page. Perlu import editor/language API yang lebih granular untuk optimasi lebih lanjut.

### Status pengujian cloud

State/sinkronisasi dan kebijakan SQL diuji dengan PostgreSQL PGlite; UI impor/konflik/Viewer diuji di browser. Belum ada Supabase live yang terhubung. Cache browser bukan penyimpanan terenkripsi; jangan masukkan secret atau data sensitif.

## Pilihan project & Roblox Studio

Composer landing dan formulir project menyediakan **Web App / Aplikasi Mobile (Expo) / Roblox Game**. Target project mengikuti login dan penyimpanan cloud, bukan sekadar label. Lihat [jenis project](docs/PROJECT_KINDS.md).

Roblox menyediakan editor Luau, scene builder Three.js, vertex/face mesh dasar, impor/ekspor OBJ dan plugin lokal Studio berbasis snapshot/review. **Setiap tugas AI pada project Roblox otomatis membaca snapshot terbaru dari Studio** — pohon Explorer dan source Luau yang dapat dibaca — jadi AI bekerja dari place yang sedang dibangun, bukan hanya file yang pernah diimpor; perubahan tetap kembali lewat bundle yang ditinjau dan diterapkan di Studio. [Panduan dan batas Roblox](docs/ROBLOX.md). Aktifkan bridge dengan migration `006_studio_bridge.sql` setelah 001–005; plugin dipasang sekali dari `public/plugins/PiwuStudio.rbxmx` (isi identik dengan `public/plugins/PiwuStudio.luau`), dan unggah aset otomatis hanya aktif bila server diberi kunci Open Cloud `asset:write`. Belum ada klaim pengujian terhadap Studio asli atau publikasi game.

## Tema IDE

Seluruh workspace mendukung **Terang/Gelap** lewat tombol matahari/bulan di kanan atas atau **Pengaturan → Tema IDE**. Berlaku untuk Web App, Expo dan Roblox; preferensi disimpan di browser tanpa mengubah source project. [Panduan tema & layout Roblox](docs/IDE_THEME.md).

Untuk browser regression tanpa kredensial produksi: `UI_TEST_FIXTURES=1 npm run test:e2e:sandbox` (server pengujian sementara 3101, terpisah dari preview 3001; bukan login demo pada aplikasi).
