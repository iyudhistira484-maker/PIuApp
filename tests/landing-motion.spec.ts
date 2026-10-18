import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/public/site", (r) =>
    r.fulfill({ json: { configured: false, settings: {}, broadcasts: [] } }),
  );
});

const opacityOf = (page: import("@playwright/test").Page, selector: string) =>
  page
    .locator(selector)
    .first()
    .evaluate((el) => Number(getComputedStyle(el).opacity));

const hiddenRevealBlocks = (page: import("@playwright/test").Page) =>
  page.evaluate(() =>
    Array.from(
      document.querySelectorAll(
        ".landing [data-reveal], .landing [data-stagger] > *",
      ),
    )
      .filter((el) => Number(getComputedStyle(el).opacity) < 0.99)
      .map((el) => (el as HTMLElement).className || el.tagName),
  );

test("landing motion: blocks reveal while scrolling and none stay hidden", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("html")).toHaveClass(/js-reveal/);
  // The page is long enough that the closing sections start hidden.
  expect((await hiddenRevealBlocks(page)).length).toBeGreaterThan(0);
  const height = await page.evaluate(() => document.body.scrollHeight);
  for (let y = 0; y <= height; y += 420) {
    await page.evaluate((top) => window.scrollTo(0, top), y);
    await page.waitForTimeout(90);
  }
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(2200);
  expect(await hiddenRevealBlocks(page)).toEqual([]);
  // Settled blocks hand their transform back to later hover states.
  await expect
    .poll(() =>
      page
        .locator(".pricing-card")
        .first()
        .evaluate((el) => el.getAnimations().length),
    )
    .toBe(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("landing motion: reduced motion shows the finished page at once", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  expect(await opacityOf(page, ".hero-content h1")).toBe(1);
  expect(await hiddenRevealBlocks(page)).toEqual([]);
  await expect(page.locator(".landing-progress")).toBeHidden();
});

test("landing motion: the hero spotlight and progress bar track input", async ({
  page,
}) => {
  await page.goto("/");
  await page.waitForTimeout(1400);
  await page.mouse.move(1200, 420);
  const spotlight = await page
    .locator(".hero-section")
    .evaluate((el) => el.style.getPropertyValue("--spot-x"));
  expect(Number.parseFloat(spotlight)).toBeGreaterThan(50);
  await page.evaluate(() => window.scrollTo(0, 600));
  await expect
    .poll(() =>
      page
        .locator(".landing-progress")
        .evaluate((el) =>
          Number.parseFloat(el.style.getPropertyValue("--landing-progress")),
        ),
    )
    .toBeGreaterThan(0);
});

test("landing pricing: only the 30-day price the checkout can charge", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator("#pricing").scrollIntoViewIfNeeded();
  const cards = page.locator("#pricing .pricing-card");
  await expect(cards).toHaveCount(3);
  await expect(cards.nth(1).locator(".price-value")).toHaveText("199.000");
  await expect(cards.nth(2).locator(".price-value")).toHaveText("499.000");
  // There is no annual product in the store, so the cards do not offer one.
  await expect(page.getByRole("button", { name: /Tahunan/ })).toHaveCount(0);
  await expect(page.locator(".billing-toggle")).toHaveCount(0);
  // What each plan includes is written from the same ladder as the price.
  await expect(cards.nth(1)).toContainText("30 kredit/hari");
  await expect(cards.nth(2)).toContainText("40 kredit/hari");
  await expect(cards.nth(2)).toContainText("Rp 111/kredit");
});

test("landing motion: content stays visible when the reveal layer is absent", async ({
  page,
}) => {
  await page.goto("/");
  // Hiding blocks is keyed to the class the controller adds, so a page that
  // never gets it (scripting blocked, an error before the effect runs) renders
  // its final state instead of an empty one.
  await page.evaluate(() =>
    document.documentElement.classList.remove("js-reveal"),
  );
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.locator(".template-card")).toHaveCount(4);
  expect(await opacityOf(page, ".template-grid")).toBe(1);
  expect(await opacityOf(page, ".footer-bottom")).toBe(1);
});
