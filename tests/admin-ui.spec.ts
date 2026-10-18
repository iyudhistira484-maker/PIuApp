import { realAccountFixture, loginRealFixture } from "./helpers-real";
import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
test("admin requires authenticated server role; no preview bypass", async ({
  page,
}) => {
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/login\?next=/);
  await expect(
    page.getByRole("button", { name: "Lihat pratinjau panel" }),
  ).toHaveCount(0);
  await realAccountFixture(page);
  await page.route("**/api/admin/session", (r) =>
    r.fulfill({
      status: 403,
      json: { error: "Akses administrator diperlukan." },
    }),
  );
  await loginRealFixture(page);
  await page.goto("/admin");
  await expect(page.getByRole("alert")).toContainText(
    "Akses administrator diperlukan.",
  );
  await expect(
    page.getByRole("navigation", { name: "Navigasi admin" }),
  ).toHaveCount(0);
});
async function fixture(
  page: Page,
  role = "operator",
  tab = "broadcasts",
  items: any[] = [],
) {
  await page.goto("/");
  await page.evaluate(
    async ({ role, tab, items }) => {
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
      const state = {
        items: structuredClone(items),
        actions: [] as any[],
        fail: false,
      };
      const client = async (path: string, body?: any) => {
        if (path === "/admin/actions") {
          state.actions.push(structuredClone(body));
          if (state.fail) throw new Error("Konflik revisi. Muat ulang data.");
          state.items = [
            { id: body.target, ...body.payload, revision: 1, read_count: 0 },
          ];
          return { notice: "Broadcast disimpan dalam fixture pengujian." };
        }
        if (path === "/admin/payouts")
          return {
            applied: true,
            sellers: [
              {
                user_id: "11111111-1111-4111-8111-111111111111",
                name: "Penjual Fixture",
                accrued: 180000,
                pending: 100000,
                paid: 0,
                available: 80000,
                kyc_status: "pending",
                legal_name: "Penjual Fixture",
                country: "ID",
              },
            ],
            verifications: [
              {
                user_id: "11111111-1111-4111-8111-111111111111",
                status: "pending",
                legal_name: "Penjual Fixture",
                country: "ID",
                submitted_at: "2026-10-10T00:00:00.000Z",
              },
            ],
            payouts: [
              {
                id: "22222222-2222-4222-8222-222222222222",
                seller_id: "11111111-1111-4111-8111-111111111111",
                amount: 100000,
                method: "bank",
                destination: "BCA 1234567890",
                status: "requested",
                created_at: "2026-10-10T00:00:00.000Z",
              },
            ],
          };
        if (path === "/admin/disputes")
          return {
            applied: true,
            items: [
              {
                id: "33333333-3333-4333-8333-333333333333",
                order_id: "44444444-4444-4444-8444-444444444444",
                template_id: "55555555-5555-4555-8555-555555555555",
                buyer_name: "Pembeli Fixture",
                seller_name: "Penjual Fixture",
                category: "broken",
                body: "File yang diunduh rusak dan tidak bisa dipakai sama sekali.",
                status: "open",
                opened_at: "2026-10-12T00:00:00.000Z",
                title: "Template Fixture",
              },
            ],
          };
        if (path.startsWith("/admin/disputes/")) {
          state.actions.push({ path, ...structuredClone(body) });
          return {
            result: {
              status: body?.status,
              notice: "Keputusan sengketa tersimpan.",
            },
          };
        }
        if (path.startsWith("/admin/payouts/")) {
          state.actions.push({ path, ...structuredClone(body) });
          return { result: { status: body?.status } };
        }
        if (path.startsWith("/admin/settings"))
          return {
            revision: 1,
            value: {
              maintenance: false,
              maintenance_message: "Pemeliharaan",
              hero_title: "",
              hero_subtitle: "",
              support_email: "",
              enabled_services: {
                ai: true,
                sandbox: true,
                payments: true,
                marketplace: true,
              },
            },
          };
        return { items: structuredClone(state.items), hasMore: false };
      };
      document.getElementById("root")!.style.display = "none";
      const host = document.createElement("div");
      host.id = "admin-fixture";
      document.body.append(host);
      (window as any).__adminFixture = state;
      createRoot(host).render(
        React.createElement(
          MemoryRouter,
          { initialEntries: ["/admin?tab=" + tab] },
          React.createElement(AdminPanel, {
            session: { role, email: "fixture@example.test" },
            preview: false,
            client,
          }),
        ),
      );
    },
    { role, tab, items },
  );
  if (tab === "broadcasts")
    await expect(
      page.getByRole("heading", { name: "Broadcast", exact: true }),
    ).toBeVisible();
}
test("dispute queue: superadmin closes a report only after a reason", async ({
  page,
}) => {
  await fixture(page, "superadmin", "marketplace");
  await expect(
    page.getByRole("heading", { name: "Sengketa marketplace" }),
  ).toBeVisible();
  await expect(page.getByText("Template Fixture").first()).toBeVisible();
  await page
    .getByRole("row", { name: /44444444/ })
    .getByRole("button", { name: "Tutup laporan" })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Keputusan sengketa");
  await expect(
    dialog.getByRole("button", { name: "Konfirmasi perubahan" }),
  ).toBeDisabled();
  await dialog
    .getByLabel("Alasan perubahan")
    .fill("Penjual memperbaiki akses; laporan ditutup tanpa refund");
  await dialog.getByRole("button", { name: "Konfirmasi perubahan" }).click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Keputusan sengketa tersimpan" }),
  ).toBeVisible();
  const sent = await page.evaluate(
    () => (window as any).__adminFixture.actions[0],
  );
  expect(sent.path).toBe(
    "/admin/disputes/33333333-3333-4333-8333-333333333333",
  );
  expect(sent.status).toBe("resolved");
  expect(sent.note).toContain("tanpa refund");
});

test("payout queue: superadmin reviews KYC and marks a transfer paid with a reference", async ({
  page,
}) => {
  await fixture(page, "superadmin", "marketplace");
  await expect(
    page.getByRole("heading", { name: "Verifikasi penjual & payout" }),
  ).toBeVisible();
  await expect(page.getByText("Penjual Fixture").first()).toBeVisible();

  await page
    .getByRole("row", { name: /22222222/ })
    .getByRole("button", { name: "Tandai dibayar" })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Referensi transfer");
  await expect(
    dialog.getByRole("button", { name: "Konfirmasi perubahan" }),
  ).toBeDisabled();
  await dialog.getByLabel("Referensi transfer").fill("TRX-2026-0001");
  await dialog
    .getByLabel("Alasan perubahan")
    .fill("Transfer bank sudah diterima penjual");
  await dialog.getByRole("button", { name: "Konfirmasi perubahan" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Tinjauan tersimpan" }),
  ).toBeVisible();
  const sent = await page.evaluate(
    () => (window as any).__adminFixture.actions[0],
  );
  expect(sent.path).toBe("/admin/payouts/22222222-2222-4222-8222-222222222222");
  expect(sent.status).toBe("paid");
  expect(sent.reference).toBe("TRX-2026-0001");
  expect(sent.note).toContain("Transfer bank");

  await page
    .getByRole("row", { name: /11111111/ })
    .getByRole("button", { name: "Setujui" })
    .first()
    .click();
  await page.getByLabel("Alasan perubahan").fill("Dokumen penjual sesuai");
  await page.getByRole("button", { name: "Konfirmasi perubahan" }).click();
  const kycSent = await page.evaluate(
    () => (window as any).__adminFixture.actions[1],
  );
  expect(kycSent.path).toBe("/admin/payouts/kyc");
  expect(kycSent.status).toBe("verified");
  expect(kycSent.userId).toBe("11111111-1111-4111-8111-111111111111");
});

test("broadcast editor: schedule, audience, confirmation, retained draft and explicit errors", async ({
  page,
}) => {
  await fixture(page);
  await page
    .getByRole("button", { name: "Buat broadcast", exact: true })
    .click();
  await page
    .getByLabel("Judul", { exact: true })
    .fill("Pemeliharaan terjadwal");
  await page
    .getByLabel("Isi pengumuman")
    .fill("Simpan perubahan project sebelum pemeliharaan.");
  await page
    .getByRole("combobox", { name: "Audiens", exact: true })
    .selectOption("pro");
  await page
    .getByRole("combobox", { name: "Status", exact: true })
    .selectOption("published");
  await page.getByLabel("Mulai tayang").fill("2099-12-12T10:00");
  await page
    .getByRole("button", { name: "Tinjau & simpan", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await page.getByRole("button", { name: "Batal", exact: true }).click();
  await expect(page.getByLabel("Judul", { exact: true })).toHaveValue(
    "Pemeliharaan terjadwal",
  );
  await page
    .getByRole("button", { name: "Tinjau & simpan", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Konfirmasi perubahan" }),
  ).toBeDisabled();
  await page
    .getByLabel("Alasan perubahan")
    .fill("Informasi pemeliharaan rutin");
  await page.evaluate(() => {
    (window as any).__adminFixture.fail = true;
  });
  await page.getByRole("button", { name: "Konfirmasi perubahan" }).click();
  await expect(page.getByRole("alert")).toContainText("Konflik revisi");
  await page.evaluate(() => {
    (window as any).__adminFixture.fail = false;
  });
  await page.getByRole("button", { name: "Konfirmasi perubahan" }).click();
  await expect(
    page.getByRole("cell", { name: "Terjadwal", exact: true }),
  ).toBeVisible();
  const actions = await page.evaluate(
    () => (window as any).__adminFixture.actions,
  );
  expect(actions).toHaveLength(2);
  expect(actions[0].requestId).toBe(actions[1].requestId);
  expect(actions[1].payload.audience).toBe("pro");
  expect(actions[1].payload.status).toBe("published");
  expect(actions[1]).not.toHaveProperty("actor");
});
test("auditor cannot mutate and operator cannot change settings", async ({
  page,
}) => {
  for (const role of ["auditor", "operator"]) {
    await fixture(page, role);
    if (role === "auditor")
      await expect(
        page.getByRole("button", { name: "Buat broadcast", exact: true }),
      ).toBeDisabled();
    await page
      .getByRole("navigation", { name: "Navigasi admin" })
      .getByRole("button", { name: "Pengaturan situs" })
      .click();
    await expect(
      page.getByRole("button", { name: "Tinjau & simpan pengaturan" }),
    ).toBeDisabled();
    await expect(page.getByLabel("Judul utama")).toBeDisabled();
  }
});
test("public announcements render as plain text and site content is connected", async ({
  page,
}) => {
  await page.route("**/api/public/site", (route) =>
    route.fulfill({
      json: {
        configured: true,
        settings: {
          hero_title: "Bangun bersama komunitas",
          hero_subtitle: "Konten dari pengaturan admin",
          support_email: "support@example.test",
          maintenance: true,
          maintenance_message: "Pemeliharaan terjadwal",
        },
        broadcasts: [
          {
            id: crypto.randomUUID(),
            title: "Kabar platform",
            body: "<script>window.injected=true</script>",
            read: false,
          },
        ],
      },
    }),
  );
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Bangun bersama komunitas" }),
  ).toBeVisible();
  await expect(page.getByText("Konten dari pengaturan admin")).toBeVisible();
  await page.locator(".platform-announcements summary").click();
  await expect(
    page.getByText("<script>window.injected=true</script>", { exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => (window as any).injected)).toBeUndefined();
  await expect(page.getByRole("button", { name: "Tandai dibaca" })).toHaveCount(
    0,
  );
});

test("settings edit package prices and the Studio switch for the whole platform", async ({
  page,
}) => {
  await fixture(page, "superadmin", "settings");
  await expect(
    page.getByRole("heading", { name: "Paket & kredit" }),
  ).toBeVisible();
  // Effective defaults are shown, not blank boxes.
  await expect(
    page.getByLabel("Harga (Rp)", { exact: true }).first(),
  ).toHaveValue("199000");
  await expect(page.getByLabel("Kredit", { exact: true }).first()).toHaveValue(
    "1500",
  );
  await expect(page.getByText("Roblox Studio bridge")).toBeVisible();
  await page.getByLabel("Harga (Rp)", { exact: true }).first().fill("249000");
  await page.getByLabel("Kredit", { exact: true }).first().fill("2000");
  // The access matrix defaults to "Semua paket" and travels with the settings.
  await expect(page.getByLabel("Sandbox, terminal & npm")).toHaveValue("free");
  await page.getByLabel("Sandbox, terminal & npm").selectOption("pro");
  await page.getByLabel("Menjual template").selectOption("team");
  await page
    .getByRole("button", { name: "Tinjau & simpan pengaturan" })
    .click();
  await page
    .getByLabel("Alasan perubahan")
    .fill("Menyesuaikan harga paket Pro");
  await page.getByRole("button", { name: "Konfirmasi perubahan" }).click();
  const actions = await page.evaluate(
    () => (window as any).__adminFixture.actions,
  );
  expect(actions).toHaveLength(1);
  expect(actions[0].action).toBe("settings");
  expect(actions[0].payload.value.enabled_services.plan_overrides.pro).toEqual({
    amount: 249000,
    credits: 2000,
  });
  expect(actions[0].payload.value.enabled_services.plan_overrides.team).toEqual(
    {
      amount: 499000,
      credits: 4500,
    },
  );
  // Prices must not be sent as a top-level key: migration 005's RPC rejects it.
  expect(actions[0].payload.value).not.toHaveProperty("plan_overrides");
  expect(actions[0].payload.value.enabled_services.studio).toBe(true);
  expect(actions[0].payload.value.enabled_services.plan_features).toEqual({
    sandbox: "pro",
    studio: "free",
    marketplace_sell: "team",
  });
});

test("settings stay read-only without the superadmin role", async ({
  page,
}) => {
  await fixture(page, "operator", "settings");
  await expect(
    page.getByLabel("Harga (Rp)", { exact: true }).first(),
  ).toBeDisabled();
  await expect(
    page.getByLabel("Kredit", { exact: true }).first(),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Gunakan harga bawaan" }),
  ).toBeDisabled();
  await expect(page.getByText("Roblox Studio bridge")).toBeVisible();
});

test("users tab removes an account only after the exact id and a reason", async ({
  page,
}) => {
  const target = crypto.randomUUID(),
    admin = crypto.randomUUID();
  const rows = [
    {
      id: target,
      name: "Budi",
      email: "budi@example.test",
      balance: 10,
      suspended: false,
      verified: true,
      admin_role: "",
    },
    {
      id: admin,
      name: "Admin Lain",
      email: "admin@example.test",
      balance: 0,
      suspended: false,
      verified: true,
      admin_role: "auditor",
    },
  ];
  await fixture(page, "superadmin", "users", rows);
  const remove = page.getByRole("button", { name: "Hapus akun" });
  await expect(remove).toHaveCount(2);
  // An account with an admin role must lose that role first.
  await expect(remove.nth(1)).toBeDisabled();
  await remove.first().click();
  await expect(page.getByRole("dialog")).toContainText(
    "Catatan pembayaran dan audit tetap disimpan",
  );
  const confirm = page.getByRole("button", {
    name: "Konfirmasi perubahan",
    exact: true,
  });
  await expect(confirm).toBeDisabled();
  await page
    .getByLabel("Ketik ID pengguna lengkap untuk menghapus akun")
    .fill(target);
  await page
    .getByLabel("Alasan perubahan")
    .fill("Permintaan penghapusan oleh pemilik akun");
  await expect(confirm).toBeEnabled();
  await confirm.click();
  const actions = await page.evaluate(
    () => (window as any).__adminFixture.actions,
  );
  expect(actions).toHaveLength(1);
  expect(actions[0].action).toBe("user_delete");
  expect(actions[0].target).toBe(target);
  expect(actions[0].payload).toEqual({ confirmation: target });
  expect(actions[0].reason).toBe("Permintaan penghapusan oleh pemilik akun");
});

test("users tab keeps account removal closed to non-superadmin roles", async ({
  page,
}) => {
  await fixture(page, "operator", "users", [
    {
      id: crypto.randomUUID(),
      name: "Budi",
      email: "budi@example.test",
      balance: 10,
      suspended: false,
      verified: true,
      admin_role: "",
    },
  ]);
  await expect(page.getByRole("button", { name: "Hapus akun" })).toBeDisabled();
});
