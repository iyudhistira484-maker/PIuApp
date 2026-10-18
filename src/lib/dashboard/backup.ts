/**
 * Backup and restore for everything this account has in this browser.
 *
 * Why it exists: projects live in the browser first and are synced second, and
 * photos live only in IndexedDB. "Kalau data browser hilang?" needs an answer
 * that does not depend on the cloud being configured — so the backup is a plain
 * JSON file the user keeps.
 *
 * Two rules that keep it safe:
 *  - a restore never overwrites: every project comes back with a fresh id, so a
 *    half-broken backup file cannot destroy work;
 *  - a backup file is not trusted: unknown fields are dropped, the shape is
 *    checked field by field, and absurd sizes are refused with a reason.
 */
import type { Project } from "../types";
import type { ProjectPhoto } from "../photo-assets";

export const BACKUP_APP = "PiwuApp";
export const BACKUP_KIND = "project-backup";
export const BACKUP_VERSION = 1;
/** A backup bigger than this is not a backup, it is a mistake. */
export const BACKUP_BYTES_MAX = 256 * 1024 * 1024;
export const BACKUP_PROJECTS_MAX = 1000;
/** Text a single project may carry; wider than any real project. */
export const BACKUP_PROJECT_CHARS_MAX = 8 * 1024 * 1024;

export interface BackupPhoto extends Omit<ProjectPhoto, "key" | "thumbnail"> {
  thumbnail?: string;
}

export interface Backup {
  app: string;
  kind: string;
  version: number;
  at: string;
  projects: Project[];
  photos: Record<string, BackupPhoto[]>;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const text = (value: unknown, max = 100000) =>
  typeof value === "string" ? value.slice(0, max) : "";

const stringMap = (value: unknown): Record<string, string> => {
  const out: Record<string, string> = {};
  if (!isObject(value)) return out;
  for (const [key, entry] of Object.entries(value))
    if (typeof entry === "string") out[text(key, 300)] = entry;
  return out;
};

/**
 * Keeps only the fields a project really has. Anything else in the file is
 * dropped rather than trusted.
 */
export function cleanProject(raw: unknown): Project | null {
  if (!isObject(raw)) return null;
  const id = text(raw.id, 200);
  const name = text(raw.name, 200);
  if (!id || !name) return null;
  const files = stringMap(raw.files);
  const chars = Object.values(files).reduce(
    (total, entry) => total + entry.length,
    0,
  );
  if (chars > BACKUP_PROJECT_CHARS_MAX) return null;
  const project: Project = {
    id,
    name,
    description: text(raw.description, 20000),
    template: text(raw.template, 60) || "blank",
    files,
    messages: Array.isArray(raw.messages)
      ? (raw.messages as Project["messages"])
      : [],
    versions: Array.isArray(raw.versions)
      ? (raw.versions as Project["versions"])
      : [],
    createdAt: Number(raw.createdAt) || Date.now(),
    updatedAt: Number(raw.updatedAt) || Number(raw.createdAt) || Date.now(),
    comments: Array.isArray(raw.comments)
      ? (raw.comments as Project["comments"])
      : [],
  };
  if (raw.kind === "webapp" || raw.kind === "mobile" || raw.kind === "roblox")
    project.kind = raw.kind;
  if (raw.plan) project.plan = raw.plan as Project["plan"];
  return project;
}

export function cleanPhoto(raw: unknown): BackupPhoto | null {
  if (!isObject(raw)) return null;
  if (typeof raw.data !== "string" || !raw.data) return null;
  const mime = text(raw.mime, 60);
  if (!["image/png", "image/jpeg", "image/webp"].includes(mime)) return null;
  return {
    id: text(raw.id, 200) || `photo-${Math.random().toString(36).slice(2, 10)}`,
    name: text(raw.name, 300) || "foto",
    mime,
    bytes: Number(raw.bytes) || Math.floor((raw.data.length * 3) / 4),
    at: Number(raw.at) || Date.now(),
    from: raw.from ? text(raw.from, 200) : undefined,
    palette: (raw.palette as BackupPhoto["palette"]) ?? null,
    thumbnail: typeof raw.thumbnail === "string" ? raw.thumbnail : undefined,
    data: raw.data,
  };
}

/** The file this account can keep: every project, plus the photos it stored. */
export function buildBackup(
  projects: Project[],
  photos: Record<string, BackupPhoto[]> = {},
  now = new Date(),
): Backup {
  return {
    app: BACKUP_APP,
    kind: BACKUP_KIND,
    version: BACKUP_VERSION,
    at: now.toISOString(),
    projects: projects
      .map((project) => cleanProject(project))
      .filter(Boolean) as Project[],
    photos,
  };
}

export type ReadBackupResult =
  { ok: true; backup: Backup; skipped: number } | { ok: false; error: string };

/** Reads a file the user picked. Refusals say what is wrong, in words. */
export function readBackup(raw: string, bytes = raw.length): ReadBackupResult {
  if (bytes > BACKUP_BYTES_MAX)
    return {
      ok: false,
      error: `Berkas cadangan ${Math.round(bytes / 1048576)} MB terlalu besar (batas ${Math.round(BACKUP_BYTES_MAX / 1048576)} MB).`,
    };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: "Berkas ini bukan JSON yang bisa dibaca." };
  }
  if (!isObject(parsed))
    return { ok: false, error: "Isi berkas cadangan bukan objek JSON." };
  if (parsed.app !== BACKUP_APP || parsed.kind !== BACKUP_KIND)
    return {
      ok: false,
      error: "Berkas ini bukan cadangan PiwuApp. Pilih berkas piwuapp-*.json.",
    };
  if (Number(parsed.version) !== BACKUP_VERSION)
    return {
      ok: false,
      error: `Versi cadangan ${String(parsed.version)} belum dikenal (aplikasi ini membaca versi ${BACKUP_VERSION}).`,
    };
  if (!Array.isArray(parsed.projects))
    return { ok: false, error: "Cadangan ini tidak memuat daftar project." };
  if (parsed.projects.length > BACKUP_PROJECTS_MAX)
    return {
      ok: false,
      error: `Cadangan memuat ${parsed.projects.length} project, di atas batas ${BACKUP_PROJECTS_MAX}.`,
    };
  const projects = parsed.projects
    .map((entry) => cleanProject(entry))
    .filter(Boolean) as Project[];
  if (!projects.length && parsed.projects.length)
    return {
      ok: false,
      error: "Tidak ada project yang bisa dibaca dari cadangan ini.",
    };
  const photos: Record<string, BackupPhoto[]> = {};
  if (isObject(parsed.photos))
    for (const [projectId, list] of Object.entries(parsed.photos)) {
      if (!Array.isArray(list)) continue;
      const clean = list
        .map((photo) => cleanPhoto(photo))
        .filter(Boolean) as BackupPhoto[];
      if (clean.length) photos[text(projectId, 200)] = clean;
    }
  return {
    ok: true,
    skipped: parsed.projects.length - projects.length,
    backup: {
      app: BACKUP_APP,
      kind: BACKUP_KIND,
      version: BACKUP_VERSION,
      at: text(parsed.at, 40) || new Date().toISOString(),
      projects,
      photos,
    },
  };
}

/** What the confirm dialog says before anything is written. */
export function backupReport(backup: Backup) {
  const photos = Object.values(backup.photos || {}).reduce(
    (total, list) => total + list.length,
    0,
  );
  const files = backup.projects.reduce(
    (total, project) => total + Object.keys(project.files || {}).length,
    0,
  );
  return {
    projects: backup.projects.length,
    photos,
    files,
    withPhotos: Object.values(backup.photos || {}).filter((list) => list.length)
      .length,
  };
}

/** A project name that will not collide with one already on the dashboard. */
export function restoreName(name: string, taken: Set<string>) {
  if (!taken.has(name)) return name;
  let suffix = 1;
  let candidate = `${name} (pulih)`;
  // A restore of a restore: "(pulih)" may itself be taken, so keep counting.
  while (taken.has(candidate)) {
    suffix += 1;
    candidate = `${name} (pulih ${suffix})`;
  }
  return candidate;
}
