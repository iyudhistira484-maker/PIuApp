import ProjectKindPicker from "../components/projects/ProjectKindPicker";
import type { ProjectKind } from "../lib/project-kinds";
import LandingNav from "../components/landing/LandingNav";
import HeroVideo from "../components/landing/HeroVideo";
import "../components/landing/landing-responsive.css";
import "../components/landing/landing-motion.css";
import useLandingMotion, {
  revealDelay,
} from "../components/landing/useLandingMotion";
import { usePlatform, PlatformNotices } from "../components/admin/Platform";
import {
  CREDIT_EXPIRY_MONTHS,
  costLine,
  expiryLabel,
  lastsLabel,
  mergePlans,
  usageProfile,
  type PlanRow,
} from "../../shared/credits.mjs";
import { useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  Plus,
  Minus,
  Code2,
  LayoutDashboard,
  ShoppingBag,
  Palette,
  MousePointer2,
  Sparkles,
  Globe2,
  Download,
  ShieldCheck,
  Layers,
  MessageSquare,
  Zap,
  Heart,
} from "lucide-react";
import { Logo, Modal } from "../components/ui";
import PromptBox from "../components/PromptBox";
import TemplatePreview from "../components/TemplatePreview";
import { templates } from "../lib/templates";
import { useStore } from "../lib/store";
import { planBenefits } from "../lib/dashboard/plans";
const faqs = [
  [
    "Apa itu PiwuApp?",
    "PiwuApp adalah ruang kerja untuk mengubah ide menjadi aplikasi melalui percakapan. Jelaskan kebutuhan Anda, tinjau rencana, lalu edit kode dan lihat hasilnya dalam satu tempat.",
  ],
  [
    "Apakah saya harus bisa coding?",
    "Tidak harus. Mulai dari deskripsi sederhana atau template. Jika Anda bisa coding, editor kode tersedia untuk mengubah detail secara langsung.",
  ],
  [
    "Apakah kode aplikasi menjadi milik saya?",
    "Ya. Anda dapat mengedit dan mengekspor seluruh kode project ke file ZIP kapan saja. Tidak ada keharusan untuk tetap menggunakan PiwuApp.",
  ],
  [
    "Bisa digunakan untuk bisnis di Indonesia?",
    "Bisa. Antarmuka dan template menggunakan Bahasa Indonesia. Ketersediaan integrasi bergantung pada layanan server yang diaktifkan. Transaksi hanya dijalankan melalui provider pembayaran yang terhubung.",
  ],
  [
    "Apa yang tersedia pada versi ini?",
    "Workspace memakai akun terautentikasi, penyimpanan cloud, editor kode, dan preview interaktif. AI, terminal, dan layanan eksternal memerlukan provider aktif. Kode keluar lewat Export ZIP; PiwuApp tidak menghosting hasil build. Layanan yang belum siap tidak digantikan oleh simulasi.",
  ],
];
const thousands = (value: number) =>
  new Intl.NumberFormat("id-ID").format(value);

/** Credits and how long they last, from the ladder with admin overrides. */
const creditHeadline = (plan: PlanRow) =>
  plan.monthly
    ? `${thousands(plan.credits)} kredit/bulan`
    : `${thousands(plan.credits)} kredit/hari`;
const creditNote = (plan: PlanRow) => {
  if (!plan.monthly)
    return `direset tiap hari pukul 00:00 UTC · plafon ${thousands(plan.monthlyCap || 0)} kredit/bulan`;
  return `${thousands(plan.daily)} kredit/hari + ${lastsLabel(plan.credits, usageProfile("normal"))} pemakaian normal · ${expiryLabel(plan.expiryMonths)}`;
};

// The pricing cards read the credit ladder in shared/credits.mjs (the same
// numbers the server sells), so the landing page cannot advertise a package
// size that the checkout does not grant.

export default function Landing() {
  const { settings: siteSettings } = usePlatform();
  const [projectKind, setProjectKind] = useState<ProjectKind>("webapp");
  const [prompt, setPrompt] = useState("");
  const [mode, setMode] = useState<"Builder" | "Plan">("Builder");
  const [category, setCategory] = useState("Semua");
  const [faq, setFaq] = useState<number | null>(0);
  const [modal, setModal] = useState("");
  const navigate = useNavigate();
  // Prices and credits follow the admin settings, falling back to the shared
  // ladder. Daily allowances are not editable: migration 010 enforces them.
  const plans = mergePlans(
    siteSettings.enabled_services?.plan_overrides ??
      siteSettings.plan_overrides,
  );
  const ladder = (name: string) =>
    plans.find((plan) => plan.plan === name) || plans[0];
  // Only 30-day plans exist at checkout, so the cards never show an annual
  // price the store cannot charge.
  const planCards = planBenefits(plans).map((benefit, index) => ({
    name: benefit.plan,
    price: thousands(ladder(benefit.plan).monthly),
    desc: benefit.summary,
    features: benefit.items,
    button: ["Mulai gratis", "Saya tertarik dengan Pro", "Daftar minat Team"][
      index
    ],
  }));
  const store = useStore();
  const hero = useRef<HTMLDivElement>(null);
  useLandingMotion();
  const submit = () => {
    if (!prompt.trim()) return;
    store.setPending(prompt, mode, projectKind);
    if (store.user) {
      const id = store.createProject(prompt, undefined, projectKind);
      navigate("/project/" + id);
    } else navigate("/login");
  };
  const selectTemplate = (id: string) => {
    const t = templates.find((t) => t.id === id)!;
    setProjectKind("webapp");
    setPrompt(t.prompt);
    hero.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    setTimeout(() => document.getElementById("hero-prompt")?.focus(), 300);
  };
  const categories = [
    "Semua",
    "Landing page",
    "Dashboard",
    "E-commerce",
    "Portfolio",
    "Lainnya",
  ];
  const filtered =
    category === "Semua"
      ? templates.slice(0, 4)
      : category === "Lainnya"
        ? templates.slice(4)
        : templates.filter((t) => t.category === category);
  return (
    <div className="landing">
      <div className="landing-progress" aria-hidden="true" />
      <LandingNav
        signedIn={!!store.user}
        onCategory={setCategory}
        onCommunity={() => setModal("Komunitas PiwuApp")}
      />
      <main>
        <PlatformNotices />
        {siteSettings.support_email && (
          <div className="platform-support">
            Butuh bantuan?{" "}
            <a href={"mailto:" + siteSettings.support_email}>
              {siteSettings.support_email}
            </a>
          </div>
        )}
        <section className="hero-section hero-with-video">
          <HeroVideo />
          <div className="hero-content">
            <a href="#how-it-works" className="announcement">
              <span className="new-badge">KENALAN, PIWUAPP</span>
              <span>Ide besar, mulai dari satu percakapan</span>
              <ArrowUpRight size={13} />
            </a>
            <h1>
              {siteSettings.hero_title || (
                <>
                  Bangun sesuatu
                  <br />
                  dengan{" "}
                  <span className="hero-word">
                    PiwuApp
                    <svg viewBox="0 0 325 15" preserveAspectRatio="none">
                      <path
                        d="M4 9Q163 -2 320 9M45 14Q190 5 298 12"
                        pathLength={1}
                        stroke="currentColor"
                        strokeWidth="3"
                        fill="none"
                        strokeLinecap="round"
                      />
                    </svg>
                  </span>
                  <span className="headline-dot">.</span>
                </>
              )}
            </h1>
            <p className="hero-subtitle">
              {siteSettings.hero_subtitle || (
                <>
                  Wujudkan produk baru, alat internal,
                  <br className="mobile-break" /> atau bahkan seluruh
                  perusahaan. <br />
                  Cukup ceritakan idenya. Kita bangun bersama.
                </>
              )}
            </p>
            <div className="hero-prompt with-project-kind" ref={hero}>
              <ProjectKindPicker
                compact
                value={projectKind}
                onChange={setProjectKind}
              />
              <PromptBox
                value={prompt}
                onChange={setPrompt}
                onSubmit={submit}
                mode={mode}
                onModeChange={setMode}
                placeholder={
                  projectKind === "roblox"
                    ? "Ceritakan game atau dunia Roblox yang ingin Anda buat…"
                    : projectKind === "mobile"
                      ? "Ceritakan aplikasi Android atau iOS yang ingin Anda buat…"
                      : undefined
                }
              />
            </div>
            <div className="prompt-suggestions">
              <span>Mulai dari ide:</span>
              {(projectKind === "roblox"
                ? [
                    {
                      icon: Layers,
                      label: "Obby",
                      text: "Buat game Roblox obby dengan checkpoint dan sistem respawn yang divalidasi server.",
                    },
                    {
                      icon: Globe2,
                      label: "Dunia 3D",
                      text: "Rancang map Roblox berupa pulau dengan jalur, spawn, dan objek interaktif.",
                    },
                    {
                      icon: ShieldCheck,
                      label: "Arena",
                      text: "Susun game arena Roblox dengan sistem ronde dan skor server.",
                    },
                    {
                      icon: MessageSquare,
                      label: "Roleplay",
                      text: "Buat struktur game Roblox roleplay dengan sistem pekerjaan.",
                    },
                  ]
                : projectKind === "mobile"
                  ? [
                      {
                        icon: Code2,
                        label: "Catatan",
                        text: "Buat aplikasi Expo untuk menulis dan mengelola catatan.",
                      },
                      {
                        icon: ShoppingBag,
                        label: "Katalog",
                        text: "Buat aplikasi mobile Expo katalog produk dengan pencarian.",
                      },
                      {
                        icon: Check,
                        label: "Kebiasaan",
                        text: "Buat aplikasi Expo pelacak kebiasaan harian.",
                      },
                      {
                        icon: MessageSquare,
                        label: "Komunitas",
                        text: "Rancang aplikasi Expo untuk komunitas dan agenda kegiatan.",
                      },
                    ]
                  : [
                      {
                        icon: Globe2,
                        label: "Website bisnis",
                        text: "Buat website bisnis kreatif yang profesional dengan profil, layanan, dan kontak.",
                      },
                      {
                        icon: LayoutDashboard,
                        label: "Dashboard",
                        text: templates[1].prompt,
                      },
                      {
                        icon: ShoppingBag,
                        label: "Toko online",
                        text: templates[2].prompt,
                      },
                      {
                        icon: Palette,
                        label: "Portfolio",
                        text: templates[3].prompt,
                      },
                    ]
              ).map(({ icon: Icon, label, text }) => (
                <button
                  key={label}
                  onClick={() => {
                    setPrompt(text);
                    document.getElementById("hero-prompt")?.focus();
                  }}
                >
                  <Icon size={13} />
                  {label}
                  <Plus size={11} />
                </button>
              ))}
            </div>
            <div className="hero-footnote">
              <span>
                <Check size={13} /> Mulai gratis
              </span>
              <i />
              <span>
                <Check size={13} /> Tanpa kartu kredit
              </span>
              <i />
              <span>
                <Check size={13} /> Kode sepenuhnya milik Anda
              </span>
            </div>
          </div>
          <div className="hero-bottom">
            <span>DARI “BAGAIMANA KALAU” JADI “INI HASILNYA”.</span>
            <div>
              <span>DIDESAIN UNTUK PARA PEMBUAT</span>
              <ArrowRight size={14} />
            </div>
          </div>
        </section>
        <section className="templates-section section-container" id="templates">
          <div className="section-heading" data-reveal="fade">
            <div>
              <div className="eyebrow-label">
                <span /> SEBUAH TITIK AWAL
              </div>
              <h2>Tak perlu mulai dari nol.</h2>
              <p>Sedikit inspirasi untuk ide besar Anda berikutnya.</p>
            </div>
            <Link className="text-link" to="/projects?tab=templates">
              Jelajahi semua template <ArrowUpRight size={17} />
            </Link>
          </div>
          <div
            className="template-tabs"
            role="tablist"
            aria-label="Kategori template"
            data-reveal="fade"
            style={revealDelay(120)}
          >
            {categories.map((c) => (
              <button
                key={c}
                role="tab"
                aria-selected={category === c}
                onClick={() => setCategory(c)}
                className={c === category ? "active" : ""}
              >
                {c}
              </button>
            ))}
          </div>
          <div
            className="template-grid"
            key={category}
            data-reveal="fade"
            data-stagger
          >
            {filtered.map((t) => (
              <button
                className="template-card"
                key={t.id}
                onClick={() => selectTemplate(t.id)}
              >
                <div className="template-visual" aria-hidden="true">
                  <TemplatePreview type={t.id} />
                  <span className="template-use">
                    Gunakan template <ArrowUpRight size={13} />
                  </span>
                </div>
                <div className="template-card-label">
                  <div>
                    <h3>{t.name}</h3>
                    <span>{t.category}</span>
                  </div>
                  <span className="template-arrow">
                    <ArrowUpRight size={17} />
                  </span>
                </div>
              </button>
            ))}
          </div>
          <div
            className="template-note"
            data-reveal="fade"
            style={revealDelay(200)}
          >
            <span>
              <Code2 size={14} /> Bukan sekadar mockup. Aplikasi sungguhan,
              dengan kode yang bisa Anda kembangkan.
            </span>
            <span>
              Dibuat dengan PiwuApp <span className="tiny-star">✳</span>
            </span>
          </div>
        </section>
        <section className="how-section section-container" id="how-it-works">
          <div className="section-heading" data-reveal="fade">
            <div>
              <div className="eyebrow-label">
                <span /> DARI PIKIRAN KE LAYAR
              </div>
              <h2>Sesederhana bercerita.</h2>
            </div>
            <p>
              Tidak perlu menunggu tim besar.
              <br />
              Mulai dengan satu ide, hari ini.
            </p>
          </div>
          <div className="steps-grid" data-reveal data-stagger>
            <article>
              <div className="step-top">
                <span>01</span>
                <MessageSquare size={21} />
              </div>
              <h3>Ceritakan ide Anda</h3>
              <p>
                Aplikasi seperti apa yang Anda bayangkan? Tulis dengan bahasa
                sendiri, atau mulai dari template.
              </p>
              <div className="step-example">
                <span className="mini-user">A</span>“Buat toko online untuk
                brand kopi saya…”
              </div>
            </article>
            <article>
              <div className="step-top">
                <span>02</span>
                <Layers size={21} />
              </div>
              <h3>Bangun bersama AI</h3>
              <p>
                Lihat ide menjadi nyata. Diskusikan rencana, ubah detail, dan
                sempurnakan langsung di workspace.
              </p>
              <div className="step-example code-example">
                <Check size={14} />
                <code>src/App.tsx</code>
                <span>Selesai</span>
              </div>
            </article>
            <article>
              <div className="step-top">
                <span>03</span>
                <ArrowUpRight size={23} />
              </div>
              <h3>Siap bertemu dunia</h3>
              <p>
                Tinjau hasilnya di berbagai perangkat, lalu unduh kode ZIP dan
                jalankan di hosting pilihan Anda sendiri.
              </p>
              <div className="step-example">
                <Download size={15} />
                <span>project-anda.zip</span>
                <span className="coming-tag">Siap</span>
              </div>
            </article>
          </div>
        </section>
        <section className="features-section" id="features">
          <div className="section-container">
            <div className="section-heading" data-reveal="fade">
              <div>
                <div className="eyebrow-label">
                  <span /> SATU RUANG. SEMUA KEMUNGKINAN.
                </div>
                <h2>
                  Anda punya visi.
                  <br />
                  Kami siapkan ruangnya.
                </h2>
              </div>
              <p>
                Dari percakapan pertama sampai baris kode terakhir,
                <br />
                semuanya di satu tempat yang terasa familier.
              </p>
            </div>
            <div className="feature-layout" data-reveal>
              <div className="workspace-illustration" aria-hidden="true">
                <div className="illustration-bar">
                  <div className="window-dots">
                    <i />
                    <i />
                    <i />
                  </div>
                  <span>Project luar biasa Anda</span>
                  <span>↗</span>
                </div>
                <div className="illustration-body">
                  <aside>
                    <Code2 size={16} />
                    <Layers size={16} />
                    <Globe2 size={16} />
                  </aside>
                  <div className="illustration-code">
                    <div>
                      <span className="blue-text">&lt;IdeAnda</span>
                    </div>
                    <div>
                      &nbsp; inspirasi=
                      <span className="green-text">"tanpa batas"</span>
                    </div>
                    <div>
                      &nbsp; dibuat=
                      <span className="green-text">"bersama PiwuApp"</span>
                    </div>
                    <div>
                      <span className="blue-text">/&gt;</span>
                    </div>
                    <div className="illustration-preview">
                      <span>Halo, dunia.</span>
                      <div />
                      <small>INI BARU PERMULAAN ↗</small>
                    </div>
                  </div>
                  <div className="illustration-chat">
                    <span className="ai-badge">✳</span>
                    <p>
                      Mari wujudkan
                      <br />
                      ide Anda.
                    </p>
                    <div className="skeleton-line" />
                    <div className="skeleton-line short" />
                    <div className="illustration-success">
                      <Check size={12} /> Preview siap
                    </div>
                    <div className="fake-input">
                      Apa selanjutnya? <ArrowRight size={12} />
                    </div>
                  </div>
                </div>
              </div>
              <div className="feature-list" data-reveal data-stagger>
                {[
                  {
                    icon: MessageSquare,
                    title: "Percakapan yang jadi karya",
                    text: "Bangun, rencanakan, atau tanya tentang kode. Pilih cara kerja yang paling cocok untuk Anda.",
                  },
                  {
                    icon: Code2,
                    title: "Kontrol penuh, tanpa batasan",
                    text: "Edit kode langsung, lihat preview secara instan, dan pulihkan versi sebelumnya kapan saja.",
                  },
                  {
                    icon: MousePointer2,
                    title: "Detail kecil, perubahan besar",
                    text: "Pilih elemen di canvas dan sesuaikan tampilannya tanpa kehilangan konteks.",
                  },
                  {
                    icon: ShieldCheck,
                    title: "Project Anda, tetap milik Anda",
                    text: "Ekspor kode kapan saja. Dengan arsitektur yang memisahkan data dan akses setiap project.",
                  },
                ].map(({ icon: Icon, title, text }) => (
                  <article key={title}>
                    <span className="feature-icon">
                      <Icon size={19} />
                    </span>
                    <div>
                      <h3>{title}</h3>
                      <p>{text}</p>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          </div>
        </section>
        <section className="pricing-section section-container" id="pricing">
          <div className="pricing-heading" data-reveal="fade">
            <div className="eyebrow-label">
              <span /> RUANG UNTUK BERTUMBUH
            </div>
            <h2>Mulai kecil. Bermimpi besar.</h2>
            <p>
              Pilih ruang yang tepat untuk perjalanan Anda. Semua paket memakai
              builder, template, AI, dan kolaborasi yang sama — yang berbeda
              adalah harga dan jumlah kreditnya.
            </p>
          </div>
          <div className="pricing-grid" data-reveal data-stagger>
            {planCards.map((p, i) => (
              <article
                key={p.name}
                className={"pricing-card " + (i === 1 ? "featured" : "")}
              >
                {i === 1 && (
                  <span className="popular-label">
                    UNTUK IDE YANG LEBIH BESAR <Sparkles size={11} />
                  </span>
                )}
                <h3>{p.name}</h3>
                <p>{p.desc}</p>
                <div className="price">
                  {p.name === "Free" ? (
                    <span className="price-value">Gratis</span>
                  ) : (
                    <>
                      <small>Rp</small>
                      <span className="price-value">{p.price}</span>
                      <span>/ bulan</span>
                    </>
                  )}
                </div>
                <div className="pricing-credit">
                  <b>{creditHeadline(ladder(p.name))}</b>
                  <span>{creditNote(ladder(p.name))}</span>
                </div>
                <button
                  className={
                    "button " + (i === 1 ? "button-dark" : "button-outline")
                  }
                  onClick={() =>
                    i === 0 ? navigate("/login") : setModal("Paket " + p.name)
                  }
                >
                  {p.button}
                  <ArrowUpRight size={14} />
                </button>
                <div className="price-divider" />
                {p.features.map((f) => (
                  <div className="price-feature" key={f}>
                    <Check size={14} />
                    {f}
                  </div>
                ))}
                {i > 0 && (
                  <small className="pricing-disclaimer">
                    Rencana harga · belum tersedia untuk pembelian
                  </small>
                )}
              </article>
            ))}
          </div>
          <p className="pricing-note">
            Harga di atas berlaku 30 hari. Semua paket membuka builder yang
            sama: tidak ada fitur yang dikunci per paket. Jatah harian direset
            setiap hari pukul 00:00 UTC dan tidak menumpuk; kredit paket{" "}
            {expiryLabel(CREDIT_EXPIRY_MONTHS.plan)}, kredit top-up berlaku{" "}
            {CREDIT_EXPIRY_MONTHS.topup} bulan. Perkiraan durasi di atas
            dihitung dari biaya nyata per operasi ({costLine()}), jadi angkanya
            aritmetika, bukan janji.
          </p>
        </section>
        <section
          className="security-strip section-container"
          id="security"
          data-reveal="fade"
        >
          <ShieldCheck size={29} />
          <div>
            <h3>Ide Anda berharga. Begitu juga data Anda.</h3>
            <p>
              Preview terisolasi, kode milik Anda, dan konfigurasi akses
              berbasis peran untuk project cloud.
            </p>
          </div>
          <button
            className="text-link"
            onClick={() => setModal("Keamanan & privasi")}
          >
            Tentang keamanan <ArrowUpRight size={16} />
          </button>
        </section>
        <section className="faq-section section-container" id="faq">
          <div data-reveal="fade">
            <div className="eyebrow-label">
              <span /> SEBELUM ANDA MULAI
            </div>
            <h2>
              Ada pertanyaan?
              <br />
              Wajar, kok.
            </h2>
            <p>
              Beberapa hal yang mungkin
              <br />
              sedang Anda pikirkan.
            </p>
          </div>
          <div className="faq-list" data-reveal="fade" data-stagger>
            {faqs.map(([q, a], i) => (
              <article key={q} className={faq === i ? "expanded" : ""}>
                <button
                  aria-expanded={faq === i}
                  onClick={() => setFaq(faq === i ? null : i)}
                >
                  {q}
                  {faq === i ? <Minus size={16} /> : <Plus size={16} />}
                </button>
                {faq === i && <p>{a}</p>}
              </article>
            ))}
          </div>
        </section>
        <section className="cta-section">
          <div className="eyebrow-label">
            IDE ITU SUDAH CUKUP LAMA DI KEPALA.
          </div>
          <h2>Sekarang, buat jadi nyata.</h2>
          <Link to="/login" className="button button-dark">
            Bangun ide pertama Anda <ArrowUpRight size={16} />
          </Link>
          <p>Mulai gratis. Tidak perlu sempurna untuk memulai.</p>
          <span className="cta-doodle">✳</span>
        </section>
      </main>
      <footer className="site-footer section-container">
        <div className="footer-top" data-reveal="fade">
          <div>
            <Logo />
            <p>
              Ruang untuk ide.
              <br />
              Tempat untuk mewujudkannya.
            </p>
          </div>
          <div>
            <h3 className="footer-heading">Produk</h3>
            <a href="#features">Fitur</a>
            <a href="#templates">Template</a>
            <a href="#pricing">Harga</a>
          </div>
          <div>
            <h3 className="footer-heading">Sumber daya</h3>
            <a href="#how-it-works">Panduan memulai</a>
            <a href="#faq">Pusat bantuan</a>
            <button onClick={() => setModal("Komunitas PiwuApp")}>
              Komunitas
            </button>
          </div>
          <div>
            <h3 className="footer-heading">PiwuApp</h3>
            <button onClick={() => setModal("Tentang PiwuApp")}>
              Tentang kami
            </button>
            <button onClick={() => setModal("Keamanan & privasi")}>
              Privasi & keamanan
            </button>
            <button onClick={() => setModal("Ketentuan penggunaan")}>
              Ketentuan penggunaan
            </button>
          </div>
        </div>
        <div
          className="footer-bottom"
          data-reveal="fade"
          style={revealDelay(140)}
        >
          <span>
            © {new Date().getFullYear()} PiwuApp. Dibuat untuk mewujudkan ide.
          </span>
          <span>
            Dari Indonesia, untuk semua <Heart size={12} />
            <span className="language-label">
              <Globe2 size={13} /> Bahasa Indonesia
            </span>
          </span>
        </div>
      </footer>
      {modal && (
        <Modal title={modal} onClose={() => setModal("")}>
          <div className="modal-content">
            <span className="modal-feature-icon">
              <Sparkles size={24} />
            </span>
            <h3>
              {modal.includes("Paket")
                ? "Bertumbuh bersama PiwuApp."
                : modal.includes("Keamanan")
                  ? "Transparan sejak awal."
                  : modal.includes("Komunitas")
                    ? "Ruang untuk para pembuat."
                    : "Dari ide, jadi nyata."}
            </h3>
            <p>
              {modal.includes("Paket")
                ? "Paket berbayar dan pembayaran lokal belum diaktifkan. Aktivasi provider pembayaran diperlukan. Harga di halaman ini adalah rencana harga, bukan penawaran transaksi."
                : modal.includes("Keamanan")
                  ? "Project akun disinkronkan ke database cloud dengan cache lokal terpisah per akun. Periksa status sinkronisasi sebelum menutup halaman. Jangan memasukkan data sensitif atau API key ke kode; gunakan secrets terenkripsi. Preview dijalankan dalam iframe terisolasi."
                  : modal.includes("Komunitas")
                    ? "Komunitas PiwuApp sedang disiapkan. Sambil menunggu, jelajahi template dan mulai bangun karya pertama Anda."
                    : modal.includes("Ketentuan")
                      ? "PiwuApp saat ini tersedia sebagai versi pengembangan. Tinjau kode, keamanan, dan hak atas aset sebelum mempublikasikan aplikasi Anda. Integrasi produksi memerlukan konfigurasi layanan terpisah."
                      : "PiwuApp dibuat untuk membantu siapa pun mengubah gagasan menjadi aplikasi. Mulai dari percakapan sederhana, dengan kebebasan untuk memiliki dan mengembangkan kode sendiri."}
            </p>
            <Link to="/login" className="button button-dark">
              Coba workspace <ArrowUpRight size={15} />
            </Link>
          </div>
        </Modal>
      )}
    </div>
  );
}
