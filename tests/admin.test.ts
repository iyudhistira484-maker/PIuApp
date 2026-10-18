import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { adminCommand } from "../server/routes/admin.mjs";
import {
  retireIdentity,
  tombstoneEmail,
} from "../server/lib/account-retire.mjs";
test("Admin commands reject spoofed actor, unknown actions, manual paid state and invalid schedules", () => {
  const c = {
    requestId: crypto.randomUUID(),
    action: "credits",
    target: crypto.randomUUID(),
    payload: { delta: 50 },
    reason: "Kompensasi gangguan",
  };
  assert.equal(adminCommand(c).payload.delta, 50);
  assert.equal(
    adminCommand({
      ...c,
      action: "user_delete",
      payload: { confirmation: c.target },
    }).action,
    "user_delete",
  );
  assert.throws(() =>
    adminCommand({ ...c, action: "user_delete", payload: {} }),
  );
  assert.throws(() =>
    adminCommand({
      ...c,
      action: "user_delete",
      payload: { confirmation: c.target, extra: 1 },
    }),
  );
  for (const data of [
    { ...c, actor: crypto.randomUUID() },
    { ...c, action: "constructor" },
    { ...c, payload: { delta: 10001 } },
    { ...c, action: "payment_reconcile", payload: { state: "paid" } },
    { ...c, reason: "x" },
  ])
    assert.throws(() => adminCommand(data));
});
test("Admin SQL: migrations, permissions, audit/idempotency, CAS, broadcasts and suspension", async () => {
  const db = new PGlite();
  try {
    await db.exec(
      `create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',created_at timestamptz default now(),last_sign_in_at timestamptz,email_confirmed_at timestamptz,phone_confirmed_at timestamptz,deleted_at timestamptz);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;create function storage.foldername(n text) returns text[] language sql immutable as $$select string_to_array(n,'/')$$;grant usage on schema public,auth,storage to authenticated,anon,service_role;grant execute on function auth.uid() to authenticated,anon;alter default privileges in schema public grant select,insert,update,delete on tables to authenticated;`,
    );
    for (const n of [
      "001_schema",
      "002_workspace_sync",
      "003_services",
      "004_project_data",
      "005_admin",
      "010_credit_lots",
    ])
      await db.exec(
        readFileSync("supabase/" + n + ".sql", "utf8").replace(
          "create extension if not exists pgcrypto;",
          "",
        ),
      );
    const [root, op, audit, user, project] = Array.from({ length: 5 }, () =>
      crypto.randomUUID(),
    );
    for (const id of [root, op, audit, user])
      await db.query("insert into auth.users values($1)", [id]);
    await db.query(
      "insert into platform_admins(user_id,role) values($1,'superadmin'),($2,'operator'),($3,'auditor')",
      [root, op, audit],
    );
    const action = async (
      actor: string,
      type: string,
      target: string | null,
      payload: any,
      request = crypto.randomUUID(),
    ) =>
      (
        await db.query(
          "select piwu_admin_action($1,$2,$3,$4,$5,$6) as result",
          [
            actor,
            request,
            type,
            target,
            JSON.stringify(payload),
            "Pengujian administrasi",
          ],
        )
      ).rows[0];
    await assert.rejects(
      () => action(user, "credits", user, { delta: 5 }),
      /ADMIN_FORBIDDEN/,
    );
    await assert.rejects(
      () => action(audit, "credits", user, { delta: 5 }),
      /ADMIN_FORBIDDEN/,
    );
    await assert.rejects(
      () => action(op, "credits", user, { delta: 5 }),
      /ADMIN_FORBIDDEN/,
    );
    const req = crypto.randomUUID();
    assert.deepEqual(await action(root, "credits", user, { delta: 50 }, req), {
      result: { balance: 70 },
    });
    assert.deepEqual(await action(root, "credits", user, { delta: 50 }, req), {
      result: { balance: 70 },
    });
    await assert.rejects(
      () => action(root, "credits", user, { delta: 51 }, req),
      /ADMIN_DUPLICATE/,
    );
    await assert.rejects(
      () => action(root, "credits", user, { delta: -81 }),
      /ADMIN_NEGATIVE_BALANCE/,
    );
    await assert.rejects(
      () => action(root, "admin_role", root, { role: "remove" }),
      /ADMIN_LAST_SUPERADMIN/,
    );
    await assert.rejects(
      () => action(root, "user_suspend", root, { suspended: true }),
      /ADMIN_REMOVE_ROLE_FIRST/,
    );
    const b = crypto.randomUUID(),
      p = {
        title: "Informasi",
        body: "Isi pengumuman",
        audience: "members",
        status: "published",
        starts_at: "2020-01-01T00:00:00.000Z",
        ends_at: null,
        revision: 0,
      };
    assert.deepEqual(await action(op, "broadcast_save", b, p), {
      result: { revision: 1 },
    });
    assert.equal(
      (await db.query("select * from piwu_broadcast_feed(null)")).rows.length,
      0,
    );
    assert.equal(
      (await db.query("select * from piwu_broadcast_feed($1)", [user])).rows
        .length,
      1,
    );
    await assert.rejects(
      () => action(op, "broadcast_save", b, p),
      /ADMIN_CONFLICT/,
    );
    await db.query("select piwu_broadcast_read($1,$2)", [user, b]);
    await db.query("select piwu_broadcast_read($1,$2)", [user, b]);
    assert.equal(
      (await db.query("select * from broadcast_reads")).rows.length,
      1,
    );
    await action(op, "broadcast_save", b, {
      ...p,
      audience: "public",
      revision: 1,
      starts_at: "2099-01-01T00:00:00.000Z",
    });
    assert.equal(
      (await db.query("select * from piwu_broadcast_feed(null)")).rows.length,
      0,
    );
    await action(op, "broadcast_save", b, {
      ...p,
      audience: "public",
      revision: 2,
    });
    assert.equal(
      (await db.query("select * from piwu_broadcast_feed(null)")).rows.length,
      1,
    );
    await db.query(
      "insert into projects(id,owner_id,name) values($1,$2,'Test')",
      [project, user],
    );
    await action(op, "project_lock", project, { locked: true });
    await db.exec("set role authenticated");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      user,
    ]);
    assert.equal((await db.query("select * from projects")).rows.length, 1);
    await assert.rejects(
      () => db.query("update projects set name='BYPASS' returning id"),
      /permission denied/,
    );
    await assert.rejects(
      () => action(root, "credits", user, { delta: 50 }),
      /permission denied/,
    );
    await assert.rejects(
      () => db.query("select * from platform_admins"),
      /permission denied/,
    );
    await assert.rejects(
      () => db.query("select * from piwu_list_workspaces_base()"),
      /permission denied/,
    );
    await db.exec("reset role");
    await action(root, "user_suspend", user, { suspended: true });
    await db.exec("set role authenticated");
    assert.equal((await db.query("select * from projects")).rows.length, 0);
    await assert.rejects(
      () => db.query("select * from piwu_list_workspaces()"),
      /PIWU_PERMISSION/,
    );
    await db.exec("reset role");
    await action(root, "user_suspend", user, { suspended: false });
    const paid = crypto.randomUUID(),
      future = crypto.randomUUID(),
      expired = crypto.randomUUID();
    await action(op, "broadcast_save", paid, { ...p, audience: "pro" });
    await action(op, "broadcast_save", future, {
      ...p,
      audience: "public",
      starts_at: "2099-01-01T00:00:00.000Z",
    });
    await action(op, "broadcast_save", expired, {
      ...p,
      audience: "public",
      ends_at: "2020-02-01T00:00:00.000Z",
    });
    assert.equal(
      (await db.query("select * from piwu_broadcast_feed($1)", [user])).rows
        .length,
      1,
    );
    await db.query(
      "insert into subscriptions(user_id,plan,status,current_period_start,current_period_end) values($1,'Pro','active',now()-interval '1 day',now()+interval '1 day')",
      [user],
    );
    assert.equal(
      (await db.query("select * from piwu_broadcast_feed($1)", [user])).rows
        .length,
      2,
    );
    await assert.rejects(
      () => db.query("select piwu_broadcast_read($1,$2)", [op, paid]),
      /ADMIN_FORBIDDEN/,
    );
    await db.query(
      "update subscriptions set current_period_end=now()-interval '1 hour' where user_id=$1",
      [user],
    );
    assert.equal(
      (await db.query("select * from piwu_broadcast_feed($1)", [user])).rows
        .length,
      1,
    );
    const job = crypto.randomUUID();
    await db.query("select piwu_reserve_credits($1,$2,5,'publish')", [
      user,
      job,
    ]);
    await db.query(
      "insert into publish_jobs(id,project_id,user_id,snapshot,revision) values($1,$2,$3,'{}',1)",
      [job, project, user],
    );
    await action(op, "publish_cancel", job, {});
    assert.equal(
      (
        await db.query<any>(
          "select status from credit_reservations where id=$1",
          [job],
        )
      ).rows[0].status,
      "refunded",
    );
    await db.query(
      "insert into project_sites(project_id,provider_site_id,url) values($1,'admin-test-site','https://example.test')",
      [project],
    );
    await action(op, "unpublish", project, {});
    assert.equal(
      (
        await db.query("select * from project_sites where project_id=$1", [
          project,
        ])
      ).rows.length,
      0,
    );
    assert.equal(
      (await db.query("select * from hosting_cleanup_jobs")).rows.length,
      1,
    );
    await action(
      op,
      "hosting_retry",
      (await db.query<any>("select id from hosting_cleanup_jobs")).rows[0].id,
      {},
    );
    const queued = crypto.randomUUID();
    await db.query("select piwu_reserve_credits($1,$2,5,'publish')", [
      user,
      queued,
    ]);
    await db.query(
      "insert into publish_jobs(id,project_id,user_id,snapshot,revision) values($1,$2,$3,'{}',1)",
      [queued, project, user],
    );
    await action(root, "project_delete", project, { confirmation: project });
    assert.equal(
      (
        await db.query<any>(
          "select status from credit_reservations where id=$1",
          [queued],
        )
      ).rows[0].status,
      "refunded",
    );
    // The renamed RPC wrappers preserve workspace save/list contracts.
    const workspaceId = crypto.randomUUID();
    await db.exec("set role authenticated");
    await db.query("select piwu_save_workspace($1,$2,0)", [
      workspaceId,
      JSON.stringify({
        id: workspaceId,
        name: "Admin regression",
        files: { "index.html": "Hello" },
        messages: [],
        versions: [],
        comments: [],
        createdAt: 1,
        updatedAt: 1,
      }),
    ]);
    assert.equal(
      (await db.query("select * from piwu_list_workspaces()")).rows.length,
      1,
    );
    await db.exec("reset role");
    const conf = (await db.query<any>("select value from site_configuration"))
      .rows[0].value;
    await action(root, "settings", null, {
      revision: 1,
      value: {
        ...conf,
        maintenance: true,
        // Migration 005's RPC only whitelists top-level keys, so package
        // prices travel inside enabled_services.
        enabled_services: {
          ...conf.enabled_services,
          plan_overrides: { pro: { amount: 249000, credits: 2000 } },
        },
      },
    });
    await assert.rejects(
      () => action(root, "settings", null, { revision: 1, value: conf }),
      /ADMIN_CONFLICT/,
    );
    const saved = (await db.query<any>("select value from site_configuration"))
      .rows[0].value;
    assert.deepEqual(saved.enabled_services.plan_overrides, {
      pro: { amount: 249000, credits: 2000 },
    });
    assert.equal(
      (await db.query<any>("select piwu_writes_open() as open")).rows[0].open,
      false,
    );
  } finally {
    await db.close();
  }
});

test("Admin API: verified identity, DB roles, suspension, service controls and no secret projections", async () => {
  const { createApp } = await import("../server/app.mjs");
  const { defaultSite } = await import("../server/lib/platform.mjs");
  const ids = {
    root: crypto.randomUUID(),
    operator: crypto.randomUUID(),
    auditor: crypto.randomUUID(),
    member: crypto.randomUUID(),
  };
  let suspended = false,
    maintenance = false,
    aiEnabled = true;
  const calls: any[] = [];
  const fetcher = async (input: any, init: any = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    const headers = new Headers(init.headers || input.headers);
    let data: any = [];
    if (url.pathname === "/auth/v1/user") {
      const token = headers
        .get("Authorization")
        ?.replace("Bearer ", "") as keyof typeof ids;
      if (!ids[token]) return new Response("{}", { status: 401 });
      data = {
        id: ids[token],
        email: token + "@example.test",
        email_confirmed_at: "2026-01-01",
        user_metadata: { role: "superadmin" },
      };
    } else if (url.pathname === "/rest/v1/platform_user_controls")
      data = suspended ? [{ suspended: true }] : [];
    else if (url.pathname === "/rest/v1/site_configuration")
      data = [
        {
          revision: 1,
          value: {
            ...defaultSite,
            maintenance,
            enabled_services: {
              ...defaultSite.enabled_services,
              ai: aiEnabled,
            },
          },
        },
      ];
    else if (url.pathname === "/rest/v1/platform_admins") {
      const id = url.searchParams.get("user_id")?.replace("eq.", "");
      const role =
        id === ids.root
          ? "superadmin"
          : id === ids.operator
            ? "operator"
            : id === ids.auditor
              ? "auditor"
              : null;
      data = role ? [{ role }] : [];
    } else if (url.pathname.startsWith("/rest/v1/rpc/")) {
      calls.push({ path: url.pathname, body: JSON.parse(init.body) });
      data = { revision: 1 };
    } else if (url.pathname.startsWith("/auth/v1/admin/users/")) {
      calls.push({
        path: url.pathname,
        method: init.method || "GET",
        body: init.body ? JSON.parse(init.body) : null,
      });
      data = { id: url.pathname.split("/").pop() };
    } else if (url.pathname === "/rest/v1/projects") {
      assert.ok(!url.searchParams.get("select")?.includes("payload"));
      data = [];
    } else throw new Error("Unexpected fixture query: " + url.pathname);
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  const { app } = createApp({
    env: {
      VITE_SUPABASE_URL: "https://test.supabase.co",
      VITE_SUPABASE_ANON_KEY: "test",
      SUPABASE_SERVICE_ROLE_KEY: "server-test",
    },
    fetcher,
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const url = "http://127.0.0.1:" + (server.address() as any).port;
  const call = (path: string, token: string, body?: any) =>
    fetch(url + "/api" + path, {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  try {
    assert.equal((await call("/admin/session", "forged")).status, 401);
    assert.equal((await call("/admin/session", "member")).status, 403);
    assert.equal((await call("/admin/session", "root")).status, 200);
    const command = {
      requestId: crypto.randomUUID(),
      action: "credits",
      target: ids.member,
      payload: { delta: 50 },
      reason: "Kompensasi pengujian",
    };
    assert.equal(
      (await call("/admin/actions", "auditor", command)).status,
      403,
    );
    assert.equal(
      (await call("/admin/actions", "operator", command)).status,
      403,
    );
    assert.equal(
      (await call("/admin/actions", "root", { ...command, actor: ids.root }))
        .status,
      400,
    );
    assert.equal((await call("/admin/actions", "root", command)).status, 200);
    assert.equal(
      calls.filter((c) => c.path === "/rest/v1/rpc/piwu_admin_action").length,
      1,
    );
    const notice = calls.find(
      (c) => c.path === "/rest/v1/rpc/piwu_notification_add",
    );
    assert.equal(
      calls.filter((c) => c.path === "/rest/v1/rpc/piwu_notification_add")
        .length,
      1,
    );
    assert.equal(notice.body.p_user, ids.member);
    assert.equal(notice.body.p_kind, "credits");
    assert.match(notice.body.p_title, /Saldo kredit/);
    assert.match(notice.body.p_body, /menambah 50 kredit/);
    assert.equal(notice.body.p_dedupe, "admin-credit:" + command.requestId);
    assert.equal(calls[0].body.p_actor, ids.root);
    assert.equal((await call("/admin/projects", "operator")).status, 200);
    suspended = true;
    assert.equal((await call("/admin/session", "root")).status, 403);
    suspended = false;
    maintenance = true;
    assert.equal((await call("/checkout", "member", {})).status, 503);
    assert.equal((await call("/admin/session", "root")).status, 200);
    maintenance = false;
    aiEnabled = false;
    assert.equal(
      (await call("/projects/" + crypto.randomUUID() + "/ai", "member", {}))
        .status,
      503,
    );
    aiEnabled = true;
    const remove = {
      requestId: crypto.randomUUID(),
      action: "user_delete",
      target: ids.member,
      payload: { confirmation: ids.member },
      reason: "Permintaan penghapusan oleh pemilik akun",
    };
    assert.equal(
      (await call("/admin/actions", "operator", remove)).status,
      403,
    );
    assert.equal((await call("/admin/actions", "root", remove)).status, 200);
    assert.equal(
      calls.filter((c) => c.path === "/rest/v1/rpc/piwu_admin_delete_account")
        .length,
      1,
    );
    // Migration 013 data is purged too, before the Auth identity is retired.
    const purge = calls.findIndex(
      (c) => c.path === "/rest/v1/rpc/piwu_purge_seller_pii",
    );
    const retired = calls.findIndex(
      (c) =>
        c.path === "/auth/v1/admin/users/" + ids.member &&
        c.method === "DELETE",
    );
    assert.ok(purge > 0 && purge < retired);
    assert.equal(calls[purge].body.p_user, ids.member);
    const updated = calls.find(
      (c) =>
        c.path === "/auth/v1/admin/users/" + ids.member && c.method === "PUT",
    );
    assert.equal(updated.body.email, tombstoneEmail(ids.member));
    assert.equal(updated.body.email_confirm, true);
    assert.ok(
      calls.some(
        (c) =>
          c.path === "/auth/v1/admin/users/" + ids.member &&
          c.method === "DELETE",
      ),
    );
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test("account deletion: superadmin-only, confirmed, deletes personal rows and keeps money/audit", async () => {
  const db = new PGlite();
  try {
    await db.exec(
      `create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',created_at timestamptz default now(),last_sign_in_at timestamptz,email_confirmed_at timestamptz,phone_confirmed_at timestamptz,deleted_at timestamptz);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;create function storage.foldername(n text) returns text[] language sql immutable as $$select string_to_array(n,'/')$$;grant usage on schema public,auth,storage to authenticated,anon,service_role;grant execute on function auth.uid() to authenticated,anon;alter default privileges in schema public grant select,insert,update,delete on tables to authenticated;`,
    );
    for (const n of [
      "001_schema",
      "002_workspace_sync",
      "003_services",
      "004_project_data",
      "005_admin",
      "006_studio_bridge",
      "007_runtime_coordination",
      "008_admin_directory",
      "009_search_cache",
      "010_credit_lots",
      "011_account_deletion",
    ])
      await db.exec(
        readFileSync("supabase/" + n + ".sql", "utf8")
          .replace("create extension if not exists pgcrypto;", "")
          .replace(/^begin;\s*$/m, "")
          .replace(/commit;\s*$/, ""),
      );
    const [root, op, target, other, adminTarget] = Array.from(
      { length: 5 },
      () => crypto.randomUUID(),
    );
    for (const id of [root, op, target, other, adminTarget])
      await db.query(
        "insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())",
        [id, id.slice(0, 8) + "@example.test"],
      );
    await db.query(
      "insert into platform_admins(user_id,role) values($1,'superadmin'),($2,'operator'),($3,'auditor')",
      [root, op, adminTarget],
    );
    await db.query("insert into public.users(id,name) values($1,'Nama Asli')", [
      target,
    ]);
    const own = crypto.randomUUID(),
      shared = crypto.randomUUID(),
      template = crypto.randomUUID(),
      order = crypto.randomUUID();
    await db.query(
      "insert into projects(id,name,owner_id) values($1,'Milik target',$2),($3,'Milik lain',$4)",
      [own, target, shared, other],
    );
    await db.query(
      "insert into project_workspaces(project_id,revision,payload,updated_by) values($1,1,'{}',$2),($3,1,'{}',$2)",
      [own, target, shared],
    );
    await db.query(
      "insert into prompts(owner_id,title,content) values($1,'p','c')",
      [target],
    );
    await db.query(
      "insert into comments(project_id,body,author_id) values($1,'komentar',$2)",
      [shared, target],
    );
    await db.query(
      "insert into project_invites(project_id,created_by,role,token_hash,expires_at) values($1,$2,'Editor','inv',now()+interval '1 day')",
      [shared, target],
    );
    await db.query(
      "insert into referrals(referrer_id,referred_id) values($1,$2)",
      [target, other],
    );
    await db.query(
      "insert into templates(id,owner_id,project_snapshot,status,title) values($1,$2,'{}','published','Template')",
      [template, target],
    );
    await db.query(
      "insert into payment_orders(id,user_id,provider,kind,sku,amount) values($1,$2,'midtrans','template','tpl',49000),($3,$4,'midtrans','topup','x',49000)",
      [order, other, crypto.randomUUID(), target],
    );
    await db.query(
      "insert into template_entitlements(user_id,template_id,order_id) values($1,$2,$3)",
      [other, template, order],
    );
    await db.query(
      "insert into credit_ledger(user_id,delta,reason,reference) values($1,10,'uji','r1')",
      [target],
    );
    const remove = async (
      actor: string,
      victim: string,
      confirmation = victim,
      request = crypto.randomUUID(),
    ) =>
      (
        await db.query(
          "select piwu_admin_delete_account($1,$2,$3,$4,$5) as result",
          [
            actor,
            request,
            victim,
            JSON.stringify({ confirmation }),
            "Menghapus akun uji",
          ],
        )
      ).rows[0].result;
    await assert.rejects(() => remove(op, target), /ADMIN_FORBIDDEN/);
    await assert.rejects(
      () => remove(root, adminTarget),
      /ADMIN_REMOVE_ROLE_FIRST/,
    );
    await assert.rejects(() => remove(root, root), /ADMIN_SELF/);
    await assert.rejects(() => remove(root, target, own), /ADMIN_INVALID/);
    const request = crypto.randomUUID();
    assert.deepEqual(await remove(root, target, target, request), {
      projects: 1,
      templates: 1,
      retained: [
        "payment_orders",
        "credit_ledger",
        "marketplace_sales",
        "template_entitlements",
        "platform_audit",
      ],
    });
    assert.deepEqual(await remove(root, target, target, request), {
      projects: 1,
      templates: 1,
      retained: [
        "payment_orders",
        "credit_ledger",
        "marketplace_sales",
        "template_entitlements",
        "platform_audit",
      ],
    });
    assert.equal(
      (await db.query("select count(*)::int c from platform_audit")).rows[0].c,
      1,
    );
    assert.equal(
      (await db.query("select id from projects where id=$1", [own])).rows
        .length,
      0,
    );
    assert.equal(
      (await db.query("select id from projects where id=$1", [shared])).rows
        .length,
      1,
    );
    assert.equal(
      (
        await db.query(
          "select updated_by from project_workspaces where project_id=$1",
          [shared],
        )
      ).rows[0].updated_by,
      other,
    );
    for (const [table, where] of [
      ["prompts", "owner_id"],
      ["comments", "author_id"],
      ["project_invites", "created_by"],
      ["referrals", "referrer_id"],
    ])
      assert.equal(
        (
          await db.query(
            `select count(*)::int c from ${table} where ${where}=$1`,
            [target],
          )
        ).rows[0].c,
        0,
        table,
      );
    assert.equal(
      (await db.query("select count(*)::int c from payment_orders")).rows[0].c,
      2,
    );
    assert.equal(
      (await db.query("select count(*)::int c from credit_ledger")).rows[0].c,
      1,
    );
    assert.equal(
      (await db.query("select count(*)::int c from template_entitlements"))
        .rows[0].c,
      1,
    );
    assert.equal(
      (await db.query("select status from templates where id=$1", [template]))
        .rows[0].status,
      "archived",
    );
    assert.equal(
      (await db.query("select name from users where id=$1", [target])).rows[0]
        .name,
      "Akun dihapus",
    );
    assert.deepEqual(
      (
        await db.query(
          "select suspended,reason from platform_user_controls where user_id=$1",
          [target],
        )
      ).rows[0],
      { suspended: true, reason: "Akun dihapus: Menghapus akun uji" },
    );
    assert.equal(
      (await db.query("select piwu_user_active($1) as a", [target])).rows[0].a,
      false,
    );
    assert.equal(
      (await db.query("select count(*)::int c from auth.users")).rows[0].c,
      5,
    );
    const beforeSoftDelete = (
      await db.query("select piwu_admin_users($1,'',1) as d", [root])
    ).rows[0].d;
    assert.equal(
      beforeSoftDelete.items.find((item: any) => item.id === target)
        .suspended_reason,
      "Akun dihapus: Menghapus akun uji",
    );
    // GoTrue marks the soft-deleted row; the admin directory must hide it while
    // keeping the row for invoices/audit.
    await db.query("update auth.users set deleted_at=now() where id=$1", [
      target,
    ]);
    const directory = (
      await db.query("select piwu_admin_users($1,'',1) as d", [root])
    ).rows[0].d;
    assert.equal(
      directory.items.some((item: any) => item.id === target),
      false,
    );
    assert.equal(
      directory.items.some((item: any) => item.id === other),
      true,
    );
  } finally {
    await db.close();
  }
});

test("Auth retirement replaces the email and soft-deletes, tolerating a retry", async () => {
  const id = crypto.randomUUID();
  const calls: any[] = [];
  const admin = {
    auth: {
      admin: {
        updateUserById: async (userId: string, attrs: any) => {
          calls.push(["update", userId, attrs]);
          return { error: null };
        },
        deleteUser: async (userId: string, soft: boolean) => {
          calls.push(["delete", userId, soft]);
          return { error: null };
        },
      },
    },
  };
  await retireIdentity(admin, id);
  assert.deepEqual(calls, [
    [
      "update",
      id,
      {
        email: tombstoneEmail(id),
        email_confirm: true,
        user_metadata: { name: "Akun dihapus" },
      },
    ],
    ["delete", id, true],
  ]);
  assert.equal(tombstoneEmail(id), `deleted+${id}@piwu.invalid`);
  const gone = {
    auth: {
      admin: {
        updateUserById: async () => ({
          error: { status: 404, message: "User not found" },
        }),
        deleteUser: async () => ({
          error: { status: 404, message: "User not found" },
        }),
      },
    },
  };
  await retireIdentity(gone, id);
  const broken = {
    auth: {
      admin: {
        updateUserById: async () => ({
          error: { status: 500, message: "provider down" },
        }),
        deleteUser: async () => ({ error: null }),
      },
    },
  };
  await assert.rejects(
    () => retireIdentity(broken, id),
    /email Auth belum dapat diganti/,
  );
});
