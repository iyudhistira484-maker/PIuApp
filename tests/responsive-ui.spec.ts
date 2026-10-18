import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const sizes = [
  { name: "mobile-small", width: 320, height: 740 },
  { name: "mobile", width: 390, height: 844 },
  { name: "tablet-small", width: 600, height: 960 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "tablet-large", width: 834, height: 1194 },
  { name: "landscape", width: 844, height: 390 },
  { name: "tablet-landscape", width: 1024, height: 768 },
  { name: "desktop", width: 1440, height: 1000 },
  { name: "desktop-wide", width: 1920, height: 1080 },
];
test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("**/api/public/site", (r) =>
    r.fulfill({ json: { configured: false, settings: {}, broadcasts: [] } }),
  );
});
for (const size of sizes) {
  test(`responsive landing: ${size.name} ${size.width}×${size.height}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(size.width);
    // Check bounds of real layout regions, not decorative miniature artwork.
    for (const selector of [
      ".hero-content",
      ".template-grid",
      ".feature-layout",
      ".pricing-grid",
      ".faq-section",
      ".site-footer",
    ]) {
      const bounds = await page.locator(selector).boundingBox();
      expect(bounds!.x, selector).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width, selector).toBeLessThanOrEqual(
        size.width + 1,
      );
    }
    await expect(page.locator("#hero-prompt")).toHaveCSS("font-size", "16px");
    const templates = await page
      .locator(".template-grid")
      .evaluate(
        (e) => getComputedStyle(e).gridTemplateColumns.split(" ").length,
      );
    expect(templates).toBe(size.width <= 480 ? 1 : size.width <= 1100 ? 2 : 4);
    const pricing = await page
      .locator(".pricing-grid")
      .evaluate(
        (e) => getComputedStyle(e).gridTemplateColumns.split(" ").length,
      );
    expect(pricing).toBe(size.width <= 600 ? 1 : size.width <= 1000 ? 2 : 3);
    for (const selector of [
      ".prompt-suggestions button",
      ".template-tabs button",
    ]) {
      for (const item of await page.locator(selector).all())
        expect(
          (await item.boundingBox())!.height,
          selector,
        ).toBeGreaterThanOrEqual(44);
    }
    await page.screenshot({
      path: `.artifacts/responsive-${size.name}-hero.png`,
    });
    await page
      .locator(".pricing-section")
      .screenshot({ path: `.artifacts/responsive-${size.name}-pricing.png` });
    await expect(page.locator("#pricing .pricing-card")).toHaveCount(3);
    await page
      .getByRole("button", { name: "Apakah saya harus bisa coding?" })
      .click();
    await expect(
      page.getByRole("button", { name: "Apakah saya harus bisa coding?" }),
    ).toHaveAttribute("aria-expanded", "true");
    if ([320, 834, 1440].includes(size.width)) {
      await page.locator(".templates-section").screenshot({
        path: `.artifacts/responsive-${size.name}-templates.png`,
      });
      await page.locator(".features-section").screenshot({
        path: `.artifacts/responsive-${size.name}-features.png`,
      });
      const results = await new AxeBuilder({ page })
        .include(".landing")
        .analyze();
      expect(
        results.violations.map((v) => ({
          id: v.id,
          nodes: v.nodes.map((n) => ({
            target: n.target,
            summary: n.failureSummary,
          })),
        })),
      ).toEqual([]);
    }
    await page
      .locator(".template-tabs")
      .getByRole("tab", { name: "Dashboard", exact: true })
      .click();
    await expect(page.locator(".template-card")).toHaveCount(1);
    await page.locator(".template-card").click();
    await expect(page.locator("#hero-prompt")).not.toHaveValue("");
    await page
      .getByRole("button", { name: "Kirim ide dan buat project" })
      .click();
    await expect(page).toHaveURL(/\/login$/);
  });
}
test("responsive landing: long admin content wraps and orientation changes preserve prompt", async ({
  page,
}) => {
  await page.route("**/api/public/site", (r) =>
    r.fulfill({
      json: {
        configured: true,
        settings: {
          hero_title:
            "Bangun aplikasi untuk kebutuhan bisnis dan komunitas di seluruh Indonesia",
          hero_subtitle: "Satu ruang untuk ide, kolaborasi, dan aplikasi Anda.",
        },
        broadcasts: [],
      },
    }),
  );
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto("/");
  await expect(page.locator(".hero-content h1")).toContainText("komunitas");
  await page
    .locator("#hero-prompt")
    .fill("Ide yang tetap tersimpan saat layar diputar");
  await page.setViewportSize({ width: 844, height: 390 });
  await expect(page.locator("#hero-prompt")).toHaveValue(
    "Ide yang tetap tersimpan saat layar diputar",
  );
  await page.getByRole("button", { name: "Buka menu", exact: true }).click();
  await page.getByRole("button", { name: "Solusi", exact: true }).click();
  const menu = page.locator("#landing-navigation");
  const box = await menu.boundingBox();
  expect(box!.y + box!.height).toBeLessThanOrEqual(390);
  await menu.getByRole("link", { name: "Harga", exact: true }).click();
  await expect(page).toHaveURL(/#pricing$/);
  await page.setViewportSize({ width: 320, height: 740 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(320);
});
