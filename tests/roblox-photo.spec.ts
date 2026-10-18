import { realAccountFixture, loginRealFixture } from "./helpers-real";
import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

// The client half of "3D model from a photo": the composer carries a photo (and
// a brief beside it), the request really sends both, and the chat shows what the
// SERVER built — which photo, how much geometry, and which parts — instead of a
// claim that a model was magicked out of an image. Building the geometry itself
// is covered by tests/lowpoly.test.ts, tests/ai-ops.test.ts and
// tests/ai-ops-api.test.ts.
const buildReport = {
  version: 1,
  applied: [
    {
      kind: "scene.build",
      target: "Kursi kayu",
      id: "ai-kursi-kayu",
      name: "Kursi kayu",
      photo: 1,
      asMesh: true,
      parts: [],
      geometry: { vertices: 32, faces: 52 },
      groups: 2,
      colorGroups: [
        { color: "#7a4a22", faces: 40 },
        { color: "#b98a4b", faces: 12 },
      ],
      changes: [
        "dari foto 1",
        "ukurannya ≈ 3.4 × 4 × 3 stud",
        "2 block · 1 mesh",
        "1 mesh gabungan: 32 vertex, 52 face",
        "satu mesh hanya punya satu warna, jadi dipakai #8b5a2b (warna bagian pertama)",
      ],
    },
  ],
  rejected: [],
  sceneChanged: true,
  note: "1 operasi diterapkan pada scene.roblox.json. Tinjau sebelum dipakai.",
};

const partReport = {
  version: 1,
  applied: [
    {
      kind: "scene.build",
      target: "Meja makan",
      id: "ai-meja-makan",
      name: "Meja makan",
      photo: 1,
      asMesh: false,
      parts: [
        { name: "Atas", kind: "block", shape: "box" },
        {
          name: "Kaki",
          kind: "mesh",
          shape: "cylinder",
          vertices: 16,
          faces: 28,
        },
      ],
      geometry: { vertices: 16, faces: 28 },
      changes: ["dari foto 1", "2 bagian", "1 mesh: 16 vertex, 28 face"],
    },
  ],
  rejected: [],
  sceneChanged: true,
  note: "1 operasi diterapkan pada scene.roblox.json. Tinjau sebelum dipakai.",
};

const photo = {
  name: "kursi-depan.png",
  mimeType: "image/png",
  buffer: Buffer.from(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4" +
      "890000000a49444154789c6300010000050001",
    "hex",
  ),
};

async function robloxProject(page: Page) {
  const sent: any[] = [];
  // AI must be configured, otherwise the composer refuses to send at all.
  const fixture = await realAccountFixture(page);
  await page.route("**/api/projects/*/ai", async (r) => {
    const body = r.request().postDataJSON();
    sent.push(body);
    const prompt = String(body.prompt || "");
    const result: any = {
      content: "Modelnya sudah saya susun dari foto yang Anda lampirkan.",
      creditsUsed: 3,
    };
    if (/meja/i.test(prompt)) result.ops = partReport;
    else result.ops = buildReport;
    return r.fulfill({
      contentType: "text/event-stream",
      body: `data: ${JSON.stringify({ type: "result", result })}\n\n`,
    });
  });
  await loginRealFixture(page);
  await page
    .getByRole("button", { name: "Buat project pertama", exact: true })
    .click();
  await page.getByRole("radio", { name: /Roblox Game/ }).check();
  await page.getByPlaceholder("Buat game Roblox tentang…").fill("Pulau obby");
  await page.getByRole("button", { name: "Buat project", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Roblox 3D Builder" }),
  ).toBeVisible();
  // The workspace saves before the first AI turn; the composer refuses a
  // follow-up while that is still running.
  await expect(
    page
      .getByRole("button", { name: "Penyimpanan: Tersinkron ke cloud" })
      .first(),
  ).toBeVisible();
  return { fixture, sent };
}

// A Roblox project has its own file input for OBJ import, so the composer's own
// picker is addressed through the chat panel.
const composerFileInput = (page: Page) =>
  page.getByRole("complementary").locator('input[type="file"]');

async function send(page: Page, text: string) {
  await expect(
    page
      .getByRole("button", { name: "Penyimpanan: Tersinkron ke cloud" })
      .first(),
  ).toBeVisible();
  await page.getByLabel("Pesan untuk AI").fill(text);
  await page.getByRole("button", { name: "Kirim pesan" }).click();
  await expect(
    page.getByRole("button", { name: "Hentikan respons" }),
  ).toHaveCount(0);
}

test("a photo and a brief travel together, numbered so the AI can cite the photo", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const { sent } = await robloxProject(page);
  // The picker takes several files at once: a photo of the object and the text
  // brief that describes it.
  await composerFileInput(page).setInputFiles([
    photo,
    {
      name: "brief.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("kursi kayu, empat kaki, tinggi 3 stud"),
    },
  ]);
  const chips = page.locator(".context-chip");
  await expect(chips).toHaveCount(2);
  // Photos are numbered, and only photos: the brief is labelled as a file.
  await expect(chips.nth(0)).toContainText("foto 1");
  await expect(chips.nth(0)).toContainText("kursi-depan.png");
  await expect(chips.nth(1)).toContainText("berkas");
  await expect(chips.nth(1)).toContainText("brief.txt");
  // The composer says plainly what a photo is used for in a Roblox Builder turn.
  await expect(page.locator(".context-hint")).toContainText(
    "bukan menjiplak tekstur foto",
  );
  // A chip can be removed, and the list shrinks with it.
  await chips
    .nth(1)
    .getByRole("button", { name: /Hapus lampiran/ })
    .click();
  await expect(chips).toHaveCount(1);

  await send(page, "Buatkan model 3D kursi dari foto ini");
  // The photo really travelled to the server — and only the photo: the brief was
  // removed from the list before sending.
  const withPhoto = sent.find((b) => (b.attachments || []).length);
  expect(withPhoto.attachments.map((a: any) => a.mime)).toEqual(["image/png"]);
  expect(withPhoto.attachments[0].name).toBe("kursi-depan.png");
  // The photo travels as data the provider can read, not as a filename.
  expect(withPhoto.attachments[0].data.length).toBeGreaterThan(20);
  // The browser also reads the photo's pixels into a colour grid, one slot per
  // photo: this fixture is a single transparent pixel, so every cell is black —
  // the point is that a real grid was sampled here rather than something made up
  // on the server. Reading a grid's colours is pinned in
  // tests/photo-palette.test.ts.
  expect(withPhoto.photoPalettes).toHaveLength(1);
  expect(withPhoto.photoPalettes[0].columns).toBe(16);
  expect(withPhoto.photoPalettes[0].rows).toBe(16);
  expect(withPhoto.photoPalettes[0].colors).toHaveLength(256);
  expect(
    withPhoto.photoPalettes[0].colors.every((c: string) => c === "#000000"),
  ).toBe(true);
  // The composer is cleared after a successful turn.
  await expect(page.locator(".context-chip")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("the chat reports the model the server built from the photo, and keeps it after reload", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await robloxProject(page);
  await composerFileInput(page).setInputFiles([photo]);
  await send(page, "Buatkan model 3D kursi dari foto ini");
  const report = page.locator(".ai-ops-list").last();
  await expect(report.locator(".ops-headline")).toHaveText(
    "Scene diperbarui · 1 operasi",
  );
  await expect(report).toContainText("Kursi kayu");
  // Which photo, how much geometry, and the one-colour limit of a merged mesh.
  await expect(report).toContainText(
    "Geometri dibuat server dari foto 1 · 32 vertex, 52 face",
  );
  await expect(report).toContainText("satu mesh gabungan, bisa diekspor OBJ");
  await expect(report).toContainText("satu warna");
  await expect(report).toContainText("ukurannya ≈ 3.4 × 4 × 3 stud");
  // The colours sampled from the photo are shown, not just counted: two
  // swatches in the photo's colours, and the label says where they came from.
  const colors = report.locator(".ops-colors");
  await expect(colors).toContainText("2 warna dari piksel foto 1");
  await expect(colors.locator("i")).toHaveCount(2);
  await expect(colors.locator("i").first()).toHaveCSS(
    "background-color",
    "rgb(122, 74, 34)",
  );
  // A screen reader gets the same information as the swatches.
  await expect(report.locator(".ops-colors")).toHaveAttribute(
    "aria-label",
    /#7a4a22 untuk 40 sisi/,
  );
  await page.reload();
  await expect(page.locator(".ai-ops-list").last()).toContainText(
    "Geometri dibuat server dari foto 1",
  );
  expect(errors).toEqual([]);
});

test("a model built from several shapes lists every part the server really made", async ({
  page,
}) => {
  await robloxProject(page);
  await composerFileInput(page).setInputFiles([photo]);
  await send(page, "Bikin meja makan dari foto ini");
  const report = page.locator(".ai-ops-list").last();
  await expect(report).toContainText("Meja makan");
  // A Part stays a Part; the shape with no Part equivalent is named as a mesh.
  const rows = report.locator(".ops-build li");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText("Atas");
  await expect(rows.nth(0)).toContainText("box → block");
  await expect(rows.nth(1)).toContainText("Kaki");
  await expect(rows.nth(1)).toContainText("mesh cylinder · 16 vertex");
});
