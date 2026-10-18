import ProjectKindPicker from "../components/projects/ProjectKindPicker";
import type { ProjectKind } from "../lib/project-kinds";
import {
  PlatformNotices,
  AdminLink,
  NotificationBell,
} from "../components/admin/Platform";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  Cloud,
  Plus,
  Search,
  LayoutGrid,
  Clock,
  Users,
  Bookmark,
  Settings,
  ArrowUpRight,
  ChevronDown,
  MoreHorizontal,
  Copy,
  Pencil,
  Trash2,
  FolderOpen,
  ArrowRight,
  LogOut,
  Download,
  UserRound,
} from "lucide-react";
import { Logo, Modal, EmptyState } from "../components/ui";
import TemplatePreview from "../components/TemplatePreview";
import { templates } from "../lib/templates";
import { useStore } from "../lib/store";
import { supabase } from "../lib/supabase";
import {
  StorageStatus,
  StorageDialog,
  CloudSyncBanner,
} from "../components/storage/StorageStatus";
import { scopeFor } from "../lib/cloud/types";
import { listProjectPhotos } from "../services/project-photos";
import CreditSummary from "../components/dashboard/CreditSummary";
import WaitingForYou from "../components/dashboard/WaitingForYou";
import QualityPanel from "../components/dashboard/QualityPanel";
import ActivityFeed from "../components/dashboard/ActivityFeed";
import ReadinessChecklist from "../components/dashboard/ReadinessChecklist";
import { searchProjects } from "../lib/dashboard/search";
import {
  continueLine,
  formatBytes,
  projectFootprint,
  syncNotice,
} from "../lib/dashboard/attention";
import type { Project } from "../lib/types";
import Profile from "./Profile";

/** One dense line per card: what the project holds, not just when it changed. */
function footprintLine(
  project: Project,
  photos?: { count: number; bytes: number },
) {
  const footprint = projectFootprint(project, photos);
  const parts = [
    `${footprint.files} file`,
    `${footprint.versions} riwayat`,
    formatBytes(footprint.bytes),
  ];
  if (footprint.photos)
    parts.push(`foto ${footprint.photos.count}/${footprint.photos.limit}`);
  if (footprint.scene) {
    const { objects, meshes, meshesWithAsset } = footprint.scene;
    parts.push(`scene ${objects} objek`);
    if (meshes)
      parts.push(
        meshesWithAsset
          ? `${meshes} mesh · ${meshesWithAsset} beraset`
          : `${meshes} mesh tanpa aset`,
      );
  }
  return parts.join(" · ");
}

function SyncBadge({ phase }: { phase?: string }) {
  const notice = syncNotice(phase);
  if (!notice) return null;
  return (
    <span className={"project-sync tone-" + notice.tone}>
      <Cloud size={11} /> {notice.label}
    </span>
  );
}
export default function Dashboard() {
  const store = useStore();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") || "projects";
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("latest");
  const [filter, setFilter] = useState("all");
  // Second axis of filtering: what the project *is* (kind) and whether it still
  // has an open comment. Kept apart from the template select so neither
  // overrides the other.
  const [scopeKind, setScopeKind] = useState("all");
  const [commentsOnly, setCommentsOnly] = useState(false);
  const [dialog, setDialog] = useState("");
  const [selected, setSelected] = useState("");
  const [newName, setNewName] = useState("");
  const [menu, setMenu] = useState("");
  const [projectKind, setProjectKind] = useState<ProjectKind>("webapp");
  const [newPrompt, setNewPrompt] = useState("");
  const [mobile, setMobile] = useState(false);
  const [photos, setPhotos] = useState<
    Record<string, { count: number; bytes: number }>
  >({});
  const [promptTitle, setPromptTitle] = useState("");
  const [promptContent, setPromptContent] = useState("");
  const continued = useRef(false);
  const isCloud = scopeFor(store.user) !== "demo";
  useEffect(() => {
    if (
      store.user &&
      !store.user.demo &&
      store.pendingPrompt &&
      !continued.current &&
      !store.pendingProjectId
    ) {
      continued.current = true;
      const id = store.createProject(store.pendingPrompt);
      navigate("/project/" + id);
    }
  }, [store.user]);
  // Searching reads inside the projects, so the text the matcher sees is
  // deferred: typing stays immediate while the heavy pass catches up.
  const deferredSearch = useDeferredValue(search);
  const found = useMemo(
    () =>
      searchProjects(store.projects, deferredSearch, {
        kind: scopeKind,
        commentsOnly,
      }),
    [store.projects, deferredSearch, scopeKind, commentsOnly],
  );
  const matchOf = useMemo(
    () => new Map(found.hits.map((hit) => [hit.project.id, hit.where])),
    [found],
  );
  const projects = found.hits
    .map((hit) => hit.project)
    .filter(
      (p) =>
        (filter === "all" || p.template === filter) &&
        (tab !== "shared" ||
          (store.sync[p.id] && store.sync[p.id].role !== "Owner")),
    )
    .sort((a, b) =>
      sort === "name"
        ? a.name.localeCompare(b.name)
        : sort === "oldest"
          ? a.updatedAt - b.updatedAt
          : b.updatedAt - a.updatedAt,
    );
  // Photo counts live in this browser only, so they are read here rather than
  // asked from the cloud. A read that fails simply leaves the count out.
  useEffect(() => {
    if (!store.user) return;
    let live = true;
    const wanted = store.projects
      .filter((project) => project.kind === "roblox")
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 8);
    void (async () => {
      const found: Record<string, { count: number; bytes: number }> = {};
      for (const project of wanted) {
        try {
          const list = await listProjectPhotos(
            scopeFor(store.user),
            project.id,
          );
          if (list.length)
            found[project.id] = {
              count: list.length,
              bytes: list.reduce(
                (total, photo) => total + (photo.bytes || 0),
                0,
              ),
            };
        } catch {
          // Photos are a bonus on the card; never block the dashboard for them.
        }
      }
      if (live) setPhotos(found);
    })();
    return () => {
      live = false;
    };
  }, [store.user, store.projects]);

  function create() {
    if (!newPrompt.trim()) return;
    if (!store.user) {
      store.setPending(newPrompt, "Builder", projectKind);
      navigate("/login");
      return;
    }
    store.setPending(newPrompt, "Builder", projectKind);
    const id = store.createProject(newPrompt, undefined, projectKind);
    navigate("/project/" + id);
  }
  function template(id: string) {
    if (!store.user) {
      store.setPending(templates.find((t) => t.id === id)!.prompt);
      navigate("/login");
      return;
    }
    const p = store.createProject(
      templates.find((t) => t.id === id)!.prompt,
      id,
    );
    navigate("/project/" + p);
  }
  const changeTab = (s: string) => {
    setParams(s === "projects" ? {} : { tab: s });
    setMobile(false);
    setSearch("");
  };
  const kindCount = (kind: ProjectKind) =>
    store.projects.filter((project) => (project.kind || "webapp") === kind)
      .length;
  const sharedCount = store.projects.filter(
    (project) =>
      store.sync[project.id] && store.sync[project.id].role !== "Owner",
  ).length;
  const filtered = Boolean(
    search || filter !== "all" || commentsOnly || scopeKind !== "all",
  );
  const projectSubline = store.projects.length
    ? `${store.projects.length} project · ${kindCount("webapp")} web · ${kindCount("mobile")} mobile · ${kindCount("roblox")} Roblox`
    : "Belum ada project. Mulai dari satu kalimat, atau ambil template di bawah.";
  const eyebrow = {
    projects: "Workspace pribadi",
    templates: "Template",
    shared: "Kolaborasi",
    prompts: "Prompt",
    profile: "Akun",
  }[tab];
  const heading = {
    projects: "Project",
    templates: "Template",
    shared: "Dibagikan ke saya",
    prompts: "Prompt saya",
    profile: "Akun Anda, di satu tempat.",
  }[tab];
  const subline = {
    projects: projectSubline,
    templates: `${templates.length} titik awal untuk web, mobile, dan Roblox.`,
    shared: `${sharedCount} project dibagikan ke akun ini.`,
    prompts: `${store.prompts.length} prompt tersimpan di perangkat ini.`,
    profile: "Nama tampilan, email, kata sandi, paket, dan kredit akun Anda.",
  }[tab];
  return (
    <div className="dashboard-page">
      <aside className={"dashboard-sidebar " + (mobile ? "mobile-open" : "")}>
        <Logo />
        <div className="workspace-switch">
          <span className="workspace-avatar">P</span>
          <div>
            <b>Workspace pribadi</b>
            <small>{isCloud ? "Cloud · tersinkron" : "Mode demo lokal"}</small>
          </div>
          <ChevronDown size={14} />
        </div>
        <button
          className="button button-dark new-project-side"
          onClick={() => setDialog("new")}
        >
          <Plus size={16} />
          Project baru<span>⌘ N</span>
        </button>
        <div className="sidebar-label">Ruang kerja</div>
        <nav>
          {[
            {
              id: "projects",
              icon: LayoutGrid,
              label: "Semua project",
              count: store.projects.length,
            },
            { id: "templates", icon: LayersIcon, label: "Template" },
            { id: "shared", icon: Users, label: "Dibagikan ke saya" },
            { id: "prompts", icon: Bookmark, label: "Prompt saya" },
            { id: "profile", icon: UserRound, label: "Profil" },
          ].map(({ id, icon: Icon, label, count }) => (
            <button
              className={tab === id ? "active" : ""}
              onClick={() => changeTab(id)}
              key={id}
              aria-current={tab === id ? "page" : undefined}
            >
              <Icon size={17} />
              {label}
              {count !== undefined && <span>{count}</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="upgrade-card">
            <span>PiwuApp Pro</span>
            <p>1.500 kredit/bulan, 30 kredit/hari, dan ruang kerja bersama.</p>
            <Link to="/upgrade">
              Bandingkan paket <ArrowUpRight size={12} />
            </Link>
          </div>
          <div className="sidebar-links">
            <button
              className="sidebar-settings"
              onClick={() => setDialog("settings")}
            >
              <Settings size={16} /> Pengaturan
            </button>
            <AdminLink />
            <Link className="sidebar-settings" to="/account">
              Akun &amp; kredit
            </Link>
            <Link className="sidebar-settings" to="/marketplace">
              Marketplace komunitas
            </Link>
            <Link className="sidebar-settings" to="/profile">
              Profil saya
            </Link>
          </div>
          <div className="sidebar-user">
            <span className="avatar">
              {store.user?.name?.[0]?.toUpperCase() || "P"}
            </span>
            <div>
              <Link className="sidebar-user-link" to="/profile">
                <b>{store.user?.name || "Pengunjung"}</b>
                <small>{store.user ? "Lihat profil" : "Belum masuk"}</small>
              </Link>
            </div>
            <button
              className="icon-button"
              aria-label="Keluar"
              onClick={async () => {
                if (supabase) {
                  const { error } = await supabase.auth.signOut({
                    scope: "local",
                  });
                  if (error) {
                    store.notify("Tidak dapat menutup sesi. Coba lagi.");
                    return;
                  }
                }
                store.setUser(null);
                navigate("/");
              }}
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>
      {mobile && (
        <button
          className="dash-scrim"
          aria-label="Tutup navigasi"
          onClick={() => setMobile(false)}
        />
      )}
      <main className="dashboard-main">
        <PlatformNotices showErrors />
        <header className="dashboard-header">
          <div className="dash-crumbs">
            <button
              className="icon-button dashboard-mobile-toggle"
              onClick={() => setMobile(!mobile)}
              aria-label="Buka navigasi"
            >
              <LayoutGrid size={19} />
            </button>
            <span>Workspace</span>
            <span className="dash-slash">/</span>
            <b>
              {{
                projects: "Semua project",
                templates: "Template",
                shared: "Dibagikan ke saya",
                prompts: "Prompt saya",
                profile: "Profil",
              }[tab] || "Project"}
            </b>
          </div>
          <div className="dash-header-actions">
            <NotificationBell />
            <span className="dash-divider" aria-hidden="true" />
            <StorageStatus />
            <Link to="/" className="icon-button" aria-label="Beranda">
              <ArrowUpRight size={17} />
            </Link>
          </div>
        </header>
        <div className="dashboard-content">
          <div className="dashboard-title">
            <div className="dash-title-copy">
              <span className="eyebrow-label">{eyebrow}</span>
              <h1>{heading}</h1>
              <p>{subline}</p>
            </div>
            {tab !== "profile" && (
              <div className="dash-title-actions">
                <button
                  className="button button-dark"
                  onClick={() =>
                    setDialog(tab === "prompts" ? "prompt" : "new")
                  }
                >
                  <Plus size={16} />
                  {tab === "prompts" ? "Simpan prompt" : "Project baru"}
                </button>
              </div>
            )}
          </div>
          <CloudSyncBanner />
          {(tab === "projects" || tab === "shared") && (
            <div className="dash-layout">
              <div className="dash-primary">
                {store.projects.length > 0 && <River projects={projects} />}
                <section
                  className={
                    "dash-projects" +
                    (store.projects.length ? " has-projects" : "")
                  }
                  aria-labelledby="dash-projects-title"
                >
                  <div className="dash-section-head">
                    <h2 id="dash-projects-title">
                      {tab === "shared" ? "Project bersama" : "Semua project"}
                      <span className="dash-count">{projects.length}</span>
                      {filtered && (
                        <span className="dash-filtered">
                          dari {store.projects.length}
                        </span>
                      )}
                    </h2>
                    <div className="dash-section-tools">
                      {projects.length > 0 && (
                        <select
                          aria-label="Filter jenis project"
                          value={filter}
                          onChange={(e) => setFilter(e.target.value)}
                        >
                          <option value="all">Semua jenis</option>
                          {templates.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.category}
                            </option>
                          ))}
                        </select>
                      )}
                      {projects.length > 0 && (
                        <select
                          className="dash-sort"
                          aria-label="Urutkan project"
                          value={sort}
                          onChange={(e) => setSort(e.target.value)}
                        >
                          <option value="latest">Terbaru</option>
                          <option value="oldest">Terlama</option>
                          <option value="name">Nama A–Z</option>
                        </select>
                      )}
                    </div>
                  </div>
                  <div className="project-toolbar">
                    <div className="search-input">
                      <Search size={16} />
                      <input
                        aria-label="Cari project"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Cari project, file, atau percakapan…"
                      />
                    </div>
                    <div
                      className="project-scope"
                      role="group"
                      aria-label="Saring project"
                    >
                      {(
                        [
                          ["all", "Semua"],
                          ["webapp", "Web"],
                          ["mobile", "Mobile"],
                          ["roblox", "Roblox"],
                        ] as const
                      ).map(([value, label]) => (
                        <button
                          key={value}
                          type="button"
                          aria-pressed={scopeKind === value}
                          className={scopeKind === value ? "active" : ""}
                          onClick={() => setScopeKind(value)}
                        >
                          {label}
                        </button>
                      ))}
                      <button
                        type="button"
                        aria-pressed={commentsOnly}
                        className={commentsOnly ? "active" : ""}
                        onClick={() => setCommentsOnly(!commentsOnly)}
                      >
                        Komentar terbuka
                      </button>
                    </div>
                  </div>
                  {projects.length ? (
                    <div className="dashboard-project-grid">
                      {projects.map((p) => (
                        <article className="project-card" key={p.id}>
                          <Link
                            className="project-cover"
                            to={"/project/" + p.id}
                            tabIndex={-1}
                            aria-hidden="true"
                          >
                            <TemplatePreview type={p.template} />
                          </Link>
                          <div className="project-card-footer">
                            <Link to={"/project/" + p.id}>
                              <h3>{p.name}</h3>
                              <span className="project-when">
                                <Clock size={12} />{" "}
                                {new Date(p.updatedAt).toLocaleDateString(
                                  "id-ID",
                                  {
                                    day: "numeric",
                                    month: "short",
                                  },
                                )}{" "}
                                ·{" "}
                                {isCloud
                                  ? store.sync[p.id]?.role || "Cloud"
                                  : "Project lokal"}
                              </span>
                              <SyncBadge phase={store.sync[p.id]?.phase} />
                              {continueLine(p) && (
                                <span className="project-continue">
                                  Terakhir: {continueLine(p)}
                                </span>
                              )}
                              <span className="project-footprint">
                                {footprintLine(p, photos[p.id])}
                              </span>
                              {matchOf.get(p.id) && (
                                <span className="project-match">
                                  <Search size={11} /> cocok di{" "}
                                  {matchOf.get(p.id)}
                                </span>
                              )}
                            </Link>
                            <div className="project-menu">
                              <button
                                className="icon-button"
                                aria-label={"Menu " + p.name}
                                onClick={() =>
                                  setMenu(menu === p.id ? "" : p.id)
                                }
                              >
                                <MoreHorizontal size={18} />
                              </button>
                              {menu === p.id && (
                                <div className="dropdown">
                                  <button
                                    disabled={
                                      store.sync[p.id]?.role === "Viewer"
                                    }
                                    onClick={() => {
                                      setSelected(p.id);
                                      setNewName(p.name);
                                      setDialog("rename");
                                      setMenu("");
                                    }}
                                  >
                                    <Pencil size={14} />
                                    Ganti nama
                                  </button>
                                  <button
                                    onClick={() => {
                                      store.duplicateProject(p.id);
                                      setMenu("");
                                      store.notify(
                                        "Project berhasil diduplikasi",
                                      );
                                    }}
                                  >
                                    <Copy size={14} />
                                    Duplikasi
                                  </button>
                                  <button
                                    className="danger"
                                    disabled={
                                      isCloud &&
                                      store.sync[p.id]?.role !== "Owner"
                                    }
                                    title={
                                      isCloud &&
                                      store.sync[p.id]?.role !== "Owner"
                                        ? "Hanya pemilik yang dapat menghapus"
                                        : undefined
                                    }
                                    onClick={() => {
                                      setSelected(p.id);
                                      setDialog("delete");
                                      setMenu("");
                                    }}
                                  >
                                    <Trash2 size={14} />
                                    Hapus project
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        </article>
                      ))}
                      <button
                        className="new-project-card"
                        onClick={() => setDialog("new")}
                      >
                        <span>
                          <Plus size={20} />
                        </span>
                        <b>Project baru</b>
                        <p>Mulai dari satu kalimat.</p>
                      </button>
                    </div>
                  ) : filtered ? (
                    <EmptyState
                      icon={Search}
                      title="Tidak ada project yang cocok"
                    >
                      {found.notFullySearched
                        ? `Isi ${found.notFullySearched} project terlalu besar untuk diperiksa seluruhnya — coba kata kunci lain.`
                        : "Cari di nama, isi file, dan percakapan. Coba kata kunci atau saringan lain."}
                    </EmptyState>
                  ) : tab === "shared" ? (
                    <EmptyState icon={Users} title="Belum ada project bersama">
                      Project yang dibagikan melalui membership Supabase muncul
                      di sini. Undangan email dan presence real-time belum
                      diaktifkan.
                    </EmptyState>
                  ) : (
                    <div className="project-empty">
                      <span className="empty-graphic">
                        <FolderOpen size={28} />
                        <Plus size={13} />
                      </span>
                      <h3>Belum ada project.</h3>
                      <p>
                        Mulai dari satu kalimat. Template bisa jadi titik awal,
                        bukan keputusan.
                      </p>
                      <button
                        className="button button-dark"
                        onClick={() => setDialog("new")}
                      >
                        <Plus size={15} />
                        Buat project pertama
                      </button>
                      <button
                        className="text-link"
                        onClick={() => changeTab("templates")}
                      >
                        Lihat template <ArrowUpRight size={14} />
                      </button>
                    </div>
                  )}
                </section>
                {tab === "projects" && (
                  <section
                    className="dash-templates"
                    aria-labelledby="dash-templates-title"
                  >
                    <div className="dash-section-head">
                      <h2 id="dash-templates-title">Mulai dari template</h2>
                      <button
                        className="text-link"
                        onClick={() => changeTab("templates")}
                      >
                        Semua template <ArrowUpRight size={14} />
                      </button>
                    </div>
                    <div className="dashboard-template-grid">
                      {templates.slice(0, 3).map((t) => (
                        <button
                          className="template-card"
                          key={t.id}
                          onClick={() => template(t.id)}
                        >
                          <TemplatePreview type={t.id} />
                          <div className="template-card-label">
                            <div>
                              <h3>{t.name}</h3>
                              <span>{t.category}</span>
                            </div>
                            <ArrowUpRight size={17} />
                          </div>
                        </button>
                      ))}
                    </div>
                  </section>
                )}
              </div>
              <aside className="dash-rail" aria-label="Ringkasan workspace">
                <CreditSummary />
                <ReadinessChecklist
                  hasRobloxProject={store.projects.some(
                    (project) => project.kind === "roblox",
                  )}
                />
                <WaitingForYou projects={store.projects} />
                <QualityPanel projects={store.projects} />
              </aside>
            </div>
          )}
          {(tab === "projects" || tab === "shared") && (
            <ActivityFeed projects={store.projects} />
          )}
          {tab === "templates" && (
            <>
              <div className="search-input template-search">
                <Search size={17} />
                <input
                  placeholder="Cari template…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <div className="dashboard-template-grid">
                {templates
                  .filter((t) =>
                    (t.name + " " + t.category)
                      .toLowerCase()
                      .includes(search.toLowerCase()),
                  )
                  .map((t) => (
                    <button
                      className="template-card"
                      key={t.id}
                      onClick={() => template(t.id)}
                    >
                      <TemplatePreview type={t.id} />
                      <div className="template-card-label">
                        <div>
                          <h3>{t.name}</h3>
                          <span>{t.category}</span>
                        </div>
                        <ArrowUpRight size={16} />
                      </div>
                    </button>
                  ))}
              </div>
            </>
          )}
          {tab === "profile" && <Profile embedded />}
          {tab === "prompts" &&
            (store.prompts.length ? (
              <div className="saved-prompt-grid">
                {store.prompts.map((p) => (
                  <article className="saved-prompt" key={p.id}>
                    <Bookmark size={19} />
                    <h3>{p.title}</h3>
                    <p>{p.content}</p>
                    <small>{p.tags}</small>
                    <div>
                      <button
                        className="button button-outline"
                        onClick={() => {
                          setNewPrompt(p.content);
                          setDialog("new");
                        }}
                      >
                        Gunakan <ArrowRight size={13} />
                      </button>
                      <button
                        className="icon-button danger"
                        aria-label="Hapus prompt"
                        onClick={() => store.removePrompt(p.id)}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <EmptyState
                icon={Bookmark}
                title="Rumah untuk ide-ide bagus Anda"
              >
                Simpan prompt favorit dan gunakan kembali saat inspirasi datang.
              </EmptyState>
            ))}
        </div>
        <footer className="dashboard-footer">
          <span>PiwuApp · Workspace</span>
          <span>Versi pengembangan</span>
        </footer>
      </main>
      {dialog === "storage" && <StorageDialog onClose={() => setDialog("")} />}
      {dialog && dialog !== "storage" && (
        <Modal
          title={
            {
              new: "Apa yang ingin Anda bangun?",
              rename: "Ganti nama project",
              delete: "Hapus project?",
              settings: "Pengaturan workspace",
              prompt: "Simpan prompt",
            }[dialog] || ""
          }
          onClose={() => setDialog("")}
        >
          <div className="modal-content">
            {dialog === "new" && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  create();
                }}
              >
                <p>
                  Mulai dengan satu kalimat. Detailnya bisa kita sempurnakan
                  nanti.
                </p>
                <ProjectKindPicker
                  value={projectKind}
                  onChange={setProjectKind}
                />
                <label>
                  Ide Anda
                  <textarea
                    rows={4}
                    value={newPrompt}
                    onChange={(e) => setNewPrompt(e.target.value)}
                    placeholder={
                      projectKind === "webapp"
                        ? "Buat website portfolio untuk studio desain saya…"
                        : projectKind === "mobile"
                          ? "Buat aplikasi mobile untuk…"
                          : "Buat game Roblox tentang…"
                    }
                    required
                    autoFocus
                  />
                </label>
                <div className="modal-actions">
                  <button
                    type="button"
                    className="button button-outline"
                    onClick={() => setDialog("")}
                  >
                    Batal
                  </button>
                  <button
                    className="button button-dark"
                    disabled={!newPrompt.trim()}
                  >
                    Buat project <ArrowUpRight size={15} />
                  </button>
                </div>
              </form>
            )}
            {dialog === "rename" && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (newName.trim()) {
                    store.updateProject(selected, { name: newName.trim() });
                    setDialog("");
                  }
                }}
              >
                <label>
                  Nama project
                  <input
                    value={newName}
                    required
                    maxLength={80}
                    onChange={(e) => setNewName(e.target.value)}
                  />
                </label>
                <button className="button button-dark full-width">
                  Simpan perubahan
                </button>
              </form>
            )}
            {dialog === "delete" && (
              <>
                <p>
                  Project beserta riwayatnya akan dihapus. Untuk project cloud,
                  penghapusan memerlukan konfirmasi server dan hanya diizinkan
                  bagi pemilik. Tindakan ini tidak bisa dibatalkan. Ekspor
                  project terlebih dahulu jika ingin menyimpannya.
                </p>
                <div className="modal-actions">
                  <button
                    className="button button-outline"
                    onClick={() => setDialog("")}
                  >
                    Batal
                  </button>
                  <button
                    className="button button-danger"
                    onClick={() => {
                      store.deleteProject(selected);
                      setDialog("");
                      store.notify(
                        isCloud
                          ? "Penghapusan menunggu konfirmasi cloud."
                          : "Project dihapus",
                      );
                    }}
                  >
                    Hapus project
                  </button>
                </div>
              </>
            )}
            {dialog === "settings" && (
              <>
                <div className="settings-row">
                  <span>Penyimpanan</span>
                  <b>{isCloud ? "Cloud + cache akun" : "Browser lokal"}</b>
                </div>
                <div className="settings-row">
                  <span>Autentikasi cloud</span>
                  <b>{supabase ? "Terkonfigurasi" : "Belum terhubung"}</b>
                </div>
                <div className="settings-row">
                  <span>Bahasa</span>
                  <b>Bahasa Indonesia</b>
                </div>
                <div className="settings-row">
                  <span>Paket</span>
                  <b>Demo · Tanpa tagihan</b>
                </div>
                <p>
                  {isCloud
                    ? "Project akun ini disinkronkan ke Supabase setelah server mengonfirmasi penyimpanan. Prompt pribadi masih tersimpan lokal."
                    : "Project demo hanya tersimpan di browser ini. Impor ke akun cloud dilakukan secara eksplisit, bukan otomatis."}
                </p>
                <button
                  className="button button-dark full-width"
                  style={{ marginBottom: 12 }}
                  onClick={() => setDialog("storage")}
                >
                  Kelola penyimpanan & impor
                </button>
                <button
                  className="button button-outline full-width"
                  onClick={() => {
                    const blob = new Blob(
                      [JSON.stringify(store.projects, null, 2)],
                      { type: "application/json" },
                    );
                    const a = document.createElement("a");
                    a.href = URL.createObjectURL(blob);
                    a.download = "piwuapp-backup.json";
                    a.click();
                    URL.revokeObjectURL(a.href);
                  }}
                >
                  <Download size={16} />
                  Unduh cadangan semua project
                </button>
              </>
            )}
            {dialog === "prompt" && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  store.savePrompt({
                    title: promptTitle,
                    content: promptContent,
                    tags: "Pribadi",
                  });
                  setDialog("");
                  setPromptTitle("");
                  setPromptContent("");
                }}
              >
                <label>
                  Judul
                  <input
                    required
                    value={promptTitle}
                    onChange={(e) => setPromptTitle(e.target.value)}
                    placeholder="Landing page minimal"
                  />
                </label>
                <label>
                  Prompt
                  <textarea
                    required
                    rows={5}
                    value={promptContent}
                    onChange={(e) => setPromptContent(e.target.value)}
                    placeholder="Buat sebuah…"
                  />
                </label>
                <button className="button button-dark full-width">
                  Simpan prompt
                </button>
              </form>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
/**
 * The "pick up where you left off" strip: the most recently touched project, on
 * a dark plate, with what changed last. It uses the same data as the card but
 * gives the one project a user is most likely to reopen a larger target.
 */
function River({ projects }: { projects: Project[] }) {
  const latest = projects[0];
  if (!latest) return null;
  const entry = useStore((s) => s.sync[latest.id]);
  const line = continueLine(latest);
  return (
    <Link className="dash-river" to={"/project/" + latest.id}>
      <div className="dash-river-copy">
        <span>
          Lanjutkan ·{" "}
          {new Date(latest.updatedAt).toLocaleDateString("id-ID", {
            day: "numeric",
            month: "long",
          })}
        </span>
        <h2>{latest.name}</h2>
        <p>{line ? `Terakhir: ${line}` : footprintLine(latest)}</p>
      </div>
      <div className="dash-river-meta">
        {entry?.phase && <SyncBadge phase={entry.phase} />}
        <span className="dash-river-open">
          Buka project <ArrowRight size={15} />
        </span>
      </div>
    </Link>
  );
}
function LayersIcon({ size = 17 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
    >
      <path d="m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5" />
    </svg>
  );
}
