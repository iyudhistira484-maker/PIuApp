import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import express from "express";
import { adminFilters, applyAdminFilters } from "../server/lib/admin-query.mjs";
import { createCoordination } from "../server/lib/coordination.mjs";
import { rateLimit } from "../server/lib/context.mjs";
import {
  userActive,
  projectUnlocked,
  siteSettings,
} from "../server/lib/platform.mjs";
import { SandboxProvider } from "../server/providers/sandbox.mjs";
import { adminCSV } from "../src/lib/admin-csv.ts";

test("admin filters reject injected operators, unsupported states, malformed dates and actor IDs", () => {
  for (const q of [
    { q: "x".repeat(101) },
    { status: "paid", evil: "eq.true" },
    { actor: "a),id.eq.x" },
    { since: "2026-02-30" },
    { since: "2026-10-20", until: "2026-10-01" },
    { page: 0 },
  ])
    assert.throws(() => adminFilters(q, "payments"));
  assert.throws(() => adminFilters({ status: "paid" }, "projects"));
  const calls: any[] = [];
  const chain: any = new Proxy(
    {},
    {
      get:
        (_, k) =>
        (...args: any[]) => {
          calls.push([k, ...args]);
          return chain;
        },
    },
  );
  applyAdminFilters(
    chain,
    "projects",
    adminFilters(
      { q: "a%_\\", since: "2026-10-01", until: "2026-10-02" },
      "projects",
    ),
    "updated_at",
  );
  assert.deepEqual(calls[0], ["ilike", "name", "%a\\%\\_\\\\%"]);
  assert.deepEqual(calls[2], ["lt", "updated_at", "2026-10-03T00:00:00.000Z"]);
});
test("admin CSV escapes formulas, quotes, multiline values and does not imply a full export", () => {
  const csv = adminCSV([
    {
      name: ' =HYPERLINK("https://invalid")',
      reason: "first\nsecond",
      balance: -2,
    },
    { name: "ordinary", reason: "@SUM(1)", balance: 3 },
  ]);
  assert.ok(csv.startsWith('\ufeff"name","reason","balance"'));
  assert.ok(csv.includes('"\' =HYPERLINK(""https://invalid"")"'));
  assert.ok(csv.includes('"\'@SUM(1)"'));
  assert.ok(csv.includes('"\'-2"'));
  assert.ok(csv.includes('"first\nsecond"'));
});
test("production security controls fail closed on missing migrations and shared store outage", async () => {
  const chain: any = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () => ({ error: { code: "PGRST205" } }),
  };
  const ctx: any = {
    env: { NODE_ENV: "production" },
    admin: { from: () => chain },
    needAdmin: () => ctx.admin,
  };
  await assert.rejects(userActive(ctx, crypto.randomUUID()), /migration/);
  await assert.rejects(projectUnlocked(ctx, crypto.randomUUID()), /migration/);
  await assert.rejects(siteSettings(ctx), /keamanan/);
  assert.throws(
    () =>
      createCoordination({
        env: { NODE_ENV: "production", RATE_LIMIT_MODE: "memory" },
      }),
    /Produksi/,
  );
  await assert.rejects(
    createCoordination({ env: { NODE_ENV: "production" }, admin: null }).take(
      { method: "GET", path: "/x", ip: "127.0.0.1" },
      2,
      60000,
    ),
    /migration 007/,
  );
});
test("pending sandbox creations count toward quota and failed creation frees admission", async () => {
  const provider: any = new SandboxProvider({});
  const pending: any[] = [];
  provider.create = () =>
    new Promise((resolve, reject) => pending.push({ resolve, reject }));
  provider.write = async () => {};
  const a = provider.run("user", "a", {}, "echo a"),
    b = provider.run("user", "b", {}, "echo b");
  await new Promise<void>((resolve) => setImmediate(resolve));
  await assert.rejects(provider.run("user", "c", {}, "echo c"), /dua sandbox/);
  const box = {
    kill: async () => {},
    commands: { run: async () => ({ stdout: "ok", exitCode: 0 }) },
  };
  pending[0].resolve(box);
  pending[1].reject(new Error("create failed"));
  await a;
  await assert.rejects(b, /create failed/);
  assert.equal(provider.creating.size, 0);
  assert.equal(provider.sessions.size, 1);
});

test("migrations 001–010: real SQL directory/RLS and two HTTP replicas sharing admission state", async (t) => {
  const db = new PGlite();
  const servers: any[] = [];
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;
      create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',created_at timestamptz default now(),last_sign_in_at timestamptz,email_confirmed_at timestamptz,phone_confirmed_at timestamptz);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;
      create function storage.foldername(n text) returns text[] language sql immutable as $$select string_to_array(n,'/')$$;
      grant usage on schema public,auth,storage to authenticated,anon,service_role;grant execute on function auth.uid() to authenticated,anon;
      alter default privileges in schema public grant select,insert,update,delete on tables to authenticated;`);
    for (const name of readdirSync("supabase")
      .filter((n) => /^00[1-8]_.*\.sql$/.test(n))
      .sort())
      await db.exec(
        readFileSync("supabase/" + name, "utf8").replace(
          "create extension if not exists pgcrypto;",
          "",
        ),
      );
    const user = crypto.randomUUID(),
      root = crypto.randomUUID(),
      other = crypto.randomUUID(),
      projects = Array.from({ length: 3 }, () => crypto.randomUUID());
    await db.query(
      "insert into auth.users(id,email,raw_user_meta_data) values($1,'member@example.test','{\"name\":\"Pencarian Nyata\",\"private\":\"not-exported\"}'),($2,'admin@example.test','{}'),($3,'other@example.test','{}')",
      [user, root, other],
    );
    await db.query(
      "insert into platform_admins(user_id,role) values($1,'superadmin')",
      [root],
    );
    for (const project of projects)
      await db.query(
        "insert into projects(id,name,owner_id) values($1,'Test',$2)",
        [project, user],
      );
    const call = async (name: string, args: any[]) =>
      (
        (
          await db.query(
            `select public.${name}(${args.map((_, i) => "$" + (i + 1)).join(",")}) as value`,
            args,
          )
        ).rows[0] as any
      ).value;
    await t.test(
      "directory authorization and literal search prevent email/metadata leakage",
      async () => {
        await assert.rejects(
          call("piwu_admin_users", [user, "", 1]),
          /ADMIN_FORBIDDEN/,
        );
        const result = await call("piwu_admin_users", [root, "pencarian", 1]);
        assert.equal(result.items.length, 1);
        assert.equal(result.items[0].id, user);
        assert.equal(result.items[0].name, "Pencarian Nyata");
        assert.ok(!JSON.stringify(result).includes("not-exported"));
        assert.equal(
          (await call("piwu_admin_users", [root, "%", 1])).items.length,
          0,
        );
        for (let i = 0; i < 27; i++)
          await db.query("insert into auth.users(id,email) values($1,$2)", [
            crypto.randomUUID(),
            `bulk-${i}@example.test`,
          ]);
        const page1 = await call("piwu_admin_users", [root, "bulk-", 1]),
          page2 = await call("piwu_admin_users", [root, "bulk-", 2]);
        assert.equal(page1.items.length, 25);
        assert.equal(page1.hasMore, true);
        assert.equal(page2.items.length, 2);
        assert.equal(page2.hasMore, false);
        assert.ok(
          page1.items.every((a: any) =>
            page2.items.every((b: any) => a.id !== b.id),
          ),
        );
        await db.exec("set role authenticated");
        try {
          await assert.rejects(
            call("piwu_admin_users", [root, "", 1]),
            /permission denied/,
          );
          await assert.rejects(
            call("piwu_take_rate", ["a".repeat(64), 2, 60000]),
            /permission denied/,
          );
          await assert.rejects(
            db.query("select * from runtime_sandbox_slots"),
            /permission denied/,
          );
        } finally {
          await db.exec("reset role");
        }
      },
    );
    let offline = false;
    const ctx: any = {
      env: { NODE_ENV: "production" },
      admin: {
        rpc: (name: string, args: any) => ({
          abortSignal: async () => {
            if (offline) throw new Error("database offline");
            return { data: await call(name, Object.values(args)), error: null };
          },
        }),
      },
    };
    const coordinators = [createCoordination(ctx), createCoordination(ctx)];
    await t.test(
      "interactive sandbox quota, wrong-owner release and affinity across replicas",
      async () => {
        await coordinators[0].acquireSlot(user, projects[0]);
        await assert.rejects(
          coordinators[1].acquireSlot(user, projects[0]),
          /server lain/,
        );
        await coordinators[1].releaseSlot(user, projects[0]);
        await assert.rejects(
          coordinators[1].acquireSlot(user, projects[0]),
          /server lain/,
        );
        await coordinators[1].acquireSlot(user, projects[1]);
        await assert.rejects(
          coordinators[0].acquireSlot(user, projects[2]),
          /Kuota/,
        );
        await coordinators[0].releaseSlot(user, projects[0]);
        await coordinators[1].acquireSlot(user, projects[2]);
        await db.exec(
          "update runtime_sandbox_slots set expires_at=now()-interval '1 second'",
        );
        await coordinators[0].acquireSlot(user, projects[1]);
      },
    );
    await t.test(
      "two actual HTTP servers enforce one budget; forwarded IP spoof and path changes do not bypass",
      async () => {
        for (const coordination of coordinators) {
          const app = express();
          app.locals.coordination = coordination;
          app.get("/work/:id", rateLimit({ max: 4 }), (_, res) =>
            res.json({ ok: true }),
          );
          app.use((e: any, _req: any, res: any, _next: any) =>
            res.status(e.status || 500).json({ code: e.code }),
          );
          const server = app.listen(0, "127.0.0.1");
          servers.push(server);
          await new Promise<void>((r) => server.once("listening", r));
        }
        const results = await Promise.all(
          Array.from({ length: 12 }, (_, i) =>
            fetch(
              `http://127.0.0.1:${servers[i % 2].address().port}/work/${i}`,
              { headers: { "X-Forwarded-For": `10.0.0.${i}` } },
            ),
          ),
        );
        assert.equal(results.filter((r) => r.status === 200).length, 4);
        assert.equal(results.filter((r) => r.status === 429).length, 8);
        assert.ok(
          Number(
            results.find((r) => r.status === 429)?.headers.get("Retry-After"),
          ) > 0,
        );
        await Promise.all(results.map((r) => r.arrayBuffer()));
        offline = true;
        const result = await fetch(
          `http://127.0.0.1:${servers[0].address().port}/work/x`,
        );
        assert.equal(result.status, 503);
        assert.equal((await result.json()).code, "RUNTIME_UNAVAILABLE");
        offline = false;
        await db.exec(
          "update runtime_rate_buckets set expires_at=now()-interval '1 second'",
        );
        const recovered = await fetch(
          `http://127.0.0.1:${servers[1].address().port}/work/y`,
        );
        assert.equal(recovered.status, 200);
        await recovered.arrayBuffer();
      },
    );
  } finally {
    await Promise.all(
      servers.map((s) => new Promise<void>((r) => s.close(() => r()))),
    );
    await db.close();
  }
});

test("Expo scaffold uses the matching SDK 57 native toolchain, no unsupported web command", async () => {
  const { projectFiles } = await import("../src/lib/project-kinds.ts");
  const files = projectFiles("mobile", "studio", "Aplikasi uji");
  const pkg = JSON.parse(files["package.json"]),
    config = JSON.parse(files["app.json"]);
  assert.equal(pkg.dependencies.expo, "~57.0.29");
  assert.equal(pkg.dependencies.react, "19.2.3");
  assert.equal(pkg.dependencies["react-native"], "0.86.3");
  assert.equal(pkg.overrides.uuid, "11.1.1");
  assert.deepEqual(config.expo.platforms, ["android", "ios"]);
  assert.equal(pkg.scripts.web, undefined);
  assert.ok(files["README.md"].includes("npm audit"));
});
