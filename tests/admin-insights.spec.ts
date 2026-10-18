import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const USER_ID = "c9d4b2e3-2222-4333-8444-555566667777";

const catalogue = {
  source: "provider",
  count: 3,
  models: ["claude-sonnet-4-20250514", "deepseek-chat", "glm-4.6"],
  groups: [
    { label: "Anthropic Claude", models: ["claude-sonnet-4-20250514"] },
    { label: "DeepSeek", models: ["deepseek-chat"] },
    { label: "Z.ai GLM", models: ["glm-4.6"] },
  ],
  tiers: { Kuat: "claude-sonnet-4-20250514" },
  defaultModel: "deepseek-chat",
  defaultSource: "model pertama",
};

const aiPayload = {
  configured: true,
  baseHost: "api.deepseek.test",
  basePath: "/v1",
  keyPresent: true,
  keyShown: false,
  defaultModel: "deepseek-chat",
  defaultSource: "model pertama dari daftar provider",
  tiers: [
    { tier: "Cepat", model: "", source: "LLM_MODEL", cost: 1 },
    { tier: "Seimbang", model: "", source: "LLM_MODEL", cost: 3 },
    {
      tier: "Kuat",
      model: "claude-sonnet-4-20250514",
      source: "LLM_MODEL_KUAT",
      cost: 8,
    },
  ],
  catalog: catalogue,
  catalogError: "",
  catalogAt: "2026-03-03T10:00:00.000Z",
  usage: {
    windowDays: 30,
    since: "2026-02-01T00:00:00.000Z",
    aiCreditsSpent: 42,
    truncated: false,
    purposes: [
      {
        purpose: "ai",
        reserved: 9,
        settled: 8,
        refunded: 1,
        settledCredits: 42,
      },
    ],
  },
  notice: "Probe read-only pada katalog, bukan inference.",
};

const runtimePayload = {
  mode: "database",
  sandboxRouting: "sticky-owner-lease",
  available: true,
  reason: "",
  slots: { active: 1, total: 4, max: 50, perUser: 2 },
  buckets: { active: 7, total: 9, hits: 88 },
  items: [
    {
      user_id: USER_ID,
      project_id: "aaaaaaaa-1111-4111-8111-111111111111",
      owner: "server-a",
      expires_at: "2026-03-03T11:00:00.000Z",
    },
  ],
  notice: "Lease kedaluwarsa tidak dihitung aktif.",
};

// What /admin/diagnostics answers after the storage and Studio features: the
// copy counts, the backup story, and the plugin version the server serves.
const diagnosticsPayload = {
  readiness: {
    auth: "reachable",
    database: "reachable",
    checkedAt: "2026-03-03T10:00:00.000Z",
  },
  runtime: {
    rateLimitMode: "database",
    coordinationSchema: "reachable",
    sandboxRouting: "sticky-owner-lease",
  },
  search: {
    provider: "tavily",
    selected: "tavily",
    selectedAvailable: true,
    disabled: false,
    keyConfigured: true,
    web: true,
    summary: true,
    rounds: 2,
    tools: { names: ["cari_web"], rounds: 2 },
    locale: { country: "", language: "" },
    cache: {
      mode: "process",
      entries: 0,
      stats: { hits: 0, sharedHits: 0, errors: 0 },
    },
    jobs: { jobs: 0, running: 0, ttlMinutes: 30 },
    notice: "Status konfigurasi, bukan bukti panggilan vendor berhasil.",
  },
  storage: {
    available: true,
    reason: "",
    dormantDays: 7,
    workspaces: { total: 12, dormant: 3 },
    datasets: { total: 5, reported: true },
    backup:
      "Cadangan project dibuat di peramban sebagai unduhan JSON oleh pemiliknya. Server tidak menyimpan salinan cadangan.",
    notice:
      "Hitungan baris tabel. Isi project tidak pernah diproyeksikan ke panel ini.",
  },
  studio: {
    available: true,
    reason: "",
    plugin: {
      version: "2.2.0",
      file: "PiwuStudio.luau",
      bundle: "PiwuStudio.rbxmx",
    },
    bridges: {
      total: 2,
      active: 1,
      states: [
        { state: "applied", count: 1 },
        { state: "idle", count: 1 },
      ],
      truncated: false,
    },
    notice:
      "Token bridge disimpan hanya sebagai hash dan tidak pernah ditampilkan. Versi plugin yang terpasang tidak dilaporkan ke server, jadi panel tidak bisa memastikan salinan pengguna sudah 2.2.0.",
  },
  liveVerified: false,
  notice:
    "Probe read-only: bukan bukti transaksi, inference, deployment, uji perangkat, atau kelulusan pentest.",
};

const accountPayload = {
  account: {
    id: USER_ID,
    email: "member@example.test",
    name: "Anggota",
    createdAt: "2026-02-02T00:00:00.000Z",
    lastSignInAt: "2026-03-03T09:00:00.000Z",
    verified: true,
  },
  balance: 128,
  balanceUpdatedAt: "2026-03-04T00:00:00.000Z",
  suspended: false,
  suspendedReason: "",
  adminRole: "",
  projects: 2,
  ledger: [
    {
      id: "l1",
      delta: -3,
      reason: "ai",
      reference: "reserve:r1",
      created_at: "2026-03-03T08:00:00.000Z",
    },
    {
      id: "l2",
      delta: 30,
      reason: "Pembayaran terverifikasi",
      reference: "payment:p1",
      created_at: "2026-03-02T08:00:00.000Z",
    },
  ],
  reservations: [
    {
      id: "r1",
      amount: 3,
      purpose: "ai",
      status: "settled",
      created_at: "2026-03-03T08:00:00.000Z",
    },
    {
      id: "r2",
      amount: 8,
      purpose: "sandbox",
      status: "refunded",
      created_at: "2026-03-02T08:00:00.000Z",
    },
  ],
  window: { days: 30, added: 30, spent: 3, truncated: false },
};

type Overrides = {
  tab?: string;
  role?: string;
  ai?: any;
  runtime?: any;
  account?: any;
  users?: any[];
  overview?: any;
  diagnostics?: any;
  onRequest?: (path: string, body?: unknown) => void;
};

/** Mounts the real AdminPanel with a deterministic admin client. */
async function mount(page: Page, overrides: Overrides = {}) {
  await page.goto("/");
  await page.evaluate(
    async (options) => {
      const React = (await import("/node_modules/.vite/deps/react.js")).default;
      const { createRoot } = (
        await import("/node_modules/.vite/deps/react-dom_client.js")
      ).default;
      const routerPath = performance
        .getEntriesByType("resource")
        .map((e) => e.name)
        .find(
          (n) =>
            new URL(n).pathname ===
            "/node_modules/.vite/deps/react-router-dom.js",
        )!;
      const { MemoryRouter } = await import(routerPath);
      const { AdminPanel } = await import("/src/pages/Admin.tsx");
      const calls: string[] = [];
      const client = async (path: string) => {
        calls.push(path);
        (window as any).__adminCalls = calls;
        if (path.startsWith("/admin/ai")) {
          // A forced reload reports one extra model, like a provider change would.
          return path.includes("refresh=1")
            ? {
                ...options.ai,
                catalog: {
                  ...options.ai.catalog,
                  count: 4,
                  groups: [
                    ...options.ai.catalog.groups,
                    { label: "Qwen", models: ["qwen3-max"] },
                  ],
                },
              }
            : options.ai;
        }
        if (path === "/admin/runtime") return options.runtime;
        if (path.startsWith("/admin/users/"))
          return { ...options.account, account: options.account.account };
        if (path.startsWith("/admin/users"))
          return { page: 1, hasMore: false, items: options.users };
        if (path.startsWith("/admin/overview"))
          return options.overview ?? { metrics: {}, recent: [] };
        if (path.startsWith("/admin/diagnostics"))
          return options.diagnostics ?? { notice: "", readiness: {} };
        if (path.startsWith("/admin/operations"))
          return {
            jobs: [],
            recordings: [],
            capabilities: {
              cloud: true,
              ai: true,
              search: true,
              sandbox: false,
              payments: true,
              marketplace: true,
            },
          };
        return { items: [], hasMore: false, page: 1 };
      };
      document.getElementById("root")!.style.display = "none";
      const host = document.createElement("div");
      host.id = "admin-fixture";
      document.body.append(host);
      createRoot(host).render(
        React.createElement(
          MemoryRouter,
          { initialEntries: ["/admin?tab=" + (options.tab || "ai")] },
          React.createElement(AdminPanel, {
            session: {
              role: options.role || "superadmin",
              email: "u@example.test",
            },
            client,
          }),
        ),
      );
    },
    {
      ...overrides,
      ai: overrides.ai ?? aiPayload,
      runtime: overrides.runtime ?? runtimePayload,
      account: overrides.account ?? accountPayload,
      users: overrides.users ?? [],
      overview: overrides.overview,
      diagnostics: overrides.diagnostics,
    },
  );
}

test("admin AI panel shows the provider catalogue, tier mapping and usage", async ({
  page,
}) => {
  await mount(page);
  await expect(
    page.getByRole("heading", { name: "Status provider AI" }),
  ).toBeVisible();
  await expect(page.getByText("api.deepseek.test/v1")).toBeVisible();
  await expect(page.getByText("Tersimpan di server")).toBeVisible();
  // Tier mapping row for the operator override.
  const tierRow = page.getByRole("row", { name: /Kuat/ });
  await expect(tierRow).toContainText("claude-sonnet-4-20250514");
  await expect(tierRow).toContainText("LLM_MODEL_KUAT");
  // Every model id is listed, grouped, and clickable-by-nature (not truncated).
  for (const model of catalogue.models)
    await expect(
      page.locator(".ad-chips code", { hasText: model }),
    ).toHaveCount(1);
  for (const group of ["Anthropic Claude", "DeepSeek", "Z.ai GLM"])
    await expect(
      page.locator("#admin-fixture .ad-model-group > strong", {
        hasText: group,
      }),
    ).toHaveCount(1);
  const usage = page.locator("#admin-fixture .ad-card", {
    has: page.getByRole("heading", { name: "Penggunaan kredit AI" }),
  });
  await expect(usage.getByText(/42 kredit/)).toBeVisible();
  // The API key value is never rendered, anywhere in the panel.
  expect(await page.locator("#admin-fixture").innerHTML()).not.toContain("sk-");
  // Manual reload asks the server for a fresh catalogue.
  await page.getByRole("button", { name: /Muat ulang katalog/ }).click();
  await expect(
    page.locator("#admin-fixture .ad-model-group > strong", {
      hasText: "Qwen",
    }),
  ).toHaveCount(1);
  const calls = await page.evaluate(() => (window as any).__adminCalls);
  expect(calls).toContain("/admin/ai?refresh=1");
  expect(
    (await new AxeBuilder({ page }).include("#admin-fixture").analyze())
      .violations,
  ).toEqual([]);
});

test("admin AI panel stays honest when the provider is unconfigured or unreachable", async ({
  page,
}) => {
  await mount(page, {
    ai: {
      ...aiPayload,
      configured: false,
      keyPresent: false,
      catalog: null,
      baseHost: "",
      basePath: "",
      defaultModel: "",
    },
  });
  await expect(page.getByText("Belum dikonfigurasi").first()).toBeVisible();
  await expect(
    page.locator("#admin-fixture .ad-note", { hasText: "LLM_BASE_URL" }),
  ).toBeVisible();
  await expect(page.locator(".ad-chips")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /Muat ulang katalog/ }),
  ).toBeDisabled();

  await mount(page, {
    ai: {
      ...aiPayload,
      catalog: null,
      catalogError: "Provider AI tidak dapat dijangkau.",
    },
  });
  await expect(
    page.getByText(/Provider AI tidak dapat dijangkau\./),
  ).toBeVisible();
  await expect(page.getByText(/Preset tier/)).toBeVisible();
});

test("admin credit detail opens per account and shows ledger, reservations and balance", async ({
  page,
}) => {
  await mount(page, {
    tab: "users",
    users: [
      {
        id: USER_ID,
        name: "Anggota",
        email: "member@example.test",
        balance: 128,
        suspended: false,
        verified: true,
        admin_role: null,
      },
    ],
  });
  await expect(page.locator("#admin-fixture .ad-detail")).toHaveCount(0);
  await page.getByRole("button", { name: "Rincian kredit" }).click();
  const panel = page.locator("#admin-fixture .ad-detail");
  await expect(panel).toBeVisible();
  await expect(panel.getByText("128")).toBeVisible();
  // Ledger and reservations are separate accessible tables, so each row is
  // scoped instead of matched globally.
  const ledger = panel.getByRole("region", {
    name: "Tabel Waktu, Delta, Alasan, Referensi",
  });
  const reservations = panel.getByRole("region", {
    name: "Tabel Waktu, Tujuan, Jumlah, Status",
  });
  await expect(ledger.getByRole("cell", { name: "Chat AI" })).toBeVisible();
  await expect(
    ledger.getByRole("cell", { name: "reserve:r1", exact: true }),
  ).toBeVisible();
  await expect(
    ledger.getByRole("cell", { name: "Pembayaran terverifikasi" }),
  ).toBeVisible();
  await expect(
    reservations.getByRole("cell", { name: "Sandbox", exact: true }),
  ).toBeVisible();
  await expect(reservations.getByText("Dibatalkan penyedia")).toBeVisible();
  await expect(panel.getByText(/\+30 kredit masuk/)).toBeVisible();
  await expect(panel.getByText("member@example.test")).toBeVisible();
  await expect(panel.getByText(/Anggota · hanya baca/)).toBeVisible();
  // Toggling the same row closes the panel again.
  await page.getByRole("button", { name: "Rincian kredit" }).click();
  await expect(panel).toHaveCount(0);
});

test("admin operations shows sandbox slots and rate buckets, or the missing migration notice", async ({
  page,
}) => {
  await mount(page, { tab: "operations" });
  const card = page.locator("#admin-fixture .ad-card", {
    has: page.getByRole("heading", { name: /Runtime & sandbox/ }),
  });
  await expect(card).toBeVisible();
  await expect(card.getByText("1 / 50")).toBeVisible();
  await expect(card.getByText("7 / 9")).toBeVisible();
  await expect(card.getByText("PostgreSQL bersama")).toBeVisible();

  await mount(page, {
    tab: "operations",
    runtime: {
      ...runtimePayload,
      available: false,
      reason: "schema_missing",
      notice:
        "Tabel koordinasi runtime belum ada. Terapkan migration 007_runtime_coordination.sql, lalu muat ulang.",
    },
  });
  await expect(
    page
      .locator("#admin-fixture .ad-note", {
        hasText: /Terapkan migration 007_runtime_coordination\.sql/,
      })
      .first(),
  ).toBeVisible();
  await expect(page.getByText("1 / 50")).toHaveCount(0);
});

test("admin overview shows the credit and storage states the new features created", async ({
  page,
}) => {
  await mount(page, {
    tab: "overview",
    overview: {
      metrics: {
        projects: 12,
        pending: 3,
        templates: 5,
        broadcasts: 2,
        lowBalance: 6,
        dormantWorkspaces: 9,
        lowBalanceThreshold: 10,
      },
      recent: [],
    },
  });
  const metric = (name: string) =>
    page.locator("#admin-fixture .ad-metric", { hasText: name });
  await expect(metric("Akun kredit menipis").getByText("6")).toBeVisible();
  // The note quotes the threshold the server sent, not a number in the UI.
  await expect(metric("Akun kredit menipis")).toContainText(
    "Saldo di bawah 10",
  );
  await expect(metric("Salinan cloud diam").getByText("9")).toBeVisible();
  await expect(metric("Salinan cloud diam")).toContainText(
    "tidak diperbarui 7 hari",
  );
  // The builder hosts nothing, so there is no cleanup queue to report.
  await expect(metric("Pekerjaan pembersihan hosting")).toHaveCount(0);

  // A server that does not report them shows a dash, never a zero.
  await mount(page, {
    tab: "overview",
    overview: {
      metrics: {
        projects: 12,
        pending: 3,
        templates: 5,
        broadcasts: 2,
        lowBalance: null,
        dormantWorkspaces: null,
      },
      recent: [],
    },
  });
  await expect(metric("Akun kredit menipis")).toContainText("—");
  await expect(metric("Akun kredit menipis")).toContainText("tidak terbaca");
  await expect(metric("Salinan cloud diam")).toContainText("—");
});

test("admin users list flags a balance below the dashboard threshold", async ({
  page,
}) => {
  const row = (email: string, balance: number) => ({
    id: USER_ID,
    email,
    name: email,
    balance,
    suspended: false,
    verified: true,
    admin_role: "",
  });
  await mount(page, {
    tab: "users",
    users: [row("menipis@example.test", 4), row("aman@example.test", 128)],
  });
  const low = page.getByRole("row", { name: /menipis@example\.test/ });
  const ok = page.getByRole("row", { name: /aman@example\.test/ });
  await expect(low.locator(".ad-badge", { hasText: "Menipis" })).toBeVisible();
  await expect(ok.locator(".ad-badge", { hasText: "Menipis" })).toHaveCount(0);
});

test("admin diagnostics reports storage, backup and the plugin version without overclaiming", async ({
  page,
}) => {
  await mount(page, { tab: "diagnostics", diagnostics: diagnosticsPayload });
  const panel = page.locator("#admin-fixture");
  await expect(
    panel.getByRole("heading", { name: /Penyimpanan & cadangan/ }),
  ).toBeVisible();
  await expect(panel).toContainText("12 salinan project");
  await expect(panel).toContainText("3 diam ≥ 7 hari");
  await expect(panel).toContainText("unduhan JSON oleh pemiliknya");
  await expect(panel).toContainText("tidak pernah diproyeksikan");

  await expect(
    panel.getByRole("heading", { name: /Roblox Studio & plugin/ }),
  ).toBeVisible();
  await expect(panel).toContainText("2.2.0");
  await expect(panel).toContainText("PiwuStudio.rbxmx");
  await expect(panel).toContainText("2 project · 1 token masih berlaku");
  await expect(panel).toContainText("Diterapkan: 1");
  // The panel says what it cannot know: the copy installed in Studio.
  await expect(panel).toContainText("tidak dilaporkan ke server");

  // An older server without these blocks says so instead of rendering blanks.
  await mount(page, {
    tab: "diagnostics",
    diagnostics: { notice: "Probe read-only.", readiness: {} },
  });
  await expect(
    page
      .locator("#admin-fixture")
      .getByText(/Blok penyimpanan tidak ada pada respons ini/),
  ).toBeVisible();
  await expect(
    page
      .locator("#admin-fixture")
      .getByText(/Blok Studio tidak ada pada respons ini/),
  ).toBeVisible();
});
