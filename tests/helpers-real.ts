import type { Page } from "@playwright/test";
// A deliberately multi-vendor API key: several providers plus one unknown id.
export const modelCatalogue = [
  "claude-sonnet-4-20250514",
  "deepseek-chat",
  "deepseek-reasoner",
  "glm-4-flash",
  "glm-4.6",
  "jamba-1.5-large",
];
// Network fixtures ONLY for browser regression tests, never imported by src/.
// Exercises the real Supabase login/RPC client and authenticated AI API path;
// it does not establish that any external provider is live.
export async function realAccountFixture(page: Page, ai = true) {
  const user = {
    id: "d29f9dc0-cb78-4a4a-8d4c-30d287c7b1fa",
    aud: "authenticated",
    role: "authenticated",
    email: "test@example.test",
    email_confirmed_at: new Date().toISOString(),
    app_metadata: {},
    user_metadata: { name: "Akun Uji" },
    created_at: new Date().toISOString(),
  };
  const payload = Buffer.from(
    JSON.stringify({
      sub: user.id,
      aud: "authenticated",
      role: "authenticated",
      exp: Math.floor(Date.now() / 1000) + 3600,
    }),
  ).toString("base64url");
  const session = {
    access_token: `eyJhbGciOiJIUzI1NiJ9.${payload}.test-signature`,
    refresh_token: "test-only-refresh-token",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    token_type: "bearer",
    user,
  };
  const rows = new Map<string, any>();
  const calls: { path: string; body: any }[] = [];
  await page.route("**/auth/v1/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/logout")) return route.fulfill({ status: 204 });
    await route.fulfill({
      json: url.pathname.endsWith("/user") ? user : session,
    });
  });
  await page.route("**/rest/v1/rpc/**", async (route) => {
    const path = new URL(route.request().url()).pathname.split("/").at(-1)!;
    const body = route.request().postDataJSON() || {};
    calls.push({ path, body });
    if (path === "piwu_save_workspace") {
      const old = rows.get(body.p_id);
      if ((old?.revision || 0) !== body.p_expected_revision)
        return route.fulfill({
          status: 409,
          json: { code: "23505", message: "PIWU_CONFLICT" },
        });
      const row = {
        project_id: body.p_id,
        payload: body.p_payload,
        revision: (old?.revision || 0) + 1,
        access_role: "Owner",
        owner_id: user.id,
        updated_at: new Date().toISOString(),
      };
      rows.set(body.p_id, row);
      return route.fulfill({ json: [row] });
    }
    if (path === "piwu_delete_workspace") rows.delete(body.p_id);
    await route.fulfill({
      json: path === "piwu_list_workspaces" ? [...rows.values()] : null,
    });
  });
  await page.routeWebSocket("**/realtime/v1/**", (ws) => ws.close());
  await page.route("**/api/status", (r) =>
    r.fulfill({
      json: {
        mode: "real",
        ai: ai ? "configured" : "not_configured",
        storage: "supabase-configured",
        capabilities: {
          auth: true,
          cloud: true,
          ai,
          sandbox: false,
          payments: false,
        },
        verification: "configuration-only",
      },
    }),
  );
  await page.route("**/api/public/site", (r) =>
    r.fulfill({ json: { configured: true, settings: {}, broadcasts: [] } }),
  );
  await page.route("**/api/public/readiness", (r) =>
    r.fulfill({
      json: {
        mode: "real",
        auth: "reachable",
        database: "reachable",
        ai: ai ? "configured_unverified" : "not_configured",
        sandbox: "not_configured",
        payments: "not_configured",
        whatsapp: "not_configured",
        secrets: "not_configured",
      },
    }),
  );
  await page.route("**/api/announcements**", (r) =>
    r.fulfill({ json: { broadcasts: [] } }),
  );
  // The bell is part of every signed-in header. Tests that exercise it
  // register a narrower route afterwards, which Playwright matches first.
  await page.route("**/api/notifications**", (r) =>
    r.fulfill({ json: { applied: true, items: [], unread: 0 } }),
  );
  // Model catalogue as a multi-vendor API key would return it. Grouping is the
  // server's job; the picker must list every id here.
  await page.route("**/api/ai/models**", (r) => {
    if (!ai)
      return r.fulfill({
        status: 503,
        json: { error: "AI belum dikonfigurasi.", models: [] },
      });
    return r.fulfill({
      json: {
        source: "provider",
        count: modelCatalogue.length,
        models: modelCatalogue,
        groups: [
          { label: "Anthropic Claude", models: ["claude-sonnet-4-20250514"] },
          {
            label: "DeepSeek",
            models: ["deepseek-chat", "deepseek-reasoner"],
          },
          { label: "Z.ai GLM", models: ["glm-4-flash", "glm-4.6"] },
          { label: "Model lainnya", models: ["jamba-1.5-large"] },
        ],
        tiers: { Kuat: "claude-sonnet-4-20250514" },
        // Same shape the server sends: one price per model plus the tier
        // prices, so the picker can print what it will be charged.
        costs: modelCatalogue.map((model) =>
          model === "claude-sonnet-4-20250514"
            ? { model, tier: "Kuat", cost: 8 }
            : { model, tier: "Seimbang", cost: 3 },
        ),
        tierCosts: { Cepat: 1, Seimbang: 3, Kuat: 8 },
        askCost: 1,
        planCost: 2,
        defaultModel: "claude-sonnet-4-20250514",
        defaultSource: "LLM_MODEL",
      },
    });
  });
  await page.route("**/api/projects/**", async (r) => {
    const path = new URL(r.request().url()).pathname;
    if (path.endsWith("/ai")) {
      const b = r.request().postDataJSON();
      const result: any = {
        content:
          b.mode === "Ask"
            ? "Jawaban provider pengujian tentang struktur project."
            : "Respons API pengujian diterima.",
      };
      if (b.mode === "Plan")
        result.plan = {
          goal: b.prompt,
          approved: false,
          tasks: [
            { text: "Rencana dari fixture provider", done: false, comment: "" },
          ],
        };
      if (b.mode === "Builder" && /biru/.test(b.prompt))
        result.files = {
          "src/styles.css":
            b.files["src/styles.css"] + "\nbody {color:#2857aa;}",
        };
      return r.fulfill({
        contentType: "text/event-stream",
        body: `data: ${JSON.stringify({ type: "result", result })}\n\n`,
      });
    }
    // Offline service contract fixtures; no shell or payments called.
    if (path.endsWith("/invites"))
      return r.fulfill({ json: { members: [], invites: [] } });
    if (path.endsWith("/recordings"))
      return r.fulfill({ json: { recordings: [] } });
    return r.fulfill({
      status: 503,
      json: { error: "Layanan pengujian belum dikonfigurasi." },
    });
  });
  return { rows, calls, user };
}
export async function loginRealFixture(page: Page) {
  await page.goto("/login");
  await page.getByPlaceholder("anda@email.com").fill("test@example.test");
  await page
    .locator('input[type="password"]')
    .fill("test-password-not-a-real-credential");
  await page.getByRole("button", { name: "Masuk", exact: true }).click();
  // Wait for the authenticated route before a caller starts another navigation.
  await page.waitForURL(/\/(?:projects(?:[/?#]|$)|project\/)/);
}
