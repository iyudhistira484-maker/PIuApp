import test from "node:test";
import assert from "node:assert/strict";

// The app data API contract: keys are generated server-side, stored as hashes,
// shown once, and every public request is scoped by that key. CORS is opened
// only on the public app routes so an exported app can call them.
test("API data aplikasi: kunci project, CORS, dan operasi tabel lewat HTTP", async () => {
  const { createApp } = await import("../server/app.mjs");
  const owner = crypto.randomUUID(),
    viewer = crypto.randomUUID(),
    outsider = crypto.randomUUID();
  const project = crypto.randomUUID(),
    table = crypto.randomUUID(),
    keyId = crypto.randomUUID();
  const calls: any[] = [];
  let missing = false;
  const keys = [
    {
      id: keyId,
      label: "Web publik",
      scope: "read",
      created_at: "2026-10-17T00:00:00.000Z",
      last_used_at: null,
      revoked: false,
    },
  ];
  const rows = [
    { id: crypto.randomUUID(), values: { title: "Halo", done: false } },
  ];
  const scopes = new Map<string, string>();

  const users: Record<string, any> = {
    "owner-token": {
      id: owner,
      email: "owner@example.test",
      email_confirmed_at: "2026-01-01",
      user_metadata: { name: "Pemilik" },
    },
    "viewer-token": {
      id: viewer,
      email: "viewer@example.test",
      email_confirmed_at: "2026-01-01",
      user_metadata: { name: "Penonton" },
    },
    "outsider-token": {
      id: outsider,
      email: "outsider@example.test",
      email_confirmed_at: "2026-01-01",
    },
  };

  const fetcher = async (input: any, init: any = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    const headers = new Headers(init.headers || input.headers || {});
    const token = (headers.get("authorization") || "").replace("Bearer ", "");
    const single = (headers.get("accept") || "").includes("vnd.pgrst.object");
    let data: any = null;

    if (url.pathname === "/auth/v1/user") {
      data = users[token];
      if (!data) return new Response("{}", { status: 401 });
    } else if (url.pathname === "/rest/v1/platform_user_controls") {
      data = { suspended: false };
    } else if (url.pathname === "/rest/v1/platform_project_controls") {
      data = { locked: false };
    } else if (url.pathname === "/rest/v1/site_configuration") {
      data = { revision: 1, value: {} };
    } else if (url.pathname === "/rest/v1/projects") {
      data = { id: project, name: "App Uji", owner_id: owner };
    } else if (url.pathname === "/rest/v1/collaborators") {
      const userId = (url.searchParams.get("user_id") || "").replace("eq.", "");
      data =
        userId === viewer
          ? { role: "Viewer" }
          : userId === outsider
            ? null
            : { role: "Editor" };
    } else if (url.pathname.startsWith("/rest/v1/rpc/")) {
      const name = url.pathname.split("/").at(-1);
      const body = init.body ? JSON.parse(init.body) : {};
      calls.push({ name, body });
      if (missing)
        return new Response(
          JSON.stringify({ code: "PGRST202", message: "missing" }),
          { status: 404, headers: { "Content-Type": "application/json" } },
        );
      if (name === "piwu_app_key_list") data = keys;
      else if (name === "piwu_app_key_create") {
        if (body.p_project !== project || !/^[0-9a-f]{64}$/.test(body.p_hash))
          return new Response(
            JSON.stringify({ code: "42501", message: "PIWU_APP_FORBIDDEN" }),
            { status: 403, headers: { "Content-Type": "application/json" } },
          );
        scopes.set(body.p_hash, body.p_scope);
        data = {
          id: body.p_id,
          label: body.p_label,
          scope: body.p_scope,
          created_at: "2026-10-17T00:00:00.000Z",
        };
      } else if (name === "piwu_app_key_revoke") {
        scopes.clear();
        data = true;
      } else if (name === "piwu_app_request") {
        const scope = scopes.get(body.p_hash);
        if (body.p_hash === "d".repeat(64))
          return new Response(
            JSON.stringify({ code: "42501", message: "PIWU_APP_KEY" }),
            { status: 403, headers: { "Content-Type": "application/json" } },
          );
        if (!scope)
          return new Response(
            JSON.stringify({ code: "42501", message: "PIWU_APP_KEY" }),
            { status: 403, headers: { "Content-Type": "application/json" } },
          );
        if (
          scope !== "write" &&
          ["insert", "update", "delete"].includes(body.p_op)
        )
          return new Response(
            JSON.stringify({ code: "42501", message: "PIWU_APP_READONLY" }),
            { status: 403, headers: { "Content-Type": "application/json" } },
          );
        if (body.p_op === "tables")
          data = {
            tables: [{ id: table, name: "Tugas", revision: 3, rows: 1 }],
          };
        else if (body.p_op === "list")
          data = {
            id: table,
            name: "Tugas",
            columns: [{ key: "title", label: "Judul", type: "text" }],
            rows,
            revision: 3,
          };
        else if (body.p_op === "insert")
          data = {
            id: table,
            name: "Tugas",
            columns: [{ key: "title", label: "Judul", type: "text" }],
            rows: [
              ...rows,
              ...body.p_payload.rows.map((r: any) => ({
                id: crypto.randomUUID(),
                values: r.values,
              })),
            ],
            revision: 4,
          };
        else
          data = { id: table, name: "Tugas", columns: [], rows, revision: 4 };
      }
    }
    if (data === undefined) data = null;
    if (single && Array.isArray(data)) data = data[0] ?? null;
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
  const base = "http://127.0.0.1:" + (server.address() as any).port;
  const call = (
    path: string,
    options: { token?: string; method?: string; body?: any; key?: string } = {},
  ) =>
    fetch(base + "/api" + path, {
      method: options.method || (options.body ? "POST" : "GET"),
      headers: {
        ...(options.token ? { Authorization: "Bearer " + options.token } : {}),
        ...(options.key ? { "x-piwu-key": options.key } : {}),
        ...(options.body ? { "Content-Type": "application/json" } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

  try {
    const listed = await call("/projects/" + project + "/app-keys", {
      token: "owner-token",
    });
    assert.equal(listed.status, 200);
    assert.deepEqual(await listed.json(), { keys });

    const created = await call("/projects/" + project + "/app-keys", {
      token: "owner-token",
      body: { label: "Web publik", scope: "read" },
    });
    assert.equal(created.status, 201);
    const createdBody = (await created.json()) as any;
    assert.match(createdBody.secret, /^piwu_sk_[A-Za-z0-9_-]{32}$/);
    assert.equal(createdBody.key.scope, "read");
    const createCall = calls.find((c) => c.name === "piwu_app_key_create");
    assert.match(createCall.body.p_hash, /^[0-9a-f]{64}$/);
    assert.notEqual(createCall.body.p_hash, createdBody.secret);
    assert.equal(
      JSON.stringify(createCall.body).includes(createdBody.secret),
      false,
    );

    // A Viewer cannot create or revoke keys; an outsider is rejected by ctx.project.
    const viewerCreate = await call("/projects/" + project + "/app-keys", {
      token: "viewer-token",
      body: { label: "Coba", scope: "write" },
    });
    assert.equal(viewerCreate.status, 403);
    const outsiderCreate = await call("/projects/" + project + "/app-keys", {
      token: "outsider-token",
      body: { label: "Coba", scope: "write" },
    });
    assert.equal(outsiderCreate.status, 403);

    // Public endpoints: key required, CORS allowed, tables listed.
    assert.equal((await call("/public/app/" + project)).status, 401);
    const missingKey = await call("/public/app/" + project, { key: "nope" });
    assert.equal(missingKey.status, 401);

    const preflight = await fetch(base + "/api/public/app/" + project, {
      method: "OPTIONS",
      headers: {
        Origin: "https://app.contoh.test",
        "Access-Control-Request-Headers": "x-piwu-key",
      },
    });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get("access-control-allow-origin"), "*");
    assert.match(
      preflight.headers.get("access-control-allow-headers") || "",
      /x-piwu-key/,
    );

    const tables = await call("/public/app/" + project, {
      key: createdBody.secret,
    });
    assert.equal(tables.status, 200);
    assert.equal(tables.headers.get("access-control-allow-origin"), "*");
    assert.deepEqual(await tables.json(), {
      tables: [{ id: table, name: "Tugas", revision: 3, rows: 1 }],
    });
    const requestCall = calls.findLast((c) => c.name === "piwu_app_request");
    assert.equal(requestCall.body.p_op, "tables");
    assert.equal(requestCall.body.p_hash, createCall.body.p_hash);

    // A read key cannot insert; the SQL error becomes a 403 with a reason.
    const readWrite = await call("/public/app/" + project + "/" + table, {
      key: createdBody.secret,
      body: { rows: [{ values: { title: "ditolak" } }] },
    });
    assert.equal(readWrite.status, 403);
    assert.equal(((await readWrite.json()) as any).code, "APP_KEY_READONLY");

    const writeKey = await call("/projects/" + project + "/app-keys", {
      token: "owner-token",
      body: { label: "Bot isi", scope: "write" },
    });
    assert.equal(writeKey.status, 201);
    const writeSecret = ((await writeKey.json()) as any).secret;
    assert.match(writeSecret, /^piwu_sk_/);

    const listRows = await call("/public/app/" + project + "/" + table, {
      key: createdBody.secret,
    });
    assert.equal(listRows.status, 200);
    assert.equal(((await listRows.json()) as any).table.rows.length, 1);

    const inserted = await call("/public/app/" + project + "/" + table, {
      key: writeSecret,
      body: { rows: [{ values: { title: "Baru" } }] },
    });
    assert.equal(inserted.status, 201);
    const insertCall = calls.findLast((c) => c.name === "piwu_app_request");
    assert.equal(insertCall.body.p_op, "insert");
    assert.equal(insertCall.body.p_table, table);

    const updated = await call(
      "/public/app/" + project + "/" + table + "/" + crypto.randomUUID(),
      {
        key: writeSecret,
        method: "PATCH",
        body: { values: { done: true } },
      },
    );
    assert.equal(updated.status, 200);
    assert.equal(
      calls.findLast((c) => c.name === "piwu_app_request").body.p_op,
      "update",
    );

    const malformed = await call("/public/app/" + project + "/" + table, {
      key: writeSecret,
      body: { rows: [{ values: { title: "x" }, extra: 1 }] },
    });
    assert.equal(malformed.status, 400);

    const badTable = await call("/public/app/" + project + "/bukan-uuid", {
      key: createdBody.secret,
    });
    assert.equal(badTable.status, 400);

    // Deleting a row uses the same key scope rules.
    const removed = await call(
      "/public/app/" + project + "/" + table + "/" + rows[0].id,
      { key: writeSecret, method: "DELETE" },
    );
    assert.equal(removed.status, 200);
    assert.equal(
      calls.findLast((c) => c.name === "piwu_app_request").body.p_op,
      "delete",
    );

    const revoked = await call("/projects/" + project + "/app-keys/" + keyId, {
      token: "owner-token",
      method: "DELETE",
    });
    assert.equal(revoked.status, 200);
    assert.deepEqual(await revoked.json(), { revoked: true });

    // A revoked key stops working immediately.
    const revokedUse = await call("/public/app/" + project, {
      key: createdBody.secret,
    });
    assert.equal(revokedUse.status, 401);

    missing = true;
    const notInstalled = await call("/projects/" + project + "/app-keys", {
      token: "owner-token",
    });
    assert.equal(notInstalled.status, 503);
    const unavailable = (await notInstalled.json()) as any;
    assert.match(unavailable.error, /016_app_data_api\.sql/);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});
