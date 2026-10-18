import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { realAccountFixture, loginRealFixture } from "./helpers-real";

test("admin searches server-wide, retains filters on failure, paginates, exports safe CSV and displays honest diagnostics", async ({
  page,
}) => {
  const { user } = await realAccountFixture(page);
  const calls: string[] = [];
  await page.route("**/api/admin/**", async (route) => {
    const url = new URL(route.request().url());
    calls.push(url.pathname + url.search);
    if (url.pathname.endsWith("/session"))
      return route.fulfill({
        json: { userId: user.id, role: "auditor", email: user.email },
      });
    if (url.pathname.endsWith("/diagnostics"))
      return route.fulfill({
        json: {
          readiness: {
            checkedAt: "2026-10-15T00:00:00Z",
            auth: "not_configured",
            ai: "configured_unverified",
          },
          runtime: {
            rateLimitMode: "database",
            coordinationSchema: "schema_missing",
            sandboxRouting: "sticky-owner-lease",
          },
          search: {
            web: false,
            provider: "none",
            rounds: 2,
            available: false,
            selected: "tavily",
            selectedAvailable: false,
            disabled: false,
            keyConfigured: false,
            locale: { country: "", language: "" },
            cache: {
              mode: "process",
              entries: 3,
              ttlMinutes: 15,
              stats: {
                hits: 2,
                memoryHits: 2,
                sharedHits: 0,
                writes: 3,
                errors: 0,
              },
            },
            jobs: {
              jobs: 1,
              running: 0,
              ready: 1,
              ttlMinutes: 360,
              max: 20,
              durable: true,
              stored: 1,
              errors: 0,
            },
            notice:
              "Status konfigurasi, bukan bukti panggilan vendor berhasil. Untuk uji nyata jalankan npm run verify:search di server.",
          },
          liveVerified: false,
          notice:
            "Probe read-only: bukan bukti transaksi atau kelulusan pentest.",
        },
      });
    if (url.searchParams.get("q") === "error")
      return route.fulfill({
        status: 503,
        json: { error: "Database tidak tersedia." },
      });
    return route.fulfill({
      json: {
        hasMore: url.searchParams.get("page") !== "2",
        items: [
          {
            id: user.id,
            email: "fixture@example.test",
            name:
              url.searchParams.get("q") ||
              (url.searchParams.get("page") === "2"
                ? "Halaman dua"
                : '=HYPERLINK("https://invalid")'),
            balance: 0,
            verified: true,
          },
        ],
      },
    });
  });
  await loginRealFixture(page);
  await page.goto("/admin?tab=users");
  await expect(
    page.getByRole("heading", { name: "Pengguna", exact: true, level: 1 }),
  ).toBeVisible();
  await expect(
    page.getByText("Akses auditor: seluruh halaman hanya baca."),
  ).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Ekspor halaman CSV" }).click();
  const download = await downloadPromise;
  await download.saveAs(".artifacts/admin-safe-export.csv");
  expect(download.suggestedFilename()).toBe("piwu-users-halaman-1.csv");
  await page.getByRole("button", { name: "Berikutnya", exact: true }).click();
  await expect(page.getByText("Halaman dua", { exact: true })).toBeVisible();
  await page
    .getByLabel("Cari di seluruh daftar")
    .fill("Pengguna di luar halaman");
  await page.getByRole("button", { name: "Terapkan filter" }).click();
  await expect
    .poll(() => calls.at(-1))
    .toContain("page=1&q=Pengguna+di+luar+halaman");
  await expect(
    page.getByText("Pengguna di luar halaman", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Cari di seluruh daftar").fill("error");
  await page.getByRole("button", { name: "Terapkan filter" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Database tidak tersedia",
  );
  await expect(page.getByLabel("Cari di seluruh daftar")).toBeVisible();
  await page.getByRole("button", { name: "Reset filter" }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const axe = await new AxeBuilder({ page })
    .include("#admin-content")
    .analyze();
  expect(axe.violations).toEqual([]);
  await page.getByRole("button", { name: "Diagnostik", exact: true }).click();
  await expect(
    page.getByText("Dikonfigurasi, belum diuji", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("PostgreSQL bersama", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Belum terverifikasi — periksa migration 007"),
  ).toBeVisible();
  // Search status is read-only, honest about the missing key, and shows the
  // cache mode without ever printing a credential.
  await expect(
    page.getByText("Kunci belum ada", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("belum diisi (SEARCH_API_KEY)", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/per-proses \(migration 009/)).toBeVisible();
  await expect(page.getByText(/2 hit/)).toBeVisible();
  // Background jobs: in-memory count, and how many answers really survive a
  // restart in the shared table. Never a bare "stored" number.
  await expect(page.getByText(/1 di memori · 0 berjalan/)).toBeVisible();
  await expect(page.getByText(/1 tahan restart \(tabel 009\)/)).toBeVisible();
  await expect(page.getByText(/simpan 360 menit/)).toBeVisible();
  const diagnosticsText = await page.locator("#admin-content").innerText();
  expect(diagnosticsText).not.toContain("SEARCH_API_KEY=");
});
