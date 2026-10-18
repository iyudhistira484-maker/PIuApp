// Presence helpers. Supabase Realtime carries only small, self-declared
// payloads (name, file, cursor). Anything read from the channel is treated as
// untrusted input: values are clamped, stripped of control characters, and
// capped before they reach the DOM or the editor.

export interface PresenceMeta {
  name?: unknown;
  file?: unknown;
  line?: unknown;
  column?: unknown;
  at?: unknown;
}

export interface PresencePeer {
  id: string;
  name: string;
  initials: string;
  color: string;
  file: string;
  line: number;
  column: number;
  at: number;
}

export type PresenceState = "off" | "connecting" | "live" | "degraded";

const COLORS = [
  "#477296",
  "#8c5f8f",
  "#5b856b",
  "#a5743d",
  "#a4555d",
  "#4d7f8a",
  "#6b6a9c",
  "#7d7f4a",
];

export function presenceColor(id: string): string {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.codePointAt(0)!) >>> 0;
  return COLORS[hash % COLORS.length];
}

function text(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  // Control characters would break tooltips and aria labels.
  return value
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function integer(value: unknown, min: number, max: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

export function displayName(raw: unknown, fallback = "Anggota"): string {
  return text(raw, 40) || fallback;
}

export function initials(name: string): string {
  const words = text(name, 40).split(" ").filter(Boolean);
  if (words.length === 0) return "?";
  return words
    .slice(0, 2)
    .map((word) => Array.from(word)[0])
    .join("")
    .toUpperCase();
}

/** One entry per member, newest tab wins when the same person has two open. */
export function presencePeers(
  state: Record<string, PresenceMeta[]> | null | undefined,
  selfId: string | null | undefined,
): PresencePeer[] {
  const byUser = new Map<string, PresencePeer>();
  for (const [id, metas] of Object.entries(state || {})) {
    if (!id || id === selfId || !Array.isArray(metas)) continue;
    for (const meta of metas) {
      if (!meta || typeof meta !== "object") continue;
      const at = integer(meta.at, 0, Number.MAX_SAFE_INTEGER);
      const peer: PresencePeer = {
        id,
        name: displayName(meta.name),
        initials: initials(displayName(meta.name)),
        color: presenceColor(id),
        file: text(meta.file, 200),
        line: integer(meta.line, 1, 1_000_000),
        column: integer(meta.column, 1, 1_000_000),
        at,
      };
      const previous = byUser.get(id);
      if (!previous || peer.at >= previous.at) byUser.set(id, peer);
    }
  }
  return [...byUser.values()].sort(
    (a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
  );
}

/** Short, human label for where a peer is right now. */
export function presenceWhere(peer: PresencePeer, activeFile: string): string {
  if (peer.file && peer.file === activeFile)
    return `baris ${peer.line}, kolom ${peer.column}`;
  if (!peer.file) return "di project";
  const name = peer.file.split("/").pop() || peer.file;
  return name.slice(0, 40);
}

export function presenceSummary(
  peers: PresencePeer[],
  state: PresenceState,
): string {
  if (state === "off") return "";
  if (state === "degraded") return "Realtime terputus · polling aktif";
  if (state === "connecting") return "Menyambungkan realtime…";
  if (peers.length === 0) return "Hanya Anda · realtime";
  return `${peers.length + 1} hadir · realtime`;
}
