import test from "node:test";
import assert from "node:assert/strict";
import { OPS_MAX, SCENE_PATH } from "../server/lib/ai-ops.mjs";
import {
  FILE_READ_CHARS_MAX,
  FILE_READ_LINES_MAX,
  FILES_LIST_MAX,
  GENERAL_TOOL_NAMES,
  TOOL_ROUNDS_MAX_CAP,
  TOOL_ROUNDS_MAX_DEFAULT,
  generalToolDefinitions,
  isGeneralTool,
  parseToolArgs,
  runGeneralTool,
  toolRoundsMax,
} from "../server/lib/tools.mjs";

// The general tool layer is what makes tool calling an ordinary feature instead
// of a research-only special case. These tests pin the promises the tool schemas
// make to the model: read-only, free, bounded, and never a lie about what the
// server can really do.

const names = (options: any) =>
  generalToolDefinitions(options).map((tool: any) => tool.function.name);

const scene = (objects: any[]) =>
  JSON.stringify({ version: 1, objects }, null, 2);
const block = (over: Record<string, any> = {}) => ({
  id: "obj-atap",
  name: "Atap",
  kind: "block",
  parent: null,
  position: [0, 5, 0],
  rotation: [0, 0, 0],
  size: [10, 1, 10],
  color: "#aa0000",
  anchored: true,
  ...over,
});

test("every turn gets the read-only tools; dry_run_ops only where it can answer", () => {
  assert.deepEqual(names({ kind: "webapp", mode: "Ask" }), [
    "list_files",
    "read_file",
  ]);
  assert.deepEqual(names({ kind: "roblox", mode: "Ask" }), [
    "list_files",
    "read_file",
  ]);
  // A Roblox scene in Builder mode is the only place a dry run means anything.
  assert.deepEqual(names({ kind: "roblox", mode: "Builder" }), [
    "list_files",
    "read_file",
    "dry_run_ops",
  ]);

  const [, readFile, dryRun] = generalToolDefinitions({
    kind: "roblox",
    mode: "Builder",
  }) as any[];
  // The schema the provider receives must match what the server enforces.
  assert.deepEqual(readFile.function.parameters.required, ["path"]);
  assert.equal(
    readFile.function.parameters.properties.lines.maximum,
    FILE_READ_LINES_MAX,
  );
  assert.equal(dryRun.function.parameters.properties.ops.maxItems, OPS_MAX);
  assert.deepEqual(dryRun.function.parameters.required, ["ops"]);
  for (const tool of [readFile, dryRun])
    assert.equal(tool.function.parameters.additionalProperties, false);

  // Names the layer owns are recognised as such, and only those.
  for (const name of GENERAL_TOOL_NAMES)
    assert.equal(isGeneralTool(name), true);
  assert.equal(isGeneralTool("search"), false);
  assert.equal(isGeneralTool("delete_repo"), false);
});

test("the tool round budget is a small, capped number an operator can lower", () => {
  assert.equal(toolRoundsMax({}), TOOL_ROUNDS_MAX_DEFAULT);
  assert.equal(toolRoundsMax({ TOOL_ROUNDS_MAX: "1" }), 1);
  assert.equal(toolRoundsMax({ TOOL_ROUNDS_MAX: "2.4" }), 2);
  // A misconfigured value can never turn one reply into an unbounded loop.
  assert.equal(toolRoundsMax({ TOOL_ROUNDS_MAX: "99" }), TOOL_ROUNDS_MAX_CAP);
  assert.equal(
    toolRoundsMax({ TOOL_ROUNDS_MAX: "0" }),
    TOOL_ROUNDS_MAX_DEFAULT,
  );
  assert.equal(
    toolRoundsMax({ TOOL_ROUNDS_MAX: "banyak" }),
    TOOL_ROUNDS_MAX_DEFAULT,
  );
});

test("list_files lists the project without opening a single file", () => {
  const files = {
    "src/app.tsx": "baris satu\nbaris dua",
    "README.md": "rahasia proyek",
  };
  const { ok, text } = runGeneralTool("list_files", {}, { files });
  assert.equal(ok, true);
  assert.match(text, /FILE PROJECT \(2 file, hanya daftar isi/);
  assert.match(text, /- README\.md — 1 baris, 14 karakter/);
  assert.match(text, /- src\/app\.tsx — 2 baris/);
  // The point of the tool: an index, not a content dump.
  assert.doesNotMatch(text, /rahasia proyek/);
  assert.doesNotMatch(text, /baris dua/);

  const empty = runGeneralTool("list_files", {}, { files: {} });
  assert.equal(empty.ok, true);
  assert.match(empty.text, /tidak punya file yang bisa dibaca/);

  // A huge project is truncated with the count said out loud, never silently.
  const many = Object.fromEntries(
    Array.from({ length: FILES_LIST_MAX + 5 }, (_, i) => [
      `file-${i}.txt`,
      "x",
    ]),
  );
  const big = runGeneralTool("list_files", {}, { files: many });
  assert.match(big.text, new RegExp(`batas ${FILES_LIST_MAX}`));
  assert.match(big.text, /5 file lain tidak ditampilkan/);
});

test("read_file returns a numbered window, and a wrong path with what really exists", () => {
  const files = {
    "src/app.tsx": "satu\ndua\ntiga\nempat",
    "docs/panduan.md": "panduan",
  };
  // No window asked for: the whole file, because the schema promises a window of
  // up to FILE_READ_LINES_MAX lines and not a single line.
  const full = runGeneralTool("read_file", { path: "src/app.tsx" }, { files });
  assert.equal(full.ok, true);
  assert.match(full.text, /src\/app\.tsx baris 1–4:/);
  assert.match(full.text, /^1\| satu$/m);
  assert.match(full.text, /^4\| empat$/m);

  const window = runGeneralTool(
    "read_file",
    { path: "src/app.tsx", from: 2, lines: 2 },
    { files },
  );
  assert.equal(window.ok, true);
  assert.match(window.text, /baris 2–3:/);
  assert.match(window.text, /^2\| dua$/m);
  assert.match(window.text, /^3\| tiga$/m);
  assert.doesNotMatch(window.text, /empat/);
  assert.match(window.text, /file punya 4 baris/);

  // A path that is not there is answered with the real list, not an empty file.
  const missing = runGeneralTool("read_file", { path: "app.tsx" }, { files });
  assert.equal(missing.ok, false);
  assert.match(missing.text, /bukan path yang dikirim browser/);
  assert.match(missing.text, /Mungkin maksud Anda: src\/app\.tsx/);

  const absent = runGeneralTool(
    "read_file",
    { path: "tidak/ada.ts" },
    { files },
  );
  assert.equal(absent.ok, false);
  assert.match(absent.text, /tidak ada di project ini/);
  assert.match(absent.text, /docs\/panduan\.md/);

  const noArg = runGeneralTool("read_file", {}, { files });
  assert.equal(noArg.ok, false);
  assert.match(noArg.text, /butuh "path"/);
});

test("read_file stays inside its own line and character budget", () => {
  const long = Array.from({ length: FILE_READ_LINES_MAX + 40 }, (_, i) => {
    return `baris ${i + 1}`;
  }).join("\n");
  const clipped = runGeneralTool(
    "read_file",
    { path: "besar.txt" },
    { files: { "besar.txt": long } },
  );
  assert.equal(clipped.ok, true);
  assert.match(clipped.text, new RegExp(`baris 1–${FILE_READ_LINES_MAX}:`));
  assert.match(
    clipped.text,
    new RegExp(`file punya ${FILE_READ_LINES_MAX + 40} baris`),
  );
  assert.doesNotMatch(
    clipped.text,
    new RegExp(`^${FILE_READ_LINES_MAX + 1}\\|`),
  );

  // One gigantic line is cut at the character cap, and it says so.
  const wide = runGeneralTool(
    "read_file",
    { path: "lebar.txt" },
    { files: { "lebar.txt": "x".repeat(FILE_READ_CHARS_MAX + 500) } },
  );
  assert.equal(wide.ok, true);
  assert.match(
    wide.text,
    new RegExp(`cuplikan dipotong di ${FILE_READ_CHARS_MAX} karakter`),
  );
});

test("dry_run_ops reports what would happen and never writes it", () => {
  const saved = scene([block()]);
  const files: Record<string, string> = { [SCENE_PATH]: saved };
  const result = runGeneralTool(
    "dry_run_ops",
    {
      ops: [
        {
          kind: "scene.transform",
          ops: [{ target: "obj-atap", move: [2, 0, 0], color: "#2857AA" }],
        },
      ],
    },
    { files, kind: "roblox", mode: "Builder" },
  );
  assert.equal(result.ok, true);
  assert.match(result.text, /Uji coba berhasil: 1 operasi akan diterapkan/);
  assert.match(result.text, /tidak ada yang ditulis ke project/);
  assert.match(result.text, /- scene.transform → Atap \(id=obj-atap\)/);
  assert.match(result.text, /geser \[2,0,0\]/);

  // One impossible target in a batch: the whole batch is refused, in the same
  // all-or-nothing terms the real apply uses, so the model never believes half
  // of it landed.
  const allOrNothing = runGeneralTool(
    "dry_run_ops",
    {
      ops: [
        {
          kind: "scene.transform",
          ops: [
            { target: "obj-atap", move: [1, 0, 0] },
            { target: "obj-hantu", move: [1, 0, 0] },
          ],
        },
      ],
    },
    { files, kind: "roblox", mode: "Builder" },
  );
  assert.equal(allOrNothing.ok, true);
  assert.match(allOrNothing.text, /Uji coba gagal/);
  assert.match(allOrNothing.text, /DITOLAK .*obj-hantu/);
  assert.match(allOrNothing.text, /semua-atau-tidak/);
  assert.doesNotMatch(allOrNothing.text, /akan diterapkan\n- scene/);

  // The one promise that matters: a dry run leaves the project alone.
  assert.equal(files[SCENE_PATH], saved);
  assert.equal(JSON.parse(files[SCENE_PATH]).objects[0].position[0], 0);
});

test("dry_run_ops refuses a broken batch with reasons, and a wrong project or mode", () => {
  const files = { [SCENE_PATH]: scene([block()]) };
  const roblox = { files, kind: "roblox", mode: "Builder" };

  const broken = runGeneralTool("dry_run_ops", { ops: "bukan batch" }, roblox);
  assert.equal(broken.ok, true);
  assert.match(broken.text, /Uji coba TIDAK dijalankan/);
  assert.match(broken.text, /semua-atau-tidak/);

  const tooMany = runGeneralTool(
    "dry_run_ops",
    {
      ops: Array.from({ length: OPS_MAX + 1 }, () => ({
        kind: "scene.transform",
        ops: [{ target: "obj-atap", move: [1, 0, 0] }],
      })),
    },
    roblox,
  );
  assert.match(tooMany.text, new RegExp(`batas ${OPS_MAX} operasi per batch`));

  // With no scene saved yet, the trial says so instead of inventing one.
  const noScene = runGeneralTool(
    "dry_run_ops",
    {
      ops: [
        { kind: "scene.transform", ops: [{ target: "obj-atap", scale: 2 }] },
      ],
    },
    { files: {}, kind: "roblox", mode: "Builder" },
  );
  assert.match(noScene.text, /scene\.roblox\.json/);

  // Where the tool cannot answer, it is refused with the reason and runs nothing.
  const webapp = runGeneralTool(
    "dry_run_ops",
    {
      ops: [
        { kind: "scene.transform", ops: [{ target: "obj-atap", scale: 2 }] },
      ],
    },
    { files, kind: "webapp", mode: "Builder" },
  );
  assert.equal(webapp.ok, false);
  assert.match(webapp.text, /hanya berlaku untuk project Roblox/);
  const ask = runGeneralTool(
    "dry_run_ops",
    {
      ops: [
        { kind: "scene.transform", ops: [{ target: "obj-atap", scale: 2 }] },
      ],
    },
    { files, kind: "roblox", mode: "Ask" },
  );
  assert.equal(ask.ok, false);
  assert.match(ask.text, /hanya berlaku di mode Builder/);
});

test("a tool the server does not have is named, never guessed at", () => {
  const result = runGeneralTool("delete_repo", { repo: "x" }, {});
  assert.equal(result.ok, false);
  assert.match(result.text, /delete_repo/);
  for (const name of GENERAL_TOOL_NAMES)
    assert.match(result.text, new RegExp(name));
});

test("tool arguments are parsed from JSON or an object, and a broken one is flagged", () => {
  assert.deepEqual(
    parseToolArgs({
      id: "c1",
      function: { name: "Read_File", arguments: '{"path":"a.ts"}' },
    }),
    {
      name: "read_file",
      args: { path: "a.ts" },
      id: "c1",
    },
  );
  assert.deepEqual(parseToolArgs({ name: "list_files", arguments: {} }), {
    name: "list_files",
    args: {},
    id: "",
  });
  // Empty arguments are an empty object, not an error: list_files takes none.
  assert.deepEqual(
    parseToolArgs({ function: { name: "list_files", arguments: "" } }),
    {
      name: "list_files",
      args: {},
      id: "",
    },
  );
  assert.deepEqual(
    parseToolArgs({ function: { name: "read_file", arguments: "{oops" } }),
    {
      name: "read_file",
      invalid: true,
    },
  );
  assert.deepEqual(
    parseToolArgs({ function: { name: "read_file", arguments: "3" } }),
    {
      name: "read_file",
      invalid: true,
    },
  );
});

test("dry_run_ops trials a scene.build batch, photos included, without building it", () => {
  const files = { [SCENE_PATH]: scene([block()]) };
  const roblox = { files, kind: "roblox", mode: "Builder" };
  const build = [
    {
      kind: "scene.build",
      name: "Kursi kayu",
      photo: 1,
      nodes: [{ name: "Dudukan", shape: "box", size: [3, 0.4, 3] }],
    },
  ];
  const ok = runGeneralTool(
    "dry_run_ops",
    { ops: build },
    { ...roblox, photos: 1 },
  );
  assert.equal(ok.ok, true);
  assert.match(ok.text, /Uji coba berhasil: 1 operasi akan diterapkan/);
  assert.match(ok.text, /scene\.build → Kursi kayu/);
  // A trial run leaves the project alone, exactly like the real apply would not
  // have run yet.
  assert.equal(JSON.parse(files[SCENE_PATH]).objects.length, 1);

  // A model that cites photo 2 when only one photo was attached is caught here,
  // before the answer is even sent.
  const wrongPhoto = runGeneralTool(
    "dry_run_ops",
    { ops: [{ ...build[0], photo: 2 }] },
    { ...roblox, photos: 1 },
  );
  assert.match(wrongPhoto.text, /hanya melampirkan 1 foto/);
  assert.match(wrongPhoto.text, /Uji coba gagal/);

  // The same batch outside Roblox Builder is refused with the reason.
  const webapp = runGeneralTool(
    "dry_run_ops",
    { ops: build },
    { files, kind: "webapp", mode: "Builder", photos: 1 },
  );
  assert.equal(webapp.ok, false);
  assert.match(webapp.text, /hanya berlaku untuk project Roblox/);
});

test("the dry-run tool advertises both op kinds that it can really trial", () => {
  const dryRun = generalToolDefinitions({
    kind: "roblox",
    mode: "Builder",
  }).find((tool: any) => tool.function.name === "dry_run_ops") as any;
  assert.match(dryRun.function.description, /scene\.build/);
  assert.match(dryRun.function.description, /photo/);
  const props = dryRun.function.parameters.properties.ops;
  assert.equal(props.maxItems, OPS_MAX);
  assert.match(props.description, /scene\.build/);
});
