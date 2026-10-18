import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../server/app.mjs";
import { capabilities, seal, unseal, validFiles } from "../server/lib/core.mjs";
import {
  publicAddress,
  validateReferenceURL,
} from "../server/lib/references.mjs";
import { inspectAttachment } from "../server/lib/attachments.mjs";
import { validateAIResult } from "../server/routes/ai.mjs";
import {
  midtransSignature,
  verifyPaymentHook,
  rupiah,
  paymentProvider,
} from "../server/providers/payments.mjs";
import { packageSpec } from "../server/providers/sandbox.mjs";
test("AES-GCM rejects tampered ciphertext and cross-project/environment AAD", () => {
  const key = "a".repeat(64),
    aad = "project:dev:KEY";
  const encrypted = seal("sensitive value", key, aad);
  assert.equal(unseal(encrypted, key, aad), "sensitive value");
  assert.throws(() => unseal(encrypted, key, "other:dev:KEY"));
  assert.throws(() => unseal(encrypted.slice(0, -2) + "00", key, aad));
  assert.throws(() => seal("secret", "bad-key", aad));
});
test("Reference fetch guard rejects private, mapped, reserved and mixed DNS answers", async () => {
  for (const ip of [
    "127.0.0.1",
    "10.1.2.3",
    "169.254.169.254",
    "0.0.0.0",
    "::1",
    "::ffff:127.0.0.1",
    "fc00::1",
    "100.64.0.1",
  ])
    assert.equal(publicAddress(ip), false, ip);
  assert.equal(publicAddress("1.1.1.1"), true);
  await assert.rejects(
    validateReferenceURL("https://metadata.example", async () => [
      { address: "1.1.1.1", family: 4 },
      { address: "10.0.0.1", family: 4 },
    ]),
  );
  for (const url of [
    "http://example.com",
    "https://a:b@example.com",
    "https://localhost",
    "https://example.com:8080",
    "file:///etc/passwd",
  ])
    await assert.rejects(validateReferenceURL(url));
});
test("Attachments validate magic and file limits; unsupported .fig is not fake-processed", () => {
  assert.throws(() =>
    inspectAttachment({
      name: "fake.png",
      mime: "image/png",
      data: Buffer.from("<script>").toString("base64"),
    }),
  );
  assert.throws(() =>
    inspectAttachment({
      name: "x.fig",
      mime: "application/octet-stream",
      data: "AAAA",
    }),
  );
  assert.equal(
    inspectAttachment({
      name: "x.txt",
      mime: "text/plain",
      data: Buffer.from("Brief desain").toString("base64"),
    }).toString(),
    "Brief desain",
  );
});
test("Attachment MIME whitelist excludes inherited object properties", () => {
  for (const mime of ["constructor", "toString", "__proto__"])
    assert.throws(() => inspectAttachment({ name: "x", mime, data: "AAAA" }));
});
test("AI mode boundaries, structured plan and file path validation", () => {
  assert.equal(
    validateAIResult({ content: "Jawaban", files: { "src/A.tsx": "a" } }, "Ask")
      .files,
    undefined,
  );
  assert.throws(() => validateAIResult({ content: "No plan" }, "Plan"));
  const plan = validateAIResult(
    {
      content: "Rencana",
      plan: { goal: "Aplikasi", tasks: [{ text: "Buat komponen" }] },
    },
    "Plan",
  ).plan;
  assert.equal(plan.approved, false);
  assert.equal(plan.tasks[0].done, false);
  for (const path of [
    "../escape",
    "a/../../escape",
    ".env",
    ".env.production",
    ".git/config",
    "/etc/passwd",
    "a\0b",
  ])
    assert.throws(() => validFiles({ [path]: "x" }));
  assert.throws(() =>
    validateAIResult({ content: "sk-" + "a".repeat(30) }, "Ask"),
  );
});
test("Payment hooks verify signatures and provider status, not frontend return URLs", async () => {
  const body = {
    order_id: "order",
    status_code: "200",
    gross_amount: "49000.00",
  };
  const env = { MIDTRANS_SERVER_KEY: "test-server-secret" };
  const signed = {
    ...body,
    signature_key: midtransSignature(body, env.MIDTRANS_SERVER_KEY),
  };
  assert.equal(verifyPaymentHook("midtrans", { body: signed }, env), "order");
  assert.throws(() =>
    verifyPaymentHook(
      "midtrans",
      { body: { ...signed, gross_amount: "1.00" } },
      env,
    ),
  );
  assert.throws(() =>
    verifyPaymentHook(
      "xendit",
      { body: { external_id: "order" }, get: () => "" },
      { XENDIT_WEBHOOK_TOKEN: "test-hook-secret" },
    ),
  );
  assert.equal(rupiah("49000.00"), 49000);
  assert.throws(() => rupiah("49000.50"));
  let url = "";
  const provider = paymentProvider(
    {
      PAYMENT_PROVIDER: "midtrans",
      PAYMENT_LIVE: "false",
      MIDTRANS_SERVER_KEY: "test-only",
    },
    async (u) => {
      url = u;
      return new Response(
        JSON.stringify({
          order_id: "order",
          gross_amount: "49000.00",
          currency: "IDR",
          transaction_status: "settlement",
        }),
        { status: 200 },
      );
    },
  );
  assert.equal(
    (await provider.status({ id: "order", provider: "midtrans" })).state,
    "paid",
  );
  assert.ok(url.startsWith("https://api.sandbox.midtrans.com/"));
});
test("Registry specs reject shell injection, git and arbitrary URLs", () => {
  assert.ok(packageSpec.test("@scope/pkg@1.2.3"));
  for (const s of [
    "a;cat /etc/passwd",
    "https://example.com/p.tgz",
    "git+ssh://host",
    "foo && echo x",
    "-g",
    "a@1$(id)",
  ])
    assert.equal(packageSpec.test(s), false, s);
});
test("Service API fails closed without config and rejects forged auth before privileged operations", async () => {
  let calls = 0;
  const env = {
    VITE_SUPABASE_URL: "https://test.supabase.co",
    VITE_SUPABASE_ANON_KEY: "public-test",
    SUPABASE_SERVICE_ROLE_KEY: "private-test",
  };
  const { app } = createApp({
    env,
    fetcher: async () => {
      calls++;
      return new Response("{}", { status: 401 });
    },
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const url = "http://127.0.0.1:" + (server.address() as any).port;
  try {
    let res = await fetch(url + "/api/account");
    assert.equal(res.status, 401);
    assert.equal(calls, 0);
    res = await fetch(
      url + "/api/projects/" + crypto.randomUUID() + "/sandbox/command",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer forged",
          "Content-Type": "application/json",
        },
        body: "{}",
      },
    );
    assert.equal(res.status, 401);
    assert.equal(calls, 1);
    res = await fetch(url + "/api/status");
    const status = await res.json();
    assert.equal(status.capabilities.payments, false);
    assert.ok(!JSON.stringify(status).includes("private-test"));
    assert.equal(capabilities({}).ai, false);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test("Viewer cannot execute a shell or run an audit by supplying a forged actor in JSON", async () => {
  const viewer = crypto.randomUUID(),
    owner = crypto.randomUUID(),
    id = crypto.randomUUID();
  let privileged = false;
  const fetcher = async (input: any) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    let data: any;
    if (url.pathname === "/auth/v1/user")
      data = {
        id: viewer,
        email: "viewer@example.test",
        email_confirmed_at: new Date().toISOString(),
      };
    else if (
      [
        "/rest/v1/platform_user_controls",
        "/rest/v1/site_configuration",
      ].includes(url.pathname)
    )
      data = [];
    else if (url.pathname === "/rest/v1/projects")
      data = [{ id, owner_id: owner, name: "Private" }];
    else if (url.pathname === "/rest/v1/collaborators")
      data = [{ role: "Viewer" }];
    else {
      privileged = true;
      data = {};
    }
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  const { app } = createApp({
    env: {
      VITE_SUPABASE_URL: "https://test.supabase.co",
      VITE_SUPABASE_ANON_KEY: "public-test",
      SUPABASE_SERVICE_ROLE_KEY: "private-test",
    },
    fetcher,
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  try {
    for (const action of ["sandbox/command", "audit", "invites"]) {
      const response = await fetch(
        "http://127.0.0.1:" +
          (server.address() as any).port +
          "/api/projects/" +
          id +
          "/" +
          action,
        {
          method: "POST",
          headers: {
            Authorization: "Bearer test-viewer",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ userId: owner, role: "Owner", command: "id" }),
        },
      );
      assert.equal(response.status, 403);
    }
    assert.equal(privileged, false);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test("attached photos are numbered, so a model can only cite a photo that exists", async () => {
  const { attachmentParts } = await import("../server/lib/attachments.mjs");
  const png = Buffer.from(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489" +
      "0000000a49444154789c6300010000050001",
    "hex",
  ).toString("base64");
  const parts = await attachmentParts([
    { name: "kursi-depan.png", mime: "image/png", data: png },
    {
      name: "brief.txt",
      mime: "text/plain",
      data: Buffer.from("kursi kayu").toString("base64"),
    },
    { name: "kursi-samping.jpg", mime: "image/jpeg", data: "/9j/4AAQ" },
  ]);
  // The label lists the photos in attachment order, and only photos: a brief is
  // not something a scene.build op may claim to have been read from.
  assert.match(parts[0].text, /LAMPIRAN FOTO \(2\): 1 = kursi-depan\.png/);
  assert.match(parts[0].text, /2 = kursi-samping\.jpg/);
  assert.doesNotMatch(parts[0].text, /brief\.txt/);
  // The photos themselves still travel as images, and the brief as untrusted text.
  assert.deepEqual(
    parts.map((p: any) => p.type),
    ["text", "image_url", "text", "image_url"],
  );
  // No photo at all: no photo list, so no number to cite.
  const textOnly = await attachmentParts([
    {
      name: "brief.txt",
      mime: "text/plain",
      data: Buffer.from("kursi kayu").toString("base64"),
    },
  ]);
  assert.doesNotMatch(textOnly[0].text, /LAMPIRAN FOTO/);
});

test("PDF attachment is extracted in the bounded worker, not treated as a filename", async () => {
  const { attachmentParts } = await import("../server/lib/attachments.mjs");
  const stream = "BT /F1 12 Tf 30 100 Td (Brief desain PiwuApp) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let source = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((o, i) => {
    offsets.push(Buffer.byteLength(source));
    source += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(source);
  source +=
    `xref\n0 6\n0000000000 65535 f \n` +
    offsets
      .slice(1)
      .map((o) => String(o).padStart(10, "0") + " 00000 n \n")
      .join("") +
    `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  const parts = await attachmentParts([
    {
      name: "brief.pdf",
      mime: "application/pdf",
      data: Buffer.from(source).toString("base64"),
    },
  ]);
  assert.ok(parts[0].text.includes("Brief desain PiwuApp"));
});
