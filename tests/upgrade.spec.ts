import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { accountPayload, signedIn } from "./helpers-account";

test("the dashboard opens the upgrade page, which reads prices from the server", async ({
  page,
}) => {
  await signedIn(page, {});
  // The sidebar's pitch card is a real route now, not a landing-page anchor.
  const card = page.locator(".upgrade-card");
  await expect(card.getByRole("link")).toHaveAttribute("href", "/upgrade");
  await card.getByRole("link").click();
  await expect(page).toHaveURL(/\/upgrade$/);
  await expect(
    page.getByRole("heading", {
      name: "Naikkan paket saat karya menuntut lebih.",
    }),
  ).toBeVisible();
  // Plans and top-ups both come from the payload, one card per SKU.
  const planGrid = page.locator(".plan-grid").first();
  await expect(planGrid.locator(".plan-card")).toHaveCount(2);
  await expect(
    planGrid.locator(".plan-card", { hasText: "PiwuApp Pro" }),
  ).toContainText("199.000");
  await expect(
    planGrid.locator(".plan-card", { hasText: "PiwuApp Pro" }),
  ).toContainText("1.500");
  await expect(
    page.locator(".plan-grid").nth(1).locator(".plan-card"),
  ).toHaveCount(2);
  // No plan is marked current while the account is on Free.
  await expect(page.locator(".plan-flag")).toHaveCount(0);
  await expect(page.locator(".plan-status")).toContainText("Free");
  await expect(page.locator(".plan-status")).toContainText("128");
  // Payments are off in this payload, so checkout must not be offered.
  await expect(page.locator(".plan-notice-warn")).toContainText(
    "Pembayaran belum dikonfigurasi",
  );
  for (const button of await page
    .getByRole("button", { name: "Checkout" })
    .all())
    await expect(button).toBeDisabled();
  // The pending order still offers its real provider link.
  await expect(
    page.getByRole("link", { name: /Lanjutkan pembayaran/ }),
  ).toHaveAttribute("href", "https://checkout.midtrans.test/o1");
  // Credits follow the price: the card prints the effective rate for the
  // package, and the durations come from the shared costs, not from copy.
  const proCard = planGrid.locator(".plan-card", { hasText: "PiwuApp Pro" });
  await expect(proCard.locator(".plan-rate")).toContainText("133");
  await expect(proCard).toContainText("30 kredit/hari");
  await expect(proCard).toContainText("hangus 2 bulan setelah terbit");
  await expect(proCard).toContainText("jatah harian tidak menumpuk");
  const teamCard = planGrid.locator(".plan-card", { hasText: "PiwuApp Team" });
  await expect(teamCard.locator(".plan-rate")).toContainText("111");
  await expect(teamCard.locator(".plan-credits")).toContainText("4.500");
  await expect(teamCard).toContainText("40 kredit/hari");
  // The benefit list on each card comes from the same ladder as the price and
  // never advertises a feature that is locked to a plan.
  await expect(proCard.locator(".plan-benefits")).toContainText(
    "Semua yang ada di Free",
  );
  await expect(proCard.locator(".plan-benefits")).toContainText(
    "1.500 kredit/bulan",
  );
  await expect(teamCard.locator(".plan-benefits")).toContainText(
    "4.500 kredit/bulan",
  );
  await expect(teamCard.locator(".plan-benefits")).toContainText(
    "40 kredit/hari",
  );
  // "How long until it runs out" is answered with three stated profiles.
  const table = page.locator(".plan-table");
  await expect(table.locator(".plan-table-row")).toHaveCount(4);
  await expect(table.locator(".plan-table-head")).toContainText("Saldo Anda");
  await expect(table).toContainText("pemakaian ringan");
  await expect(table).toContainText("pemakaian normal");
  await expect(table).toContainText("pemakaian intens");
  await expect(table.locator(".plan-table-row").nth(1)).toContainText("±");
  // Gating is real but ships open; the page says so instead of implying more.
  await expect(page.locator(".plan-facts")).toContainText(
    "matriks akses per paket",
  );
  await expect(page.locator(".plan-facts")).toContainText("Semua paket");
  const axe = await new AxeBuilder({ page }).analyze();
  expect(axe.violations).toEqual([]);
  await page.screenshot({ path: ".artifacts/upgrade-page.png" });
  // The durations are the part of the page that answers "how long until it runs
  // out", so keep a picture of the table too.
  await page.locator(".plan-table").scrollIntoViewIfNeeded();
  await page.screenshot({ path: ".artifacts/upgrade-durations.png" });
});

test("checkout sends the chosen SKU and follows the provider link", async ({
  page,
}) => {
  const sent: any[] = [];
  await signedIn(
    page,
    {
      paymentsEnabled: true,
      provider: "midtrans",
      plan: {
        plan: "Pro",
        // Relative to now so the "Sisa 18 hari" assertion does not rot.
        current_period_end: new Date(Date.now() + 18 * 86400000).toISOString(),
      },
    },
    (body) => sent.push(body),
  );
  await page.goto("/upgrade");
  await expect(page.locator(".plan-notice")).toContainText("midtrans");
  // The plan the account is on is marked and offered as a renewal.
  const current = page.locator(".plan-card-current");
  await expect(current).toHaveCount(1);
  await expect(current).toContainText("PiwuApp Pro");
  await expect(current.getByRole("button")).toHaveText("Perpanjang paket");
  await expect(page.locator(".plan-status")).toContainText("Sisa 18 hari");
  // Buying a top-up posts its SKU, then leaves for the provider.
  await page.route("https://checkout.midtrans.test/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<main>Halaman checkout provider (fixture)</main>",
    }),
  );
  await page
    .locator(".plan-card", { hasText: "Top-up 300 kredit" })
    .getByRole("button")
    .click();
  await expect(
    page.getByText("Halaman checkout provider (fixture)"),
  ).toBeVisible();
  expect(sent).toEqual([{ sku: "credits300" }]);
});

test("the upgrade page states the session requirement instead of showing prices", async ({
  page,
}) => {
  await page.goto("/upgrade");
  await expect(page.getByRole("alert")).toContainText(
    "Halaman paket membutuhkan sesi terverifikasi",
  );
  await expect(
    page.getByRole("link", { name: "Masuk ke akun cloud" }),
  ).toHaveAttribute("href", "/login?next=%2Fupgrade");
  // No price card is rendered without a verified account.
  await expect(page.locator(".plan-card")).toHaveCount(0);
});

test("the landing prices come from the same credit ladder as the checkout", async ({
  page,
}) => {
  await page.goto("/");
  const cards = page.locator("#pricing .pricing-card");
  await expect(cards).toHaveCount(3);
  await expect(cards.nth(0).locator(".pricing-credit")).toContainText(
    "20 kredit/hari",
  );
  await expect(cards.nth(0).locator(".pricing-credit")).toContainText(
    "plafon 600 kredit/bulan",
  );
  await expect(cards.nth(1).locator(".price-value")).toHaveText("199.000");
  await expect(cards.nth(1).locator(".pricing-credit")).toContainText(
    "1.500 kredit/bulan",
  );
  await expect(cards.nth(1).locator(".pricing-credit")).toContainText(
    "pemakaian normal",
  );
  await expect(cards.nth(1).locator(".pricing-credit")).toContainText(
    "30 kredit/hari",
  );
  await expect(cards.nth(2).locator(".pricing-credit")).toContainText(
    "4.500 kredit/bulan",
  );
  await expect(cards.nth(2).locator(".pricing-credit")).toContainText(
    "hangus 2 bulan setelah terbit",
  );
  // The benefit lists come from the same ladder as the price, and no card
  // advertises a gated feature the app does not enforce.
  await expect(cards.nth(0)).toContainText(
    "Template web, Roblox, dan aplikasi mobile",
  );
  await expect(cards.nth(0)).toContainText(
    "Editor kode, preview, dan Export ZIP",
  );
  await expect(cards.nth(0)).not.toContainText("3 project lokal");
  await expect(cards.nth(1)).toContainText("1.500 kredit/bulan");
  await expect(cards.nth(1)).toContainText("Semua yang ada di Free");
  await expect(cards.nth(2)).toContainText("4.500 kredit/bulan");
  await expect(cards.nth(2)).toContainText("Semua yang ada di Pro");
  await expect(cards.nth(2)).not.toContainText("Workspace bersama");
  await expect(cards.nth(2)).not.toContainText("Tagihan terpusat");
  await expect(page.locator(".pricing-note")).toContainText(
    "Jatah harian direset setiap hari pukul 00:00 UTC dan tidak menumpuk",
  );
  await expect(page.locator(".pricing-note")).toContainText(
    "tidak ada fitur yang dikunci per paket",
  );
  const axe = await new AxeBuilder({ page }).analyze();
  expect(axe.violations).toEqual([]);
});

test("a price saved in the admin panel reaches the landing page", async ({
  page,
}) => {
  await page.route("**/api/public/site", (route) =>
    route.fulfill({
      json: {
        configured: true,
        settings: {
          enabled_services: {
            plan_overrides: { pro: { amount: 249000, credits: 2000 } },
          },
        },
        broadcasts: [],
      },
    }),
  );
  await page.goto("/");
  const pro = page.locator("#pricing .pricing-card").nth(1);
  await expect(pro.locator(".price-value")).toHaveText("249.000");
  await expect(pro.locator(".pricing-credit")).toContainText(
    "2.000 kredit/bulan",
  );
  await expect(pro).toContainText("Rp 125/kredit");
  // The database-owned allowance does not move with the price.
  await expect(pro).toContainText("30 kredit/hari");
});

test("the upgrade page renders the prices the server actually sells", async ({
  page,
}) => {
  const base = accountPayload();
  await signedIn(page, {
    products: {
      ...(base.products as Record<string, unknown>),
      pro: {
        kind: "plan",
        plan: "Pro",
        amount: 249000,
        credits: 2000,
        label: "PiwuApp Pro · 30 hari",
      },
    },
  });
  await page.goto("/upgrade");
  const pro = page.locator(".plan-card", { hasText: "PiwuApp Pro" });
  await expect(pro.locator(".plan-price")).toContainText("Rp 249.000");
  await expect(pro.locator(".plan-rate")).toContainText("125");
  await expect(pro.locator(".plan-credits")).toContainText("2.000");
  await expect(pro.locator(".plan-benefits")).toContainText(
    "2.000 kredit/bulan",
  );
});
