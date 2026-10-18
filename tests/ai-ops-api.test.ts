import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../server/app.mjs";
import { SCENE_PATH } from "../server/lib/ai-ops.mjs";
import { defaultSite } from "../server/lib/platform.mjs";

// End-to-end proof that a reply carrying ops reaches the browser as an applied
// scene plus an honest report: the fake provider speaks the OpenAI-compatible
// SSE contract, everything else is the real route, auth and credit flow.
const ids = { member: "7f1c3d2e-1111-4222-8333-444455556666" };

const savedScene = (kind: string) =>
  JSON.stringify(
    {
      version: 1,
      objects: [
        {
          id: "obj-rumah",
          name: "Rumah",
          kind: "model",
          parent: null,
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          size: [1, 1, 1],
          color: "#ffffff",
          anchored: true,
        },
        {
          id: "obj-atap",
          name: "Atap",
          kind: "block",
          parent: "obj-rumah",
          position: [0, 5, 0],
          rotation: [0, 0, 0],
          size: [10, 1, 10],
          color: "#aa0000",
          anchored: true,
        },
      ],
    },
    ...(kind === "text" ? [] : ([null, 2] as const)),
  );

function fixture({
  kind = "roblox",
  reply,
  studio,
}: {
  kind?: string;
  reply: any;
  studio?: any;
}) {
  const calls: string[] = [];
  const chats: any[] = [];
  const fetcher = async (input: any, init: any = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    const path = url.pathname;
    if (path.endsWith("/chat/completions")) {
      calls.push("chat");
      const body = JSON.parse(init.body);
      chats.push(body);
      calls.push("model:" + body.model);
      const content = JSON.stringify(reply);
      return new Response(
        `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: [DONE]\n\n`,
        { status: 200, headers: { "Content-Type": "text/event-stream" } },
      );
    }
    calls.push(path);
    const json = (data: any, status = 200) =>
      new Response(JSON.stringify(data), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    if (path === "/auth/v1/user")
      return json({
        id: ids.member,
        email: "member@example.test",
        email_confirmed_at: "2026-01-01",
        user_metadata: {},
      });
    if (path === "/rest/v1/projects")
      return json([
        {
          id: url.searchParams.get("id")?.replace("eq.", ""),
          owner_id: ids.member,
          name: "Project uji",
          kind,
        },
      ]);
    if (path === "/rest/v1/collaborators") return json([]);
    if (path === "/rest/v1/platform_project_controls") return json([]);
    if (path === "/rest/v1/platform_user_controls") return json([]);
    if (path === "/rest/v1/platform_admins") return json([]);
    if (path === "/rest/v1/site_configuration")
      return json([{ revision: 1, value: defaultSite }]);
    if (path === "/rest/v1/studio_bridges") return json(studio ?? {});
    if (path === "/rest/v1/project_workspaces")
      return json({
        payload: {
          id: crypto.randomUUID(),
          kind,
          name: "Project uji",
          files: {},
        },
        revision: 1,
      });
    if (path.startsWith("/rest/v1/rpc/")) {
      calls.push("rpc:" + path.replace("/rest/v1/rpc/", ""));
      return json({ remaining: 27, balance: 27 });
    }
    throw new Error("Unexpected fixture query: " + path + url.search);
  };
  return { fetcher, calls, chats };
}

async function run(options: {
  kind?: string;
  mode?: string;
  reply: any;
  attachments?: any[];
  photoPalettes?: any[];
  studio?: any;
}) {
  const fx = fixture(options);
  const { app } = createApp({
    env: {
      VITE_SUPABASE_URL: "https://test.supabase.co",
      VITE_SUPABASE_ANON_KEY: "test",
      SUPABASE_SERVICE_ROLE_KEY: "server-test",
      LLM_BASE_URL: "https://provider.test/v1",
      LLM_API_KEY: "sk-test-placeholder-not-a-credential",
      LLM_MODEL: "deepseek-chat",
    },
    fetcher: fx.fetcher,
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((ready) => server.once("listening", ready));
  const url = "http://127.0.0.1:" + (server.address() as any).port;
  const response = await fetch(
    url + "/api/projects/" + crypto.randomUUID() + "/ai",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer member",
      },
      body: JSON.stringify({
        requestId: crypto.randomUUID(),
        prompt: "Geser atap dua stud ke kanan dan simpan proyek.",
        mode: options.mode || "Builder",
        model: "Otomatis",
        files: { [SCENE_PATH]: savedScene("text") },
        ...(options.attachments ? { attachments: options.attachments } : {}),
        ...(options.photoPalettes
          ? { photoPalettes: options.photoPalettes }
          : {}),
      }),
    },
  );
  const text = await response.text();
  if (!response.ok && !text.startsWith("data:"))
    throw new Error(`HTTP ${response.status}: ${text.slice(0, 300)}`);
  server.close();
  const events = text
    .split("\n\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice(6)));
  return { status: response.status, events, chats: fx.chats };
}

const resultOf = (events: any[]) =>
  events.find((e) => e.type === "result")?.result;

test("AI ops wiring: a transform batch reaches the browser as an applied scene and a report", async () => {
  const { status, events } = await run({
    kind: "roblox",
    reply: {
      content: "Atap digeser dua stud dan model diperbesar dua kali.",
      ops: [
        {
          kind: "scene.transform",
          ops: [
            { target: "obj-atap", move: [2, 0, 0], color: "#2857AA" },
            { target: "Rumah", scale: 2 },
          ],
        },
      ],
    },
  });
  assert.equal(status, 200);
  const result = resultOf(events);
  assert.equal(result.ops.sceneChanged, true);
  assert.equal(result.ops.applied.length, 2);
  const scene = JSON.parse(result.files[SCENE_PATH]);
  const atap = scene.objects.find((o: any) => o.id === "obj-atap");
  // Model scaling moves the child; the move/colour from the first op survives.
  assert.deepEqual(atap.position, [4, 10, 0]);
  assert.deepEqual(atap.size, [20, 2, 20]);
  assert.equal(atap.color, "#2857aa");
  assert.equal(scene.objects.find((o: any) => o.id === "obj-rumah").size[0], 1);
  // The streamed content and the report both reach the client.
  assert.match(result.content, /Atap digeser/);
  assert.equal(result.creditsUsed, 3);
  assert.match(result.ops.note, /Tinjau sebelum dipakai/);
  assert.ok(events.some((e) => e.type === "token"));
});

test("a Roblox turn reads the latest Studio snapshot without importing it first", async () => {
  const source =
    'local ReplicatedStorage = game:GetService("ReplicatedStorage")\nprint("halo Studio")';
  const studio = {
    snapshot: {
      version: 1,
      snapshotId: crypto.randomUUID(),
      placeId: "987654",
      nodes: [
        {
          id: "sss",
          parentId: null,
          name: "ServerScriptService",
          className: "ServerScriptService",
          properties: {},
        },
        {
          id: "s1",
          parentId: "sss",
          name: "Halo",
          className: "Script",
          properties: {},
          scriptPath: "ServerScriptService/Halo_aaaaaaaa.luau",
          source,
          readable: true,
        },
      ],
    },
    updated_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 600000).toISOString(),
    state: "idle",
  };
  const { status, events, chats } = await run({
    kind: "roblox",
    studio,
    reply: { content: "Saya membaca script Halo dari Studio." },
  });
  assert.equal(status, 200);
  assert.ok(chats.length, "expected a provider call");
  const user = chats[0].messages.find((m: any) => m.role === "user");
  const payload = JSON.parse(user.content[0].text);
  assert.equal(payload.studio.placeId, "987654");
  assert.equal(payload.studio.stale, false);
  const entry = payload.studio.scripts.find(
    (s: any) => s.path === "ServerScriptService/Halo_aaaaaaaa.luau",
  );
  assert.equal(entry.source, source);
  assert.equal(entry.readable, true);
  assert.match(payload.studio.tree.join("\n"), /ServerScriptService\/Halo/);
  // The running line says Studio was read before the first token arrives.
  const step = events.find(
    (e: any) => e.type === "step" && e.step.phase === "studio",
  );
  assert.ok(step, "expected a studio step event");
  assert.equal(step.step.scripts, 1);
  assert.equal(step.step.nodes, 2);
});

test("AI ops wiring: an invalid target is reported and writes no scene at all", async () => {
  const { events } = await run({
    kind: "roblox",
    reply: {
      content: "Saya perbesar pohon itu.",
      ops: [
        {
          kind: "scene.transform",
          ops: [
            { target: "obj-atap", move: [1, 0, 0] },
            { target: "Pohon", scale: 3 },
          ],
        },
      ],
    },
  });
  const result = resultOf(events);
  assert.equal(result.ops.sceneChanged, false);
  assert.deepEqual(result.ops.applied, []);
  assert.match(result.ops.rejected[0].reason, /tidak ditemukan/);
  assert.match(result.ops.note, /semua-atau-tidak/);
  // Nothing is written, so the browser keeps the scene it already had.
  assert.equal(result.files, undefined);
});

test("AI ops wiring: non-Roblox projects and non-Builder modes never touch a scene", async () => {
  const ops = [
    { kind: "scene.transform", ops: [{ target: "obj-atap", move: [1, 0, 0] }] },
  ];
  const webapp = await run({
    kind: "webapp",
    reply: { content: "Baik.", ops },
  });
  assert.match(
    resultOf(webapp.events).ops.rejected[0].reason,
    /hanya berlaku untuk project Roblox/,
  );
  assert.equal(resultOf(webapp.events).files, undefined);

  const ask = await run({
    kind: "roblox",
    mode: "Ask",
    reply: { content: "Atap ada di 0,5,0.", ops },
  });
  assert.equal(resultOf(ask.events).ops, undefined);
});

test("AI ops wiring: a broken ops payload fails the turn instead of half-applying", async () => {
  const { events } = await run({
    kind: "roblox",
    reply: {
      content: "Saya hapus semua objek.",
      ops: [{ kind: "scene.delete", ops: [{ target: "obj-atap" }] }],
    },
  });
  const error = events.find((e) => e.type === "error");
  assert.ok(error, "expected an error event");
  assert.match(error.message, /jenis operasi tidak didukung/);
  assert.equal(resultOf(events), undefined);
});

// The 3D-from-photo path, end to end: a photo travels with the prompt, the model
// answers with a scene.build tree of shapes, and the SERVER generates the
// geometry — the reply never carries a vertex list the model made up.
test("a photo becomes a real 3D model: the server builds the geometry the model described", async () => {
  const { status, events } = await run({
    kind: "roblox",
    // A real PNG signature: the attachment layer checks the bytes, not the name.
    attachments: [
      {
        name: "kursi-depan.png",
        mime: "image/png",
        data: Buffer.from(
          "89504e470d0a1a0a0000000d494844520000000100000001080600000" +
            "01f15c4890000000a49444154789c6300010000050001",
          "hex",
        ).toString("base64"),
      },
    ],
    reply: {
      content:
        "Dari foto ini saya baca kursi kayu: dudukan, sandaran, dan empat kaki. Warnanya saya ambil dari foto; bagian belakang kursi tidak terlihat jadi saya tebak simetris.",
      ops: [
        {
          kind: "scene.build",
          name: "Kursi kayu",
          photo: 1,
          position: [4, 0, 0],
          asMesh: true,
          nodes: [
            {
              name: "Dudukan",
              shape: "box",
              position: [0, 1.5, 0],
              size: [3, 0.4, 3],
              color: "#8b5a2b",
            },
            {
              name: "Sandaran",
              shape: "box",
              position: [0, 3, 1.2],
              size: [3, 3, 0.4],
              color: "#7a4a22",
            },
            {
              name: "Kaki depan",
              shape: "cylinder",
              segments: 8,
              position: [-1.2, 0.7, 1.2],
              rotation: [0, 0, 90],
              size: [0.4, 1.4, 0.4],
              color: "#4a3018",
            },
          ],
        },
      ],
    },
  });
  assert.equal(status, 200);
  const result = resultOf(events);
  assert.equal(result.ops.sceneChanged, true);
  const applied = result.ops.applied[0];
  assert.equal(applied.kind, "scene.build");
  assert.equal(applied.name, "Kursi kayu");
  assert.equal(applied.photo, 1);
  assert.equal(applied.asMesh, true);
  // The server really generated triangles, inside the mesh budget.
  assert.ok(applied.geometry.vertices > 8, "meshes were merged, not copied");
  assert.ok(applied.geometry.faces <= 1024);
  assert.match(applied.changes.join(" "), /dari foto 1/);
  assert.match(applied.changes.join(" "), /vertex/);
  const scene = JSON.parse(result.files[SCENE_PATH]);
  const model = scene.objects.find((o: any) => o.id === applied.id);
  assert.equal(model.kind, "mesh");
  assert.equal(model.parent, null);
  assert.deepEqual(model.position, [4, 0, 0]);
  assert.equal(model.mesh.vertices.length, applied.geometry.vertices);
  // No face references a vertex that is not there, and no face is degenerate.
  for (const face of model.mesh.faces) {
    assert.equal(new Set(face).size, 3);
    for (const index of face) assert.ok(index < model.mesh.vertices.length);
  }
  // The one-colour limit of a merged mesh is said out loud, never hidden.
  assert.match(applied.changes.join(" "), /satu warna/);
});

test("the colours sampled from the photo reach the model, per side", async () => {
  const photo = {
    name: "kursi-depan.png",
    mime: "image/png",
    data: Buffer.from(
      "89504e470d0a1a0a0000000d494844520000000100000001080600000" +
        "01f15c4890000000a49444154789c6300010000050001",
      "hex",
    ).toString("base64"),
  };
  // Red top half, blue bottom half: the model names the seat and the legs.
  const photoPalettes = [
    {
      columns: 4,
      rows: 4,
      colors: Array.from({ length: 16 }, (_, at) =>
        at < 8 ? "#c02020" : "#2040c0",
      ),
    },
  ];
  const { status, events } = await run({
    kind: "roblox",
    attachments: [photo],
    photoPalettes,
    reply: {
      content:
        "Warna dudukan dan kaki saya ambil dari area foto masing-masing.",
      ops: [
        {
          kind: "scene.build",
          name: "Kursi",
          photo: 1,
          asMesh: true,
          nodes: [
            {
              name: "Dudukan",
              shape: "box",
              position: [0, 1.5, 0],
              size: [3, 0.4, 3],
              region: [0, 0, 1, 0.5],
            },
            {
              name: "Kaki",
              shape: "box",
              position: [0, 0.7, 0],
              region: [0, 0.5, 1, 1],
            },
          ],
        },
      ],
    },
  });
  assert.equal(status, 200);
  const result = resultOf(events);
  assert.equal(result.ops.sceneChanged, true);
  const applied = result.ops.applied[0];
  assert.equal(applied.colorSource, "photo-faces");
  assert.ok(applied.groups >= 2);
  const text = applied.changes.join(" ");
  assert.match(text, /piksel foto 1/);
  assert.match(text, /bukan peta tekstur UV/);
  const scene = JSON.parse(result.files[SCENE_PATH]);
  const model = scene.objects.find((o: any) => o.id === applied.id);
  // Every face was painted, and both halves of the photo are on the model.
  const covered = model.mesh.groups
    .flatMap((group: any) => group.faces)
    .sort((a: number, b: number) => a - b);
  assert.deepEqual(
    covered,
    model.mesh.faces.map((_: any, index: number) => index),
  );
  assert.deepEqual(
    [...new Set(model.mesh.groups.map((g: any) => g.color))].sort(),
    ["#2040c0", "#c02020"],
  );
  // The report carries the colours, one row per colour, covering every face.
  assert.deepEqual(
    applied.colorGroups.map((group: any) => group.color).sort(),
    ["#2040c0", "#c02020"],
  );
  assert.equal(
    applied.colorGroups.reduce((n: number, g: any) => n + g.faces, 0),
    model.mesh.faces.length,
  );
});

test("a region without a usable colour sample is refused, never guessed", async () => {
  const { events } = await run({
    kind: "roblox",
    attachments: [
      {
        name: "kursi.png",
        mime: "image/png",
        data: Buffer.from(
          "89504e470d0a1a0a0000000d494844520000000100000001080600000" +
            "01f15c4890000000a49444154789c6300010000050001",
          "hex",
        ).toString("base64"),
      },
    ],
    // The browser says it could not read the pixels of this photo.
    photoPalettes: [null],
    reply: {
      content: "Saya pakai warna foto untuk dudukannya.",
      ops: [
        {
          kind: "scene.build",
          name: "Kursi",
          photo: 1,
          nodes: [{ name: "Dudukan", shape: "box", region: [0, 0, 1, 1] }],
        },
      ],
    },
  });
  const result = resultOf(events);
  assert.equal(result.ops.sceneChanged, false);
  assert.equal(result.files, undefined);
  assert.match(
    result.ops.rejected[0].reason,
    /sampel warna foto itu tidak ada/,
  );
});

test("a model built from a photo that was never attached is refused, not accepted", async () => {
  const { events } = await run({
    kind: "roblox",
    reply: {
      content: "Saya buatkan kursinya dari foto tadi.",
      ops: [
        {
          kind: "scene.build",
          name: "Kursi",
          photo: 1,
          nodes: [{ name: "Dudukan", shape: "box" }],
        },
      ],
    },
  });
  const result = resultOf(events);
  // Nothing was applied: the request carried no photo at all.
  assert.equal(result.ops.sceneChanged, false);
  assert.equal(result.files, undefined);
  assert.match(result.ops.rejected[0].reason, /tidak melampirkan foto/);
  assert.match(result.ops.note, /tidak ada perubahan diterapkan/);
});

test("a scene.build that would break the mesh budget is rejected with a usable reason", async () => {
  const { events } = await run({
    kind: "roblox",
    reply: {
      content: "Saya gabungkan semuanya jadi satu mesh.",
      ops: [
        {
          kind: "scene.build",
          name: "Bola rumit",
          asMesh: true,
          nodes: [
            { name: "Bola besar", shape: "sphere", segments: 24 },
            {
              name: "Bola kedua",
              shape: "sphere",
              segments: 24,
              position: [1, 0, 0],
            },
            {
              name: "Bola ketiga",
              shape: "sphere",
              segments: 24,
              position: [2, 0, 0],
            },
          ],
        },
      ],
    },
  });
  const result = resultOf(events);
  assert.equal(result.ops.sceneChanged, false);
  const reason = result.ops.rejected[0].reason;
  assert.match(reason, /vertex/);
  assert.match(reason, /512/);
  // The reason says what to do next instead of only what went wrong.
  assert.match(reason, /segments|asMesh|bagian/);
});
