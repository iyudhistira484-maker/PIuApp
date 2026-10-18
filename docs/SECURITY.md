# Batas keamanan dan checklist produksi

## Batas yang sudah ditegakkan

- Project demo dan cache tiap akun dipisahkan. Cache localStorage/IndexedDB **bukan enkripsi atau batas kerahasiaan antarorang yang memakai profil browser sama**.
- Preview lokal dan replay menggunakan `sandbox="allow-scripts"`, tanpa allow-same-origin/popups/forms. CSP preview melarang jaringan/form/base. Pesan inspector hanya diterima dari iframe aktif.
- JWT diverifikasi ke Supabase Auth; akun anonymous/tidak terverifikasi ditolak. Service API mengambil actor dari JWT dan memeriksa membership Owner/Editor/Viewer, bukan body request.
- RLS aktif; mutation RPC billing/audit/invite hanya service_role. RPC workspace/dataset memakai auth.uid() dari JWT authenticated dan memeriksa hak akses di PostgreSQL. Frontend tidak boleh menerima service-role key. Snapshot notebook bukan otoritas identitas, billing, atau audit immutable.
- Ledger/reservations/payment fulfilment dan referral reversal atomik/idempoten. Pemenuhan pembayaran tidak bergantung pada redirect browser. Endpoint AI lama tanpa project ditutup.
- Kredensial lazim, `.env`, `.git`, traversal dan output sensitif diblokir. Deteksi regex **bukan DLP menyeluruh**. Review kode/lampiran sebelum dibagikan, dijual, atau dipublikasikan.
- Secrets AES-256-GCM + nonce acak + AAD project/environment/key; tidak ada endpoint read plaintext. Master key env bukan KMS; rotasi, backup dan pengelolaan key menjadi tanggung jawab operator.
- Shell/build/Lighthouse berjalan di E2B, bukan host API. Tidak ada key PiwuApp yang diinjeksi ke sandbox. Template jangan berisi secret. Script/paket user tetap untrusted dan dapat melakukan jaringan dari sandbox.
- PDF worker tidak mewarisi environment/Node loader host, membatasi teks, waktu, dan JS heap; worker thread **bukan isolasi OS**. Pertimbangkan container parser khusus dengan egress/resource limit sebelum menerima dokumen publik berisiko tinggi.
- URL reference hanya HTTPS publik, tanpa credential/port arbitrary; DNS/IP privat/metadata/mixed-answer ditolak, DNS dipin per koneksi, redirect divalidasi ulang, respons dibatasi. Ini tidak memberi lisensi menyalin karya orang lain.
- Invite hash, once-only expiry/email binding; recording share hash + expiry/revoke; signed asset URL 5 menit. Penerima tetap dapat menyimpan konten sebelum akses dicabut.
- Payment hooks memverifikasi signature/token lalu membaca ulang status provider. WhatsApp hook memakai Standard Webhooks dan deduplikasi receipt. Detail provider/secrets tidak diteruskan sebagai error API.

## Syarat sebelum produksi

1. Jalankan migration 001–016 berurutan pada staging dan uji empat sesi nyata: Owner, Editor, Viewer, outsider. Uji direct PostgREST, RPC, Storage, Realtime, pencabutan akses, dan pembacaan template berbayar.
2. Konfirmasi seluruh kredensial server-only, HTTPS, allowed redirects, email/phone verification, aturan signup, body/concurrency limits, proxy trust yang sempit, HSTS/CSP dan logging teredaksi.
3. Produksi memakai rate limiter dan admission sandbox PostgreSQL (migration 007) serta fail-closed ketika database tidak tersedia. SDK handle tetap lokal dan memerlukan sticky routing; belum failover transparan. Kuota bersama mencakup sandbox interaktif, bukan build sekali pakai. Antrean kredit/pembayaran menggunakan database; uji crash recovery, konkurensi dan kapasitas pada infrastruktur sebenarnya.
4. Uji invoice sukses/gagal/duplicate/out-of-order/refund/chargeback. Partial refund, Xendit refund di luar invoice callback, checkout dengan respons provider hilang, fraud, pajak, dispute dan payout belum otomatis. Jangan aktifkan pembayaran live tanpa rekonsiliasi/runbook.
5. Monitor reservations/receipts dan tetapkan alert. PiwuApp tidak menghosting website, jadi tidak ada cleanup hosting yang perlu diawasi.
6. Sandbox preview adalah URL publik sementara. Audit hasil build dan dependensi sebelum membagikan hasil Export ZIP; threshold Lighthouse ≥60 bukan bukti aman. Kode hasil ekspor berjalan di hosting Anda sendiri, di luar jaminan PiwuApp.
7. Realtime presence advisory dan dapat dipalsukan client yang diizinkan kanal; jangan gunakan sebagai bukti author/role. Penggabungan teks memakai CRDT kecil di klien (maksimal 30.000 karakter per file, hanya saat rekan hadir), tetapi **otorisasi tetap milik kanal**: policy Realtime saat ini mengizinkan semua anggota project yang lolos `can_read_project`, termasuk Viewer. Viewer tidak punya UI untuk mengirim op dan klien yang dimodifikasi adalah ancaman nyata; jaminan keras memerlukan topik/policy tulis khusus (migration baru). Teks tetap disimpan lewat revisi + deteksi konflik, dan CRDT tidak menetapkan identitas.
8. Payout marketplace bukan transfer otomatis. Data KYC (nama legal, NPWP opsional) dan tujuan transfer disimpan di tabel dengan RLS baca-sendiri; hanya superadmin yang boleh meninjau lewat RPC service-only. Referensi transfer wajib saat status `paid`, tetapi kebenaran transfer dan kepatuhan pajak/KYC tetap tanggung jawab operator di luar aplikasi. Penghapusan akun memanggil `piwu_purge_seller_pii` untuk menghapus baris KYC dan sengketa yang melibatkan akun itu serta menulis ulang tujuan transfer menjadi `[dihapus]`; nominal/status/referensi dipertahankan sebagai catatan keuangan.
9. Sengketa marketplace tidak mengirim uang dan **PiwuApp tidak menyediakan refund**. Pembeli melapor sekali per pesanan (30 hari), penjual membalas sekali, dan hanya superadmin yang menutup atau menolak laporan. Status `open`/`seller_replied` menahan bagian penjual dari penjualan itu; menutup/menolak/menarik laporan melepasnya tanpa mengembalikan uang. RLS membatasi baris sengketa ke pembeli/penjual yang bersangkutan. Callback provider yang menyatakan `refunded` tetap ditangani `piwu_apply_payment` sebagai pembatalan/chargeback di luar kendali aplikasi, bukan fitur refund PiwuApp.
10. Uji backup/restore dan key rotation; rekaman lokal/cloud dan transaksi memerlukan kebijakan bisnis/penghapusan akun yang eksplisit.
11. Rencana harga/tier belum menjadi sistem entitlement fitur lengkap. Snapshot UI, label plan dan data pemakaian bukan bukti pembayaran; gunakan ledger/provider settlement.
12. **Kunci API data aplikasi (migration 016)** hanya menyentuh dataset satu project, maksimal lima kunci aktif, dan hanya hash SHA-256 yang disimpan setelah plaintext ditampilkan sekali. Kunci **bukan identitas pengguna akhir**: tidak ada login aplikasi, izin per baris, kuota per kunci, atau audit per permintaan. Kunci yang ditanam di aplikasi web atau place Roblox dapat dibaca pengguna; gunakan kunci baca saja di klien dan simpan kunci tulis di server operator. CORS `*` hanya dibuka untuk `/api/public/app/*`, dan semua penulisan tetap lewat RPC service-only yang memvalidasi cakupan, tipe, ukuran, dan revisi.

## Bukti pengujian

PGlite menjalankan PostgreSQL nyata dengan mock auth/storage schemas, termasuk seluruh migration. API/provider contracts diuji memakai fixture/mock; UI memakai browser Chromium. Ini **bukan** uji layanan eksternal live, pentest, sertifikasi PCI, jaminan fraud prevention, atau bukti kesiapan produksi. Lihat [STATUS.md](STATUS.md) dan [SERVICES_SETUP.md](SERVICES_SETUP.md).

Dataset cloud memvalidasi tipe/ukuran di API **dan PostgreSQL**, mencabut direct writes, dan memakai JWT pemanggil untuk RPC. Draft IndexedDB terpisah per akun namun tidak terenkripsi. Viewer tidak boleh menyimpan; role UI bukan otorisasi. Lihat PROJECT_DATA.md untuk batas dan acceptance.

## Administrasi platform (migration 005)

- `/admin` bukan pemberi hak akses; tidak ada mode preview admin. JWT terverifikasi + role tabel server, bukan user metadata.
- Service-only action RPC memeriksa role terbaru, alasan, idempotency, audit atomik dan proteksi superadmin terakhir. Whitelist API menolak actor/payload tambahan dan status paid manual.
- Suspension: pemeriksaan API serta restrictive RLS/RPC; project lock dan maintenance membatasi mutasi cloud. Pekerjaan build/sandbox memeriksa kontrol sebelum jalan; operasi eksternal yang sedang berlangsung tidak bisa dibatalkan secara atomik.
- Broadcast publik tidak menggunakan user ID browser. Member/paid segment diperiksa database; plain text, jadwal/expiry dan receipt unik. Tidak ada pesan massal email/WhatsApp.
- Audit/daftar admin tidak menampilkan secret, token share, atau snapshot project. Pemilik database dan pemegang service key tetap dapat melewati batas aplikasi; amankan infrastruktur dan backup.
- Schema policies perlu ditinjau untuk setiap tabel baru; middleware API saja tidak cukup karena Supabase REST dapat diakses langsung. Detail bootstrap, batas, dan uji staging: [ADMIN.md](ADMIN.md).

## Audit terbaru dan risiko terbuka

[Laporan admin/produksi](ADMIN_PRODUCTION_VERIFICATION.md): 84 tes lokal lulus, termasuk dua server HTTP dengan SQL bersama. Ini bukan cluster multi-mesin atau pentest penuh. RPC direktori admin memeriksa actor dan hanya dapat dipanggil service role; CSV melindungi formula; produksi tidak mengabaikan skema kontrol admin yang hilang.

**Dependency utama: 0 advisory diketahui. Scaffold Expo SDK 57: 15 paket terdampak severity high**, berasal dari `braces` dan `node-forge` yang belum memiliki rilis stabil bertambal saat pemeriksaan. Tidak ada klaim seluruh produk bebas kerentanan. Jangan menjalankan input native tak tepercaya/signing sensitif sampai mitigasi ditinjau. Audit harus diulang terhadap lockfile project hasil ekspor.
