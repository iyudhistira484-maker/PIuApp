import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

// What migration 010 must be true: a daily allowance that refills to its cap
// and never accumulates, purchased credits that expire on the stated schedule,
// spending that takes the soonest-expiring lot first, refunds that give it back
// under the same policy, and one invariant everywhere: the lots always add up
// to the balance (a negative balance is debt, and then no lot is left).

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

const migrate = async (db: PGlite, upTo = MIGRATIONS.length, from = 0) => {
  for (const name of MIGRATIONS.slice(from, upTo))
    await db.exec(
      readFileSync("supabase/" + name + ".sql", "utf8").replace(
        "create extension if not exists pgcrypto;",
        "",
      ),
    );
};

const fresh = async (db: PGlite, howMany = 1) => {
  const users = Array.from({ length: howMany }, () => crypto.randomUUID());
  for (const id of users)
    await db.query("insert into auth.users(id) values($1)", [id]);
  return users;
};

const scalar = async (db: PGlite, sql: string, args: any[] = []) =>
  Object.values((await db.query<any>(sql, args)).rows[0])[0];

/** The one invariant every credit path must keep. */
const assertLotsMatchBalance = async (db: PGlite, user: string) => {
  const lots = await scalar(
    db,
    "select coalesce(sum(remaining),0) from credit_lots where user_id=$1",
    [user],
  );
  const balance = await scalar(
    db,
    "select balance from credit_accounts where user_id=$1",
    [user],
  );
  assert.equal(
    Number(lots),
    Math.max(Number(balance), 0),
    "lot harus menjumlah tepat sebesar saldo (saldo negatif = utang, tanpa lot)",
  );
};

test("daily allowance refills to the cap, never accumulates, and stops at the Free monthly cap", async () => {
  const db = new PGlite();
  try {
    await setup(db);
    await migrate(db);
    const [user] = await fresh(db);

    assert.equal(
      await scalar(db, "select piwu_ensure_credits($1)", [user]),
      20,
    );
    // Same UTC day: calling again must not add anything.
    assert.equal(
      await scalar(db, "select piwu_ensure_credits($1)", [user]),
      20,
    );
    assert.equal(
      await scalar(
        db,
        "select count(*) from credit_lots where user_id=$1 and source='daily'",
        [user],
      ),
      1,
    );
    // Unused credits do not accumulate: yesterday's lot expires at the boundary
    // and the next claim refills to exactly the cap, not cap + leftover.
    await db.query(
      "update credit_lots set remaining=7, reference='daily:kemarin', expires_at=now()-interval '1 minute' where user_id=$1",
      [user],
    );
    await db.query("update credit_accounts set balance=7 where user_id=$1", [
      user,
    ]);
    await assertLotsMatchBalance(db, user);
    assert.equal(await scalar(db, "select piwu_expire_credits()"), 7);
    assert.equal(
      await scalar(db, "select balance from credit_accounts where user_id=$1", [
        user,
      ]),
      0,
    );
    assert.equal(
      await scalar(db, "select piwu_ensure_credits($1)", [user]),
      20,
    );
    assert.equal(
      await scalar(
        db,
        "select remaining from credit_lots where user_id=$1 and source='daily' and remaining>0",
        [user],
      ),
      20,
    );
    await assertLotsMatchBalance(db, user);

    // Free plan tops out at 600 credits a month of daily allowance.
    const [capped] = await fresh(db);
    for (let i = 0; i < 30; i++)
      await db.query(
        "insert into credit_lots(user_id,source,amount,remaining,expires_at,reference) values($1,'daily',20,20,now()+interval '1 day',$2)",
        [capped, "harian:" + i],
      );
    await db.query(
      "insert into credit_accounts(user_id,balance) values($1,600)",
      [capped],
    );
    assert.equal(await scalar(db, "select piwu_claim_daily($1)", [capped]), 0);
    assert.equal(
      await scalar(db, "select balance from credit_accounts where user_id=$1", [
        capped,
      ]),
      600,
    );
  } finally {
    await db.close();
  }
});

test("spending takes the soonest-expiring lot and a failed operation gives it back", async () => {
  const db = new PGlite();
  try {
    await setup(db);
    await migrate(db);
    const [user] = await fresh(db);
    await db.query("select piwu_ensure_credits($1)", [user]);
    // A top-up that outlives the daily allowance.
    await db.query(
      "select piwu_grant_credits($1,300,'topup','Pembayaran terverifikasi',$2,'payment:uji')",
      [user, null],
    );
    await db.query(
      "update credit_lots set expires_at=now()+interval '12 months' where user_id=$1 and source='topup'",
      [user],
    );
    const daily = crypto.randomUUID();
    const reserve = crypto.randomUUID();
    assert.equal(
      await scalar(db, "select piwu_reserve_credits($1,$2,12,'ai')", [
        user,
        reserve,
      ]),
      308,
    );
    // 12 came out of the daily lot (20 -> 8), none out of the top-up.
    assert.equal(
      await scalar(
        db,
        "select remaining from credit_lots where user_id=$1 and source='daily'",
        [user],
      ),
      8,
    );
    assert.equal(
      await scalar(
        db,
        "select remaining from credit_lots where user_id=$1 and source='topup'",
        [user],
      ),
      300,
    );
    const breakdown = await scalar(
      db,
      "select lots from credit_reservations where id=$1",
      [reserve],
    );
    assert.equal(breakdown.length, 1);
    await assertLotsMatchBalance(db, user);

    // Failed operation: the credits return to the same lot, under its policy.
    await db.query("select piwu_finish_credits($1,false)", [reserve]);
    assert.equal(
      await scalar(db, "select balance from credit_accounts where user_id=$1", [
        user,
      ]),
      320,
    );
    assert.equal(
      await scalar(
        db,
        "select remaining from credit_lots where user_id=$1 and source='daily'",
        [user],
      ),
      20,
    );
    await assertLotsMatchBalance(db, user);

    // Spending more than the daily lot holds spills into the next one.
    const big = crypto.randomUUID();
    await db.query("select piwu_reserve_credits($1,$2,25,'ai')", [user, big]);
    assert.equal(
      await scalar(
        db,
        "select remaining from credit_lots where user_id=$1 and source='topup'",
        [user],
      ),
      295,
    );
    await db.query("select piwu_finish_credits($1,true)", [big]);
    assert.equal(
      await scalar(db, "select balance from credit_accounts where user_id=$1", [
        user,
      ]),
      295,
    );
    assert.equal(
      await scalar(
        db,
        "select count(*) from credit_ledger where user_id=$1 and reason='Kredit kedaluwarsa'",
        [user],
      ),
      0,
    );
    await assertLotsMatchBalance(db, user);
    assert.ok(daily);
  } finally {
    await db.close();
  }
});

test("purchases carry their own expiry, and expiry is reported once", async () => {
  const db = new PGlite();
  try {
    await setup(db);
    await migrate(db);
    const [user] = await fresh(db);
    await db.query("select piwu_ensure_credits($1)", [user]);
    const planOrder = crypto.randomUUID();
    const topupOrder = crypto.randomUUID();
    await db.query(
      "insert into payment_orders(id,user_id,provider,kind,sku,amount,credits,plan) values($1,$2,'midtrans','plan','pro',199000,1500,'Pro'),($3,$2,'midtrans','topup','credits300',49000,300,null)",
      [planOrder, user, topupOrder],
    );
    assert.equal(
      await scalar(db, "select piwu_apply_payment($1,199000,'IDR','paid')", [
        planOrder,
      ]),
      "paid",
    );
    assert.equal(
      await scalar(db, "select piwu_apply_payment($1,49000,'IDR','paid')", [
        topupOrder,
      ]),
      "paid",
    );
    // Plan credits: two months. Top-up credits: twelve.
    const planMonths = await scalar(
      db,
      "select round(extract(epoch from (expires_at-granted_at))/2592000) from credit_lots where user_id=$1 and source='plan'",
      [user],
    );
    const topupMonths = await scalar(
      db,
      "select round(extract(epoch from (expires_at-granted_at))/2592000) from credit_lots where user_id=$1 and source='topup'",
      [user],
    );
    assert.equal(Number(planMonths), 2);
    assert.equal(Number(topupMonths), 12);
    // A Pro account gets the paid daily allowance (30) and no monthly cap.
    assert.equal(
      await scalar(db, "select piwu_claim_daily($1)", [user]),
      0,
      "hari ini sudah diklaim",
    );
    await assertLotsMatchBalance(db, user);

    // Expiry zeroes the lot, lowers the balance and is written down once.
    await db.query(
      "update credit_lots set expires_at=now()-interval '1 minute' where user_id=$1 and source='topup'",
      [user],
    );
    assert.equal(await scalar(db, "select piwu_expire_credits()"), 300);
    const ledger = await db.query<any>(
      "select delta,reason from credit_ledger where user_id=$1 and reason='Kredit kedaluwarsa'",
      [user],
    );
    assert.equal(ledger.rows.length, 1);
    assert.equal(Number(ledger.rows[0].delta), -300);
    assert.equal(await scalar(db, "select piwu_expire_credits()"), 0);
    await assertLotsMatchBalance(db, user);
    // Daily credits survive as long as their boundary has not passed.
    assert.equal(
      await scalar(
        db,
        "select remaining from credit_lots where user_id=$1 and source='daily'",
        [user],
      ),
      20,
    );
  } finally {
    await db.close();
  }
});

test("a Team seat gets the bigger daily allowance, and admin grants never expire", async () => {
  const db = new PGlite();
  try {
    await setup(db);
    await migrate(db);
    const [user] = await fresh(db);
    const order = crypto.randomUUID();
    await db.query(
      "insert into payment_orders(id,user_id,provider,kind,sku,amount,credits,plan) values($1,$2,'midtrans','plan','team',499000,4500,'Team')",
      [order, user],
    );
    await db.query("select piwu_apply_payment($1,499000,'IDR','paid')", [
      order,
    ]);
    // Paying mid-day does not hand out a second allowance for that same day:
    // the paid daily starts at the next reset.
    assert.equal(await scalar(db, "select piwu_claim_daily($1)", [user]), 0);
    assert.equal(
      await scalar(
        db,
        "select amount from credit_lots where user_id=$1 and source='daily'",
        [user],
      ),
      20,
    );
    await db.query(
      "update credit_lots set reference='daily:kemarin', expires_at=now()-interval '1 minute' where user_id=$1 and source='daily'",
      [user],
    );
    await db.query("select piwu_expire_credits()");
    assert.equal(await scalar(db, "select piwu_claim_daily($1)", [user]), 40);
    // Admin adds and removes: an operator grant has no expiry, and taking it
    // back leaves the lots and the balance in step.
    await db.query(
      "select piwu_grant_credits($1,500,'admin','Penyesuaian admin: uji',null,'admin:uji')",
      [user],
    );
    assert.equal(
      await scalar(
        db,
        "select coalesce(expires_at is null,false) from credit_lots where user_id=$1 and source='admin'",
        [user],
      ),
      true,
    );
    const before = Number(
      await scalar(db, "select balance from credit_accounts where user_id=$1", [
        user,
      ]),
    );
    await db.query(
      "select piwu_revoke_credits($1,500,'Penyesuaian admin: batal','admin:batal')",
      [user],
    );
    assert.equal(
      Number(
        await scalar(
          db,
          "select balance from credit_accounts where user_id=$1",
          [user],
        ),
      ),
      before - 500,
    );
    await assertLotsMatchBalance(db, user);

    // A chargeback draws the credits back out of the lots.
    const chargeback = crypto.randomUUID();
    await db.query(
      "insert into payment_orders(id,user_id,provider,kind,sku,amount,credits,fulfilled_at) values($1,$2,'midtrans','topup','credits300',49000,300,now())",
      [chargeback, user],
    );
    await db.query(
      "select piwu_grant_credits($1,300,'topup','Pembayaran terverifikasi',$2,'payment:uji')",
      [user, null],
    );
    const paidCredits = Number(
      await scalar(db, "select balance from credit_accounts where user_id=$1", [
        user,
      ]),
    );
    await db.query("select piwu_apply_payment($1,49000,'IDR','refunded')", [
      chargeback,
    ]);
    assert.equal(
      Number(
        await scalar(
          db,
          "select balance from credit_accounts where user_id=$1",
          [user],
        ),
      ),
      paidCredits - 300,
      "pembatalan pembayaran menarik kembali kreditnya",
    );
    await assertLotsMatchBalance(db, user);
    // Even when the credits are already spent, no lot may go negative: the
    // shortfall is debt on the balance, the way it was before 010.
    await db.query(
      "select piwu_revoke_credits($1,100000,'Pembatalan pembayaran','chargeback:uji')",
      [user],
    );
    assert.equal(
      await scalar(
        db,
        "select coalesce(sum(remaining),0) from credit_lots where user_id=$1",
        [user],
      ),
      0,
    );
    assert.ok(
      Number(
        await scalar(
          db,
          "select balance from credit_accounts where user_id=$1",
          [user],
        ),
      ) < 0,
    );
    await assertLotsMatchBalance(db, user);
  } finally {
    await db.close();
  }
});

test("a Pro seat gets 30 a day while the monthly grant stays 1.500", async () => {
  const db = new PGlite();
  try {
    await setup(db);
    await migrate(db);
    const [user] = await fresh(db);
    const order = crypto.randomUUID();
    await db.query(
      "insert into payment_orders(id,user_id,provider,kind,sku,amount,credits,plan) values($1,$2,'midtrans','plan','pro',199000,1500,'Pro')",
      [order, user],
    );
    await db.query("select piwu_apply_payment($1,199000,'IDR','paid')", [
      order,
    ]);
    // The monthly grant is exactly what the plan sells, untouched by the daily
    // allowance: 1.500 credited, and today's Free 20 already claimed before the
    // plan was applied.
    assert.equal(
      Number(
        await scalar(
          db,
          "select amount from credit_lots where user_id=$1 and source='plan'",
          [user],
        ),
      ),
      1500,
    );
    assert.equal(
      Number(
        await scalar(
          db,
          "select amount from credit_lots where user_id=$1 and source='daily'",
          [user],
        ),
      ),
      20,
      "jatah hari berganti paket tetap jatah hari itu",
    );
    // The next reset is the first day the bigger allowance applies.
    await db.query(
      "update credit_lots set reference='daily:kemarin', expires_at=now()-interval '1 minute' where user_id=$1 and source='daily'",
      [user],
    );
    await db.query("select piwu_expire_credits()");
    assert.equal(await scalar(db, "select piwu_claim_daily($1)", [user]), 30);
    // Team still gets more, so the ladder stays readable from the database.
    await db.query("update subscriptions set plan='Team' where user_id=$1", [
      user,
    ]);
    await db.query(
      "update credit_lots set reference='daily:kemarin', expires_at=now()-interval '1 minute' where user_id=$1 and source='daily'",
      [user],
    );
    await db.query("select piwu_expire_credits()");
    assert.equal(await scalar(db, "select piwu_claim_daily($1)", [user]), 40);
    await assertLotsMatchBalance(db, user);
  } finally {
    await db.close();
  }
});

test("accounts that existed before 010 keep their credits as a dated lot", async () => {
  const db = new PGlite();
  try {
    await setup(db);
    await migrate(db, MIGRATIONS.length - 1);
    const [user] = await fresh(db);
    await db.query(
      "insert into credit_accounts(user_id,balance) values($1,128)",
      [user],
    );
    await migrate(db, MIGRATIONS.length, MIGRATIONS.length - 1);
    assert.equal(
      await scalar(
        db,
        "select remaining from credit_lots where user_id=$1 and reference like 'migrasi-010%'",
        [user],
      ),
      128,
    );
    assert.equal(
      Number(
        await scalar(
          db,
          "select round(extract(epoch from (expires_at-granted_at))/2592000) from credit_lots where user_id=$1",
          [user],
        ),
      ),
      12,
    );
    // And the migration is the only thing that ran: the daily allowance is not
    // handed out twice for the same day.
    assert.equal(
      await scalar(db, "select piwu_ensure_credits($1)", [user]),
      148,
    );
    assert.equal(
      await scalar(db, "select piwu_ensure_credits($1)", [user]),
      148,
    );
    await assertLotsMatchBalance(db, user);
  } finally {
    await db.close();
  }
});

test("piwu_credit_status reports today's allowance, the cap and the real reset instant", async () => {
  const db = new PGlite();
  try {
    await setup(db);
    await migrate(db);
    const [free] = await fresh(db);

    // A brand-new Free account: claim first (that is what /api/account does),
    // then read the status. Nothing is invented: the numbers are today's lot.
    await db.query("select piwu_ensure_credits($1)", [free]);
    const status = async (user: string) =>
      (await db.query<any>("select piwu_credit_status($1) as s", [user]))
        .rows[0].s;
    const first = await status(free);
    assert.equal(first.applied, true);
    assert.equal(first.source, "database");
    assert.equal(first.plan, "Free");
    assert.equal(first.daily, 20);
    assert.equal(first.dailyClaimed, 20);
    assert.equal(first.dailyRemaining, 20);
    assert.equal(first.monthlyCap, 600);
    assert.equal(first.monthlyUsed, 20);
    assert.equal(first.resetUtcHour, 0);
    assert.equal(first.planMonths, 2);
    assert.equal(first.topupMonths, 12);
    // The reset instant is the daily lot's own expiry: the countdown a page
    // prints cannot point at a time the database does not use.
    const lotExpiry = await scalar(
      db,
      "select expires_at from credit_lots where user_id=$1 and source='daily'",
      [free],
    );
    assert.equal(
      new Date(first.resetAt).toISOString(),
      new Date(lotExpiry as string).toISOString(),
    );
    const hours = (new Date(first.resetAt).getTime() - Date.now()) / 3600000;
    assert.ok(hours > 0 && hours <= 24, `reset dalam ${hours} jam`);
    assert.equal(new Date(first.resetAt).getUTCHours(), 0);
    // Reading it twice changes nothing (it is a read, not a claim).
    assert.deepEqual(await status(free), first);

    // Spending today's allowance shows up as less left over, and settling a
    // reservation does not touch the accounting.
    const job = crypto.randomUUID();
    await db.query("select piwu_reserve_credits($1,$2,5,'ai')", [free, job]);
    const spent = await status(free);
    assert.equal(spent.dailyRemaining, 15);
    assert.equal(spent.dailyClaimed, 20);
    await db.query("select piwu_finish_credits($1,true)", [job]);
    assert.equal((await status(free)).dailyRemaining, 15);

    // A refunded operation hands the credits back to the same lot.
    const failed = crypto.randomUUID();
    await db.query("select piwu_reserve_credits($1,$2,3,'ai')", [free, failed]);
    assert.equal((await status(free)).dailyRemaining, 12);
    await db.query("select piwu_finish_credits($1,false)", [failed]);
    assert.equal((await status(free)).dailyRemaining, 15);

    // Team: the bigger allowance and no monthly cap.
    const [team] = await fresh(db);
    await db.query(
      "insert into subscriptions(user_id,plan,provider,status,current_period_start,current_period_end) values($1,'Team','test','active',now()-interval '1 day',now()+interval '29 days')",
      [team],
    );
    await db.query("select piwu_ensure_credits($1)", [team]);
    const seat = await status(team);
    assert.equal(seat.plan, "Team");
    assert.equal(seat.daily, 40);
    assert.equal(seat.dailyRemaining, 40);
    assert.equal(seat.monthlyCap, null);
    assert.equal(seat.monthlyUsed, 40);

    // Free account whose month is already full: nothing is granted today, and
    // the status says so instead of promising 20 credits that will not come.
    const [capped] = await fresh(db);
    await db.query("select piwu_ensure_credits($1)", [capped]);
    await db.query(
      "update credit_lots set amount=600,remaining=600 where user_id=$1 and source='daily'",
      [capped],
    );
    await db.query("delete from credit_lots where user_id=$1", [capped]);
    await db.query(
      "insert into credit_lots(user_id,source,amount,remaining,granted_at,expires_at,reference) values($1,'daily',600,600,now()-interval '2 days',now()-interval '1 day','daily:past')",
      [capped],
    );
    await db.query("update credit_accounts set balance=600 where user_id=$1", [
      capped,
    ]);
    assert.equal(
      await scalar(db, "select piwu_claim_daily($1)", [capped]),
      0,
      "plafon bulanan Free sudah penuh",
    );
    const full = await status(capped);
    assert.equal(full.daily, 20);
    assert.equal(full.dailyClaimed, 0);
    assert.equal(full.dailyRemaining, 0);
    assert.equal(full.monthlyUsed, 600);
    assert.ok(!/0001-01-01/.test(String(full.resetAt)));

    // The status is service-only: a browser session may not read other people's
    // allowance, and the balance invariant is untouched by any of this.
    await db.exec("set role authenticated");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      free,
    ]);
    await assert.rejects(
      db.query("select piwu_credit_status($1)", [free]),
      /permission denied/,
    );
    await db.exec("reset role");
    await assertLotsMatchBalance(db, free);
    await assertLotsMatchBalance(db, team);
  } finally {
    await db.close();
  }
});

test("a reservation made before 010 still refunds into a lot", async () => {
  const db = new PGlite();
  try {
    await setup(db);
    await migrate(db, MIGRATIONS.length - 1);
    const [user] = await fresh(db);
    await db.query(
      "insert into credit_accounts(user_id,balance) values($1,25)",
      [user],
    );
    const legacy = crypto.randomUUID();
    await db.query(
      "insert into credit_reservations(id,user_id,amount,purpose) values($1,$2,5,'ai')",
      [legacy, user],
    );
    await migrate(db, MIGRATIONS.length, MIGRATIONS.length - 1);
    await db.query("select piwu_finish_credits($1,false)", [legacy]);
    assert.equal(
      Number(
        await scalar(
          db,
          "select balance from credit_accounts where user_id=$1",
          [user],
        ),
      ),
      30,
    );
    await assertLotsMatchBalance(db, user);
  } finally {
    await db.close();
  }
});
