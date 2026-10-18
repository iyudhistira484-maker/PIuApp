import test from "node:test";
import assert from "node:assert/strict";
import { notifyUser } from "../server/lib/notifications.mjs";

// The bell's HTTP contract: the server passes the verified account ID (never a
// browser-supplied one), a missing migration is named instead of guessed at,
// and marking one/all read is idempotent.
test("notification API: verified account, read state, and a named missing migration", async () => {
  const { createApp } = await import("../server/app.mjs");
  const id = crypto.randomUUID();
  const calls: any[] = [];
  let missing = false,
    unread = 1,
    readAll = 2;
  const fetcher = async (input: any, init: any = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    const headers = new Headers(init.headers || input.headers);
    let data: any = null;
    if (url.pathname === "/auth/v1/user") {
      if (headers.get("Authorization") !== "Bearer member-token")
        return new Response("{}", { status: 401 });
      data = {
        id,
        email: "member@example.test",
        email_confirmed_at: "2026-01-01",
        user_metadata: { name: "Anggota Uji" },
      };
    } else if (url.pathname === "/rest/v1/platform_user_controls") data = [];
    else if (url.pathname.startsWith("/rest/v1/rpc/")) {
      const name = url.pathname.split("/").at(-1);
      const body = init.body ? JSON.parse(init.body) : {};
      calls.push({ name, body });
      if (name === "piwu_notifications")
        data = missing
          ? null
          : {
              items: [
                {
                  id: crypto.randomUUID(),
                  kind: "payment",
                  title: "Pembayaran berhasil",
                  body: "300 kredit ditambahkan.",
                  href: "/account",
                  read: false,
                  created_at: "2026-10-17T10:00:00.000Z",
                },
              ],
              unread,
            };
      else if (name === "piwu_notification_read_all") data = readAll;
    }
    if (missing && url.pathname.startsWith("/rest/v1/rpc/"))
      return new Response(
        JSON.stringify({
          code: "PGRST202",
          message: "Could not find the function public.piwu_notifications",
          details: "Searched",
          hint: null,
        }),
        { status: 404, headers: { "Content-Type": "application/json" } },
      );
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
  const call = (path: string, token = "member-token", body?: any) =>
    fetch(base + "/api" + path, {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  try {
    assert.equal((await call("/notifications", "")).status, 401);
    const listed = await call("/notifications");
    assert.equal(listed.status, 200);
    const answer = (await listed.json()) as any;
    assert.equal(answer.applied, true);
    assert.equal(answer.unread, 1);
    assert.equal(answer.items.length, 1);
    assert.equal(answer.items[0].title, "Pembayaran berhasil");
    assert.deepEqual(calls[0], {
      name: "piwu_notifications",
      body: { p_user: id, p_limit: 20 },
    });
    const read = await call(
      "/notifications/" + crypto.randomUUID() + "/read",
      "member-token",
      {},
    );
    assert.equal(read.status, 200);
    assert.equal(calls.at(-1).name, "piwu_notification_read");
    assert.equal(calls.at(-1).body.p_user, id);
    const all = await call("/notifications/read-all", "member-token", {});
    assert.equal(all.status, 200);
    assert.deepEqual(await all.json(), { read: 2 });
    assert.equal(calls.at(-1).name, "piwu_notification_read_all");
    assert.equal(calls.at(-1).body.p_user, id);
    // Invalid IDs fail before the RPC; no browser-supplied user id exists.
    assert.equal(
      (await call("/notifications/not-a-uuid/read", "member-token", {})).status,
      400,
    );
    missing = true;
    const notInstalled = await call("/notifications");
    assert.equal(notInstalled.status, 200);
    const unavailable = (await notInstalled.json()) as any;
    assert.equal(unavailable.applied, false);
    assert.deepEqual(unavailable.items, []);
    assert.match(unavailable.notice, /012_notifications\.sql/);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test("notifyUser is best-effort: a missing migration or outage never fails the caller", async () => {
  const calls: any[] = [];
  const ctx = {
    admin: {
      rpc: async (name: string, args: any) => {
        calls.push({ name, args });
        return { data: "notice-id", error: null };
      },
    },
  };
  assert.equal(
    await notifyUser(ctx, "user-id", {
      kind: "system",
      title: "Halo",
      body: "Isi",
      href: "/account",
      dedupe: "x",
    }),
    "notice-id",
  );
  assert.deepEqual(calls[0], {
    name: "piwu_notification_add",
    args: {
      p_user: "user-id",
      p_kind: "system",
      p_title: "Halo",
      p_body: "Isi",
      p_href: "/account",
      p_dedupe: "x",
    },
  });
  const missing = {
    admin: { rpc: async () => ({ error: { code: "PGRST202" } }) },
  };
  assert.equal(
    await notifyUser(missing, "user-id", {
      kind: "system",
      title: "Halo",
      body: "Isi",
    }),
    null,
  );
  const broken = {
    admin: {
      rpc: async () => {
        throw new Error("network down");
      },
    },
  };
  assert.equal(
    await notifyUser(broken, "user-id", {
      kind: "system",
      title: "Halo",
      body: "Isi",
    }),
    null,
  );
});
