import test from "node:test";
import assert from "node:assert/strict";

// The seller and admin payout HTTP contract: identities come from the verified
// token, migration 013's error codes become honest statuses, and only a
// superadmin may review. Money still moves outside the app.
test("payout API: seller balance, KYC gating, admin queue and reviewed payouts", async () => {
  const { createApp } = await import("../server/app.mjs");
  const seller = crypto.randomUUID(),
    operator = crypto.randomUUID(),
    boss = crypto.randomUUID();
  const payoutId = crypto.randomUUID();
  const calls: any[] = [];
  let missing = false;

  const users: Record<string, any> = {
    "seller-token": {
      id: seller,
      email: "seller@example.test",
      email_confirmed_at: "2026-01-01",
      user_metadata: { name: "Penjual Uji" },
    },
    "operator-token": {
      id: operator,
      email: "operator@example.test",
      email_confirmed_at: "2026-01-01",
      user_metadata: { name: "Operator Uji" },
    },
    "boss-token": {
      id: boss,
      email: "boss@example.test",
      email_confirmed_at: "2026-01-01",
      user_metadata: { name: "Superadmin Uji" },
    },
  };
  const roles: Record<string, string> = {
    [operator]: "operator",
    [boss]: "superadmin",
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
    } else if (url.pathname === "/rest/v1/site_configuration") {
      data = { revision: 1, value: {} };
    } else if (url.pathname === "/rest/v1/seller_verifications") {
      if (missing)
        return new Response(
          JSON.stringify({ code: "PGRST205", message: "missing" }),
          { status: 404, headers: { "Content-Type": "application/json" } },
        );
      data = {
        user_id: seller,
        status: "verified",
        legal_name: "Penjual Uji",
        business_name: "Toko Uji",
        tax_id: "12.345.678.9-012.345",
        country: "ID",
        note: null,
        submitted_at: "2026-10-01T00:00:00.000Z",
        reviewed_at: "2026-10-02T00:00:00.000Z",
      };
    } else if (url.pathname === "/rest/v1/marketplace_payouts") {
      if (missing)
        return new Response(
          JSON.stringify({ code: "PGRST205", message: "missing" }),
          { status: 404, headers: { "Content-Type": "application/json" } },
        );
      data = [
        {
          id: payoutId,
          seller_id: seller,
          amount: 100000,
          method: "bank",
          destination: "BCA 1234567890",
          status: "requested",
          reference: null,
          note: null,
          created_at: "2026-10-10T00:00:00.000Z",
          paid_at: null,
        },
      ];
    } else if (url.pathname === "/rest/v1/marketplace_sales") {
      data = [{ seller_id: seller, net: 180000, status: "accrued" }];
    } else if (url.pathname === "/rest/v1/users") {
      data = [{ id: seller, name: "Penjual Uji" }];
    } else if (url.pathname === "/rest/v1/platform_admins") {
      const target = (url.searchParams.get("user_id") || "").replace("eq.", "");
      data = roles[target] ? { role: roles[target] } : null;
    } else if (url.pathname.startsWith("/rest/v1/rpc/")) {
      const name = url.pathname.split("/").at(-1);
      const body = init.body ? JSON.parse(init.body) : {};
      calls.push({ name, body });
      if (name === "piwu_seller_balance")
        data = {
          accrued: 180000,
          pending: 100000,
          paid: 0,
          available: 80000,
          currency: "IDR",
        };
      else if (name === "piwu_seller_kyc_submit") data = "pending";
      else if (name === "piwu_request_payout") {
        if (body.p_amount > 80000)
          return new Response(
            JSON.stringify({
              code: "P0001",
              message: "PIWU_INSUFFICIENT",
            }),
            { status: 400, headers: { "Content-Type": "application/json" } },
          );
        data = payoutId;
      } else if (name === "piwu_review_kyc") data = { status: "verified" };
      else if (name === "piwu_review_payout") data = { status: "paid" };
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
  const call = (path: string, token = "seller-token", body?: any) =>
    fetch(base + "/api" + path, {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });

  try {
    const listed = await call("/marketplace/payouts");
    assert.equal(listed.status, 200);
    const account = (await listed.json()) as any;
    assert.equal(account.applied, true);
    assert.equal(account.balance.available, 80000);
    assert.equal(account.verification.status, "verified");
    assert.equal(account.payouts.length, 1);
    assert.deepEqual(calls.at(-1), {
      name: "piwu_seller_balance",
      body: { p_user: seller },
    });

    // Browser-supplied identity is rejected instead of trusted.
    const spoof = await call("/marketplace/kyc", "seller-token", {
      legal_name: "Penjual Uji",
      country: "ID",
      user_id: crypto.randomUUID(),
    });
    assert.equal(spoof.status, 400);
    const kyc = await call("/marketplace/kyc", "seller-token", {
      legal_name: "Penjual Uji",
      country: "ID",
    });
    assert.equal(kyc.status, 200);
    assert.deepEqual(await kyc.json(), { status: "pending" });
    assert.deepEqual(calls.at(-1).body, {
      p_user: seller,
      p_legal_name: "Penjual Uji",
      p_business_name: null,
      p_tax_id: null,
      p_country: "ID",
    });

    const tooMuch = await call("/marketplace/payouts", "seller-token", {
      amount: 90000,
      method: "bank",
      destination: "BCA 1234567890",
    });
    assert.equal(tooMuch.status, 409);
    const refused = (await tooMuch.json()) as any;
    assert.equal(refused.code, "PAYOUT_INSUFFICIENT");
    const requested = await call("/marketplace/payouts", "seller-token", {
      amount: 50000,
      method: "ewallet",
      destination: "0812-3456-7890",
    });
    assert.equal(requested.status, 201);
    assert.deepEqual(await requested.json(), { id: payoutId });

    // Operators read the queue but cannot review it.
    const forbidden = await call("/admin/payouts", "operator-token");
    assert.equal(forbidden.status, 200);
    const queue = (await forbidden.json()) as any;
    assert.equal(queue.applied, true);
    assert.equal(queue.sellers[0].available, 80000);
    assert.equal(queue.sellers[0].kyc_status, "verified");
    assert.equal(queue.payouts[0].status, "requested");

    const reviewByOperator = await call(
      "/admin/payouts/" + payoutId,
      "operator-token",
      {
        requestId: crypto.randomUUID(),
        status: "approved",
        note: "Disetujui operator",
      },
    );
    assert.equal(reviewByOperator.status, 403);

    const paidWithoutReference = await call(
      "/admin/payouts/" + payoutId,
      "boss-token",
      {
        requestId: crypto.randomUUID(),
        status: "paid",
        note: "Transfer manual",
      },
    );
    assert.equal(paidWithoutReference.status, 400);
    assert.equal(
      calls.filter((c) => c.name === "piwu_review_payout").length,
      0,
    );

    const paid = await call("/admin/payouts/" + payoutId, "boss-token", {
      requestId: crypto.randomUUID(),
      status: "paid",
      reference: "TRX-2026-0001",
      note: "Transfer manual selesai",
    });
    assert.equal(paid.status, 200);
    assert.deepEqual(await paid.json(), { result: { status: "paid" } });
    const review = calls.at(-1);
    assert.equal(review.name, "piwu_review_payout");
    assert.equal(review.body.p_actor, boss);
    assert.equal(review.body.p_payout, payoutId);
    assert.equal(review.body.p_reference, "TRX-2026-0001");

    const kycReview = await call("/admin/payouts/kyc", "boss-token", {
      requestId: crypto.randomUUID(),
      userId: seller,
      status: "verified",
      note: "Dokumen sesuai",
    });
    assert.equal(kycReview.status, 200);
    assert.equal(calls.at(-1).name, "piwu_review_kyc");
    assert.equal(calls.at(-1).body.p_user, seller);

    assert.equal((await call("/admin/payouts")).status, 403);
    assert.equal((await call("/admin/payouts", "")).status, 401);

    missing = true;
    const notInstalled = await call("/marketplace/payouts");
    assert.equal(notInstalled.status, 200);
    const unavailable = (await notInstalled.json()) as any;
    assert.equal(unavailable.applied, false);
    assert.deepEqual(unavailable.payouts, []);
    assert.match(unavailable.notice, /013_marketplace_payouts\.sql/);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});
