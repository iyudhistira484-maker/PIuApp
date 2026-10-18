import ProjectKindPicker from "../components/projects/ProjectKindPicker";
import type { ProjectKind } from "../lib/project-kinds";
import LandingNav from "../components/landing/LandingNav";
import "../components/landing/landing-motion.css";
import "../components/landing/landing.css";
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
  ArrowUpRight,
  ArrowDown,
  Check,
  Plus,
  Minus,
  Code2,
  ShieldCheck,
  Globe2,
} from "lucide-react";
import { Logo, Modal } from "../components/ui";
import PromptBox from "../components/PromptBox";
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

const steps = [
  {
    title: "Tulis kebutuhan",
    text: "Jelaskan aplikasi yang Anda butuhkan dengan bahasa sehari-hari, atau mulai dari template. Pilih mode Bangun untuk langsung membuat, atau Rencana untuk meninjau langkahnya lebih dulu.",
    detail: "Mode Bangun · Rencana · Tanya",
  },
  {
    title: "Tinjau perubahan",
    text: "Setiap file yang berubah ditampilkan sebelum diterapkan. Bandingkan isinya, terima yang sesuai, lalu lanjutkan dari workspace.",
    detail: "Tinjauan file · riwayat versi",
  },
  {
    title: "Ekspor kode",
    text: "Preview berjalan di sandbox terisolasi. Setelah selesai, unduh seluruh kode sebagai ZIP dan jalankan di hosting pilihan Anda.",
    detail: "Export ZIP · tanpa kunci",
  },
];

const features = [
  {
    title: "Kode dan preview berdampingan",
    text: "Edit file di editor, jalankan preview di panel sebelahnya, dan periksa hasilnya tanpa berpindah tab.",
  },
  {
    title: "Riwayat versi",
    text: "Perubahan besar membuat snapshot. Bandingkan versi, pulihkan bila perlu, dan lanjutkan dari titik yang benar.",
  },
  {
    title: "Export ZIP",
    text: "Seluruh kode project dapat diunduh kapan saja. Tidak ada kunci, tidak ada ketergantungan pada PiwuApp.",
  },
  {
    title: "Akses per peran",
    text: "Project cloud memakai peran Editor dan Viewer. Viewer tetap bisa membuka preview dan mengunduh kode.",
  },
];

const heroFacts = [
  ["Jenis project", "Web · Mobile · Roblox"],
  ["Editor", "Kode, preview, canvas"],
  ["Keluaran", "ZIP, kode milik Anda"],
  ["Antarmuka", "Bahasa Indonesia"],
];

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
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    hero.current?.scrollIntoView({
      behavior: reduce.matches ? "auto" : "smooth",
      block: "center",
    });
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
  const suggestions =
    projectKind === "roblox"
      ? [
          {
            label: "Obby",
            text: "Buat game Roblox obby dengan checkpoint dan sistem respawn yang divalidasi server.",
          },
          {
            label: "Dunia 3D",
            text: "Rancang map Roblox berupa pulau dengan jalur, spawn, dan objek interaktif.",
          },
          {
            label: "Arena",
            text: "Susun game arena Roblox dengan sistem ronde dan skor server.",
          },
          {
            label: "Roleplay",
            text: "Buat struktur game Roblox roleplay dengan sistem pekerjaan.",
          },
        ]
      : projectKind === "mobile"
        ? [
            {
              label: "Catatan",
              text: "Buat aplikasi Expo untuk menulis dan mengelola catatan.",
            },
            {
              label: "Katalog",
              text: "Buat aplikasi mobile Expo katalog produk dengan pencarian.",
            },
            {
              label: "Kebiasaan",
              text: "Buat aplikasi Expo pelacak kebiasaan harian.",
            },
            {
              label: "Komunitas",
              text: "Rancang aplikasi Expo untuk komunitas dan agenda kegiatan.",
            },
          ]
        : [
            {
              label: "Website bisnis",
              text: "Buat website bisnis kreatif yang profesional dengan profil, layanan, dan kontak.",
            },
            { label: "Dashboard", text: templates[1].prompt },
            { label: "Toko online", text: templates[2].prompt },
            { label: "Portfolio", text: templates[3].prompt },
          ];
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

        <section className="hero-section">
          <div className="hero-media" aria-hidden="true">
            <video
              className="hero-video"
              autoPlay
              muted
              loop
              playsInline
              preload="metadata"
            >
              <source src="/landing/hero/hero.mp4" type="video/mp4" />
            </video>
            <div className="hero-scrim" />
          </div>
          <div className="hero-content">
            <p className="lp-kicker">
              <span>01</span> Ruang kerja aplikasi
            </p>
            <h1>
              {siteSettings.hero_title || (
                <>
                  Bangun aplikasi
                  <br />
                  yang benar-benar dipakai.
                </>
              )}
            </h1>
            <p className="hero-subtitle">
              {siteSettings.hero_subtitle || (
                <>
                  Tulis kebutuhan Anda dalam bahasa Indonesia. PiwuApp menyusun
                  rencana, menulis kode, dan menampilkan preview yang bisa
                  langsung diedit. Ekspor seluruh kode sebagai ZIP kapan saja.
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
              <span>Contoh permintaan</span>
              {suggestions.map(({ label, text }) => (
                <button
                  key={label}
                  onClick={() => {
                    setPrompt(text);
                    document.getElementById("hero-prompt")?.focus();
                  }}
                >
                  {label}
                  <Plus size={11} aria-hidden="true" />
                </button>
              ))}
            </div>
            <dl className="hero-facts">
              {heroFacts.map(([term, value]) => (
                <div key={term}>
                  <dt>{term}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            <ul className="hero-footnote">
              <li>
                <Check size={13} aria-hidden="true" /> Mulai gratis
              </li>
              <li>
                <Check size={13} aria-hidden="true" /> Tanpa kartu kredit
              </li>
              <li>
                <Check size={13} aria-hidden="true" /> Kode sepenuhnya milik
                Anda
              </li>
            </ul>
          </div>
          <a className="hero-scroll" href="#templates">
            Lihat template <ArrowDown size={12} aria-hidden="true" />
          </a>
        </section>

        <section className="templates-section section-container" id="templates">
          <header className="lp-section-head" data-reveal="fade">
            <div>
              <p className="lp-kicker">
                <span>02</span> Template
              </p>
              <h2>Mulai dari struktur yang sudah jadi.</h2>
            </div>
            <div className="lp-section-lead">
              <p>
                Template membawa kode sumber yang bisa Anda ubah, bukan gambar
                mockup. Pilih kategori, buka di workspace, lalu sesuaikan.
              </p>
              <Link className="text-link" to="/projects?tab=templates">
                Jelajahi semua template <ArrowUpRight size={15} />
              </Link>
            </div>
          </header>
          <div
            className="template-tabs"
            role="tablist"
            aria-label="Kategori template"
            data-reveal="fade"
            style={revealDelay(80)}
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
                data-template={t.id}
                onClick={() => selectTemplate(t.id)}
              >
                <div className="template-visual" aria-hidden="true">
                  <img
                    className="template-thumb"
                    src={`/landing/templates/${t.id}.webp`}
                    alt=""
                    width={560}
                    height={400}
                    loading="lazy"
                    decoding="async"
                  />
                  <span className="template-use">
                    Gunakan template <ArrowUpRight size={12} />
                  </span>
                </div>
                <div className="template-card-label">
                  <div>
                    <h3>{t.name}</h3>
                    <span>{t.category}</span>
                  </div>
                  <span className="template-arrow">
                    <ArrowUpRight size={15} aria-hidden="true" />
                  </span>
                </div>
              </button>
            ))}
          </div>
          <div
            className="template-note"
            data-reveal="fade"
            style={revealDelay(140)}
          >
            <span>
              <Code2 size={14} aria-hidden="true" /> Setiap template menyertakan
              kode sumber yang bisa diedit dan diekspor.
            </span>
            <span>
              {filtered.length} dari {templates.length} template
            </span>
          </div>
        </section>

        <section className="how-section section-container" id="how-it-works">
          <header className="lp-section-head" data-reveal="fade">
            <div>
              <p className="lp-kicker">
                <span>03</span> Alur kerja
              </p>
              <h2>Tiga langkah, satu alur.</h2>
            </div>
            <div className="lp-section-lead">
              <p>
                Tidak ada langkah tersembunyi. Setiap perubahan file bisa
                ditinjau sebelum diterapkan, dan setiap versi bisa dipulihkan.
              </p>
            </div>
          </header>
          <div className="steps-grid" data-reveal data-stagger>
            {steps.map((step, index) => (
              <article key={step.title}>
                <span className="step-index">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <h3>{step.title}</h3>
                <p>{step.text}</p>
                <span className="step-detail">{step.detail}</span>
              </article>
            ))}
          </div>
        </section>

        <section className="features-section" id="features">
          <div className="section-container">
            <header className="lp-section-head" data-reveal="fade">
              <div>
                <p className="lp-kicker">
                  <span>04</span> Workspace
                </p>
                <h2>Semua bagian project terlihat.</h2>
              </div>
              <div className="lp-section-lead">
                <p>
                  File, preview, dan status penyimpanan berada di satu layar.
                  Tidak ada panel yang disembunyikan di balik menu lain.
                </p>
              </div>
            </header>
            <div className="feature-layout" data-reveal>
              <div className="feature-copy">
                {features.map((feature) => (
                  <article key={feature.title}>
                    <h3>{feature.title}</h3>
                    <p>{feature.text}</p>
                  </article>
                ))}
              </div>
              <figure className="feature-shot">
                <img
                  src="/landing/workspace.webp"
                  alt="Workspace PiwuApp menampilkan daftar file, preview aplikasi, dan status penyimpanan."
                  width={1400}
                  height={858}
                  loading="lazy"
                />
                <figcaption>
                  Workspace PiwuApp: file project, preview, dan status
                  sinkronisasi.
                </figcaption>
              </figure>
            </div>
          </div>
        </section>

        <section className="pricing-section section-container" id="pricing">
          <header className="lp-section-head" data-reveal="fade">
            <div>
              <p className="lp-kicker">
                <span>05</span> Harga
              </p>
              <h2>Harga dan kredit.</h2>
            </div>
            <div className="lp-section-lead">
              <p>
                Paket menentukan jumlah kredit, bukan fitur. Semua paket memakai
                builder, template, editor, dan Export ZIP yang sama.
              </p>
            </div>
          </header>
          <div className="pricing-grid" data-reveal data-stagger>
            {planCards.map((p, i) => (
              <article
                key={p.name}
                className={"pricing-card " + (i === 1 ? "featured" : "")}
              >
                {i === 1 && <span className="popular-label">Rekomendasi</span>}
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
                    <Check size={14} aria-hidden="true" />
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
            Harga di atas berlaku 30 hari, dan tidak ada fitur yang dikunci per
            paket. Jatah harian direset setiap hari pukul 00:00 UTC dan tidak
            menumpuk; kredit paket {expiryLabel(CREDIT_EXPIRY_MONTHS.plan)},
            kredit top-up berlaku {CREDIT_EXPIRY_MONTHS.topup} bulan. Perkiraan
            durasi dihitung dari biaya nyata per operasi ({costLine()}), jadi
            angkanya aritmetika, bukan janji.
          </p>
        </section>

        <section
          className="security-strip section-container"
          id="security"
          data-reveal="fade"
        >
          <ShieldCheck size={24} aria-hidden="true" />
          <div>
            <h3>Keamanan dan kepemilikan kode.</h3>
            <p>
              Preview berjalan di sandbox terisolasi. Project cloud memakai
              konfigurasi akses berbasis peran, dan seluruh kode tetap bisa Anda
              ekspor.
            </p>
          </div>
          <button
            className="text-link"
            onClick={() => setModal("Keamanan & privasi")}
          >
            Tentang keamanan <ArrowUpRight size={15} />
          </button>
        </section>

        <section className="faq-section section-container" id="faq">
          <div className="faq-intro" data-reveal="fade">
            <p className="lp-kicker">
              <span>06</span> FAQ
            </p>
            <h2>Pertanyaan umum</h2>
            <p>
              Jawaban singkat tentang akun, kode, dan apa yang tersedia pada
              versi ini.
            </p>
          </div>
          <div className="faq-list" data-reveal="fade" data-stagger>
            {faqs.map(([q, a], i) => (
              <article key={q} className={faq === i ? "expanded" : ""}>
                <h3>
                  <button
                    id={`faq-question-${i}`}
                    aria-expanded={faq === i}
                    aria-controls={`faq-answer-${i}`}
                    onClick={() => setFaq(faq === i ? null : i)}
                  >
                    {q}
                    {faq === i ? (
                      <Minus size={16} aria-hidden="true" />
                    ) : (
                      <Plus size={16} aria-hidden="true" />
                    )}
                  </button>
                </h3>
                <div
                  id={`faq-answer-${i}`}
                  role="region"
                  aria-labelledby={`faq-question-${i}`}
                  hidden={faq !== i}
                >
                  <p>{a}</p>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="cta-section">
          <div className="cta-inner section-container">
            <div>
              <p className="lp-kicker">
                <span>07</span> Mulai
              </p>
              <h2>Mulai dari project pertama.</h2>
              <p className="cta-note">
                Gratis untuk {creditHeadline(ladder("Free"))}. Tanpa kartu
                kredit.
              </p>
            </div>
            <Link to="/login" className="cta-button">
              Buat project <ArrowUpRight size={16} aria-hidden="true" />
            </Link>
          </div>
        </section>
      </main>

      <footer className="site-footer section-container">
        <div className="footer-top" data-reveal="fade">
          <div>
            <Logo />
            <p>
              Ruang kerja untuk membuat aplikasi. Bahasa Indonesia, kode tetap
              milik Anda.
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
          style={revealDelay(120)}
        >
          <span>© {new Date().getFullYear()} PiwuApp</span>
          <span>
            <Globe2 size={13} aria-hidden="true" /> Bahasa Indonesia
          </span>
        </div>
      </footer>

      {modal && (
        <Modal title={modal} onClose={() => setModal("")}>
          <div className="modal-content">
            <h3>
              {modal.includes("Paket")
                ? "Paket dan pembayaran."
                : modal.includes("Keamanan")
                  ? "Keamanan dan privasi."
                  : modal.includes("Komunitas")
                    ? "Komunitas PiwuApp."
                    : "Tentang PiwuApp."}
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
