import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

// What migration 014 must guarantee: only the buyer of a recent sale can open
// one dispute, the seller can answer once, the seller's share is frozen while
// the dispute is open or refund-approved, and only a superadmin can decide.
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

const purchase = async (
  db: PGlite,
  seller: string,
  buyer: string,
  template: string,
  amount = 100000,
) => {
  const order = crypto.randomUUID();
  await db.query(
    "insert into payment_orders(id,user_id,provider,kind,sku,amount,currency,template_id) values($1,$2,'midtrans','template','template',$3,'IDR',$4)",
    [order, buyer, amount, template],
  );
  await db.query(
    "insert into template_entitlements(user_id,template_id,order_id) values($1,$2,$3) on conflict (user_id,template_id) do nothing",
    [buyer, template, order],
  );
  await db.query(
    "insert into marketplace_sales(order_id,seller_id,buyer_id,gross,platform_fee,net,status) values($1,$2,$3,$4,$5,$6,'accrued')",
    [
      order,
      seller,
      buyer,
      amount,
      Math.round(amount * 0.2),
      amount - Math.round(amount * 0.2),
    ],
  );
  return order;
};

test("sengketa marketplace: satu laporan, balasan penjual, pembekuan saldo, dan keputusan superadmin", async () => {
  const db = new PGlite();
  try {
    await setup(db);
    await migrate(db);
    const [seller, buyer, outsider, operator, root] = Array.from(
      { length: 5 },
      () => crypto.randomUUID(),
    );
    for (const id of [seller, buyer, outsider, operator, root])
      await db.query("insert into auth.users(id,email) values($1,$2)", [
        id,
        id + "@example.test",
      ]);
    await db.query(
      "insert into platform_admins(user_id,role) values($1,'operator'),($2,'superadmin')",
      [operator, root],
    );
    const template = crypto.randomUUID();
    await db.query(
      "insert into templates(id,owner_id,project_snapshot,price,status) values($1,$2,'{\"files\":{}}',100000,'published')",
      [template, seller],
    );
    const first = await purchase(db, seller, buyer, template);

    // Only the buyer of that order, with a real description, can open it.
    await assert.rejects(
      () =>
        db.query(
          "select public.piwu_dispute_open($1,$2,'broken','Template tidak bisa dibuka sama sekali')",
          [outsider, first],
        ),
      /PIWU_FORBIDDEN/,
    );
    await assert.rejects(
      () =>
        db.query("select public.piwu_dispute_open($1,$2,'broken','pendek')", [
          buyer,
          first,
        ]),
      /PIWU_INVALID/,
    );
    const dispute = await scalar(
      db,
      "select public.piwu_dispute_open($1,$2,'not_as_described','Isi template berbeda dari deskripsi dan contoh di halaman toko')",
      [buyer, first],
    );
    assert.ok(dispute);
    await assert.rejects(
      () =>
        db.query(
          "select public.piwu_dispute_open($1,$2,'other','Saya ingin membuka laporan kedua untuk pesanan yang sama')",
          [buyer, first],
        ),
      /PIWU_DUPLICATE/,
    );

    // The seller's share is frozen while the report is open.
    assert.deepEqual(await balance(db, seller), {
      accrued: 0,
      pending: 0,
      paid: 0,
      available: 0,
      frozen: 80000,
      currency: "IDR",
    });

    // KYC verified, but the frozen sale cannot be withdrawn yet.
    await db.query(
      "select public.piwu_seller_kyc_submit($1,'Penjual Uji',null,null,'ID')",
      [seller],
    );
    await db.query(
      "select public.piwu_review_kyc($1,$2,$3,'verified','Dokumen sesuai')",
      [root, crypto.randomUUID(), seller],
    );
    await assert.rejects(
      () =>
        db.query(
          "select public.piwu_request_payout($1,50000,'bank','BCA 1234567890')",
          [seller],
        ),
      /PIWU_INSUFFICIENT/,
    );

    // Only the seller answers, once, and only with a real explanation.
    await assert.rejects(
      () =>
        db.query(
          "select public.piwu_dispute_reply($1,$2,'Ini balasan penjual yang cukup panjang')",
          [buyer, dispute],
        ),
      /PIWU_FORBIDDEN/,
    );
    await assert.rejects(
      () =>
        db.query("select public.piwu_dispute_reply($1,$2,'singkat')", [
          seller,
          dispute,
        ]),
      /PIWU_INVALID/,
    );
    assert.equal(
      await scalar(
        db,
        "select public.piwu_dispute_reply($1,$2,'Template sudah diperbarui; silakan unduh ulang dari halaman pembelian')",
        [seller, dispute],
      ),
      "seller_replied",
    );
    await assert.rejects(
      () =>
        db.query(
          "select public.piwu_dispute_reply($1,$2,'Balasan kedua tidak boleh menimpa balasan pertama')",
          [seller, dispute],
        ),
      /PIWU_INVALID/,
    );

    // Withdrawing releases the freeze, so a payout can now be requested.
    assert.equal(
      await scalar(db, "select public.piwu_dispute_withdraw($1,$2)", [
        buyer,
        dispute,
      ]),
      "withdrawn",
    );
    assert.deepEqual(await balance(db, seller), {
      accrued: 80000,
      pending: 0,
      paid: 0,
      available: 80000,
      frozen: 0,
      currency: "IDR",
    });
    const payout = await scalar(
      db,
      "select public.piwu_request_payout($1,50000,'bank','BCA 1234567890')",
      [seller],
    );
    assert.ok(payout);

    // A second sale: opening freezes it, and only a superadmin can close the
    // report. Closing releases the share; no money moves at any point.
    const second = await purchase(db, seller, buyer, template);
    const secondDispute = await scalar(
      db,
      "select public.piwu_dispute_open($1,$2,'broken','File yang diunduh rusak dan tidak bisa dipakai sama sekali')",
      [buyer, second],
    );
    assert.deepEqual(await balance(db, seller), {
      accrued: 80000,
      pending: 50000,
      paid: 0,
      available: 30000,
      frozen: 80000,
      currency: "IDR",
    });
    await assert.rejects(
      () =>
        db.query(
          "select public.piwu_dispute_review($1,$2,$3,'resolved','Laporan ditutup setelah penjual memperbaiki akses')",
          [operator, crypto.randomUUID(), secondDispute],
        ),
      /ADMIN_FORBIDDEN/,
    );
    const reviewRequest = crypto.randomUUID();
    // The platform has no refunds: the old outcome is rejected outright.
    await assert.rejects(
      () =>
        db.query(
          "select public.piwu_dispute_review($1,$2,$3,'refund_approved','Mencoba memakai status refund lama')",
          [root, crypto.randomUUID(), secondDispute],
        ),
      /ADMIN_INVALID/,
    );
    const approved = await scalar(
      db,
      "select public.piwu_dispute_review($1,$2,$3,'resolved','Laporan ditutup setelah penjual memperbaiki akses')",
      [root, reviewRequest, secondDispute],
    );
    assert.equal(approved.status, "resolved");
    assert.equal(approved.refund, false);
    assert.equal(approved.buyer_id, buyer);
    assert.deepEqual(
      await scalar(
        db,
        "select public.piwu_dispute_review($1,$2,$3,'resolved','Laporan ditutup setelah penjual memperbaiki akses')",
        [root, reviewRequest, secondDispute],
      ),
      approved,
    );
    assert.deepEqual(await balance(db, seller), {
      accrued: 160000,
      pending: 50000,
      paid: 0,
      available: 110000,
      frozen: 0,
      currency: "IDR",
    });

    // A rejected report releases the freeze again.
    const third = await purchase(db, seller, buyer, template);
    const thirdDispute = await scalar(
      db,
      "select public.piwu_dispute_open($1,$2,'other','Pembelian ini dilaporkan setelah mencoba menghubungi penjual')",
      [buyer, third],
    );
    await db.query(
      "select public.piwu_dispute_review($1,$2,$3,'rejected','Laporan tidak didukung bukti yang cukup')",
      [root, crypto.randomUUID(), thirdDispute],
    );
    assert.deepEqual(await balance(db, seller), {
      accrued: 240000,
      pending: 50000,
      paid: 0,
      available: 190000,
      frozen: 0,
      currency: "IDR",
    });

    // Older purchases are outside the 30-day window.
    const old = await purchase(db, seller, buyer, template);
    await db.query(
      "update marketplace_sales set created_at = now() - interval '31 days' where order_id=$1",
      [old],
    );
    await assert.rejects(
      () =>
        db.query(
          "select public.piwu_dispute_open($1,$2,'other','Pembelian lama di luar jendela tiga puluh hari')",
          [buyer, old],
        ),
      /PIWU_EXPIRED/,
    );

    assert.deepEqual(
      await scalar(db, "select public.piwu_dispute_outcomes()"),
      ["open", "seller_replied", "resolved", "rejected", "withdrawn"],
    );
    const actions = await db.query<any>(
      "select action, count(*)::integer as total from platform_audit group by action order by action",
    );
    assert.deepEqual(actions.rows, [
      { action: "dispute_review", total: 2 },
      { action: "kyc_review", total: 1 },
    ]);

    // RLS: buyer and seller read their own rows, an outsider reads none.
    await db.exec("set role authenticated");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      outsider,
    ]);
    assert.equal(
      await scalar(db, "select count(*) from marketplace_disputes"),
      0,
    );
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      buyer,
    ]);
    assert.equal(
      await scalar(db, "select count(*) from marketplace_disputes"),
      3,
    );
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      seller,
    ]);
    assert.equal(
      await scalar(db, "select count(*) from marketplace_disputes"),
      3,
    );
    await db.exec("reset role");

    // Deleting either party removes the free-text dispute; payouts keep their
    // financial rows.
    const purged = (
      await db.query<any>("select public.piwu_purge_seller_pii($1) as p", [
        buyer,
      ])
    ).rows[0].p;
    assert.equal(purged.disputes, 3);
    assert.equal(
      await scalar(db, "select count(*) from marketplace_disputes"),
      0,
    );
  } finally {
    await db.close();
  }
});
