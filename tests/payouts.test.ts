import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

// What migration 013 must guarantee: a seller cannot request money before a
// human verifies KYC, requests cannot exceed the accrued balance, two tabs
// cannot spend the same balance, only a superadmin can review, and every
// decision is audited and idempotent.

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

const balance = async (db: PGlite, user: string) =>
  (await db.query<any>("select public.piwu_seller_balance($1) as b", [user]))
    .rows[0].b;

test("KYC, saldo, dan payout mengikuti aturan yang dinyatakan", async () => {
  const db = new PGlite();
  try {
    await setup(db);
    await migrate(db);
    const [seller, buyer, other, operator, root] = Array.from(
      { length: 5 },
      () => crypto.randomUUID(),
    );
    for (const id of [seller, buyer, other, operator, root])
      await db.query("insert into auth.users(id,email) values($1,$2)", [
        id,
        id + "@example.test",
      ]);
    await db.query(
      "insert into platform_admins(user_id,role) values($1,'operator'),($2,'superadmin')",
      [operator, root],
    );
    const order = crypto.randomUUID();
    await db.query(
      "insert into payment_orders(id,user_id,provider,kind,sku,amount,currency) values($1,$2,'midtrans','template','template',100000,'IDR')",
      [order, buyer],
    );
    await db.query(
      "insert into marketplace_sales(order_id,seller_id,buyer_id,gross,platform_fee,net,status) values($1,$2,$3,100000,20000,80000,'accrued')",
      [order, seller, buyer],
    );

    // No request before a human verifies KYC.
    await assert.rejects(
      () =>
        db.query(
          "select public.piwu_request_payout($1,50000,'bank','BCA 123')",
          [seller],
        ),
      /PIWU_KYC_REQUIRED/,
    );
    assert.deepEqual(await balance(db, seller), {
      accrued: 80000,
      pending: 0,
      paid: 0,
      available: 80000,
      frozen: 0,
      currency: "IDR",
    });

    // Submitting moves to pending; re-submitting keeps it in the queue.
    assert.equal(
      await scalar(
        db,
        "select public.piwu_seller_kyc_submit($1,'Rina Putri','Studio Rina',null,'ID')",
        [seller],
      ),
      "pending",
    );
    assert.equal(
      await scalar(
        db,
        "select public.piwu_seller_kyc_submit($1,'Rina Putri','Studio Rina','123','ID')",
        [seller],
      ),
      "pending",
    );

    // Only a superadmin reviews, and a rejection must carry a reason.
    await assert.rejects(
      () =>
        db.query("select public.piwu_review_kyc($1,$2,$3,'verified','ok')", [
          operator,
          crypto.randomUUID(),
          seller,
        ]),
      /ADMIN_FORBIDDEN/,
    );
    const kycRequest = crypto.randomUUID();
    const kyc = await scalar(
      db,
      "select public.piwu_review_kyc($1,$2,$3,'verified','Dokumen jelas')",
      [root, kycRequest, seller],
    );
    assert.deepEqual(kyc, { status: "verified", user_id: seller });
    // The same request id returns the same result instead of writing twice.
    assert.deepEqual(
      await scalar(
        db,
        "select public.piwu_review_kyc($1,$2,$3,'verified','Dokumen jelas')",
        [root, kycRequest, seller],
      ),
      kyc,
    );

    // First request reserves 60k; a second 50k cannot spend the same money.
    const first = await scalar(
      db,
      "select public.piwu_request_payout($1,60000,'bank','BCA 12345678')",
      [seller],
    );
    assert.match(first, /^[0-9a-f-]{36}$/);
    assert.deepEqual(await balance(db, seller), {
      accrued: 80000,
      pending: 60000,
      paid: 0,
      available: 20000,
      frozen: 0,
      currency: "IDR",
    });
    await assert.rejects(
      () =>
        db.query(
          "select public.piwu_request_payout($1,50000,'bank','BCA 12345678')",
          [seller],
        ),
      /PIWU_INSUFFICIENT/,
    );

    // Rejection releases the hold.
    const rejectRequest = crypto.randomUUID();
    await db.query(
      "select public.piwu_review_payout($1,$2,$3,'rejected',null,'Rekening tidak cocok')",
      [root, rejectRequest, first],
    );
    assert.equal((await balance(db, seller)).available, 80000);
    assert.equal((await balance(db, seller)).pending, 0);

    // A fresh request can be approved, then marked paid with a reference.
    const second = await scalar(
      db,
      "select public.piwu_request_payout($1,50000,'ewallet','08123456789')",
      [seller],
    );
    await db.query(
      "select public.piwu_review_payout($1,$2,$3,'approved',null,'Siap dibayar')",
      [root, crypto.randomUUID(), second],
    );
    await assert.rejects(
      () =>
        db.query("select public.piwu_review_payout($1,$2,$3,'paid',null,'x')", [
          root,
          crypto.randomUUID(),
          second,
        ]),
      /ADMIN_INVALID/,
    );
    const paid = await scalar(
      db,
      "select public.piwu_review_payout($1,$2,$3,'paid','TRX-9988',null)",
      [root, crypto.randomUUID(), second],
    );
    assert.deepEqual(paid, {
      status: "paid",
      amount: 50000,
      seller_id: seller,
    });
    assert.deepEqual(await balance(db, seller), {
      accrued: 80000,
      pending: 0,
      paid: 50000,
      available: 30000,
      frozen: 0,
      currency: "IDR",
    });

    // Audit trail has the KYC decision and both payout decisions.
    const actions = await db.query<any>(
      "select action from platform_audit order by created_at",
    );
    assert.deepEqual(
      actions.rows.map((row) => row.action),
      ["kyc_review", "payout_review", "payout_review", "payout_review"],
    );

    // RLS: a seller sees only their own rows.
    await db.exec("set role authenticated");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      other,
    ]);
    assert.equal(
      await scalar(db, "select count(*) from seller_verifications"),
      0,
    );
    assert.equal(
      await scalar(db, "select count(*) from marketplace_payouts"),
      0,
    );
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      seller,
    ]);
    assert.equal(
      await scalar(db, "select count(*) from seller_verifications"),
      1,
    );
    assert.equal(
      await scalar(db, "select count(*) from marketplace_payouts"),
      2,
    );
    await db.exec("reset role");

    // Account deletion: KYC disappears and transfer destinations are erased,
    // while the financial row (amount/status/reference) stays for the audit.
    const purged = (
      await db.query<any>("select public.piwu_purge_seller_pii($1) as p", [
        seller,
      ])
    ).rows[0].p;
    assert.deepEqual(purged, { verification: 1, payouts: 2, disputes: 0 });
    assert.equal(
      await scalar(
        db,
        "select count(*) from seller_verifications where user_id=$1",
        [seller],
      ),
      0,
    );
    const kept = await db.query<any>(
      "select destination,note,amount,status from marketplace_payouts where seller_id=$1",
      [seller],
    );
    assert.equal(kept.rows.length, 2);
    for (const row of kept.rows) {
      assert.equal(row.destination, "[dihapus]");
      assert.equal(row.note, null);
      assert.ok(row.amount > 0);
    }
  } finally {
    await db.close();
  }
});
