import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
const source = "**/35573-407595474_large.mp4";
test.beforeEach(async ({ page }) => {
  await page.route("**/api/public/site", (r) =>
    r.fulfill({ json: { configured: false, settings: {}, broadcasts: [] } }),
  );
});
test("hero video: native autoplay without controls, muted loop, offscreen pause and resume", async ({
  page,
}) => {
  // Generate a tiny WebM only as a local playback fixture. This is NOT the user's asset.
  await page.goto("/login");
  const bytes = await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 96;
    canvas.height = 64;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#b6d3e5";
    ctx.fillRect(0, 0, 96, 64);
    const stream = canvas.captureStream(10);
    const recorder = new MediaRecorder(stream, {
      mimeType: "video/webm;codecs=vp8",
    });
    const chunks: BlobPart[] = [];
    recorder.ondataavailable = (e) => chunks.push(e.data);
    const result = new Promise<number[]>(
      (resolve) =>
        (recorder.onstop = async () => {
          stream.getTracks().forEach((t) => t.stop());
          resolve(
            Array.from(
              new Uint8Array(
                await new Blob(chunks, { type: "video/webm" }).arrayBuffer(),
              ),
            ),
          );
        }),
    );
    recorder.start();
    let n = 0;
    const timer = setInterval(() => {
      ctx.fillStyle = n % 2 ? "#c9dfe9" : "#b6d3e5";
      ctx.fillRect(0, 0, 96, 64);
      if (++n >= 6) {
        clearInterval(timer);
        recorder.stop();
      }
    }, 100);
    return result;
  });
  await page.route(source, (r) =>
    r.fulfill({ contentType: "video/webm", body: Buffer.from(bytes) }),
  );
  await page.goto("/");
  const video = page.locator(".hero-background-video");
  await expect(video).toHaveAttribute(
    "src",
    "https://cdn.pixabay.com/video/2020/04/09/35573-407595474_large.mp4",
  );
  await expect
    .poll(() =>
      video.evaluate((v: HTMLVideoElement) => !v.paused && v.readyState >= 2),
    )
    .toBe(true);
  await expect(video).toHaveAttribute("loop", "");
  await expect(video).toHaveAttribute("playsinline", "");
  expect(await video.evaluate((v: HTMLVideoElement) => v.muted)).toBe(true);
  await expect(video).toHaveAttribute("autoplay", "");
  expect(await video.evaluate((v: HTMLVideoElement) => v.controls)).toBe(false);
  await expect(
    page.locator(".hero-video-controls, .hero-video-toggle"),
  ).toHaveCount(0);
  await page.locator("footer").last().scrollIntoViewIfNeeded();
  await expect
    .poll(() => video.evaluate((v: HTMLVideoElement) => v.paused))
    .toBe(true);
  await page.getByRole("heading", { level: 1 }).scrollIntoViewIfNeeded();
  await expect
    .poll(() => video.evaluate((v: HTMLVideoElement) => v.paused))
    .toBe(false);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect
    .poll(() => video.evaluate((v: HTMLVideoElement) => v.paused))
    .toBe(true);
  await expect(page.locator(".hero-video-media")).toHaveClass(/has-frame/);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect
    .poll(() => video.evaluate((v: HTMLVideoElement) => v.paused))
    .toBe(false);
});
test("hero video: reduced motion and data saving do not download, content remains accessible", async ({
  page,
}) => {
  const requests: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("35573-407595474")) requests.push(r.url());
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.locator(".hero-video-media")).toBeAttached();
  await expect(
    page.locator(".hero-video-controls, .hero-video-toggle"),
  ).toHaveCount(0);
  await expect(page.locator(".hero-background-video")).toHaveCount(0);
  expect(requests).toEqual([]);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Bangun sesuatu",
  );
  await page.screenshot({
    path: ".artifacts/hero-fallback-desktop.png",
    fullPage: false,
  });
  const result = await new AxeBuilder({ page })
    .include(".hero-section")
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  expect(
    result.violations.map((v) => ({
      id: v.id,
      nodes: v.nodes.map((n) => ({
        target: n.target,
        message: n.failureSummary,
      })),
    })),
  ).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: ".artifacts/hero-fallback-mobile.png",
    fullPage: false,
  });
  await page
    .getByRole("button", { name: "Website bisnis", exact: true })
    .click();
  await expect(
    page.getByPlaceholder("Minta PiwuApp membuat aplikasi tentang…"),
  ).not.toBeEmpty();
  await page.goto("/login");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "connection", {
      configurable: true,
      value: {
        saveData: true,
        addEventListener() {},
        removeEventListener() {},
      },
    }),
  );
  await page.goto("/");
  await expect(page.locator(".hero-video-media")).toBeAttached();
  await expect(
    page.locator(".hero-video-controls, .hero-video-toggle"),
  ).toHaveCount(0);
  await expect(page.locator(".hero-background-video")).toHaveCount(0);
  expect(requests).toEqual([]);
});
test("hero video failure falls back without controls or blocking prompt", async ({
  page,
}) => {
  await page.route(source, (r) => r.abort("failed"));
  await page.goto("/");
  await expect(page.locator(".hero-video-media")).toHaveAttribute(
    "data-video-state",
    "fallback",
  );
  await expect(page.locator(".hero-background-video")).toHaveCount(0);
  await expect(page.locator(".hero-video-fallback")).toBeVisible();
  await expect(
    page.locator(".hero-video-controls, .hero-video-toggle"),
  ).toHaveCount(0);
  await page
    .getByPlaceholder("Minta PiwuApp membuat aplikasi tentang…")
    .fill("Website studio awan");
  await page
    .getByRole("button", { name: "Kirim ide dan buat project" })
    .click();
  await expect(page).toHaveURL(/\/login/);
});
