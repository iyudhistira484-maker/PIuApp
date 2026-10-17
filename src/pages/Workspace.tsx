import { readPaneWidth } from "../workspace/preferences";
import { workspaceStorage } from "../lib/local-storage";
import { IDEThemeProvider, useIDETheme } from "../workspace/IDETheme";
import { SCENE_PATH, validateSceneChanges } from "../lib/roblox/scene";
import "../workspace/roblox/roblox.css";
import { readAttachment } from "../services/api";
import { photoSamples } from "../lib/photo-palette";
import type { PhotoPalette } from "../lib/photo-palette";
import {
  PROJECT_PHOTOS_MAX,
  photoFromAttachment,
  photoSize,
} from "../lib/photo-assets";
import type { ProjectPhotoMeta } from "../lib/photo-assets";
import {
  listProjectPhotos,
  readProjectPhoto,
  removeProjectPhoto,
  saveProjectPhotos,
} from "../services/project-photos";
import type { Attachment } from "../services/api";
import { saveRecording } from "../services/recordings";
import type { ReplayEvent } from "../services/recordings";
import Presence, { useProjectPresence } from "../components/services/Presence";
import { useCollabText } from "../lib/collab/useCollabText";
import type { CodeEditorApi } from "../workspace/CodeEditor";
import { NotificationBell } from "../components/admin/Platform";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import {
  Sun,
  Moon,
  ArrowUp,
  ArrowUpRight,
  ArrowLeft,
  Plus,
  X,
  ChevronDown,
  ChevronRight,
  Code2,
  Eye,
  Palette,
  Files,
  Search,
  Package,
  Database,
  Plug,
  GitBranch,
  Settings,
  CreditCard,
  Monitor,
  Tablet,
  Smartphone,
  RotateCw,
  Play,
  Maximize,
  MousePointer2,
  PanelBottom,
  PanelLeftClose,
  PanelRightClose,
  Wrench,
  PenLine,
  Check,
  Copy,
  Undo2,
  History,
  ListChecks,
  MessageSquare,
  Send,
  Paperclip,
  Mic,
  LoaderCircle,
  Download,
  Globe2,
  ShieldCheck,
  Terminal as TerminalIcon,
  CheckCheck,
  AlertTriangle,
  Square,
  FolderOpen,
  Command,
  Save,
  RefreshCw,
  FileText,
  SlidersHorizontal,
  Link as LinkIcon,
  ExternalLink,
  Bookmark,
  Pencil,
  Trash2,
  Columns2,
  StopCircle,
  Radio,
  PanelsTopLeft,
  PanelLeft,
  PanelRight,
} from "lucide-react";
import { useStore } from "../lib/store";
import type {
  Mode,
  Model,
  Project,
  ResearchStep,
  SourceRef,
} from "../lib/types";
import { researchStepLabel } from "../lib/research-step";
import {
  forgetPendingJob,
  lostJobs,
  readClaimedJobs,
  readPendingJobs,
  rememberClaimedJob,
  rememberPendingJob,
} from "../lib/research-jobs";
import { Logo, Modal } from "../components/ui";
import { compilePreview } from "../lib/preview";
import { scopeFor } from "../lib/cloud/types";
import { StorageStatus } from "../components/storage/StorageStatus";
import {
  AI_TIERS,
  claimResearchJob,
  estimateCredits,
  fetchAiModels,
  fetchResearchJobs,
  streamAI,
} from "../lib/ai";
import type { AiModelCatalog, ResearchJob } from "../lib/ai";
import AiModelPicker from "../components/ai/AiModelPicker";
import type { CatalogStatus } from "../components/ai/AiModelPicker";
import FileExplorer, { FileIcon } from "../workspace/FileExplorer";
import PlanPanel from "../workspace/PlanPanel";
import "../workspace/workspace.css";
import "../workspace/workbench.css";
import "../workspace/theme.css";
// Remembered per account, like the IDE theme. Tier presets stay valid even
// when the provider list cannot be read.
const MODEL_PREFERENCE_KEY = "piwu-ai-model-v1";
// Research mode is remembered per account too, so a user who wants sources
// does not have to switch it on again in every session.
const RESEARCH_PREFERENCE_KEY = "piwu-ai-research-v1";
const readStoredResearch = (scope: string): boolean =>
  workspaceStorage.getItem(`${RESEARCH_PREFERENCE_KEY}:${scope}`) === "1";
const readStoredModel = (scope: string): Model => {
  const stored = workspaceStorage.getItem(`${MODEL_PREFERENCE_KEY}:${scope}`);
  if (typeof stored !== "string" || !stored) return "Otomatis";
  return stored.length <= 100 ? stored : "Otomatis";
};
const CanvasPanel = lazy(() => import("../workspace/CanvasPanel"));
const CodeEditor = lazy(() => import("../workspace/CodeEditor"));
const ServicePanel = lazy(() => import("../components/services/ServicePanel"));
const ServiceHub = lazy(() => import("../components/services/ServiceHub"));
const GitHubPanel = lazy(() => import("../components/services/GitHubPanel"));
const RecordingPanel = lazy(
  () => import("../components/services/RecordingPanel"),
);
const TerminalPanel = lazy(() => import("../workspace/TerminalPanel"));
const RobloxBuilder = lazy(() => import("../workspace/roblox/RobloxBuilder"));
const DatabasePanel = lazy(() => import("../workspace/DatabasePanel"));
const InspectorPanel = lazy(() => import("../workspace/InspectorPanel"));
type ElementSelection = {
  selector: string;
  tag: string;
  text: string;
  color: string;
  background: string;
  fontSize: string;
};
const icons = [
  { id: "files", icon: Files, label: "File" },
  { id: "search", icon: Search, label: "Pencarian global" },
  { id: "packages", icon: Package, label: "Paket" },
  { id: "database", icon: Database, label: "Database" },
  { id: "integrations", icon: Plug, label: "Integrasi" },
  { id: "github", icon: GitBranch, label: "GitHub" },
  { id: "security", icon: ShieldCheck, label: "Pemeriksaan kualitas" },
];
// Only show "kueri …" when the round really merged several queries; on a single
// search it would just repeat the same string on every row.
const distinctQueries = (sources?: SourceRef[]) =>
  new Set((sources || []).map((s) => s.query).filter(Boolean)).size;

export default function Workspace() {
  return (
    <IDEThemeProvider>
      <WorkspaceRoute />
    </IDEThemeProvider>
  );
}
function WorkspaceRoute() {
  const { id } = useParams();
  const project = useStore((s) => s.projects.find((p) => p.id === id));
  const connection = useStore((s) => s.connection);
  const authReady = useStore((s) => s.authReady);
  if (!authReady || (!project && connection.phase === "loading"))
    return (
      <div className="app-loading">
        <LoaderCircle className="spin" size={24} />
        <p>Memuat project dari workspace Anda…</p>
      </div>
    );
  if (!project)
    return (
      <div className="app-error">
        <FolderOpen size={36} />
        <h1>Project tidak ditemukan.</h1>
        <p>
          {connection.error ||
            "Pastikan Anda masuk dengan akun yang memiliki akses dan project telah tersinkron ke cloud."}
        </p>
        <StorageStatus />
        <Link to="/projects" className="button button-dark">
          <ArrowLeft size={15} />
          Kembali ke project
        </Link>
      </div>
    );
  return <WorkspaceContent key={id} project={project} />;
}
/** Panel names a link may ask for, with the title the modal shows. */
const DIALOG_TITLES: Record<string, string> = {
  settings: "Pengaturan workspace",
  invite: "Bangun bersama tim",
  export: "Ekspor kode project",
  services: "Layanan project",
  integrations: "Integrasi",
  comments: "Komentar pada elemen",
  recording: "Rekaman & pemutar sesi",
  credits: "Paket & penggunaan",
};

function WorkspaceContent({ project }: { project: Project }) {
  const { theme, setTheme, persistenceError } = useIDETheme();
  const store = useStore();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const id = project.id;
  const kind = project.kind || "webapp";
  const initialFile =
    kind === "mobile"
      ? "App.tsx"
      : kind === "roblox"
        ? "ServerScriptService/Main.server.luau"
        : "src/App.tsx";
  const readOnly = store.sync[id]?.role === "Viewer";
  const [robloxPreviewRevision, setRobloxPreviewRevision] = useState(0);
  const [view, setView] = useState<"Preview" | "Design" | "Code" | "Canvas">(
    "Preview",
  );
  const [rail, setRail] = useState("files");
  const [activeFile, setActiveFile] = useState(initialFile);
  const [opened, setOpened] = useState([initialFile]);
  const [left, setLeft] = useState(() => window.innerWidth > 850);
  const [right, setRight] = useState(() => window.innerWidth > 1100);
  useEffect(() => {
    if (kind !== "roblox" || view === "Code") return;
    const media = window.matchMedia("(max-width: 850px)");
    const revealScene = () => {
      if (media.matches) {
        setLeft(false);
        setRight(false);
      }
    };
    revealScene();
    media.addEventListener("change", revealScene);
    return () => media.removeEventListener("change", revealScene);
  }, [kind, view]);
  const [focus, setFocus] = useState(false);
  const [bottom, setBottom] = useState("");
  const [device, setDevice] = useState("desktop");
  const [multi, setMulti] = useState(false);
  const [zoom, setZoom] = useState("100");
  const [refresh, setRefresh] = useState(0);
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<Mode>(store.pendingMode || "Builder");
  const modelScope = store.user?.id || "demo";
  const [model, setModel] = useState<Model>(() => readStoredModel(modelScope));
  const [research, setResearch] = useState<boolean>(() =>
    readStoredResearch(modelScope),
  );
  const [catalog, setCatalog] = useState<AiModelCatalog | null>(null);
  const [catalogStatus, setCatalogStatus] = useState<CatalogStatus>("idle");
  const [catalogError, setCatalogError] = useState("");
  const [chatTab, setChatTab] = useState("Chat");
  const [busy, setBusy] = useState(false);
  const [streaming, setStreaming] = useState("");
  // Latest step reported by the research loop, shown while the turn runs.
  const [researchStep, setResearchStep] = useState<ResearchStep | null>(null);
  const [error, setError] = useState("");
  const [aiError, setAiError] = useState("");
  const [logs, setLogs] = useState<string[]>(["Preview lokal siap."]);
  const [changed, setChanged] = useState<string[]>([]);
  const [select, setSelect] = useState(false);
  const [selected, setSelected] = useState<ElementSelection | null>(null);
  const [review, setReview] = useState<Record<string, string> | null>(null);
  const [reviewPath, setReviewPath] = useState("");
  const [useReview, setUseReview] = useState(true);
  const [dialog, setDialog] = useState("");

  // A dashboard link may name the panel it wants (`?dialog=services&services=comments`),
  // so an item like "3 komentar belum diselesaikan" opens where it can be fixed.
  // Only the names the modal already knows are accepted; anything else is ignored.
  useEffect(() => {
    const asked = searchParams.get("dialog") || "";
    if (Object.prototype.hasOwnProperty.call(DIALOG_TITLES, asked))
      setDialog(asked);
    // First render only: after that the user owns which panel is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [projectMenu, setProjectMenu] = useState(false);
  const [newName, setNewName] = useState(project.name);
  const [query, setQuery] = useState("");
  const [replace, setReplace] = useState("");
  const [commandSearch, setCommandSearch] = useState("");
  const [provider, setProvider] = useState<"unavailable" | "configured">(
    "unavailable",
  );
  const [summaryOpen, setSummaryOpen] = useState("");
  const [sourcesOpen, setSourcesOpen] = useState("");
  // True while a research turn this browser started is still running on the
  // server, so the composer can say so instead of looking idle.
  const [bgResearch, setBgResearch] = useState(false);
  const [comment, setComment] = useState("");
  const [designText, setDesignText] = useState("");
  const [designColor, setDesignColor] = useState("#2857aa");
  const [designSize, setDesignSize] = useState("20");
  const [designSpacing, setDesignSpacing] = useState("16");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("Viewer");
  const [packageQuery, setPackageQuery] = useState("");
  const [line, setLine] = useState<number>();
  const [cursor, setCursor] = useState({ lineNumber: 1, column: 1 });
  const presence = useProjectPresence(id, activeFile, cursor);
  const editorPeers = useMemo(
    () =>
      presence.peers
        .filter((peer) => peer.file === (reviewPath || activeFile))
        .map((peer) => ({ id: peer.id, name: peer.name, line: peer.line })),
    [presence.peers, reviewPath, activeFile],
  );
  // Merge characters only when another member is actually on this file and
  // the editor is editable. The merged text goes through store.writeFile, so
  // autosave, revisions and conflict detection are unchanged; with no peer the
  // hook stays off and costs nothing.
  const editorApi = useRef<CodeEditorApi | null>(null);
  // Only a peer who says they are on this file can merge with it; other files
  // in the same project must not receive this tab's ops.
  const collabPeers = editorPeers.length;
  const collab = useCollabText({
    transport: presence.transport,
    path: activeFile,
    value: project.files[activeFile] || "",
    peers: collabPeers,
    // Review diffs do not end the session: doing so would force a fresh base
    // and report a false "teks berbeda" when the review panel closes.
    editable: !readOnly && Boolean(activeFile),
    joined: presence.state === "live",
    onMerged: (text, mergedPath) => {
      if (mergedPath !== activeFile) return;
      // Reach the buffer first: a keystroke processed after this callback must
      // already see the merged text, otherwise it would overwrite it.
      editorApi.current?.apply(text);
      store.writeFile(id, mergedPath, text);
    },
  });
  // Up to three attachments, so a photo of the object can travel with the brief
  // that describes it. The server numbers the photos in this order.
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  // Colour grids sampled from the attached photos, in the same order as the
  // photos themselves. A photo whose pixels could not be read is kept as null,
  // so the server can say "no colour sample for photo 2" instead of guessing.
  const [palettes, setPalettes] = useState<(PhotoPalette | null)[]>([]);
  // Small redraws of those same photos, kept so a stored photo can be listed
  // without decoding it again.
  const [thumbnails, setThumbnails] = useState<(string | null)[]>([]);
  // Photos this project already holds, in this browser. Sorted newest first.
  const [projectPhotos, setProjectPhotos] = useState<ProjectPhotoMeta[]>([]);
  // The photo opened large, to compare against the model it produced. The
  // thumbnail shows immediately; the full bytes follow once they are read.
  const [photoView, setPhotoView] = useState<ProjectPhotoMeta | null>(null);
  const [photoViewSrc, setPhotoViewSrc] = useState<string | null>(null);
  const [references, setReferences] = useState<string[]>([]);
  const [scans, setScans] = useState<
    { title: string; file: string; level: string }[] | null
  >(null);
  const [leftWidth, setLeftWidth] = useState(() =>
    readPaneWidth("piwu-explorer-width", 195, 160, 400),
  );
  const [rightWidth, setRightWidth] = useState(() =>
    readPaneWidth("piwu-chat-width", 340, 280, 550),
  );
  const [recording, setRecording] = useState(false);
  const [events, setEvents] = useState<ReplayEvent[]>([]);
  const [initializing, setInitializing] = useState(true);
  const [providerVerified, setProviderVerified] = useState(false);
  const previewRef = useRef<HTMLIFrameElement>(null);
  const chatEnd = useRef<HTMLDivElement>(null);
  const attachmentRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const started = useRef(false);
  // Requests already being collected, so two visibility events cannot claim the
  // same background answer twice.
  const collecting = useRef(new Set<string>());
  const bgInformed = useRef(false);
  const record = useCallback(
    (label: string) => {
      if (recording)
        setEvents((e) =>
          e.length >= 100
            ? e
            : [
                ...e,
                {
                  time: Date.now(),
                  label,
                  files: {
                    ...useStore.getState().projects.find((p) => p.id === id)!
                      .files,
                  },
                },
              ],
        );
    },
    [recording, id],
  );
  useEffect(() => {
    if (!recording) return;
    const t = setTimeout(() => record("Snapshot perubahan kode"), 700);
    return () => clearTimeout(t);
  }, [project.files, recording, record]);
  const openFile = (path: string, line?: number) => {
    setActiveFile(path);
    setOpened((p) => (p.includes(path) ? p : [...p, path]));
    setView("Code");
    setRail("files");
    if (window.innerWidth <= 850) setLeft(false);
    setLine(line);
    setReviewPath("");
  };
  const account = useStore((s) => scopeFor(s.user));
  const refreshProjectPhotos = useCallback(async () => {
    try {
      setProjectPhotos(await listProjectPhotos(account, id));
    } catch {
      // A browser without IndexedDB (private mode) simply has no stored photos;
      // the panel stays empty instead of breaking the workspace.
      setProjectPhotos([]);
    }
  }, [account, id]);
  useEffect(() => {
    void refreshProjectPhotos();
  }, [refreshProjectPhotos]);
  // Puts a stored photo back into the composer, with the colours that were
  // sampled from those exact bytes — so the next model is built from the photo
  // again, not from a recollection of it.
  const reuseProjectPhoto = async (photo: ProjectPhotoMeta) => {
    if (attachments.length >= 3) {
      store.notify("Maksimal 3 lampiran per pesan. Hapus salah satu dulu.");
      return;
    }
    const full = await readProjectPhoto(account, id, photo.id);
    if (!full) {
      store.notify("Foto itu sudah tidak ada di penyimpanan browser ini.");
      await refreshProjectPhotos();
      return;
    }
    let palette = full.palette ?? null;
    if (!palette) {
      const samples = await photoSamples(full);
      palette = samples.palette;
    }
    setAttachments((list) => [
      ...list,
      { name: full.name, mime: full.mime, data: full.data },
    ]);
    setPalettes((list) => [...list, palette]);
    setThumbnails((list) => [...list, full.thumbnail ?? null]);
    store.notify(`Foto ${full.name} dipakai lagi sebagai lampiran.`);
  };
  const openProjectPhoto = async (photo: ProjectPhotoMeta) => {
    setPhotoView(photo);
    setPhotoViewSrc(photo.thumbnail || null);
    const full = await readProjectPhoto(account, id, photo.id);
    if (full) setPhotoViewSrc(`data:${full.mime};base64,${full.data}`);
  };
  const dropProjectPhoto = async (photo: ProjectPhotoMeta) => {
    await removeProjectPhoto(account, id, photo.id).catch(() => undefined);
    setPhotoView((open) => (open?.id === photo.id ? null : open));
    setPhotoViewSrc(null);
    await refreshProjectPhotos();
    store.notify("Aset foto dihapus dari project ini.");
  };
  const addMessage = (
    role: "user" | "assistant",
    content: string,
    files?: string[],
    summary?: string[],
  ) =>
    store.addMessage(id, {
      id: crypto.randomUUID(),
      role,
      content,
      mode,
      files,
      summary,
      at: Date.now(),
    });
  const selectingElements = view === "Design" || (view === "Preview" && select);
  const preview = useMemo(() => {
    if (kind !== "webapp") return { html: "", error: "" };
    try {
      return {
        html: compilePreview(project.files, selectingElements),
        error: "",
      };
    } catch (e) {
      return {
        html: "",
        error: e instanceof Error ? e.message : "Preview gagal dikompilasi.",
      };
    }
  }, [project.files, selectingElements]);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/status", { signal: controller.signal })
      .then((r) => r.json())
      .then((d) => {
        setProvider(
          d.ai === "configured" && store.user && !store.user.demo
            ? "configured"
            : "unavailable",
        );
        setInitializing(false);
      })
      .catch(() => setInitializing(false));
    return () => controller.abort();
  }, []);
  const loadModels = useCallback((refresh = false) => {
    setCatalogStatus("loading");
    setCatalogError("");
    return fetchAiModels({ refresh })
      .then((next) => {
        setCatalog(next);
        setCatalogStatus("ready");
        // A remembered model that the API key no longer offers would be
        // rejected by the server, so fall back to the automatic preset.
        setModel((current) =>
          (AI_TIERS as readonly string[]).includes(current) ||
          !current ||
          next.models.includes(current)
            ? current
            : "Otomatis",
        );
      })
      .catch((e: unknown) => {
        setCatalog(null);
        setCatalogStatus("error");
        setCatalogError(
          e instanceof Error
            ? e.message
            : "Daftar model provider tidak dapat dibaca.",
        );
      });
  }, []);
  useEffect(() => {
    if (provider !== "configured") return;
    void loadModels();
  }, [provider, loadModels]);
  useEffect(() => {
    workspaceStorage.setItem(`${MODEL_PREFERENCE_KEY}:${modelScope}`, model);
  }, [model, modelScope]);
  useEffect(() => {
    workspaceStorage.setItem(
      `${RESEARCH_PREFERENCE_KEY}:${modelScope}`,
      research ? "1" : "0",
    );
  }, [research, modelScope]);
  useEffect(() => {
    const fn = (e: MessageEvent) => {
      if (e.source !== previewRef.current?.contentWindow) return;
      if (e.data?.type === "piwu-error")
        setError(String(e.data.message).slice(0, 500));
      if (e.data?.type === "piwu-log")
        setLogs((p) =>
          [...p, String(e.data.message).slice(0, 500)].slice(-100),
        );
      if (e.data?.type === "piwu-select") {
        setSelected(e.data);
        setDesignText(e.data.text);
        setDesignSize(String(parseInt(e.data.fontSize) || 20));
        if (view === "Design") setRight(true);
      }
    };
    window.addEventListener("message", fn);
    return () => window.removeEventListener("message", fn);
  }, [view]);
  useEffect(() => {
    setError("");
  }, [project.files, refresh]);
  useEffect(() => {
    chatEnd.current?.scrollIntoView({ behavior: "smooth" });
  }, [streaming, project.messages.length]);
  const send = useCallback(
    async (text = input, override?: Mode) => {
      if (!text.trim() || busy) return;
      if (useStore.getState().sync[id]?.role === "Viewer") {
        store.notify(
          "Akses Viewer: minta izin Editor untuk menjalankan AI pada project ini.",
        );
        return;
      }
      if (initializing || provider !== "configured") {
        setAiError(
          "AI belum tersedia. Aktifkan provider di server lalu periksa kembali. Tidak ada jawaban atau perubahan kode simulasi.",
        );
        return;
      }
      if (
        provider === "configured" &&
        useStore.getState().sync[id]?.phase !== "synced"
      ) {
        setAiError("Sinkronkan project ke cloud terlebih dahulu.");
        return;
      }
      const currentMode = override || mode;
      setInput("");
      setBusy(true);
      setAiError("");
      setStreaming("");
      setResearchStep(null);
      setChatTab("Chat");
      const contextual = selected
        ? text +
          `\nElemen: ${selected.selector}, sumber src/App.tsx, teks: ${selected.text}`
        : text;
      store.addMessage(id, {
        id: crypto.randomUUID(),
        role: "user",
        content: text,
        mode: currentMode,
        at: Date.now(),
      });
      record("Pesan: " + text.slice(0, 80));
      const controller = new AbortController();
      abortRef.current = controller;
      // The id travels with the request so a research turn that finished after
      // the tab closed can be claimed from the background store.
      const requestId = crypto.randomUUID();
      // Tracked until the answer is in hand, so a run that dies with the server
      // is reported honestly instead of silently disappearing.
      if (research) rememberPendingJob(id, requestId);
      try {
        const result = await streamAI({
          projectId: id,
          attachments,
          // One slot per photo, in photo order: the server indexes them by the
          // photo number the model cites.
          photoPalettes: attachments
            .map((file, at) =>
              file.mime.startsWith("image/") ? (palettes[at] ?? null) : null,
            )
            .filter((_, at) => attachments[at].mime.startsWith("image/")),
          references,
          prompt: contextual,
          files: project.files,
          mode: currentMode,
          model,
          research,
          requestId,
          onToken: setStreaming,
          onStep: setResearchStep,
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        setProviderVerified(true);
        const answerId = crypto.randomUUID();
        // The photos of this turn are kept with the project before the composer
        // is cleared, so the finished model can be compared against the picture
        // it came from and the same photo can be used in a later session.
        const answered = attachments.filter((file: Attachment) =>
          file.mime.startsWith("image/"),
        );
        if (answered.length)
          void saveProjectPhotos(
            account,
            id,
            answered.flatMap((file: Attachment) => {
              const at = attachments.indexOf(file);
              try {
                return [
                  photoFromAttachment(file, {
                    palette: palettes[at] ?? null,
                    thumbnail: thumbnails[at] ?? undefined,
                    from: answerId,
                  }),
                ];
              } catch {
                // A file the store refuses is simply not kept: the turn already
                // succeeded, and nothing is claimed about a photo that was not
                // stored.
                return [];
              }
            }),
          )
            .then(async ({ saved, dropped }) => {
              await refreshProjectPhotos();
              if (saved)
                store.notify(
                  dropped.length
                    ? `${saved} foto disimpan sebagai aset project; ${dropped.length} foto terlama dihapus (batas ${PROJECT_PHOTOS_MAX} foto / 16 MB).`
                    : `${saved} foto disimpan sebagai aset project (di browser ini).`,
                );
            })
            .catch(() => undefined);
        setAttachments([]);
        setPalettes([]);
        setThumbnails([]);
        setReferences([]);
        store.addMessage(id, {
          id: answerId,
          role: "assistant",
          content: result.content,
          files: result.files ? Object.keys(result.files) : undefined,
          summary: result.summary,
          ops: result.ops,
          sources: result.sources,
          research: result.research,
          tools: result.tools,
          notes: result.notes,
          model: result.model,
          mode: currentMode,
          at: Date.now(),
        });
        // The sources behind this answer are open straight away; the header
        // stays clickable to fold them back.
        if (result.sources?.length || result.research) setSourcesOpen(answerId);
        if (currentMode === "Plan") {
          store.updateProject(id, {
            plan: result.plan!,
          });
          setChatTab("Rencana");
        }
        if (
          currentMode === "Builder" &&
          result.files &&
          Object.keys(result.files).length
        ) {
          if (useReview) {
            setReview(result.files);
            setReviewPath(
              kind === "roblox" && result.files[SCENE_PATH]
                ? SCENE_PATH
                : Object.keys(result.files)[0],
            );
            setView(
              kind === "roblox" && result.files[SCENE_PATH]
                ? "Preview"
                : "Code",
            );
            if (kind === "roblox" && result.files[SCENE_PATH]) {
              setRobloxPreviewRevision((n) => n + 1);
              setRail("files");
              if (window.innerWidth <= 850) {
                setLeft(false);
                setRight(false);
              }
            }
          } else {
            if (kind === "roblox") validateSceneChanges(result.files);
            store.applyFiles(
              id,
              result.files,
              "Perubahan " + text.slice(0, 35),
            );
            setChanged(Object.keys(result.files));
            if (kind === "roblox" && result.files[SCENE_PATH]) {
              setView("Preview");
              setRail("files");
              setRobloxPreviewRevision((n) => n + 1);
            }
          }
          record("Perubahan file: " + Object.keys(result.files).join(", "));
        }
        if (research) {
          void claimResearchJob(id, requestId);
          rememberClaimedJob(id, requestId);
          forgetPendingJob(id, requestId);
        }
      } catch (e) {
        setInput((current) => current || text);
        if (!controller.signal.aborted)
          setAiError(
            e instanceof Error ? e.message : "Permintaan gagal. Coba lagi.",
          );
      } finally {
        setBusy(false);
        setStreaming("");
        setResearchStep(null);
        abortRef.current = null;
      }
    },
    [
      input,
      busy,
      mode,
      selected,
      provider,
      initializing,
      kind,
      project.files,
      model,
      useReview,
      id,
      record,
      attachments,
      palettes,
      references,
    ],
  );
  // Research keeps running on the server after the tab is closed. The finished
  // answer is collected here exactly once — when the project is opened again or
  // when the tab becomes visible — and shown like any other reply.
  useEffect(() => {
    if (initializing || provider !== "configured") return;
    if (store.sync[id]?.phase !== "synced") return;
    if (!store.user || store.user.demo) return;
    let stopped = false;
    let timer: number | undefined;
    const collect = async () => {
      const jobs = await fetchResearchJobs(id);
      if (stopped) return;
      // A run that is still going is reported as such and checked again, so the
      // answer lands in the chat without a reload — the reason the job store
      // exists at all.
      const running = jobs.some((job) => job.state === "running");
      setBgResearch(running);
      if (running && !bgInformed.current) {
        bgInformed.current = true;
        store.notify(
          "Riset yang Anda tinggalkan masih berjalan di server. Hasilnya muncul di chat begitu selesai; bila proses server dimulai ulang sebelum selesai, jawaban itu tidak bisa diambil lagi dan kreditnya dipulihkan.",
        );
      }
      if (running && !stopped) timer = window.setTimeout(collect, 5000);
      // A run this browser started that the server no longer knows about: the
      // process restarted before the answer was finished, or the job list was
      // cleared. Neither can be recovered, so it is said once (never while the
      // job is still listed, and never for a turn that was just sent).
      for (const lost of lostJobs(
        readPendingJobs(id),
        jobs.map((job) => job.requestId),
      )) {
        forgetPendingJob(id, lost);
        store.notify(
          "Riset yang Anda tinggalkan tidak lagi tersedia di server (proses server berhenti atau daftar job-nya dibersihkan), jadi jawabannya tidak bisa diambil. Kredit ronde yang tidak selesai dipulihkan otomatis — silakan kirim ulang pertanyaannya.",
        );
      }
      for (const job of jobs) {
        if (job.state === "running") continue;
        if (collecting.current.has(job.requestId)) continue;
        if (readClaimedJobs(id).includes(job.requestId)) continue;
        collecting.current.add(job.requestId);
        const taken = await claimResearchJob(id, job.requestId);
        if (stopped) return;
        if (!taken) {
          collecting.current.delete(job.requestId);
          continue;
        }
        rememberClaimedJob(id, job.requestId);
        forgetPendingJob(id, job.requestId);
        if (taken.state === "failed") {
          setAiError("Riset latar belakang gagal: " + taken.error);
          continue;
        }
        const result = taken.result;
        if (!result) continue;
        const answerId = crypto.randomUUID();
        store.addMessage(id, {
          id: answerId,
          role: "assistant",
          content: result.content,
          files: result.files ? Object.keys(result.files) : undefined,
          summary: result.summary,
          ops: result.ops,
          sources: result.sources,
          research: result.research,
          tools: result.tools,
          notes: result.notes,
          model: result.model,
          mode: (job.mode as Mode) || "Ask",
          at: Date.now(),
        });
        if (result.sources?.length || result.research) setSourcesOpen(answerId);
        store.notify(
          "Riset yang Anda tinggalkan selesai di latar belakang. Kredit ronde yang selesai tetap terpakai.",
        );
        if (result.files && Object.keys(result.files).length) {
          if (useReview) {
            setReview(result.files);
            setReviewPath(
              kind === "roblox" && result.files[SCENE_PATH]
                ? SCENE_PATH
                : Object.keys(result.files)[0],
            );
            setView(
              kind === "roblox" && result.files[SCENE_PATH]
                ? "Preview"
                : "Code",
            );
          } else {
            if (kind === "roblox") validateSceneChanges(result.files);
            store.applyFiles(
              id,
              result.files,
              "Riset latar: " + job.prompt.slice(0, 30),
            );
            setChanged(Object.keys(result.files));
            if (kind === "roblox" && result.files[SCENE_PATH]) {
              setView("Preview");
              setRail("files");
              setRobloxPreviewRevision((n) => n + 1);
            }
          }
        }
      }
    };
    void collect();
    const onVisible = () => {
      if (document.visibilityState === "visible") void collect();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      if (timer) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [id, initializing, provider, kind, useReview, store.sync[id]?.phase]);
  useEffect(() => {
    if (started.current || initializing) return;
    const pendingState = useStore.getState();
    if (pendingState.pendingProjectId && pendingState.pendingProjectId !== id)
      return;
    const pending = pendingState.pendingPrompt;
    if (!pending || project.messages.length > 0) return;
    setInput(pending);
    if (provider !== "configured" || store.sync[id]?.phase !== "synced") return;
    started.current = true;
    useStore.getState().setPending("");
    void send(pending, mode);
  }, [initializing, provider, store.sync[id]?.phase]);
  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key === "k") {
        e.preventDefault();
        setDialog("commands");
      }
      if (e.key === ".") {
        e.preventDefault();
        setFocus((f) => !f);
      }
      if (e.key === "s") {
        e.preventDefault();
        store.notify(
          "Penyimpanan otomatis aktif. Periksa status penyimpanan di status bar.",
        );
      }
      if (e.key === "b" && !e.shiftKey) {
        e.preventDefault();
        setLeft((v) => !v);
      }
      if (e.key === "j") {
        e.preventDefault();
        setBottom((v) => (v ? "" : "Terminal"));
      }
      if (e.key === "p") {
        e.preventDefault();
        setDialog("files");
      }
      if (e.key === "F" || (e.shiftKey && e.key === "f")) {
        e.preventDefault();
        setRail("search");
        setLeft(true);
      }
      if (e.key === "Enter") {
        e.preventDefault();
        void send();
      }
    };
    document.addEventListener("keydown", fn);
    return () => document.removeEventListener("keydown", fn);
  }, [send]);
  useEffect(() => () => abortRef.current?.abort(), []);
  const searchResults = query
    ? Object.entries(project.files)
        .flatMap(([path, content]) =>
          content
            .split("\n")
            .flatMap((line, i) =>
              line.toLowerCase().includes(query.toLowerCase())
                ? [{ path, line: i + 1, text: line.trim().slice(0, 140) }]
                : [],
            ),
        )
        .slice(0, 80)
    : [];
  function resize(e: React.MouseEvent, side: "left" | "right") {
    e.preventDefault();
    const x = e.clientX;
    const width = side === "left" ? leftWidth : rightWidth;
    const move = (ev: MouseEvent) => {
      const n = Math.max(
        side === "left" ? 150 : 280,
        Math.min(
          side === "left" ? 340 : 530,
          width + (ev.clientX - x) * (side === "left" ? 1 : -1),
        ),
      );
      if (side === "left") {
        setLeftWidth(n);
        void workspaceStorage.setItem("piwu-explorer-width", String(n));
      } else {
        setRightWidth(n);
        void workspaceStorage.setItem("piwu-chat-width", String(n));
      }
    };
    const up = () => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
    };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  }
  function applyReview(paths = Object.keys(review || {})) {
    if (!review || readOnly) return;
    const updates = Object.fromEntries(paths.map((p) => [p, review[p]]));
    if (kind === "roblox") {
      try {
        validateSceneChanges(updates);
      } catch (e) {
        store.notify(e instanceof Error ? e.message : "Scene tidak valid.");
        return;
      }
    }
    store.applyFiles(id, updates, "Perubahan AI");
    setChanged(paths);
    const remaining = Object.fromEntries(
      Object.entries(review).filter(([path]) => !paths.includes(path)),
    );
    const hasRemaining = Object.keys(remaining).length > 0;
    setReview(hasRemaining ? remaining : null);
    setReviewPath(hasRemaining ? Object.keys(remaining)[0] : "");
    setView(
      hasRemaining
        ? kind === "roblox" && remaining[SCENE_PATH]
          ? "Preview"
          : "Code"
        : "Preview",
    );
    store.notify("Perubahan diterapkan. Versi sebelumnya tersimpan.");
  }
  function designApply() {
    if (!selected || readOnly) return;
    const updates: Record<string, string> = {};
    const original = project.files["src/App.tsx"] || "";
    if (
      designText !== selected.text &&
      selected.text &&
      original.includes(selected.text)
    ) {
      const escaped = designText
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\{/g, "&#123;")
        .replace(/\}/g, "&#125;");
      updates["src/App.tsx"] = original.replace(selected.text, escaped);
    }
    updates["src/styles.css"] =
      (project.files["src/styles.css"] || "") +
      `\n/* Visual edit: ${selected.selector} */\n${selected.selector.replace(/[{}<>]/g, "")} { color: ${designColor}; font-size: ${Math.max(8, Math.min(120, Number(designSize) || 20))}px; padding: ${Math.max(0, Math.min(150, Number(designSpacing) || 0))}px; }\n`;
    store.applyFiles(id, updates, "Visual edit " + selected.selector);
    setChanged(Object.keys(updates));
    record("Visual edit: " + selected.selector);
    store.notify(
      "Style ditulis ke kode. Perubahan dapat dipulihkan di riwayat.",
    );
  }
  async function exportZip() {
    const { default: JSZip } = await import("jszip");
    const zip = new JSZip();
    Object.entries(project.files).forEach(([p, c]) => zip.file(p, c));
    zip.file(
      "README.md",
      "# " +
        project.name +
        "\n\nDiekspor dari PiwuApp.\n\nUntuk menjalankan: npm install, lalu npx vite --host.\n",
    );
    const pkg = JSON.parse(project.files["package.json"] || "{}");
    zip.file(
      "package.json",
      JSON.stringify(
        {
          ...pkg,
          scripts: { dev: "vite", build: "vite build" },
          devDependencies: { vite: "^6.0.0", typescript: "^5.7.0" },
          dependencies: {
            ...pkg.dependencies,
            react: "^19.0.0",
            "react-dom": "^19.0.0",
          },
        },
        null,
        2,
      ),
    );
    const blob = await zip.generateAsync({ type: "blob" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = project.name.toLowerCase().replace(/[^a-z0-9]/g, "-") + ".zip";
    a.click();
    URL.revokeObjectURL(a.href);
    store.notify("Kode project berhasil diekspor.");
  }
  function scan() {
    const findings: { title: string; file: string; level: string }[] = [];
    Object.entries(project.files).forEach(([path, c]) => {
      if (/sk-[a-zA-Z0-9]{20,}|-----BEGIN.*PRIVATE KEY-----/.test(c))
        findings.push({
          title: "Kemungkinan kredensial tertanam. Hapus dan rotasi key.",
          file: path,
          level: "Tinggi",
        });
      if (/dangerouslySetInnerHTML|innerHTML\s*=|eval\s*\(/.test(c))
        findings.push({
          title: "Eksekusi atau injeksi HTML dinamis perlu ditinjau.",
          file: path,
          level: "Tinjau",
        });
      if (/<img(?![^>]*\balt=)[^>]*>/g.test(c))
        findings.push({
          title: "Gambar belum memiliki teks alternatif.",
          file: path,
          level: "Aksesibilitas",
        });
      if (path === "index.html" && !c.includes('name="description"'))
        findings.push({
          title: "Tambahkan meta description untuk SEO.",
          file: path,
          level: "SEO",
        });
    });
    setScans(findings);
  }
  const latestUser = project.messages
    .filter((m) => m.role === "user")
    .at(-1)?.content;
  return (
    <div
      className={"workspace " + (focus ? "is-focused" : "")}
      data-theme={theme}
      data-project-kind={kind}
      style={
        {
          "--explorer-width": leftWidth + "px",
          "--chat-width": rightWidth + "px",
        } as React.CSSProperties
      }
    >
      <header className="ws-topbar">
        <div className="ws-project-nav">
          <Link
            to="/projects"
            className="ws-back"
            aria-label="Kembali ke dashboard"
          >
            <ArrowLeft size={16} />
          </Link>
          <Logo small light={theme === "dark"} />
          <span className="ws-top-divider" />
          <div className="ws-project-dropdown">
            <button onClick={() => setProjectMenu(!projectMenu)}>
              <span>{project.name}</span>
              <ChevronDown size={12} />
            </button>
            {projectMenu && (
              <div className="ws-dropdown">
                <button
                  onClick={() => {
                    setDialog("rename");
                    setProjectMenu(false);
                  }}
                >
                  <Pencil size={14} />
                  Ganti nama
                </button>
                <button
                  onClick={() => {
                    navigate("/project/" + store.duplicateProject(id));
                    setProjectMenu(false);
                  }}
                >
                  <Copy size={14} />
                  Duplikasi project
                </button>
                <button
                  onClick={() => {
                    setChatTab("Riwayat");
                    setRight(true);
                    setProjectMenu(false);
                  }}
                >
                  <History size={14} />
                  Riwayat versi
                </button>
                <button
                  onClick={() => {
                    void exportZip();
                    setProjectMenu(false);
                  }}
                >
                  <Download size={14} />
                  Export ZIP
                </button>
                <button
                  className="danger"
                  onClick={() => {
                    setDialog("delete");
                    setProjectMenu(false);
                  }}
                >
                  <Trash2 size={14} />
                  Hapus project
                </button>
              </div>
            )}
          </div>
          <StorageStatus projectId={id} dark={theme === "dark"} />
        </div>
        <button
          className="ws-command-center"
          onClick={() => setDialog("commands")}
          aria-label="Cari perintah atau file"
          title="Cari perintah atau file (Ctrl / ⌘ + K)"
        >
          <Search size={13} />
          <span>Cari file atau jalankan perintah…</span>
          <kbd>Ctrl K</kbd>
        </button>
        <div className="ws-top-actions">
          <NotificationBell dark={theme === "dark"} />
          <button
            className="ws-theme-toggle"
            aria-label={
              theme === "dark" ? "Aktifkan mode terang" : "Aktifkan mode gelap"
            }
            title={theme === "dark" ? "Mode terang" : "Mode gelap"}
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          >
            {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
            <span>{theme === "dark" ? "Terang" : "Gelap"}</span>
          </button>
          <button
            className="ws-icon focus-button"
            title="Mode fokus (Ctrl+.)"
            aria-label="Mode fokus"
            onClick={() => setFocus(!focus)}
          >
            <Maximize size={15} />
          </button>
          <button
            className="ws-icon"
            aria-label="Tampilkan atau sembunyikan panel asisten"
            aria-pressed={right}
            title="Panel asisten"
            onClick={() => setRight(!right)}
          >
            <PanelRight size={16} />
          </button>
          <button
            className="ws-button invite-button"
            onClick={() => setDialog("invite")}
          >
            <Plus size={13} />
            Invite
          </button>
          <button
            className="ws-button export-button"
            onClick={() => setDialog("export")}
          >
            <Download size={13} />
            Export ZIP
          </button>
        </div>
      </header>
      <div className="ws-body">
        {!focus && (
          <nav className="icon-rail" aria-label="Alat workspace">
            <button
              className={view === "Canvas" ? "active" : ""}
              aria-label={
                kind === "roblox" ? "Buka canvas map Roblox" : "Buka canvas"
              }
              title={
                kind === "roblox" ? "Canvas map Roblox" : "Canvas responsif"
              }
              onClick={() => {
                setView("Canvas");
                setRail("files");
              }}
            >
              <PanelsTopLeft size={21} />
            </button>
            {icons.map(({ id: iconId, icon: Icon, label }) => (
              <button
                key={iconId}
                className={
                  rail === iconId && left && view !== "Canvas" ? "active" : ""
                }
                title={label}
                aria-label={label}
                onClick={() => {
                  if (
                    ["integrations", "github", "packages", "security"].includes(
                      iconId,
                    )
                  ) {
                    setDialog(iconId);
                    if (iconId === "security") scan();
                  } else {
                    setRail(iconId);
                    setLeft(rail === iconId ? !left : true);
                    if (iconId === "database") setView("Preview");
                  }
                }}
              >
                <Icon size={19} />
                {iconId === "files" && changed.length > 0 && <i />}
              </button>
            ))}
            <div className="rail-bottom">
              <button
                title="Pengaturan"
                aria-label="Pengaturan"
                onClick={() => setDialog("settings")}
              >
                <Settings size={18} />
              </button>
              <button
                className="upgrade-icon"
                title="Paket & kredit"
                aria-label="Paket dan kredit"
                onClick={() => setDialog("credits")}
              >
                <CreditCard size={18} />
              </button>
            </div>
          </nav>
        )}
        {!focus && left && rail !== "database" && (
          <>
            <aside className="ws-explorer">
              {rail === "search" ? (
                <>
                  <div className="ws-panel-heading">
                    <span>PENCARIAN GLOBAL</span>
                    <Search size={13} />
                  </div>
                  <div className="global-search-input">
                    <Search size={13} />
                    <input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Cari dalam file…"
                      autoFocus
                    />
                  </div>
                  <div className="global-search-input">
                    <input
                      value={replace}
                      onChange={(e) => setReplace(e.target.value)}
                      placeholder="Ganti dengan…"
                    />
                    <button
                      className="ws-icon"
                      title="Ganti semua"
                      aria-label="Ganti semua"
                      disabled={!query}
                      onClick={() => {
                        if (!query) return;
                        const updates = Object.fromEntries(
                          Object.entries(project.files)
                            .filter(([, s]) => s.includes(query))
                            .map(([p, s]) => [p, s.replaceAll(query, replace)]),
                        );
                        store.applyFiles(id, updates, "Ganti semua");
                        store.notify("Perubahan disimpan sebagai versi.");
                      }}
                    >
                      <RefreshCw size={13} />
                    </button>
                  </div>
                  <span className="search-count">
                    {searchResults.length} hasil
                  </span>
                  {searchResults.map((r, i) => (
                    <button
                      className="search-result"
                      key={i}
                      onClick={() => openFile(r.path, r.line)}
                    >
                      <span>
                        <FileIcon path={r.path} />
                        {r.path.split("/").pop()}:{r.line}
                      </span>
                      <small>{r.text}</small>
                    </button>
                  ))}
                  {query && !searchResults.length && (
                    <p className="ws-empty-text">Tidak ada hasil ditemukan.</p>
                  )}
                </>
              ) : (
                <FileExplorer
                  files={project.files}
                  active={activeFile}
                  onOpen={openFile}
                  changed={changed}
                  readOnly={readOnly}
                  onCreate={(p) => {
                    if (
                      p.includes("..") ||
                      p.startsWith("/") ||
                      p.startsWith(".env")
                    )
                      return store.notify(
                        "Path tidak valid. Jangan menyimpan secret di file frontend.",
                      );
                    if (project.files[p] !== undefined)
                      return store.notify("File sudah ada.");
                    store.applyFiles(id, { [p]: "" }, "File baru");
                    openFile(p);
                  }}
                  onRename={(p, n) => {
                    if (
                      n.includes("..") ||
                      n.startsWith("/") ||
                      project.files[n] !== undefined
                    )
                      return store.notify(
                        "Nama tidak valid atau sudah dipakai.",
                      );
                    const files = { ...project.files };
                    files[n] = files[p];
                    delete files[p];
                    store.applyFiles(id, {}, "Ganti nama file");
                    store.updateProject(id, { files });
                    setOpened((o) => o.map((x) => (x === p ? n : x)));
                    setActiveFile(n);
                  }}
                  onDelete={(p) => {
                    store.applyFiles(id, {}, "Hapus " + p);
                    const files = { ...project.files };
                    delete files[p];
                    store.updateProject(id, { files });
                    setOpened((o) => o.filter((x) => x !== p));
                    if (activeFile === p)
                      setActiveFile(Object.keys(files)[0] || "");
                  }}
                />
              )}
            </aside>
            <div
              className="panel-resize"
              onMouseDown={(e) => resize(e, "left")}
            />
          </>
        )}
        <main className="ws-center">
          <div className="canvas-panel">
            <div className="ws-workbench-tabs">
              {" "}
              <div
                className="ws-view-switch"
                role="group"
                aria-label="Tampilan editor"
              >
                {[
                  { name: "Code", icon: Code2 },
                  { name: "Preview", icon: Eye },
                  { name: "Canvas", icon: PanelsTopLeft },
                  { name: "Design", icon: Palette },
                ]
                  .filter(
                    (t) =>
                      kind === "webapp" ||
                      ["Code", "Preview"].includes(t.name) ||
                      (kind === "roblox" && t.name === "Canvas"),
                  )
                  .map(({ name, icon: Icon }) => (
                    <button
                      className={view === name ? "active" : ""}
                      aria-pressed={view === name && rail !== "database"}
                      key={name}
                      onClick={() => {
                        setView(name as typeof view);
                        setRail("files");
                        setReviewPath("");
                        if (name === "Design") setSelect(true);
                      }}
                    >
                      <Icon size={13} />
                      {name === "Preview" && kind === "roblox"
                        ? "3D Builder"
                        : name === "Preview" && kind === "mobile"
                          ? "Expo"
                          : name === "Canvas" && kind === "roblox"
                            ? "Canvas Map"
                            : name}
                    </button>
                  ))}
              </div>
              <div className="ws-layout-actions">
                <button
                  className="ws-icon"
                  aria-label={
                    left ? "Sembunyikan explorer" : "Tampilkan explorer"
                  }
                  aria-pressed={left}
                  title="Explorer · Ctrl+B"
                  onClick={() => setLeft(!left)}
                >
                  <PanelLeft size={15} />
                </button>
                <button
                  className="ws-icon"
                  title="Panel bawah · Ctrl+J"
                  aria-label="Tampilkan atau sembunyikan panel bawah"
                  aria-pressed={!!bottom}
                  onClick={() => setBottom(bottom ? "" : "Terminal")}
                >
                  <PanelBottom size={15} />
                </button>
              </div>
            </div>
            {readOnly && (
              <div className="workspace-cloud-readonly">
                <ShieldCheck size={13} />
                Akses Viewer · Preview dan export tersedia. Editing memerlukan
                akses Editor.
              </div>
            )}
            {kind === "webapp" &&
              rail !== "database" &&
              (view === "Preview" || view === "Design") && (
                <div className="canvas-toolbar">
                  <div>
                    <button
                      className="ws-icon"
                      aria-label="Muat ulang preview"
                      onClick={() => {
                        setRefresh((r) => r + 1);
                        setLogs((l) => [...l, "Preview dimuat ulang."]);
                      }}
                    >
                      <RotateCw size={13} />
                    </button>
                    <button
                      className="ws-icon run-icon"
                      aria-label="Jalankan preview"
                      onClick={() => {
                        setRefresh((r) => r + 1);
                        setView("Preview");
                        setRail("files");
                      }}
                    >
                      <Play size={12} />
                    </button>
                    <div className="canvas-url">
                      <span className="url-dot" />{" "}
                      {project.name.toLowerCase().replace(/[^a-z0-9]/g, "-")}
                      .local <span>/</span>
                    </div>
                  </div>
                  <div>
                    <select
                      className="zoom-select"
                      value={zoom}
                      onChange={(e) => setZoom(e.target.value)}
                      aria-label="Zoom preview"
                    >
                      <option>100</option>
                      <option>88</option>
                      <option>75</option>
                      <option>50</option>
                    </select>
                    <span className="zoom-percent">%</span>
                    <span className="toolbar-divider" />
                    <div className="device-switch">
                      {[
                        { id: "desktop", icon: Monitor, label: "Desktop" },
                        { id: "tablet", icon: Tablet, label: "Tablet" },
                        { id: "mobile", icon: Smartphone, label: "Mobile" },
                      ].map(({ id, icon: Icon, label }) => (
                        <button
                          className={
                            "ws-icon " + (device === id ? "active" : "")
                          }
                          key={id}
                          aria-label={"Preview " + label}
                          title={label}
                          onClick={() => setDevice(id)}
                        >
                          <Icon size={14} />
                        </button>
                      ))}
                    </div>
                    <button
                      className={
                        "ws-icon multi-button " + (multi ? "active" : "")
                      }
                      title="Preview berdampingan"
                      aria-label="Preview berdampingan"
                      onClick={() => setMulti(!multi)}
                    >
                      <Columns2 size={13} />
                    </button>
                    <button
                      className="ws-icon"
                      title="Fullscreen"
                      aria-label="Fullscreen canvas"
                      onClick={() => {
                        if (document.fullscreenElement)
                          document.exitFullscreen();
                        else
                          document
                            .querySelector(".canvas-panel")
                            ?.requestFullscreen()
                            .catch(() =>
                              store.notify(
                                "Fullscreen tidak didukung browser ini.",
                              ),
                            );
                      }}
                    >
                      <Maximize size={13} />
                    </button>
                  </div>
                </div>
              )}
            {review && (
              <div className="review-banner">
                <div>
                  <ShieldCheck size={15} />
                  <span>
                    Tinjau {Object.keys(review).length} perubahan file sebelum
                    diterapkan.
                  </span>
                </div>
                <div>
                  {kind === "roblox" && review[SCENE_PATH] && (
                    <>
                      <button
                        onClick={() => {
                          setView("Preview");
                          setRail("files");
                        }}
                      >
                        Preview hasil
                      </button>
                      <button
                        onClick={() => {
                          setView("Code");
                          setReviewPath(SCENE_PATH);
                        }}
                      >
                        Lihat diff scene
                      </button>
                    </>
                  )}
                  <button
                    onClick={() => {
                      setReview(null);
                      setReviewPath("");
                    }}
                  >
                    Tolak
                  </button>
                  <button
                    onClick={() =>
                      applyReview([
                        kind === "roblox" &&
                        view !== "Code" &&
                        review[SCENE_PATH]
                          ? SCENE_PATH
                          : reviewPath && reviewPath in review
                            ? reviewPath
                            : Object.keys(review)[0],
                      ])
                    }
                  >
                    Terima file
                  </button>
                  <button className="accept-all" onClick={() => applyReview()}>
                    Terima semua <Check size={12} />
                  </button>
                </div>
              </div>
            )}
            {rail === "database" ? (
              <Suspense
                fallback={
                  <div className="ws-loading">Memuat editor tabel…</div>
                }
              >
                <DatabasePanel projectId={id} />
              </Suspense>
            ) : kind === "roblox" && view !== "Code" ? (
              <Suspense
                fallback={
                  <div className="ws-loading">Memuat Roblox Builder…</div>
                }
              >
                <RobloxBuilder
                  key={robloxPreviewRevision}
                  project={
                    review?.[SCENE_PATH]
                      ? {
                          ...project,
                          files: {
                            ...project.files,
                            [SCENE_PATH]: review[SCENE_PATH],
                          },
                        }
                      : project
                  }
                  draft={!!review?.[SCENE_PATH]}
                  mode={view === "Canvas" ? "map" : "3d"}
                  onModeChange={(mode) =>
                    setView(mode === "map" ? "Canvas" : "Preview")
                  }
                  readOnly={readOnly || !!review?.[SCENE_PATH]}
                  onOpenFile={openFile}
                />
              </Suspense>
            ) : kind === "mobile" && view !== "Code" ? (
              <section className="native-preview">
                <h2>Aplikasi native · Expo</h2>
                <p>
                  Project ini memakai React Native, bukan halaman web. Preview
                  iOS/Android memerlukan Expo Go atau development build di
                  perangkat Anda; tidak disimulasikan melalui iframe.
                </p>
                <pre>npm install{"\n"}npx expo start</pre>
                <p>
                  Unduh kode ZIP dari menu project, ekstrak, lalu jalankan
                  perintah di atas di komputer Anda. Gunakan Expo Go yang
                  mendukung SDK project. Simulator iOS memerlukan macOS/Xcode.
                  Build APK/IPA dan signing belum otomatis.
                </p>
                <button className="ws-button" onClick={() => void exportZip()}>
                  Unduh project Expo ZIP
                </button>
                <button
                  className="ws-button"
                  onClick={() => openFile("App.tsx")}
                >
                  Buka App.tsx
                </button>
                <h3>Backend data</h3>
                <p>
                  <code>lib/piwu.ts</code> menghubungkan aplikasi ke tabel
                  project lewat API data (migration 016). Isi <code>.env</code>{" "}
                  dari <code>env.example</code>: URL PiwuApp, ID project, dan
                  kunci dari panel Database → API data.
                </p>
                <pre>
                  {
                    "EXPO_PUBLIC_PIWU_API_URL=https://app.contoh.test\nEXPO_PUBLIC_PIWU_PROJECT_ID=<uuid project>\nEXPO_PUBLIC_PIWU_KEY=piwu_sk_<kunci baca>"
                  }
                </pre>
                <p>
                  Kunci <code>EXPO_PUBLIC_*</code> tertanam di bundle APK/IPA
                  dan dapat dibaca siapa pun. Pakai kunci <b>baca saja</b>;
                  operasi tulis harus lewat server Anda sendiri yang menyimpan
                  kunci tulis. Aplikasi ini tidak punya login pengguna akhir.
                </p>
                <button
                  className="ws-button"
                  onClick={() => openFile("lib/piwu.ts")}
                >
                  Buka lib/piwu.ts
                </button>
              </section>
            ) : view === "Canvas" ? (
              <Suspense
                fallback={
                  <div className="ws-loading">
                    <LoaderCircle className="spin" size={18} />
                    Memuat canvas…
                  </div>
                }
              >
                <CanvasPanel
                  key={scopeFor(store.user) + ":" + id}
                  scope={scopeFor(store.user)}
                  projectId={id}
                  html={preview.html}
                  error={preview.error}
                  onCode={() => openFile(activeFile || "src/App.tsx")}
                  onDesign={(kind) => {
                    setDevice(kind);
                    setView("Design");
                    setSelect(true);
                    setRight(true);
                  }}
                />
              </Suspense>
            ) : view === "Code" ? (
              <>
                <div className="code-tabs">
                  {(review
                    ? Object.keys(review)
                    : opened.filter((p) => project.files[p] !== undefined)
                  ).map((path) => (
                    <div
                      key={path}
                      className={
                        "code-tab " +
                        ((review ? reviewPath === path : activeFile === path)
                          ? "active"
                          : "")
                      }
                    >
                      <button
                        onClick={() =>
                          review
                            ? setReviewPath(path)
                            : (setActiveFile(path), setLine(undefined))
                        }
                        aria-pressed={
                          review ? reviewPath === path : activeFile === path
                        }
                      >
                        <FileIcon path={path} />
                        {path.split("/").pop()}
                        {changed.includes(path) && (
                          <i className="changed-dot" />
                        )}
                      </button>
                      {!review && (
                        <button
                          className="code-tab-close"
                          aria-label={"Tutup " + path}
                          onClick={() => {
                            setOpened((o) => o.filter((p) => p !== path));
                            if (activeFile === path)
                              setActiveFile(
                                opened.find((p) => p !== path) || "",
                              );
                          }}
                        >
                          <X size={13} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                <div className="code-breadcrumb">
                  {(reviewPath || activeFile).replaceAll("/", " › ")}
                  <span>
                    {review
                      ? "Diff · Tinjau risiko sebelum menerima"
                      : "Kode · Tersimpan otomatis"}
                  </span>
                </div>
                <div className="code-editor-wrap">
                  <Suspense
                    fallback={
                      <div className="ws-loading">
                        <LoaderCircle className="spin" size={20} />
                        Memuat Monaco Editor…
                      </div>
                    }
                  >
                    {reviewPath || activeFile ? (
                      <CodeEditor
                        apiRef={editorApi}
                        key={(reviewPath || activeFile) + ":" + line}
                        path={reviewPath || activeFile}
                        content={
                          review && reviewPath
                            ? review[reviewPath]
                            : project.files[activeFile] || ""
                        }
                        original={
                          review && reviewPath
                            ? project.files[reviewPath] || ""
                            : undefined
                        }
                        line={line}
                        readOnly={readOnly}
                        peers={editorPeers}
                        onCursorChange={setCursor}
                        onChange={(s) => store.writeFile(id, activeFile, s)}
                      />
                    ) : (
                      <div className="ws-empty-text">
                        Buka file dari explorer.
                      </div>
                    )}
                  </Suspense>
                </div>
              </>
            ) : (
              <>
                <div className="preview-subbar">
                  <button
                    className={
                      "select-element " +
                      (select || view === "Design" ? "active" : "")
                    }
                    onClick={() => setSelect(!select)}
                  >
                    <MousePointer2 size={12} />
                    {select || view === "Design"
                      ? "Klik elemen di canvas"
                      : "Pilih elemen"}
                  </button>
                  <span>
                    <i />
                    Preview langsung
                    <span className="preview-local"> · sandbox lokal</span>
                  </span>
                  {selected && (
                    <button
                      className="selection-badge"
                      onClick={() => setSelected(null)}
                    >
                      {selected.selector}
                      <X size={10} />
                    </button>
                  )}
                  <button
                    className="ws-icon"
                    aria-label="Komentari elemen"
                    title="Komentari elemen terpilih"
                    onClick={() =>
                      selected
                        ? setDialog("comments")
                        : (setSelect(true),
                          store.notify(
                            "Pilih elemen di canvas terlebih dahulu.",
                          ))
                    }
                  >
                    <MessageSquare size={13} />
                  </button>
                </div>
                <div className={"preview-stage " + (multi ? "multi" : "")}>
                  <div
                    className={"preview-device " + device}
                    style={{
                      width:
                        device === "mobile"
                          ? "375px"
                          : device === "tablet"
                            ? "768px"
                            : "100%",
                      zoom: Number(zoom) / 100,
                    }}
                  >
                    {error || preview.error ? (
                      <div className="build-error">
                        <AlertTriangle size={30} />
                        <h3>Preview perlu diperbaiki.</h3>
                        <pre>{error || preview.error}</pre>
                        <button
                          className="ws-button primary"
                          disabled={busy}
                          onClick={() =>
                            send(
                              "Perbaiki error build ini: " +
                                (error || preview.error),
                            )
                          }
                        >
                          <Wrench size={13} />
                          Minta perbaikan
                        </button>
                        <button
                          className="ws-button"
                          onClick={() => setView("Code")}
                        >
                          Buka kode
                        </button>
                      </div>
                    ) : (
                      <iframe
                        key={refresh}
                        ref={previewRef}
                        title="Live preview aplikasi Anda"
                        srcDoc={preview.html}
                        sandbox="allow-scripts"
                      />
                    )}
                  </div>
                  {multi && (
                    <div className="preview-device mobile">
                      <iframe
                        title="Preview mobile"
                        sandbox="allow-scripts"
                        srcDoc={preview.html}
                      />
                      <span className="device-label">Mobile · 375 px</span>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
          {bottom && (
            <div className="bottom-panel">
              <div className="bottom-tabs">
                {[
                  { id: "Terminal", icon: TerminalIcon },
                  { id: "Console", icon: Code2 },
                  { id: "Inspector", icon: Search },
                ].map(({ id: tab, icon: Icon }) => (
                  <button
                    className={bottom === tab ? "active" : ""}
                    key={tab}
                    onClick={() => setBottom(tab)}
                  >
                    <Icon size={12} />
                    {tab === "Console" ? "Konsol" : tab}
                  </button>
                ))}
                <button
                  className="ws-icon"
                  aria-label="Tutup panel bawah"
                  onClick={() => setBottom("")}
                >
                  <X size={13} />
                </button>
              </div>
              <div className="bottom-panel-content">
                <Suspense
                  fallback={<div className="ws-loading">Memuat panel…</div>}
                >
                  {bottom === "Terminal" ? (
                    <TerminalPanel projectId={id} files={project.files} />
                  ) : bottom === "Inspector" ? (
                    <InspectorPanel selected={selected} />
                  ) : (
                    <div className="console-lines">
                      {logs.map((l, i) => (
                        <div key={i}>
                          <span>›</span>
                          {l}
                        </div>
                      ))}
                      {(error || preview.error) && (
                        <div className="danger">{error || preview.error}</div>
                      )}
                    </div>
                  )}
                </Suspense>
              </div>
            </div>
          )}
        </main>
        {!focus && right && (
          <>
            <div
              className="panel-resize"
              onMouseDown={(e) => resize(e, "right")}
            />
            <aside className="ws-chat">
              <div className="chat-heading">
                <span>Asisten Piwu</span>
                <div>
                  <button
                    className="ws-icon"
                    title="Sembunyikan chat"
                    aria-label="Sembunyikan chat"
                    onClick={() => setRight(false)}
                  >
                    <PanelRightClose size={14} />
                  </button>
                </div>
              </div>
              {view === "Design" && selected ? (
                <div className="design-panel">
                  <div className="design-heading">
                    <Palette size={16} />
                    <h3>Properti elemen</h3>
                  </div>
                  <code>{selected.selector}</code>
                  <small>src/App.tsx · src/styles.css</small>
                  <label>
                    Teks
                    <textarea
                      value={designText}
                      onChange={(e) => setDesignText(e.target.value)}
                      rows={4}
                    />
                  </label>
                  <label>
                    Warna teks
                    <div className="color-input">
                      <input
                        type="color"
                        value={designColor}
                        onChange={(e) => setDesignColor(e.target.value)}
                      />
                      <span>{designColor}</span>
                    </div>
                  </label>
                  <div className="design-grid">
                    <label>
                      Ukuran font (px)
                      <input
                        type="number"
                        min={8}
                        max={120}
                        value={designSize}
                        onChange={(e) => setDesignSize(e.target.value)}
                      />
                    </label>
                    <label>
                      Padding (px)
                      <input
                        type="number"
                        min={0}
                        max={150}
                        value={designSpacing}
                        onChange={(e) => setDesignSpacing(e.target.value)}
                      />
                    </label>
                  </div>
                  <button
                    className="ws-button primary full-width"
                    onClick={designApply}
                    disabled={readOnly}
                  >
                    <Check size={13} />
                    Terapkan ke kode
                  </button>
                  <p>
                    Teks hanya diganti jika cocok langsung dengan kode sumber.
                    Semua perubahan visual membuat snapshot yang bisa
                    dipulihkan.
                  </p>
                  <button
                    className="ws-button full-width"
                    onClick={() => {
                      setView("Preview");
                      setInput("Ubah elemen ini menjadi ");
                      inputRef.current?.focus();
                    }}
                  >
                    <MessageSquare size={13} />
                    Ubah lewat percakapan
                  </button>
                </div>
              ) : (
                <>
                  <div className="chat-tabs">
                    {["Chat", "Rencana", "Riwayat"].map((t) => (
                      <button
                        key={t}
                        className={chatTab === t ? "active" : ""}
                        onClick={() => setChatTab(t)}
                      >
                        {t === "Chat" ? (
                          <MessageSquare size={12} />
                        ) : t === "Rencana" ? (
                          <ListChecks size={12} />
                        ) : (
                          <History size={12} />
                        )}{" "}
                        {t}
                      </button>
                    ))}
                  </div>
                  <div className="provider-label">
                    <i />
                    {initializing
                      ? "Memeriksa koneksi…"
                      : provider !== "configured"
                        ? "AI belum tersedia"
                        : providerVerified
                          ? "AI · respons API diterima"
                          : "AI dikonfigurasi · belum diverifikasi"}
                    <button
                      aria-label="Pengaturan provider AI"
                      onClick={() => setDialog("settings")}
                    >
                      <Settings size={10} />
                    </button>
                  </div>
                  <div className="chat-content">
                    {chatTab === "Rencana" ? (
                      <PlanPanel
                        plan={project.plan}
                        onChange={(p) => store.updateProject(id, { plan: p })}
                        busy={busy || readOnly}
                        onApprove={() => {
                          if (project.plan) {
                            store.updateProject(id, {
                              plan: { ...project.plan, approved: true },
                            });
                            setMode("Builder");
                            void send(
                              "Bangun rencana berikut: " +
                                project.plan.goal +
                                "\n" +
                                project.plan.tasks
                                  .map(
                                    (t) =>
                                      t.text +
                                      (t.comment ? " — " + t.comment : ""),
                                  )
                                  .join("\n"),
                              "Builder",
                            );
                          }
                        }}
                      />
                    ) : chatTab === "Riwayat" ? (
                      <div className="versions-panel">
                        <div className="version-intro">
                          <History size={18} />
                          <h3>Tidak ada ide yang hilang.</h3>
                          <p>
                            Pulihkan snapshot sebelumnya. File saat ini akan
                            dicadangkan sebelum pemulihan.
                          </p>
                        </div>
                        {[...project.versions].reverse().map((v, i) => (
                          <div className="version-card" key={v.id}>
                            <span className="version-dot" />
                            <div>
                              <b>{v.label}</b>
                              <small>
                                {new Date(v.at).toLocaleString("id-ID", {
                                  day: "numeric",
                                  month: "short",
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}{" "}
                                · {Object.keys(v.files).length} file
                              </small>
                              <div>
                                <button
                                  onClick={() => {
                                    setReview(v.files);
                                    setReviewPath(Object.keys(v.files)[0]);
                                    setView("Code");
                                  }}
                                >
                                  Bandingkan
                                </button>
                                <button
                                  disabled={readOnly}
                                  onClick={() => {
                                    store.restoreVersion(id, v.id);
                                    setView("Preview");
                                    store.notify("Versi berhasil dipulihkan.");
                                    record("Pulihkan versi: " + v.label);
                                  }}
                                >
                                  <Undo2 size={10} />
                                  Pulihkan
                                </button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <>
                        {project.messages.length === 0 && (
                          <div className="chat-welcome">
                            <h2>Belum ada percakapan.</h2>
                            <p>
                              Tulis kebutuhan Anda di bawah. PiwuApp menyusun
                              perubahan sebagai tinjauan file sebelum
                              diterapkan.
                            </p>
                            <div className="welcome-memory">
                              <FileText size={15} />
                              <div>
                                <b>PIWU.md</b>
                                <span>Memori & konvensi project</span>
                              </div>
                              <Check size={13} />
                            </div>
                            <span className="welcome-note">
                              Mulai dengan pesan, atau jelajahi template Anda di
                              sebelah kiri.
                            </span>
                          </div>
                        )}
                        {project.messages.map((m) => (
                          <div className={"chat-message " + m.role} key={m.id}>
                            {m.role === "assistant" ? (
                              <div className="message-author">
                                <span
                                  className="assistant-mark"
                                  aria-hidden="true"
                                >
                                  P
                                </span>
                                PiwuApp{" "}
                                {m.model && m.model !== "AI" && (
                                  <small title="Model yang menjawab">
                                    {m.model}
                                  </small>
                                )}
                              </div>
                            ) : (
                              <div className="message-author">
                                <span className="user-message-avatar">
                                  {store.user?.name?.[0] || "P"}
                                </span>
                                Anda <small>{m.mode}</small>
                              </div>
                            )}
                            <p>{m.content}</p>
                            {m.summary && (
                              <div className="summary-block">
                                <button
                                  onClick={() =>
                                    setSummaryOpen(
                                      summaryOpen === m.id ? "" : m.id,
                                    )
                                  }
                                >
                                  {summaryOpen === m.id ? (
                                    <ChevronDown size={11} />
                                  ) : (
                                    <ChevronRight size={11} />
                                  )}
                                  Ringkasan pendekatan{" "}
                                  <span>{m.summary.length} langkah</span>
                                </button>
                                {summaryOpen === m.id && (
                                  <ul>
                                    {m.summary.map((s) => (
                                      <li key={s}>{s}</li>
                                    ))}
                                  </ul>
                                )}
                              </div>
                            )}
                            {m.files && (
                              <div className="ai-file-list">
                                <span>
                                  <CheckCheck size={12} />
                                  Perubahan · {m.files.length} file
                                </span>
                                {m.files.map((f) => (
                                  <button key={f} onClick={() => openFile(f)}>
                                    <FileIcon path={f} />
                                    {f}
                                    <Check size={11} />
                                  </button>
                                ))}
                              </div>
                            )}
                            {m.ops && (
                              <div className="ai-ops-list">
                                <span
                                  className={
                                    m.ops.rejected.length
                                      ? "ops-headline warn"
                                      : "ops-headline"
                                  }
                                >
                                  <ListChecks size={12} />
                                  {m.ops.sceneChanged
                                    ? `Scene diperbarui · ${m.ops.applied.length} operasi`
                                    : m.ops.rejected.length
                                      ? `Tidak ada perubahan scene · ${m.ops.rejected.length} operasi ditolak`
                                      : "Tanpa perubahan scene"}
                                </span>
                                {m.ops.applied.map((op, i) => (
                                  <div
                                    className="ops-applied"
                                    key={"applied" + i}
                                  >
                                    <p>
                                      <Check size={11} />
                                      <strong>{op.name || op.target}</strong>
                                      {(op.changes || []).join(" · ")}
                                    </p>
                                    {op.kind === "scene.build" && (
                                      <div className="ops-build">
                                        <small>
                                          Geometri dibuat server
                                          {op.photo
                                            ? ` dari foto ${op.photo}`
                                            : ""}
                                          {op.geometry
                                            ? ` · ${op.geometry.vertices} vertex, ${op.geometry.faces} face`
                                            : " · bagian Roblox, tanpa mesh"}
                                          {op.asMesh
                                            ? " · satu mesh gabungan, bisa diekspor OBJ dari editor"
                                            : ""}
                                        </small>
                                        {!!op.colorGroups?.length && (
                                          <p
                                            className="ops-colors"
                                            aria-label={`Warna dari piksel foto ${op.photo || 1}: ${op.colorGroups
                                              .map(
                                                (group) =>
                                                  `${group.color} untuk ${group.faces} sisi`,
                                              )
                                              .join(", ")}`}
                                          >
                                            <span aria-hidden="true">
                                              {op.colorGroups.map(
                                                (group, at) => (
                                                  <i
                                                    key={
                                                      "color" + at + group.color
                                                    }
                                                    style={{
                                                      background: group.color,
                                                    }}
                                                  />
                                                ),
                                              )}
                                            </span>
                                            {op.colorGroups.length} warna dari
                                            piksel foto {op.photo || 1}
                                          </p>
                                        )}
                                        {(op.parts?.length || 0) > 1 && (
                                          <ul>
                                            {(op.parts || []).map(
                                              (part, at) => (
                                                <li key={"part" + at}>
                                                  {part.name}
                                                  <span>
                                                    {part.kind === "mesh" &&
                                                    part.vertices
                                                      ? `mesh ${part.shape} · ${part.vertices} vertex`
                                                      : `${part.shape} → ${part.kind}`}
                                                  </span>
                                                </li>
                                              ),
                                            )}
                                          </ul>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                ))}
                                {m.ops.rejected.map((op, i) => (
                                  <p className="rejected" key={"rejected" + i}>
                                    <X size={11} />
                                    <strong>{op.target || op.kind}</strong>
                                    {op.reason}
                                  </p>
                                ))}
                                <small>{m.ops.note}</small>
                              </div>
                            )}
                            {m.role === "assistant" &&
                              (m.sources?.length || m.research) && (
                                <div className="ai-sources">
                                  <button
                                    className="sources-headline"
                                    aria-expanded={sourcesOpen === m.id}
                                    onClick={() =>
                                      setSourcesOpen(
                                        sourcesOpen === m.id ? "" : m.id,
                                      )
                                    }
                                  >
                                    {sourcesOpen === m.id ? (
                                      <ChevronDown size={11} />
                                    ) : (
                                      <ChevronRight size={11} />
                                    )}
                                    {m.sources?.length
                                      ? `Sumber · ${m.sources.length}${
                                          m.research
                                            ? ` dari ${m.research.rounds.filter((r) => r.provider).length} pencarian`
                                            : ""
                                        }`
                                      : "Sumber · tidak ada hasil"}
                                  </button>
                                  {sourcesOpen === m.id && (
                                    <>
                                      {m.research?.summary?.text && (
                                        <div className="research-summary">
                                          <strong>
                                            Ringkasan lintas halaman
                                          </strong>
                                          <span>
                                            Dibuat AI dari{" "}
                                            {m.research.summary.covers.length
                                              ? `halaman ${m.research.summary.covers
                                                  .map((n) => `[${n}]`)
                                                  .join(", ")}`
                                              : "halaman yang terbaca"}
                                            {m.research.summary.pages
                                              ? ` (${m.research.summary.pages} halaman terbaca saat itu)`
                                              : ""}{" "}
                                            — bukan kutipan dan bukan kata-kata
                                            halaman.
                                          </span>
                                          <p>{m.research.summary.text}</p>
                                          {m.research.summary.gaps && (
                                            <small>
                                              Belum diselesaikan sumber:{" "}
                                              {m.research.summary.gaps}
                                            </small>
                                          )}
                                          {m.research.summary.notice && (
                                            <small className="warn">
                                              {m.research.summary.notice}
                                            </small>
                                          )}
                                          <small>
                                            Dibuat di dalam kredit ronde riset —
                                            tidak ada kredit tambahan — dan
                                            hanya sekali per permintaan.
                                          </small>
                                        </div>
                                      )}
                                      {m.sources?.length ? (
                                        <ol>
                                          {m.sources.map((s) => (
                                            <li key={s.index}>
                                              <a
                                                href={s.url}
                                                target="_blank"
                                                rel="noreferrer noopener"
                                              >
                                                {s.title || s.url}
                                                <ExternalLink size={10} />
                                              </a>
                                              <small>
                                                {s.kind} · {s.provider}
                                                {distinctQueries(m.sources) >
                                                  1 && s.query
                                                  ? ` · kueri “${s.query}”`
                                                  : ""}
                                                {m.research?.cited.includes(
                                                  s.index,
                                                )
                                                  ? " · dikutip"
                                                  : " · tidak dikutip"}
                                              </small>
                                              {s.snippet && (
                                                <span>{s.snippet}</span>
                                              )}
                                            </li>
                                          ))}
                                        </ol>
                                      ) : null}
                                      <small>{m.research?.notice}</small>
                                      {m.research?.rounds.some(
                                        (r) => r.error,
                                      ) && (
                                        <ul className="sources-failed">
                                          {m.research.rounds
                                            .filter((r) => r.error)
                                            .map((r) => (
                                              <li key={r.query}>
                                                Kueri “{r.query}” gagal:{" "}
                                                {r.error}
                                              </li>
                                            ))}
                                        </ul>
                                      )}
                                      {!!m.research?.invalid.length && (
                                        <small className="warn">
                                          Nomor sumber yang tidak pernah
                                          dikembalikan:{" "}
                                          {m.research.invalid.join(", ")} —
                                          diabaikan, bukan dianggap sumber.
                                        </small>
                                      )}
                                      {m.research?.groundingNotice && (
                                        <small className="warn">
                                          {m.research.groundingNotice}
                                        </small>
                                      )}
                                      {!!m.research?.viaSummary?.length && (
                                        <small>
                                          Sitasi{" "}
                                          {m.research.viaSummary.join(", ")}{" "}
                                          didukung ringkasan AI, bukan kata-kata
                                          halaman sumbernya.
                                        </small>
                                      )}
                                      {!!m.research?.insufficient?.length && (
                                        <small>
                                          Sitasi yang belum bisa diperiksa:{" "}
                                          {m.research.insufficient.join(", ")} —
                                          kalimatnya terlalu pendek atau
                                          sumbernya tidak terbaca.
                                        </small>
                                      )}
                                      {m.research?.citationNotice && (
                                        <small className="warn">
                                          {m.research.citationNotice}
                                        </small>
                                      )}
                                    </>
                                  )}
                                </div>
                              )}
                            {m.role === "assistant" &&
                              (m.tools || m.notes?.length) && (
                                <div className="ai-tools">
                                  {m.tools && (
                                    <small>
                                      {m.tools.notice}
                                      {m.tools.refused.length
                                        ? ` Ditolak: ${m.tools.refused.join(", ")}.`
                                        : ""}
                                    </small>
                                  )}
                                  {!!m.notes?.length && (
                                    <ul className="sources-failed">
                                      {m.notes.map((note) => (
                                        <li key={note}>{note}</li>
                                      ))}
                                    </ul>
                                  )}
                                </div>
                              )}
                            {m.role === "assistant" && (
                              <div className="message-actions">
                                <button
                                  title="Salin jawaban"
                                  aria-label="Salin jawaban"
                                  onClick={() =>
                                    navigator.clipboard
                                      .writeText(m.content)
                                      .then(() =>
                                        store.notify("Jawaban disalin."),
                                      )
                                      .catch(() =>
                                        store.notify(
                                          "Tidak dapat mengakses clipboard.",
                                        ),
                                      )
                                  }
                                >
                                  <Copy size={12} />
                                </button>
                                <button
                                  title="Buka riwayat perubahan"
                                  aria-label="Undo melalui riwayat"
                                  onClick={() => setChatTab("Riwayat")}
                                >
                                  <Undo2 size={12} />
                                </button>
                                <button
                                  title="Coba lagi"
                                  aria-label="Coba lagi"
                                  disabled={busy || !latestUser}
                                  onClick={() => latestUser && send(latestUser)}
                                >
                                  <RotateCw size={12} />
                                </button>
                                <span>
                                  {new Date(m.at).toLocaleTimeString("id-ID", {
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  })}
                                </span>
                              </div>
                            )}
                          </div>
                        ))}
                        {busy && (
                          <div className="chat-message assistant streaming">
                            <div className="message-author">
                              <span
                                className="assistant-mark"
                                aria-hidden="true"
                              >
                                P
                              </span>
                              PiwuApp{" "}
                              <LoaderCircle className="spin" size={11} />
                            </div>
                            <p>
                              {streaming ||
                                researchStepLabel(researchStep) ||
                                "Membaca konteks project…"}
                              <span className="stream-cursor" />
                            </p>
                          </div>
                        )}
                        {aiError && (
                          <div className="ai-error">
                            <AlertTriangle size={15} />
                            <p>{aiError}</p>
                            <button
                              onClick={() => latestUser && send(latestUser)}
                              disabled={busy}
                            >
                              Coba lagi
                            </button>
                          </div>
                        )}
                        <div ref={chatEnd} />
                      </>
                    )}
                  </div>
                  <div className="chat-composer-area">
                    <div className="quick-actions">
                      {(kind === "roblox"
                        ? [
                            "Susun struktur game",
                            "Tambahkan checkpoint obby",
                            "Susun rencana",
                          ]
                        : kind === "mobile"
                          ? [
                              "Buat navigasi native",
                              "Tambahkan layar profil",
                              "Susun rencana",
                            ]
                          : [
                              "Ubah warna jadi biru",
                              "Buat responsive",
                              "Susun rencana",
                            ]
                      ).map((p) => (
                        <button
                          disabled={busy}
                          key={p}
                          onClick={() =>
                            send(p, p === "Susun rencana" ? "Plan" : undefined)
                          }
                        >
                          {p}
                          <Plus size={10} />
                        </button>
                      ))}
                    </div>
                    {selected && (
                      <div className="context-chip">
                        <MousePointer2 size={11} />
                        {selected.selector}
                        <button
                          aria-label="Hapus konteks elemen"
                          onClick={() => setSelected(null)}
                        >
                          <X size={11} />
                        </button>
                      </div>
                    )}
                    {references.map((url) => (
                      <div className="context-chip" key={url}>
                        {url}
                        <button
                          aria-label="Hapus referensi URL"
                          onClick={() => setReferences([])}
                        >
                          <X size={11} />
                        </button>
                      </div>
                    ))}
                    {attachments.some((a) => a.mime.startsWith("image/")) &&
                      kind === "roblox" &&
                      mode === "Builder" && (
                        <p className="context-hint">
                          Foto akan dibaca di server: minta “buatkan model 3D
                          dari foto ini” dan AI menyusun bentuknya dalam stud,
                          bukan menjiplak tekstur foto. Warna tiap bagian
                          diambil dari piksel foto Anda (rata-rata area, bukan
                          peta tekstur UV).
                        </p>
                      )}
                    {!!projectPhotos.length && (
                      <div className="project-photos">
                        <div className="project-photos-head">
                          <b>
                            Foto project <span>{projectPhotos.length}</span>
                          </b>
                          <small>
                            Tersimpan di browser ini untuk project ini — belum
                            ikut ke perangkat lain. Foto dipakai lagi tanpa
                            diunggah ulang.
                          </small>
                        </div>
                        <ul>
                          {projectPhotos.map((photo) => (
                            <li key={photo.id}>
                              <button
                                className="photo-thumb"
                                aria-label={`Buka foto ${photo.name}`}
                                onClick={() => void openProjectPhoto(photo)}
                              >
                                {photo.thumbnail ? (
                                  <img src={photo.thumbnail} alt="" />
                                ) : (
                                  <span aria-hidden="true">
                                    {photo.name.slice(0, 1).toUpperCase()}
                                  </span>
                                )}
                              </button>
                              <div>
                                <b>{photo.name}</b>
                                <small>
                                  {photoSize(photo.bytes)} ·{" "}
                                  {new Date(photo.at).toLocaleDateString(
                                    "id-ID",
                                  )}
                                  {photo.palette
                                    ? ` · ${photo.palette.colors.length} sel warna`
                                    : " · sampel warna tidak tersedia"}
                                </small>
                              </div>
                              <button
                                className="ws-icon"
                                aria-label={`Pakai lagi foto ${photo.name}`}
                                title="Pakai lagi sebagai lampiran"
                                onClick={() => void reuseProjectPhoto(photo)}
                              >
                                <Paperclip size={12} />
                              </button>
                              <button
                                className="ws-icon"
                                aria-label={`Hapus aset foto ${photo.name}`}
                                title="Hapus dari aset project"
                                onClick={() => void dropProjectPhoto(photo)}
                              >
                                <Trash2 size={12} />
                              </button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {!!attachments.length && (
                      <div className="context-chips">
                        {attachments.map((file, i) => (
                          <div
                            className="context-chip"
                            key={file.name + i + file.data.length}
                          >
                            <Paperclip size={11} />
                            {attachments.length > 1 && (
                              <span className="chip-photo">
                                {file.mime.startsWith("image/")
                                  ? `foto ${
                                      attachments
                                        .slice(0, i + 1)
                                        .filter((a) =>
                                          a.mime.startsWith("image/"),
                                        ).length
                                    }`
                                  : "berkas"}
                              </span>
                            )}
                            {file.name}
                            <button
                              aria-label={"Hapus lampiran " + file.name}
                              onClick={() => {
                                setAttachments((list) =>
                                  list.filter((_, at) => at !== i),
                                );
                                setPalettes((list) =>
                                  list.filter((_, at) => at !== i),
                                );
                                setThumbnails((list) =>
                                  list.filter((_, at) => at !== i),
                                );
                              }}
                            >
                              <X size={11} />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="chat-composer">
                      {input.includes("@") && (
                        <div className="mention-menu">
                          {Object.keys(project.files)
                            .filter((p) =>
                              p
                                .toLowerCase()
                                .includes(
                                  input.split("@").at(-1)!.toLowerCase(),
                                ),
                            )
                            .map((p) => (
                              <button
                                key={p}
                                onClick={() => {
                                  setInput(
                                    input.slice(0, input.lastIndexOf("@")) +
                                      "@" +
                                      p +
                                      " ",
                                  );
                                  inputRef.current?.focus();
                                }}
                              >
                                <FileIcon path={p} />
                                {p}
                              </button>
                            ))}
                        </div>
                      )}
                      <textarea
                        ref={inputRef}
                        aria-label="Pesan untuk AI"
                        placeholder="Tanya lanjutan… ketik @ untuk konteks"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            void send();
                          }
                        }}
                      />
                      <div className="composer-tools">
                        <div>
                          <button
                            className="ws-icon"
                            title="Lampirkan file"
                            aria-label="Lampirkan file"
                            onClick={() => attachmentRef.current?.click()}
                          >
                            <Plus size={16} />
                          </button>
                          <input
                            hidden
                            ref={attachmentRef}
                            type="file"
                            multiple
                            accept="image/png,image/jpeg,image/webp,.pdf,.txt"
                            onChange={async (e) => {
                              const picked = [...(e.target.files || [])];
                              e.target.value = "";
                              if (!picked.length) return;
                              if (attachments.length >= 3) {
                                store.notify(
                                  "Maksimal 3 lampiran per pesan. Hapus salah satu dulu.",
                                );
                                return;
                              }
                              try {
                                const fresh: Attachment[] = [];
                                const sampled: (PhotoPalette | null)[] = [];
                                const thumbs: (string | null)[] = [];
                                for (const file of picked.slice(
                                  0,
                                  3 - attachments.length,
                                )) {
                                  const read = await readAttachment(file);
                                  fresh.push(read);
                                  // Only photos can carry colours; a brief has
                                  // no palette slot to send. One decode yields
                                  // both the colour grid and the redraw.
                                  const sample = read.mime.startsWith("image/")
                                    ? await photoSamples(read)
                                    : { palette: null, thumbnail: null };
                                  sampled.push(sample.palette);
                                  thumbs.push(sample.thumbnail);
                                }
                                setAttachments((list) => [...list, ...fresh]);
                                setPalettes((list) => [...list, ...sampled]);
                                setThumbnails((list) => [...list, ...thumbs]);
                              } catch (error) {
                                store.notify(
                                  error instanceof Error
                                    ? error.message
                                    : "Lampiran gagal dibaca.",
                                );
                              }
                              e.target.value = "";
                            }}
                          />
                          <button
                            className="ws-icon"
                            title="Rapikan prompt"
                            aria-label="Rapikan prompt"
                            disabled={!input.trim()}
                            onClick={() =>
                              setInput(
                                input.trim() +
                                  " Gunakan desain yang konsisten, responsif, aksesibel, dan jelaskan file yang diubah.",
                              )
                            }
                          >
                            <PenLine size={13} />
                          </button>
                          <button
                            className="ws-icon"
                            title={
                              research
                                ? "Mode riset aktif: AI boleh mencari sumber lalu mengutipnya"
                                : "Mode riset: biarkan AI mencari dan mengutip sumber"
                            }
                            aria-label="Mode riset"
                            aria-pressed={research}
                            onClick={() => {
                              setResearch((on) => !on);
                              store.notify(
                                research
                                  ? "Mode riset dimatikan."
                                  : "Mode riset aktif. AI boleh mencari sumber; 1 kredit per ronde.",
                              );
                            }}
                          >
                            <Globe2 size={13} />
                          </button>
                          <button
                            className="ws-icon"
                            title="Simpan prompt"
                            aria-label="Simpan prompt"
                            disabled={!input.trim()}
                            onClick={() => {
                              store.savePrompt({
                                title: input.slice(0, 40),
                                content: input,
                                tags: mode,
                              });
                              store.notify("Tersimpan di Prompt saya.");
                            }}
                          >
                            <Bookmark size={12} />
                          </button>
                        </div>
                        <div>
                          <select
                            aria-label="Mode kerja"
                            value={mode}
                            onChange={(e) => setMode(e.target.value as Mode)}
                          >
                            <option value="Builder">Bangun</option>
                            <option value="Plan">Rencana</option>
                            <option value="Ask">Tanya</option>
                          </select>
                          {busy ? (
                            <button
                              className="chat-send stop"
                              aria-label="Hentikan respons"
                              onClick={() => {
                                abortRef.current?.abort();
                                setBusy(false);
                                setStreaming("");
                              }}
                            >
                              <Square size={12} />
                            </button>
                          ) : (
                            <button
                              className="chat-send"
                              aria-label="Kirim pesan"
                              disabled={!input.trim()}
                              onClick={() => send()}
                            >
                              <ArrowUp size={16} />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                    {bgResearch && (
                      <p className="bg-research" role="status">
                        <LoaderCircle className="spin" size={11} /> Riset latar
                        belakang masih berjalan di server. Hasilnya muncul di
                        chat begitu selesai, walau tab ini sempat ditutup — asal
                        proses server tidak dimulai ulang di tengah ronde.
                      </p>
                    )}
                    <div className="composer-footer">
                      <AiModelPicker
                        value={model}
                        onChange={setModel}
                        catalog={catalog}
                        status={catalogStatus}
                        error={catalogError}
                        onRefresh={() => void loadModels(true)}
                        disabled={provider !== "configured"}
                      />
                      <span>
                        {provider !== "configured"
                          ? "AI belum tersedia"
                          : `Estimasi ${estimateCredits({
                              mode,
                              model,
                              tiers: catalog?.tiers,
                              catalog,
                              prompt: input,
                              hasAttachments:
                                attachments.length > 0 || references.length > 0,
                            })} kredit · belum ditagih`}
                      </span>
                    </div>
                  </div>
                </>
              )}
            </aside>
          </>
        )}
      </div>
      <footer className="ws-statusbar">
        <div>
          <button onClick={() => setDialog("github")}>
            <GitBranch size={11} />
            Repositori <ChevronDown size={9} />
          </button>
          <StorageStatus projectId={id} dark={theme === "dark"} />
        </div>
        <div>
          {view === "Code" && (
            <span className="ws-editor-position">
              Baris {cursor.lineNumber}, Kolom {cursor.column}
              <span>UTF-8</span>
              <span>
                {/\.lua(u)?$/.test(activeFile)
                  ? "Luau"
                  : activeFile.endsWith(".css")
                    ? "CSS"
                    : activeFile.endsWith(".json")
                      ? "JSON"
                      : activeFile.endsWith(".md")
                        ? "Markdown"
                        : activeFile.endsWith(".html")
                          ? "HTML"
                          : "TypeScript"}
              </span>
            </span>
          )}
          <Presence
            peers={presence.peers}
            state={presence.state}
            activeFile={activeFile}
          />
          {collab.status === "live" && collabPeers > 0 && (
            <span
              className="presence-status live"
              title="Karakter digabung dengan CRDT untuk file yang sama. Perubahan tetap disimpan lewat revisi dan deteksi konflik."
            >
              CRDT · {collab.writers} tab
            </span>
          )}
          {collab.status === "conflict" && (
            <span
              className="presence-status conflict"
              title="Rekan memulai dari teks yang berbeda, jadi penggabungan otomatis dimatikan agar file tidak rusak. Simpan, lalu buka ulang filenya."
            >
              CRDT nonaktif · teks berbeda
            </span>
          )}
          {collab.status === "limit" && (
            <span
              className="presence-status degraded"
              title="CRDT hanya berjalan untuk file sampai 30.000 karakter atau 60.000 simpul. File ini tetap bisa diedit dan disimpan seperti biasa."
            >
              CRDT nonaktif · batas file
            </span>
          )}
          <button onClick={() => setDialog("services")}>Layanan</button>
          {recording && (
            <span className="recording-indicator">
              <Radio size={10} />
              {events.length} aksi
            </span>
          )}
          <button
            onClick={() => {
              setRecording(!recording);
              if (recording) {
                setDialog("recording");
                void saveRecording(
                  store.user?.id || "demo-user",
                  id,
                  project.name,
                  events,
                ).catch((e) => store.notify(e.message));
              } else {
                setEvents([
                  {
                    time: Date.now(),
                    label: "Rekaman dimulai",
                    files: { ...project.files },
                  },
                ]);
                store.notify("Rekaman aksi lokal dimulai.");
              }
            }}
            title="Rekam aksi workspace"
          >
            <Radio size={11} />
            {recording ? "Stop" : "Rekam"}
          </button>
          <button
            className={bottom ? "active" : ""}
            onClick={() => setBottom(bottom ? "" : "Terminal")}
          >
            <PanelBottom size={12} />
            Terminal
          </button>
          <button onClick={() => setRight(!right)}>
            <MessageSquare size={11} />
            Asisten
          </button>
          <button
            onClick={() => (focus ? setFocus(false) : setDialog("commands"))}
          >
            {focus ? "Keluar mode fokus" : "Ctrl + K"}
          </button>
        </div>
      </footer>
      {photoView && (
        <Modal
          title={`Foto project · ${photoView.name}`}
          onClose={() => {
            setPhotoView(null);
            setPhotoViewSrc(null);
          }}
          wide
        >
          <div className="photo-view">
            <p className="photo-view-note">
              <ShieldCheck size={13} />
              Foto ini disimpan di browser ini untuk project ini, bukan di
              cloud. Warnanya dibaca dari piksel foto (rata-rata per area) —
              bukan peta tekstur UV.
            </p>
            {photoViewSrc && (
              <img src={photoViewSrc} alt={`Foto project ${photoView.name}`} />
            )}
            <dl>
              <div>
                <dt>Ukuran</dt>
                <dd>{photoSize(photoView.bytes)}</dd>
              </div>
              <div>
                <dt>Jenis</dt>
                <dd>{photoView.mime}</dd>
              </div>
              <div>
                <dt>Ditambahkan</dt>
                <dd>
                  {new Date(photoView.at).toLocaleString("id-ID", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </dd>
              </div>
              <div>
                <dt>Datang dengan</dt>
                <dd>
                  {photoView.from
                    ? "balasan AI di chat project ini"
                    : "lampiran chat"}
                </dd>
              </div>
            </dl>
            {photoView.palette ? (
              <div className="photo-view-colors">
                <b>Warna yang dibaca dari foto ini</b>
                <span
                  aria-label={`${photoView.palette.colors.length} sel warna dari foto ${photoView.name}`}
                >
                  {photoView.palette.colors.map((color, at) => (
                    <i key={"cell" + at} style={{ background: color }} />
                  ))}
                </span>
                <small>
                  {photoView.palette.columns}×{photoView.palette.rows} sel (
                  {photoView.palette.colors.length} warna) — inilah yang dipakai
                  server untuk mewarnai model, bukan gambar aslinya.
                </small>
              </div>
            ) : (
              <p className="photo-view-note warn">
                <AlertTriangle size={13} />
                Sampel warna foto ini tidak tersedia, jadi model tidak memakai
                warna dari foto. Lampirkan ulang fotonya untuk mencoba lagi.
              </p>
            )}
            <div className="photo-view-actions">
              <button
                className="button button-dark"
                onClick={() => {
                  void reuseProjectPhoto(photoView);
                  setPhotoView(null);
                }}
              >
                <Paperclip size={13} />
                Pakai lagi sebagai lampiran
              </button>
              <button
                className="button button-outline"
                onClick={() => void dropProjectPhoto(photoView)}
              >
                <Trash2 size={13} />
                Hapus dari aset project
              </button>
            </div>
          </div>
        </Modal>
      )}
      {dialog && (
        <Modal
          title={
            {
              rename: "Ganti nama project",
              ...DIALOG_TITLES,
              delete: "Hapus project?",
              invite: "Bangun bersama tim",
              integrations: "Integrasi",
              github: "Hubungkan repositori",
              packages: "Paket project",
              security: "Pemeriksaan kualitas",
              settings: "Pengaturan workspace",
              credits: "Paket & penggunaan",
              commands: "Command palette",
              files: "Buka file",
              comments: "Komentar pada elemen",
              recording: "Rekaman & pemutar sesi",
              services: "Layanan project",
            }[dialog] || dialog
          }
          onClose={() => setDialog("")}
          wide={["security", "services", "integrations", "recording"].includes(
            dialog,
          )}
        >
          <div className="modal-content">
            {(dialog === "services" || dialog === "integrations") && (
              <Suspense fallback={<p>Memuat layanan…</p>}>
                <ServiceHub
                  projectId={id}
                  initialTab={searchParams.get("services") || undefined}
                  onReference={(url, title) => {
                    setReferences([url]);
                    setInput(
                      "Bangun interpretasi orisinal dari referensi " +
                        title +
                        ". Jangan salin brand, logo, atau teks.",
                    );
                    setDialog("");
                  }}
                />
              </Suspense>
            )}
            {dialog === "security" && (
              <Suspense fallback={<p>Memuat audit…</p>}>
                <ServicePanel kind="security" projectId={id} />
              </Suspense>
            )}
            {dialog === "comments" && store.user && !store.user.demo && (
              <Suspense fallback={<p>Memuat komentar…</p>}>
                <ServicePanel kind="comments" projectId={id} />
              </Suspense>
            )}
            {dialog === "rename" && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (newName.trim()) {
                    store.updateProject(id, { name: newName.trim() });
                    setDialog("");
                  }
                }}
              >
                <label>
                  Nama project
                  <input
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    required
                    maxLength={80}
                  />
                </label>
                <button className="button button-dark full-width">
                  Simpan nama
                </button>
              </form>
            )}
            {dialog === "delete" && (
              <>
                <p>
                  Project ini akan dihapus dari browser. Ekspor kode jika Anda
                  ingin menyimpannya terlebih dahulu.
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
                      store.deleteProject(id);
                      navigate("/projects");
                    }}
                  >
                    Hapus permanen
                  </button>
                </div>
              </>
            )}
            {dialog === "invite" && (
              <Suspense fallback={<p>Memuat…</p>}>
                <ServicePanel kind="invite" projectId={id} />
              </Suspense>
            )}
            {dialog === "export" && (
              <>
                <p>
                  {kind === "roblox"
                    ? "PiwuApp tidak memublikasikan game. Buka project di Roblox Studio lewat tab 3D Builder → Hubungkan Studio, lalu publikasikan dari sana. Ekspor ZIP tetap tersedia untuk menyimpan kode skrip dan aset map."
                    : kind === "mobile"
                      ? "Build, signing, dan distribusi Android/iOS dilakukan dengan Expo/EAS atau toolchain native di mesin Anda. PiwuApp tidak menghosting hasil build."
                      : "PiwuApp tidak menghosting website atau memasang domain. Unduh seluruh kode project sebagai ZIP, lalu jalankan di mesin Anda sendiri."}
                </p>
                <button
                  className="button button-outline full-width mt-3"
                  onClick={() => void exportZip()}
                >
                  <Download size={14} />
                  Unduh kode ZIP
                </button>
              </>
            )}
            {dialog === "github" && (
              <Suspense fallback={<p>Memuat…</p>}>
                <GitHubPanel
                  files={project.files}
                  projectName={project.name}
                  onExport={() => void exportZip()}
                />
              </Suspense>
            )}
            {dialog === "packages" && (
              <Suspense fallback={<p>Memuat…</p>}>
                <ServicePanel kind="packages" projectId={id} />
              </Suspense>
            )}
            {dialog === "settings" && (
              <>
                <div className="settings-row">
                  <span>Tema IDE</span>
                  <div
                    className="ide-theme-choice"
                    role="group"
                    aria-label="Tema IDE"
                  >
                    <button
                      aria-pressed={theme === "light"}
                      onClick={() => setTheme("light")}
                    >
                      Terang
                    </button>
                    <button
                      aria-pressed={theme === "dark"}
                      onClick={() => setTheme("dark")}
                    >
                      Gelap
                    </button>
                  </div>
                </div>
                {persistenceError && (
                  <p role="status">
                    Tema berubah untuk sesi ini, tetapi browser menolak
                    penyimpanan preferensi.
                  </p>
                )}
                <div className="settings-row">
                  <span>Provider AI</span>
                  <b>
                    {provider !== "configured"
                      ? "Belum dikonfigurasi"
                      : "Dikonfigurasi"}
                  </b>
                </div>
                <div className="settings-row">
                  <span>Penyimpanan</span>
                  <b>
                    {store.user && !store.user.demo
                      ? "Cloud + cache akun"
                      : "Lokal · browser ini"}
                  </b>
                </div>
                <div className="settings-row">
                  <span>Review sebelum diterapkan</span>
                  <input
                    type="checkbox"
                    style={{ width: 16, margin: 0 }}
                    checked={useReview}
                    onChange={(e) => setUseReview(e.target.checked)}
                    aria-label="Aktifkan review perubahan"
                  />
                </div>
                <p>
                  Isi LLM_BASE_URL, LLM_API_KEY, dan LLM_MODEL pada environment
                  backend untuk AI streaming. Jangan pernah memasukkan API key
                  ke chat atau file project.
                </p>
                <div className="shortcut-list">
                  <span>
                    Command palette <kbd>Ctrl / ⌘ + K</kbd>
                  </span>
                  <span>
                    Buka file <kbd>Ctrl / ⌘ + P</kbd>
                  </span>
                  <span>
                    Cari di semua file <kbd>Ctrl / ⌘ + Shift + F</kbd>
                  </span>
                  <span>
                    Mode fokus <kbd>Ctrl / ⌘ + .</kbd>
                  </span>
                  <span>
                    Kirim pesan <kbd>Ctrl / ⌘ + Enter</kbd>
                  </span>
                </div>
              </>
            )}
            {dialog === "credits" && (
              <Suspense fallback={<p>Memuat…</p>}>
                <ServicePanel kind="credits" projectId={id} />
              </Suspense>
            )}
            {dialog === "security" && (
              <>
                <p>
                  Pemeriksaan statis lokal, bukan audit keamanan atau
                  Lighthouse. Tidak mendeteksi semua kerentanan. Audit
                  dependensi, RLS, performa, dan pengujian runtime perlu
                  dijalankan di CI sebelum produksi.
                </p>
                <div className="scan-summary">
                  <ShieldCheck size={22} />
                  <div>
                    <b>{scans?.length || 0} temuan untuk ditinjau</b>
                    <small>Tidak ada skor produksi yang diberikan.</small>
                  </div>
                  <button className="button button-outline" onClick={scan}>
                    Pindai ulang
                  </button>
                </div>
                {scans?.map((s, i) => (
                  <div className="scan-finding" key={i}>
                    <span>{s.level}</span>
                    <div>
                      <b>{s.title}</b>
                      <small>{s.file}</small>
                    </div>
                    <button
                      className="icon-button"
                      aria-label="Buka file temuan"
                      onClick={() => {
                        openFile(s.file);
                        setDialog("");
                      }}
                    >
                      <ArrowUpRight size={16} />
                    </button>
                  </div>
                ))}
                {scans?.length === 0 && (
                  <p>
                    Tidak ada pola sederhana yang terdeteksi. Ini tidak berarti
                    kode bebas dari kerentanan.
                  </p>
                )}
              </>
            )}
            {(dialog === "commands" || dialog === "files") && (
              <>
                <div className="command-input">
                  <Search size={17} />
                  <input
                    autoFocus
                    value={commandSearch}
                    onChange={(e) => setCommandSearch(e.target.value)}
                    placeholder={
                      dialog === "files"
                        ? "Nama file…"
                        : "Cari perintah atau file…"
                    }
                  />
                </div>
                {dialog === "commands" &&
                  [
                    {
                      label: "Buka canvas responsif",
                      run: () => {
                        setView("Canvas");
                        setRail("files");
                      },
                      icon: PanelsTopLeft,
                    },
                    {
                      label: "Tampilkan / sembunyikan explorer",
                      run: () => setLeft(!left),
                      icon: PanelLeft,
                    },
                    {
                      label: "Buka dashboard project",
                      run: () => navigate("/projects"),
                      icon: FolderOpen,
                    },
                    {
                      label: "Mode fokus",
                      run: () => setFocus(!focus),
                      icon: Maximize,
                    },
                    {
                      label: "Export project ZIP",
                      run: () => void exportZip(),
                      icon: Download,
                    },
                    {
                      label: "Tampilkan terminal",
                      run: () => setBottom("Terminal"),
                      icon: TerminalIcon,
                    },
                    {
                      label: "Riwayat versi",
                      run: () => {
                        setChatTab("Riwayat");
                        setRight(true);
                      },
                      icon: History,
                    },
                  ]
                    .filter((c) =>
                      c.label
                        .toLowerCase()
                        .includes(commandSearch.toLowerCase()),
                    )
                    .map(({ label, run, icon: Icon }) => (
                      <button
                        className="command-item"
                        key={label}
                        onClick={() => {
                          run();
                          setDialog("");
                          setCommandSearch("");
                        }}
                      >
                        <Icon size={15} />
                        {label}
                        <span>↵</span>
                      </button>
                    ))}
                {Object.keys(project.files)
                  .filter((p) =>
                    p.toLowerCase().includes(commandSearch.toLowerCase()),
                  )
                  .map((p) => (
                    <button
                      className="command-item"
                      key={p}
                      onClick={() => {
                        openFile(p);
                        setDialog("");
                        setCommandSearch("");
                      }}
                    >
                      <FileIcon path={p} />
                      {p}
                      <span>↵</span>
                    </button>
                  ))}
              </>
            )}
            {dialog === "comments" && (!store.user || store.user.demo) && (
              <>
                <p>
                  Catatan dalam snapshot project; bukan thread real-time atau
                  identitas penulis terverifikasi.
                </p>
                <code className="comment-selector">
                  {selected?.selector || "Project"}
                </code>
                {project.comments
                  .filter((c) => !selected || c.selector === selected.selector)
                  .map((c) => (
                    <div
                      className={
                        "local-comment " + (c.resolved ? "resolved" : "")
                      }
                      key={c.id}
                    >
                      <p>{c.body}</p>
                      <div>
                        <button
                          onClick={() =>
                            store.updateProject(id, {
                              comments: project.comments.map((x) =>
                                x.id === c.id
                                  ? { ...x, resolved: !x.resolved }
                                  : x,
                              ),
                            })
                          }
                        >
                          <Check size={12} />
                          {c.resolved ? "Selesai" : "Tandai selesai"}
                        </button>
                        <button
                          onClick={() => {
                            setDialog("");
                            void send(c.body);
                          }}
                        >
                          <ArrowUpRight size={12} />
                          Kirim sebagai tugas
                        </button>
                      </div>
                    </div>
                  ))}
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (comment.trim()) {
                      store.updateProject(id, {
                        comments: [
                          ...project.comments,
                          {
                            id: crypto.randomUUID(),
                            selector: selected?.selector || "project",
                            body: comment.trim(),
                            resolved: false,
                          },
                        ],
                      });
                      setComment("");
                    }
                  }}
                >
                  <label>
                    Komentar
                    <textarea
                      required
                      value={comment}
                      onChange={(e) => setComment(e.target.value)}
                      placeholder="Bagaimana jika tombol ini…"
                      rows={3}
                    />
                  </label>
                  <button className="button button-dark full-width">
                    Simpan komentar
                  </button>
                </form>
              </>
            )}
            {dialog === "recording" && (
              <Suspense fallback={<p>Memuat…</p>}>
                <RecordingPanel projectId={id} events={events} />
              </Suspense>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
