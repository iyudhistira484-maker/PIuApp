// The server's tool layer.
//
// One registry for every tool the model may ask for, whatever mode the turn is
// in, so tool calling is no longer a research-only special case:
//
//  * `search` and `read_page` — only offered while research mode is on, because
//    they spend vendor quota and a research round credit;
//  * `list_files`, `read_file` and `dry_run_ops` — offered on ordinary turns too.
//    They are pure server-side reads of what the browser already sent (the saved
//    project files), so they touch no network, change nothing, and cost no
//    credits. They exist because a model that can pull the exact file or a
//    dry-run of its own ops batch makes fewer wrong guesses than one that only
//    gets a single blob of text up front.
//
// Every tool result is data, never instructions, and every refusal says why. A
// tool the server does not have is reported by name instead of being guessed at.
import { OPS_MAX, SCENE_PATH, applySceneOps, parseOps } from "./ai-ops.mjs";

export const TOOL_ROUNDS_MAX_DEFAULT = 2;
export const TOOL_ROUNDS_MAX_CAP = 3;
export const TOOL_CALLS_MAX = 4;
export const FILES_LIST_MAX = 60;
export const FILE_READ_LINES_MAX = 200;
export const FILE_READ_CHARS_MAX = 12000;

export const toolRoundsMax = (env = {}) => {
  const value = Number(env.TOOL_ROUNDS_MAX);
  if (!Number.isFinite(value) || value < 1) return TOOL_ROUNDS_MAX_DEFAULT;
  return Math.min(Math.round(value), TOOL_ROUNDS_MAX_CAP);
};

/** Names the general layer owns. Research tools live in research.mjs. */
export const GENERAL_TOOL_NAMES = ["list_files", "read_file", "dry_run_ops"];

const fileText = (value) => {
  if (typeof value === "string") return value;
  return JSON.stringify(value ?? "");
};
const lineCount = (text) => (text ? text.split("\n").length : 0);

const listFilesText = (files) => {
  const paths = Object.keys(files || {}).sort();
  if (!paths.length)
    return "Project ini tidak punya file yang bisa dibaca. Tidak ada yang dibuka.";
  const shown = paths.slice(0, FILES_LIST_MAX);
  const lines = shown.map((path) => {
    const text = fileText(files[path]);
    return `- ${path} — ${lineCount(text)} baris, ${text.length} karakter`;
  });
  if (paths.length > shown.length)
    lines.push(
      `- … ${paths.length - shown.length} file lain tidak ditampilkan (batas ${FILES_LIST_MAX}).`,
    );
  return [
    `FILE PROJECT (${paths.length} file, hanya daftar isi — tidak ada isi yang dibuka):`,
    ...lines,
    "Isi lengkap file sudah dikirim di pesan permintaan ini; pakai read_file hanya bila Anda perlu satu berkas tertentu dengan nomor baris.",
  ].join("\n");
};

/**
 * Reads one file (or a window of it) with line numbers. Unknown paths are
 * answered with what really exists instead of an empty result.
 */
const readFileText = (files, args) => {
  const paths = Object.keys(files || {}).sort();
  const raw = String(args?.path ?? args?.file ?? "").trim();
  if (!raw)
    return {
      ok: false,
      text: `read_file butuh "path". File yang ada: ${paths.slice(0, 20).join(", ") || "(tidak ada)"}.`,
    };
  const wanted = raw.replace(/^\.\//, "");
  const path = paths.find((entry) => entry === wanted);
  if (!path) {
    const near = paths.filter(
      (entry) =>
        entry.endsWith("/" + wanted) ||
        entry.toLowerCase().endsWith(wanted.toLowerCase()),
    );
    return {
      ok: false,
      text: near.length
        ? `read_file: "${raw}" bukan path yang dikirim browser. Mungkin maksud Anda: ${near.slice(0, 10).join(", ")}.`
        : `read_file: "${raw}" tidak ada di project ini. File yang ada: ${paths.slice(0, 20).join(", ") || "(tidak ada)"}.`,
    };
  }
  const text = fileText(files[path]);
  const total = lineCount(text);
  const start = Math.max(
    1,
    Math.trunc(Number(args?.from ?? args?.start ?? 1)) || 1,
  );
  // The schema promises a window of at most FILE_READ_LINES_MAX lines, so an
  // omitted `lines` means that window and not a single line.
  const askedLines = Number(args?.lines ?? args?.count ?? FILE_READ_LINES_MAX);
  const span =
    Number.isFinite(askedLines) && askedLines >= 1
      ? Math.min(Math.trunc(askedLines), FILE_READ_LINES_MAX)
      : FILE_READ_LINES_MAX;
  const askedTo = Number(args?.to ?? args?.end);
  const to = Math.max(
    start,
    Number.isFinite(askedTo) && askedTo >= start
      ? Math.trunc(askedTo)
      : start + span - 1,
  );
  const end = Math.min(to, start + FILE_READ_LINES_MAX - 1, total);
  const slice = text
    .split("\n")
    .slice(start - 1, end)
    .join("\n");
  const clipped =
    slice.length > FILE_READ_CHARS_MAX
      ? slice.slice(0, FILE_READ_CHARS_MAX)
      : slice;
  const width = String(end).length;
  const numbered = clipped
    .split("\n")
    .map((line, index) => `${String(start + index).padStart(width)}| ${line}`)
    .join("\n");
  const notes = [];
  if (slice.length > clipped.length)
    notes.push(`cuplikan dipotong di ${FILE_READ_CHARS_MAX} karakter`);
  if (end < total)
    notes.push(`file punya ${total} baris; minta baris berikutnya bila perlu`);
  return {
    ok: true,
    text: [
      `${path} baris ${start}–${end}:`,
      numbered,
      ...(notes.length ? [`(${notes.join("; ")})`] : []),
    ].join("\n"),
  };
};

const describeChange = (change) => {
  const who = change.name
    ? `${change.name} (id=${change.id || "-"})`
    : change.target;
  return `- ${change.kind} → ${who}${change.changes?.length ? ` (${change.changes.join(", ")})` : ""}`;
};

/**
 * Validates an ops batch against the saved scene without writing anything: the
 * scene returned by `applySceneOps` is thrown away here, so a dry run can never
 * change a project. Answers with what WOULD happen, in the same all-or-nothing
 * terms the real apply uses.
 */
const dryRunOpsText = (
  { files, kind, mode, photos = 0, palettes = [] },
  args,
) => {
  if (kind !== "roblox" || mode !== "Builder")
    return {
      ok: false,
      text:
        kind !== "roblox"
          ? "dry_run_ops hanya berlaku untuk project Roblox; project ini bukan Roblox, jadi tidak ada yang diuji."
          : "dry_run_ops hanya berlaku di mode Builder; ubah mode ke Builder lalu minta lagi.",
    };
  const ops = args?.ops;
  const { value, issues } = parseOps(ops);
  if (issues.length)
    return {
      ok: true,
      text: [
        `Uji coba TIDAK dijalankan: struktur operasi tidak valid (batas ${OPS_MAX} operasi per batch).`,
        ...issues.map((issue) => `- ${issue}`),
        "Batch bersifat semua-atau-tidak: perbaiki dulu, lalu uji lagi.",
      ].join("\n"),
    };
  const saved = files?.[SCENE_PATH];
  // The same call the real apply makes, photos included, so a trial run can
  // never say "that works" about a batch the server would refuse.
  const { report } = applySceneOps({
    scene: saved,
    ops: value,
    photos,
    palettes,
  });
  const head = report.sceneChanged
    ? `Uji coba berhasil: ${report.applied.length} operasi akan diterapkan (tidak ada yang ditulis ke project).`
    : `Uji coba gagal: tidak ada operasi yang akan diterapkan (${report.note})`;
  return {
    ok: true,
    text: [
      head,
      ...report.applied.slice(0, 12).map(describeChange),
      ...(report.applied.length > 12
        ? [`- … ${report.applied.length - 12} operasi lain`]
        : []),
      ...report.rejected
        .slice(0, 8)
        .map((entry) => `- DITOLAK ${describeChange(entry)}: ${entry.reason}`),
      report.sceneChanged
        ? "Kalau setuju, kirim batch yang sama sebagai ops di jawaban akhir Anda."
        : "Perbaiki batch lalu jawab; jangan mengarang operasi yang tidak disebut di atas.",
    ].join("\n"),
  };
};

/**
 * Definitions for the general layer, handed to a provider on every turn.
 * `dry_run_ops` is offered only where it can really answer (a Roblox project in
 * Builder mode); the research tools are added by the caller next to these, so
 * one loop runs both. A tool list never promises what the server cannot run.
 */
export function generalToolDefinitions({ kind = "", mode = "" } = {}) {
  const tools = [
    {
      type: "function",
      function: {
        name: "list_files",
        description:
          "List the project's files with line and character counts. Read-only, no network, no credits: use it for an overview before opening one file.",
        parameters: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "read_file",
        description:
          "Open ONE project file by path with line numbers, optionally a window (from/lines). Read-only, no network, no credits.",
        parameters: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "File path exactly as it appears in the project.",
            },
            from: {
              type: "integer",
              minimum: 1,
              description: "First line to read (default 1).",
            },
            lines: {
              type: "integer",
              minimum: 1,
              maximum: FILE_READ_LINES_MAX,
              description: `How many lines to read (default and maximum ${FILE_READ_LINES_MAX}).`,
            },
          },
          required: ["path"],
          additionalProperties: false,
        },
      },
    },
  ];
  // Only where the server can really answer: a Roblox scene in Builder mode.
  if (kind === "roblox" && mode === "Builder")
    tools.push({
      type: "function",
      function: {
        name: "dry_run_ops",
        description:
          "Trial-run an ops batch (scene.transform edits and/or scene.build models, including a model built from an attached photo) against the saved Roblox scene WITHOUT applying it, and see what would be applied or rejected. Read-only, no credits.",
        parameters: {
          type: "object",
          properties: {
            ops: {
              type: "array",
              minItems: 1,
              maxItems: OPS_MAX,
              items: {
                type: "object",
                properties: {
                  kind: { type: "string", enum: ["scene.transform"] },
                  ops: {
                    type: "array",
                    items: { type: "object" },
                    description:
                      "Move/rotate/scale/color entries: {kind, target|id|name, position|rotation|scale|color}.",
                  },
                },
                required: ["kind", "ops"],
              },
              description:
                "Entries to trial-run: scene.transform batches (edit existing objects) and/or scene.build entries ({kind, name, photo?, nodes:[...]}) that create new geometry, exactly as the AI would send them.",
            },
          },
          required: ["ops"],
          additionalProperties: false,
        },
      },
    });
  return tools;
}

/**
 * Runs one general tool call. `files` is the saved project the browser sent —
 * nothing else is ever readable, so a tool can never reach the disk or the
 * network. Returns `{ok, text}`; the caller forwards the text to the model.
 */
export function runGeneralTool(
  name,
  args,
  { files = {}, kind = "", mode = "", photos = 0, palettes = [] } = {},
) {
  if (name === "list_files") return { ok: true, text: listFilesText(files) };
  if (name === "read_file") return readFileText(files, args);
  if (name === "dry_run_ops")
    return dryRunOpsText({ files, kind, mode, photos, palettes }, args);
  return {
    ok: false,
    text: `Alat "${name}" tidak dikenal di server ini. Alat yang tersedia: ${[...GENERAL_TOOL_NAMES].join(", ")}.`,
  };
}

/** Parses one provider tool call; `{name}` when the arguments are unusable. */
export function parseToolArgs(call) {
  const fn = call?.function || call || {};
  const name = String(fn.name || "").toLowerCase();
  const raw = fn.arguments ?? call?.arguments ?? {};
  try {
    const args = typeof raw === "string" ? JSON.parse(raw || "{}") : raw;
    if (!args || typeof args !== "object") return { name, invalid: true };
    return { name, args, id: String(call?.id || "") };
  } catch {
    return { name, invalid: true };
  }
}

export const isGeneralTool = (name) => GENERAL_TOOL_NAMES.includes(name);
