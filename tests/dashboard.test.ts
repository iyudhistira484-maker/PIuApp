import test from "node:test";
import assert from "node:assert/strict";
import {
  attentionItems,
  bridgeWaiting,
  continueLine,
  creditSpend,
  formatBytes,
  pendingInvites,
  projectFootprint,
  sceneFootprint,
  syncNotice,
  type ProjectSignals,
} from "../src/lib/dashboard/attention";
import {
  CREDIT_LOW,
  isLowBalance,
  spendByReason,
  spendLabel,
} from "../src/lib/dashboard/credits";
import {
  qualityOf,
  scoreLabel,
  scoreTone,
  trendText,
} from "../src/lib/dashboard/quality";
import { activityWhen, buildActivity } from "../src/lib/dashboard/activity";
import {
  pluginItem,
  readinessItems,
  readinessSummary,
} from "../src/lib/dashboard/readiness";
import {
  SEARCH_CHARS_MAX,
  searchProjects,
  snippet,
} from "../src/lib/dashboard/search";
import {
  backupReport,
  buildBackup,
  readBackup,
  restoreName,
} from "../src/lib/dashboard/backup";
import { SCENE_PATH } from "../src/lib/roblox/scene";
import type { Project } from "../src/lib/types";

// The dashboard insights are pure data-to-wording functions, so they are tested
// here without a browser: what waits for the user, what was spent, what a
// project holds. The browser spec then only has to prove the widgets render
// what these functions returned.

const NOW = Date.parse("2026-10-16T10:00:00.000Z");
// Local midnight, so the day arithmetic in the tests does not depend on the
// machine's timezone.
const DAY_START = (() => {
  const date = new Date(NOW);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
})();
const days = (count: number) => new Date(NOW + count * 86400000).toISOString();

const project = (over: Partial<Project> = {}) =>
  ({
    id: "p-1",
    name: "Pulau obby",
    description: "",
    template: "blank",
    files: {},
    messages: [],
    versions: [],
    comments: [],
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  }) as unknown as Project;

const signals = (over: Partial<ProjectSignals> = {}): ProjectSignals => ({
  project: { id: "p-1", name: "Pulau obby" },
  ...over,
});

test("every waiting signal that is real shows up, in the order a person would act on it", () => {
  const items = attentionItems(
    signals({
      comments: [
        { status: "open" },
        { status: "resolved" },
        { status: "open" },
      ],
      invites: [
        {
          id: "i1",
          email: "tim@example.test",
          role: "Editor",
          expires_at: days(3),
        },
        { id: "i2", email: "lama@example.test", expires_at: days(-1) },
        { id: "i3", email: "sudah@example.test", accepted_at: days(-2) },
        { id: "i4", email: "batal@example.test", revoked_at: days(-2) },
      ],
      studio: { state: "queued", queuedChanges: 2 },
    }),
    NOW,
  );
  assert.deepEqual(
    items.map((item) => item.kind),
    ["comments", "invites", "studio"],
  );
  assert.equal(items[0].title, "2 komentar belum diselesaikan");
  assert.match(items[1].title, /1 undangan kolaborator belum dijawab/);
  assert.equal(items[1].detail, "tim@example.test");
  assert.match(items[2].title, /2 perubahan menunggu diterapkan di Studio/);
  // Each item links straight to the panel that resolves it.
  assert.equal(items[0].link, "/project/p-1?dialog=services&services=comments");
  assert.equal(items[1].link, "/project/p-1?dialog=services&services=invite");
  assert.equal(items[2].link, "/project/p-1");
});

test("nothing is invented: absent or finished signals produce no items", () => {
  assert.deepEqual(attentionItems(signals(), NOW), []);
  assert.deepEqual(
    attentionItems(
      signals({
        comments: [{ status: "resolved" }],
        invites: [],
        studio: { state: "applied", queuedChanges: 0 },
      }),
      NOW,
    ),
    [],
  );
  assert.equal(bridgeWaiting(null), "");
  assert.equal(bridgeWaiting({ state: "idle", queuedChanges: 0 }), "");
  // Expired invites are not waiting for anyone.
  assert.deepEqual(pendingInvites([{ expires_at: days(-1) }], NOW), []);
  assert.equal(pendingInvites([{ expires_at: days(1) }], NOW).length, 1);
  // An invite without an expiry still waits, because nothing says it ended.
  assert.equal(pendingInvites([{ email: "a@b.test" }], NOW).length, 1);
});

test("sync wording tells the four states apart, and only real trouble counts as trouble", () => {
  assert.equal(syncNotice(undefined), null);
  assert.deepEqual(syncNotice("conflict"), {
    tone: "warn",
    label: "Konflik sinkronisasi",
  });
  assert.equal(syncNotice("error")?.tone, "warn");
  assert.equal(syncNotice("pending")?.tone, "wait");
  assert.equal(syncNotice("saving")?.tone, "wait");
  assert.equal(syncNotice("synced")?.tone, "ok");
  // A conflict is the one sync state that also becomes a "menunggu Anda" item.
  const items = attentionItems(signals({ syncPhase: "conflict" }), NOW);
  assert.deepEqual(
    items.map((item) => item.kind),
    ["sync"],
  );
  assert.equal(
    attentionItems(signals({ syncPhase: "pending" }), NOW).length,
    0,
    "menunggu sinkronisasi bukan keputusan pengguna",
  );
});

test("the activity feed is newest first, bounded, and honest about its source", () => {
  const alpha = project({
    id: "p-a",
    name: "Alpha",
    createdAt: NOW - 10 * 86400000,
    versions: [
      { id: "v1", label: "Project dibuat", files: {}, at: NOW - 10 * 86400000 },
      { id: "v2", label: "Ubah hero", files: {}, at: NOW - 3600000 },
    ],
  });
  const beta = project({
    id: "p-b",
    name: "Beta",
    createdAt: NOW - 2 * 86400000,
    versions: [
      { id: "v9", label: "Snapshot otomatis", files: {}, at: NOW - 7200000 },
    ],
  });
  const feed = buildActivity([alpha, beta], 3);
  assert.deepEqual(
    feed.map((item) => [item.projectName, item.label]),
    [
      ["Alpha", "Ubah hero"],
      ["Beta", "Snapshot otomatis"],
      ["Beta", "Project dibuat"],
    ],
  );
  // A version with no timestamp is not placed by guesswork.
  const undated = buildActivity([
    project({ versions: [{ id: "x", label: "?", files: {}, at: 0 } as any] }),
  ]);
  assert.deepEqual(
    undated.map((item) => item.kind),
    ["created"],
    "versi tanpa waktu dilewati",
  );
  assert.deepEqual(buildActivity(undefined), []);
  assert.deepEqual(buildActivity([]), []);
  // Labels and ids survive duplicates inside one project.
  const many = buildActivity([
    project({
      versions: [
        { id: "", label: "a", files: {}, at: NOW - 1 },
        { id: "", label: "b", files: {}, at: NOW - 2 },
      ] as any,
    }),
  ]);
  assert.equal(new Set(many.map((item) => item.id)).size, many.length);
});

test("a project created with its first version is not listed twice", () => {
  // createProject writes a version labelled "Project dibuat" and a createdAt
  // milliseconds apart; the feed must show one row, not two.
  const created = NOW - 5000;
  const once = buildActivity([
    project({
      id: "p-once",
      name: "Sekali saja",
      createdAt: created,
      versions: [
        { id: "v1", label: "Project dibuat", files: {}, at: created + 3 },
        { id: "v2", label: "Ubah hero", files: {}, at: created + 2000 },
      ],
    }),
  ]);
  assert.deepEqual(
    once.map((item) => item.label),
    ["Ubah hero", "Project dibuat"],
  );
  // A version with the same label from an older restore is still shown.
  const restored = buildActivity([
    project({
      id: "p-restore",
      createdAt: created,
      versions: [
        { id: "v1", label: "Project dibuat", files: {}, at: created + 120000 },
      ],
    }),
  ]);
  assert.deepEqual(
    restored.map((item) => item.kind),
    ["version", "created"],
  );
});

test("activity times are written in days, then in dates", () => {
  const at = (offsetDays: number, hour = 14, minute = 5) => {
    const date = new Date(DAY_START + offsetDays * 86400000);
    date.setHours(hour, minute, 0, 0);
    return date.getTime();
  };
  const now = at(0, 20, 0);
  assert.equal(activityWhen(at(0), now), "Hari ini · 14.05");
  assert.equal(activityWhen(at(-1), now), "Kemarin · 14.05");
  assert.match(activityWhen(at(-3), now), /^\d{1,2} \w{3} · 14.05$/);
});

test("credit spend counts only what was actually spent inside the window", () => {
  const ledger = [
    { delta: -12, created_at: days(-1) },
    { delta: -30, created_at: days(-6) },
    { delta: -99, created_at: days(-9) },
    { delta: 500, created_at: days(-2) },
    { delta: -3, created_at: undefined },
    { delta: -1, created_at: "bukan tanggal" },
  ];
  assert.equal(creditSpend(ledger, 7, NOW), 42);
  assert.equal(creditSpend([], 7, NOW), 0);
  assert.equal(creditSpend(undefined, 7, NOW), 0);
});

test("credit spending is grouped by what it was spent on, biggest first", () => {
  const rows = spendByReason(
    [
      { delta: -3, reason: "sandbox", created_at: days(-1) },
      { delta: -3, reason: "sandbox", created_at: days(-2) },
      { delta: -12, reason: "ai", created_at: days(-3) },
      { delta: -99, reason: "ai", created_at: days(-30) },
      { delta: 500, reason: "Pembayaran terverifikasi", created_at: days(-1) },
      { delta: -1, reason: undefined, created_at: days(-1) },
      { delta: -2, reason: "eksperimen", created_at: days(-1) },
    ],
    7,
    NOW,
  );
  assert.deepEqual(
    rows.map((row) => [row.label, row.credits, row.count]),
    [
      ["Percakapan AI", 12, 1],
      ["Build & audit", 6, 2],
      ["eksperimen", 2, 1],
      ["Lainnya", 1, 1],
    ],
  );
  assert.equal(
    spendLabel("AI"),
    "Percakapan AI",
    "alasan server tidak peka huruf",
  );
  assert.equal(spendLabel(""), "Lainnya");
  assert.deepEqual(spendByReason(undefined, 7, NOW), []);
});

test("a low balance is called out before the next session runs dry", () => {
  assert.equal(isLowBalance(CREDIT_LOW), true);
  assert.equal(isLowBalance(CREDIT_LOW + 1), false);
  assert.equal(isLowBalance(0), true);
  assert.equal(
    isLowBalance(Number.NaN),
    false,
    "angka tak dikenal bukan alasan panik",
  );
});

test("a project's footprint is its real contents, not a rounded guess", () => {
  const files = { "src/App.tsx": "x".repeat(100), "README.md": "y".repeat(50) };
  const footprint = projectFootprint(
    project({ files, versions: [{}, {}] as any }),
  );
  assert.equal(footprint.files, 2);
  assert.equal(footprint.versions, 2);
  assert.equal(footprint.bytes, 150);
  assert.equal(footprint.scene, undefined, "bukan project Roblox");
  const withPhotos = projectFootprint(project({ files }), {
    count: 3,
    bytes: 2048,
  });
  assert.deepEqual(withPhotos.photos, {
    count: 3,
    limit: 12,
    bytes: 2048,
    bytesLimit: 16 * 1024 * 1024,
  });
});

test("the Roblox scene is read cheaply, and a broken file is not guessed at", () => {
  const scene = {
    version: 1,
    objects: [
      { id: "a", kind: "block" },
      { id: "b", kind: "mesh" },
      { id: "c", kind: "mesh" },
      { id: "d", kind: "model" },
    ],
  };
  assert.deepEqual(sceneFootprint({ [SCENE_PATH]: JSON.stringify(scene) }), {
    objects: 4,
    meshes: 2,
    meshesWithAsset: 0,
  });
  assert.deepEqual(
    sceneFootprint({
      [SCENE_PATH]: JSON.stringify(scene),
      "studio.assets.json": JSON.stringify({
        version: 1,
        assets: { b: { assetId: "12345678" }, c: { assetId: "" } },
      }),
    }),
    { objects: 4, meshes: 2, meshesWithAsset: 1 },
  );
  assert.equal(sceneFootprint({}), undefined);
  assert.equal(sceneFootprint({ [SCENE_PATH]: "{bukan json" }), undefined);
  assert.equal(
    sceneFootprint({
      [SCENE_PATH]: JSON.stringify({ version: 2, objects: [] }),
    }),
    undefined,
  );
  // A roblox project without a scene yet must not claim one.
  assert.equal(
    projectFootprint(project({ kind: "roblox", files: {} })).scene,
    undefined,
  );
});

test("quality is the newest score, its movement, and the parts behind it", () => {
  const report = (
    score: number,
    at: string,
    parts = {},
    findings: unknown[] = [],
  ) => ({
    id: `r-${at}`,
    type: "lighthouse",
    score,
    created_at: at,
    findings: { scores: parts, findings },
  });
  const quality = qualityOf([
    report(72, days(-7), { performance: 72, accessibility: 95 }),
    report(
      92,
      days(-1),
      { performance: 92, accessibility: 88, "best-practices": 100, seo: 90 },
      [{ id: "a" }, { id: "b" }],
    ),
  ]);
  assert.equal(quality.latest, 92);
  assert.equal(quality.previous, 72);
  assert.equal(quality.delta, 20);
  assert.equal(quality.label, "Bagus");
  assert.equal(quality.tone, "ok");
  assert.equal(trendText(quality), "naik 20 poin dari audit sebelumnya");
  assert.deepEqual(
    quality.parts.map((part) => `${part.key} ${part.score}`),
    ["Performa 92", "Aksesibilitas 88", "Praktik 100", "SEO 90"],
  );
  assert.equal(quality.findings, 2);
});

test("no audit is said plainly, and a falling score is not dressed up", () => {
  assert.equal(qualityOf([]).latest, null);
  assert.equal(qualityOf(undefined).label, "Belum pernah diaudit");
  assert.equal(qualityOf([]).tone, "none");
  assert.equal(trendText(qualityOf([])), "");
  // A report without a numeric score (a crashed run) is not a score of zero.
  assert.equal(qualityOf([{ id: "x", score: null }]).latest, null);
  const falling = qualityOf([
    { score: 40, created_at: days(-2) },
    { score: 55, created_at: days(-9) },
  ]);
  assert.equal(falling.delta, -15);
  assert.equal(falling.tone, "warn");
  assert.equal(falling.label, "Bermasalah");
  assert.match(trendText(falling), /^turun 15 poin/);
  const flat = qualityOf([
    { score: 80, created_at: days(-1) },
    { score: 80, created_at: days(-3) },
  ]);
  assert.equal(trendText(flat), "sama dengan audit sebelumnya");
  // One audit is a score, not a trend: nothing is invented from a single run.
  const single = qualityOf([{ score: 80, created_at: days(-1) }]);
  assert.equal(single.delta, null);
  assert.equal(trendText(single), "");
  assert.equal(scoreTone(70), "wait");
  assert.equal(scoreLabel(69), "Bermasalah");
});

test("the continue line is the newest real message, trimmed and bounded", () => {
  assert.equal(continueLine(project()), "");
  assert.equal(
    continueLine(
      project({
        messages: [
          { id: "1", role: "user", content: "  ", mode: "Ask" } as any,
          {
            id: "2",
            role: "assistant",
            content: "Sudah selesai.\n\nBerikutnya: preview.",
          } as any,
        ],
      }),
    ),
    "Sudah selesai. Berikutnya: preview.",
  );
  const long = continueLine(
    project({
      messages: [
        { id: "1", role: "user", content: "a".repeat(200), mode: "Ask" } as any,
      ],
    }),
  );
  assert.equal(long.length, 69);
  assert.ok(long.endsWith("…"));
});

test("a backup file keeps the real projects and drops what it does not know", () => {
  const backup = buildBackup(
    [
      project({
        id: "p-1",
        name: "Alpha",
        kind: "roblox",
        files: { "src/App.tsx": "x" },
        messages: [
          { id: "m", role: "user", content: "hi", mode: "Builder" } as any,
        ],
        versions: [{ id: "v", label: "Project dibuat", files: {}, at: NOW }],
      }),
      // Junk with no id or name is not a project.
      { name: "", files: {} } as any,
    ],
    {
      "p-1": [
        {
          id: "ph",
          name: "foto.png",
          mime: "image/png",
          bytes: 10,
          at: NOW,
          data: "AAAA",
        },
      ],
    },
    new Date(NOW),
  );
  assert.equal(backup.app, "PiwuApp");
  assert.equal(backup.version, 1);
  assert.equal(backup.projects.length, 1);
  assert.equal(backup.projects[0].kind, "roblox");
  assert.equal(backup.photos["p-1"].length, 1);

  const text = JSON.stringify(backup);
  const read = readBackup(text, text.length);
  assert.equal(read.ok, true);
  if (!read.ok) return;
  assert.equal(read.skipped, 0);
  assert.deepEqual(read.backup.projects[0], backup.projects[0]);
  assert.equal(read.backup.photos["p-1"][0].data, "AAAA");
  const report = backupReport(read.backup);
  assert.deepEqual(report, { projects: 1, photos: 1, files: 1, withPhotos: 1 });
});

test("a backup file that is not one is refused, with a reason a person can act on", () => {
  const refuse = (raw: unknown, bytes?: number) => {
    const result = readBackup(
      typeof raw === "string" ? raw : JSON.stringify(raw),
      bytes,
    );
    assert.equal(result.ok, false);
    return result.ok === false ? result.error : "";
  };
  assert.match(refuse("bukan json"), /bukan JSON/);
  assert.match(refuse([1, 2, 3]), /bukan objek JSON/);
  assert.match(
    refuse({ app: "Lain", kind: "project-backup" }),
    /bukan cadangan PiwuApp/,
  );
  assert.match(
    refuse({ app: "PiwuApp", kind: "project-backup", version: 99 }),
    /Versi cadangan 99 belum dikenal/,
  );
  assert.match(
    refuse({ app: "PiwuApp", kind: "project-backup", version: 1 }),
    /tidak memuat daftar project/,
  );
  assert.match(
    refuse({
      app: "PiwuApp",
      kind: "project-backup",
      version: 1,
      projects: [{}, {}],
    }),
    /Tidak ada project yang bisa dibaca/,
  );
  assert.match(refuse("{}", 300 * 1024 * 1024), /terlalu besar/);
  // A partly broken file is still useful: good projects come in, junk is
  // reported, not silently treated as a project.
  const partial = readBackup(
    JSON.stringify({
      app: "PiwuApp",
      kind: "project-backup",
      version: 1,
      projects: [{ id: "p-1", name: "Alpha", files: {} }, { id: "x" }],
      photos: { "p-1": [{ id: "ph", mime: "text/plain", data: "AAAA" }] },
    }),
  );
  assert.equal(partial.ok, true);
  if (!partial.ok) return;
  assert.equal(partial.backup.projects.length, 1);
  assert.equal(partial.skipped, 1);
  assert.deepEqual(
    partial.backup.photos,
    {},
    "mime di luar daftar tidak diambil",
  );
});

test("restored names never collide with what is already there", () => {
  const taken = new Set(["Alpha", "Beta", "Beta (pulih)"]);
  assert.equal(restoreName("Gamma", taken), "Gamma");
  assert.equal(restoreName("Alpha", taken), "Alpha (pulih)");
  // "Alpha (pulih)" is free in this set, so it is used as is.
  assert.equal(
    restoreName("Alpha", new Set(["Alpha", "Alpha (pulih)"])),
    "Alpha (pulih 2)",
  );
  assert.equal(restoreName("Beta", taken), "Beta (pulih 2)");
});

test("search reads names, then files, then the conversation — and says where", () => {
  const alpha = project({
    id: "p-a",
    name: "Katalog produk",
    files: {
      "src/App.tsx": "const judul = 'Toko Roti';",
      "src/styles.css": "body{color:#2857aa}",
    },
    messages: [
      {
        id: "m",
        role: "assistant",
        content: "Sudah ditambahkan filtur pencarian.",
        mode: "Builder",
      } as any,
    ],
  });
  const beta = project({
    id: "p-b",
    name: "Portfolio biru",
    kind: "roblox",
    files: { "scene.roblox.json": '{"version":1,"objects":[]}' },
    comments: [{ id: "c", selector: ".hero", body: "geser", resolved: false }],
  });
  const projects = [alpha, beta];

  // A name match does not pretend to know which file matched.
  assert.deepEqual(searchProjects(projects, "portofolio").hits.length, 0);
  const byName = searchProjects(projects, "portfolio");
  assert.deepEqual(
    byName.hits.map((hit) => [hit.project.name, hit.where]),
    [["Portfolio biru", ""]],
  );

  // File contents, then the conversation, each named.
  const byFile = searchProjects(projects, "2857aa");
  assert.deepEqual(
    byFile.hits.map((hit) => [hit.project.name, hit.where]),
    [["Katalog produk", "src/styles.css"]],
  );
  const byConversation = searchProjects(projects, "filtur");
  assert.deepEqual(
    byConversation.hits.map((hit) => [hit.project.name, hit.where]),
    [["Katalog produk", "percakapan"]],
  );

  // One letter would match half the files, so below two characters only names
  // are matched: "5" is inside a file and must not pull that project in.
  assert.deepEqual(searchProjects(projects, "5").hits.length, 0);
  assert.deepEqual(
    searchProjects(projects, "5").notFullySearched,
    0,
    "query pendek bukan alasan menyatakan sesuatu tidak diperiksa",
  );
  // …while a short query that really is in a name still works.
  assert.deepEqual(
    searchProjects(projects, "r")
      .hits.map((hit) => hit.project.name)
      .sort(),
    ["Katalog produk", "Portfolio biru"],
  );

  // Filters narrow by kind and by an open comment, and compose with the query.
  assert.deepEqual(
    searchProjects(projects, "", { kind: "roblox" }).hits.map(
      (hit) => hit.project.name,
    ),
    ["Portfolio biru"],
  );
  assert.deepEqual(
    searchProjects(projects, "katalog", { kind: "roblox" }).hits.length,
    0,
  );
  assert.deepEqual(
    searchProjects(projects, "", { commentsOnly: true }).hits.map(
      (hit) => hit.project.name,
    ),
    ["Portfolio biru"],
  );
  assert.deepEqual(searchProjects(undefined, "apa pun").hits, []);
});

test("a project too big to read is reported, never silently dropped", () => {
  const huge = project({
    id: "p-huge",
    name: "Project besar",
    files: { "big.txt": "x".repeat(SEARCH_CHARS_MAX + 1) },
  });
  const result = searchProjects([huge], "jarum");
  assert.deepEqual(result.hits, []);
  assert.equal(result.notFullySearched, 1);
  // The same project matches normally when the budget can hold it.
  const small = project({
    id: "p-small",
    name: "Kecil",
    files: { "big.txt": "x".repeat(1000) + "jarum" },
  });
  const found = searchProjects([small], "jarum");
  assert.deepEqual(
    found.hits.map((hit) => [hit.project.name, hit.where]),
    [["Kecil", "big.txt"]],
  );
  assert.equal(found.notFullySearched, 0);
  assert.match(snippet("aaa bbb jarum ccc", "jarum"), /jarum/);
  assert.equal(snippet("tidak ada", "jarum"), "");
});

test("the readiness list names what is missing, in the words of what it enables", () => {
  const off = readinessSummary(readinessItems({ cloud: true, ai: true }));
  assert.equal(off.total, 6);
  assert.equal(off.ready, 2);
  assert.deepEqual(
    off.missing.map((item) => item.id),
    ["search", "sandbox", "audit", "payments"],
  );
  assert.match(off.missing[0].missing, /provider pencarian berkunci/);
  assert.match(off.missing[2].missing, /Chromium \+ Lighthouse/);
  // Every item has both halves: what it gives the user, and what is missing.
  for (const item of readinessItems({})) {
    assert.ok(item.label && item.hint && item.missing, item.id);
    assert.equal(item.ready, false);
  }
  // A capability that was never reported is not a capability.
  assert.equal(
    readinessItems(undefined).every((item) => !item.ready),
    true,
  );
  // Everything on: nothing is listed as missing, and the count adds up.
  const on = readinessSummary(
    readinessItems({
      cloud: true,
      ai: true,
      search: true,
      sandbox: true,
      audit: true,
      payments: true,
    }),
  );
  assert.deepEqual(on.missing, []);
  assert.equal(on.ready, on.total);
});

test("the plugin line only speaks about versions it actually knows", () => {
  const fresh = pluginItem({ plugin: { version: "2.2.0" } }, "2.2.0");
  assert.equal(fresh.ready, true);
  // Never connected: not a version problem, a "belum terpasang" problem.
  const never = pluginItem({}, "2.2.0");
  assert.equal(never.ready, false);
  assert.match(never.missing, /belum pernah menghubungi/);
  assert.equal(pluginItem(null, "2.2.0").ready, false);
  // Older plugin: name both versions so the fix is obvious.
  const stale = pluginItem({ plugin: { version: "2.0.0" } }, "2.2.0");
  assert.equal(stale.ready, false);
  assert.match(
    stale.missing,
    /v2\.0\.0 terpasang, aplikasi ini memakai v2\.2\.0/,
  );
  assert.deepEqual(
    readinessSummary(readinessItems({}, [fresh])).missing.map(
      (item) => item.id,
    ),
    ["cloud", "ai", "search", "sandbox", "audit", "payments"],
  );
});

test("sizes are written the way a person reads them", () => {
  assert.equal(formatBytes(512), "512 B");
  assert.equal(formatBytes(2048), "2 KB");
  assert.equal(formatBytes(3 * 1024 * 1024), "3.0 MB");
});
