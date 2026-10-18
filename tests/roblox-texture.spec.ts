import { realAccountFixture, loginRealFixture } from "./helpers-real";
import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { deflateSync, inflateSync } from "node:zlib";

// Exporting a model that arrives in Roblox *textured*. The arithmetic behind the
// UVs and the .glb container is pinned in tests/glb.test.ts; this spec proves the
// whole path in a real browser: a stored project photo is baked into an atlas,
// the atlas is embedded in a downloaded .glb, and the pixels in that atlas are
// the photo's own colours — half red, half blue.

/** A real 96×96 PNG: the left half red, the right half blue. */
function pngHalfRedBlue(size = 96) {
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
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.from(raw))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/**
 * A minimal PNG reader: enough for the atlas the browser encodes (8-bit RGBA,
 * no interlace) so the test can look at real pixels instead of trusting a size.
 */
function decodePNG(bytes: Uint8Array) {
  const buffer = Buffer.from(bytes);
  let at = 8;
  let width = 0;
  let height = 0;
  const idat: Buffer[] = [];
  while (at < buffer.length) {
    const length = buffer.readUInt32BE(at);
    const type = buffer.toString("ascii", at + 4, at + 8);
    const body = buffer.subarray(at + 8, at + 8 + length);
    if (type === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      if (body[8] !== 8 || body[9] !== 6 || body[12] !== 0)
        throw new Error("Atlas bukan PNG 8-bit RGBA tanpa interlace.");
    }
    if (type === "IDAT") idat.push(body);
    at += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const pixels = Buffer.alloc(height * stride);
  const paeth = (a: number, b: number, c: number) => {
    const pa = Math.abs(b - c);
    const pb = Math.abs(a - c);
    const pc = Math.abs(a + b - 2 * c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const left = x >= 4 ? pixels[y * stride + x - 4] : 0;
      const up = y > 0 ? pixels[(y - 1) * stride + x] : 0;
      const upLeft = y > 0 && x >= 4 ? pixels[(y - 1) * stride + x - 4] : 0;
      const value = line[x];
      const out =
        filter === 0
          ? value
          : filter === 1
            ? value + left
            : filter === 2
              ? value + up
              : filter === 3
                ? value + Math.floor((left + up) / 2)
                : value + paeth(left, up, upLeft);
      pixels[y * stride + x] = out & 0xff;
    }
  }
  return {
    width,
    height,
    pixel: (x: number, y: number) => [
      pixels[y * stride + x * 4],
      pixels[y * stride + x * 4 + 1],
      pixels[y * stride + x * 4 + 2],
      pixels[y * stride + x * 4 + 3],
    ],
  };
}

/** Parses the .glb container: header, JSON chunk, BIN chunk. */
function readGLB(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  expect(view.getUint32(0, true)).toBe(0x46546c67);
  expect(view.getUint32(4, true)).toBe(2);
  expect(view.getUint32(8, true)).toBe(bytes.byteLength);
  const jsonLength = view.getUint32(12, true);
  const json = JSON.parse(
    new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)).trim(),
  );
  const binStart = 20 + jsonLength;
  const binLength = view.getUint32(binStart, true);
  return {
    json,
    bin: bytes.subarray(binStart + 8, binStart + 8 + binLength),
  };
}

/** The scene the server would have produced: a mesh whose colours come from the
 * photo's top and bottom halves, each group remembering its area. */
const sceneFile = (photo: number) =>
  JSON.stringify(
    {
      version: 1,
      objects: [
        {
          id: "ai-kursi",
          name: "Kursi",
          kind: "mesh",
          parent: null,
          position: [4, 0, 0],
          rotation: [0, 0, 0],
          size: [1, 1, 1],
          color: "#c82020",
          anchored: true,
          mesh: {
            vertices: [
              [-1, 0, -1],
              [1, 0, -1],
              [1, 1, -1],
              [-1, 1, -1],
              [-1, 0, 1],
              [1, 0, 1],
              [1, 1, 1],
              [-1, 1, 1],
            ],
            faces: [
              [0, 1, 2],
              [0, 2, 3],
              [4, 6, 5],
              [4, 7, 6],
              [0, 4, 5],
              [0, 5, 1],
              [3, 2, 6],
              [3, 6, 7],
              [0, 3, 7],
              [0, 7, 4],
              [1, 5, 6],
              [1, 6, 2],
            ],
            groups: [
              {
                color: "#c82020",
                faces: [0, 1, 2, 3, 4, 5],
                region: [0, 0, 0.5, 1],
              },
              {
                color: "#2040c0",
                faces: [6, 7, 8, 9, 10, 11],
                region: [0.5, 0, 1, 1],
              },
            ],
          },
        },
      ],
      notes: `model dari foto ${photo}`,
    },
    null,
    2,
  );

async function robloxProject(page: Page) {
  const sent: any[] = [];
  await realAccountFixture(page);
  await page.route("**/api/projects/*/ai", async (r) => {
    const body = r.request().postDataJSON();
    sent.push(body);
    const photos = (body.attachments || []).filter((a: any) =>
      String(a.mime || "").startsWith("image/"),
    ).length;
    return r.fulfill({
      contentType: "text/event-stream",
      body: `data: ${JSON.stringify({
        type: "result",
        result: {
          content: "Kursinya saya susun dari foto, warnanya per sisi.",
          creditsUsed: 3,
          files: { "scene.roblox.json": sceneFile(photos || 1) },
          ops: {
            version: 1,
            applied: [
              {
                kind: "scene.build",
                target: "Kursi",
                id: "ai-kursi",
                name: "Kursi",
                photo: 1,
                asMesh: true,
                parts: [],
                geometry: { vertices: 8, faces: 12 },
                colorSource: "photo-faces",
                groups: 2,
                colorGroups: [
                  { color: "#c82020", faces: 6 },
                  { color: "#2040c0", faces: 6 },
                ],
                changes: ["dari foto 1", "1 mesh gabungan: 12 face"],
              },
            ],
            rejected: [],
            sceneChanged: true,
            note: "1 operasi diterapkan pada scene.roblox.json. Tinjau sebelum dipakai.",
          },
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

test("a photo becomes a textured .glb whose atlas really holds the photo", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await robloxProject(page);
  await page
    .getByRole("complementary")
    .locator('input[type="file"]')
    .setInputFiles([
      {
        name: "kursi-depan.png",
        mimeType: "image/png",
        buffer: pngHalfRedBlue(),
      },
    ]);
  await page
    .getByLabel("Pesan untuk AI")
    .fill("Buatkan model 3D kursi dari foto ini");
  await page.getByRole("button", { name: "Kirim pesan" }).click();
  await expect(
    page.getByRole("button", { name: "Hentikan respons" }),
  ).toHaveCount(0);
  // The photo is kept with the project, which is what the atlas is baked from.
  await expect(page.locator(".project-photos")).toContainText(
    "kursi-depan.png",
  );
  // Select the mesh the server built, so its properties panel offers the export.
  const explorer = page.locator(".rb-explorer");
  await explorer.getByRole("button", { name: /Kursi/ }).first().click();
  const panel = page.locator(".rb-properties");
  const exportBox = panel.locator(".rb-glb");
  await expect(exportBox).toBeVisible();
  await expect(exportBox).toContainText(/bukan peta UV/i);
  await expect(exportBox).toContainText("kursi-depan.png");
  const download = page.waitForEvent("download");
  await exportBox.getByRole("button", { name: "Unduh GLB bertesktur" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/\.glb$/);
  const bytes = new Uint8Array(
    await (await import("node:fs/promises")).readFile((await file.path())!),
  );
  const { json, bin } = readGLB(bytes);
  // A real glTF: mesh, UVs, photo colours and one embedded image.
  const primitive = json.meshes[0].primitives[0];
  expect(primitive.attributes.TEXCOORD_0).toBeGreaterThanOrEqual(0);
  expect(primitive.attributes.COLOR_0).toBeGreaterThanOrEqual(0);
  expect(json.accessors[primitive.attributes.POSITION].count).toBe(12 * 3);
  expect(json.images[0].mimeType).toBe("image/png");
  expect(json.materials[0].pbrMetallicRoughness.baseColorTexture.index).toBe(0);
  const view = json.bufferViews[json.images[0].bufferView];
  const atlas = bin.subarray(
    view.byteOffset,
    view.byteOffset + view.byteLength,
  );

  // The atlas is a real PNG inside the .glb, and its pixels are the photo's:
  // patch 1 red (photo's left half), patch 2 blue (its right half).
  const png = decodePNG(atlas);
  expect([png.width, png.height]).toEqual([1024, 1024]);
  // Two colour groups → a 2×2 grid of 512px patches.
  const cell = 512;
  expect(png.pixel(10, 10)).toEqual([200, 32, 32, 255]);
  expect(png.pixel(cell + 10, 10)).toEqual([32, 64, 192, 255]);
  // The UVs point at those very patches: every UV inside the image, and the two
  // groups' corners land in the left and right half respectively.
  const uvView =
    json.bufferViews[
      json.accessors[primitive.attributes.TEXCOORD_0].bufferView
    ];
  const uvs = new Float32Array(
    bin.buffer.slice(
      bin.byteOffset + uvView.byteOffset,
      bin.byteOffset + uvView.byteOffset + uvView.byteLength,
    ),
  );
  for (const value of uvs) expect(value).toBeGreaterThanOrEqual(0);
  for (const value of uvs) expect(value).toBeLessThanOrEqual(1);
  const firstFace = uvs[0];
  const seventhFace = uvs[6 * 2];
  expect(firstFace).toBeLessThan(0.5);
  expect(seventhFace).toBeGreaterThanOrEqual(0.5);
  // The optional Open Cloud upload: this fixture answers 503 for project routes,
  // and the panel has to surface that refusal instead of pretending the mesh
  // reached Roblox.
  await exportBox.getByRole("button", { name: /Unggah ke Roblox/ }).click();
  await expect(exportBox.getByRole("alert")).toContainText(
    "belum dikonfigurasi",
  );
  expect(errors).toEqual([]);
});

test("without a stored photo the export still carries the photo colours, and says so", async ({
  page,
}) => {
  await robloxProject(page);
  // No photo was ever attached: the panel offers the colours-only export and
  // explains why a textured one is not on the table.
  await page.getByLabel("Pesan untuk AI").fill("Buatkan kursi 3D");
  await page.getByRole("button", { name: "Kirim pesan" }).click();
  await expect(
    page.getByRole("button", { name: "Hentikan respons" }),
  ).toHaveCount(0);
  await page
    .locator(".rb-explorer")
    .getByRole("button", { name: /Kursi/ })
    .first()
    .click();
  const exportBox = page.locator(".rb-properties .rb-glb");
  await expect(exportBox).toContainText(
    "Belum ada foto project di browser ini",
  );
  await expect(
    exportBox.getByRole("button", { name: "Unduh GLB bertesktur" }),
  ).toBeDisabled();
  const download = page.waitForEvent("download");
  await exportBox.getByRole("button", { name: "GLB warna saja" }).click();
  const saved = await download;
  const bytes = new Uint8Array(
    await (await import("node:fs/promises")).readFile((await saved.path())!),
  );
  const { json } = readGLB(bytes);
  // Colours travel as vertex colours; there is no texture to point at.
  expect(json.meshes[0].primitives[0].attributes.TEXCOORD_0).toBeUndefined();
  expect(
    json.meshes[0].primitives[0].attributes.COLOR_0,
  ).toBeGreaterThanOrEqual(0);
  expect(json.images).toBeUndefined();
});
