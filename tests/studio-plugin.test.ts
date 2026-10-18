import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import express from "express";
import { load } from "cheerio";
import { buildPluginRbxmx } from "../scripts/build-plugin-rbxmx.mjs";
import * as THREE from "three";
import { LuauState } from "luau-web";
import { registerStudio } from "../server/routes/studio.mjs";
import { HttpError } from "../server/lib/core.mjs";
import {
  STUDIO_PLUGIN,
  buildBundle,
  snapshotSchema,
} from "../shared/studio.mjs";

// The Studio plugin cannot run in Studio here, so these tests run the real
// public/plugins/PiwuStudio.luau file in Luau (luau-web) on top of a test double
// (tests/support/studio-fake.luau) that mirrors documented Roblox behaviour for
// the APIs the plugin touches. A passing run proves the plugin's own logic and
// its contract with this server — never that Studio behaves the same.
//
// Where a test crosses the bridge it uses the REAL server routes (express +
// registerStudio) instead of a hand-written reply:
//   * the plugin's snapshot goes to POST /api/studio/snapshot as it is,
//   * the scene the plugin builds comes from GET /api/studio/scene,
//   * the status the plugin prints comes from GET /api/studio/status.

const PLUGIN_FILE = "PiwuStudio.luau";
const pluginSource = fs.readFileSync(`public/plugins/${PLUGIN_FILE}`, "utf8");
const fakeSource = fs.readFileSync("tests/support/studio-fake.luau", "utf8");
const PLACE_ID = "7654321";
const WEB_ORIGIN = "https://contoh.test";
const WEB_TOKEN = "token-pasangan-yang-cukup-panjang-1234";
const BUNDLE_ID = "1a2b3c4d-5e6f-4a7b-9c8d-0e1f2a3b4c5d";
/**
 * The scene a project owns. Its rotation is a Three.js XYZ Euler angle — the
 * number src/lib/roblox/scene.ts stores and SceneViewport.tsx renders.
 */
const SCENE = {
  version: 1,
  objects: [
    {
      id: "base",
      name: "Base",
      kind: "block",
      parent: null,
      position: [0, -0.5, 0],
      rotation: [0, 0, 0],
      size: [40, 1, 40],
      color: "#65736e",
      anchored: true,
    },
    {
      id: "body",
      name: "Badan",
      kind: "cylinder",
      parent: null,
      position: [2, 1.5, 3],
      rotation: [20, 30, 40],
      size: [1, 4, 4],
      color: "#2040c0",
      anchored: true,
    },
    {
      id: "ball",
      name: "Kepala",
      kind: "sphere",
      parent: null,
      position: [2, 4, 3],
      rotation: [0, 0, 0],
      size: [2, 2, 2],
      color: "#c02020",
      anchored: true,
    },
    {
      id: "chair",
      name: "Kursi",
      kind: "model",
      parent: null,
      position: [6, 0, 0],
      rotation: [0, 90, 0],
      size: [1, 1, 1],
      color: "#6daea1",
      anchored: true,
    },
    {
      id: "leg",
      name: "Kaki",
      kind: "block",
      parent: "chair",
      position: [0, 0.5, 0],
      rotation: [0, 0, 0],
      size: [0.5, 1, 0.5],
      color: "#7a4a22",
      anchored: true,
    },
    {
      id: "seat",
      name: "Mesh kursi",
      kind: "mesh",
      parent: null,
      position: [12, 1, 0],
      rotation: [0, 0, 0],
      size: [2, 2, 2],
      color: "#4a3018",
      anchored: true,
      mesh: {
        vertices: [
          [-1, 0, -1],
          [1, 0, -1],
          [0, 1, 0],
        ],
        faces: [[0, 1, 2]],
      },
    },
    {
      id: "cushion",
      name: "Bantalan",
      kind: "mesh",
      parent: "chair",
      position: [0, 1, 0],
      rotation: [0, 0, 0],
      size: [1, 0.4, 1],
      color: "#7a4a22",
      anchored: true,
      mesh: {
        vertices: [
          [-1, 0, -1],
          [1, 0, -1],
          [0, 1, 0],
        ],
        faces: [[0, 1, 2]],
      },
    },
    {
      id: "seat2",
      name: "Mesh beraset",
      kind: "mesh",
      parent: null,
      position: [14, 1, 0],
      rotation: [0, 0, 0],
      size: [2, 2, 2],
      color: "#4a3018",
      anchored: true,
      mesh: {
        vertices: [
          [-1, 0, -1],
          [1, 0, -1],
          [0, 1, 0],
        ],
        faces: [[0, 1, 2]],
      },
    },
  ],
};
/** A place the plugin snapshots in most tests. */
const PLACE = [
  {
    service: "Workspace",
    path: "Base",
    class: "Part",
    props: {
      position: [0, 2, 0],
      rotation: [0, 0, 0],
      size: [40, 1, 40],
      color: "#65736e",
      shape: "Block",
    },
  },
  {
    service: "Workspace",
    path: "Crate",
    class: "Part",
    props: {
      position: [3.5, 1, -2],
      rotation: [0, 45, 0],
      size: [2, 2, 2],
      color: "#c02020",
      shape: "Block",
    },
  },
  {
    service: "Workspace",
    path: "Rig",
    class: "Model",
    props: { pivot: [100, 0, 50] },
  },
  {
    service: "ServerScriptService",
    path: "Main",
    class: "Script",
    props: { source: 'print("halo")\n' },
  },
  {
    service: "ReplicatedStorage",
    path: "Shared/Util",
    class: "ModuleScript",
    props: { source: "return {}\n" },
  },
];

/** A Luau string literal for arbitrary text (byte escapes keep UTF-8 safe). */
function luaString(text: string) {
  let out = '"';
  for (const byte of Buffer.from(text, "utf8"))
    if (byte === 0x22) out += '\\"';
    else if (byte === 0x5c) out += "\\\\";
    else if (byte === 0x0a) out += "\\n";
    else if (byte === 0x0d) out += "\\r";
    else if (byte === 0x09) out += "\\t";
    else if (byte < 0x20 || byte > 0x7e) out += "\\" + byte;
    else out += String.fromCharCode(byte);
  return out + '"';
}

const API_PARAMETERS =
  "Instance, Enum, Vector3, CFrame, Color3, UDim, UDim2, game, workspace, plugin, task, DockWidgetPluginGuiInfo, setclipboard, print, warn";
const API_ARGUMENTS =
  "env.Instance, env.Enum, env.Vector3, env.CFrame, env.Color3, env.UDim, env.UDim2, env.game, env.workspace, env.plugin, env.task, env.DockWidgetPluginGuiInfo, env.setclipboard, env.print, env.warn";

type Scenario = {
  /** A flat place fixture for tests/support/studio-fake.luau. */
  tree?: unknown[];
  responses?: Record<string, unknown>;
  /** Luau statements that end with `return env.fake.json(...)`. */
  body: string;
};

/** Runs the plugin once in Luau and returns whatever the scenario returned. */
async function runScenario(scenario: Scenario) {
  const program = [
    fakeSource,
    `env.fake.internals = (function(${API_PARAMETERS})`,
    "local _PIWU_TEST = true",
    pluginSource,
    `end)(${API_ARGUMENTS})`,
    scenario.tree
      ? `env.fake.loadTree(${luaString(JSON.stringify(scenario.tree))})`
      : "",
    scenario.responses
      ? `env.fake.setResponses(${luaString(JSON.stringify(scenario.responses))})`
      : "",
    scenario.body,
  ].join("\n");
  const state = await LuauState.createAsync();
  try {
    const results = await (
      state.loadstring(
        program,
        "studio-plugin-scenario",
        true,
      ) as unknown as () => Promise<unknown>
    )();
    // Luau hands back every value the chunk produced; the scenario returns one.
    const out = Array.isArray(results) ? results[0] : results;
    assert.equal(typeof out, "string", "scenario harus mengembalikan JSON");
    return JSON.parse(out);
  } finally {
    state.destroy();
  }
}

const connect = (origin = WEB_ORIGIN, token = WEB_TOKEN) =>
  `env.fake.connect(${luaString(origin)}, ${luaString(token)})`;

const requestsOf = (out: any) =>
  out.requests as { Method: string; Url: string; Body: string }[];
/** The bridge path a recorded request went to, e.g. "snapshot". */
const pathOf = (request: { Url: string }) =>
  request.Url.replace(/^.*\/api\/studio\//, "");

/** Finds an instance in a place dump by service and path ("" = the service). */
function at(tree: any[], service: string, path: string): any {
  let current = tree.find((node) => node.name === service);
  if (!current) return undefined;
  const children = (node: any) =>
    Array.isArray(node.children) ? node.children : [];
  for (const name of path ? path.split("/") : []) {
    current = children(current).find((child: any) => child.name === name);
    if (!current) return undefined;
  }
  return current;
}

/** The rotation matrix the app's own Three.js viewport would render. */
function expectedMatrix(rotation: number[]) {
  return new THREE.Matrix4().makeRotationFromEuler(
    new THREE.Euler(
      (rotation[0] * Math.PI) / 180,
      (rotation[1] * Math.PI) / 180,
      (rotation[2] * Math.PI) / 180,
      "XYZ",
    ),
  );
}

/** The fake dumps matrices row by row; Three.js stores columns. */
function assertRotation(cell: any, rotation: number[], why: string) {
  const wanted = expectedMatrix(rotation),
    // A Part keeps its transform in CFrame, a Model in its pivot.
    flat = (cell.cframe || cell.pivot || {}).matrix;
  assert.ok(Array.isArray(flat), `${why}: transform tidak ada di dump`);
  for (let row = 0; row < 3; row++)
    for (let col = 0; col < 3; col++)
      assert.ok(
        Math.abs(flat[row * 3 + col] - wanted.elements[col * 4 + row]) < 1e-9,
        `${why}: matriks (${row},${col}) = ${flat[row * 3 + col]}, seharusnya ${wanted.elements[col * 4 + row]}`,
      );
}

test("the shipped plugin and the app agree on one version and one set of limits", () => {
  const version = /local VERSION = "([\d.]+)"/.exec(pluginSource)?.[1];
  assert.equal(
    version,
    STUDIO_PLUGIN.version,
    "versi plugin di file dan di aplikasi harus sama",
  );
  const limits = /local LIMITS = \{([^}]+)\}/.exec(pluginSource)?.[1] || "";
  for (const [key, value] of Object.entries(STUDIO_PLUGIN.limits))
    assert.match(
      limits,
      new RegExp(`${key}\\s*=\\s*${value}\\b`),
      `batas ${key} hilang/berbeda di plugin`,
    );
  // A plugin the user installs by hand must not do anything the app does not
  // promise in docs/ROBLOX.md.
  assert.ok(pluginSource.includes("InsertService"), "mesh lewat InsertService");
  assert.ok(pluginSource.includes("HttpEnabled"), "bantuan izin HTTP");
  assert.ok(
    !/loadstring\s*\(|\brequire\s*\(/.test(pluginSource),
    "tanpa loadstring/require",
  );
  assert.ok(!pluginSource.includes("SetSetting"), "token hanya di memori");
});

test("the .rbxmx a user installs is this exact plugin wrapped once, and the .luau stays the manual fallback", () => {
  const path = `public/plugins/${STUDIO_PLUGIN.bundle}`;
  const rbxmx = fs.readFileSync(path, "utf8");
  assert.equal(
    rbxmx,
    buildPluginRbxmx(pluginSource),
    "berkas .rbxmx harus hasil bungkus dari sumber .luau terbaru (npm run plugin:rbxmx)",
  );
  // A file Studio cannot parse is worse than no file, so the XML is real XML.
  const $ = load(rbxmx, { xmlMode: true });
  const item = $("roblox > Item");
  assert.equal(item.length, 1, "satu instance saja di berkas plugin");
  assert.equal(item.attr("class"), "Script", "plugin lokal dimuat dari Script");
  assert.equal(
    $("roblox").attr("version"),
    "4",
    "versi format XML Roblox yang didukung",
  );
  assert.equal(
    item.find("> Properties > string[name=Name]").text(),
    STUDIO_PLUGIN.name,
  );
  const source = item
    .find("> Properties > ProtectedString[name=Source]")
    .text();
  assert.equal(source, pluginSource, "source tidak berubah saat dibungkus");
  assert.ok(
    !source.includes("]]>"),
    "penutup CDATA tidak boleh muncul di dalam source",
  );
  // Anyone who prefers the documented paste-by-hand route still gets the .luau.
  assert.ok(
    fs
      .readFileSync(`public/plugins/${PLUGIN_FILE}`, "utf8")
      .includes(pluginSource),
  );
});

test("the plugin's own snapshot satisfies the app's schema, with stable ids and an exact rotation round-trip", async () => {
  const out = await runScenario({
    tree: PLACE,
    body: `
      local id = "00000001-0000-4000-8000-000000000001"
      return env.fake.json({
        first = env.fake.decode(env.fake.snapshotJson(id, true)),
        second = env.fake.decode(env.fake.snapshotJson(id, false)),
        version = env.fake.internals.version,
      })
    `,
  });
  assert.equal(out.version, STUDIO_PLUGIN.version);
  const snapshot = snapshotSchema.parse(out.first);
  assert.equal(snapshot.placeId, PLACE_ID);
  // Every service root the plugin lists is exported, so a bundle can always
  // name a parent that exists.
  const roots = snapshot.nodes.filter((node: any) => node.parentId === "");
  assert.ok(roots.length >= 12, `akar service kurang: ${roots.length}`);
  assert.ok(roots.some((node: any) => node.className === "Workspace"));
  const named = (name: string) =>
    snapshot.nodes.find((node: any) => node.name === name);
  const crate = named("Crate");
  assert.ok(crate, "part Crate ada di snapshot");
  assert.deepEqual(crate.properties.position, [3.5, 1, -2]);
  assert.deepEqual(crate.properties.size, [2, 2, 2]);
  assert.equal(crate.properties.color, "#C02020");
  assert.equal(crate.properties.shape, "Block");
  assert.equal(crate.properties.anchored, true);
  assert.notEqual(crate.parentId, "");
  // A 45° rotation on Y must survive the CFrame round-trip undistorted.
  assert.ok(Math.abs(crate.properties.rotation[0]) < 1e-9);
  assert.ok(Math.abs(crate.properties.rotation[1] - 45) < 1e-9);
  assert.ok(Math.abs(crate.properties.rotation[2]) < 1e-9);
  const script = named("Main");
  assert.equal(script.className, "Script");
  assert.equal(script.source, 'print("halo")\n');
  assert.equal(script.readable, true);
  assert.match(
    script.scriptPath,
    /^ServerScriptService\/Main_[\w-]{8}\.server\.luau$/,
  );
  const module = named("Util");
  assert.equal(module.className, "ModuleScript");
  assert.match(
    module.scriptPath,
    /^ReplicatedStorage\/Shared\/Util_[\w-]{8}\.luau$/,
  );
  assert.match(module.scriptPath, /\.luau$/);
  assert.equal(
    new Set(snapshot.nodes.map((node: any) => node.id)).size,
    snapshot.nodes.length,
    "id unik (schema juga memeriksa ini)",
  );
  assert.ok(
    snapshot.nodes.every(
      (node: any) => !/^service:/.test(node.id) || node.parentId === "",
    ),
    "id service hanya untuk akar",
  );
  // Reading again without assigning must give the same bytes: the ids came from
  // the attributes written during the first export.
  assert.deepEqual(out.second, out.first);
});

test("the snapshot the plugin sends is accepted by the real bridge route, and a bundle built from it is queued", async () => {
  const sent = await runScenario({
    tree: PLACE,
    responses: { snapshot: { body: '{"received":true}' } },
    body: `
      ${connect()}
      local status = env.fake.click("send")
      return env.fake.json({
        status = status,
        requests = env.fake.decode(env.fake.requestsJson()),
      })
    `,
  });
  assert.match(sent.status, /Snapshot terkirim/);
  const requests = requestsOf(sent);
  assert.deepEqual(requests.map(pathOf), ["snapshot"]);
  assert.equal(requests[0].Method, "POST");
  assert.equal(requests[0].Url, `${WEB_ORIGIN}/api/studio/snapshot`);
  assert.equal(
    JSON.parse(requests[0].Body).placeId,
    PLACE_ID,
    "place id yang benar-benar dikirim",
  );

  const f = fixture();
  const server = await serve(f);
  try {
    const { token } = await (await browser(server, f, "/connect", {})).json();
    const posted = await fetch(`${server.base}/api/studio/snapshot`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: requests[0].Body,
    });
    const postedBody = await posted.text();
    assert.equal(posted.status, 200, postedBody);
    assert.deepEqual(JSON.parse(postedBody), { received: true });
    const snapshot = JSON.parse(requests[0].Body);
    assert.equal(f.row.snapshot_id, snapshot.snapshotId);
    assert.equal(f.row.snapshot.nodes.length, snapshot.nodes.length);

    // The browser then builds a bundle from that snapshot and queues it.
    const desired = structuredClone(snapshot);
    const crate = desired.nodes.find((node: any) => node.name === "Crate");
    crate.name = "Crate Besar";
    crate.properties.size = [4, 4, 4];
    const files: Record<string, string> = {};
    for (const node of snapshot.nodes)
      if (node.scriptPath) files[node.scriptPath] = node.source;
    const bundle = buildBundle(snapshot, desired, files);
    assert.equal(bundle.changes.length, 1);
    assert.equal(bundle.changes[0].op, "update");
    const queued = await browser(server, f, "/send", bundle);
    assert.equal(queued.status, 200, JSON.stringify(await queued.json()));
    assert.equal(f.row.state, "queued");
    const waiting = await (
      await fetch(`${server.base}/api/studio/pending`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).json();
    assert.equal(waiting.state, "queued");
    assert.equal(waiting.bundle.id, bundle.id);
    assert.equal(waiting.bundle.changes[0].node.name, "Crate Besar");
  } finally {
    await server.close();
  }
});

test("the plugin applies the reviewed bundle it fetched, in one undo step, and reports the receipt", async () => {
  const out = await runScenario({
    tree: PLACE,
    responses: {
      snapshot: { body: '{"received":true}' },
      claim: { body: '{"claimed":true}' },
      ack: { body: '{"recorded":true}' },
    },
    body: `
      ${connect()}
      local sendStatus = env.fake.click("send")
      local requests = env.fake.decode(env.fake.requestsJson())
      -- The bundle the web would send is built from the snapshot the plugin
      -- itself produced, so the ids are the plugin's own.
      local snapshot = env.fake.decode(requests[#requests].Body)
      local function idOf(name)
        for _, node in ipairs(snapshot.nodes) do
          if node.name == name then return node.id end
        end
      end
      local bundle = {
        version = 1,
        id = "${BUNDLE_ID}",
        baseSnapshotId = snapshot.snapshotId,
        placeId = snapshot.placeId,
        changes = {{
          op = "update",
          node = {
            id = idOf("Crate"),
            parentId = idOf("Base"),
            name = "Crate Besar",
            className = "Part",
            properties = {position = {3.5, 1, -2}, rotation = {0, 45, 0}, size = {4, 4, 4}, color = "#c02020", anchored = true, shape = "Ball"},
          },
        }},
      }
      env.fake.setResponses(env.fake.encode({
        pending = {body = env.fake.encode({state = "queued", bundle = bundle})},
        claim = {body = '{"claimed":true}'},
        ack = {body = '{"recorded":true}'},
      }))
      local fetchStatus = env.fake.click("fetch")
      local review = env.fake.reviewText()
      -- The only signal outside the panel: the toolbar button lights up and the
      -- window title says something is waiting.
      local afterFetch = {badge = env.fake.internals.waiting(), title = env.fake.widgetTitle(), active = env.fake.toggleActive()}
      local firstClick = env.fake.click("apply")
      local beforeApply = {badge = env.fake.internals.waiting(), title = env.fake.widgetTitle(), active = env.fake.toggleActive()}
      local secondClick = env.fake.click("apply")
      local afterApply = {badge = env.fake.internals.waiting(), title = env.fake.widgetTitle(), active = env.fake.toggleActive()}
      return env.fake.json({
        sendStatus = sendStatus,
        fetchStatus = fetchStatus,
        review = review,
        firstClick = firstClick,
        secondClick = secondClick,
        afterFetch = afterFetch,
        beforeApply = beforeApply,
        afterApply = afterApply,
        tree = env.fake.decode(env.fake.treeJson()),
        recordings = env.fake.decode(env.fake.recordingsJson()),
        requests = env.fake.decode(env.fake.requestsJson()),
      })
    `,
  });
  assert.match(out.sendStatus, /Snapshot terkirim/);
  assert.match(out.fetchStatus, /1 operasi/);
  assert.match(out.review, /update · Crate Besar \/ Part/);
  assert.equal(out.afterFetch.badge, true, "tombol toolbar menyala");
  assert.match(out.afterFetch.title, /perubahan menunggu/);
  assert.equal(
    out.afterFetch.active,
    true,
    "SetActive dipakai sebagai penanda",
  );
  // The confirmation prompt must not clear the hint: the bundle is still queued.
  assert.equal(out.beforeApply.badge, true);
  assert.equal(
    out.afterApply.badge,
    false,
    "penanda hilang setelah diterapkan",
  );
  assert.equal(out.afterApply.active, false);
  assert.ok(!out.afterApply.title.includes("menunggu"), out.afterApply.title);
  // Applying twice is a deliberate confirmation, not an accident.
  assert.match(out.firstClick, /KONFIRMASI/);
  assert.match(out.secondClick, /Perubahan diterapkan/, out.secondClick);
  assert.deepEqual(requestsOf(out).map(pathOf), [
    "snapshot",
    "pending",
    "claim",
    "ack",
  ]);
  const claim = JSON.parse(requestsOf(out)[2].Body);
  assert.equal(claim.id, BUNDLE_ID);
  assert.equal(claim.snapshot.placeId, PLACE_ID);
  const crate = at(out.tree, "Workspace", "Crate Besar");
  assert.ok(crate, "part diganti nama");
  assert.deepEqual(crate.size, [4, 4, 4]);
  assert.equal(crate.color, "#C02020");
  assert.equal(crate.shape, "Ball", "shape diterapkan lewat Enum.PartType");
  assert.equal(crate.anchored, true);
  assertRotation(crate, [0, 45, 0], "rotasi bundle");
  // One recording, committed: a single Ctrl+Z in Studio undoes the bundle.
  assert.equal(out.recordings.length, 1);
  assert.deepEqual(out.recordings[0].Operations, ["Commit"]);
});

test("the connect button accepts only an HTTPS origin, checks the token, and never keeps it in the panel", async () => {
  const out = await runScenario({
    body: `
      env.fake.internals.ui.origin.Text = "http://contoh.test/studio"
      env.fake.internals.ui.tokenInput.Text = "pendek"
      local badOrigin = env.fake.click("connect")
      env.fake.internals.ui.origin.Text = "https://contoh.test"
      env.fake.internals.ui.tokenInput.Text = "pendek"
      local badToken = env.fake.click("connect")
      env.fake.internals.ui.origin.Text = "https://contoh.test/"
      env.fake.internals.ui.tokenInput.Text = string.rep("a", 40)
      local saved = env.fake.click("connect")
      return env.fake.json({
        badOrigin = badOrigin,
        badToken = badToken,
        saved = saved,
        origin = env.fake.internals.origin(),
        tokenBox = env.fake.internals.ui.tokenInput.Text,
        requests = env.fake.requestsCount(),
      })
    `,
  });
  assert.match(out.badOrigin, /^Gagal: Gunakan origin HTTPS tanpa path/);
  assert.match(out.badToken, /^Gagal: Token pasangan tidak valid/);
  assert.match(out.saved, /Koneksi disimpan hanya di memori/);
  assert.equal(out.origin, WEB_ORIGIN, "garis miring di akhir dibuang");
  assert.equal(out.tokenBox, "", "token tidak ditinggal di kotak teks");
  assert.equal(out.requests, 0, "menyimpan koneksi tidak mengirim apa pun");
});

test("Studio's own plugin permission is what matters: a refusal names Plugin Management, and the Command Bar line stays a last resort", async () => {
  // Studio asks the user for permission per address the first time a plugin
  // reaches out (and remembers the answer under View → Plugin Management). The
  // place setting "Allow HTTP Requests" only governs in-game scripts, so it must
  // never block the plugin, and the plugin must never flip that switch itself.
  const refused =
    "Http requests are not allowed for the plugin 'PiwuStudio'. Enable access in Plugin Management.";
  const off = await runScenario({
    tree: PLACE,
    body: `
      env.fake.setHttpEnabled(false)
      env.fake.setHttpError(${luaString(refused)})
      env.fake.internals.ui.origin.Text = "https://contoh.test"
      env.fake.internals.ui.tokenInput.Text = string.rep("a", 40)
      local saved = env.fake.click("connect")
      local noteAfterSave = env.fake.httpNoteVisible()
      local copied = env.fake.click("copyHttp")
      local checked = env.fake.click("check")
      return env.fake.json({
        saved = saved,
        noteAfterSave = noteAfterSave,
        copied = copied,
        checked = checked,
        note = env.fake.httpNoteVisible(),
        noteText = env.fake.internals.ui.httpNote.Text,
        copyVisible = env.fake.internals.ui.copyHttp.Visible,
        attempts = env.fake.requestsCount(),
      })
    `,
  });
  assert.match(off.saved, /^Koneksi disimpan hanya di memori/, off.saved);
  assert.equal(
    off.noteAfterSave,
    false,
    "menyimpan koneksi tidak butuh HTTP sama sekali",
  );
  assert.match(
    off.checked,
    /^Gagal: Studio menolak permintaan HTTP untuk plugin ini/,
    off.checked,
  );
  assert.equal(off.note, true, "petunjuk izin HTTP tampil setelah penolakan");
  assert.match(off.noteText, /Plugin Management/);
  assert.match(off.noteText, /Izinkan \(Allow\)/);
  assert.ok(
    !off.noteText.includes("masih dimatikan"),
    "jangan menyebut HTTP dimatikan: izin plugin yang salah",
  );
  assert.equal(
    off.attempts,
    1,
    "penolakan dicatat sebagai satu percobaan, tanpa ulangan otomatis",
  );
  assert.equal(
    off.copyVisible,
    true,
    "HTTP place mati: baris darurat ditawarkan",
  );
  assert.match(off.copied, /Command Bar/);

  // With the place setting already on there is nothing left to paste, so the
  // emergency button must disappear and the panel must say so.
  const on = await runScenario({
    body: `
      env.fake.setHttpEnabled(true)
      env.fake.setHttpError(${luaString(refused)})
      ${connect()}
      local checked = env.fake.click("check")
      return env.fake.json({
        checked = checked,
        noteText = env.fake.internals.ui.httpNote.Text,
        copyVisible = env.fake.internals.ui.copyHttp.Visible,
        clipboard = env.fake.clipboardText(),
      })
    `,
  });
  assert.match(on.noteText, /sudah aktif di place ini/);
  assert.equal(on.copyVisible, false);
  assert.ok(!on.clipboard, "tidak ada yang disalin");

  // The switch a plugin may not touch is only ever a string for the user to
  // paste, never something the plugin writes.
  const body = pluginSource.replace(/local HTTP_COMMAND = '[^']*'/, "");
  assert.ok(
    !body.includes("HttpEnabled ="),
    "plugin tidak menulis HttpEnabled",
  );
  assert.ok(
    pluginSource.includes("Plugin Management"),
    "arahan izin yang benar",
  );
});

test("the connection test prints what the real /api/studio/status route answers, and warns only when versions really differ", async () => {
  const f = fixture();
  const server = await serve(f);
  try {
    const { token } = await (await browser(server, f, "/connect", {})).json();
    const sent = await runScenario({
      tree: PLACE,
      responses: { snapshot: { body: '{"received":true}' } },
      body: `
        ${connect()}
        local status = env.fake.click("send")
        return env.fake.json({status = status, body = env.fake.decode(env.fake.requestsJson())[1].Body})
      `,
    });
    assert.match(sent.status, /Snapshot terkirim/);
    const snapshot = JSON.parse(sent.body);
    const posted = await fetch(`${server.base}/api/studio/snapshot`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: sent.body,
    });
    assert.equal(posted.status, 200, await posted.text());
    const desired = structuredClone(snapshot);
    desired.nodes.find((node: any) => node.name === "Crate").name =
      "Crate Besar";
    const files: Record<string, string> = {};
    for (const node of snapshot.nodes)
      if (node.scriptPath) files[node.scriptPath] = node.source;
    assert.equal(
      (await browser(server, f, "/send", buildBundle(snapshot, desired, files)))
        .status,
      200,
    );

    const response = await fetch(`${server.base}/api/studio/status`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(response.status, 200);
    const status = await response.json();
    // What the route really answers, in the shape the plugin reads.
    assert.equal(status.plugin.version, STUDIO_PLUGIN.version);
    assert.deepEqual(status.limits, STUDIO_PLUGIN.limits);
    assert.equal(status.project.name, "Pulau obby");
    assert.equal(status.bridge.queuedChanges, 1);
    assert.equal(status.scene.objects, SCENE.objects.length);
    assert.equal(status.scene.meshes.total, 3);
    assert.equal(status.scene.meshes.withAsset, 2);
    assert.equal(status.assets.configured, false);

    const seen = await runScenario({
      responses: { status: { body: JSON.stringify(status) } },
      body: `
        ${connect()}
        local text = env.fake.click("check")
        return env.fake.json({text = text, review = env.fake.reviewText()})
      `,
    });
    assert.ok(
      seen.text.includes(
        `Koneksi OK · project Pulau obby · server memakai plugin ${STUDIO_PLUGIN.version}`,
      ),
      seen.text,
    );
    // The one line a user needs when Studio asks for permission by address.
    assert.match(seen.review, /Izin HTTP plugin: aktif untuk alamat ini/);
    assert.match(seen.review, /Plugin Management/);
    assert.match(seen.review, /Project: Pulau obby \(roblox\)/);
    assert.match(seen.review, /1 perubahan menunggu/);
    assert.match(
      seen.review,
      /Snapshot tersimpan di server: \d+ instance · place 7654321/,
    );
    assert.match(
      seen.review,
      /Scene project: 8 objek · 3 mesh kustom \(2 punya aset Roblox\)/,
    );
    assert.match(
      seen.review,
      /Unggah aset ke Roblox di server ini: belum dikonfigurasi \(pakai impor GLB manual\)/,
    );
    assert.ok(
      !seen.review.includes("VERSI BEDA"),
      "versi yang sama tidak boleh memunculkan peringatan",
    );

    // A different plugin build and a snapshot from another place are reported.
    const stale = await runScenario({
      responses: {
        status: {
          body: JSON.stringify({
            ...status,
            plugin: { version: "9.9.9" },
            bridge: { ...status.bridge, placeId: "111" },
          }),
        },
      },
      body: `
        ${connect()}
        local text = env.fake.click("check")
        return env.fake.json({text = text, review = env.fake.reviewText()})
      `,
    });
    assert.match(stale.review, /VERSI BEDA: server memakai plugin 9\.9\.9/);
    assert.match(stale.review, /\(BEDA dengan place ini!\)/);
    assert.match(
      stale.review,
      /PERINGATAN: snapshot terakhir dikirim dari place lain/,
    );
  } finally {
    await server.close();
  }
});

test("importing the project scene builds real Parts and Models, keeps the renderer's rotation, and skips what it cannot know", async () => {
  const f = fixture();
  const server = await serve(f);
  try {
    const { token } = await (await browser(server, f, "/connect", {})).json();
    const scene = await fetch(`${server.base}/api/studio/scene`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(scene.status, 200);
    const sceneBody = await scene.json();
    assert.equal(sceneBody.scene.objects.length, SCENE.objects.length);

    const out = await runScenario({
      tree: PLACE,
      responses: { scene: { body: JSON.stringify(sceneBody) } },
      body: `
        ${connect()}
        local imported = env.fake.click("scene")
        local review = env.fake.reviewText()
        local first = env.fake.click("sceneApply")
        local second = env.fake.click("sceneApply")
        return env.fake.json({
          imported = imported,
          review = review,
          first = first,
          second = second,
          build = env.fake.reviewText(),
          tree = env.fake.decode(env.fake.treeJson()),
          assets = env.fake.decode(env.fake.loadedAssetsJson()),
          recordings = env.fake.decode(env.fake.recordingsJson()),
        })
      `,
    });
    assert.match(out.imported, /8 objek siap dibangun \(3 mesh kustom\)/);
    // The server's own note about the mesh without an asset is shown verbatim.
    assert.match(
      out.review,
      /CATATAN: 1 mesh kustom belum punya aset Roblox: Mesh kursi/,
    );
    assert.match(out.review, /Folder tujuan: Workspace → PiwuScene/);
    assert.match(out.first, /KONFIRMASI: bangun 8 objek/);
    assert.match(out.second, /Scene dibangun: 7 instance, 1 dilewati/);
    assert.match(
      out.build,
      /Part: 4 · Model: 1 · Mesh dari aset Roblox: 2/,
      out.build,
    );
    assert.match(out.build, /· Mesh kursi \(mesh kustom tanpa aset Roblox\)/);
    assert.match(out.build, /Ekspor GLB di panel Properti PiwuApp/);
    assert.deepEqual(
      out.assets,
      [87654321, 12345678],
      "hanya mesh beraset disisipkan, sesuai urutan scene",
    );
    assert.deepEqual(
      out.recordings.map((recording: any) => recording.Operations),
      [["Commit"]],
      "satu recording Undo untuk seluruh impor",
    );

    // The folder the app's own viewport would show, now as real instances.
    const folder = at(out.tree, "Workspace", "PiwuScene");
    assert.ok(folder, "folder PiwuScene dibuat di Workspace");
    assert.equal(folder.class, "Folder");
    const base = at(out.tree, "Workspace", "PiwuScene/Base");
    assert.equal(base.class, "Part");
    assert.equal(base.shape, "Block");
    assert.deepEqual(base.size, [40, 1, 40]);
    assert.equal(base.color, "#65736E");
    assert.equal(base.anchored, true);
    assert.deepEqual(base.cframe.position, [0, -0.5, 0]);
    assert.equal(base.attributes.PiwuBridgeId, "scene:base");
    const body = at(out.tree, "Workspace", "PiwuScene/Badan");
    assert.equal(body.shape, "Cylinder", "silinder tetap silinder");
    assert.deepEqual(body.size, [1, 4, 4], "sumbu panjang silinder di X");
    assert.equal(at(out.tree, "Workspace", "PiwuScene/Kepala").shape, "Ball");
    // A scene rotation is a Three.js XYZ Euler angle: the imported Part must end
    // up with exactly that rotation, or a model lands in Studio tilted.
    assertRotation(body, SCENE.objects[1].rotation, "rotasi scene");
    // A Model gets its own pivot; its children are placed relative to it.
    const chair = at(out.tree, "Workspace", "PiwuScene/Kursi");
    const leg = at(out.tree, "Workspace", "PiwuScene/Kursi/Kaki");
    assert.equal(chair.class, "Model");
    assert.equal(chair.attributes.PiwuBridgeId, "scene:chair");
    assert.deepEqual(chair.pivot.position, [6, 0, 0]);
    assertRotation(chair, SCENE.objects[3].rotation, "pivot model");
    assert.ok(Math.abs(leg.cframe.position[0] - 6) < 1e-9);
    assert.ok(Math.abs(leg.cframe.position[1] - 0.5) < 1e-9);
    assert.ok(Math.abs(leg.cframe.position[2]) < 1e-9);
    // A child of a Model sits inside it, so moving that Model in Studio moves the
    // part — and its world position must survive the parent's own 90° rotation.
    const cushion = at(out.tree, "Workspace", "PiwuScene/Kursi/Bantalan");
    assert.ok(cushion, "mesh anak Model masuk ke dalam Model");
    assert.equal(cushion.assetId, 87654321);
    assert.equal(cushion.attributes.PiwuBridgeId, "scene:cushion");
    assert.deepEqual(cushion.pivot.position, [6, 1, 0]);
    assert.equal(
      at(out.tree, "Workspace", "PiwuScene/Bantalan"),
      undefined,
      "tidak ada duplikat di luar Model",
    );
    // The mesh without an asset is never invented; the one with an asset
    // arrives as the asset Roblox already holds.
    assert.equal(at(out.tree, "Workspace", "PiwuScene/Mesh kursi"), undefined);
    const loaded = at(out.tree, "Workspace", "PiwuScene/Mesh beraset");
    assert.ok(loaded, "mesh beraset disisipkan dari aset Roblox");
    assert.equal(loaded.assetId, 12345678);
    assert.equal(loaded.attributes.PiwuBridgeId, "scene:seat2");
    assert.deepEqual(loaded.pivot.position, [14, 1, 0]);
  } finally {
    await server.close();
  }
});

test("a second import can be rooted in the selected Model and takes its pivot", async () => {
  const out = await runScenario({
    tree: PLACE,
    responses: {
      scene: {
        body: JSON.stringify({
          project: { id: "p-1", name: "Pulau obby" },
          scene: SCENE,
          assets: {
            seat2: { assetId: "12345678", name: "Mesh beraset" },
            cushion: { assetId: "87654321", name: "Bantalan" },
          },
          summary: {
            objects: 8,
            kinds: { block: 2, cylinder: 1, sphere: 1, model: 1, mesh: 3 },
            meshes: {
              total: 3,
              withAsset: 2,
              withoutAsset: 1,
              missing: ["Mesh kursi"],
            },
          },
          notes: [],
        }),
      },
    },
    body: `
      ${connect()}
      env.fake.selectFolder("workspace/Rig")
      env.fake.click("sceneInSelection")
      local toggled = env.fake.internals.ui.buttons.sceneInSelection.Text
      local imported = env.fake.click("scene")
      local review = env.fake.reviewText()
      local first = env.fake.click("sceneApply")
      local second = env.fake.click("sceneApply")
      return env.fake.json({
        toggled = toggled,
        imported = imported,
        review = review,
        first = first,
        second = second,
        tree = env.fake.decode(env.fake.treeJson()),
      })
    `,
  });
  assert.match(out.toggled, /objek terpilih sebagai induk: YA/);
  assert.match(out.review, /Folder tujuan: objek terpilih → PiwuScene/);
  assert.match(out.imported, /8 objek siap dibangun/);
  assert.match(
    out.first,
    /KONFIRMASI: bangun 8 objek dari scene project ke objek terpilih/,
  );
  assert.match(out.second, /Scene dibangun: 7 instance, 1 dilewati/);
  // The chosen Model is the root, and its pivot places everything.
  assert.equal(at(out.tree, "Workspace", "Rig/PiwuScene"), undefined);
  assert.deepEqual(
    at(out.tree, "Workspace", "Rig/Kepala").cframe.position,
    [102, 4, 53],
  );
  assert.deepEqual(
    at(out.tree, "Workspace", "Rig/Base").cframe.position,
    [100, -0.5, 50],
  );
  assert.deepEqual(
    at(out.tree, "Workspace", "Rig/Mesh beraset").pivot.position,
    [114, 1, 50],
  );
  // Nesting keeps the chosen Model as the parent of the whole chair.
  assert.deepEqual(
    at(out.tree, "Workspace", "Rig/Kursi/Kaki").cframe.position,
    [106, 0.5, 50],
  );
  assert.deepEqual(
    at(out.tree, "Workspace", "Rig/Kursi/Bantalan").pivot.position,
    [106, 1, 50],
  );
});

test("a scene the plugin cannot trust is refused, and nothing is built", async () => {
  const broken = {
    project: { id: "p-1", name: "Rusak" },
    scene: {
      version: 1,
      objects: [
        {
          id: "a",
          name: "Tanpa parent sah",
          kind: "block",
          parent: "ghost",
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          size: [1, 1, 1],
          color: "#ffffff",
          anchored: true,
        },
      ],
    },
    assets: {},
    summary: { objects: 1, kinds: { block: 1 }, meshes: { total: 0 } },
    notes: [],
  };
  const out = await runScenario({
    responses: { scene: { body: JSON.stringify(broken) } },
    body: `
      ${connect()}
      local imported = env.fake.click("scene")
      local built = env.fake.click("sceneApply")
      return env.fake.json({
        imported = imported,
        built = built,
        instances = env.fake.instanceCount(),
        recordings = env.fake.recordingsCount(),
      })
    `,
  });
  assert.match(out.imported, /^Gagal: Parent objek scene bukan Model/);
  assert.match(out.built, /Impor scene project dahulu supaya bisa ditinjau/);
  assert.equal(out.instances, 0, "tidak ada instance yang dibuat");
  assert.equal(out.recordings, 0, "tidak ada recording Undo yang dibuka");
});

test("a bundle that touches protected objects is refused before any mutation", async () => {
  const out = await runScenario({
    tree: PLACE,
    responses: { snapshot: { body: '{"received":true}' } },
    body: `
      ${connect()}
      env.fake.click("send")
      local snapshot = env.fake.decode(env.fake.decode(env.fake.requestsJson())[1].Body)
      local service = nil
      for _, node in ipairs(snapshot.nodes) do
        if node.className == "Workspace" then service = node.id end
      end
      local bundle = {
        version = 1,
        id = "${BUNDLE_ID}",
        baseSnapshotId = snapshot.snapshotId,
        placeId = snapshot.placeId,
        changes = {{op = "delete", id = service}},
      }
      local result = env.fake.decode(env.fake.applyBundleFlowJson(env.fake.encode(bundle), snapshot.snapshotId))
      return env.fake.json({
        result = result,
        tree = env.fake.decode(env.fake.treeJson()),
        recordings = env.fake.recordingsCount(),
      })
    `,
  });
  assert.equal(out.result.ok, false);
  assert.equal(
    out.result.stage,
    "validate",
    "ditolak sebelum recording dibuka",
  );
  assert.match(String(out.result.error), /Service root tidak boleh diubah/);
  assert.equal(out.recordings, 0, "tidak ada recording yang dibuka");
  assert.ok(
    JSON.stringify(out.tree).includes('"name":"Base"'),
    "place tidak berubah",
  );
});

test("the queue is checked quietly by default, only tells the user, and switching it off really stops asking", async () => {
  const queued = {
    pending: {
      body: JSON.stringify({
        state: "queued",
        bundle: {
          id: BUNDLE_ID,
          changes: [{ op: "update" }, { op: "delete" }],
        },
      }),
    },
  };
  const watching = await runScenario({
    responses: queued,
    body: `
      ${connect()}
      local before = env.fake.reviewText()
      local initial = env.fake.internals.ui.buttons.autoPoll.Text
      local ran = env.fake.runSpawned(1, ${luaString(JSON.stringify(queued))})
      return env.fake.json({
        initial = initial,
        ran = ran,
        status = env.fake.statusText(),
        review = env.fake.reviewText(),
        before = before,
        badge = env.fake.internals.waiting(),
        active = env.fake.toggleActive(),
        requests = env.fake.decode(env.fake.requestsJson()),
      })
    `,
  });
  assert.match(watching.initial, /Periksa antrean otomatis tiap 20 detik: YA/);
  assert.equal(
    watching.badge,
    true,
    "pemberitahuan hanya menandai, tidak menerapkan",
  );
  assert.equal(watching.active, true);
  assert.equal(watching.ran, "ok", "satu putaran pemeriksaan selesai");
  assert.match(watching.status, /Ada 2 perubahan menunggu di PiwuApp/);
  assert.match(watching.status, /Klik 2 · Ambil & tinjau perubahan/);
  assert.equal(
    watching.review,
    watching.before,
    "ringkasan tidak berubah tanpa tinjauan",
  );
  // Polling only ever reads the queue: the bundle is fetched by the button.
  assert.deepEqual(requestsOf(watching).map(pathOf), ["pending"]);
  assert.equal(watching.requests[0].Method, "GET");

  const paused = await runScenario({
    responses: queued,
    body: `
      ${connect()}
      env.fake.click("autoPoll")
      local toggled = env.fake.internals.ui.buttons.autoPoll.Text
      local ran = env.fake.runSpawned(1, ${luaString(JSON.stringify(queued))})
      return env.fake.json({
        toggled = toggled,
        ran = ran,
        attempts = env.fake.requestsCount(),
        badge = env.fake.internals.waiting(),
        status = env.fake.statusText(),
      })
    `,
  });
  assert.match(paused.toggled, /tiap 20 detik: TIDAK/);
  assert.equal(paused.ran, "ok");
  assert.equal(paused.attempts, 0, "polling yang dimatikan tidak bertanya");
  assert.equal(paused.badge, false, "tidak ada penanda palsu");
  assert.ok(
    !/menunggu di PiwuApp/.test(paused.status),
    "tidak ada pemberitahuan saat polling dimatikan",
  );
});

test("the optional asset upload answers honestly when the server has no Open Cloud key, and uses it when it has one", async () => {
  const glb = Buffer.alloc(64);
  glb.writeUInt32LE(0x46546c67, 0); // "glTF"
  glb.writeUInt32LE(2, 4);
  glb.writeUInt32LE(64, 8);
  const payload = {
    name: "Mesh kursi",
    objectId: "seat2",
    glb: glb.toString("base64"),
  };

  const off = fixture();
  const withoutKey = await serve(off);
  try {
    const response = await browser(withoutKey, off, "/assets", payload);
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.match(body.error, /ROBLOX_OPEN_CLOUD_KEY/);
    assert.match(body.error, /Jalur manual tetap tersedia/);
    const poll = await fetch(
      `${withoutKey.base}/api/projects/${off.project}/studio/assets?operation=operations/x`,
      { headers: { Authorization: "Bearer browser-test" } },
    );
    assert.equal(poll.status, 503);
  } finally {
    await withoutKey.close();
  }

  const calls: string[] = [];
  const on = fixture({
    env: {
      ROBLOX_OPEN_CLOUD_KEY: "kunci-uji",
      ROBLOX_ASSET_CREATOR_ID: "999",
    },
    fetcher: async (url: string, init: any) => {
      calls.push(`${init?.method || "GET"} ${String(url)}`);
      if (String(url).endsWith("/assets/v1/assets"))
        return new Response(JSON.stringify({ path: "operations/upload-1" }), {
          status: 200,
        });
      return new Response(
        JSON.stringify({
          done: true,
          response: {
            assetId: "1234567890",
            moderationResult: { moderationState: "Reviewing" },
          },
        }),
        { status: 200 },
      );
    },
  });
  const withKey = await serve(on);
  try {
    const response = await browser(withKey, on, "/assets", payload);
    assert.equal(response.status, 200, await response.clone().text());
    const body = await response.json();
    assert.deepEqual(calls, [
      "POST https://apis.roblox.com/assets/v1/assets",
      "GET https://apis.roblox.com/assets/v1/operations/upload-1",
    ]);
    assert.equal(body.assetId, "1234567890");
    assert.equal(body.objectId, "seat2");
    assert.equal(body.bytes, 64);
    assert.equal(body.creator, "user:999");
    assert.match(body.notice, /moderasi Roblox/);
    assert.match(body.note, /moderasi: Reviewing/);
    // A file that is not a GLB is refused before anything is uploaded.
    const bad = await browser(withKey, on, "/assets", {
      ...payload,
      glb: Buffer.alloc(64).toString("base64"),
    });
    assert.equal(bad.status, 400);
    assert.match((await bad.json()).error, /bukan GLB/);
    assert.equal(
      calls.length,
      2,
      "tidak ada unggahan untuk berkas yang bukan GLB",
    );
  } finally {
    await withKey.close();
  }
});

const liveBody = (claimBody: string, runLimit: number) => `
  ${connect()}
  env.fake.click("send")
  local requests = env.fake.decode(env.fake.requestsJson())
  local snapshot = env.fake.decode(requests[#requests].Body)
  local function idOf(name)
    for _, node in ipairs(snapshot.nodes) do
      if node.name == name then return node.id end
    end
  end
  local bundle = {
    version = 1,
    id = "${BUNDLE_ID}",
    baseSnapshotId = snapshot.snapshotId,
    placeId = snapshot.placeId,
    changes = {{
      op = "update",
      node = {
        id = idOf("Crate"),
        parentId = idOf("Base"),
        name = "Crate Besar",
        className = "Part",
        properties = {position = {3.5, 1, -2}, rotation = {0, 45, 0}, size = {4, 4, 4}, color = "#c02020", anchored = true, shape = "Block"},
      },
    }},
  }
  env.fake.setResponses(env.fake.encode({
    pending = {body = env.fake.encode({state = "queued", bundle = bundle})},
    claim = ${claimBody},
    ack = {body = '{"recorded":true}'},
    snapshot = {body = '{"received":true}'},
  }))
  local liveBefore = env.fake.internals.ui.buttons.liveSync.Text
  env.fake.click("liveSync")
  local liveAfter = env.fake.internals.ui.buttons.liveSync.Text
  local liveRun = env.fake.runSpawned(${runLimit})
  local tree = env.fake.decode(env.fake.treeJson())
  local after = {status = env.fake.statusText(), badge = env.fake.internals.waiting(), requests = env.fake.decode(env.fake.requestsJson()), recordings = env.fake.recordingsCount()}
  return env.fake.json({
    liveBefore = liveBefore,
    liveAfter = liveAfter,
    liveRun = liveRun,
    tree = tree,
    after = after,
    status = env.fake.statusText(),
    liveNow = env.fake.internals.live(),
  })
`;

test("live sync is opt-in: off by default, then applies a sent bundle and snapshots back", async () => {
  const out = await runScenario({
    tree: PLACE,
    responses: { snapshot: { body: '{"received":true}' } },
    body: liveBody(`{body = '{"claimed":true}'}`, 2),
  });
  assert.match(out.liveBefore, /Sinkron langsung PiwuApp → Studio: TIDAK/);
  assert.match(out.liveAfter, /YA · terapkan dalam ~5 detik/);
  assert.equal(out.liveRun, "ok");
  assert.ok(JSON.stringify(out.tree).includes("Crate Besar"));
  assert.deepEqual(requestsOf(out.after).map(pathOf).slice(-5), [
    "pending",
    "claim",
    "ack",
    "snapshot",
    "pending",
  ]);
  assert.equal(out.after.badge, false);
  assert.match(out.after.status, /Sinkron langsung: 1 perubahan diterapkan/);
  assert.equal(out.after.recordings, 1);
  assert.equal(out.liveNow, true, "live tetap menyala setelah keberhasilan");
  assert.equal(
    requestsOf(out.after).filter((r) => pathOf(r) === "claim").length,
    1,
    "bundle yang sama tidak diterapkan dua kali",
  );
});

test("a rejected claim turns live sync off and never retries or mutates", async () => {
  const out = await runScenario({
    tree: PLACE,
    responses: { snapshot: { body: '{"received":true}' } },
    body: liveBody(
      `{ok = false, status = 409, body = '{"error":"Snapshot telah berubah."}'}`,
      1,
    ),
  });
  assert.match(out.liveBefore, /TIDAK/);
  assert.equal(out.liveRun, "ok");
  assert.equal(out.liveNow, false, "kegagalan mematikan live");
  assert.match(out.status, /DIMATIKAN/);
  assert.match(out.status, /Snapshot telah berubah/);
  assert.ok(
    JSON.stringify(out.tree).includes('"name":"Crate"'),
    "place tidak berubah saat claim ditolak",
  );
  assert.equal(
    requestsOf(out.after).filter((r) => pathOf(r) === "claim").length,
    1,
    "claim hanya dicoba sekali",
  );
  assert.equal(
    requestsOf(out.after).filter((r) => pathOf(r) === "snapshot").length,
    1,
    "tidak ada snapshot balik setelah kegagalan",
  );
  assert.equal(out.liveNow, false);
});

/**
 * The same fixture tests/studio-api.test.ts uses: authenticated routes, a fake
 * database, and a Roblox project that really owns a scene and one asset id.
 */
function fixture(options: { env?: any; fetcher?: any } = {}) {
  const project = crypto.randomUUID(),
    user = crypto.randomUUID();
  let row: any = null,
    allowed = true;
  const payload = {
    kind: "roblox",
    name: "Pulau obby",
    files: {
      "scene.roblox.json": JSON.stringify(SCENE),
      "studio.assets.json": JSON.stringify({
        version: 1,
        assets: {
          cushion: {
            assetId: "87654321",
            name: "Bantalan",
            at: "2026-10-16T00:00:00.000Z",
            moderationState: "Reviewing",
          },
          seat2: {
            assetId: "12345678",
            name: "Mesh beraset",
            at: "2026-10-16T00:00:00.000Z",
            moderationState: "Approved",
          },
        },
      }),
    },
  };
  const admin = {
    from: (name: string) => {
      let action = "select",
        value: any,
        filters: Record<string, any> = {};
      const q: any = {
        select: () => q,
        eq: (key: string, v: any) => {
          filters[key] = v;
          return q;
        },
        insert: (v: any) => {
          action = "insert";
          value = v;
          return q;
        },
        update: (v: any) => {
          action = "update";
          value = v;
          return q;
        },
        delete: () => {
          action = "delete";
          return q;
        },
        maybeSingle: () => q,
        single: () => q,
      };
      q.then = (resolve: any, reject: any) =>
        Promise.resolve()
          .then(() => {
            if (name === "projects")
              return {
                data: { owner_id: allowed ? user : crypto.randomUUID() },
                error: null,
              };
            if (name === "collaborators") return { data: null, error: null };
            if (name === "platform_user_controls")
              return { data: null, error: null };
            if (name === "platform_project_controls")
              return { data: { locked: false }, error: null };
            if (name === "site_configuration")
              return {
                data: { revision: 1, value: { maintenance: false } },
                error: null,
              };
            if (name !== "studio_bridges") throw Error(name);
            if (action === "insert") {
              row = structuredClone(value);
              return { data: structuredClone(row), error: null };
            }
            if (
              !row ||
              !Object.entries(filters).every(([key, v]) => row[key] === v)
            )
              return { data: null, error: null };
            if (action === "delete") row = null;
            if (action === "update")
              row = { ...row, ...structuredClone(value) };
            return { data: row ? structuredClone(row) : null, error: null };
          })
          .then(resolve, reject);
      return q;
    },
  };
  const ctx: any = {
    admin,
    env: options.env || {},
    fetcher: options.fetcher || fetch,
    needAdmin: () => admin,
    auth: (req: any, res: any, next: any) => {
      if (req.get("Authorization") !== "Bearer browser-test")
        return res.status(401).json({ error: "auth" });
      req.user = { id: user };
      next();
    },
    project: () => (req: any, res: any, next: any) => {
      if (!allowed) return res.status(403).json({ error: "role" });
      req.project = { id: project };
      next();
    },
    snapshot: async () => ({ payload }),
  };
  return {
    ctx,
    project,
    user,
    get row() {
      return row;
    },
    deny: () => (allowed = false),
  };
}

/** Boots the Studio routes on a random port, like tests/studio-api.test.ts. */
async function serve(f: ReturnType<typeof fixture>) {
  const app = express();
  app.use(express.json({ limit: "4mb" }));
  registerStudio(app, f.ctx);
  app.use((error: any, _req: any, res: any, _next: any) =>
    res
      .status(error instanceof HttpError ? error.status : 400)
      .json({ error: error.message }),
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  return {
    base,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

/** A browser call to a project Studio route, with the fixture's own auth. */
async function browser(
  server: { base: string },
  f: ReturnType<typeof fixture>,
  path: string,
  body: unknown,
) {
  return fetch(`${server.base}/api/projects/${f.project}/studio${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Authorization: "Bearer browser-test",
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
