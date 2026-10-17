import { downloadText } from "../lib/download";
import { adminCSV } from "../lib/admin-csv";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  LayoutDashboard,
  Users,
  FolderKanban,
  CreditCard,
  Store,
  Megaphone,
  Server,
  Settings,
  ShieldCheck,
  ScrollText,
  ArrowUpRight,
  RefreshCw,
  Plus,
  Search,
  ArrowLeft,
  CheckCircle2,
  LockKeyhole,
  Radio,
  Sparkles,
  Cpu,
  Gauge,
  Wallet,
  Database,
  Puzzle,
} from "lucide-react";
import { Logo, Modal } from "../components/ui";
import { useStore } from "../lib/store";
import { api } from "../services/api";
import {
  CREDIT_EXPIRY_MONTHS,
  PLAN_LADDER,
  costLine,
  expiryLabel,
  mergePlans,
  mergeTopups,
} from "../../shared/credits.mjs";
import {
  PROJECT_PHOTOS_BYTES_MAX,
  PROJECT_PHOTOS_MAX,
} from "../lib/photo-assets";
import "./admin.css";
/**
 * The "credits are running out" line, matching src/lib/dashboard/credits.ts
 * CREDIT_LOW and server/lib/admin-insights.mjs LOW_BALANCE. The server sends
 * its own number with the overview payload; this is the fallback for older
 * servers and for the per-account panel.
 */
const LOW_BALANCE = 10;
const sections = [
  ["overview", "Ringkasan", LayoutDashboard],
  ["users", "Pengguna", Users],
  ["projects", "Project", FolderKanban],
  ["payments", "Transaksi & kredit", CreditCard],
  ["marketplace", "Marketplace", Store],
  ["broadcasts", "Broadcast", Megaphone],
  ["operations", "Operasional", Server],
  ["ai", "AI & model", Sparkles],
  ["diagnostics", "Diagnostik", ShieldCheck],
  ["settings", "Pengaturan situs", Settings],
  ["roles", "Administrator", ShieldCheck],
  ["audit", "Audit log", ScrollText],
] as const;
type Section = (typeof sections)[number][0];
type Row = Record<string, any>;
const names: Record<string, string> = {
  superadmin: "Superadmin",
  operator: "Operator",
  auditor: "Auditor",
  published: "Tayang",
  draft: "Draf",
  archived: "Diarsipkan",
  public: "Publik",
  members: "Semua member",
  pro: "Member Pro",
  team: "Member Team",
  paid: "Lunas",
  pending: "Menunggu",
  created: "Dibuat",
  review: "Perlu ditinjau",
  refunded: "Dibatalkan penyedia",
  failed: "Gagal",
  ready: "Selesai",
  expired: "Kedaluwarsa",
  checkout_error: "Checkout gagal",
  queued: "Antrean",
  // Roblox Studio bridge states (studio_bridges.state).
  idle: "Siaga",
  applying: "Menerapkan",
  applied: "Diterapkan",
  building: "Memproses",
  active: "Aktif",
  admin_role: "Perubahan peran",
  bootstrap_superadmin: "Aktivasi superadmin pertama",
  user_suspend: "Status akun",
  user_delete: "Hapus akun",
  credits: "Penyesuaian kredit",
  project_lock: "Kunci project",
  project_delete: "Hapus project",
  template_status: "Moderasi template",
  recording_revoke: "Cabut tautan rekaman",
  payment_reconcile: "Rekonsiliasi pembayaran",
  kyc_review: "Tinjauan verifikasi penjual",
  payout_review: "Tinjauan payout",
  dispute_review: "Keputusan sengketa",
  broadcast_save: "Simpan broadcast",
  settings: "Pengaturan situs",
};
const label = (v: string) => names[v] || v || "—";
const date = (v: string) =>
  v
    ? new Date(v).toLocaleString("id-ID", {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "—";
const money = (v: number) =>
  new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(v);
const short = (v: string) => (v ? v.slice(0, 8) + "…" : "—");
/** Indonesian wording for insight payloads; unknown keys stay verbatim. */
const insightLabel = (v: string) =>
  (
    ({
      ai: "Chat AI",
      sandbox: "Sandbox",
      plan: "Rencana",
      build: "Builder",
      settled: "Selesai",
      refunded: "Dibatalkan penyedia",
      reserved: "Berjalan",
      active: "Berjalan",
    }) as Record<string, string>
  )[v] || label(v);
const getAdmin = (path: string) => api<Row>("/admin/" + path);
function Badge({
  children,
  warn = false,
}: {
  children: ReactNode;
  warn?: boolean;
}) {
  return (
    <span className={"ad-badge " + (warn ? "ad-warning" : "")}>{children}</span>
  );
}
export default function Admin() {
  const user = useStore((s) => s.user);
  const [session, setSession] = useState<Row | null>(null),
    [error, setError] = useState(""),
    [checking, setChecking] = useState(true),
    [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let dead = false;
    setChecking(true);
    setError("");
    setSession(null);
    if (!user || user.demo) {
      setChecking(false);
      return;
    }
    getAdmin("session")
      .then((d) => {
        if (!dead) setSession(d);
      })
      .catch((e) => {
        if (!dead) setError(e.message);
      })
      .finally(() => {
        if (!dead) setChecking(false);
      });
    return () => {
      dead = true;
    };
  }, [user?.id, user?.demo, attempt]);
  if (checking || (session && session.userId !== user?.id))
    return (
      <div className="ad-gate" role="status">
        <ShieldCheck size={32} />
        <h1>Memverifikasi akses admin…</h1>
        <p>Peran diperiksa oleh server, bukan profil browser.</p>
      </div>
    );
  if (!session)
    return (
      <div className="ad-gate">
        <Logo />
        <div className="ad-gate-icon">
          <LockKeyhole size={32} />
        </div>
        <span className="ad-eyebrow">PUSAT KENDALI PIWUAPP</span>
        <h1>
          Ruang untuk mengelola
          <br />
          seluruh platform.
        </h1>
        <p>
          Pengguna, project, transaksi, dan komunikasi—dengan akses terbatas
          serta jejak audit yang jelas.
        </p>
        {error && (
          <p className="ad-error" role="alert">
            {error}
          </p>
        )}
        <div className="ad-gate-actions">
          {user && !user.demo ? (
            <button
              className="ad-primary"
              onClick={() => setAttempt((n) => n + 1)}
            >
              Periksa akses kembali
            </button>
          ) : (
            <Link className="ad-primary" to="/login">
              Masuk dengan akun admin <ArrowUpRight size={16} />
            </Link>
          )}
        </div>
        <small>
          Akses admin harus disetujui oleh server. Tidak ada panel simulasi.
        </small>
        <Link to="/projects" className="ad-back">
          <ArrowLeft size={14} /> Kembali ke workspace
        </Link>
      </div>
    );
  return <AdminPanel key={user?.id || "visitor"} session={session} />;
}
type AdminClient = (path: string, body?: unknown) => Promise<any>;
/** Shared read-only table renderer. `search`/`query` only drive the empty state. */
function table_(
  headers: string[],
  rows: Row[],
  render: (r: Row) => ReactNode,
  options: { search?: string; query?: string } = {},
) {
  return (
    <div
      className="ad-table-wrap"
      role="region"
      aria-label={"Tabel " + headers.join(", ")}
      tabIndex={0}
    >
      <table className="ad-table">
        <thead>
          <tr>
            {headers.map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id || r.user_id || i}>{render(r)}</tr>
          ))}
        </tbody>
      </table>
      {!rows.length && (
        <div className="ad-empty">
          <FolderKanban size={25} />
          <h3>
            {options.search ? "Tidak ada hasil pencarian" : "Belum ada data"}
          </h3>
          <p>
            {options.query
              ? "Ubah kata kunci atau filter pencarian."
              : "Data akan muncul ketika tersedia di platform."}
          </p>
        </div>
      )}
    </div>
  );
}

export function AdminPanel({
  session,
  client = api,
}: {
  session: Row | null;
  client?: AdminClient;
}) {
  const [params, setParams] = useSearchParams();
  const raw = params.get("tab");
  const tab: Section = sections.some((s) => s[0] === raw)
    ? (raw as Section)
    : "overview";
  const [page, setPage] = useState(1),
    [reload, setReload] = useState(0),
    [data, setData] = useState<Row | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [search, setSearch] = useState(""),
    [statusFilter, setStatusFilter] = useState(""),
    [actorFilter, setActorFilter] = useState(""),
    [since, setSince] = useState(""),
    [until, setUntil] = useState(""),
    [appliedQuery, setAppliedQuery] = useState(""),
    [command, setCommand] = useState<Row | null>(null),
    [editBroadcast, setEditBroadcast] = useState<Row | null>(null),
    [roleUser, setRoleUser] = useState(""),
    [newRole, setNewRole] = useState("auditor"),
    [creditUser, setCreditUser] = useState("");
  const role = session?.role || "auditor",
    canWrite = ["superadmin", "operator"].includes(role),
    superadmin = role === "superadmin";
  useEffect(() => {
    let dead = false;
    setLoading(true);
    setData(null);
    setError("");
    client("/admin/" + tab + "?page=" + page + appliedQuery)
      .then((d) => {
        if (!dead)
          setData({ ...d, _section: tab, _page: page, _query: appliedQuery });
      })
      .catch((e) => {
        if (!dead) setError(e.message);
      })
      .finally(() => {
        if (!dead) setLoading(false);
      });
    return () => {
      dead = true;
    };
  }, [tab, page, reload, appliedQuery, client]);
  const changeTab = (next: Section) => {
    setPage(1);
    setSearch("");
    setAppliedQuery("");
    setStatusFilter("");
    setActorFilter("");
    setSince("");
    setUntil("");
    setNotice("");
    setParams({ tab: next });
  };
  const ask = (
    action: string,
    target: string | null,
    payload: Row,
    detail: string,
  ) => setCommand({ action, target, payload, detail });
  const items: Row[] = data?.items || [];
  const title = sections.find((s) => s[0] === tab)![1];
  const act = (
    text: string,
    onClick: () => void,
    disabled = !canWrite,
    danger = false,
  ) => (
    <button
      className={"ad-action " + (danger ? "ad-danger" : "")}
      disabled={disabled}
      onClick={onClick}
    >
      {text}
    </button>
  );
  const table = (
    headers: string[],
    rows: Row[],
    render: (r: Row) => ReactNode,
  ) => table_(headers, rows, render, { search, query: appliedQuery });
  const broadcastStatus = (r: Row) =>
    r.status !== "published"
      ? label(r.status)
      : r.ends_at && Date.parse(r.ends_at) <= Date.now()
        ? "Berakhir"
        : Date.parse(r.starts_at) > Date.now()
          ? "Terjadwal"
          : "Sedang tayang";
  return (
    <div className="ad-shell">
      <a className="ad-skip" href="#admin-content">
        Lewati ke konten
      </a>
      <aside className="ad-sidebar">
        <Logo />
        <div className="ad-workspace">
          <span className="ad-workspace-icon">
            <ShieldCheck size={19} />
          </span>
          <div>
            <strong>Administrasi</strong>
            <small>Platform workspace</small>
          </div>
          <Badge>Internal</Badge>
        </div>
        <div className="ad-nav-label">KELOLA PLATFORM</div>
        <nav aria-label="Navigasi admin">
          {sections.map(([id, text, Icon], i) => (
            <button
              key={id}
              className={
                (tab === id ? "selected " : "") +
                (i === 7 ? "ad-nav-divider" : "")
              }
              aria-current={tab === id ? "page" : undefined}
              onClick={() => changeTab(id)}
            >
              <Icon size={18} />
              <span>{text}</span>
              {id === "broadcasts" && <span className="ad-nav-dot" />}
            </button>
          ))}
        </nav>
        <div className="ad-sidebar-bottom">
          <Link to="/projects">
            <ArrowLeft size={15} /> Kembali ke workspace
          </Link>
          <div className="ad-profile">
            <div>{(session?.email?.[0] || "A").toUpperCase()}</div>
            <span>
              <strong>{label(role)}</strong>
              <small>{session?.email}</small>
            </span>
          </div>
        </div>
      </aside>
      <div className="ad-main">
        <header className="ad-topbar">
          <span>
            Administrasi <span className="ad-slash">/</span> {title}
          </span>
          <div>
            <span className="ad-dot" />
            Akses terverifikasi
            <Link to="/" aria-label="Lihat website">
              <ArrowUpRight size={18} />
            </Link>
          </div>
        </header>
        <main id="admin-content" className="ad-content">
          <div className="ad-heading">
            <div>
              <span className="ad-eyebrow">PUSAT KENDALI</span>
              <h1>{title}</h1>
              <p>
                {tab === "broadcasts"
                  ? "Sampaikan informasi yang tepat, kepada audiens yang tepat."
                  : tab === "overview"
                    ? "Satu tempat untuk memahami dan mengelola PiwuApp."
                    : "Kelola platform dengan kontrol akses dan perubahan yang tercatat."}
              </p>
            </div>
            <div className="ad-heading-actions">
              <button
                className="ad-secondary"
                disabled={loading}
                onClick={() => setReload((n) => n + 1)}
              >
                <RefreshCw size={15} className={loading ? "ad-spinning" : ""} />{" "}
                Muat ulang
              </button>
              {tab === "broadcasts" && (
                <button
                  className="ad-primary"
                  disabled={!canWrite}
                  onClick={() =>
                    setEditBroadcast({
                      id: crypto.randomUUID(),
                      title: "",
                      body: "",
                      audience: "public",
                      status: "draft",
                      starts_at: new Date().toISOString(),
                      ends_at: null,
                      revision: 0,
                    })
                  }
                >
                  <Plus size={16} /> Buat broadcast
                </button>
              )}
            </div>
          </div>
          {role === "auditor" && (
            <div className="ad-banner">
              Akses auditor: seluruh halaman hanya baca.
            </div>
          )}
          {notice && (
            <div className="ad-success" role="status">
              <CheckCircle2 size={18} />
              {notice}
            </div>
          )}
          {error && (
            <div className="ad-error" role="alert">
              {error}{" "}
              <button onClick={() => setReload((n) => n + 1)}>Coba lagi</button>
            </div>
          )}
          {[
            "users",
            "projects",
            "payments",
            "marketplace",
            "broadcasts",
            "roles",
            "audit",
          ].includes(tab) && (
            <form
              className="ad-filters"
              onSubmit={(e) => {
                e.preventDefault();
                const query = new URLSearchParams();
                for (const [k, v] of Object.entries({
                  q: search,
                  status: statusFilter,
                  actor: actorFilter,
                  since,
                  until,
                }))
                  if (v.trim()) query.set(k, v.trim());
                setPage(1);
                setAppliedQuery(query.size ? "&" + query.toString() : "");
              }}
            >
              <label>
                Cari di seluruh daftar
                <input
                  aria-label="Cari di seluruh daftar"
                  maxLength={100}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={
                    tab === "users"
                      ? "Nama, email, atau ID akun"
                      : tab === "audit"
                        ? "Alasan atau ID audit"
                        : "Nama, judul, SKU, atau ID"
                  }
                />
              </label>
              {["payments", "marketplace", "broadcasts"].includes(tab) && (
                <label>
                  Filter status
                  <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                  >
                    <option value="">Semua status</option>
                    {(tab === "payments"
                      ? [
                          "created",
                          "pending",
                          "checkout_error",
                          "review",
                          "paid",
                          "failed",
                          "expired",
                          "refunded",
                        ]
                      : tab === "marketplace"
                        ? ["draft", "published", "archived"]
                        : ["draft", "published", "archived"]
                    ).map((v) => (
                      <option key={v} value={v}>
                        {label(v)}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {[
                "projects",
                "payments",
                "marketplace",
                "audit",
                "roles",
              ].includes(tab) && (
                <label>
                  ID pemilik / pelaku
                  <input
                    aria-label="ID pemilik atau pelaku"
                    value={actorFilter}
                    onChange={(e) => setActorFilter(e.target.value)}
                    placeholder="UUID (opsional)"
                  />
                </label>
              )}
              {tab !== "users" && (
                <>
                  <label>
                    Dari (UTC)
                    <input
                      type="date"
                      value={since}
                      onChange={(e) => setSince(e.target.value)}
                    />
                  </label>
                  <label>
                    Sampai (UTC)
                    <input
                      type="date"
                      min={since}
                      value={until}
                      onChange={(e) => setUntil(e.target.value)}
                    />
                  </label>
                </>
              )}
              <button className="ad-primary" type="submit">
                Terapkan filter
              </button>
              <button
                className="ad-secondary"
                type="button"
                onClick={() => {
                  setSearch("");
                  setStatusFilter("");
                  setActorFilter("");
                  setSince("");
                  setUntil("");
                  setAppliedQuery("");
                  setPage(1);
                }}
              >
                Reset filter
              </button>
            </form>
          )}
          {loading ||
          (data &&
            (data._section !== tab ||
              data._page !== page ||
              data._query !== appliedQuery)) ? (
            <div className="ad-loading" role="status">
              <RefreshCw size={22} className="ad-spinning" /> Memuat{" "}
              {title.toLowerCase()}…
            </div>
          ) : (
            data && (
              <>
                {tab === "overview" ? (
                  <>
                    <div className="ad-metrics">
                      {[
                        [
                          "projects",
                          "Total project",
                          FolderKanban,
                          "Data platform saat ini",
                        ],
                        [
                          "pending",
                          "Transaksi perlu perhatian",
                          CreditCard,
                          "Data platform saat ini",
                        ],
                        [
                          "templates",
                          "Template tayang",
                          Store,
                          "Data platform saat ini",
                        ],
                        [
                          "broadcasts",
                          "Broadcast dipublikasikan",
                          Megaphone,
                          "Data platform saat ini",
                        ],
                        [
                          "lowBalance",
                          "Akun kredit menipis",
                          Wallet,
                          `Saldo di bawah ${
                            data.metrics.lowBalanceThreshold ?? LOW_BALANCE
                          } — ambang yang sama dengan peringatan di dashboard pengguna`,
                        ],
                        [
                          "dormantWorkspaces",
                          "Salinan cloud diam",
                          Database,
                          "Salinan tersimpan yang tidak diperbarui 7 hari terakhir; bukan kegagalan sync",
                        ],
                      ].map(([key, text, Icon, note]: any) => (
                        <div className="ad-metric" key={key}>
                          <div>
                            <span>{text}</span>
                            <Icon size={18} />
                          </div>
                          <strong>
                            {data.metrics[key] ?? "—"}
                            {key === "lowBalance" &&
                              data.metrics[key] === null && (
                                <small> tidak terbaca</small>
                              )}
                          </strong>
                          <small>{note}</small>
                        </div>
                      ))}
                    </div>
                    <div className="ad-overview-grid">
                      <section className="ad-card">
                        <div className="ad-card-heading">
                          <div>
                            <h2>Aktivitas administrasi</h2>
                            <p>Perubahan terbaru, dengan jejak yang jelas.</p>
                          </div>
                          <button
                            className="ad-action"
                            onClick={() => changeTab("audit")}
                          >
                            Lihat audit log <ArrowUpRight size={14} />
                          </button>
                        </div>
                        {data.recent.length ? (
                          data.recent.map((r: Row) => (
                            <div className="ad-activity" key={r.id}>
                              <ScrollText size={18} />
                              <div>
                                <strong>{label(r.action)}</strong>
                                <p>{r.reason}</p>
                                <small>
                                  {date(r.created_at)} · {short(r.actor_id)}
                                </small>
                              </div>
                            </div>
                          ))
                        ) : (
                          <div className="ad-empty">
                            <ScrollText size={28} />
                            <h3>Jejak perubahan dimulai di sini</h3>
                            <p>
                              Belum ada tindakan administrator yang dicatat.
                            </p>
                          </div>
                        )}
                      </section>
                      <section className="ad-card ad-communication">
                        <div className="ad-icon-tile">
                          <Megaphone size={24} />
                        </div>
                        <span className="ad-eyebrow">KOMUNIKASI PLATFORM</span>
                        <h2>
                          Kabar penting.
                          <br />
                          Tersampaikan dengan jelas.
                        </h2>
                        <p>
                          Buat pengumuman in-app, pilih segmen member, lalu atur
                          kapan pesan mulai dan selesai tayang.
                        </p>
                        <button
                          className="ad-primary"
                          onClick={() => changeTab("broadcasts")}
                        >
                          Kelola broadcast <ArrowUpRight size={16} />
                        </button>
                        <div className="ad-note">
                          <Radio size={15} /> Kanal in-app · tanpa pengiriman
                          email/WhatsApp
                        </div>
                      </section>
                    </div>
                    <section className="ad-card ad-safety">
                      <ShieldCheck size={24} />
                      <div>
                        <h2>Kontrol yang dapat dipertanggungjawabkan</h2>
                        <p>
                          Peran diperiksa server. Setiap tindakan membutuhkan
                          alasan. Transaksi diverifikasi ke provider, bukan
                          ditandai lunas secara manual.
                        </p>
                      </div>
                      <Badge>{label(role)}</Badge>
                    </section>
                  </>
                ) : null}
                {[
                  "users",
                  "projects",
                  "payments",
                  "marketplace",
                  "broadcasts",
                  "roles",
                  "audit",
                ].includes(tab) && (
                  <div className="ad-list-bar">
                    <div>
                      <h2>
                        {tab === "broadcasts" ? "Daftar broadcast" : title}
                      </h2>
                      <small>Halaman {page} · maksimal 25 data</small>
                    </div>
                    <button
                      className="ad-secondary"
                      disabled={!items.length}
                      onClick={() =>
                        downloadText(
                          `piwu-${tab}-halaman-${page}.csv`,
                          adminCSV(items),
                          "text/csv;charset=utf-8",
                        )
                      }
                    >
                      Ekspor halaman CSV
                    </button>
                  </div>
                )}

                {tab === "ai" && <AiPanel data={data} client={client} />}
                {tab === "diagnostics" && (
                  <section className="ad-card">
                    <h2>Kesehatan layanan dan koordinasi server</h2>
                    <p>{data.notice}</p>
                    <p>Terakhir diperiksa: {date(data.readiness?.checkedAt)}</p>
                    <div className="ad-service-grid">
                      {Object.entries(data.readiness || {})
                        .filter(
                          ([k]) =>
                            !["checkedAt", "mode", "paymentMode"].includes(k),
                        )
                        .map(([k, v]) => (
                          <div key={k}>
                            <strong>
                              {(
                                {
                                  auth: "Autentikasi",
                                  database: "Database",
                                  datasets: "Dataset",
                                  administration: "Administrasi",
                                  studio: "Studio",
                                  ai: "AI",
                                  search: "Riset & pencarian",
                                  sandbox: "Sandbox",
                                  payments: "Pembayaran",
                                  whatsapp: "WhatsApp",
                                  secrets: "Enkripsi secrets",
                                } as Row
                              )[k] || k}
                            </strong>
                            <Badge warn={v !== "reachable"}>
                              {(
                                {
                                  reachable: "Terjangkau",
                                  not_configured: "Belum dikonfigurasi",
                                  configured_unverified:
                                    "Dikonfigurasi, belum diuji",
                                  schema_missing: "Skema belum tersedia",
                                  unreachable: "Tidak terjangkau",
                                  rejected: "Ditolak",
                                } as Row
                              )[String(v)] || String(v)}
                            </Badge>
                          </div>
                        ))}
                    </div>
                    <h3>Pencarian web (baca-saja)</h3>
                    {data.search ? (
                      <>
                        <dl>
                          <dt>Provider dipilih</dt>
                          <dd>
                            {data.search.selected === "none"
                              ? "belum dipilih"
                              : data.search.selected}{" "}
                            <Badge
                              warn={
                                !data.search.selectedAvailable ||
                                data.search.disabled
                              }
                            >
                              {data.search.disabled
                                ? "Dimatikan (SEARCH_ENABLED=false)"
                                : data.search.selectedAvailable
                                  ? "Siap dipakai"
                                  : "Kunci belum ada"}
                            </Badge>
                          </dd>
                          <dt>Kunci API</dt>
                          <dd>
                            {data.search.keyConfigured
                              ? "terpasang di server (tidak pernah dikirim ke browser)"
                              : "belum diisi (SEARCH_API_KEY)"}
                          </dd>
                          <dt>Jenis yang tersedia</dt>
                          <dd>
                            {data.search.web
                              ? "web (provider berkunci)"
                              : "tidak ada"}
                          </dd>
                          <dt>Ringkasan lintas halaman</dt>
                          <dd>
                            {data.search.summary
                              ? "aktif — satu pass model per permintaan, ikut kredit ronde (bukan kredit baru)"
                              : "dimatikan (RESEARCH_SUMMARY=false)"}
                          </dd>
                          <dt>Alat server (baca-saja)</dt>
                          <dd>
                            {(data.search.tools?.names || []).join(", ") ||
                              "tidak dilaporkan"}{" "}
                            · maksimum {data.search.tools?.rounds ?? 2} ronde
                            alat per permintaan · tanpa kredit, tanpa jaringan
                          </dd>
                          <dt>Ronde riset maksimum</dt>
                          <dd>{data.search.rounds}</dd>
                          <dt>Bias lokal</dt>
                          <dd>
                            {data.search.locale?.country ||
                            data.search.locale?.language
                              ? `${data.search.locale?.country || "-"} / ${
                                  data.search.locale?.language || "-"
                                }`
                              : "tidak diatur (opsional)"}
                          </dd>
                          <dt>Cache hasil</dt>
                          <dd>
                            {data.search.cache?.mode === "shared"
                              ? "bersama (tabel runtime_search_cache)"
                              : "per-proses (migration 009 belum diterapkan)"}{" "}
                            · {data.search.cache?.entries ?? 0} entri ·{" "}
                            {data.search.cache?.stats?.hits ?? 0} hit (
                            {data.search.cache?.stats?.sharedHits ?? 0} dari
                            tabel) · {data.search.cache?.stats?.errors ?? 0}{" "}
                            galat
                          </dd>
                          <dt>Riset latar</dt>
                          <dd>
                            {data.search.jobs
                              ? `${data.search.jobs.jobs} di memori · ${
                                  data.search.jobs.running
                                } berjalan · ${
                                  data.search.jobs.durable
                                    ? `${data.search.jobs.stored ?? 0} tahan restart (tabel 009)`
                                    : "hanya per-proses (migration 009 belum diterapkan)"
                                } · simpan ${data.search.jobs.ttlMinutes} menit`
                              : "tidak tersedia"}
                          </dd>
                        </dl>
                        <p>{data.search.notice}</p>
                      </>
                    ) : (
                      <p>Data pencarian tidak tersedia pada respons ini.</p>
                    )}
                    <dl>
                      <dt>Pembatas permintaan</dt>
                      <dd>
                        {data.runtime?.rateLimitMode === "database"
                          ? "PostgreSQL bersama"
                          : "Memori satu proses — bukan mode produksi"}
                      </dd>
                      <dt>Skema koordinasi</dt>
                      <dd>
                        {data.runtime?.coordinationSchema === "reachable"
                          ? "Terjangkau (marker, bukan uji seluruh RPC)"
                          : "Belum terverifikasi — periksa migration 007"}
                      </dd>
                      <dt>Routing sandbox</dt>
                      <dd>
                        {data.runtime?.sandboxRouting === "sticky-owner-lease"
                          ? "Sesi tetap ke server pemilik; lease dan kuota bersama"
                          : "Lokal satu proses"}
                      </dd>
                    </dl>
                    <h3>Penyimpanan &amp; cadangan (baca-saja)</h3>
                    {data.storage ? (
                      <>
                        <dl>
                          <dt>Salinan cloud</dt>
                          <dd>
                            {data.storage.available
                              ? `${data.storage.workspaces?.total ?? 0} salinan project`
                              : "tidak terbaca — periksa migration 002"}
                            {data.storage.available
                              ? ` · ${data.storage.workspaces?.dormant ?? 0} diam ≥ ${
                                  data.storage.dormantDays ?? 7
                                } hari`
                              : ""}
                          </dd>
                          <dt>Dataset project</dt>
                          <dd>
                            {data.storage.datasets?.reported === false
                              ? "tidak terbaca (migration 004 belum diterapkan)"
                              : (data.storage.datasets?.total ?? 0)}
                          </dd>
                          <dt>Cadangan</dt>
                          <dd>{data.storage.backup}</dd>
                        </dl>
                        <p>{data.storage.notice}</p>
                      </>
                    ) : (
                      <p>
                        Blok penyimpanan tidak ada pada respons ini; server yang
                        lebih lama tidak melaporkannya.
                      </p>
                    )}
                    <h3>Roblox Studio &amp; plugin (baca-saja)</h3>
                    {data.studio ? (
                      <>
                        <dl>
                          <dt>Versi plugin yang disediakan</dt>
                          <dd>
                            {data.studio.plugin?.version || "—"} ·{" "}
                            <code>{data.studio.plugin?.bundle || "—"}</code>
                          </dd>
                          <dt>Bridge terpasang</dt>
                          <dd>
                            {data.studio.available
                              ? `${data.studio.bridges?.total ?? 0} project · ${
                                  data.studio.bridges?.active ?? 0
                                } token masih berlaku`
                              : "tidak terbaca — periksa migration 006"}
                            {data.studio.bridges?.truncated
                              ? " (batas baca tercapai)"
                              : ""}
                          </dd>
                          <dt>Status terakhir</dt>
                          <dd>
                            {(data.studio.bridges?.states || [])
                              .map((s: Row) => `${label(s.state)}: ${s.count}`)
                              .join(" · ") || "belum ada bridge"}
                          </dd>
                        </dl>
                        <p>{data.studio.notice}</p>
                      </>
                    ) : (
                      <p>
                        Blok Studio tidak ada pada respons ini; server yang
                        lebih lama tidak melaporkannya.
                      </p>
                    )}
                    <button
                      className="ad-secondary"
                      onClick={() => {
                        const { _section, _page, _query, ...report } = data;
                        downloadText(
                          "piwu-diagnostik.json",
                          JSON.stringify(report, null, 2),
                        );
                      }}
                    >
                      Unduh laporan diagnostik
                    </button>
                  </section>
                )}
                {tab === "users" && (
                  <>
                    {table(
                      ["Pengguna", "Kredit", "Status", "Peran", "Tindakan"],
                      items,
                      (r) => (
                        <>
                          <td>
                            <strong>{r.name || r.email || short(r.id)}</strong>
                            <small>{r.email}</small>
                            <code title={r.id}>{r.id}</code>
                          </td>
                          <td>
                            {r.balance === null || r.balance === undefined ? (
                              "Belum dibuat"
                            ) : (
                              <>
                                {r.balance}
                                {r.balance < LOW_BALANCE && (
                                  <Badge warn>Menipis</Badge>
                                )}
                              </>
                            )}
                          </td>
                          <td>
                            <Badge warn={r.suspended}>
                              {r.suspended ? "Ditangguhkan" : "Aktif"}
                            </Badge>
                            <small>
                              {r.verified
                                ? "Terverifikasi"
                                : "Belum terverifikasi"}
                            </small>
                            {r.suspended && r.suspended_reason && (
                              <small title={r.suspended_reason}>
                                {r.suspended_reason}
                              </small>
                            )}
                          </td>
                          <td>{label(r.admin_role)}</td>
                          <td>
                            <div className="ad-actions">
                              {act(
                                "Sesuaikan kredit",
                                () =>
                                  ask("credits", r.id, { delta: 0 }, r.email),
                                !superadmin,
                              )}
                              {act(
                                r.suspended ? "Aktifkan akun" : "Tangguhkan",
                                () =>
                                  ask(
                                    "user_suspend",
                                    r.id,
                                    { suspended: !r.suspended },
                                    r.email,
                                  ),
                                !superadmin || !!r.admin_role,
                                true,
                              )}
                              {act(
                                "Hapus akun",
                                () =>
                                  ask(
                                    "user_delete",
                                    r.id,
                                    { confirmation: "" },
                                    r.email || r.name || short(r.id),
                                  ),
                                !superadmin || !!r.admin_role,
                                true,
                              )}
                              {act(
                                "Kelola peran",
                                () => {
                                  setRoleUser(r.id);
                                  changeTab("roles");
                                },
                                !superadmin,
                              )}
                              {act(
                                "Rincian kredit",
                                () =>
                                  setCreditUser((current) =>
                                    current === r.id ? "" : r.id,
                                  ),
                                false,
                              )}
                            </div>
                          </td>
                        </>
                      ),
                    )}
                    {creditUser && (
                      <CreditDetail
                        client={client}
                        userId={creditUser}
                        onClose={() => setCreditUser("")}
                      />
                    )}
                  </>
                )}
                {tab === "projects" &&
                  table(
                    ["Project", "Pemilik", "Status", "Diperbarui", "Tindakan"],
                    items,
                    (r) => (
                      <>
                        <td>
                          <strong>{r.name}</strong>
                          <code>{r.id}</code>
                        </td>
                        <td>
                          <code title={r.owner_id}>{short(r.owner_id)}</code>
                        </td>
                        <td>
                          <Badge warn={r.locked}>
                            {r.locked ? "Dikunci" : "Aktif"}
                          </Badge>
                        </td>
                        <td>{date(r.updated_at)}</td>
                        <td>
                          <div className="ad-actions">
                            {act(r.locked ? "Buka kunci" : "Kunci", () =>
                              ask(
                                "project_lock",
                                r.id,
                                { locked: !r.locked },
                                r.name,
                              ),
                            )}
                            {act(
                              "Hapus project",
                              () =>
                                ask(
                                  "project_delete",
                                  r.id,
                                  { confirmation: "" },
                                  r.name,
                                ),
                              !superadmin,
                              true,
                            )}
                          </div>
                        </td>
                      </>
                    ),
                  )}
                {tab === "payments" && (
                  <>
                    <div className="ad-info">
                      Rekonsiliasi membaca status pembayaran langsung dari
                      provider. Panel ini tidak membuat pengembalian dana atau
                      pencairan dana penjual.
                    </div>
                    {table(
                      [
                        "Transaksi",
                        "Pengguna",
                        "Nominal",
                        "Status",
                        "Tindakan",
                      ],
                      items,
                      (r) => (
                        <>
                          <td>
                            <strong>{r.sku}</strong>
                            <code>{r.id}</code>
                            <small>
                              {r.provider} · {date(r.created_at)}
                            </small>
                          </td>
                          <td>
                            <code title={r.user_id}>{short(r.user_id)}</code>
                          </td>
                          <td>{money(r.amount)}</td>
                          <td>
                            <Badge
                              warn={!["paid", "refunded"].includes(r.status)}
                            >
                              {label(r.status)}
                            </Badge>
                          </td>
                          <td>
                            {act("Rekonsiliasi", () =>
                              ask(
                                "payment_reconcile",
                                r.id,
                                {},
                                r.sku + " · " + money(r.amount),
                              ),
                            )}
                          </td>
                        </>
                      ),
                    )}
                  </>
                )}
                {tab === "marketplace" && (
                  <>
                    {table(
                      ["Template", "Penjual", "Harga", "Status", "Tindakan"],
                      items,
                      (r) => (
                        <>
                          <td>
                            <strong>{r.title}</strong>
                            <small>{r.category}</small>
                            <code>{r.id}</code>
                          </td>
                          <td>
                            <code title={r.owner_id}>{short(r.owner_id)}</code>
                          </td>
                          <td>{money(r.price)}</td>
                          <td>
                            <Badge>{label(r.status)}</Badge>
                          </td>
                          <td>
                            {act(
                              r.status === "published"
                                ? "Arsipkan"
                                : "Tayangkan",
                              () =>
                                ask(
                                  "template_status",
                                  r.id,
                                  {
                                    status:
                                      r.status === "published"
                                        ? "archived"
                                        : "published",
                                  },
                                  r.title,
                                ),
                            )}
                          </td>
                        </>
                      ),
                    )}
                    <PayoutQueue
                      key={reload}
                      client={client}
                      canReview={superadmin}
                      ask={ask}
                    />
                    <DisputeQueue
                      key={"disputes-" + reload}
                      client={client}
                      canReview={superadmin}
                      ask={ask}
                    />
                  </>
                )}
                {tab === "broadcasts" && (
                  <>
                    <div className="ad-channel-bar">
                      <span>
                        <Radio size={17} /> Pengumuman in-app
                      </span>
                      <p>
                        Jadwal mengikuti waktu lokal perangkat. “Dibaca”
                        dihitung dari konfirmasi member, bukan jangkauan
                        pengiriman.
                      </p>
                    </div>
                    {table(
                      [
                        "Pengumuman",
                        "Audiens",
                        "Status",
                        "Jadwal mulai",
                        "Dibaca",
                        "Tindakan",
                      ],
                      items,
                      (r) => (
                        <>
                          <td>
                            <strong>{r.title}</strong>
                            <p className="ad-excerpt">{r.body}</p>
                          </td>
                          <td>{label(r.audience)}</td>
                          <td>
                            <Badge warn={r.status === "draft"}>
                              {broadcastStatus(r)}
                            </Badge>
                          </td>
                          <td>
                            {date(r.starts_at)}
                            <small>
                              {r.ends_at
                                ? "Sampai " + date(r.ends_at)
                                : "Tanpa batas waktu"}
                            </small>
                          </td>
                          <td>{r.read_count ?? 0} member</td>
                          <td>
                            {act(
                              canWrite ? "Sunting" : "Lihat isi",
                              () => setEditBroadcast(r),
                              false,
                            )}
                          </td>
                        </>
                      ),
                    )}
                  </>
                )}
                {tab === "roles" && (
                  <>
                    <div className="ad-info">
                      <strong>Superadmin</strong> mengelola akses, akun, kredit,
                      dan situs. <strong>Operator</strong> mengelola konten,
                      project, rekonsiliasi, dan broadcast.{" "}
                      <strong>Auditor</strong> hanya membaca. Superadmin
                      terakhir dilindungi.
                    </div>
                    <form
                      className="ad-role-form"
                      onSubmit={(e) => {
                        e.preventDefault();
                        ask(
                          "admin_role",
                          roleUser,
                          { role: newRole },
                          roleUser,
                        );
                      }}
                    >
                      <label>
                        ID pengguna terverifikasi
                        <input
                          required
                          pattern="[0-9a-fA-F-]{36}"
                          value={roleUser}
                          onChange={(e) => setRoleUser(e.target.value)}
                          placeholder="Pilih dari halaman Pengguna"
                          disabled={!superadmin}
                        />
                      </label>
                      <label>
                        Peran
                        <select
                          value={newRole}
                          onChange={(e) => setNewRole(e.target.value)}
                          disabled={!superadmin}
                        >
                          <option value="auditor">Auditor</option>
                          <option value="operator">Operator</option>
                          <option value="superadmin">Superadmin</option>
                        </select>
                      </label>
                      <button className="ad-primary" disabled={!superadmin}>
                        Berikan peran
                      </button>
                    </form>
                    {table(
                      [
                        "ID pengguna",
                        "Peran",
                        "Diberikan oleh",
                        "Sejak",
                        "Tindakan",
                      ],
                      items,
                      (r) => (
                        <>
                          <td>
                            <code>{r.user_id}</code>
                          </td>
                          <td>
                            <Badge>{label(r.role)}</Badge>
                          </td>
                          <td>
                            <code title={r.granted_by}>
                              {short(r.granted_by)}
                            </code>
                          </td>
                          <td>{date(r.created_at)}</td>
                          <td>
                            {act(
                              "Cabut peran",
                              () =>
                                ask(
                                  "admin_role",
                                  r.user_id,
                                  { role: "remove" },
                                  r.user_id,
                                ),
                              !superadmin,
                              true,
                            )}
                          </td>
                        </>
                      ),
                    )}
                  </>
                )}
                {tab === "audit" &&
                  table(
                    ["Tindakan", "Administrator / target", "Alasan", "Waktu"],
                    items,
                    (r) => (
                      <>
                        <td>
                          <strong>{label(r.action)}</strong>
                          <code>{r.id}</code>
                        </td>
                        <td>
                          <small>Admin</small>
                          <code>{r.actor_id}</code>
                          <small>Target</small>
                          <code>{r.target_id || "Konfigurasi platform"}</code>
                        </td>
                        <td className="ad-reason">{r.reason}</td>
                        <td>{date(r.created_at)}</td>
                      </>
                    ),
                  )}
                {tab === "operations" && (
                  <>
                    <RuntimeCard client={client} />
                    <section className="ad-card">
                      <div className="ad-card-heading">
                        <div>
                          <h2>Kesiapan layanan</h2>
                          <p>
                            Status konfigurasi, bukan jaminan koneksi provider.
                          </p>
                        </div>
                        <Server size={20} />
                      </div>
                      <div className="ad-service-grid">
                        {[
                          "cloud",
                          "ai",
                          "search",
                          "sandbox",
                          "payments",
                          "whatsapp",
                        ].map((k) => (
                          <div key={k}>
                            <strong>
                              {
                                (
                                  {
                                    cloud: "Database cloud",
                                    ai: "AI builder",
                                    search: "Riset & pencarian",
                                    sandbox: "Sandbox",
                                    payments: "Pembayaran",
                                    whatsapp: "WhatsApp OTP",
                                  } as Row
                                )[k]
                              }
                            </strong>
                            <Badge warn={!data.capabilities?.[k]}>
                              {data.capabilities?.[k]
                                ? "Dikonfigurasi"
                                : "Belum dikonfigurasi"}
                            </Badge>
                          </div>
                        ))}
                      </div>
                    </section>
                    <h2 className="ad-section-title">
                      Tautan rekaman{" "}
                      <small>30 terbaru · token tidak ditampilkan</small>
                    </h2>
                    {table(
                      ["Rekaman", "Berlaku sampai", "Status", "Tindakan"],
                      data.recordings,
                      (r) => (
                        <>
                          <td>
                            <code>{r.recording_id}</code>
                          </td>
                          <td>{date(r.expires_at)}</td>
                          <td>
                            {r.revoked_at
                              ? "Dicabut"
                              : Date.parse(r.expires_at) < Date.now()
                                ? "Kedaluwarsa"
                                : "Aktif"}
                          </td>
                          <td>
                            {act(
                              "Cabut semua tautan",
                              () =>
                                ask(
                                  "recording_revoke",
                                  r.recording_id,
                                  {},
                                  r.recording_id,
                                ),
                              !canWrite || !!r.revoked_at,
                              true,
                            )}
                          </td>
                        </>
                      ),
                    )}
                  </>
                )}
                {tab === "settings" && (
                  <SettingsForm
                    key={reload}
                    data={data}
                    disabled={!superadmin}
                    save={(value) =>
                      ask(
                        "settings",
                        null,
                        { revision: data.revision, value },
                        "Pengaturan situs dan layanan",
                      )
                    }
                  />
                )}
                {"items" in data && (
                  <div className="ad-pagination">
                    <span>Halaman {page} · filter diterapkan di server</span>
                    <div>
                      <button
                        className="ad-secondary"
                        disabled={page === 1}
                        onClick={() => setPage((p) => p - 1)}
                      >
                        Sebelumnya
                      </button>
                      <button
                        className="ad-secondary"
                        disabled={!data.hasMore}
                        onClick={() => setPage((p) => p + 1)}
                      >
                        Berikutnya
                      </button>
                    </div>
                  </div>
                )}
              </>
            )
          )}
          <footer className="ad-footer">
            <span>PiwuApp · Administrasi platform</span>
            <span>
              <ShieldCheck size={13} /> Akses terbatas. Perubahan tercatat.
            </span>
          </footer>
        </main>
      </div>
      {editBroadcast && !command && (
        <BroadcastForm
          initial={editBroadcast}
          disabled={!canWrite}
          onClose={() => setEditBroadcast(null)}
          save={(payload) => {
            setEditBroadcast({ ...editBroadcast, ...payload });
            ask(
              "broadcast_save",
              editBroadcast.id,
              payload,
              editBroadcast.title || payload.title,
            );
          }}
        />
      )}
      {command && (
        <ActionDialog
          client={client}
          command={command}
          onClose={() => setCommand(null)}
          onDone={(text) => {
            setCommand(null);
            setEditBroadcast(null);
            setNotice(text);
            setReload((n) => n + 1);
          }}
        />
      )}
    </div>
  );
}
function ActionDialog({
  client,
  command,
  onClose,
  onDone,
}: {
  command: Row;
  client: AdminClient;
  onClose: () => void;
  onDone: (s: string) => void;
}) {
  const [reason, setReason] = useState(""),
    [delta, setDelta] = useState(""),
    [confirmation, setConfirmation] = useState(""),
    [reference, setReference] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const payoutReview = command.action === "payout_review";
  const kycReview = command.action === "kyc_review";
  const disputeReview = command.action === "dispute_review";
  const reset = () => setRequestId(crypto.randomUUID());
  return (
    <Modal
      title={label(command.action)}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form
        className="ad-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            if (payoutReview || kycReview || disputeReview) {
              const path = payoutReview
                ? "/admin/payouts/" + command.target
                : kycReview
                  ? "/admin/payouts/kyc"
                  : "/admin/disputes/" + command.target;
              const body = payoutReview
                ? {
                    requestId,
                    status: command.payload?.status,
                    reference,
                    note: reason,
                  }
                : kycReview
                  ? {
                      requestId,
                      userId: command.payload?.userId,
                      status: command.payload?.status,
                      note: reason,
                    }
                  : {
                      requestId,
                      status: command.payload?.status,
                      note: reason,
                    };
              await client(path, body);
              onDone(
                disputeReview
                  ? "Keputusan sengketa tersimpan dan dicatat di audit."
                  : "Tinjauan tersimpan dan dicatat di audit.",
              );
              return;
            }
            const payload = {
              ...command.payload,
              ...(command.action === "credits" ? { delta: Number(delta) } : {}),
              ...(command.action === "project_delete" ||
              command.action === "user_delete"
                ? { confirmation }
                : {}),
            };
            const result = await client("/admin/actions", {
              requestId,
              action: command.action,
              target: command.target,
              payload,
              reason,
            });
            onDone(result.notice);
          } catch (err) {
            setError(err instanceof Error ? err.message : "Perubahan gagal.");
          } finally {
            setBusy(false);
          }
        }}
      >
        <p>{command.detail}</p>
        {command.target && <code>{command.target}</code>}
        {command.action === "credits" && (
          <label>
            Perubahan kredit (−10.000 sampai +10.000)
            <input
              type="number"
              min={-10000}
              max={10000}
              step={1}
              required
              value={delta}
              disabled={busy}
              onChange={(e) => {
                setDelta(e.target.value);
                reset();
              }}
            />
            <small>
              Positif menambah, negatif mengurangi. Saldo akhir tidak boleh
              negatif.
            </small>
          </label>
        )}
        {command.action === "user_delete" && (
          <label>
            Ketik ID pengguna lengkap untuk menghapus akun
            <input
              value={confirmation}
              disabled={busy}
              required
              onChange={(e) => {
                setConfirmation(e.target.value);
                reset();
              }}
            />
            <small>
              Project dan data pribadi dihapus, email diganti alamat token, dan
              akun tidak dapat masuk lagi. Catatan pembayaran dan audit tetap
              disimpan tanpa email. Tindakan ini tidak dapat dibatalkan.
            </small>
          </label>
        )}
        {payoutReview && command.payload?.status === "paid" && (
          <label>
            Referensi transfer
            <input
              value={reference}
              disabled={busy}
              required
              minLength={4}
              maxLength={120}
              placeholder="Nomor transaksi bank/e-wallet"
              onChange={(e) => {
                setReference(e.target.value);
                reset();
              }}
            />
            <small>
              Wajib 4–120 karakter. Hanya referensi transfer yang disimpan;
              jangan menulis nomor rekening lengkap di sini.
            </small>
          </label>
        )}
        {command.action === "project_delete" && (
          <label>
            Ketik ID project lengkap untuk menghapus permanen
            <input
              value={confirmation}
              disabled={busy}
              required
              onChange={(e) => {
                setConfirmation(e.target.value);
                reset();
              }}
            />
            <small>
              Workspace dan data turunannya akan dihapus. Tindakan ini tidak
              dapat dibatalkan.
            </small>
          </label>
        )}
        <label>
          Alasan perubahan
          <textarea
            required
            minLength={8}
            maxLength={500}
            rows={3}
            placeholder="Jelaskan alasan tindakan ini (minimal 8 karakter)…"
            value={reason}
            disabled={busy}
            onChange={(e) => {
              setReason(e.target.value);
              reset();
            }}
          />
        </label>
        <p className="ad-muted">
          Identitas admin, target, alasan, dan hasil akan dicatat. Jangan
          masukkan kredensial atau informasi sensitif.
        </p>
        {error && (
          <p className="ad-error" role="alert">
            {error}
          </p>
        )}
        <div className="ad-form-actions">
          <button
            type="button"
            className="ad-secondary"
            disabled={busy}
            onClick={onClose}
          >
            Batal
          </button>
          <button
            className="ad-primary"
            disabled={
              busy ||
              reason.trim().length < 8 ||
              (command.action === "credits" &&
                (!Number(delta) || !Number.isInteger(Number(delta)))) ||
              ((command.action === "project_delete" ||
                command.action === "user_delete") &&
                confirmation !== command.target) ||
              (payoutReview &&
                command.payload?.status === "paid" &&
                reference.trim().length < 4)
            }
          >
            {busy ? "Memproses…" : "Konfirmasi perubahan"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
function localInput(v: string) {
  const d = new Date(v);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}
function BroadcastForm({
  initial,
  disabled,
  onClose,
  save,
}: {
  initial: Row;
  disabled: boolean;
  onClose: () => void;
  save: (p: Row) => void;
}) {
  const [form, setForm] = useState<Row>({
    ...initial,
    starts_at: localInput(initial.starts_at),
    ends_at: initial.ends_at ? localInput(initial.ends_at) : "",
  });
  const field = (key: string, value: string) =>
    setForm({ ...form, [key]: value });
  const [error, setError] = useState("");
  return (
    <Modal
      title={initial.revision ? "Sunting broadcast" : "Buat broadcast"}
      onClose={onClose}
      wide
    >
      <form
        className="ad-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (form.ends_at && form.ends_at <= form.starts_at) {
            setError("Waktu berakhir harus setelah waktu mulai.");
            return;
          }
          save({
            title: form.title,
            body: form.body,
            audience: form.audience,
            status: form.status,
            starts_at: new Date(form.starts_at).toISOString(),
            ends_at: form.ends_at ? new Date(form.ends_at).toISOString() : null,
            revision: initial.revision,
          });
        }}
      >
        <div className="ad-info">
          Kanal in-app. Teks biasa, tanpa HTML. Publik tampil di beranda; segmen
          member hanya melalui sesi terverifikasi.
        </div>
        <label>
          Judul
          <input
            required
            maxLength={120}
            disabled={disabled}
            value={form.title}
            onChange={(e) => field("title", e.target.value)}
          />
        </label>
        <label>
          Isi pengumuman
          <textarea
            required
            maxLength={4000}
            rows={6}
            disabled={disabled}
            value={form.body}
            onChange={(e) => field("body", e.target.value)}
          />
          <small>{form.body.length}/4.000 karakter</small>
        </label>
        <div className="ad-form-grid">
          <label>
            Audiens
            <select
              disabled={disabled}
              value={form.audience}
              onChange={(e) => field("audience", e.target.value)}
            >
              {["public", "members", "pro", "team"].map((v) => (
                <option key={v} value={v}>
                  {label(v)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Status
            <select
              disabled={disabled}
              value={form.status}
              onChange={(e) => field("status", e.target.value)}
            >
              {["draft", "published", "archived"].map((v) => (
                <option key={v} value={v}>
                  {label(v)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Mulai tayang (waktu lokal)
            <input
              required
              type="datetime-local"
              disabled={disabled}
              value={form.starts_at}
              onChange={(e) => field("starts_at", e.target.value)}
            />
          </label>
          <label>
            Berakhir (opsional)
            <input
              type="datetime-local"
              disabled={disabled}
              value={form.ends_at}
              onChange={(e) => field("ends_at", e.target.value)}
            />
          </label>
        </div>
        <small className="ad-muted">
          Pilih “Tayang” dengan waktu mulai di masa depan untuk menjadwalkan.
          Draf tidak pernah ditampilkan kepada penerima.
        </small>
        {error && (
          <p className="ad-error" role="alert">
            {error}
          </p>
        )}
        <div className="ad-broadcast-preview">
          <span className="ad-eyebrow">PRATINJAU PESAN</span>
          <h3>{form.title || "Judul pengumuman"}</h3>
          <p>{form.body || "Isi pesan akan muncul di sini."}</p>
        </div>
        <div className="ad-form-actions">
          <button className="ad-secondary" type="button" onClick={onClose}>
            Tutup
          </button>
          <button className="ad-primary" disabled={disabled}>
            Tinjau & simpan
          </button>
        </div>
      </form>
    </Modal>
  );
}
/** Service switches the platform still offers; kept out of the form's state. */
const SERVICE_TOGGLES: Record<string, string> = {
  ai: "AI builder",
  sandbox: "Sandbox & paket",
  payments: "Checkout pembayaran",
  marketplace: "Marketplace",
  studio: "Roblox Studio bridge",
};
/**
 * Capabilities an operator may raise above Free. The default stays "free", so
 * the public promise that no feature is locked keeps holding until someone
 * deliberately changes a row.
 */
const PLAN_FEATURE_ROWS = [
  [
    "sandbox",
    "Sandbox, terminal & npm",
    "Terminal E2B, pemasangan paket, dan audit Lighthouse.",
  ],
  [
    "studio",
    "Koneksi Roblox Studio",
    "Plugin Studio dan unggah aset ke Roblox.",
  ],
  [
    "marketplace_sell",
    "Menjual template",
    "Menerbitkan template baru; membeli dan menarik listing tetap terbuka.",
  ],
] as const;
/** Packages the panel may re-price; credits per package are editable too. */
const PACKAGE_ROWS = [
  ["pro", "Pro", "per bulan"],
  ["team", "Team", "per bulan"],
  ["credits300", "Top-up kecil", "sekali beli"],
  ["credits1400", "Top-up besar", "sekali beli"],
] as const;
const rupiahCount = (value: number) =>
  new Intl.NumberFormat("id-ID").format(Number(value) || 0);

function SettingsForm({
  data,
  disabled,
  save,
}: {
  data: Row;
  disabled: boolean;
  save: (v: Row) => void;
}) {
  const [value, setValue] = useState<Row>(() => {
    const next = structuredClone(data.value);
    // Stored settings may predate the removal of the publish service; keep only
    // the switches this panel can actually save.
    next.enabled_services = Object.fromEntries(
      Object.keys(SERVICE_TOGGLES).map((key) => [
        key,
        data.value?.enabled_services?.[key] !== false,
      ]),
    );
    // Show the effective price for every package, so an empty override is
    // visible as the default rather than as a blank box. Prices are stored
    // beside the service switches; 005's RPC whitelist has no top-level key
    // for them.
    delete next.plan_overrides;
    const stored = next.enabled_services.plan_overrides;
    next.enabled_services.plan_overrides = Object.fromEntries([
      ...mergePlans(stored)
        .filter((plan) => plan.sku)
        .map((plan) => [
          plan.plan.toLowerCase(),
          { amount: plan.monthly, credits: plan.credits },
        ]),
      ...mergeTopups(stored).map((topup) => [
        topup.sku,
        { amount: topup.amount, credits: topup.credits },
      ]),
    ]);
    // Unknown packages fall back to "free" rather than hiding access.
    const storedFeatures = data.value?.enabled_services?.plan_features;
    next.enabled_services.plan_features = Object.fromEntries(
      PLAN_FEATURE_ROWS.map(([key]) => [
        key,
        storedFeatures?.[key] === "pro" || storedFeatures?.[key] === "team"
          ? storedFeatures[key]
          : "free",
      ]),
    );
    return next;
  });
  const set = (k: string, v: any) => setValue({ ...value, [k]: v });
  const setPackage = (
    key: string,
    field: "amount" | "credits",
    raw: string,
  ) => {
    const number = Number(raw);
    if (!Number.isFinite(number)) return;
    const overrides = value.enabled_services.plan_overrides;
    set("enabled_services", {
      ...value.enabled_services,
      plan_overrides: {
        ...overrides,
        [key]: { ...overrides[key], [field]: Math.round(number) },
      },
    });
  };
  const defaults = () =>
    set("enabled_services", {
      ...value.enabled_services,
      plan_overrides: Object.fromEntries([
        ...mergePlans()
          .filter((plan) => plan.sku)
          .map((plan) => [
            plan.plan.toLowerCase(),
            { amount: plan.monthly, credits: plan.credits },
          ]),
        ...mergeTopups().map((topup) => [
          topup.sku,
          { amount: topup.amount, credits: topup.credits },
        ]),
      ]),
    });
  return (
    <form
      className="ad-form ad-settings"
      onSubmit={(e) => {
        e.preventDefault();
        save(value);
      }}
    >
      <section className="ad-card">
        <h2>Konten beranda</h2>
        <p className="ad-muted">
          Kosongkan judul atau deskripsi untuk menggunakan konten bawaan
          PiwuApp.
        </p>
        <label>
          Judul utama
          <input
            maxLength={100}
            value={value.hero_title}
            disabled={disabled}
            onChange={(e) => set("hero_title", e.target.value)}
            placeholder="Bangun aplikasi yang benar-benar dipakai."
          />
        </label>
        <label>
          Deskripsi utama
          <textarea
            maxLength={500}
            rows={3}
            value={value.hero_subtitle}
            disabled={disabled}
            onChange={(e) => set("hero_subtitle", e.target.value)}
          />
        </label>
        <label>
          Email dukungan
          <input
            type="email"
            value={value.support_email}
            disabled={disabled}
            onChange={(e) => set("support_email", e.target.value)}
            placeholder="dukungan@domain-anda.id"
          />
        </label>
      </section>
      <section className="ad-card">
        <h2>Mode pemeliharaan</h2>
        <p className="ad-muted">
          Menjeda penulisan workspace dan operasi layanan baru. Baca data, akses
          admin, dan webhook pembayaran tetap berjalan. Operasi eksternal yang
          sudah berjalan mungkin tetap selesai.
        </p>
        <label className="ad-toggle">
          <span>Aktifkan pemeliharaan</span>
          <input
            type="checkbox"
            checked={value.maintenance}
            disabled={disabled}
            onChange={(e) => set("maintenance", e.target.checked)}
          />
        </label>
        <label>
          Pesan pemeliharaan
          <textarea
            maxLength={300}
            minLength={1}
            required
            value={value.maintenance_message}
            disabled={disabled}
            onChange={(e) => set("maintenance_message", e.target.value)}
          />
        </label>
      </section>
      <section className="ad-card">
        <h2>Paket &amp; kredit</h2>
        <p className="ad-muted">
          Harga dan jumlah kredit yang dibayar pembeli. Checkout, halaman paket,
          dan landing membaca angka ini. Jatah harian (20/30/40 kredit), plafon
          600 kredit Free, dan masa berlaku lot tidak bisa diubah dari sini:
          semuanya ditegakkan migration 010.
        </p>
        <div className="ad-price-list">
          {PACKAGE_ROWS.map(([key, title, note]) => {
            const row = value.enabled_services.plan_overrides?.[key] || {
              amount: 0,
              credits: 0,
            };
            return (
              <div className="ad-price-row" key={key}>
                <div>
                  <b>{title}</b>
                  <small>
                    {note} · {rupiahCount(row.credits)} kredit
                  </small>
                </div>
                <label>
                  Harga (Rp)
                  <input
                    type="number"
                    min={1000}
                    max={100000000}
                    step={1000}
                    inputMode="numeric"
                    value={row.amount}
                    disabled={disabled}
                    onChange={(e) => setPackage(key, "amount", e.target.value)}
                  />
                </label>
                <label>
                  Kredit
                  <input
                    type="number"
                    min={10}
                    max={1000000}
                    step={10}
                    inputMode="numeric"
                    value={row.credits}
                    disabled={disabled}
                    onChange={(e) => setPackage(key, "credits", e.target.value)}
                  />
                </label>
              </div>
            );
          })}
        </div>
        <button
          type="button"
          className="ad-secondary"
          disabled={disabled}
          onClick={defaults}
        >
          Gunakan harga bawaan
        </button>
        <p className="ad-muted">
          Team harus memberi kredit lebih banyak dan harga per kredit tidak
          boleh lebih mahal daripada Pro. Top-up besar mengikuti aturan yang
          sama terhadap top-up kecil.
        </p>
      </section>
      <section className="ad-card">
        <h2>Layanan platform</h2>
        <p className="ad-muted">
          Sakelar ini mengizinkan layanan, bukan memasang kredensial provider.
          Kesiapan koneksi tersedia di Operasional, termasuk pencarian web —
          fitur itu tidak punya sakelar di sini karena statusnya ditentukan env
          server (<code>SEARCH_ENABLED</code>, <code>SEARCH_PROVIDER</code>).
        </p>
        {Object.entries(SERVICE_TOGGLES).map(([key, title]) => (
          <label className="ad-toggle" key={key}>
            <span>{title}</span>
            <input
              type="checkbox"
              disabled={disabled}
              checked={value.enabled_services[key]}
              onChange={(e) =>
                set("enabled_services", {
                  ...value.enabled_services,
                  [key]: e.target.checked,
                })
              }
            />
          </label>
        ))}
      </section>
      <section className="ad-card">
        <h2>Akses fitur per paket</h2>
        <p className="ad-muted">
          Bawaan <b>Semua paket</b> mempertahankan janji publik: tidak ada fitur
          yang dikunci. Menaikkan baris membuat server menolak permintaan dari
          paket di bawahnya dengan pesan yang menyebut paket yang dibutuhkan —
          bukan menyembunyikan tombol di UI saja.
        </p>
        {PLAN_FEATURE_ROWS.map(([key, title, hint]) => (
          <label key={key}>
            {title}
            <select
              disabled={disabled}
              value={value.enabled_services.plan_features?.[key] || "free"}
              onChange={(e) =>
                set("enabled_services", {
                  ...value.enabled_services,
                  plan_features: {
                    ...value.enabled_services.plan_features,
                    [key]: e.target.value,
                  },
                })
              }
            >
              <option value="free">Semua paket</option>
              <option value="pro">Pro &amp; Team</option>
              <option value="team">Team</option>
            </select>
            <small>{hint}</small>
          </label>
        ))}
      </section>
      <section className="ad-card">
        <h2>Batas &amp; biaya operasi</h2>
        <p className="ad-muted">
          Angka ini ditegakkan server dan database, bukan sakelar panel.
          Ditampilkan supaya jelas apa yang sengaja tidak bisa diubah dari sini.
        </p>
        <ul className="ad-facts">
          <li>
            <b>Foto per project</b>
            <span>
              {PROJECT_PHOTOS_MAX} foto · maks{" "}
              {Math.round(PROJECT_PHOTOS_BYTES_MAX / 1024 / 1024)} MB per foto
            </span>
          </li>
          <li>
            <b>Jatah harian</b>
            <span>
              {PLAN_LADDER.map((plan) => `${plan.plan} ${plan.daily}`).join(
                " · ",
              )}{" "}
              kredit · reset 00:00 UTC, tidak menumpuk
            </span>
          </li>
          <li>
            <b>Masa berlaku</b>
            <span>
              Kredit paket {expiryLabel(CREDIT_EXPIRY_MONTHS.plan)}; top-up{" "}
              {CREDIT_EXPIRY_MONTHS.topup} bulan
            </span>
          </li>
          <li>
            <b>Biaya operasi</b>
            <span>{costLine()}</span>
          </li>
        </ul>
      </section>
      <div className="ad-form-actions">
        <small>Revisi {data.revision} · perubahan membutuhkan alasan.</small>
        <button className="ad-primary" disabled={disabled}>
          Tinjau & simpan pengaturan
        </button>
      </div>
    </form>
  );
}

/** Model catalogue for the configured API key, read straight from the provider. */
/** Open marketplace disputes, decided only by a superadmin (migration 014). */
function DisputeQueue({
  client,
  canReview,
  ask,
}: {
  client: AdminClient;
  canReview: boolean;
  ask: (
    action: string,
    target: string | null,
    payload: Row,
    detail: string,
  ) => void;
}) {
  const [data, setData] = useState<Row | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    client("/admin/disputes")
      .then((d) => alive && setData(d))
      .catch((e) => {
        if (alive)
          setError(e instanceof Error ? e.message : "Sengketa gagal dimuat.");
      });
    return () => {
      alive = false;
    };
  }, [client]);
  if (error)
    return (
      <div className="ad-error" role="alert">
        {error}
      </div>
    );
  if (!data) return <p className="ad-muted">Memuat antrean sengketa…</p>;
  if (data.applied === false)
    return <div className="ad-info">{data.notice}</div>;
  const open = (data.items || []).filter((row: Row) =>
    ["open", "seller_replied"].includes(row.status),
  );
  const recent = (data.items || [])
    .filter((row: Row) => !["open", "seller_replied"].includes(row.status))
    .slice(0, 8);
  const categories: Row = {
    not_as_described: "Tidak sesuai deskripsi",
    broken: "Rusak / tidak bisa dipakai",
    access: "Tidak bisa diakses",
    other: "Lainnya",
  };
  const statuses: Row = {
    open: "Menunggu penjual",
    seller_replied: "Dibalas penjual",
    resolved: "Ditutup",
    rejected: "Ditolak",
    withdrawn: "Ditarik",
  };
  const row = (r: Row, actionable: boolean) => (
    <tr key={r.id}>
      <td>
        <strong>{r.title}</strong>
        <code title={r.order_id}>{short(r.order_id)}</code>
        <small>{date(r.opened_at)}</small>
      </td>
      <td>
        {r.buyer_name || "Tanpa nama"}
        <small>{categories[r.category] || r.category}</small>
      </td>
      <td>{r.seller_name || "Tanpa nama"}</td>
      <td>
        <p className="ad-excerpt">{r.body}</p>
        {r.seller_reply && <small>Balasan: {r.seller_reply}</small>}
        {r.resolution_note && <small>Keputusan: {r.resolution_note}</small>}
      </td>
      <td>
        <Badge warn={actionable}>{statuses[r.status] || r.status}</Badge>
      </td>
      <td>
        {actionable && (
          <>
            <button
              className="ad-action"
              disabled={!canReview}
              onClick={() =>
                ask(
                  "dispute_review",
                  r.id,
                  { status: "resolved" },
                  (r.title || "Sengketa") + " · tutup laporan",
                )
              }
              title="Menutup laporan tidak mengembalikan uang; transaksi final."
            >
              Tutup laporan
            </button>
            <button
              className="ad-action ad-danger"
              disabled={!canReview}
              onClick={() =>
                ask(
                  "dispute_review",
                  r.id,
                  { status: "rejected" },
                  (r.title || "Sengketa") + " · tolak laporan",
                )
              }
              title="Bagian penjual untuk pesanan ini dibuka kembali."
            >
              Tolak laporan
            </button>
          </>
        )}
      </td>
    </tr>
  );
  const table = (rows: Row[], actionable: boolean) => (
    <div className="ad-table-wrap">
      <table className="ad-table">
        <thead>
          <tr>
            <th>Template</th>
            <th>Pembeli</th>
            <th>Penjual</th>
            <th>Laporan</th>
            <th>Status</th>
            <th>Tindakan</th>
          </tr>
        </thead>
        <tbody>{rows.map((r) => row(r, actionable))}</tbody>
      </table>
    </div>
  );
  return (
    <section className="ad-card ad-payout-queue">
      <div className="ad-card-heading">
        <div>
          <h2>Sengketa marketplace</h2>
          <p>
            Laporan pembeli dan balasan penjual.{" "}
            <b>Transaksi tidak dapat direfund</b>: keputusan di sini hanya
            menutup atau menolak laporan, tidak memindahkan uang. Bagian penjual
            ditahan selama laporan belum selesai dan kembali tersedia untuk
            payout begitu laporan ditutup, ditolak, atau ditarik.
          </p>
        </div>
        <ShieldCheck size={20} />
      </div>
      <h3>Menunggu keputusan</h3>
      {!open.length ? (
        <p className="ad-muted">Tidak ada sengketa terbuka.</p>
      ) : (
        table(open, true)
      )}
      {recent.length > 0 && (
        <>
          <h3>Keputusan terbaru</h3>
          {table(recent, false)}
        </>
      )}
    </section>
  );
}

/**
 * Seller KYC and payout queue. Every action goes to the dedicated payout route
 * so migration 013's RPC (and its audit row) is the only writer.
 */
function PayoutQueue({
  client,
  canReview,
  ask,
}: {
  client: AdminClient;
  canReview: boolean;
  ask: (
    action: string,
    target: string | null,
    payload: Row,
    detail: string,
  ) => void;
}) {
  const [data, setData] = useState<Row | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    client("/admin/payouts")
      .then((d) => alive && setData(d))
      .catch((e) => {
        if (alive)
          setError(e instanceof Error ? e.message : "Antrean gagal dimuat.");
      });
    return () => {
      alive = false;
    };
  }, [client]);
  if (error)
    return (
      <div className="ad-error" role="alert">
        {error}
      </div>
    );
  if (!data) return <p className="ad-muted">Memuat antrean payout…</p>;
  if (data.applied === false)
    return (
      <div className="ad-info">
        {data.notice} Antrean verifikasi dan payout tidak ditampilkan.
      </div>
    );
  const sellers = new Map<string, Row>();
  for (const seller of data.sellers || []) sellers.set(seller.user_id, seller);
  const kyc = (data.verifications || []).filter(
    (r: Row) => r.status === "pending",
  );
  const payouts = (data.payouts || []).filter((r: Row) =>
    ["requested", "approved"].includes(r.status),
  );
  const button = (
    text: string,
    onClick: () => void,
    danger = false,
    hint?: string,
  ) => (
    <button
      className={"ad-action " + (danger ? "ad-danger" : "")}
      disabled={!canReview}
      title={hint}
      onClick={onClick}
    >
      {text}
    </button>
  );
  return (
    <section className="ad-card ad-payout-queue">
      <div className="ad-card-heading">
        <div>
          <h2>Verifikasi penjual &amp; payout</h2>
          <p>
            Antrean ini mencatat keputusan manusia. Uang dikirim di luar
            PiwuApp; isi referensi transfer saat menandai dibayar. Payout
            menahan saldo sejak diminta, bukan saat disetujui.
          </p>
        </div>
        <Wallet size={20} />
      </div>
      <h3>Menunggu verifikasi</h3>
      {!kyc.length ? (
        <p className="ad-muted">Tidak ada pengajuan verifikasi baru.</p>
      ) : (
        <div className="ad-table-wrap">
          <table className="ad-table">
            <thead>
              <tr>
                <th>Penjual</th>
                <th>Nama legal</th>
                <th>Negara</th>
                <th>Diajukan</th>
                <th>Tindakan</th>
              </tr>
            </thead>
            <tbody>
              {kyc.map((r: Row) => (
                <tr key={r.user_id}>
                  <td>
                    <strong>
                      {sellers.get(r.user_id)?.name || "Tanpa nama"}
                    </strong>
                    <code title={r.user_id}>{short(r.user_id)}</code>
                    <small>
                      Saldo tersedia:{" "}
                      {money(sellers.get(r.user_id)?.available || 0)}
                    </small>
                  </td>
                  <td>
                    {r.legal_name}
                    {r.business_name && <small>{r.business_name}</small>}
                    {r.tax_id && <small>NPWP {r.tax_id}</small>}
                  </td>
                  <td>{r.country}</td>
                  <td>{date(r.submitted_at)}</td>
                  <td>
                    {button(
                      "Setujui",
                      () =>
                        ask(
                          "kyc_review",
                          r.user_id,
                          { userId: r.user_id, status: "verified" },
                          "Verifikasi penjual · " +
                            (sellers.get(r.user_id)?.name || short(r.user_id)),
                        ),
                      false,
                      "Catatan alasan tetap wajib diisi.",
                    )}
                    {button(
                      "Tolak",
                      () =>
                        ask(
                          "kyc_review",
                          r.user_id,
                          { userId: r.user_id, status: "rejected" },
                          "Verifikasi penjual · " +
                            (sellers.get(r.user_id)?.name || short(r.user_id)),
                        ),
                      true,
                      "Alasan penolakan minimal 8 karakter.",
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <h3>Permintaan payout</h3>
      {!payouts.length ? (
        <p className="ad-muted">Tidak ada permintaan payout terbuka.</p>
      ) : (
        <div className="ad-table-wrap">
          <table className="ad-table">
            <thead>
              <tr>
                <th>Penjual</th>
                <th>Jumlah</th>
                <th>Tujuan</th>
                <th>Status</th>
                <th>Tindakan</th>
              </tr>
            </thead>
            <tbody>
              {payouts.map((r: Row) => (
                <tr key={r.id}>
                  <td>
                    <strong>
                      {sellers.get(r.seller_id)?.name || "Tanpa nama"}
                    </strong>
                    <code title={r.id}>{short(r.id)}</code>
                    <small>{date(r.created_at)}</small>
                  </td>
                  <td>{money(r.amount)}</td>
                  <td>
                    {r.method === "bank" ? "Transfer bank" : "E-wallet"}
                    <small>{r.destination}</small>
                  </td>
                  <td>
                    <Badge>{label(r.status)}</Badge>
                  </td>
                  <td>
                    {r.status === "requested" &&
                      button(
                        "Setujui",
                        () =>
                          ask(
                            "payout_review",
                            r.id,
                            { status: "approved" },
                            money(r.amount) +
                              " · " +
                              (sellers.get(r.seller_id)?.name ||
                                short(r.seller_id)),
                          ),
                        false,
                        "Alasan keputusan tetap wajib diisi.",
                      )}
                    {button(
                      "Tandai dibayar",
                      () =>
                        ask(
                          "payout_review",
                          r.id,
                          { status: "paid" },
                          money(r.amount) +
                            " · " +
                            (sellers.get(r.seller_id)?.name ||
                              short(r.seller_id)),
                        ),
                      false,
                      "Wajib mengisi referensi transfer 4–120 karakter.",
                    )}
                    {button(
                      "Tolak",
                      () =>
                        ask(
                          "payout_review",
                          r.id,
                          { status: "rejected" },
                          money(r.amount) +
                            " · " +
                            (sellers.get(r.seller_id)?.name ||
                              short(r.seller_id)),
                        ),
                      true,
                      "Saldo yang ditahan akan dilepas. Alasan minimal 8 karakter.",
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="ad-muted">
        Menolak payout melepas saldo yang ditahan. Referensi transfer hanya
        disimpan di baris payout dan audit, bukan di log aplikasi.
      </p>
    </section>
  );
}

function AiPanel({ data, client }: { data: Row; client: AdminClient }) {
  const [state, setState] = useState<Row>(data);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    setState(data);
    setError("");
  }, [data]);
  const groups: Row[] = state.catalog?.groups || [];
  const reload = async (refresh: boolean) => {
    setBusy(true);
    setError("");
    try {
      setState(await client("/admin/ai" + (refresh ? "?refresh=1" : "")));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Katalog model gagal dibaca.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <section className="ad-card">
        <div className="ad-card-heading">
          <div>
            <h2>Status provider AI</h2>
            <p>
              Konfigurasi server. Nilai API key tidak pernah dikirim ke browser,
              termasuk untuk superadmin.
            </p>
          </div>
          <Sparkles size={20} />
        </div>
        <div className="ad-service-grid">
          <div>
            <strong>AI builder</strong>
            <Badge warn={!state.configured}>
              {state.configured ? "Dikonfigurasi" : "Belum dikonfigurasi"}
            </Badge>
          </div>
          <div>
            <strong>API key</strong>
            <Badge warn={!state.keyPresent}>
              {state.keyPresent ? "Tersimpan di server" : "Belum diisi"}
            </Badge>
          </div>
          <div>
            <strong>Katalog model</strong>
            <Badge warn={!state.catalog}>
              {state.catalog
                ? `${state.catalog.count} model`
                : state.configured
                  ? "Tidak terbaca"
                  : "Belum tersedia"}
            </Badge>
          </div>
        </div>
        <dl>
          <dt>Base URL</dt>
          <dd>
            {state.baseHost ? (
              <>
                <code>{state.baseHost + state.basePath}</code> — host publik
                provider, bukan kredensial
              </>
            ) : (
              "Belum diisi (LLM_BASE_URL)"
            )}
          </dd>
          <dt>Model default</dt>
          <dd>
            {state.defaultModel ? (
              <code>{state.defaultModel}</code>
            ) : (
              "Kosong — dipakai model pertama dari daftar provider"
            )}
          </dd>
          <dt>Sumber default</dt>
          <dd>{state.defaultSource}</dd>
        </dl>
      </section>
      <section className="ad-card">
        <div className="ad-card-heading">
          <div>
            <h2>Pemetaan tier</h2>
            <p>
              Tier yang dipilih pengguna di chat. Tanpa override, permintaan
              memakai model default.
            </p>
          </div>
          <Cpu size={20} />
        </div>
        {table_(
          ["Tier", "Model", "Sumber", "Kredit/pesan"],
          state.tiers || [],
          (r) => (
            <>
              <td>
                <strong>{r.tier}</strong>
              </td>
              <td>{r.model ? <code>{r.model}</code> : "Model default"}</td>
              <td>
                <small>{r.source}</small>
              </td>
              <td>
                {typeof r.cost === "number" ? (
                  <b>{r.cost}</b>
                ) : (
                  <small>-</small>
                )}
              </td>
            </>
          ),
        )}
      </section>
      <section className="ad-card">
        <div className="ad-card-heading">
          <div>
            <h2>Katalog model dari API key</h2>
            <p>
              {state.catalog
                ? `${state.catalog.count} model dalam ${groups.length} grup, dibaca ${date(state.catalogAt)}.`
                : "Daftar diambil dari GET /models milik provider."}
            </p>
          </div>
          <button
            className="ad-secondary"
            disabled={busy || !state.configured}
            onClick={() => void reload(true)}
          >
            <RefreshCw size={13} /> {busy ? "Membaca…" : "Muat ulang katalog"}
          </button>
        </div>
        {!state.configured && (
          <div className="ad-note">
            Isi <code>LLM_BASE_URL</code> dan <code>LLM_API_KEY</code> di server
            untuk membaca daftar model.
          </div>
        )}
        {state.configured && (state.catalogError || error) && (
          <div className="ad-note">
            {error || state.catalogError} Preset tier Otomatis/Cepat/Seimbang/
            Kuat tetap dapat dipakai pengguna.
          </div>
        )}
        {error && <div className="ad-note ad-error">{error}</div>}
        {groups.map((group) => (
          <div className="ad-model-group" key={group.label}>
            <strong>
              {group.label} <small>{group.models.length} model</small>
            </strong>
            <div className="ad-chips">
              {group.models.slice(0, 40).map((model: string) => (
                <code key={model}>{model}</code>
              ))}
              {group.models.length > 40 && (
                <span>+{group.models.length - 40} model lain</span>
              )}
            </div>
          </div>
        ))}
        <p className="ad-safety">
          Pengelompokan hanya untuk tampilan; setiap id di daftar ini dapat
          dipilih pengguna di chat dan dikirim apa adanya ke provider. Baris ini
          tidak menjalankan inference.
        </p>
      </section>
      <section className="ad-card">
        <div className="ad-card-heading">
          <div>
            <h2>Penggunaan kredit AI</h2>
            <p>
              {state.usage?.windowDays || 30} hari terakhir. Angka berasal dari
              ledger dan reservasi kredit.
            </p>
          </div>
          <Gauge size={20} />
        </div>
        <dl>
          <dt>Kredit terpakai untuk AI</dt>
          <dd>
            <strong>{state.usage?.aiCreditsSpent ?? 0}</strong> kredit
            {state.usage?.truncated ? " (sebagian, batas baca tercapai)" : ""}
          </dd>
        </dl>
        {table_(
          [
            "Tujuan",
            "Reservasi",
            "Selesai",
            "Dibatalkan penyedia",
            "Kredit selesai",
          ],
          state.usage?.purposes || [],
          (r) => (
            <>
              <td>
                <strong>{insightLabel(r.purpose)}</strong>
              </td>
              <td>{r.reserved || 0}</td>
              <td>{r.settled || 0}</td>
              <td>{r.refunded || 0}</td>
              <td>{r.settledCredits || 0}</td>
            </>
          ),
        )}
        <p className="ad-safety">{state.notice}</p>
      </section>
    </>
  );
}

/** Balance, ledger and reservations for one account — read-only. */
function CreditDetail({
  client,
  userId,
  onClose,
}: {
  client: AdminClient;
  userId: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<Row | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let dead = false;
    setData(null);
    setError("");
    client("/admin/users/" + userId)
      .then((d) => {
        if (!dead) setData(d);
      })
      .catch((e) => {
        if (!dead) setError(e.message);
      });
    return () => {
      dead = true;
    };
  }, [client, userId]);
  return (
    <section className="ad-card ad-detail" aria-label="Rincian kredit akun">
      <div className="ad-card-heading">
        <div>
          <h2>Rincian kredit akun</h2>
          <p>
            {data?.account?.name || data?.account?.email || short(userId)} ·
            hanya baca, penyesuaian tetap lewat tindakan beralasan.
          </p>
        </div>
        <div className="ad-detail-actions">
          <Wallet size={20} />
          <button className="ad-secondary" onClick={onClose}>
            Tutup
          </button>
        </div>
      </div>
      {error && <div className="ad-note ad-error">{error}</div>}
      {!data && !error && <div className="ad-empty">Memuat rincian akun…</div>}
      {data && (
        <>
          <div className="ad-service-grid">
            <div>
              <strong>Saldo</strong>
              <Badge warn={data.balance === null}>
                {data.balance === null ? "Belum dibuat" : data.balance}
              </Badge>
            </div>
            <div>
              <strong>Status akun</strong>
              <Badge warn={data.suspended}>
                {data.suspended ? "Ditangguhkan" : "Aktif"}
              </Badge>
            </div>
            <div>
              <strong>Peran admin</strong>
              <Badge>{label(data.adminRole)}</Badge>
            </div>
            <div>
              <strong>Project</strong>
              <Badge>{data.projects}</Badge>
            </div>
            <div>
              <strong>Kredit menipis</strong>
              <Badge warn={data.lowBalance === true}>
                {data.lowBalance === null || data.lowBalance === undefined
                  ? "Belum dibuat"
                  : data.lowBalance
                    ? `Ya (< ${data.lowBalanceThreshold ?? LOW_BALANCE})`
                    : "Tidak"}
              </Badge>
            </div>
            <div>
              <strong>Bridge Studio</strong>
              <Badge warn={data.studio?.active > 0}>
                {data.studio
                  ? `${data.studio.bridges} terpasang · ${data.studio.active} aktif`
                  : "Tidak dilaporkan"}
              </Badge>
            </div>
          </div>
          <dl>
            <dt>Email</dt>
            <dd>{data.account?.email || "—"}</dd>
            <dt>Terdaftar</dt>
            <dd>
              {data.account?.createdAt ? date(data.account.createdAt) : "—"}
            </dd>
            <dt>Masuk terakhir</dt>
            <dd>
              {data.account?.lastSignInAt
                ? date(data.account.lastSignInAt)
                : "Belum pernah"}
            </dd>
            <dt>Verifikasi</dt>
            <dd>
              {data.account?.verified ? "Terverifikasi" : "Belum terverifikasi"}
            </dd>
            <dt>Salinan cloud terakhir diperbarui (project)</dt>
            <dd>
              {data.storage?.lastProjectUpdateAt
                ? date(data.storage.lastProjectUpdateAt)
                : "Belum ada project tersimpan"}
            </dd>
            <dt>Plugin Studio yang disediakan server</dt>
            <dd>
              {data.studio?.pluginVersion || "—"} · versi yang terpasang di
              Studio tidak dilaporkan ke server
            </dd>
            <dt>{data.window?.days || 30} hari terakhir</dt>
            <dd>
              +{data.window?.added ?? 0} kredit masuk · −
              {data.window?.spent ?? 0} kredit terpakai
              {data.window?.truncated ? " (sebagian, batas baca tercapai)" : ""}
            </dd>
            {data.suspendedReason && (
              <>
                <dt>Alasan penangguhan</dt>
                <dd>{data.suspendedReason}</dd>
              </>
            )}
          </dl>
          <h3 className="ad-section-title">
            Ledger kredit <small>25 terakhir</small>
          </h3>
          {table_(
            ["Waktu", "Delta", "Alasan", "Referensi"],
            data.ledger || [],
            (r) => (
              <>
                <td>{date(r.created_at)}</td>
                <td>
                  <strong>{r.delta > 0 ? "+" + r.delta : r.delta}</strong>
                </td>
                <td>{insightLabel(r.reason)}</td>
                <td>
                  <code>{r.reference}</code>
                </td>
              </>
            ),
          )}
          <h3 className="ad-section-title">
            Reservasi proses <small>25 terakhir</small>
          </h3>
          {table_(
            ["Waktu", "Tujuan", "Jumlah", "Status"],
            data.reservations || [],
            (r) => (
              <>
                <td>{date(r.created_at)}</td>
                <td>
                  <strong>{insightLabel(r.purpose)}</strong>
                </td>
                <td>{r.amount}</td>
                <td>
                  <Badge warn={r.status === "refunded"}>
                    {insightLabel(r.status)}
                  </Badge>
                </td>
              </>
            ),
          )}
        </>
      )}
    </section>
  );
}

/** Shared sandbox slots and rate-limit buckets from migration 007. */
function RuntimeCard({ client }: { client: AdminClient }) {
  const [data, setData] = useState<Row | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let dead = false;
    setData(null);
    setError("");
    client("/admin/runtime")
      .then((d) => {
        if (!dead) setData(d);
      })
      .catch((e) => {
        if (!dead) setError(e.message);
      });
    return () => {
      dead = true;
    };
  }, [client, attempt]);
  return (
    <section className="ad-card">
      <div className="ad-card-heading">
        <div>
          <h2>Runtime &amp; sandbox</h2>
          <p>
            Slot sandbox bersama dan pembatas permintaan, dibaca dari tabel
            koordinasi.
          </p>
        </div>
        <button
          className="ad-secondary"
          onClick={() => setAttempt((n) => n + 1)}
        >
          <RefreshCw size={13} /> Muat ulang
        </button>
      </div>
      {error && <div className="ad-note ad-error">{error}</div>}
      {!data && !error && <div className="ad-empty">Membaca runtime…</div>}
      {data && !data.available && (
        <div className="ad-note ad-error">{data.notice}</div>
      )}
      {data && data.available && (
        <>
          <div className="ad-service-grid">
            <div>
              <strong>Slot sandbox aktif</strong>
              <Badge
                warn={data.slots.active >= (data.slots.max || 50)}
              >{`${data.slots.active} / ${data.slots.max}`}</Badge>
            </div>
            <div>
              <strong>Slot tersimpan</strong>
              <Badge>{data.slots.total}</Badge>
            </div>
            <div>
              <strong>Bucket rate aktif</strong>
              <Badge>{`${data.buckets.active} / ${data.buckets.total}`}</Badge>
            </div>
            <div>
              <strong>Hit tersimpan</strong>
              <Badge>{data.buckets.hits}</Badge>
            </div>
          </div>
          <dl>
            <dt>Mode pembatas</dt>
            <dd>
              {data.mode === "database"
                ? "PostgreSQL bersama"
                : "Memori satu proses — bukan mode produksi"}
            </dd>
            <dt>Routing sandbox</dt>
            <dd>
              {data.sandboxRouting === "sticky-owner-lease"
                ? "Sesi tetap ke server pemilik; kuota per akun dan server"
                : "Lokal satu proses"}
            </dd>
            <dt>Kuota per akun</dt>
            <dd>{data.slots.perUser} sesi serentak</dd>
          </dl>
          {table_(
            ["Pengguna", "Project", "Server pemilik", "Berlaku sampai"],
            data.items || [],
            (r) => (
              <>
                <td>
                  <code title={r.user_id}>{short(r.user_id)}</code>
                </td>
                <td>
                  <code title={r.project_id}>{short(r.project_id)}</code>
                </td>
                <td>
                  <code title={r.owner}>{short(r.owner)}</code>
                </td>
                <td>{date(r.expires_at)}</td>
              </>
            ),
          )}
        </>
      )}
      {data?.available !== false && (
        <p className="ad-safety">
          {data?.notice ||
            "Angka dibaca dari tabel koordinasi bersama; lease kedaluwarsa tidak dihitung aktif."}
        </p>
      )}
    </section>
  );
}
