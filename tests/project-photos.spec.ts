import { realAccountFixture, loginRealFixture } from "./helpers-real";
import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { deflateSync } from "node:zlib";

// Photos kept with the project. Attaching a photo used to be a one-shot: it
// travelled with the message and then vanished, so the model could never be
// held against the picture it came from. This spec pins the whole loop in a real
// browser against real IndexedDB: keep the photo, survive a reload, use it again
// with the same sampled colours, and delete it. What the store refuses, and the
// caps, are pinned in tests/photo-assets.test.ts.

/**
 * A real PNG with real colours — half red, half blue, 8×8. Written by hand
 * (zlib + CRC) so the browser decodes an actual image and the panel shows the
 * colours that are really in the file, not a 1-pixel transparent stand-in.
 */
function pngHalfRedBlue(size = 8) {
  const raw: number[] = [];
  for (let y = 0; y < size; y++) {
    raw.push(0); // filter: none
    for (let x = 0; x < size; x++)
      raw.push(...(x < size / 2 ? [200, 32, 32, 255] : [32, 64, 192, 255]));
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buffer: Buffer) => {
    let c = 0xffffffff;
    for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, body: Buffer) => {
    const head = Buffer.alloc(4);
    head.writeUInt32BE(body.length);
    const typed = Buffer.concat([Buffer.from(type, "ascii"), body]);
    const tail = Buffer.alloc(4);
    tail.writeUInt32BE(crc(typed));
    return Buffer.concat([head, typed, tail]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // truecolour with alpha
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.from(raw))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const photo = {
  name: "kursi-depan.png",
  mimeType: "image/png",
  buffer: pngHalfRedBlue(),
};

async function robloxProject(page: Page) {
  const sent: any[] = [];
  await realAccountFixture(page);
  await page.route("**/api/projects/*/ai", async (r) => {
    sent.push(r.request().postDataJSON());
    return r.fulfill({
      contentType: "text/event-stream",
      body: `data: ${JSON.stringify({
        type: "result",
        result: {
          content: "Modelnya sudah saya susun dari foto yang Anda lampirkan.",
          creditsUsed: 3,
        },
      })}\n\n`,
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
  await expect(
    page
      .getByRole("button", { name: "Penyimpanan: Tersinkron ke cloud" })
      .first(),
  ).toBeVisible();
  return { sent };
}

const composerFileInput = (page: Page) =>
  page.getByRole("complementary").locator('input[type="file"]');

async function send(page: Page, text: string) {
  await page.getByLabel("Pesan untuk AI").fill(text);
  await page.getByRole("button", { name: "Kirim pesan" }).click();
  await expect(
    page.getByRole("button", { name: "Hentikan respons" }),
  ).toHaveCount(0);
}

const photosPanel = (page: Page) => page.locator(".project-photos");

test("a photo used in a turn is kept with the project and survives a reload", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await robloxProject(page);
  await expect(photosPanel(page)).toHaveCount(0);
  await composerFileInput(page).setInputFiles([photo]);
  await send(page, "Buatkan model 3D kursi dari foto ini");
  // The photo is kept once the turn succeeded, and the panel says where it lives
  // instead of implying it followed the project to the cloud.
  await expect(photosPanel(page)).toBeVisible();
  await expect(photosPanel(page)).toContainText("Foto project");
  await expect(photosPanel(page)).toContainText(
    "Tersimpan di browser ini untuk project ini",
  );
  await expect(photosPanel(page)).toContainText("kursi-depan.png");
  // The list shows a redraw of the photo, and the colours the sampler read.
  await expect(photosPanel(page).locator(".photo-thumb img")).toHaveCount(1);
  await expect(photosPanel(page)).toContainText("sel warna");
  await page.reload();
  await expect(photosPanel(page)).toBeVisible();
  await expect(photosPanel(page)).toContainText("kursi-depan.png");
  expect(errors).toEqual([]);
});

test("the stored photo can be used again, with the colours read from it", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const { sent } = await robloxProject(page);
  await composerFileInput(page).setInputFiles([photo]);
  await send(page, "Buatkan model 3D kursi dari foto ini");
  await expect(photosPanel(page)).toContainText("kursi-depan.png");
  // The composer is empty again: the photo came from the project store this time.
  await expect(page.locator(".context-chip")).toHaveCount(0);
  await photosPanel(page)
    .getByRole("button", { name: /Pakai lagi foto kursi-depan\.png/ })
    .click();
  await expect(page.locator(".context-chip")).toHaveCount(1);
  await expect(page.locator(".context-chip")).toContainText("kursi-depan.png");
  await send(page, "Perbaiki sandarannya dari foto yang sama");
  // The photo really travelled again, and the sampled grid went with it — the
  // colours still come from the user's own pixels, not from a stored guess.
  const last = sent.at(-1);
  expect(last.attachments.map((a: any) => a.name)).toEqual(["kursi-depan.png"]);
  expect(last.photoPalettes).toHaveLength(1);
  expect(last.photoPalettes[0].columns).toBe(16);
  // Half red, half blue: the grid holds both colours, and only those.
  const colors = new Set(
    last.photoPalettes[0].colors.map((c: string) => c.slice(0, 3)),
  );
  expect([...colors].sort()).toEqual(["#20", "#c8"]);
  expect(errors).toEqual([]);
});

test("the large view names where the photo lives and what its colours are", async ({
  page,
}) => {
  await robloxProject(page);
  await composerFileInput(page).setInputFiles([
    photo,
    {
      name: "brief.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("kursi kayu, empat kaki"),
    },
  ]);
  await send(page, "Buatkan model 3D kursi dari foto ini");
  // Only photos are kept: a text brief has no pixels to sample.
  await expect(photosPanel(page)).toContainText("kursi-depan.png");
  await expect(photosPanel(page)).not.toContainText("brief.txt");
  await photosPanel(page)
    .getByRole("button", { name: /Buka foto kursi-depan\.png/ })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Foto project · kursi-depan.png");
  await expect(dialog).toContainText("bukan di cloud");
  await expect(dialog).toContainText("bukan peta tekstur UV");
  // The panel reports the facts it has: size, type, and when it arrived.
  await expect(dialog).toContainText("Ukuran");
  await expect(dialog).toContainText("image/png");
  await expect(dialog).toContainText("Ditambahkan");
  await expect(dialog.locator("img")).toBeVisible();
  // The colour grid is shown as it was read: 256 cells in two colours.
  const cells = dialog.locator(".photo-view-colors i");
  await expect(cells).toHaveCount(256);
  await expect(dialog.locator(".photo-view-colors")).toContainText("16×16 sel");
});

test("deleting a photo asset removes it from this browser for good", async ({
  page,
}) => {
  await robloxProject(page);
  await composerFileInput(page).setInputFiles([photo]);
  await send(page, "Buatkan model 3D kursi dari foto ini");
  await expect(photosPanel(page)).toContainText("kursi-depan.png");
  await photosPanel(page)
    .getByRole("button", { name: /Hapus aset foto kursi-depan\.png/ })
    .click();
  await expect(photosPanel(page)).toHaveCount(0);
  await page.reload();
  await expect(photosPanel(page)).toHaveCount(0);
});
