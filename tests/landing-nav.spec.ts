import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("**/api/public/site", (r) =>
    r.fulfill({ json: { configured: false, settings: {}, broadcasts: [] } }),
  );
  await page.goto("/");
});

test("landing navbar: sticky glass on scroll, clear at top, keyboard dropdown and links", async ({
  page,
}) => {
  const header = page.locator(".landing-header");
  const surface = page.locator(".landing-nav-surface");
  await expect(header).not.toHaveClass(/is-scrolled/);
  await page.screenshot({ path: ".artifacts/navbar-desktop-top.png" });
  await page.evaluate(() => window.scrollTo({ top: 640, behavior: "instant" }));
  await expect(header).toHaveClass(/is-scrolled/);
  expect((await header.boundingBox())!.y).toBe(0);
  await expect(surface).toHaveCSS(
    "backdrop-filter",
    "blur(24px) saturate(1.4)",
  );
  await page.screenshot({ path: ".artifacts/navbar-desktop-scroll.png" });
  const solutions = page.getByRole("button", { name: "Solusi", exact: true });
  await solutions.focus();
  await page.keyboard.press("ArrowDown");
  await expect(solutions).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("#landing-solutions a").first()).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(solutions).toBeFocused();
  await expect(solutions).toHaveAttribute("aria-expanded", "false");
  await solutions.click();
  await page.screenshot({ path: ".artifacts/navbar-desktop-menu.png" });
  const accessibility = await new AxeBuilder({ page })
    .include(".landing-header")
    .analyze();
  expect(accessibility.violations).toEqual([]);
  await page.getByRole("link", { name: /Alat internal & dashboard/ }).click();
  await expect(page).toHaveURL(/#templates$/);
  await expect(solutions).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator(".template-grid")).toBeVisible();
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await expect(header).not.toHaveClass(/is-scrolled/);
  await expect(surface).toHaveCSS("backdrop-filter", "none");
  await page.locator(".landing-nav-cta").click();
  await expect(page).toHaveURL(/\/login$/);
});

test("landing navbar: mobile disclosure fits, Escape and outside close, section navigation", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const nav = page.getByRole("navigation", { name: "Navigasi utama" });
  const toggle = page.getByRole("button", { name: "Buka menu", exact: true });
  await expect(nav).toBeHidden();
  await toggle.click();
  await expect(nav).toBeVisible();
  await page.getByRole("button", { name: "Solusi", exact: true }).click();
  await expect(
    page.getByRole("link", { name: /Toko online & UMKM/ }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: ".artifacts/navbar-mobile-menu.png" });
  expect(
    (await new AxeBuilder({ page }).include(".landing-header").analyze())
      .violations,
  ).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(nav).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(nav).toBeHidden();
  await expect(toggle).toBeFocused();
  await toggle.click();
  await nav.getByRole("link", { name: "Harga", exact: true }).click();
  await expect(page).toHaveURL(/#pricing$/);
  await expect(nav).toBeHidden();
  await expect(page.locator(".landing-header")).toHaveClass(/is-scrolled/);
  await page.screenshot({ path: ".artifacts/navbar-mobile-scroll.png" });
  await toggle.click();
  await page.mouse.click(5, 550);
  await expect(nav).toBeHidden();
  await page.setViewportSize({ width: 320, height: 740 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const cta = await page.locator(".landing-nav-cta").boundingBox();
  const brand = await page.locator(".landing-nav-brand").boundingBox();
  expect(brand!.x + brand!.width).toBeLessThan(cta!.x);
  await page.setViewportSize({ width: 1024, height: 768 });
  await expect(nav).toBeVisible();
  const navBox = await nav.boundingBox();
  expect(navBox!.x + navBox!.width).toBeLessThan(
    (await page.locator(".landing-nav-actions").boundingBox())!.x,
  );
});
