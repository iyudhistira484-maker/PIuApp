import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowUpRight, BookOpen, Check, ClipboardCheck, Clock, Code2, Compass, Copy, Download, FileText, Globe, Layers, Menu, MessageSquare, Monitor, PenTool, Play, Search, ShieldCheck, Terminal, Wrench, X, Zap, AlertTriangle, History, Eye, Package, Gamepad
} from "lucide-react";
import { Logo } from "../components/ui";
import "./docs.css";

const toc = [
  { id: "mulai-cepat", label: "Mulai cepat", items: [
    { id: "daftar", label: "Daftar & masuk" },
    { id: "project-pertama", label: "Project pertama" },
    { id: "lima-menit", label: "Checklist 5 menit" },
  ]},
  { id: "bekerja-ai", label: "Bekerja dengan AI", items: [
    { id: "composer", label: "Composer & prompt" },
    { id: "mode-plan", label: "Mode Plan vs Builder" },
    { id: "mode-riset", label: "Mode Riset" },
    { id: "iterasi", label: "Iterasi & revisi" },
  ]},
  { id: "edit-preview", label: "Edit & preview", items: [
    { id: "editor-kode", label: "Editor kode" },
    { id: "canvas-preview", label: "Canvas & preview" },
    { id: "terminal-panel", label: "Terminal" },
  ]},
  { id: "kelola", label: "Kelola project", items: [
    { id: "simpan-versi", label: "Simpan & versi" },
    { id: "kolaborasi", label: "Kolaborasi" },
    { id: "ekspor-hosting", label: "Ekspor & hosting" },
  ]},
  { id: "khusus", label: "Kasus khusus", items: [
    { id: "mobile-expo", label: "Mobile (Expo)" },
    { id: "roblox-game", label: "Roblox game" },
    { id: "troubleshoot", label: "Troubleshooting" },
  ]},
];

function DocsHeader({ active }: { active: string }) {
  const [open, setOpen] = useState(false);
  return (
    <header className="docs-header">
      <div className="docs-header-inner">
        <Link to="/" aria-label="PiwuApp beranda"><Logo /></Link>
        <nav className={`docs-nav ${open ? "is-open" : ""}`} aria-label="Navigasi docs">
          <Link to="/dokumentasi" className={active === "dokumentasi" ? "is-active" : ""} onClick={() => setOpen(false)}>Dokumentasi</Link>
          <Link to="/panduan" className={active === "panduan" ? "is-active" : ""} onClick={() => setOpen(false)}>Panduan</Link>
          <Link to="/aturan" className={active === "aturan" ? "is-active" : ""} onClick={() => setOpen(false)}>Aturan</Link>
          <Link to="/#pricing" onClick={() => setOpen(false)}>Harga</Link>
        </nav>
        <div className="docs-header-actions">
          <Link to="/projects" className="docs-cta">Buka workspace <ArrowUpRight size={14} /></Link>
          <button className="docs-mobile-toggle" aria-label={open ? "Tutup" : "Buka"} onClick={() => setOpen(!open)}>{open ? <X size={18} /> : <Menu size={18} />}</button>
        </div>
      </div>
    </header>
  );
}
function useActiveSection(ids: string[]) {
  const [active, setActive] = useState(ids[0]);
  useEffect(() => {
    const obs = new IntersectionObserver((entries) => { for (const e of entries) if (e.isIntersecting) setActive(e.target.id); }, { rootMargin: "-20% 0px -70% 0px", threshold: 0 });
    ids.forEach((id) => { const el = document.getElementById(id); if (el) obs.observe(el); });
    return () => obs.disconnect();
  }, [ids.join(",")]);
  return active;
}

export default function Panduan() {
  const allIds = toc.flatMap(g => g.items.map(i => i.id));
  const active = useActiveSection(allIds);
  const [copied, setCopied] = useState("");
  const copy = (t: string, id: string) => { navigator.clipboard.writeText(t).then(() => { setCopied(id); setTimeout(() => setCopied(""), 1500); }); };

  return (
    <div className="docs-page">
      <DocsHeader active="panduan" />

      <div className="docs-hero">
        <div className="docs-hero-inner">
          <div className="docs-eyebrow"><i /> Panduan <span style={{ color: "#9aa09a" }}>·</span> Langkah-demi-langkah</div>
          <h1>Panduan <em>PiwuApp</em> — dari nol sampai publish, tanpa tebak-tebakan.</h1>
          <p className="docs-hero-lead">Ikuti langkah nyata, bukan janji. Setiap bagian menjelaskan apa yang terjadi, berapa kredit yang terpakai, dan apa yang bisa salah — jadi Anda tidak buang waktu mengulang.</p>
          <div className="docs-hero-meta">
            <span className="docs-meta-pill"><Clock size={13} /> <b>5 menit</b> sampai preview pertama</span>
            <span className="docs-meta-pill"><ClipboardCheck size={13} /> Cocok untuk pemula & developer</span>
            <span className="docs-meta-pill"><Code2 size={13} /> Bahasa Indonesia</span>
          </div>
          <div className="docs-quick">
            <Link to="#project-pertama"><span className="docs-quick-icon"><Play size={16} /></span><span><b>Buat project pertama</b><span>Template → prompt → preview</span></span></Link>
            <Link to="#mode-riset"><span className="docs-quick-icon"><Search size={16} /></span><span><b>Riset berbantuan AI</b><span>Cari sumber, kutip otomatis</span></span></Link>
            <Link to="#ekspor-hosting"><span className="docs-quick-icon"><Download size={16} /></span><span><b>Ekspor & hosting</b><span>ZIP keluar, deploy di tempat Anda</span></span></Link>
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
          {/* MULAI CEPAT */}
          <section id="daftar">
            <h2><small>01 — Mulai cepat</small>Daftar & masuk</h2>
            <p className="lead">PiwuApp butuh akun terverifikasi. Tanpa akun, Anda tetap bisa melihat landing, template, dan harga — tapi workspace terkunci.</p>
            <div className="docs-steps">
              <div className="docs-step"><span className="docs-step-num">01</span><div><b>Buka /login</b><p>Daftar dengan email atau Google. Verifikasi email bila diminta — cek status koneksi di halaman login.</p></div></div>
              <div className="docs-step"><span className="docs-step-num">02</span><div><b>Masuk & cek kredit</b><p>Free = 20 kredit/hari (plafon 600/bulan). Lihat sisa kredit di sidebar dashboard. Habis? Tunggu reset 00:00 UTC atau upgrade.</p></div></div>
              <div className="docs-step"><span className="docs-step-num">03</span><div><b>Buka dashboard</b><p>Di <code>/projects</code> Anda lihat project, template, dan panel “Menunggu Anda”. Klik <b>Project baru</b> untuk mulai.</p></div></div>
            </div>
            <div className="docs-callout docs-callout--info">
              <span className="docs-callout-icon"><ShieldCheck size={14} /></span>
              <div><b>Demo tidak tersedia di versi ini</b><p>Login demo/preset lokal sudah dihapus. Semua project butuh akun asli dan data disimpan per akun (IndexedDB + cloud).</p></div>
            </div>
          </section>

          <section id="project-pertama">
            <h3>Project pertama — dua jalur</h3>
            <div className="docs-cards">
              <div className="docs-card">
                <h4><Layers size={14} /> Jalur A — dari template</h4>
                <p>Paling cepat untuk pemula.</p>
                <ol style={{ marginLeft: 16, fontSize: 12.5 }}>
                  <li>Buka <Link to="/#templates">koleksi template</Link> → pilih kategori.</li>
                  <li>Klik “Gunakan template” → prompt terisi otomatis.</li>
                  <li>Pilih jenis project (Web App default) → Submit.</li>
                </ol>
              </div>
              <div className="docs-card">
                <h4><PenTool size={14} /> Jalur B — dari ide bebas</h4>
                <p>Untuk kebutuhan spesifik.</p>
                <ol style={{ marginLeft: 16, fontSize: 12.5 }}>
                  <li>Tulis deskripsi: “Buat landing page untuk klinik gigi: hero, layanan, testimoni, kontak.”</li>
                  <li>Pilih <code>Builder</code> atau <code>Plan</code> di composer.</li>
                  <li>Kirim → tinjau rencana → eksekusi.</li>
                </ol>
              </div>
            </div>
            <h3>Contoh prompt yang efektif</h3>
            <div className="docs-code">
              <div className="docs-code-head"><span><i /> prompt — bagus vs kurang</span><button onClick={() => copy(`Buat toko online untuk brand kopi "Kopi Tujuh":\n- Katalog dengan filter kategori & pencarian\n- Keranjang + checkout (tanpa pembayaran real)\n- Halaman admin sederhana untuk tambah produk\n- Responsive mobile-first, warna earth tone`, "prompt")} style={{ color: copied === "prompt" ? "#8fbf8a" : "#9aa89a", fontSize: 11 }}>{copied === "prompt" ? <><Check size={12} /> Tersalin</> : <><Copy size={12} /> Salin</>}</button></div>
              <pre><code>{`✅ Bagus — spesifik & terukur
"Buat toko online untuk brand kopi \\"Kopi Tujuh\\":
- Katalog dengan filter kategori & pencarian
- Keranjang + checkout (tanpa pembayaran real)
- Halaman admin sederhana untuk tambah produk
- Responsive mobile-first, warna earth tone"

❌ Kurang — terlalu umum
"Buat website keren untuk jualan"
→ AI akan menebak, hasil sulit direvisi.`}</code></pre>
            </div>
          </section>

          <section id="lima-menit">
            <h3>Checklist 5 menit</h3>
            <div className="docs-table-wrap">
              <table>
                <thead><tr><th><Check size={12} /> Langkah</th><th>Waktu</th><th>Kredit</th></tr></thead>
                <tbody>
                  <tr><td>Daftar & buka dashboard</td><td>~1 menit</td><td>0</td></tr>
                  <tr><td>Pilih template / tulis prompt</td><td>~1 menit</td><td>0</td></tr>
                  <tr><td>AI susun rencana (Plan)</td><td>~30 detik</td><td>2</td></tr>
                  <tr><td>Builder eksekusi (Cepat)</td><td>~1–2 menit</td><td>1</td></tr>
                  <tr><td>Lihat preview, edit kecil</td><td>~1 menit</td><td>0–1</td></tr>
                </tbody>
              </table>
            </div>
            <p>Jika Free 20/hari, satu project sederhana menghabiskan ~3–4 kredit. Cek estimasi di composer sebelum submit.</p>
          </section>

          <hr />

          {/* BEKERJA DENGAN AI */}
          <section id="composer">
            <h2><small>02 — Bekerja dengan AI</small>Composer & prompt</h2>
            <p>Composer ada di landing (hero) dan di workspace. Fitur: pilih mode, lampirkan file, dan — untuk Roblox — lampirkan foto referensi (maks 3 per pesan).</p>
            <ul>
              <li><strong>Tulis spesifik:</strong> sebut halaman, fitur, dan batasan. Hindari “keren” tanpa definisi.</li>
              <li><strong>Iterasi kecil:</strong> satu perubahan per pesan lebih aman daripada “ubah semuanya”.</li>
              <li><strong>Gunakan Plan dulu</strong> untuk fitur besar — lebih murah untuk revisi rencana daripada revisi kode.</li>
            </ul>
            <div className="docs-callout docs-callout--warn">
              <span className="docs-callout-icon"><AlertTriangle size={14} /></span>
              <div><b>Jangan masukkan secret ke prompt</b><p>API key, password, token — gunakan panel secrets terenkripsi. Prompt & file tersimpan sebagai versi dan bisa dilihat anggota project.</p></div>
            </div>
          </section>

          <section id="mode-plan">
            <h3>Mode Plan vs Builder</h3>
            <div className="docs-table-wrap">
              <table>
                <thead><tr><th>Mode</th><th>Kapan pakai</th><th>Output</th><th>Biaya</th></tr></thead>
                <tbody>
                  <tr><td><b>Ask</b> (1)</td><td>Tanya konsep, review kode</td><td>Jawaban teks</td><td>1</td></tr>
                  <tr><td><b>Plan</b> (2)</td><td>Fitur baru, refactor besar</td><td>Rencana file + langkah</td><td>2</td></tr>
                  <tr><td><b>Builder</b> (1–8)</td><td>Eksekusi perubahan</td><td>File ditulis, build dijalankan</td><td>Sesuai tier</td></tr>
                </tbody>
              </table>
            </div>
            <p><strong>Alur ideal:</strong> <code>Plan → review → Builder</code>. Jika rencana salah, revisi Plan (2 kredit) jauh lebih murah daripada memperbaiki kode yang sudah dieksekusi.</p>
            <h3>Memilih tier</h3>
            <ul>
              <li><strong>Cepat (1):</strong> typo, ganti warna, tambah tombol.</li>
              <li><strong>Seimbang (3):</strong> halaman baru, integrasi komponen, perbaikan bug sedang.</li>
              <li><strong>Kuat (8):</strong> arsitektur, auth, debug kompleks — pakai hanya bila perlu.</li>
            </ul>
          </section>

          <section id="mode-riset">
            <h3>Mode Riset — jawaban dengan sumber</h3>
            <p>Aktifkan toggle Riset di composer. AI boleh minta ronde pencarian (default 2). Server yang benar-benar mencari & membaca halaman — bukan AI menebak URL.</p>
            <div className="docs-steps">
              <div className="docs-step"><span className="docs-step-num">01</span><div><b>Aktifkan Riset</b><p>Toggle di toolbar composer. Status “Riset aktif” muncul.</p></div></div>
              <div className="docs-step"><span className="docs-step-num">02</span><div><b>Kirim pertanyaan riset</b><p>Contoh: “Riset regulasi pajak UMKM 2025 di Indonesia + sumber resmi.”</p></div></div>
              <div className="docs-step"><span className="docs-step-num">03</span><div><b>Periksa panel Sumber</b><p>Setiap sumber: judul, URL asli, provider, cuplikan, nomor kutip. Nomor [1][2] stabil lintas ronde.</p></div></div>
            </div>
            <div className="docs-table-wrap">
              <table>
                <thead><tr><th>Aturan riset</th><th>Detail</th></tr></thead>
                <tbody>
                  <tr><td>Butuh provider</td><td><code>SEARCH_PROVIDER</code> + <code>SEARCH_API_KEY</code> di server. Tanpa itu → 503 jujur.</td></tr>
                  <tr><td>Biaya</td><td>1 kredit/ronde. Dikembalikan bila ronde tidak menambah sumber baru.</td></tr>
                  <tr><td>Batas</td><td>2 ronde/permintaan (operator bisa turunkan, tidak bisa naikkan).</td></tr>
                  <tr><td>Kutipan</td><td>Wajib [1][2] di jawaban akhir. Sumber yang gagal dibaca dilaporkan, bukan disembunyikan.</td></tr>
                </tbody>
              </table>
            </div>
          </section>

          <section id="iterasi">
            <h3>Iterasi & revisi</h3>
            <p>Setiap turn AI menulis file. Anda bisa:</p>
            <ul>
              <li><strong>Minta revisi:</strong> “Ganti hero jadi gradient sage, tambah CTA ‘Konsultasi gratis’.”</li>
              <li><strong>Batalkan:</strong> pakai History → pulihkan versi sebelumnya.</li>
              <li><strong>Edit manual:</strong> ubah file di Monaco, preview update — AI akan baca versi terbaru di turn berikutnya.</li>
            </ul>
            <p>Menutup tab tidak membuang riset yang sedang berjalan: server selesaikan ronde, simpan sebagai job (30 menit, maks 20 job), dan Anda ambil lagi saat buka project.</p>
          </section>

          <hr />

          <section id="editor-kode">
            <h2><small>03 — Edit & preview</small>Editor kode</h2>
            <p>Monaco Editor: syntax highlight, autocomplete, multi-cursor, find/replace. Perubahan disimpan otomatis (autosave) dan jadi versi baru.</p>
            <div className="docs-cards">
              <div className="docs-card"><h4><Eye size={14} /> Klik-to-select</h4><p>Klik elemen di canvas → Inspector menampilkan file & style. Ubah tanpa cari file manual.</p></div>
              <div className="docs-card"><h4><Code2 size={14} /> Hot reload</h4><p>Simpan → preview refresh. Tidak perlu reload halaman.</p></div>
              <div className="docs-card"><h4><History size={14} /> Undo & versi</h4><p>Ctrl+Z untuk undo lokal. History panel untuk pulihkan versi lama lintas sesi.</p></div>
              <div className="docs-card"><h4><Package size={14} /> Dependencies</h4><p>Tambah paket via AI atau edit <code>package.json</code> lalu jalankan install di terminal.</p></div>
            </div>
          </section>

          <section id="canvas-preview">
            <h3>Canvas & preview</h3>
            <p>Preview di iframe sandbox — aman, terisolasi. Gunakan switcher device (mobile/tablet/desktop) untuk cek responsif. Jika preview blank, cek console di Inspector — error runtime ditampilkan jujur.</p>
            <ul>
              <li><strong>Isolasi:</strong> CSS/JS project tidak bisa akses shell PiwuApp.</li>
              <li><strong>Responsive:</strong> ubah lebar canvas, lihat breakpoint Tailwind.</li>
              <li><strong>Inspector:</strong> lihat props, style, dan path file elemen terpilih.</li>
            </ul>
          </section>

          <section id="terminal-panel">
            <h3>Terminal</h3>
            <p>Terminal xterm di workspace — jalankan shell/npm di sandbox server (butuh provider E2B). Output streaming, history per project.</p>
            <div className="docs-code">
              <div className="docs-code-head"><span><i /> terminal — contoh</span></div>
              <pre><code>{`npm install
npm run dev
npm run build
ls -la src/components`}</code></pre>
            </div>
            <p>Tanpa provider aktif, terminal menampilkan status “Layanan belum siap” — bukan shell palsu.</p>
          </section>

          <hr />

          <section id="simpan-versi">
            <h2><small>04 — Kelola project</small>Simpan & versi</h2>
            <p>Setiap simpan = revisi dengan timestamp. Deteksi konflik via revision check — jika dua orang edit bersamaan, versi terbaru menang dan yang lama bisa dipulihkan.</p>
            <ul>
              <li><strong>Autosave:</strong> antrean otomatis, tidak perlu Ctrl+S manual (tapi tetap bisa).</li>
              <li><strong>History:</strong> lihat daftar versi, preview, pulihkan, atau bandingkan.</li>
              <li><strong>CRDT:</strong> bila dua tab buka file sama, suntingan karakter digabung — kursor & undo tetap.</li>
            </ul>
          </section>

          <section id="kolaborasi">
            <h3>Kolaborasi</h3>
            <p>Undang anggota via share link (Owner/Editor/Viewer). Presence menunjukkan siapa online. CRDT aktif hanya bila dua tab buka file yang sama, ≤30.000 karakter.</p>
            <div className="docs-table-wrap">
              <table>
                <thead><tr><th>Peran</th><th>Bisa baca</th><th>Bisa tulis</th><th>Bisa undang</th></tr></thead>
                <tbody>
                  <tr><td><b>Owner</b></td><td>✓</td><td>✓</td><td>✓ (semua peran)</td></tr>
                  <tr><td><b>Editor</b></td><td>✓</td><td>✓</td><td>Viewer saja</td></tr>
                  <tr><td><b>Viewer</b></td><td>✓</td><td>—</td><td>—</td></tr>
                </tbody>
              </table>
            </div>
          </section>

          <section id="ekspor-hosting">
            <h3>Ekspor & hosting</h3>
            <p><strong>PiwuApp tidak menghosting.</strong> Semua project keluar lewat ZIP:</p>
            <div className="docs-steps">
              <div className="docs-step"><span className="docs-step-num">01</span><div><b>Klik Export ZIP</b><p>Di workspace → menu project → Export ZIP. Unduh <code>project-anda.zip</code>.</p></div></div>
              <div className="docs-step"><span className="docs-step-num">02</span><div><b>Build lokal</b><p><code>unzip project-anda.zip && npm install && npm run build</code> → hasil di <code>dist/</code>.</p></div></div>
              <div className="docs-step"><span className="docs-step-num">03</span><div><b>Deploy</b><p>Upload <code>dist/</code> ke Vercel / Netlify / Cloudflare Pages / VPS Anda.</p></div></div>
            </div>
            <div className="docs-code">
              <div className="docs-code-head"><span><i /> deploy — contoh Vercel</span><button onClick={() => copy(`npm i -g vercel\nvercel --prod`, "vercel")} style={{ color: copied === "vercel" ? "#8fbf8a" : "#9aa89a", fontSize: 11 }}>{copied === "vercel" ? <><Check size={12} /> Tersalin</> : <><Copy size={12} /> Salin</>}</button></div>
              <pre><code>{`# setelah unzip & build
npm i -g vercel
vercel --prod   # ikuti prompt, pilih dist/ sebagai output`}</code></pre>
            </div>
          </section>

          <hr />

          <section id="mobile-expo">
            <h2><small>05 — Kasus khusus</small>Mobile (Expo)</h2>
            <p>Pilih jenis <b>Mobile</b> saat buat project. Output scaffolding Expo yang bisa dibuka di Expo Go atau build via EAS. Composer mendukung prompt khusus mobile: “Buat aplikasi Expo katalog produk dengan pencarian.”</p>
            <ul>
              <li>Preview source Expo, bukan emulator penuh.</li>
              <li>Export ZIP → <code>npx expo start</code> lokal.</li>
            </ul>
          </section>

          <section id="roblox-game">
            <h3>Roblox game</h3>
            <p>Pilih jenis <b>Roblox Game</b>. Chat bisa buat model 3D dari foto: lampirkan foto (maks 3/pesan, diberi nomor) + minta “buat model…”. AI kirim <code>scene.build</code> (box/sphere/cylinder/wedge/plane + ukuran stud + warna sampled 16×16).</p>
            <div className="docs-cards">
              <div className="docs-card"><h4><Gamepad size={14} /> Builder</h4><p>Viewport Three.js, Explorer tree, vertex/face mesh. Server buat geometri deterministik → Part Roblox.</p></div>
              <div className="docs-card"><h4><Download size={14} /> Ekspor</h4><p>OBJ / GLB 1024×1024 (atlas tekstur proyeksi kotak) / .rbxmx. Kirim bundle ke Studio via bridge.</p></div>
            </div>
            <p>Butuh migration <code>006_studio_bridge.sql</code> + plugin <code>public/plugins/PiwuStudio.rbxmx</code>. Tanpa foto valid, tombol tekstur nonaktif.</p>
          </section>

          <section id="troubleshoot">
            <h3>Troubleshooting</h3>
            <div className="docs-faq">
              <div className="docs-faq-item"><button>Preview blank / error</button><p>Cek Inspector console. Pastikan <code>npm install</code> sudah jalan dan tidak ada syntax error. Coba “Pulihkan versi sebelumnya”.</p></div>
              <div className="docs-faq-item"><button>Kredit habis padahal baru pakai sedikit</button><p>Free 20/hari, tidak menumpuk. Cek rincian di sidebar dashboard (per jenis: AI, build, audit). Tunggu reset 00:00 UTC atau top-up.</p></div>
              <div className="docs-faq-item"><button>AI tidak merespons / error provider</button><p>Cek status koneksi di /login. Jika provider belum aktif, layanan menampilkan error — hubungi admin untuk aktivasi.</p></div>
              <div className="docs-faq-item"><button>Perubahan tidak tersimpan</button><p>Cek indikator sinkronisasi (hijau = tersimpan, kuning = menunggu, merah = konflik). Jangan tutup tab saat masih kuning. Jika konflik, pilih versi di History.</p></div>
              <div className="docs-faq-item"><button>CRDT nonaktif</button><p>Pastikan dua tab buka file yang sama, file ≤30.000 karakter, dan base teks sama. Jika base berbeda, sesi berhenti dengan label “CRDT nonaktif · teks berbeda”.</p></div>
            </div>
          </section>

          <div className="docs-callout docs-callout--info" style={{ marginTop: 32 }}>
            <span className="docs-callout-icon"><Compass size={14} /></span>
            <div><b>Selanjutnya</b><p>Baca <Link to="/dokumentasi">Dokumentasi lengkap</Link> untuk arsitektur & biaya, atau <Link to="/aturan">Aturan penggunaan</Link> sebelum publish.</p></div>
          </div>
        </article>

        <aside className="docs-aside">
          <div className="docs-aside-card">
            <h4>Pintasan</h4>
            <a href="#project-pertama"><Play size={13} /> Buat project pertama</a>
            <a href="#mode-riset"><Search size={13} /> Mode riset</a>
            <a href="#ekspor-hosting"><Download size={13} /> Ekspor ZIP</a>
            <a href="#troubleshoot"><Wrench size={13} /> Troubleshooting</a>
          </div>
          <div className="docs-aside-note">
            <b>Tips:</b> Mulai dari template untuk hemat kredit. Satu perubahan per pesan lebih aman daripada “ubah semuanya”.
          </div>
          <div className="docs-aside-card" style={{ marginTop: 14 }}>
            <h4>Butuh template?</h4>
            <a href="/#templates"><Layers size={13} /> Jelajahi template</a>
            <a href="/projects"><Monitor size={13} /> Buka dashboard</a>
          </div>
        </aside>
      </div>

      <footer className="docs-footer">
        <span>© {new Date().getFullYear()} PiwuApp · Panduan diperbarui 18 Okt 2026</span>
        <span><Link to="/">Beranda</Link> · <Link to="/dokumentasi">Dokumentasi</Link> · <Link to="/aturan">Aturan</Link></span>
      </footer>
    </div>
  );
}

