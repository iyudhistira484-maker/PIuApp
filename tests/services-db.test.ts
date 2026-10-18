import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
test("Service migration: atomic credits, payment replay/refund, invite and role boundaries", async () => {
  const db = new PGlite();
  try {
    await db.exec(
      `create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;create function storage.foldername(n text) returns text[] language sql immutable as $$select string_to_array(n,'/')$$;grant usage on schema public,auth,storage to authenticated,anon,service_role;grant execute on function auth.uid() to authenticated,anon;alter default privileges in schema public grant select,insert,update,delete on tables to authenticated;`,
    );
    for (const name of [
      "001_schema",
      "002_workspace_sync",
      "003_services",
      "010_credit_lots",
    ])
      await db.exec(
        readFileSync("supabase/" + name + ".sql", "utf8").replace(
          "create extension if not exists pgcrypto;",
          "",
        ),
      );
    const a = crypto.randomUUID(),
      b = crypto.randomUUID(),
      p = crypto.randomUUID(),
      r = crypto.randomUUID(),
      order = crypto.randomUUID();
    await db.query("insert into auth.users values($1),($2)", [a, b]);
    const scalar = async (sql: string, args: any[] = []) =>
      Object.values((await db.query<any>(sql, args)).rows[0])[0];
    // Migration 010: a Free account gets its 20-credit daily allowance once,
    // and calling again on the same UTC day must not add a second helping.
    assert.equal(await scalar("select piwu_ensure_credits($1)", [a]), 20);
    assert.equal(await scalar("select piwu_ensure_credits($1)", [a]), 20);
    assert.equal(
      await scalar("select piwu_reserve_credits($1,$2,5,'ai')", [a, r]),
      15,
    );
    await assert.rejects(
      db.query("select piwu_reserve_credits($1,$2,5,'ai')", [a, r]),
      /PIWU_DUPLICATE/,
    );
    await db.query("select piwu_finish_credits($1,false)", [r]);
    await db.query("select piwu_finish_credits($1,false)", [r]);
    assert.equal(
      await scalar("select balance from credit_accounts where user_id=$1", [a]),
      20,
    );
    assert.equal(
      await scalar(
        "select coalesce(sum(remaining),0) from credit_lots where user_id=$1",
        [a],
      ),
      20,
      "lot harus menjumlah sebesar saldo",
    );
    // `GET /api/account` asks this after the claim above: the page prints the
    // allowance the database actually granted, the day's remainder (5 credits
    // spent and given back above), and the instant of the next reset.
    const status = (
      await db.query<any>("select piwu_credit_status($1) as s", [a])
    ).rows[0].s;
    assert.equal(status.applied, true);
    assert.equal(status.plan, "Free");
    assert.equal(status.daily, 20);
    assert.equal(status.dailyRemaining, 20);
    assert.equal(status.monthlyCap, 600);
    assert.equal(status.resetUtcHour, 0);
    assert.equal(new Date(status.resetAt).getUTCHours(), 0);
    assert.ok(new Date(status.resetAt).getTime() > Date.now());
    await db.query(
      "insert into referrals(referrer_id,referred_id) values($1,$2)",
      [b, a],
    );
    await db.query(
      "insert into payment_orders(id,user_id,provider,kind,sku,amount,credits) values($1,$2,'midtrans','topup','credits300',49000,300)",
      [order, a],
    );
    await assert.rejects(
      db.query("select piwu_apply_payment($1,1,'IDR','paid')", [order]),
      /MISMATCH/,
    );
    assert.equal(
      await scalar("select piwu_apply_payment($1,49000,'IDR','paid')", [order]),
      "paid",
    );
    assert.equal(
      await scalar("select piwu_apply_payment($1,49000,'IDR','paid')", [order]),
      "already_paid",
    );
    assert.equal(
      await scalar("select balance from credit_accounts where user_id=$1", [a]),
      370,
    );
    assert.equal(
      await scalar("select balance from credit_accounts where user_id=$1", [b]),
      70,
    );
    await db.query("select piwu_apply_payment($1,49000,'IDR','refunded')", [
      order,
    ]);
    await db.query("select piwu_apply_payment($1,49000,'IDR','refunded')", [
      order,
    ]);
    assert.equal(
      await scalar("select balance from credit_accounts where user_id=$1", [a]),
      20,
    );
    assert.equal(
      await scalar("select balance from credit_accounts where user_id=$1", [b]),
      20,
    );
    assert.equal(
      await scalar("select piwu_apply_payment($1,49000,'IDR','paid')", [order]),
      "refunded",
    );
    await db.query(
      "insert into projects(id,owner_id,name) values($1,$2,'Tes')",
      [p, a],
    );
    await db.query(
      "insert into project_invites(project_id,created_by,email,role,token_hash,expires_at) values($1,$2,'b@example.org','Viewer','hash',now()+interval '1 day')",
      [p, a],
    );
    await assert.rejects(
      db.query("select piwu_accept_invite('hash',$1,'wrong@example.org')", [b]),
      /EMAIL/,
    );
    assert.equal(
      await scalar("select piwu_accept_invite('hash',$1,'b@example.org')", [b]),
      p,
    );
    assert.equal(
      await scalar("select piwu_topic_project($1)", ["piwu:project:" + p]),
      p,
    );
    const first = crypto.randomUUID(),
      second = crypto.randomUUID();
    for (const orderId of [first, second]) {
      await db.query(
        "insert into payment_orders(id,user_id,provider,kind,sku,amount,credits,plan) values($1,$2,'midtrans','plan','pro',199000,1500,'Pro')",
        [orderId, a],
      );
      await db.query("select piwu_apply_payment($1,199000,'IDR','paid')", [
        orderId,
      ]);
    }
    const periods = (
      await db.query<any>(
        "select current_period_start,current_period_end from subscriptions where user_id=$1 order by current_period_start",
        [a],
      )
    ).rows;
    assert.equal(
      new Date(periods[0].current_period_end).getTime(),
      new Date(periods[1].current_period_start).getTime(),
    );
    await db.query("select piwu_apply_payment($1,199000,'IDR','refunded')", [
      first,
    ]);
    const next = (
      await db.query<any>(
        "select current_period_start,current_period_end from subscriptions where order_id=$1",
        [second],
      )
    ).rows[0];
    assert.ok(
      new Date(next.current_period_start).getTime() <
        new Date(periods[1].current_period_start).getTime(),
    );
    assert.ok(
      Math.abs(
        new Date(next.current_period_end).getTime() -
          new Date(next.current_period_start).getTime() -
          30 * 86400000,
      ) < 2,
    );
    const publish = crypto.randomUUID(),
      deployment = crypto.randomUUID();
    await db.query("select piwu_reserve_credits($1,$2,5,'publish')", [
      a,
      publish,
    ]);
    await db.query(
      "insert into deployments(id,project_id,status) values($1,$2,'uploading')",
      [deployment, p],
    );
    await db.query(
      "insert into publish_jobs(id,project_id,user_id,snapshot,revision,status) values($1,$2,$3,'{}',1,'building')",
      [publish, p, a],
    );
    await assert.rejects(
      db.query(
        "insert into publish_jobs(project_id,user_id,snapshot,revision) values($1,$2,'{}',1)",
        [p, a],
      ),
      /duplicate key/,
    );
    await db.query("select piwu_complete_publish($1,$2)", [
      publish,
      deployment,
    ]);
    await db.query("select piwu_complete_publish($1,$2)", [
      publish,
      deployment,
    ]);
    assert.equal(
      await scalar("select status from credit_reservations where id=$1", [
        publish,
      ]),
      "settled",
    );
    assert.equal(
      await scalar("select status from publish_jobs where id=$1", [publish]),
      "ready",
    );
    await db.query(
      "insert into project_sites(project_id,provider_site_id,url) values($1,'test-site','https://test.netlify.app')",
      [p],
    );
    await db.query("delete from project_sites where project_id=$1", [p]);
    assert.equal(
      await scalar("select provider_site_id from hosting_cleanup_jobs"),
      "test-site",
    );
    await db.exec("set role authenticated");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [b]);
    await assert.rejects(
      db.query("select piwu_ensure_credits($1)", [b]),
      /permission denied/,
    );
    await assert.rejects(
      db.query("update credit_accounts set balance=999"),
      /permission denied/,
    );
    assert.equal(
      (await db.query("select * from credit_accounts")).rows.length,
      1,
    );
    await assert.rejects(
      db.query(
        "insert into templates(owner_id,project_snapshot) values($1,'{}')",
        [b],
      ),
      /permission denied/,
    );
    await assert.rejects(
      db.query("select * from hosting_cleanup_jobs"),
      /permission denied/,
    );
    await db.exec("reset role");
  } finally {
    await db.close();
  }
});
