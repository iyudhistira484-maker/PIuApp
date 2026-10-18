import { test, expect } from "@playwright/test";
test("public settings outage does not show a persistent landing error; background polling recovers", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.clock.install();
  let restored = false,
    requests = 0;
  await page.route("**/api/public/site", (r) => {
    requests++;
    return restored
      ? r.fulfill({
          json: {
            configured: true,
            availability: "ready",
            settings: { hero_title: "Kembali terhubung" },
            broadcasts: [
              {
                id: "notice",
                title: "Pengumuman tersedia",
                body: "Konten publik pulih.",
                read: false,
              },
            ],
          },
        })
      : r.fulfill({
          status: 503,
          json: { error: "Konfigurasi platform tidak dapat dibaca." },
        });
  });
  const response = page.waitForResponse("**/api/public/site");
  await page.goto("/");
  await (await response).finished();
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Bangun sesuatu",
  );
  await expect(
    page.getByText("Informasi platform belum dapat dimuat."),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Muat ulang informasi" }),
  ).toHaveCount(0);
  restored = true;
  await page.clock.fastForward(61000);
  await expect(
    page.getByRole("heading", { name: "Kembali terhubung" }),
  ).toBeVisible();
  await page.locator(".platform-announcements summary").click();
  await expect(
    page.getByRole("heading", { name: "Pengumuman tersedia" }),
  ).toBeVisible();
  expect(requests).toBeLessThanOrEqual(3);
});
test("degraded public response keeps last known maintenance visible without a failure banner", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("**/api/public/site", (r) =>
    r.fulfill({
      json: {
        configured: true,
        availability: "unavailable",
        issue: "database_unavailable",
        source: "cached",
        settings: {
          hero_title: "Konten terakhir",
          maintenance: true,
          maintenance_message: "Pemeliharaan terjadwal.",
        },
        broadcasts: [],
      },
    }),
  );
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Konten terakhir" }),
  ).toBeVisible();
  await expect(
    page.getByText("Pemeliharaan terjadwal.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Muat ulang informasi" }),
  ).toHaveCount(0);
  await expect(page.locator(".platform-announcements")).toHaveCount(0);
  await page
    .getByPlaceholder("Minta PiwuApp membuat aplikasi tentang…")
    .fill("Project baru");
  await page
    .getByRole("button", { name: "Kirim ide dan buat project" })
    .click();
  await expect(page).toHaveURL(/\/login/);
});
