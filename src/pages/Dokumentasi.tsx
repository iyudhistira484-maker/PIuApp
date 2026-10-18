import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowUpRight,
  BookOpen,
  Boxes,
  Code2,
  CreditCard,
  Database,
  FileText,
  Globe,
  Layers,
  LayoutDashboard,
  Menu,
  Search,
  ShieldCheck,
  Sparkles,
  X,
  Zap,
  AlertTriangle,
  Check,
  Copy,
  Smartphone,
  Gamepad2,
  Download,
  History,
  Users,
  Terminal,
  Lock,
} from "lucide-react";
import { Logo } from "../components/ui";
import "./docs.css";

const toc = [
  {
    id: "pengenalan",
    label: "Pengenalan",
    items: [
      { id: "apa-itu", label: "Apa itu PiwuApp" },
      { id: "cara-kerja", label: "Cara kerja" },
      { id: "untuk-siapa", label: "Untuk siapa" },
    ],
  },
  {
    id: "konsep",
    label: "Konsep inti",
    items: [
      { id: "project-kinds", label: "Jenis project" },
      { id: "workspace", label: "Workspace & editor" },
      { id: "preview", label: "Preview & canvas" },
    ],
  },
  {
    id: "ai",
    label: "AI & kredit",
    items: [
      { id: "model-ai", label: "Model AI" },
      { id: "biaya-kredit", label: "Biaya per operasi" },
      { id: "paket-harga", label: "Paket & batasan" },
    ],
  },
  {
    id: "data",
    label: "Data & sync",
    items: [
      { id: "penyimpanan", label: "Penyimpanan" },
      { id: "sinkronisasi", label: "Sinkronisasi cloud" },
      { id: "versi", label: "Versi & riwayat" },
    ],
  },
  {
    id: "fitur",
    label: "Fitur",
    items: [
      { id: "template", label: "Template" },
      { id: "ekspor", label: "Ekspor & hosting" },
      { id: "keamanan-doc", label: "Keamanan & isolasi" },
    ],
  },
];

function DocsHeader({ active }: { active: string }) {
  const [open, setOpen] = useState(false);
  return (
    <header className="docs-header">
      <div className="docs-header-inner">
        <Link to="/" aria-label="PiwuApp beranda">
          <Logo />
        </Link>
        <nav className={`docs-nav ${open ? "is-open" : ""}`} aria-label="Navigasi docs">
          <Link to="/dokumentasi" className={active === "dokumentasi" ? "is-active" : ""} onClick={() => setOpen(false)}>Dokumentasi</Link>
          <Link to="/panduan" className={active === "panduan" ? "is-active" : ""} onClick={() => setOpen(false)}>Panduan</Link>
          <Link to="/aturan" className={active === "aturan" ? "is-active" : ""} onClick={() => setOpen(false)}>Aturan</Link>
          <Link to="/#pricing" onClick={() => setOpen(false)}>Harga</Link>
        </nav>
        <div className="docs-header-actions">
          <Link to="/projects" className="docs-cta">Buka workspace <ArrowUpRight size={14} /></Link>
          <button className="docs-mobile-toggle" aria-label={open ? "Tutup menu" : "Buka menu"} onClick={() => setOpen(!open)}>
            {open ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>
      </div>
    </header>
  );
}

function useActiveSection(ids: string[]) {
  const [active, setActive] = useState(ids[0]);
  useEffect(() => {
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setActive(e.target.id);
      },
      { rootMargin: "-20% 0px -70% 0px", threshold: 0 }
    );
    ids.forEach((id) => {
      const el = document.getElementById(id);
      if (el) obs.observe(el);
    });
    return () => obs.disconnect();
  }, [ids.join(",")]);
  return active;
}

export default function Dokumentasi() {
  const allIds = toc.flatMap((g) => g.items.map((i) => i.id));
  const active = useActiveSection(allIds);
  const [copied, setCopied] = useState("");

  const copy = (text: string, id: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(id);
      setTimeout(() => setCopied(""), 1500);
    });
  };

  return (
    <div className="docs-page">
      <DocsHeader active="dokumentasi" />

      <div className="docs-hero">
        <div className="docs-hero-inner">
          <div className="docs-eyebrow"><i /> Dokumentasi <span style={{ color: "#9aa09a" }}>·</span> v0.1.0 · 18 Okt 2026</div>
          <h1>Dokumentasi <em>PiwuApp</em> — dari ide sampai kode yang Anda miliki.</h1>
          <p className="docs-hero-lead">
            PiwuApp adalah workspace berbasis percakapan untuk mengubah deskripsi menjadi aplikasi web, mobile (Expo), atau game Roblox. Satu tempat untuk merencanakan, menulis kode, melihat preview, dan mengekspor hasil — tanpa mengunci kode Anda.
          </p>
          <div className="docs-hero-meta">
            <span className="docs-meta-pill"><BookOpen size={13} /> <b>11</b> bagian · baca 12 menit</span>
            <span className="docs-meta-pill"><ShieldCheck size={13} /> Data lokal-first, cloud opsional</span>
            <span className="docs-meta-pill"><Code2 size={13} /> React 19 · Vite · Supabase RLS</span>
          </div>
          <div className="docs-quick">
            <Link to="#cara-kerja"><span className="docs-quick-icon"><Zap size={16} /></span><span><b>Mulai 5 menit</b><span>Buat project pertama tanpa setup</span></span></Link>
            <Link to="#biaya-kredit"><span className="docs-quick-icon"><CreditCard size={16} /></span><span><b>Kredit & paket</b><span>Biaya nyata per operasi, bukan tebak-tebakan</span></span></Link>
            <Link to="#keamanan-doc"><span className="docs-quick-icon"><Lock size={16} /></span><span><b>Keamanan</b><span>Isolasi preview, RLS, dan ekspor ZIP</span></span></Link>
          </div>
        </div>
      </div>

      <div className="docs-layout">
        <aside className="docs-toc" aria-label="Daftar isi">
          <div className="docs-toc-title">Daftar isi</div>
          {toc.map((g) => (
            <div key={g.id} className="docs-toc-group">
              <b>{g.label}</b>
              {g.items.map((it) => (
                <a key={it.id} href={`#${it.id}`} className={active === it.id ? "is-active" : ""}>{it.label}</a>
              ))}
            </div>
          ))}
        </aside>

        <article className="docs-content docs-article">
          {/* PENGENALAN */}
          <section id="apa-itu">
            <h2><small>01 — Pengenalan</small>Apa itu PiwuApp</h2>
            <p className="lead">
              PiwuApp menggabungkan percakapan AI, editor kode Monaco, terminal, dan preview interaktif dalam satu workspace. Anda menjelaskan kebutuhan dengan bahasa Indonesia sehari-hari, meninjau rencana, lalu menyempurnakan hasilnya — semua perubahan tercatat sebagai versi yang bisa dipulihkan.
            </p>
            <div className="docs-cards">
              <div className="docs-card">
                <h4><LayoutDashboard size={15} /> Untuk non-teknis</h4>
                <p>Mulai dari template atau deskripsi bebas. Tidak perlu menyiapkan toolchain lokal. Preview langsung terlihat di browser.</p>
              </div>
              <div className="docs-card">
                <h4><Code2 size={15} /> Untuk developer</h4>
                <p>Edit file secara langsung, jalankan perintah, dan ekspor ZIP kapan saja. Tidak ada lock-in: kodenya milik Anda seutuhnya.</p>
              </div>
              <div className="docs-card">
                <h4><Boxes size={15} /> Satu workspace, tiga target</h4>
                <p>Web app modern, aplikasi mobile Expo, atau game Roblox — dipilih di awal dan mengikuti project sepanjang hidupnya.</p>
              </div>
              <div className="docs-card">
                <h4><ShieldCheck size={15} /> Jujur tentang batas</h4>
                <p>Jika layanan belum siap, PiwuApp menampilkan status/error — bukan hasil simulasi. Tidak ada deploy/hosting bawaan.</p>
              </div>
            </div>
            <div className="docs-callout docs-callout--info">
              <span className="docs-callout-icon"><Sparkles size={14} /></span>
              <div><b>Status versi ini</b><p>Workspace memakai akun terverifikasi Supabase. AI, terminal, dan layanan eksternal butuh provider server yang aktif. Lihat halaman login untuk status koneksi saat ini.</p></div>
            </div>
          </section>

          <section id="cara-kerja">
            <h3>Cara kerja — tiga langkah</h3>
            <div className="docs-steps">
              <div className="docs-step">
                <span className="docs-step-num">01</span>
                <div><b>Ceritakan ide Anda</b><p>Tulis di composer: “Buat toko online untuk brand kopi dengan katalog, keranjang, dan checkout.” Bisa juga pilih <code>Web App / Mobile / Roblox</code> dan mulai dari template.</p></div>
              </div>
              <div className="docs-step">
                <span className="docs-step-num">02</span>
                <div><b>Tinjau rencana → bangun bersama AI</b><p>AI menyusun rencana file dan langkah build. Anda setujui, revisi, atau minta alternatif. Mode <code>Plan</code> untuk diskusi, <code>Builder</code> untuk eksekusi.</p></div>
              </div>
              <div className="docs-step">
                <span className="docs-step-num">03</span>
                <div><b>Preview, edit, ekspor</b><p>Lihat hasil di canvas/device preview. Klik elemen untuk edit cepat, ubah kode di Monaco, jalankan audit, lalu unduh <code>project-anda.zip</code>.</p></div>
              </div>
            </div>
          </section>

          <section id="untuk-siapa">
            <h3>Untuk siapa PiwuApp cocok</h3>
            <ul>
              <li><strong>UMKM & kreator</strong> — butuh landing page, katalog, atau toko tanpa tim engineering besar.</li>
              <li><strong>Tim produk internal</strong> — dashboard, alat operasional, prototipe yang bisa diedit developer.</li>
              <li><strong>Pelajar & indie builder</strong> — belajar dengan melihat kode nyata, bukan mockup.</li>
              <li><strong>Developer Roblox/Expo</strong> — butuh scaffolding cepat dengan struktur yang bisa dikembangkan di Studio/Expo.</li>
            </ul>
          </section>

          <hr />

          {/* KONSEP INTI */}
          <section id="project-kinds">
            <h2><small>02 — Konsep inti</small>Jenis project</h2>
            <p>Jenis project dipilih saat membuat project dan tidak bisa diganti sembarangan — karena struktur file, preview, dan tooling berbeda.</p>
            <div className="docs-table-wrap">
              <table>
                <thead><tr><th>Jenis</th><th>Stack & output</th><th>Preview</th><th>Ekspor</th></tr></thead>
                <tbody>
                  <tr><td><b>Web App</b> <span className="docs-badge docs-badge--pine" style={{ marginLeft: 6 }}>default</span></td><td>React + Vite + Tailwind, SPA modern</td><td>Canvas browser, responsive</td><td>ZIP + <code>npm run build</code></td></tr>
                  <tr><td><b>Mobile (Expo)</b></td><td>Expo / React Native scaffolding</td><td>Expo preview & source</td><td>ZIP → buka di Expo Go / EAS</td></tr>
                  <tr><td><b>Roblox Game</b></td><td>Luau + scene builder Three.js + plugin Studio</td><td>Viewport 3D + Explorer tree</td><td>.rbxmx / OBJ / GLB + sync ke Studio</td></tr>
                </tbody>
              </table>
            </div>
            <div className="docs-callout docs-callout--warn">
              <span className="docs-callout-icon"><AlertTriangle size={14} /></span>
              <div><b>Roblox: bukan fotogrametri</b><p>Foto jadi referensi warna per sisi (grid 16×16, region 0–1), bukan scan 3D. Untuk tekstur, gunakan ekspor GLB 1024×1024 (proyeksi kotak per sisi).</p></div>
            </div>
          </section>

          <section id="workspace">
            <h3>Workspace & editor</h3>
            <p>Workspace adalah IDE di browser: File Explorer, Monaco Editor, Plan panel, Terminal (xterm), Database panel, Inspector, dan Preview. Semua panel bisa disusun ulang; preferensi disimpan per akun.</p>
            <div className="docs-cards">
              <div className="docs-card"><h4><FileText size={14} /> Explorer</h4><p>Struktur file project, pencarian, buat/hapus/rename. Klik file untuk buka di editor.</p></div>
              <div className="docs-card"><h4><Code2 size={14} /> Monaco</h4><p>Syntax highlighting, autocomplete, multi-cursor, find/replace. Kursor & undo tetap saat kolaborasi.</p></div>
              <div className="docs-card"><h4><Terminal size={14} /> Terminal</h4><p>Jalankan shell/npm di sandbox server (butuh provider). Output streaming, history per project.</p></div>
              <div className="docs-card"><h4><Database size={14} /> Data</h4><p>Kelola dataset cloud privat per project (20 tabel, 32 kolom, 1.000 baris). Revisi mencegah overwrite.</p></div>
            </div>
            <h3>Mode chat</h3>
            <div className="docs-table-wrap">
              <table>
                <thead><tr><th>Mode</th><th>Fungsi</th><th>Biaya</th></tr></thead>
                <tbody>
                  <tr><td><b>Ask</b></td><td>Tanya jawab ringan, baca kode</td><td>1 kredit</td></tr>
                  <tr><td><b>Plan</b></td><td>Susun rencana terstruktur sebelum build</td><td>2 kredit</td></tr>
                  <tr><td><b>Builder</b></td><td>Eksekusi: tulis file, install, build</td><td>1–8 kredit (per tier)</td></tr>
                  <tr><td><b>Research</b></td><td>Cari sumber web, kutip bernomor [1][2]</td><td>+1 kredit/ronde</td></tr>
                </tbody>
              </table>
            </div>
          </section>

          <section id="preview">
            <h3>Preview & canvas</h3>
            <p>Preview dirender di iframe terisolasi (sandboxed) — CSS/JS project tidak bisa mengakses shell PiwuApp. Canvas mendukung klik-to-select: pilih elemen, ubah style tanpa kehilangan konteks. Panel device untuk cek responsif (mobile/tablet/desktop).</p>
            <ul>
              <li><strong>Hot reload</strong> — simpan file, preview update otomatis.</li>
              <li><strong>Inspector</strong> — lihat props/style elemen terpilih.</li>
              <li><strong>Isolasi</strong> — preview tidak mengeksekusi kode berbahaya di luar iframe.</li>
            </ul>
          </section>

          <hr />

          {/* AI & KREDIT */}
          <section id="model-ai">
            <h2><small>03 — AI & kredit</small>Model AI</h2>
            <p>PiwuApp memakai endpoint OpenAI-compatible (<code>LLM_BASE_URL</code> + <code>LLM_API_KEY</code>) yang dikonfigurasi di server. Admin bisa memilih model per tier di panel Admin → AI & model. Tanpa provider aktif, chat menampilkan error yang jelas — tidak ada jawaban palsu.</p>
            <div className="docs-table-wrap">
              <table>
                <thead><tr><th>Tier</th><th>Kegunaan</th><th>Biaya</th></tr></thead>
                <tbody>
                  <tr><td><b>Cepat</b></td><td>Edit kecil, tanya jawab</td><td>1 kredit</td></tr>
                  <tr><td><b>Seimbang</b></td><td>Fitur sedang, refactor</td><td>3 kredit</td></tr>
                  <tr><td><b>Kuat</b></td><td>Arsitektur, debug kompleks</td><td>8 kredit</td></tr>
                </tbody>
              </table>
            </div>
            <div className="docs-callout docs-callout--info">
              <span className="docs-callout-icon"><Search size={14} /></span>
              <div><b>Mode Riset</b><p>Toggle di composer. AI boleh minta 2 ronde pencarian (default). Server yang mencari & membaca halaman — jawaban wajib kutip sumber [1][2] dengan penomoran stabil. 1 ronde = 1 kredit, dikembalikan bila tidak menambah sumber baru. Tanpa <code>SEARCH_PROVIDER</code>, permintaan sumber ditolak 503.</p></div>
            </div>
          </section>

          <section id="biaya-kredit">
            <h3>Biaya per operasi — transparan</h3>
            <p>Setiap aksi punya harga tetap. Estimasi di composer memakai angka yang sama dengan yang ditagih server, jadi tidak ada kejutan.</p>
            <div className="docs-table-wrap">
              <table>
                <thead><tr><th>Operasi</th><th>Biaya</th><th>Catatan</th></tr></thead>
                <tbody>
                  <tr><td>Ask</td><td>1</td><td>Satu pass model tanpa tools</td></tr>
                  <tr><td>Plan</td><td>2</td><td>Rencana terstruktur</td></tr>
                  <tr><td>Chat — Cepat / Seimbang / Kuat</td><td>1 / 3 / 8</td><td>Per turn, sesuai tier yang menjawab</td></tr>
                  <tr><td>Research round</td><td>1</td><td>Per ronde pencarian</td></tr>
                  <tr><td>Sandbox command</td><td>1</td><td>Perintah shell/npm</td></tr>
                  <tr><td>Sandbox job</td><td>2</td><td>Build / preview / packages</td></tr>
                  <tr><td>Audit (Lighthouse)</td><td>3</td><td>Per audit run</td></tr>
                </tbody>
              </table>
            </div>
            <div className="docs-code">
              <div className="docs-code-head"><span><i /> shared/credits.mjs</span><button onClick={() => copy(`import { CREDIT_COSTS } from "./shared/credits.mjs"`, "costs")} style={{ color: copied === "costs" ? "#8fbf8a" : "#9aa89a", fontSize: 11 }}>{copied === "costs" ? <><Check size={12} /> Tersalin</> : <><Copy size={12} /> Salin</>}</button></div>
              <pre><code>{`// Satu sumber kebenaran — server & UI pakai angka sama
export const CREDIT_COSTS = {
  ask: 1, plan: 2,
  chat: { Cepat: 1, Seimbang: 3, Kuat: 8 },
  researchRound: 1, sandboxCommand: 1, sandboxJob: 2, audit: 3
}`}</code></pre>
            </div>
          </section>

          <section id="paket-harga">
            <h3>Paket & batasan</h3>
            <div className="docs-table-wrap">
              <table>
                <thead><tr><th>Paket</th><th>Harga / 30 hari</th><th>Kredit</th><th>Jatah harian</th><th>Masa berlaku</th></tr></thead>
                <tbody>
                  <tr><td><b>Free</b></td><td>Gratis</td><td>—</td><td>20 / hari · plafon 600 / bulan</td><td>Reset 00:00 UTC, tidak menumpuk</td></tr>
                  <tr><td><b>Pro</b></td><td>Rp 199.000</td><td>1.500</td><td>30 / hari</td><td>2 bulan</td></tr>
                  <tr><td><b>Team</b></td><td>Rp 499.000</td><td>4.500</td><td>40 / hari</td><td>2 bulan</td></tr>
                </tbody>
              </table>
            </div>
            <p>Top-up berlaku 12 bulan. Perkiraan “tahan berapa lama” dihitung dari biaya nyata per operasi — aritmetika, bukan janji. Pembayaran via provider terhubung; tanpa provider, checkout nonaktif dengan penjelasan.</p>
            <div className="docs-callout docs-callout--warn">
              <span className="docs-callout-icon"><CreditCard size={14} /></span>
              <div><b>Pembelian final — tanpa refund</b><p>Semua transaksi paket, top-up, dan template bersifat final. Jika provider mengirim status refund/chargeback, sistem mencabut kredit/entitlement terkait. Detail ada di halaman Aturan.</p></div>
            </div>
          </section>

          <hr />

          {/* DATA & SYNC */}
          <section id="penyimpanan">
            <h2><small>04 — Data & sinkronisasi</small>Penyimpanan</h2>
            <p>PiwuApp lokal-first: cache IndexedDB per akun + sync ke Supabase (RLS). Project demo hanya lokal; project akun disinkronkan. Jangan simpan secret/API key di kode — gunakan secrets terenkripsi.</p>
            <div className="docs-cards">
              <div className="docs-card"><h4><Database size={14} /> IndexedDB</h4><p>Cache utama di browser. Bertahan offline, cepat, terisolasi per akun.</p></div>
              <div className="docs-card"><h4><Globe size={14} /> Supabase</h4><p>Source of truth cloud. RLS memastikan project hanya bisa dibaca anggota.</p></div>
              <div className="docs-card"><h4><History size={14} /> Revisi</h4><p>Setiap simpan = revisi baru. Deteksi konflik via revision check.</p></div>
              <div className="docs-card"><h4><Users size={14} /> Peran</h4><p>Owner / Editor / Viewer. Viewer tidak bisa push/kirim CRDT.</p></div>
            </div>
          </section>

          <section id="sinkronisasi">
            <h3>Sinkronisasi cloud</h3>
            <p>Autosave antrean → tulis ke server → reconciliate. Jika dua tab edit file yang sama, CRDT karakter-level menggabungkan suntingan (id <code>(site, counter)</code> + tombstone). Jika base berbeda, CRDT nonaktif dan fallback ke “last write wins” dengan peringatan.</p>
            <ul>
              <li>Realtime channel <code>piwu:project:&lt;id&gt;</code> untuk presence & CRDT.</li>
              <li>Policy <code>realtime.messages</code> sudah mengizinkan insert/select anggota.</li>
              <li>Tab baru menerima riwayat operasi (maks 20.000 ops, file ≤30.000 karakter).</li>
            </ul>
          </section>

          <section id="versi">
            <h3>Versi & riwayat</h3>
            <p>Panel History menampilkan versi per file dengan timestamp dan label (“Project dibuat”, “AI: tambah checkout”). Klik untuk preview, pulihkan, atau bandingkan. Versi dibuat otomatis tiap autosave dan tiap turn AI.</p>
          </section>

          <hr />

          <section id="template">
            <h2><small>05 — Fitur</small>Template</h2>
            <p>Template adalah titik awal dengan prompt siap pakai. Pilih kategori (Landing page, Dashboard, E-commerce, Portfolio) → prompt terisi → submit. Template bukan mockup: ini kode sungguhan yang bisa dikembangkan.</p>
            <div className="docs-table-wrap">
              <table>
                <thead><tr><th>Kategori</th><th>Contoh</th><th>Cocok untuk</th></tr></thead>
                <tbody>
                  <tr><td>Landing page</td><td>Studio kreatif, SaaS, event</td><td>Brand & marketing</td></tr>
                  <tr><td>Dashboard</td><td>Analytics, CRM mini</td><td>Alat internal</td></tr>
                  <tr><td>E-commerce</td><td>Katalog + keranjang</td><td>UMKM</td></tr>
                  <tr><td>Portfolio</td><td>Galeri, resume</td><td>Kreator</td></tr>
                </tbody>
              </table>
            </div>
          </section>

          <section id="ekspor">
            <h3>Ekspor & hosting</h3>
            <p><strong>PiwuApp tidak menghosting hasil build.</strong> Kode keluar lewat <b>Export ZIP</b> (di workspace) — unduh, jalankan <code>npm install && npm run build</code> di hosting pilihan Anda (Vercel, Netlify, VPS, dll). Untuk Roblox, ekspor OBJ/GLB atau kirim bundle ke Studio via bridge.</p>
            <div className="docs-callout docs-callout--info">
              <span className="docs-callout-icon"><Download size={14} /></span>
              <div><b>Tidak ada deploy otomatis</b><p>Tidak ada domain kustom, hosting pihak ketiga, atau analytics pengunjung bawaan. Anda kontrol penuh di infrastruktur Anda.</p></div>
            </div>
          </section>

          <section id="keamanan-doc">
            <h3>Keamanan & isolasi</h3>
            <ul>
              <li><strong>Preview terisolasi</strong> — iframe sandbox, tanpa akses ke shell.</li>
              <li><strong>RLS Supabase</strong> — setiap query dicek peran project.</li>
              <li><strong>Secrets terenkripsi</strong> — jangan hardcode API key di file.</li>
              <li><strong>Rate limit</strong> — antispam di API, kredit sweeper periodik.</li>
              <li><strong>Tidak ada eksekusi otomatis</strong> — script baru di Roblox Disabled by default.</li>
            </ul>
            <p>Untuk audit keamanan lengkap, lihat <code>docs/SECURITY.md</code> di repository.</p>
          </section>

          <div className="docs-callout docs-callout--info" style={{ marginTop: 32 }}>
            <span className="docs-callout-icon"><BookOpen size={14} /></span>
            <div><b>Lanjut baca</b><p><Link to="/panduan">Panduan langkah-demi-langkah</Link> untuk membuat project pertama dalam 5 menit, atau <Link to="/aturan">Aturan penggunaan</Link> untuk hak, pembayaran, dan komunitas.</p></div>
          </div>
        </article>

        <aside className="docs-aside">
          <div className="docs-aside-card">
            <h4>Di halaman ini</h4>
            <a href="#apa-itu"><FileText size={13} /> Ringkasan produk</a>
            <a href="#biaya-kredit"><CreditCard size={13} /> Tabel biaya kredit</a>
            <a href="#penyimpanan"><Database size={13} /> Penyimpanan & RLS</a>
            <a href="#ekspor"><Download size={13} /> Ekspor ZIP</a>
          </div>
          <div className="docs-aside-note">
            <b>Butuh bantuan?</b><br />
            Cek <Link to="/panduan">Panduan</Link> atau hubungi support via email di footer. Untuk setup self-host, lihat <code>docs/SERVICES_SETUP.md</code>.
          </div>
          <div className="docs-aside-card" style={{ marginTop: 14 }}>
            <h4>Tautan cepat</h4>
            <a href="/#templates"><Layers size={13} /> Jelajahi template</a>
            <a href="/#pricing"><CreditCard size={13} /> Lihat paket</a>
            <a href="/upgrade"><Zap size={13} /> Upgrade paket</a>
          </div>
        </aside>
      </div>

      <footer className="docs-footer">
        <span>© {new Date().getFullYear()} PiwuApp · Dibuat di Indonesia untuk semua pembuat.</span>
        <span><Link to="/">Beranda</Link> · <Link to="/panduan">Panduan</Link> · <Link to="/aturan">Aturan</Link> · <a href="mailto:support@piwuapp.id">support@piwuapp.id</a></span>
      </footer>
    </div>
  );
}

