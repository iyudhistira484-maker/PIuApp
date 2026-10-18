import { realAccountFixture, loginRealFixture } from "./helpers-real";
import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

// The browser speaks to a fixture provider, so this covers the client half of
// the ops contract: what the chat shows for applied and refused batches, and
// that the report survives a reload. Applying a batch to a saved scene is
// covered by tests/ai-ops.test.ts and tests/ai-ops-api.test.ts.
const applied = {
  version: 1,
  applied: [
    {
      kind: "scene.transform",
      target: "obj-atap",
      id: "obj-atap",
      name: "Atap",
      changes: ["geser [2,0,0]", "warna #2857aa"],
    },
    {
      kind: "scene.transform",
      target: "Rumah",
      id: "obj-rumah",
      name: "Rumah",
      changes: ["skala [2,2,2] (1 turunan)"],
    },
  ],
  rejected: [],
  sceneChanged: true,
  note: "2 operasi diterapkan pada scene.roblox.json. Tinjau sebelum dipakai.",
};
const refused = {
  version: 1,
  applied: [],
  rejected: [
    {
      kind: "scene.transform",
      target: "Pohon",
      reason: 'Objek "Pohon" tidak ditemukan',
    },
  ],
  sceneChanged: false,
  note: "Ada operasi yang tidak dapat diterapkan, jadi tidak ada perubahan diterapkan (batch bersifat semua-atau-tidak).",
};

async function fixture(page: Page) {
  await realAccountFixture(page);
  await page.route("**/api/projects/*/ai", async (r) => {
    const prompt = r.request().postDataJSON().prompt as string;
    const result: any = {
      content: "Respons API pengujian diterima.",
      creditsUsed: 3,
    };
    if (/atap/i.test(prompt)) {
      result.content = "Atap digeser dan model diperbesar dua kali.";
      result.ops = applied;
    } else if (/pohon/i.test(prompt)) {
      result.content = "Saya tidak menemukan pohon di scene ini.";
      result.ops = refused;
    }
    return r.fulfill({
      contentType: "text/event-stream",
      body: `data: ${JSON.stringify({ type: "result", result })}\n\n`,
    });
  });
}

async function openProject(page: Page) {
  await fixture(page);
  await page.goto("/");
  await page
    .getByPlaceholder("Minta PiwuApp membuat aplikasi tentang…")
    .fill("Buat website studio desain");
  await page
    .getByRole("button", { name: "Kirim ide dan buat project" })
    .click();
  await loginRealFixture(page);
  // The queued landing prompt is sent automatically. Wait for that turn to end
  // and for the project to report a synced state, otherwise a follow-up is
  // refused while the composer is busy or the sync is still running.
  await expect(page.getByText("Respons API pengujian diterima.")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Hentikan respons" }),
  ).toHaveCount(0);
  await expect(
    page
      .getByRole("button", { name: "Penyimpanan: Tersinkron ke cloud" })
      .first(),
  ).toBeVisible();
}

test("chat reports an applied scene batch and keeps the report after reload", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await openProject(page);
  await page.getByLabel("Pesan untuk AI").fill("Geser atap dua stud ke kanan");
  await page.getByRole("button", { name: "Kirim pesan" }).click();
  const report = page.locator(".ai-ops-list").last();
  await expect(report.locator(".ops-headline")).toHaveText(
    "Scene diperbarui · 2 operasi",
  );
  await expect(report).toContainText("Atap");
  await expect(report).toContainText("geser [2,0,0] · warna #2857aa");
  await expect(report).toContainText("skala [2,2,2] (1 turunan)");
  await expect(report).toContainText("Tinjau sebelum dipakai");
  // An applied batch is not coloured as a warning.
  await expect(report.locator(".ops-headline")).not.toHaveClass(/warn/);
  await page.reload();
  await expect(
    page.locator(".ai-ops-list").last().locator(".ops-headline"),
  ).toHaveText("Scene diperbarui · 2 operasi");
  expect(errors).toEqual([]);
});

test("chat shows a refused batch as refused, with the server's reason", async ({
  page,
}) => {
  await openProject(page);
  await page.getByLabel("Pesan untuk AI").fill("Perbesar pohon di depan rumah");
  await page.getByRole("button", { name: "Kirim pesan" }).click();
  const report = page.locator(".ai-ops-list").last();
  await expect(report.locator(".ops-headline")).toHaveText(
    "Tidak ada perubahan scene · 1 operasi ditolak",
  );
  await expect(report.locator(".ops-headline")).toHaveClass(/warn/);
  await expect(report.locator("p.rejected")).toContainText(
    'Objek "Pohon" tidak ditemukan',
  );
  await expect(report).toContainText("semua-atau-tidak");
  // A refused batch must not look like an applied change.
  await expect(page.locator(".ai-file-list")).toHaveCount(0);
});
