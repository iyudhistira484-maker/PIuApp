import test from "node:test";
import assert from "node:assert/strict";
import {
  parseRepo,
  pushToGithub,
  selectFiles,
  validBranch,
} from "../src/lib/github";

// GitHub push is client-side: the token never reaches PiwuApp. These tests pin
// the Git Data API sequence, the files that must never be uploaded, and the
// honest error messages for an expired or under-scoped token.

type Call = {
  url: string;
  method: string;
  body: any;
  headers: any;
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

function fakeGithub(handler: (method: string, path: string) => Response) {
  const calls: Call[] = [];
  const fetcher = (async (input: any, init: any = {}) => {
    const url = String(input);
    const method = init.method || "GET";
    calls.push({
      url,
      method,
      body: init.body ? JSON.parse(String(init.body)) : null,
      headers: init.headers,
    });
    return handler(method, new URL(url).pathname);
  }) as unknown as typeof fetch;
  return { fetcher, calls };
}

const file = { "src/App.tsx": "export default function App() { return null }" };
const target = {
  owner: "acme",
  repo: "demo",
  branch: "main",
  message: "Perbarui dari PiwuApp",
};

test("repositori dan cabang divalidasi sebelum menyentuh GitHub", () => {
  assert.deepEqual(parseRepo("acme/demo"), { owner: "acme", repo: "demo" });
  assert.deepEqual(parseRepo("https://github.com/acme/demo.git"), {
    owner: "acme",
    repo: "demo",
  });
  assert.equal(parseRepo("tanpa-garis-miring"), null);
  assert.equal(parseRepo("a/b/c"), null);
  assert.equal(parseRepo("../x"), null);
  assert.equal(validBranch("main"), true);
  assert.equal(validBranch("fitur/kursor"), true);
  assert.equal(validBranch("-hapus"), false);
  assert.equal(validBranch("a..b"), false);
  assert.equal(validBranch("x/release.lock"), false);
});

test("hanya file teks yang aman yang dikirim", () => {
  const picked = selectFiles({
    "src/App.tsx": "ok",
    "public/logo.png": "bukan teks",
    ".env": "SECRET=1",
    ".env.example": "SECRET=",
    "node_modules/react/index.js": "x",
    "../keluar.ts": "x",
    "src/foto.jpg": "x",
  });
  assert.deepEqual(
    picked.files.map((f) => f.path),
    ["src/App.tsx", ".env.example"],
  );
  assert.equal(picked.skipped, 5);
  const limited = selectFiles(
    { "a.ts": "12345", "b.ts": "12345" },
    { files: 1, fileBytes: 10, totalBytes: 10 },
  );
  assert.equal(limited.files.length, 1);
  assert.equal(limited.skipped, 1);
});

test("push memakai satu tree, satu commit, lalu memperbarui ref", async () => {
  const { fetcher, calls } = fakeGithub((method, path) => {
    if (method === "GET" && path === "/repos/acme/demo")
      return json({ default_branch: "main", permissions: { push: true } });
    if (method === "GET" && path === "/repos/acme/demo/git/ref/heads/main")
      return json({ object: { sha: "base" } });
    if (method === "GET" && path === "/repos/acme/demo/git/commits/base")
      return json({ tree: { sha: "base-tree" } });
    if (method === "POST" && path === "/repos/acme/demo/git/trees")
      return json({ sha: "new-tree" });
    if (method === "POST" && path === "/repos/acme/demo/git/commits")
      return json({ sha: "new-commit" });
    if (method === "PATCH" && path === "/repos/acme/demo/git/refs/heads/main")
      return json({ object: { sha: "new-commit" } });
    return json({ message: "not found" }, 404);
  });
  const result = await pushToGithub(
    "ghp_test_token",
    target,
    { ...file, "public/logo.png": "xx" },
    fetcher,
  );
  assert.equal(result.commit, "new-commit");
  assert.equal(result.files, 1);
  assert.equal(result.skipped, 1);
  assert.equal(result.createdBranch, false);
  assert.equal(result.url, "https://github.com/acme/demo/commit/new-commit");
  assert.deepEqual(
    calls.map((c) => c.method + " " + new URL(c.url).pathname),
    [
      "GET /repos/acme/demo",
      "GET /repos/acme/demo/git/ref/heads/main",
      "GET /repos/acme/demo/git/commits/base",
      "POST /repos/acme/demo/git/trees",
      "POST /repos/acme/demo/git/commits",
      "PATCH /repos/acme/demo/git/refs/heads/main",
    ],
  );
  const tree = calls.find((c) => c.url.endsWith("/git/trees"))!;
  assert.equal(tree.body.base_tree, "base-tree");
  assert.equal(tree.body.tree[0].path, "src/App.tsx");
  assert.match(tree.body.tree[0].content, /function App/);
  const commit = calls.find((c) => c.url.endsWith("/git/commits"))!;
  assert.deepEqual(commit.body.parents, ["base"]);
  assert.equal(commit.headers.Authorization, "Bearer ghp_test_token");
});

test("cabang baru dibuat dari kepala cabang bawaan", async () => {
  const { fetcher, calls } = fakeGithub((method, path) => {
    if (method === "GET" && path === "/repos/acme/demo")
      return json({ default_branch: "main", permissions: { push: true } });
    if (method === "GET" && path === "/repos/acme/demo/git/ref/heads/main")
      return json({ object: { sha: "base" } });
    if (method === "GET" && path === "/repos/acme/demo/git/commits/base")
      return json({ tree: { sha: "base-tree" } });
    if (method === "POST" && path === "/repos/acme/demo/git/trees")
      return json({ sha: "new-tree" });
    if (method === "POST" && path === "/repos/acme/demo/git/commits")
      return json({ sha: "new-commit" });
    if (method === "POST" && path === "/repos/acme/demo/git/refs")
      return json({ ref: "refs/heads/fitur/baru" });
    return json({ message: "not found" }, 404);
  });
  const result = await pushToGithub(
    "token",
    { ...target, branch: "fitur/baru" },
    file,
    fetcher,
  );
  assert.equal(result.createdBranch, true);
  const created = calls.find(
    (c) => c.method === "POST" && c.url.endsWith("/git/refs"),
  )!;
  assert.equal(created.body.ref, "refs/heads/fitur/baru");
  assert.equal(created.body.sha, "new-commit");
});

test("repositori kosong tidak butuh commit induk", async () => {
  const { fetcher, calls } = fakeGithub((method, path) => {
    if (method === "GET" && path === "/repos/acme/demo")
      return json({ default_branch: "main", permissions: { push: true } });
    if (method === "POST" && path === "/repos/acme/demo/git/trees")
      return json({ sha: "new-tree" });
    if (method === "POST" && path === "/repos/acme/demo/git/commits")
      return json({ sha: "new-commit" });
    if (method === "POST" && path === "/repos/acme/demo/git/refs")
      return json({ ref: "refs/heads/main" });
    return json({ message: "not found" }, 404);
  });
  const result = await pushToGithub("token", target, file, fetcher);
  assert.equal(result.emptyRepo, true);
  const tree = calls.find((c) => c.url.endsWith("/git/trees"))!;
  assert.equal("base_tree" in tree.body, false);
  const commit = calls.find((c) => c.body?.parents)!;
  assert.deepEqual(commit.body.parents, []);
});

test("token ditolak dan izin tulis diperiksa dengan pesan jelas", async () => {
  const unauthorized = fakeGithub(() =>
    json({ message: "Bad credentials" }, 401),
  );
  await assert.rejects(
    () => pushToGithub("token", target, file, unauthorized.fetcher),
    /Token GitHub tidak valid/,
  );
  const readOnly = fakeGithub(() =>
    json({ default_branch: "main", permissions: { push: false } }),
  );
  await assert.rejects(
    () => pushToGithub("token", target, file, readOnly.fetcher),
    /tidak punya izin menulis/,
  );
  await assert.rejects(
    () => pushToGithub("", target, file, unauthorized.fetcher),
    /Token GitHub belum diisi/,
  );
});
