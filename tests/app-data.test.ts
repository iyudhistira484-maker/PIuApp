import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

// What migration 016 must guarantee: only project owners/editors manage keys,
// keys are hashed, read keys cannot write, row operations validate against the
// table's columns and limits, and a revoked key stops working immediately.
const MIGRATIONS = [
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
  "013_marketplace_payouts",
  "014_marketplace_disputes",
  "015_no_refunds",
  "016_app_data_api",
];

const setup = async (db: PGlite) =>
  db.exec(`
 create role anon; create role authenticated; create role service_role bypassrls;
 create schema auth;
 create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',created_at timestamptz default now(),last_sign_in_at timestamptz,email_confirmed_at timestamptz,phone_confirmed_at timestamptz,is_anonymous boolean default false);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create schema storage;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);
 alter table storage.objects enable row level security;
 create function storage.foldername(n text) returns text[] language sql immutable as $$select string_to_array(n,'/')$$;
 grant usage on schema public,auth,storage to authenticated,anon,service_role;
 grant execute on function auth.uid() to authenticated,anon;
 alter default privileges in schema public grant select,insert,update,delete on tables to authenticated;
`);

const migrate = async (db: PGlite) => {
  for (const name of MIGRATIONS)
    await db.exec(
      readFileSync("supabase/" + name + ".sql", "utf8").replace(
        "create extension if not exists pgcrypto;",
        "",
      ),
    );
};

const scalar = async (db: PGlite, sql: string, args: any[] = []) =>
  Object.values((await db.query<any>(sql, args)).rows[0])[0];
const json = async (db: PGlite, sql: string, args: any[] = []) =>
  (await db.query<any>(sql, args)).rows[0];

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

test("API data aplikasi: kunci per project, scope baca/tulis, dan operasi baris", async () => {
  const db = new PGlite();
  try {
    await setup(db);
    await migrate(db);
    const owner = crypto.randomUUID(),
      editor = crypto.randomUUID(),
      viewer = crypto.randomUUID(),
      outsider = crypto.randomUUID();
    for (const id of [owner, editor, viewer, outsider])
      await db.query("insert into auth.users(id,email) values($1,$2)", [
        id,
        id + "@example.test",
      ]);
    const project = crypto.randomUUID(),
      foreign = crypto.randomUUID();
    await db.query(
      "insert into projects(id,owner_id,name) values($1,$2,'App Uji'),($3,$4,'Project Lain')",
      [project, owner, foreign, outsider],
    );
    await db.query(
      "insert into collaborators(project_id,user_id,role) values($1,$2,'Editor'),($1,$3,'Viewer')",
      [project, editor, viewer],
    );
    const table = crypto.randomUUID();
    await db.query(
      `insert into project_datasets(id,project_id,name,columns,rows,revision,created_by,updated_by)
       values($1,$2,'Tugas',$3,'[]',1,$4,$4)`,
      [
        table,
        project,
        JSON.stringify([
          { key: "title", label: "Judul", type: "text" },
          { key: "done", label: "Selesai", type: "boolean" },
        ]),
        owner,
      ],
    );

    // Only owner/editor may create or revoke; a Viewer may see the metadata.
    await assert.rejects(
      () =>
        db.query(
          "select public.piwu_app_key_create($1,$2,$3,'Web',repeat('c',64),'read')",
          [viewer, project, crypto.randomUUID()],
        ),
      /PIWU_APP_FORBIDDEN/,
    );
    assert.deepEqual(
      (
        await json(db, "select public.piwu_app_key_list($1,$2)", [
          viewer,
          project,
        ])
      ).piwu_app_key_list,
      [],
    );
    await assert.rejects(
      () =>
        db.query("select public.piwu_app_key_list($1,$2)", [outsider, project]),
      /PIWU_APP_FORBIDDEN/,
    );

    const readKey = crypto.randomUUID();
    const created = await json(
      db,
      "select public.piwu_app_key_create($1,$2,$3,'Web publik',$4,'read') as k",
      [editor, project, readKey, HASH_A],
    );
    assert.equal(created.k.scope, "read");
    assert.equal(created.k.label, "Web publik");
    assert.equal(
      await scalar(
        db,
        "select count(*) from project_api_keys where key_hash=$1",
        [HASH_A],
      ),
      1,
    );

    // The plaintext never exists: only the hash is stored.
    assert.equal(
      await scalar(
        db,
        "select count(*) from project_api_keys where key_hash like 'piwu_sk_%'",
      ),
      0,
    );

    const listed = await scalar(db, "select public.piwu_app_key_list($1,$2)", [
      owner,
      project,
    ]);
    assert.equal(listed.length, 1);
    assert.equal(listed[0].id, readKey);
    assert.equal(listed[0].scope, "read");
    assert.equal("key_hash" in listed[0], false);

    // Reading works with a read key.
    const tables = await scalar(
      db,
      "select public.piwu_app_request($1,null,'tables',null)",
      [HASH_A],
    );
    assert.equal(tables.tables.length, 1);
    assert.equal(tables.tables[0].name, "Tugas");
    assert.equal(tables.tables[0].rows, 0);

    const empty = await scalar(
      db,
      "select public.piwu_app_request($1,$2,'list',null)",
      [HASH_A, table],
    );
    assert.equal(empty.name, "Tugas");
    assert.deepEqual(empty.rows, []);

    // A read key cannot write.
    await assert.rejects(
      () =>
        db.query("select public.piwu_app_request($1,$2,'insert',$3)", [
          HASH_A,
          table,
          JSON.stringify({ rows: [{ values: { title: "Halo" } }] }),
        ]),
      /PIWU_APP_READONLY/,
    );
    // Unknown or wrong key is rejected before touching data.
    await assert.rejects(
      () =>
        db.query(
          "select public.piwu_app_request(repeat('9',64),null,'tables',null)",
        ),
      /PIWU_APP_KEY/,
    );

    // A write key inserts, updates and deletes with validation.
    await db.query(
      "select public.piwu_app_key_create($1,$2,$3,'Bot isi',$4,'write')",
      [owner, project, crypto.randomUUID(), HASH_B],
    );
    const inserted = await scalar(
      db,
      "select public.piwu_app_request($1,$2,'insert',$3)",
      [
        HASH_B,
        table,
        JSON.stringify({
          rows: [
            { values: { title: "Tulis laporan", done: false } },
            { values: { title: "Review", done: true } },
          ],
        }),
      ],
    );
    assert.equal(inserted.revision, 2);
    assert.equal(inserted.rows.length, 2);
    const rowId = inserted.rows[0].id;
    assert.match(rowId, /^[0-9a-f-]{36}$/);

    // IDs are caller-visible, so duplicates (existing or inside one batch) are
    // rejected instead of silently producing two rows with the same id.
    const duplicateId = crypto.randomUUID();
    await assert.rejects(
      () =>
        db.query("select public.piwu_app_request($1,$2,'insert',$3)", [
          HASH_B,
          table,
          JSON.stringify({ rows: [{ id: rowId, values: { title: "Ganda" } }] }),
        ]),
      /PIWU_DATA_INVALID/,
    );
    await assert.rejects(
      () =>
        db.query("select public.piwu_app_request($1,$2,'insert',$3)", [
          HASH_B,
          table,
          JSON.stringify({
            rows: [
              { id: duplicateId, values: { title: "Satu" } },
              { id: duplicateId, values: { title: "Dua" } },
            ],
          }),
        ]),
      /PIWU_DATA_INVALID/,
    );

    const updated = await scalar(
      db,
      "select public.piwu_app_request($1,$2,'update',$3)",
      [HASH_B, table, JSON.stringify({ id: rowId, values: { done: true } })],
    );
    assert.equal(updated.rows[0].values.done, true);
    assert.equal(updated.rows[0].values.title, "Tulis laporan");

    // Wrong types and unknown columns never reach the table.
    await assert.rejects(
      () =>
        db.query("select public.piwu_app_request($1,$2,'insert',$3)", [
          HASH_B,
          table,
          JSON.stringify({ rows: [{ values: { title: 5 } }] }),
        ]),
      /PIWU_DATA_INVALID/,
    );
    await assert.rejects(
      () =>
        db.query("select public.piwu_app_request($1,$2,'insert',$3)", [
          HASH_B,
          table,
          JSON.stringify({ rows: [{ values: { rahasia: "x" } }] }),
        ]),
      /PIWU_DATA_INVALID/,
    );
    await assert.rejects(
      () =>
        db.query("select public.piwu_app_request($1,$2,'insert',$3)", [
          HASH_B,
          table,
          JSON.stringify({
            rows: Array.from({ length: 51 }, () => ({
              values: { title: "x" },
            })),
          }),
        ]),
      /PIWU_DATA_INVALID/,
    );
    await assert.rejects(
      () =>
        db.query("select public.piwu_app_request($1,$2,'update',$3)", [
          HASH_B,
          table,
          JSON.stringify({ id: crypto.randomUUID(), values: { done: true } }),
        ]),
      /PIWU_APP_NOT_FOUND/,
    );
    // A key is scoped to its project: another project's table is not found.
    const otherTable = crypto.randomUUID();
    await db.query(
      `insert into project_datasets(id,project_id,name,columns,rows,revision,created_by,updated_by)
       values($1,$2,'Lain',$3,'[]',1,$4,$4)`,
      [
        otherTable,
        foreign,
        JSON.stringify([{ key: "x", label: "X", type: "text" }]),
        outsider,
      ],
    );
    await assert.rejects(
      () =>
        db.query("select public.piwu_app_request($1,$2,'list',null)", [
          HASH_B,
          otherTable,
        ]),
      /PIWU_APP_NOT_FOUND/,
    );

    const deleted = await scalar(
      db,
      "select public.piwu_app_request($1,$2,'delete',$3)",
      [HASH_B, table, JSON.stringify({ id: rowId })],
    );
    assert.equal(deleted.rows.length, 1);
    assert.equal(deleted.revision, updated.revision + 1);

    // Revoking stops the key immediately.
    assert.equal(
      await scalar(db, "select public.piwu_app_key_revoke($1,$2,$3)", [
        owner,
        project,
        readKey,
      ]),
      true,
    );
    await assert.rejects(
      () =>
        db.query("select public.piwu_app_request($1,null,'tables',null)", [
          HASH_A,
        ]),
      /PIWU_APP_KEY/,
    );
    assert.equal(
      (
        await scalar(db, "select public.piwu_app_key_list($1,$2)", [
          owner,
          project,
        ])
      ).find((key: any) => key.id === readKey).revoked,
      true,
    );

    // Active-key limit per project.
    for (let i = 0; i < 4; i++)
      await db.query(
        "select public.piwu_app_key_create($1,$2,$3,$4,repeat($5,64),'read')",
        [owner, project, crypto.randomUUID(), "kunci " + i, String(i)],
      );
    await assert.rejects(
      () =>
        db.query(
          "select public.piwu_app_key_create($1,$2,$3,'kunci 6',repeat('f',64),'read')",
          [owner, project, crypto.randomUUID()],
        ),
      /PIWU_APP_LIMIT/,
    );

    // Browser roles cannot touch the table or call the RPCs.
    await db.exec("set role authenticated");
    await assert.rejects(
      () => db.query("select count(*) from project_api_keys"),
      /permission denied/,
    );
    await db.exec("reset role");
  } finally {
    await db.close();
  }
});
