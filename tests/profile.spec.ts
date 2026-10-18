import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { realAccountFixture, loginRealFixture } from "./helpers-real";
import { ACCOUNT_URL, accountPayload, meaningful } from "./helpers-account";

test("the profile page changes identity data and never fakes what it cannot do", async ({
  page,
}) => {
  const updates: any[] = [];
  await realAccountFixture(page);
  await page.route(ACCOUNT_URL, (route) =>
    route.fulfill({
      json: accountPayload({
        plan: {
          plan: "Pro",
          // Relative to now so the "Sisa 18 hari" assertion does not rot.
          current_period_end: new Date(
            Date.now() + 18 * 86400000,
          ).toISOString(),
        },
      }),
    }),
  );
  // Record every auth update, then let the real fixture answer it.
  await page.route("**/auth/v1/user", async (route) => {
    if (route.request().method() !== "GET")
      updates.push(route.request().postDataJSON());
    await route.fallback();
  });
  await page.goto("/login");
  await loginRealFixture(page);
  await page.getByRole("link", { name: "Profil saya" }).click();
  await expect(page).toHaveURL(/\/profile$/);
  await expect(
    page.getByRole("heading", { name: "Jejak akun Anda." }),
  ).toBeVisible();
  await expect(page.locator(".profile-head")).toContainText("Akun Uji");
  await expect(page.locator(".profile-head")).toContainText(
    "test@example.test",
  );
  await expect(page.locator(".profile-head")).toContainText(
    "email terverifikasi",
  );
  // Plan and credits come from the same account payload as the upgrade page.
  await expect(
    page.locator(".profile-card", { hasText: "Paket & kredit" }),
  ).toContainText("Pro");
  await expect(
    page.locator(".profile-card", { hasText: "Paket & kredit" }),
  ).toContainText("Sisa 18 hari");
  await expect(
    page.locator(".profile-card", { hasText: "Paket & kredit" }),
  ).toContainText("128");
  // 42,500 accrued net, the refunded sale left out.
  await expect(
    page.locator(".profile-card", { hasText: "Paket & kredit" }),
  ).toContainText("42.500");

  // A name that did not change is not sent anywhere.
  await page.getByRole("button", { name: "Simpan nama" }).click();
  await expect(page.getByRole("status").first()).toContainText(
    "tidak ada yang dikirim",
  );
  expect(updates).toEqual([]);

  // A real name change is sent as user metadata.
  await page.getByLabel("Nama tampilan").fill("  Akun   Uji Dua ");
  await page.getByRole("button", { name: "Simpan nama" }).click();
  await expect(page.getByRole("status").first()).toContainText(
    "Nama tampilan diperbarui",
  );
  expect(updates.map(meaningful)).toEqual([{ data: { name: "Akun Uji Dua" } }]);

  // Mismatched passwords never reach the auth service.
  await page.getByLabel("Kata sandi baru").fill("rahasia123");
  await page.getByLabel("Ulangi kata sandi").fill("rahasia124");
  await page.getByRole("button", { name: "Ganti kata sandi" }).click();
  await expect(page.getByRole("alert")).toContainText("tidak cocok");
  expect(updates).toHaveLength(1);

  // A matching pair is sent, and the fields are cleared afterwards.
  await page.getByLabel("Ulangi kata sandi").fill("rahasia123");
  await page.getByRole("button", { name: "Ganti kata sandi" }).click();
  await expect(page.getByRole("status").first()).toContainText(
    "Kata sandi dikirim ke layanan autentikasi",
  );
  expect(updates.map(meaningful)).toEqual([
    { data: { name: "Akun Uji Dua" } },
    { password: "rahasia123" },
  ]);
  await expect(page.getByLabel("Kata sandi baru")).toHaveValue("");

  // The same address is rejected before any request, a new one needs confirmation.
  await page.getByLabel("Email pengganti").fill("test@example.test");
  await page.getByRole("button", { name: "Ajukan perubahan email" }).click();
  await expect(page.getByRole("alert")).toContainText("sudah dipakai akun ini");
  await page.getByLabel("Email pengganti").fill("baru@example.test");
  await page.getByRole("button", { name: "Ajukan perubahan email" }).click();
  await expect(page.getByRole("status").first()).toContainText(
    "berlaku setelah tautan konfirmasi",
  );
  expect(updates.map(meaningful)).toEqual([
    { data: { name: "Akun Uji Dua" } },
    { password: "rahasia123" },
    { email: "baru@example.test" },
  ]);

  // What the page cannot do is stated, not simulated.
  await expect(
    page.locator(".profile-card", { hasText: "Workspace" }),
  ).toContainText("Penghapusan akun belum tersedia");
  const axe = await new AxeBuilder({ page }).analyze();
  expect(axe.violations).toEqual([]);
  await page.screenshot({ path: ".artifacts/profile-page.png" });

  // Signing out of this device only returns to the landing page.
  await page.getByRole("button", { name: "Keluar dari perangkat ini" }).click();
  await expect(page).toHaveURL(/localhost:3101\/$/);
});
