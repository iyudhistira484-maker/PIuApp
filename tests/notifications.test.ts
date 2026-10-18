import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

// Migration 012: the bell reads server-stored rows, so the same list appears on
// every device. These tests cover the account boundary, dedupe (a retried
// webhook must not ring twice), validation and the read/unread contract.
test("notifications: per-account rows, dedupe, read state and service-only writes", async () => {
  const db = new PGlite();
  try {
    await db.exec(
      `create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;create function storage.foldername(n text) returns text[] language sql immutable as $$select string_to_array(n,'/')$$;grant usage on schema public,auth,storage to authenticated,anon,service_role;grant execute on function auth.uid() to authenticated,anon;alter default privileges in schema public grant select,insert,update,delete on tables to authenticated;`,
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
      "012_notifications",
    ])
      await db.exec(
        readFileSync("supabase/" + n + ".sql", "utf8").replace(
          "create extension if not exists pgcrypto;",
          "",
        ),
      );
    const [a, b, suspended] = Array.from({ length: 3 }, () =>
      crypto.randomUUID(),
    );
    for (const id of [a, b, suspended])
      await db.query("insert into auth.users values($1)", [id]);
    await db.query(
      "insert into platform_user_controls(user_id,suspended,reason) values($1,true,'Uji')",
      [suspended],
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
    const first = await call("piwu_notification_add", [
      a,
      "system",
      "Halo",
      "Isi notifikasi",
      "/account",
      "welcome",
    ]);
    assert.match(first, /^[0-9a-f-]{36}$/);
    // The same dedupe key is a no-op, not a second row.
    assert.equal(
      await call("piwu_notification_add", [
        a,
        "system",
        "Halo",
        "Isi notifikasi",
        "/account",
        "welcome",
      ]),
      null,
    );
    // A missing dedupe key allows repeated (e.g. low-credit) notices.
    assert.match(
      await call("piwu_notification_add", [
        a,
        "credits",
        "Kredit menipis",
        "Sisa 8 kredit.",
        "/account",
        null,
      ]),
      /^[0-9a-f-]{36}$/,
    );
    assert.match(
      await call("piwu_notification_add", [
        a,
        "payment",
        "Pembayaran",
        "Pembayaran berhasil.",
        "",
        "payment:test",
      ]),
      /^[0-9a-f-]{36}$/,
    );
    const list = await call("piwu_notifications", [a, 20]);
    assert.equal(list.items.length, 3);
    assert.equal(list.unread, 3);
    assert.ok(
      list.items.every(
        (item: any) =>
          typeof item.id === "string" && /^[0-9a-f-]{36}$/.test(item.id),
      ),
    );
    assert.deepEqual(await call("piwu_notifications", [b, 20]), {
      items: [],
      unread: 0,
    });
    await assert.rejects(
      () => call("piwu_notifications", [suspended, 20]),
      /NOTIFY_FORBIDDEN/,
    );
    await assert.rejects(
      () => call("piwu_notifications", [a, 0]),
      /NOTIFY_INVALID/,
    );
    await assert.rejects(
      () => call("piwu_notifications", [a, 51]),
      /NOTIFY_INVALID/,
    );
    // Unknown accounts are ignored so a race with account deletion cannot fail
    // the payment or invite action that triggered the notice.
    assert.equal(
      await call("piwu_notification_add", [
        crypto.randomUUID(),
        "system",
        "Halo",
        "Isi",
        "",
        null,
      ]),
      null,
    );
    for (const args of [
      [a, "unknown", "Halo", "Isi", "", null],
      [a, "system", "", "Isi", "", null],
      [a, "system", "Halo", "x".repeat(501), "", null],
      [a, "system", "Halo", "Isi", "https://example.test", null],
      [a, "system", "Halo", "Isi", "//evil.test", null],
      [a, "system", "Halo", "Isi", "", "x".repeat(201)],
    ])
      await assert.rejects(
        () => call("piwu_notification_add", args),
        /NOTIFY_INVALID/,
      );
    const id = list.items.find((item: any) => item.title === "Halo").id;
    await call("piwu_notification_read", [a, id]);
    assert.equal((await call("piwu_notifications", [a, 20])).unread, 2);
    // Reading again is idempotent; another account cannot mark this row.
    await call("piwu_notification_read", [a, id]);
    await assert.rejects(
      () => call("piwu_notification_read", [b, id]),
      /NOTIFY_NOT_FOUND/,
    );
    assert.equal(await call("piwu_notification_read_all", [a]), 2);
    assert.equal((await call("piwu_notifications", [a, 20])).unread, 0);
    // Browser roles may read their own rows (Realtime needs SELECT), but never
    // execute the RPCs or write rows.
    const grants = (
      await db.query<any>(
        "select has_function_privilege('anon','public.piwu_notifications(uuid,integer)','EXECUTE') anon, has_function_privilege('authenticated','public.piwu_notifications(uuid,integer)','EXECUTE') authenticated, has_function_privilege('service_role','public.piwu_notifications(uuid,integer)','EXECUTE') service",
      )
    ).rows[0];
    assert.deepEqual(grants, {
      anon: false,
      authenticated: false,
      service: true,
    });
    await db.exec("set role authenticated");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [a]);
    assert.equal(
      (await db.query("select id from notifications")).rows.length,
      3,
    );
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [b]);
    assert.equal(
      (await db.query("select id from notifications")).rows.length,
      0,
    );
    await assert.rejects(
      () =>
        db.query(
          "insert into notifications(user_id,kind,title,body) values($1,'system','x','y')",
          [b],
        ),
      /permission denied|row-level security/i,
    );
    await db.exec("reset role");
  } finally {
    await db.close();
  }
});
