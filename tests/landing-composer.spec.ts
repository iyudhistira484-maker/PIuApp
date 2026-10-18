import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/public/site", (r) =>
    r.fulfill({ json: { configured: false, settings: {}, broadcasts: [] } }),
  );
});

const menu = (page: Page) => page.locator(".hero-prompt .mode-dropdown");

/** Opens the composer menu in the hero and lets the entrance motion settle. */
async function openComposerMenu(page: Page, width: number) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto("/");
  const button = page.locator(".hero-prompt .mode-button");
  await button.scrollIntoViewIfNeeded();
  await button.click();
  await expect(menu(page)).toBeVisible();
  await page.waitForTimeout(700);
  return button;
}

/** Which element actually receives a pointer over the open menu, and why. */
const paintAtMenu = (page: Page) =>
  page.evaluate(() => {
    const node = document.querySelector<HTMLElement>(
      ".hero-prompt .mode-dropdown",
    );
    if (!node) return { missing: true } as const;
    const box = node.getBoundingClientRect();
    const probes = [
      { x: box.left + 18, y: box.top + 10 },
      { x: box.left + box.width / 2, y: box.top + box.height / 2 },
      { x: box.left + box.width / 2, y: box.bottom - 8 },
    ];
    const hero = document
      .querySelector(".hero-section")!
      .getBoundingClientRect();
    return {
      missing: false as const,
      probes,
      all: probes.map(({ x, y }) => {
        const top = document.elementFromPoint(x, y);
        return {
          insideMenu: !!top && node.contains(top),
          top: top?.tagName.toLowerCase() || "none",
        };
      }),
      box: {
        left: box.left,
        right: box.right,
        top: box.top,
        bottom: box.bottom,
      },
      hero: { left: hero.left, right: hero.right, bottom: hero.bottom },
    };
  });

test("hero composer menu paints above the suggestion rows at every width", async ({
  page,
}) => {
  for (const width of [360, 390, 660, 768, 1000, 1440]) {
    await openComposerMenu(page, width);
    const result = await paintAtMenu(page);
    expect(result.missing).toBe(false);
    const paint = (result as any).all as { insideMenu: boolean }[];
    // The rows below the composer (chips and footnote) must never swallow a
    // click meant for the menu, whatever stacking context they create.
    expect(
      paint.map((p) => p.insideMenu),
      `width ${width}`,
    ).toEqual([true, true, true]);
    const { box, hero } = result as any;
    // The hero clips its overflow, so the menu has to fit inside it.
    expect(box.bottom, `width ${width}`).toBeLessThanOrEqual(hero.bottom + 1);
    expect(box.left).toBeGreaterThanOrEqual(hero.left);
    expect(box.right).toBeLessThanOrEqual(hero.right);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
      `width ${width} overflow`,
    ).toBe(true);
    await page.keyboard.press("Escape");
  }
});

test("hero composer menu keeps working with reduced motion", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openComposerMenu(page, 1000);
  const result = await paintAtMenu(page);
  expect((result as any).all).toEqual([
    { insideMenu: true, top: "button" },
    { insideMenu: true, top: "button" },
    { insideMenu: true, top: "button" },
  ]);
});

test("hero composer menu switches mode and leaves the chips clickable", async ({
  page,
}) => {
  await openComposerMenu(page, 1000);
  // Both rows of the menu are reachable by pointer, not just by keyboard.
  await page
    .getByRole("button", { name: "Rencanakan dahulu", exact: true })
    .click();
  await expect(page.locator(".hero-prompt .mode-button")).toHaveText(/Rencana/);
  await expect(menu(page)).toHaveCount(0);
  await page.locator(".hero-prompt .mode-button").click();
  await page
    .getByRole("button", { name: "Bangun aplikasi", exact: true })
    .click();
  await expect(page.locator(".hero-prompt .mode-button")).toHaveText(/Bangun/);
  // Raising the composer above the suggestion row must not block the chips.
  await page
    .getByRole("button", { name: "Website bisnis", exact: true })
    .click();
  await expect(
    page.getByPlaceholder("Minta PiwuApp membuat aplikasi tentang…"),
  ).toHaveValue(/website bisnis/i);
  await page.locator(".hero-prompt .mode-button").click();
  await expect(menu(page)).toBeVisible();
  // Escape closes the menu and returns focus to its trigger.
  await page.keyboard.press("Escape");
  await expect(menu(page)).toHaveCount(0);
  await expect(page.locator(".hero-prompt .mode-button")).toBeFocused();
  // Clicking anywhere outside closes it too.
  await page.locator(".hero-prompt .mode-button").click();
  await expect(menu(page)).toBeVisible();
  await page.getByRole("heading", { level: 1 }).click();
  await expect(menu(page)).toHaveCount(0);
});

test("landing navigation stays above the hero composer", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await openComposerMenu(page, 1280);
  await page
    .getByRole("navigation", { name: "Navigasi utama" })
    .getByRole("button", { name: "Solusi", exact: true })
    .click();
  const popover = page.locator("#landing-solutions");
  await expect(popover).toBeVisible();
  const onTop = await popover.evaluate((node) => {
    const box = node.getBoundingClientRect();
    const top = document.elementFromPoint(
      box.left + box.width / 2,
      box.top + box.height / 2,
    );
    return !!top && node.contains(top);
  });
  expect(onTop).toBe(true);
});
