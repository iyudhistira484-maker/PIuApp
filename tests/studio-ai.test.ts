import test from "node:test";
import assert from "node:assert/strict";
import {
  STUDIO_AI_LIMITS,
  buildStudioContext,
  loadStudioSnapshot,
} from "../server/lib/studio-ai.mjs";

// The AI reads the latest snapshot the Studio plugin sent. These tests lock the
// three properties that make that safe: the Explorer tree is real, unreadable
// scripts are named instead of invented, and a huge script is cut with a marker.
const root = (id: string, name: string, className: string) => ({
  id,
  parentId: null,
  name,
  className,
  properties: {},
});
const script = (
  id: string,
  parentId: string,
  name: string,
  path: string,
  source: string | undefined,
  readable = true,
) => ({
  id,
  parentId,
  name,
  className: "Script",
  properties: {},
  scriptPath: path,
  ...(source === undefined ? {} : { source }),
  readable,
});

function snapshot(nodes: any[]) {
  return {
    version: 1,
    snapshotId: crypto.randomUUID(),
    placeId: "12345",
    nodes,
  };
}

test("the studio payload carries the Explorer tree and every readable source", () => {
  const hello = 'print("halo dari Studio")';
  const context = buildStudioContext(
    snapshot([
      root("w", "Workspace", "Workspace"),
      root("sss", "ServerScriptService", "ServerScriptService"),
      root("rs", "ReplicatedStorage", "ReplicatedStorage"),
      script(
        "s1",
        "sss",
        "Hello",
        "ServerScriptService/Hello_aaaaaaaa.luau",
        hello,
      ),
      script(
        "s2",
        "rs",
        "Util",
        "ReplicatedStorage/Util_bbbbbbbb.luau",
        undefined,
        false,
      ),
    ]),
    {},
    { updatedAt: "2026-10-17T01:00:00.000Z" },
  );
  assert.ok(context);
  assert.equal(context.nodes, 5);
  assert.equal(context.scripts, 2);
  assert.equal(context.read, 1);
  assert.equal(context.omitted, 0);
  assert.equal(context.payload.placeId, "12345");
  assert.equal(context.payload.updatedAt, "2026-10-17T01:00:00.000Z");
  // The tree is the Explorer hierarchy, not a flat list of file names.
  assert.ok(
    context.payload.tree.includes("ServerScriptService · ServerScriptService"),
  );
  assert.ok(
    context.payload.tree.includes(
      "ServerScriptService/Hello · Script · scriptPath ServerScriptService/Hello_aaaaaaaa.luau",
    ),
  );
  const byPath = new Map(
    context.payload.scripts.map((entry: any) => [entry.path, entry]),
  );
  assert.equal(
    byPath.get("ServerScriptService/Hello_aaaaaaaa.luau").source,
    hello,
  );
  assert.equal(
    byPath.get("ServerScriptService/Hello_aaaaaaaa.luau").explorer,
    "ServerScriptService/Hello",
  );
  // A protected script is reported as unreadable; no source is invented.
  assert.equal(
    byPath.get("ReplicatedStorage/Util_bbbbbbbb.luau").readable,
    false,
  );
  assert.equal(byPath.get("ReplicatedStorage/Util_bbbbbbbb.luau").source, null);
  assert.match(context.payload.note, /readable:false/);
});

test("a source already in the project files is named, not repeated", () => {
  const same = "print(1)";
  const context = buildStudioContext(
    snapshot([
      root("sss", "ServerScriptService", "ServerScriptService"),
      script(
        "s1",
        "sss",
        "Same",
        "ServerScriptService/Same_cccccccc.luau",
        same,
      ),
    ]),
    { "ServerScriptService/Same_cccccccc.luau": same },
  );
  assert.ok(context);
  assert.equal(context.read, 1);
  const entry = context.payload.scripts[0];
  assert.equal(entry.sameAsProject, true);
  assert.equal(entry.source, null);
});

test("a huge script is cut with an explicit marker, never silently", () => {
  const long = "x".repeat(STUDIO_AI_LIMITS.sourceChars + 500);
  const context = buildStudioContext(
    snapshot([
      root("sss", "ServerScriptService", "ServerScriptService"),
      script("s1", "sss", "Big", "ServerScriptService/Big_dddddddd.luau", long),
    ]),
    {},
  );
  assert.ok(context);
  const source = context.payload.scripts[0].source;
  assert.equal(source.length < long.length, true);
  assert.match(source, /\[dipotong: \d+ dari \d+ karakter\]/);
});

test("an absent or invalid snapshot produces no context at all", () => {
  assert.equal(buildStudioContext(null, {}), null);
  assert.equal(buildStudioContext({ version: 1 }, {}), null);
  const broken = snapshot([
    root("sss", "ServerScriptService", "ServerScriptService"),
    // Parent that does not exist: the shared schema refuses the whole snapshot.
    {
      ...script(
        "s1",
        "missing",
        "X",
        "ServerScriptService/X_eeeeeeee.luau",
        "x",
      ),
    },
  ]);
  assert.equal(buildStudioContext(broken, {}), null);
});

test("reading the bridge is best-effort: a missing table or failed read is no context", async () => {
  const query = (result: () => Promise<any>) => ({
    admin: {
      from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: result }) }),
      }),
    },
  });
  assert.equal(await loadStudioSnapshot(null, "p"), null);
  // 006 not applied yet: the chat continues without Studio context.
  assert.equal(
    await loadStudioSnapshot(
      query(async () => ({ data: null, error: { code: "42P01" } })),
      "p",
    ),
    null,
  );
  // A network/read failure must not take the whole turn down either.
  assert.equal(
    await loadStudioSnapshot(
      query(async () => {
        throw new Error("offline");
      }),
      "p",
    ),
    null,
  );
  const row = { snapshot: { version: 1 }, updated_at: "now" };
  assert.deepEqual(
    await loadStudioSnapshot(
      query(async () => ({ data: row, error: null })),
      "p",
    ),
    row,
  );
});
