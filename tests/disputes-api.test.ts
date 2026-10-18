import test from "node:test";
import assert from "node:assert/strict";

// The dispute HTTP contract: buyer identity comes from the token, one report per
// order, the seller answers, and only a superadmin decides. Approving a refund
// never pretends money moved; it only records the decision and freezes the share
// through migration 014.
test("dispute API: buyer report, seller reply, withdraw and superadmin decision", async () => {
  const { createApp } = await import("../server/app.mjs");
  const buyer = crypto.randomUUID(),
    seller = crypto.randomUUID(),
    operator = crypto.randomUUID(),
    boss = crypto.randomUUID();
  const template = crypto.randomUUID(),
    otherTemplate = crypto.randomUUID();
  const recentOrder = crypto.randomUUID(),
    secondOrder = crypto.randomUUID(),
    oldestOrder = crypto.randomUUID(),
    foreignOrder = crypto.randomUUID(),
    existingDispute = crypto.randomUUID();
  const calls: any[] = [];
  let missing = false;

  const users: Record<string, any> = {
    "buyer-token": {
      id: buyer,
      email: "buyer@example.test",
      email_confirmed_at: "2026-01-01",
      user_metadata: { name: "Pembeli Uji" },
    },
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
    },
    "boss-token": {
      id: boss,
      email: "boss@example.test",
      email_confirmed_at: "2026-01-01",
    },
  };
  const roles: Record<string, string> = {
    [operator]: "operator",
    [boss]: "superadmin",
  };
  const disputes = [
    {
      id: existingDispute,
      order_id: recentOrder,
      template_id: template,
      buyer_id: buyer,
      seller_id: seller,
      category: "broken",
      body: "File yang diunduh rusak dan tidak bisa dipakai sama sekali.",
      status: "seller_replied",
      seller_reply: "Template sudah diperbarui, silakan unduh ulang.",
      resolution_note: null,
      opened_at: "2026-10-10T00:00:00.000Z",
      replied_at: "2026-10-11T00:00:00.000Z",
      resolved_at: null,
    },
  ];
  const sales = [
    {
      order_id: recentOrder,
      seller_id: seller,
      net: 80000,
      status: "accrued",
      created_at: new Date().toISOString(),
    },
    {
      order_id: secondOrder,
      seller_id: seller,
      net: 80000,
      status: "accrued",
      created_at: new Date().toISOString(),
    },
    {
      order_id: oldestOrder,
      seller_id: seller,
      net: 80000,
      status: "accrued",
      created_at: new Date(Date.now() - 31 * 86400000).toISOString(),
    },
  ];

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
    } else if (url.pathname === "/rest/v1/template_entitlements") {
      data = [
        {
          template_id: template,
          order_id: recentOrder,
          created_at: "2026-10-01T00:00:00.000Z",
        },
        {
          template_id: otherTemplate,
          order_id: secondOrder,
          created_at: "2026-10-02T00:00:00.000Z",
        },
        {
          template_id: template,
          order_id: oldestOrder,
          created_at: "2026-08-01T00:00:00.000Z",
        },
      ];
    } else if (url.pathname === "/rest/v1/marketplace_sales") {
      data = sales;
    } else if (url.pathname === "/rest/v1/marketplace_disputes") {
      if (missing)
        return new Response(
          JSON.stringify({ code: "PGRST205", message: "missing" }),
          { status: 404, headers: { "Content-Type": "application/json" } },
        );
      const id = (url.searchParams.get("id") || "").replace("eq.", "");
      data = single
        ? id
          ? {
              id,
              seller_id: seller,
              buyer_id: buyer,
              template_id: template,
              order_id: secondOrder,
            }
          : disputes[0]
        : disputes;
    } else if (url.pathname === "/rest/v1/templates") {
      data = [
        { id: template, title: "Template Uji" },
        { id: otherTemplate, title: "Template Kedua" },
      ];
    } else if (url.pathname === "/rest/v1/users") {
      data = [
        { id: buyer, name: "Pembeli Uji" },
        { id: seller, name: "Penjual Uji" },
      ];
    } else if (url.pathname === "/rest/v1/platform_admins") {
      const target = (url.searchParams.get("user_id") || "").replace("eq.", "");
      data = roles[target] ? { role: roles[target] } : null;
    } else if (url.pathname.startsWith("/rest/v1/rpc/")) {
      const name = url.pathname.split("/").at(-1);
      const body = init.body ? JSON.parse(init.body) : {};
      calls.push({ name, body });
      if (name === "piwu_dispute_open") {
        if (body.p_order === foreignOrder)
          return new Response(
            JSON.stringify({ code: "42501", message: "PIWU_FORBIDDEN" }),
            { status: 403, headers: { "Content-Type": "application/json" } },
          );
        if (body.p_order === oldestOrder)
          return new Response(
            JSON.stringify({ code: "P0001", message: "PIWU_EXPIRED" }),
            { status: 400, headers: { "Content-Type": "application/json" } },
          );
        if (body.p_order === recentOrder)
          return new Response(
            JSON.stringify({ code: "P0001", message: "PIWU_DUPLICATE" }),
            { status: 400, headers: { "Content-Type": "application/json" } },
          );
        data = crypto.randomUUID();
      } else if (name === "piwu_dispute_reply") {
        if (body.p_user === buyer)
          return new Response(
            JSON.stringify({ code: "42501", message: "PIWU_FORBIDDEN" }),
            { status: 403, headers: { "Content-Type": "application/json" } },
          );
        data = "seller_replied";
      } else if (name === "piwu_dispute_withdraw") data = "withdrawn";
      else if (name === "piwu_dispute_review")
        data = {
          status: "resolved",
          order_id: recentOrder,
          buyer_id: buyer,
          seller_id: seller,
        };
      else if (name === "piwu_notification_add") data = crypto.randomUUID();
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
  const call = (path: string, token = "buyer-token", body?: any) =>
    fetch(base + "/api" + path, {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });

  try {
    const listed = await call("/marketplace/disputes");
    assert.equal(listed.status, 200);
    const view = (await listed.json()) as any;
    assert.equal(view.applied, true);
    assert.equal(view.purchases.length, 3);
    assert.equal(
      view.purchases.find((p: any) => p.order_id === recentOrder).can_open,
      false,
    );
    assert.equal(
      view.purchases.find((p: any) => p.order_id === secondOrder).can_open,
      true,
    );
    assert.equal(
      view.purchases.find((p: any) => p.order_id === oldestOrder).can_open,
      false,
    );
    assert.equal(view.as_buyer.length, 1);
    assert.equal(view.as_buyer[0].title, "Template Uji");
    assert.equal(view.as_seller.length, 0);

    const foreign = await call("/marketplace/disputes", "buyer-token", {
      orderId: foreignOrder,
      category: "broken",
      body: "Pesanan ini bukan milik saya dan seharusnya ditolak server.",
    });
    assert.equal(foreign.status, 403);
    assert.equal(((await foreign.json()) as any).code, "DISPUTE_FORBIDDEN");

    const expired = await call("/marketplace/disputes", "buyer-token", {
      orderId: oldestOrder,
      category: "broken",
      body: "Pembelian lama di luar jendela tiga puluh hari yang diizinkan.",
    });
    assert.equal(expired.status, 409);
    assert.equal(((await expired.json()) as any).code, "DISPUTE_EXPIRED");

    const duplicate = await call("/marketplace/disputes", "buyer-token", {
      orderId: recentOrder,
      category: "broken",
      body: "Laporan kedua untuk pesanan yang sudah punya sengketa.",
    });
    assert.equal(duplicate.status, 409);
    assert.equal(((await duplicate.json()) as any).code, "DISPUTE_DUPLICATE");

    const opened = await call("/marketplace/disputes", "buyer-token", {
      orderId: secondOrder,
      category: "not_as_described",
      body: "Isi template berbeda dari deskripsi di halaman toko.",
    });
    assert.equal(opened.status, 201);
    const openedId = ((await opened.json()) as any).id;
    assert.ok(openedId);
    const openCall = calls.find(
      (c) => c.name === "piwu_dispute_open" && c.body.p_order === secondOrder,
    );
    assert.equal(openCall.body.p_user, buyer);
    assert.equal(openCall.body.p_order, secondOrder);
    assert.ok(calls.some((c) => c.name === "piwu_notification_add"));

    const buyerReply = await call(
      "/marketplace/disputes/" + existingDispute + "/reply",
      "buyer-token",
      { body: "Mencoba membalas sebagai pembeli, bukan penjual." },
    );
    assert.equal(buyerReply.status, 403);
    const sellerReply = await call(
      "/marketplace/disputes/" + existingDispute + "/reply",
      "seller-token",
      { body: "Template sudah diperbarui; silakan unduh ulang dari akun." },
    );
    assert.equal(sellerReply.status, 200);
    assert.deepEqual(await sellerReply.json(), { status: "seller_replied" });

    const withdrawn = await call(
      "/marketplace/disputes/" + existingDispute + "/withdraw",
      "buyer-token",
      {},
    );
    assert.equal(withdrawn.status, 200);
    assert.deepEqual(await withdrawn.json(), { status: "withdrawn" });

    const queue = await call("/admin/disputes", "operator-token");
    assert.equal(queue.status, 200);
    const adminView = (await queue.json()) as any;
    assert.equal(adminView.applied, true);
    assert.equal(adminView.items[0].buyer_name, "Pembeli Uji");
    assert.equal(adminView.items[0].seller_name, "Penjual Uji");
    assert.equal((await call("/admin/disputes", "buyer-token")).status, 403);

    const operatorReview = await call(
      "/admin/disputes/" + existingDispute,
      "operator-token",
      {
        requestId: crypto.randomUUID(),
        status: "resolved",
        note: "Laporan ditutup oleh operator",
      },
    );
    assert.equal(operatorReview.status, 403);
    const shortNote = await call(
      "/admin/disputes/" + existingDispute,
      "boss-token",
      {
        requestId: crypto.randomUUID(),
        status: "resolved",
        note: "pendek",
      },
    );
    assert.equal(shortNote.status, 400);
    const reviewed = await call(
      "/admin/disputes/" + existingDispute,
      "boss-token",
      {
        requestId: crypto.randomUUID(),
        status: "resolved",
        note: "Penjual memperbaiki akses; laporan ditutup tanpa refund",
      },
    );
    assert.equal(reviewed.status, 200);
    const review = (await reviewed.json()) as any;
    assert.equal(review.result.status, "resolved");
    assert.match(review.result.notice, /Tidak ada refund/);
    assert.equal(
      calls.filter((c) => c.name === "piwu_notification_add").length >= 2,
      true,
    );

    missing = true;
    const notInstalled = await call("/marketplace/disputes");
    assert.equal(notInstalled.status, 200);
    const unavailable = (await notInstalled.json()) as any;
    assert.equal(unavailable.applied, false);
    assert.match(unavailable.notice, /014_marketplace_disputes\.sql/);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});
