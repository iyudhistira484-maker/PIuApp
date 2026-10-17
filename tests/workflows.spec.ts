import { realAccountFixture, loginRealFixture } from "./helpers-real";
import { test, expect } from "@playwright/test";
test.beforeEach(async ({ page }) => {
  await realAccountFixture(page);
});
test("landing → prompt → authenticated API → workspace → AI review → restore → export", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Bangun aplikasi",
  );
  await page
    .getByPlaceholder("Minta PiwuApp membuat aplikasi tentang…")
    .fill("Buat website studio desain");
  await page
    .getByRole("button", { name: "Kirim ide dan buat project" })
    .click();
  await expect(page).toHaveURL(/\/login/);
  await loginRealFixture(page);
  await expect(page).toHaveURL(/\/project\//);
  const preview = page.frameLocator(
    'iframe[title="Live preview aplikasi Anda"]',
  );
  await expect(preview.locator("h1")).toContainText("Ruang yang baik");
  await expect(
    page.getByRole("button", { name: "Hentikan respons" }),
  ).toHaveCount(0, { timeout: 20000 });
  await expect(
    page.getByText("Respons API pengujian diterima.", { exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("button", { name: "Penyimpanan: Tersinkron ke cloud" })
      .first(),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Ubah warna jadi biru", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Terima semua", exact: true })
    .click({ timeout: 30000 });
  await expect(preview.locator("body")).toHaveCSS("color", "rgb(40, 87, 170)");
  await page.getByRole("button", { name: "Riwayat", exact: true }).click();
  await page
    .getByRole("button", { name: "Pulihkan", exact: true })
    .first()
    .click();
  await expect(preview.locator("body")).toHaveCSS("color", "rgb(25, 59, 50)");
  await page.getByRole("button", { name: "Export ZIP", exact: true }).click();
  await expect(
    page.getByText(/tidak menghosting website atau memasang domain/),
  ).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Unduh kode ZIP" }).click();
  expect((await download).suggestedFilename()).toMatch(/\.zip$/);
  await page.getByRole("button", { name: "Tutup", exact: true }).click();
  await page.getByRole("button", { name: "Code", exact: true }).click();
  await expect(page.locator(".monaco-editor")).toBeVisible({ timeout: 30000 });
  expect(errors).toEqual([]);
});
test("dashboard CRUD, search and persistence", async ({ page }) => {
  await page.goto("/login");
  await loginRealFixture(page);
  await page
    .getByRole("button", { name: "Buat project pertama", exact: true })
    .click();
  await page
    .getByPlaceholder("Buat website portfolio untuk studio desain saya…")
    .fill("Project Alpha");
  await page.getByRole("button", { name: "Buat project", exact: true }).click();
  await expect(page).toHaveURL(/\/project\//);
  await page.getByRole("link", { name: "Kembali ke dashboard" }).click();
  await page.getByRole("button", { name: "Menu Project Alpha" }).click();
  await page.getByRole("button", { name: "Ganti nama", exact: true }).click();
  await page.getByLabel("Nama project", { exact: true }).fill("Studio Baru");
  await page.getByRole("button", { name: "Simpan perubahan" }).click();
  await page.getByRole("button", { name: "Menu Studio Baru" }).click();
  await page.getByRole("button", { name: "Duplikasi", exact: true }).click();
  await expect(page.locator(".project-card")).toHaveCount(2);
  await page
    .getByLabel("Cari project", { exact: true })
    .fill("tidak ditemukan");
  await expect(page.getByText("Tidak ada project yang cocok")).toBeVisible();
  await page.getByLabel("Cari project", { exact: true }).fill("");
  await page.reload();
  await expect(page.locator(".project-card")).toHaveCount(2);
  await page
    .getByRole("button", { name: "Menu Studio Baru (salinan)", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Hapus project", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Hapus project", exact: true })
    .click();
  await expect(page.locator(".project-card")).toHaveCount(1);
});
test("Plan and Ask do not modify project files", async ({ page }) => {
  await page.goto("/login");
  await loginRealFixture(page);
  await page.getByRole("button", { name: "Buat project pertama" }).click();
  await page
    .getByPlaceholder("Buat website portfolio untuk studio desain saya…")
    .fill("Rencana project");
  await page.getByRole("button", { name: "Buat project", exact: true }).click();
  await page.waitForSelector(".chat-composer");
  await expect(
    page.getByRole("button", { name: "Hentikan respons" }),
  ).toHaveCount(0, { timeout: 20000 });
  const files = () =>
    page.evaluate(() => {
      const caches = JSON.parse(localStorage.getItem("piwuapp-local-v1")!).state
        .workspaces;
      return Object.entries(caches).find(([key]) =>
        key.startsWith("account:"),
      )![1].projects[0].files;
    });
  await expect(
    page.getByText("Respons API pengujian diterima.", { exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("button", { name: "Penyimpanan: Tersinkron ke cloud" })
      .first(),
  ).toBeVisible();
  const before = await files();
  await page.getByLabel("Mode kerja", { exact: true }).selectOption("Plan");
  await page.getByLabel("Pesan untuk AI").fill("Buat rencana toko buku");
  await page.getByRole("button", { name: "Kirim pesan", exact: true }).click();
  await expect(page.locator(".plan-panel")).toBeVisible({ timeout: 15000 });
  expect(await files()).toEqual(before);
  await expect(
    page
      .getByRole("button", { name: "Penyimpanan: Tersinkron ke cloud" })
      .first(),
  ).toBeVisible();
  await page.getByLabel("Mode kerja", { exact: true }).selectOption("Ask");
  await page.getByLabel("Pesan untuk AI").fill("Jelaskan struktur project");
  await page.getByRole("button", { name: "Kirim pesan", exact: true }).click();
  await expect(
    page.getByText("Jawaban provider pengujian tentang struktur project.", {
      exact: false,
    }),
  ).toBeVisible({ timeout: 15000 });
  expect(await files()).toEqual(before);
});
test("mobile landing has no overflow and menus work", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    390,
  );
  await page.getByRole("button", { name: "Buka menu", exact: true }).click();
  await expect(
    page.getByRole("link", { name: "Harga", exact: true }).first(),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Apakah saya harus bisa coding?" })
    .click();
  await expect(
    page.getByText(
      "Tidak harus. Mulai dari deskripsi sederhana atau template.",
      { exact: false },
    ),
  ).toBeVisible();
});
test("visual editing and keyboard focus mode (cloud datasets covered separately)", async ({
  page,
}) => {
  await page.goto("/login");
  await loginRealFixture(page);
  await page.getByRole("button", { name: "Buat project pertama" }).click();
  await page
    .getByPlaceholder("Buat website portfolio untuk studio desain saya…")
    .fill("Studio Interaktif");
  await page.getByRole("button", { name: "Buat project", exact: true }).click();
  await page.waitForSelector('iframe[title="Live preview aplikasi Anda"]');
  await page.getByRole("button", { name: "Design", exact: true }).click();
  const preview = page.frameLocator(
    'iframe[title="Live preview aplikasi Anda"]',
  );
  await preview.locator("h1").click();
  await expect(page.getByText("Properti elemen")).toBeVisible();
  await page.getByLabel("Ukuran font (px)").fill("32");
  await page.getByRole("button", { name: "Terapkan ke kode" }).click();
  await expect(preview.locator("h1")).toHaveCSS("font-size", "32px");
  await page.keyboard.press("Control+.");
  await expect(page.locator(".workspace")).toHaveClass(/is-focused/);
  await page.keyboard.press("Control+.");
  await expect(page.locator(".icon-rail")).toBeVisible();
});
