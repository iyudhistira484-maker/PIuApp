import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowUpRight, AlertTriangle, BadgeCheck, Ban, BookOpen, CreditCard, FileText, Globe, Heart, Info, Lock, Mail, Scale, ShieldCheck, Building, EyeOff, MessageSquare, FileWarning, Briefcase, Users
} from "lucide-react";
import { DocsHeader } from "../components/docs/DocsNav";
import "./docs.css";

const toc = [
  { id: "ketentuan-umum", label: "Ketentuan umum", items: [
    { id: "penerimaan", label: "Penerimaan & definisi" },
    { id: "perubahan", label: "Perubahan ketentuan" },
  ]},
  { id: "akun", label: "Akun & akses", items: [
    { id: "akun-syarat", label: "Syarat akun" },
    { id: "peran", label: "Peran & tanggung jawab" },
  ]},
  { id: "konten", label: "Konten & hak", items: [
    { id: "kepemilikan", label: "Kepemilikan kode" },
    { id: "hak-cipta", label: "Hak cipta & lisensi" },
  ]},
  { id: "larangan", label: "Penggunaan dilarang", items: [
    { id: "dilarang", label: "Daftar larangan" },
    { id: "penegakan", label: "Penegakan" },
  ]},
  { id: "pembayaran", label: "Pembayaran", items: [
    { id: "kredit-paket", label: "Kredit & paket" },
    { id: "final-tanpa-refund", label: "Final — tanpa refund" },
    { id: "sengketa-pb", label: "Sengketa marketplace" },
  ]},
  { id: "privasi", label: "Privasi & komunitas", items: [
    { id: "privasi-data", label: "Privasi data" },
    { id: "komunitas", label: "Komunitas" },
    { id: "kontak", label: "Kontak & pengaduan" },
  ]},
];

function useActiveSection(ids: string[]) {
  const [active, setActive] = useState(ids[0]);
  useEffect(() => {
    const obs = new IntersectionObserver((entries) => { for (const e of entries) if (e.isIntersecting) setActive(e.target.id); }, { rootMargin: "-20% 0px -70% 0px", threshold: 0 });
    ids.forEach((id) => { const el = document.getElementById(id); if (el) obs.observe(el); });
    return () => obs.disconnect();
  }, [ids.join(",")]);
  return active;
}

export default function Aturan() {
  const allIds = toc.flatMap(g => g.items.map(i => i.id));
  const active = useActiveSection(allIds);

  return (
    <div className="docs-page">
      <DocsHeader active="aturan" />

      <div className="docs-hero">
        <div className="docs-hero-inner">
          <nav aria-label="Breadcrumb" style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#8a8d85", marginBottom: 14 }}>
            <Link to="/" style={{ color: "#5a6258", textDecoration: "none" }}>Beranda</Link>
            <span style={{ color: "#c2c5bc" }}>›</span>
            <span style={{ color: "var(--docs-ink)", fontWeight: 500 }}>Aturan</span>
            <span style={{ marginLeft: 8, padding: "2px 7px", borderRadius: 99, background: "#fff", border: "1px solid var(--docs-line)", fontSize: 10, fontWeight: 600, letterSpacing: "0.06em", color: "#6b7068" }}>v1.2 · 18 OKT 2026</span>
          </nav>
          <div className="docs-eyebrow"><i /> Aturan & ketentuan — Berlaku 18 Okt 2026</div>
          <h1>Aturan <em>PiwuApp</em> — jelas, adil, dan tidak berbelit.</h1>
          <p className="docs-hero-lead">
            Dokumen ini mengikat penggunaan PiwuApp. Kami tulis dengan bahasa yang bisa dipahami — tanpa pasal karet. Jika ada konflik antara ringkasan dan ketentuan lengkap, ketentuan lengkap yang berlaku.
          </p>
          <div className="docs-hero-meta">
            <span className="docs-meta-pill"><Scale size={13} /> <b>Versi 1.2</b> · terakhir 18 Okt 2026</span>
            <span className="docs-meta-pill"><Globe size={13} /> Yurisdiksi: Indonesia</span>
            <span className="docs-meta-pill"><Mail size={13} /> support@piwuapp.id</span>
          </div>
          <div className="docs-quick">
            <a href="#final-tanpa-refund"><span className="docs-quick-icon"><CreditCard size={16} /></span><span><b>Pembayaran final</b><span>Tanpa refund — baca sebelum beli</span></span></a>
            <a href="#kepemilikan"><span className="docs-quick-icon"><FileText size={16} /></span><span><b>Kode milik Anda</b><span>Hak & batas penggunaan</span></span></a>
            <a href="#dilarang"><span className="docs-quick-icon"><Ban size={16} /></span><span><b>Yang dilarang</b><span>Agar ruang tetap aman</span></span></a>
          </div>
        </div>
      </div>

      <div className="docs-layout">
        <aside className="docs-toc" aria-label="Daftar isi">
          <div className="docs-toc-title">Daftar isi</div>
          {toc.map(g => (
            <div key={g.id} className="docs-toc-group">
              <b>{g.label}</b>
              {g.items.map(it => <a key={it.id} href={`#${it.id}`} className={active === it.id ? "is-active" : ""}>{it.label}</a>)}
            </div>
          ))}
        </aside>

        <article className="docs-content docs-article">
          {/* KETENTUAN UMUM */}
          <section id="penerimaan">
            <h2><small>01 — Ketentuan umum</small>Penerimaan & definisi</h2>
            <p>Dengan membuat akun, masuk, atau menggunakan layanan PiwuApp, Anda menyetujui dokumen ini beserta <Link to="/dokumentasi">Dokumentasi</Link> dan <Link to="/panduan">Panduan</Link> sebagai bagian yang tidak terpisahkan.</p>
            <div className="docs-table-wrap">
              <table>
                <thead><tr><th>Istilah</th><th>Arti</th></tr></thead>
                <tbody>
                  <tr><td><b>PiwuApp / Kami</b></td><td>Penyedia layanan workspace PiwuApp.</td></tr>
                  <tr><td><b>Anda / Pengguna</b></td><td>Pemilik akun yang menggunakan layanan.</td></tr>
                  <tr><td><b>Workspace</b></td><td>Ruang kerja browser (editor, preview, terminal) + sinkronisasi cloud.</td></tr>
                  <tr><td><b>Project</b></td><td>Kumpulan file, versi, dan konfigurasi dalam satu workspace.</td></tr>
                  <tr><td><b>Kredit</b></td><td>Satuan pemakaian AI/sandbox/audit. Dibeli via paket/top-up atau jatah harian Free.</td></tr>
                  <tr><td><b>Provider</b></td><td>Layanan eksternal (LLM, pembayaran, pencarian) yang diaktifkan admin.</td></tr>
                </tbody>
              </table>
            </div>
            <p>Jika Anda tidak setuju, hentikan penggunaan dan hapus akun. Penggunaan berkelanjutan dianggap persetujuan.</p>
          </section>

          <section id="perubahan">
            <h3>Perubahan ketentuan</h3>
            <p>Kami dapat memperbarui aturan untuk mengikuti hukum, fitur baru, atau perbaikan keamanan. Perubahan penting diumumkan di dashboard dan dicatat dengan tanggal berlaku. Versi terbaru selalu di halaman ini.</p>
            <ul>
              <li>Perubahan minor (typo, klarifikasi) berlaku saat dipublish.</li>
              <li>Perubahan material (harga, hak, privasi) diumumkan minimal 7 hari sebelum berlaku.</li>
              <li>Jika Anda menolak perubahan material, hentikan penggunaan sebelum tanggal berlaku.</li>
            </ul>
          </section>

          <hr />

          {/* AKUN */}
          <section id="akun-syarat">
            <h2><small>02 — Akun & akses</small>Syarat akun</h2>
            <ul>
              <li>Usia minimal 13 tahun. Di bawah 18 tahun butuh izin wali.</li>
              <li>Satu orang satu akun utama. Akun tim dikelola via undangan project, bukan multi-akun.</li>
              <li>Email harus valid & terverifikasi. Kami kirim notifikasi penting ke email ini.</li>
              <li>Jaga kerahasiaan password & session. Aktivitas di akun Anda adalah tanggung jawab Anda.</li>
              <li>Dilarang menjual/menyewakan akun.</li>
            </ul>
            <div className="docs-callout docs-callout--info">
              <span className="docs-callout-icon"><Lock size={14} /></span>
              <div><b>Keamanan akun</b><p>Gunakan password kuat & unik. Jika curiga akun disusupi, ganti password segera dan hubungi support. Kami tidak pernah minta password via email/chat.</p></div>
            </div>
          </section>

          <section id="peran">
            <h3>Peran & tanggung jawab</h3>
            <div className="docs-table-wrap">
              <table>
                <thead><tr><th>Peran</th><th>Hak</th><th>Tanggung jawab</th></tr></thead>
                <tbody>
                  <tr><td><b>Owner</b></td><td>Kelola anggota, hapus project, atur secrets</td><td>Menentukan siapa bisa akses & apa yang dibagikan</td></tr>
                  <tr><td><b>Editor</b></td><td>Baca & tulis file, jalankan AI</td><td>Menjaga kualitas & tidak merusak project orang lain</td></tr>
                  <tr><td><b>Viewer</b></td><td>Baca saja</td><td>Tidak bisa push — tapi tetap jaga kerahasiaan yang dilihat</td></tr>
                </tbody>
              </table>
            </div>
            <p>Owner bertanggung jawab penuh atas konten & undangan di projectnya. Jika anggota melanggar, Owner ikut diminta pertanggungjawaban.</p>
          </section>

          <hr />

          {/* KONTEN & HAK */}
          <section id="kepemilikan">
            <h2><small>03 — Konten & hak</small>Kepemilikan kode — milik Anda</h2>
            <p><strong>Kode yang Anda buat di PiwuApp adalah milik Anda.</strong> Anda bebas mengedit, menyalin, memindahkan, dan mempublikasikan di mana saja. PiwuApp tidak mengklaim kepemilikan atas project Anda.</p>
            <ul>
              <li>Ekspor ZIP kapan saja — tidak ada periode kunci.</li>
              <li>Tidak ada watermark atau ketergantungan runtime PiwuApp di hasil build (kecuali Anda sengaja pakai).</li>
              <li>Template PiwuApp bebas dipakai untuk project komersial — tapi jangan jual ulang template mentah sebagai produk Anda.</li>
            </ul>
            <div className="docs-callout docs-callout--info">
              <span className="docs-callout-icon"><BadgeCheck size={14} /></span>
              <div><b>Apa yang bukan milik Anda</b><p>Merek, logo, desain landing, dan infrastruktur PiwuApp tetap milik kami. Jangan tiru identitas PiwuApp untuk mengelabui pengguna lain.</p></div>
            </div>
          </section>

          <section id="hak-cipta">
            <h3>Hak cipta & lisensi</h3>
            <ul>
              <li>Anda menjamin konten yang Anda upload (teks, gambar, foto) adalah milik Anda atau berizin.</li>
              <li>Dengan mengupload, Anda memberi PiwuApp lisensi terbatas untuk menyimpan, menampilkan, dan memproses konten demi menjalankan layanan (mis. render preview). Lisensi berakhir saat Anda hapus konten, kecuali backup hukum.</li>
              <li>Laporan pelanggaran hak cipta: kirim ke <a href="mailto:support@piwuapp.id">support@piwuapp.id</a> dengan bukti kepemilikan & URL project.</li>
              <li>Kami hargai DMCA-like takedown: konten yang jelas melanggar akan diturunkan sementara menunggu klarifikasi.</li>
            </ul>
            <p><strong>Tanggung jawab publish:</strong> Sebelum mempublikasikan, tinjau kode, lisensi dependensi, dan hak aset (font, ikon, foto). PiwuApp tidak memeriksa legalitas project Anda.</p>
          </section>

          <hr />

          {/* LARANGAN */}
          <section id="dilarang">
            <h2><small>04 — Penggunaan dilarang</small>Daftar larangan</h2>
            <p>Aturan ini menjaga ruang tetap aman untuk semua. Pelanggaran berat bisa berujung suspensi permanen.</p>
            <div className="docs-cards">
              <div className="docs-card">
                <h4><Ban size={14} /> Keamanan & penyalahgunaan</h4>
                <ul>
                  <li>Meretas, bypass RLS, brute-force, atau scrape agresif.</li>
                  <li>Menyisipkan malware, crypto-miner, atau spam di preview/project.</li>
                  <li>Menyalahgunakan kredit, referral, atau percobaan curang pembayaran.</li>
                </ul>
              </div>
              <div className="docs-card">
                <h4><EyeOff size={14} /> Konten berbahaya</h4>
                <ul>
                  <li>Pornografi anak, kekerasan ekstrem, ujaran kebencian.</li>
                  <li>Penipuan, phishing, atau impersonasi.</li>
                  <li>Pelanggaran privasi: doxxing, data pribadi tanpa izin.</li>
                </ul>
              </div>
              <div className="docs-card">
                <h4><FileWarning size={14} /> HKI & ilegal</h4>
                <ul>
                  <li>Plagiat, pembajakan, atau distribusi konten bajakan.</li>
                  <li>Konten ilegal menurut hukum Indonesia.</li>
                  <li>Spam marketplace / template duplikat massal.</li>
                </ul>
              </div>
              <div className="docs-card">
                <h4><Users size={14} /> Komunitas</h4>
                <ul>
                  <li>Harassment, intimidasi, atau diskriminasi.</li>
                  <li>Akun palsu massal atau manipulasi voting/rating.</li>
                  <li>Promosi judi, pinjaman ilegal, atau skema ponzi.</li>
                </ul>
              </div>
            </div>
          </section>

          <section id="penegakan">
            <h3>Penegakan</h3>
            <div className="docs-table-wrap">
              <table>
                <thead><tr><th>Tingkat</th><th>Tindakan</th><th>Contoh</th></tr></thead>
                <tbody>
                  <tr><td><span className="docs-badge docs-badge--sage">Ringan</span></td><td>Peringatan + konten diturunkan</td><td>Typo HKI, spam ringan</td></tr>
                  <tr><td><span className="docs-badge docs-badge--warn">Sedang</span></td><td>Project dibekukan 7–30 hari</td><td>Pelanggaran berulang, abuse kredit</td></tr>
                  <tr><td><span className="docs-badge docs-badge--pine">Berat</span></td><td>Akun suspend permanen + report hukum bila perlu</td><td>Malware, CSAM, penipuan</td></tr>
                </tbody>
              </table>
            </div>
            <p>Keputusan moderasi bisa diajukan banding via email dalam 14 hari. Kami tinjau dengan bukti, bukan perasaan.</p>
          </section>

          <hr />

          {/* PEMBAYARAN */}
          <section id="kredit-paket">
            <h2><small>05 — Pembayaran</small>Kredit & paket</h2>
            <p>Harga & jatah kredit mengikuti tabel di <Link to="/#pricing">landing</Link> dan <Link to="/dokumentasi#paket-harga">dokumentasi</Link>. Angka yang tampil di composer sama dengan yang ditagih server — satu sumber kebenaran di <code>shared/credits.mjs</code>.</p>
            <div className="docs-table-wrap">
              <table>
                <thead><tr><th>Paket</th><th>Harga / 30 hari</th><th>Kredit</th><th>Jatah harian</th><th>Masa berlaku</th></tr></thead>
                <tbody>
                  <tr><td><b>Free</b></td><td>Gratis</td><td>—</td><td>20/hari, plafon 600/bulan</td><td>Reset 00:00 UTC</td></tr>
                  <tr><td><b>Pro</b></td><td>Rp 199.000</td><td>1.500</td><td>30/hari</td><td>2 bulan</td></tr>
                  <tr><td><b>Team</b></td><td>Rp 499.000</td><td>4.500</td><td>40/hari</td><td>2 bulan</td></tr>
                </tbody>
              </table>
            </div>
            <ul>
              <li>Jatah harian Free tidak menumpuk — hangus tiap 00:00 UTC.</li>
              <li>Kredit paket hangus 2 bulan setelah diberikan; top-up 12 bulan.</li>
              <li>Perkiraan “tahan berapa lama” adalah aritmetika biaya nyata, bukan janji durasi.</li>
            </ul>
          </section>

          <section id="final-tanpa-refund">
            <h3><span className="docs-badge docs-badge--pine" style={{ verticalAlign: "middle", marginRight: 8 }}>Penting</span> Pembelian final — tanpa refund</h3>
            <p><strong>Semua pembelian bersifat final dan tidak dapat di-refund:</strong> paket (Free/Pro/Team), top-up kredit, dan template marketplace. Pastikan Anda memahami kebutuhan sebelum checkout.</p>
            <div className="docs-callout docs-callout--danger">
              <span className="docs-callout-icon"><AlertTriangle size={14} /></span>
              <div><b>Mengapa tanpa refund?</b><p>Kredit dipakai instan untuk AI/sandbox/audit dan tidak bisa ditarik kembali dari provider. Kebijakan ini mencegah abuse dan menjaga harga tetap rendah untuk semua. Jika provider eksternal memproses refund/chargeback, sistem otomatis mencabut kredit/entitlement terkait.</p></div>
            </div>
            <ul>
              <li>Checkout menampilkan ringkasan final sebelum bayar — periksa dengan teliti.</li>
              <li>Kesalahan tagih (double charge) tetap ditangani: lapor dengan bukti pembayaran, kami koreksi via kredit/batal tagih provider — bukan refund tunai sepihak.</li>
              <li>Pembatalan langganan: paket tetap aktif sampai akhir periode 30 hari, tidak ada prorata.</li>
            </ul>
            <p>Pertanyaan tagihan: <a href="mailto:support@piwuapp.id">support@piwuapp.id</a> dengan subject “Tagihan — [Order ID]”.</p>
          </section>

          <section id="sengketa-pb">
            <h3>Sengketa marketplace</h3>
            <p>Untuk jual-beli template/layanan di marketplace:</p>
            <div className="docs-table-wrap">
              <table>
                <thead><tr><th>Status</th><th>Arti</th><th>Dana penjual</th></tr></thead>
                <tbody>
                  <tr><td><b>open</b></td><td>Laporan dibuka pembeli</td><td>Ditahan sementara</td></tr>
                  <tr><td><b>seller_replied</b></td><td>Penjual menjawab</td><td>Tetap ditahan</td></tr>
                  <tr><td><b>resolved</b></td><td>Admin tutup laporan (selesai)</td><td>Dilepas</td></tr>
                  <tr><td><b>rejected</b></td><td>Admin tolak laporan</td><td>Dilepas</td></tr>
                  <tr><td><b>withdrawn</b></td><td>Pembeli tarik laporan</td><td>Dilepas</td></tr>
                </tbody>
              </table>
            </div>
            <p>Tidak ada transfer uang otomatis di alur sengketa — payout dicatat manual oleh admin setelah verifikasi. Tidak ada skema escrow otomatis.</p>
          </section>

          <hr />

          {/* PRIVASI */}
          <section id="privasi-data">
            <h2><small>06 — Privasi & komunitas</small>Privasi data</h2>
            <p>Kami minimalkan data: hanya yang perlu untuk menjalankan workspace. Ringkasan:</p>
            <div className="docs-table-wrap">
              <table>
                <thead><tr><th>Data</th><th>Tujuan</th><th>Disimpan</th></tr></thead>
                <tbody>
                  <tr><td>Email, nama, password hash</td><td>Auth (Supabase)</td><td>Supabase Auth</td></tr>
                  <tr><td>Project file & versi</td><td>Workspace & sync</td><td>IndexedDB + Postgres (RLS)</td></tr>
                  <tr><td>Kredit & transaksi</td><td>Penagihan</td><td>Postgres, audit log</td></tr>
                  <tr><td>Log akses & error</td><td>Keamanan & debug</td><td>Server, retensi terbatas</td></tr>
                </tbody>
              </table>
            </div>
            <ul>
              <li><strong>Tidak menjual data.</strong> Data tidak dijual ke pihak ketiga.</li>
              <li><strong>Enkripsi transit:</strong> HTTPS wajib (reverse proxy). Secrets dienkripsi at-rest.</li>
              <li><strong>Hak Anda:</strong> akses, koreksi, hapus akun (project ikut terhapus permanen setelah konfirmasi).</li>
              <li><strong>AI provider:</strong> prompt/file yang dikirim ke LLM tunduk pada kebijakan provider tersebut — jangan kirim data sensitif.</li>
              <li><strong>Foto project:</strong> disimpan di browser (IndexedDB) — bukan cloud — hingga 12 foto / 16 MB per project.</li>
            </ul>
            <div className="docs-callout docs-callout--info">
              <span className="docs-callout-icon"><Lock size={14} /></span>
              <div><b>Jangan hardcode secret</b><p>API key, token, password — taruh di panel secrets terenkripsi, bukan di file. File tersimpan sebagai versi dan bisa dilihat anggota project.</p></div>
            </div>
          </section>

          <section id="komunitas">
            <h3>Komunitas</h3>
            <p>Komunitas PiwuApp (Discord/forum — segera) adalah ruang saling bantu. Aturan komunitas = aturan platform +:</p>
            <ul>
              <li>Hargai pemula — tidak ada pertanyaan bodoh.</li>
              <li>Bagikan karya, bukan spam. Satu showcase per project, bukan flood.</li>
              <li>Kritik membangun, bukan menyerang personal.</li>
              <li>Moderator bisa hapus pesan & timeout tanpa peringatan untuk pelanggaran jelas.</li>
            </ul>
            <p>Pelanggaran komunitas berulang berdampak ke akun platform.</p>
          </section>

          <section id="kontak">
            <h3>Kontak & pengaduan</h3>
            <div className="docs-cards">
              <div className="docs-card">
                <h4><Mail size={14} /> Support umum</h4><p><a href="mailto:support@piwuapp.id">support@piwuapp.id</a><br />Respon 1×24 jam kerja.</p>
              </div>
              <div className="docs-card">
                <h4><FileWarning size={14} /> Pelanggaran & HKI</h4><p><a href="mailto:support@piwuapp.id">support@piwuapp.id</a> — subject “Laporan — [jenis]”.</p>
              </div>
              <div className="docs-card">
                <h4><ShieldCheck size={14} /> Keamanan</h4><p>Lapor celah keamanan dengan detail reproduksi. Kami hargai responsible disclosure.</p>
              </div>
              <div className="docs-card">
                <h4><Building size={14} /> Legal</h4><p>Untuk panggilan hukum/somasi, sertakan kop surat & kontak kuasa hukum.</p>
              </div>
            </div>
            <p style={{ marginTop: 16, fontSize: 12, color: "#8a8d85" }}>Alamat surat tercatat akan ditambahkan saat entitas hukum final. Sementara, korespondensi via email adalah saluran resmi.</p>
          </section>

          <div className="docs-pager">
            <Link to="/panduan">
              <span>‹ Sebelumnya</span>
              <b>Panduan</b>
              <p>Langkah-demi-langkah sampai publish</p>
            </Link>
            <Link to="/dokumentasi">
              <span>Selanjutnya ›</span>
              <b>Dokumentasi</b>
              <p>Referensi lengkap & biaya</p>
            </Link>
          </div>
        </article>

        <aside className="docs-aside">
          <div className="docs-aside-card">
            <h4>Ringkasan</h4>
            <a href="#final-tanpa-refund"><AlertTriangle size={13} /> Tanpa refund — pahami dulu</a>
            <a href="#kepemilikan"><FileText size={13} /> Kode milik Anda</a>
            <a href="#privasi-data"><Lock size={13} /> Privasi & data</a>
            <a href="#kontak"><Mail size={13} /> Hubungi kami</a>
          </div>
          <div className="docs-aside-note">
            <b>Yurisdiksi:</b> Indonesia. Sengketa diselesaikan musyawarah → mediasi → pengadilan kompeten di Indonesia.
          </div>
          <div className="docs-aside-card" style={{ marginTop: 14 }}>
            <h4>Dokumen terkait</h4>
            <a href="/dokumentasi"><BookOpen size={13} /> Dokumentasi</a>
            <a href="/panduan"><FileText size={13} /> Panduan</a>
            <a href="/#pricing"><CreditCard size={13} /> Harga & paket</a>
          </div>
        </aside>
      </div>

      <footer className="docs-footer">
        <span>© {new Date().getFullYear()} PiwuApp · Aturan v1.2 · Berlaku 18 Okt 2026</span>
        <span><Link to="/">Beranda</Link> · <Link to="/dokumentasi">Dokumentasi</Link> · <Link to="/panduan">Panduan</Link></span>
      </footer>
    </div>
  );
}

