import test from "node:test";
import assert from "node:assert/strict";
import { transform } from "sucrase";
import { projectFiles } from "../src/lib/project-kinds.ts";

// The Expo scaffold ships a small API client. It is generated as a string, so
// this test actually runs it against a fake fetch instead of only grepping the
// source: URL shape, header, methods, size guard and error mapping must match
// the HTTP contract built in the app-data stage.
const files = projectFiles("mobile", "studio", "Aplikasi uji");

function load(
  env: Record<string, string>,
  respond: (url: string, init: any) => any,
) {
  const code = transform(files["lib/piwu.ts"], {
    transforms: ["typescript", "imports"],
  }).code;
  const calls: { url: string; init: any }[] = [];
  const exports: any = {};
  const fetch = async (url: string, init: any) => {
    calls.push({ url, init });
    return respond(url, init);
  };
  const run = new Function("exports", "process", "fetch", code);
  run(exports, { env }, fetch);
  return { exports, calls };
}

const ok = (body: any) => ({ ok: true, status: 200, json: async () => body });

test("Expo scaffold has a data client and no server secrets", () => {
  assert.ok(files["lib/piwu.ts"].includes("/api/public/app/"));
  assert.ok(files["lib/piwu.ts"].includes('"x-piwu-key"'));
  assert.ok(files["lib/piwu.ts"].includes("EXPO_PUBLIC_PIWU_KEY"));
  assert.ok(files["env.example"].includes("EXPO_PUBLIC_PIWU_PROJECT_ID"));
  assert.ok(files[".gitignore"].split("\n").includes(".env"));
  assert.ok(files["PIWU.md"].includes("kunci baca saja"));
  assert.ok(files["README.md"].includes("bukan rahasia"));
  assert.equal(
    /SUPABASE_SERVICE_ROLE|service_role|OPENAI_API_KEY/.test(
      Object.values(files).join("\n"),
    ),
    false,
  );
});

test("generated client calls the documented endpoints with the key header", async () => {
  const env = {
    EXPO_PUBLIC_PIWU_API_URL: "https://app.contoh.test/",
    EXPO_PUBLIC_PIWU_PROJECT_ID: "11111111-2222-3333-4444-555555555555",
    EXPO_PUBLIC_PIWU_KEY: "piwu_sk_uji",
  };
  const { exports, calls } = load(env, (url) => {
    if (url.endsWith("/t1/r1"))
      return ok({
        table: { id: "t1", name: "Produk", columns: [], rows: [], revision: 2 },
      });
    return ok({
      table: { id: "t1", name: "Produk", columns: [], rows: [], revision: 1 },
    });
  });
  const tables = load(env, () =>
    ok({ tables: [{ id: "t1", name: "Produk", revision: 1, rows: 0 }] }),
  );
  assert.deepEqual(await tables.exports.piwu.tables(), [
    { id: "t1", name: "Produk", revision: 1, rows: 0 },
  ]);
  assert.equal(
    tables.calls[0].url,
    "https://app.contoh.test/api/public/app/11111111-2222-3333-4444-555555555555",
  );
  assert.equal(tables.calls[0].init.headers["x-piwu-key"], "piwu_sk_uji");

  await exports.piwu.insert("t1", [{ values: { nama: "Kopi" } }]);
  assert.equal(calls[0].init.method, "POST");
  assert.equal(
    calls[0].url,
    env.EXPO_PUBLIC_PIWU_API_URL.replace(/\/$/, "") +
      "/api/public/app/11111111-2222-3333-4444-555555555555/t1",
  );
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    rows: [{ values: { nama: "Kopi" } }],
  });
  assert.equal(calls[0].init.headers["Content-Type"], "application/json");

  await exports.piwu.update("t1", "r1", { nama: "Teh" });
  assert.equal(calls[1].init.method, "PATCH");
  assert.deepEqual(JSON.parse(calls[1].init.body), { values: { nama: "Teh" } });

  await exports.piwu.remove("t1", "r1");
  assert.equal(calls[2].init.method, "DELETE");
  assert.equal(calls[2].init.body, undefined);
});

test("generated client rejects oversized batches and maps API errors", async () => {
  const env = {
    EXPO_PUBLIC_PIWU_API_URL: "https://app.contoh.test",
    EXPO_PUBLIC_PIWU_PROJECT_ID: "11111111-2222-3333-4444-555555555555",
    EXPO_PUBLIC_PIWU_KEY: "piwu_sk_uji",
  };
  const { exports } = load(env, () => ({
    ok: false,
    status: 403,
    json: async () => ({
      error: "Kunci ini hanya boleh membaca.",
      code: "APP_KEY_READONLY",
    }),
  }));
  assert.throws(
    () =>
      exports.piwu.insert(
        "t1",
        Array.from({ length: 51 }, () => ({ values: {} })),
      ),
    /1–50 baris/,
  );
  await assert.rejects(
    () => exports.piwu.update("t1", "r1", { nama: "Teh" }),
    (error: any) =>
      error instanceof exports.PiwuError &&
      error.status === 403 &&
      error.code === "APP_KEY_READONLY" &&
      error.message === "Kunci ini hanya boleh membaca.",
  );

  const unconfigured = load({}, () => ok({}));
  await assert.rejects(
    () => unconfigured.exports.piwu.list("t1"),
    /Lengkapi EXPO_PUBLIC_PIWU_API_URL/,
  );
});
