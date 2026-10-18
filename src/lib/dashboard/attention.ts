/**
 * The three dashboard insights, kept as pure functions so the wording and the
 * numbers can be tested without a browser: what waits for the user, how much
 * credit was used, and what a project actually contains.
 *
 * Rules that shaped this file:
 *  - Every number comes from data that already exists (project payload, sync
 *    state, `/api/account`, the project's own service endpoints). No new table.
 *  - Nothing is invented: a value that was not loaded stays `undefined` and the
 *    UI says "belum diperiksa" instead of showing a friendly zero.
 */
import { SCENE_PATH } from "../roblox/scene";
import { PROJECT_PHOTOS_BYTES_MAX, PROJECT_PHOTOS_MAX } from "../photo-assets";
import type { Project } from "../types";

/** Files the Roblox bridge writes next to the scene (see server/lib/roblox-scene.mjs). */
export const SCENE_ASSET_PATH = "studio.assets.json";

export type AttentionKind = "comments" | "invites" | "studio" | "sync";

export interface AttentionItem {
  id: string;
  projectId: string;
  projectName: string;
  kind: AttentionKind;
  /** What waits, in one sentence. */
  title: string;
  /** Optional second line: a count, a status, an address. */
  detail?: string;
  /** Project link, with the panel to open so the next click lands there. */
  link: string;
}

export interface CommentRow {
  id?: string;
  status?: string;
}
export interface InviteRow {
  id?: string;
  email?: string;
  role?: string;
  expires_at?: string;
  accepted_at?: string | null;
  revoked_at?: string | null;
}
export interface BridgeRow {
  state?: string;
  queuedChanges?: number;
  expiresAt?: string;
}

/** What each project endpoint answered, when it answered at all. */
export interface ProjectSignals {
  project: { id: string; name: string };
  comments?: CommentRow[];
  invites?: InviteRow[];
  studio?: BridgeRow | null;
  syncPhase?: string;
}

const isOpenComment = (comment: CommentRow) => comment.status !== "resolved";

/** An invite still pending: not accepted, not revoked, not expired. */
export function pendingInvites(
  invites: InviteRow[] | undefined,
  now = Date.now(),
) {
  return (invites || []).filter((invite) => {
    if (invite.accepted_at || invite.revoked_at) return false;
    const expires = invite.expires_at ? Date.parse(invite.expires_at) : NaN;
    return Number.isNaN(expires) || expires > now;
  });
}

export function bridgeWaiting(studio: BridgeRow | null | undefined) {
  if (!studio) return "";
  const queued = Number(studio.queuedChanges || 0);
  if (studio.state === "queued" || studio.state === "applying" || queued > 0)
    return `${queued || 1} perubahan menunggu diterapkan di Studio`;
  return "";
}

/** Sync wording used on the project card. `undefined` = not a cloud project. */
export function syncNotice(phase: string | undefined) {
  if (!phase) return null;
  if (phase === "conflict")
    return { tone: "warn" as const, label: "Konflik sinkronisasi" };
  if (phase === "error")
    return { tone: "warn" as const, label: "Sinkronisasi gagal" };
  if (phase === "pending" || phase === "saving")
    return { tone: "wait" as const, label: "Menunggu sinkronisasi" };
  if (phase === "loading")
    return { tone: "wait" as const, label: "Memuat dari cloud" };
  if (phase === "local") return { tone: "ok" as const, label: "Di perangkat" };
  return { tone: "ok" as const, label: "Tersinkron" };
}

const projectLink = (id: string, services?: string) =>
  `/project/${id}?dialog=services${services ? `&services=${services}` : ""}`;

export function attentionItems(
  signals: ProjectSignals,
  now = Date.now(),
): AttentionItem[] {
  const { project } = signals;
  const base = { projectId: project.id, projectName: project.name };
  const items: AttentionItem[] = [];
  const openComments = (signals.comments || []).filter(isOpenComment).length;
  if (openComments)
    items.push({
      ...base,
      id: `${project.id}:comments`,
      kind: "comments",
      title: `${openComments} komentar belum diselesaikan`,
      link: projectLink(project.id, "comments"),
    });
  const invites = pendingInvites(signals.invites, now);
  if (invites.length)
    items.push({
      ...base,
      id: `${project.id}:invites`,
      kind: "invites",
      title: `${invites.length} undangan kolaborator belum dijawab`,
      detail: invites
        .map((invite) => invite.email || invite.role || "anggota")
        .slice(0, 3)
        .join(", "),
      link: projectLink(project.id, "invite"),
    });
  const studio = bridgeWaiting(signals.studio);
  if (studio)
    items.push({
      ...base,
      id: `${project.id}:studio`,
      kind: "studio",
      title: studio,
      detail: "Buka plugin PiwuApp di Studio → Ambil & tinjau perubahan",
      link: `/project/${project.id}`,
    });
  const sync = syncNotice(signals.syncPhase);
  if (sync?.tone === "warn")
    items.push({
      ...base,
      id: `${project.id}:sync`,
      kind: "sync",
      title: sync.label,
      detail: "Buka project, lalu pakai panel penyimpanan untuk memutuskan",
      link: `/project/${project.id}`,
    });
  return items;
}

/** Credit spent over the last `days` days, as a positive number. */
export function creditSpend(
  ledger: { delta?: number; created_at?: string }[] | undefined,
  days = 7,
  now = Date.now(),
) {
  const since = now - days * 86400000;
  return (ledger || []).reduce((total, entry) => {
    const at = entry.created_at ? Date.parse(entry.created_at) : NaN;
    const delta = Number(entry.delta || 0);
    if (Number.isNaN(at) || at < since || delta >= 0) return total;
    return total + Math.abs(delta);
  }, 0);
}

export interface Footprint {
  files: number;
  versions: number;
  bytes: number;
  photos?: { count: number; limit: number; bytes: number; bytesLimit: number };
  scene?: { objects: number; meshes: number; meshesWithAsset: number };
}

/** Cheap read of the Roblox scene, without running the full schema. */
export function sceneFootprint(
  files: Record<string, string> | undefined,
): Footprint["scene"] {
  const text = files?.[SCENE_PATH];
  if (!text) return undefined;
  try {
    const scene = JSON.parse(text);
    if (scene?.version !== 1 || !Array.isArray(scene.objects)) return undefined;
    const meshes = scene.objects.filter(
      (object: { kind?: string }) => object?.kind === "mesh",
    );
    let meshesWithAsset = 0;
    const assets = files?.[SCENE_ASSET_PATH];
    if (assets) {
      const parsed = JSON.parse(assets);
      const map = parsed?.assets;
      if (map && typeof map === "object")
        meshesWithAsset = meshes.filter((object: { id?: string }) => {
          const assetId = object.id ? map[object.id]?.assetId : undefined;
          return assetId !== undefined && assetId !== null && assetId !== "";
        }).length;
    }
    return {
      objects: scene.objects.length,
      meshes: meshes.length,
      meshesWithAsset,
    };
  } catch {
    return undefined;
  }
}

export function projectFootprint(
  project: Project,
  photos?: { count: number; bytes: number },
): Footprint {
  const files = Object.entries(project.files || {});
  return {
    files: files.length,
    versions: (project.versions || []).length,
    // Characters, not encoded bytes: the payload is text, and this is the same
    // number the cloud size ceiling counts.
    bytes: files.reduce((total, [, text]) => total + (text?.length || 0), 0),
    photos: photos
      ? {
          count: photos.count,
          limit: PROJECT_PHOTOS_MAX,
          bytes: photos.bytes,
          bytesLimit: PROJECT_PHOTOS_BYTES_MAX,
        }
      : undefined,
    scene:
      project.kind === "roblox" ? sceneFootprint(project.files) : undefined,
  };
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** One line of "where you left off", from the newest stored message. */
export function continueLine(project: Project) {
  const messages = project.messages || [];
  for (let at = messages.length - 1; at >= 0; at--) {
    const text = (messages[at]?.content || "").replace(/\s+/g, " ").trim();
    if (text) return text.length > 68 ? `${text.slice(0, 68)}…` : text;
  }
  return "";
}
