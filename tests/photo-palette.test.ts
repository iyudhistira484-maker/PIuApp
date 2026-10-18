import test from "node:test";
import assert from "node:assert/strict";
import {
  GROUPS_MAX,
  PALETTE_CELLS_MAX,
  cellAt,
  faceGroups,
  isPalette,
  paletteFor,
  regionCells,
  regionColor,
} from "../server/lib/photo-palette.mjs";
import { applySceneOps } from "../server/lib/ai-ops.mjs";
import { shapeMesh } from "../server/lib/lowpoly.mjs";
import { samplePalette } from "../src/lib/photo-palette.ts";
import {
  meshOBJ,
  meshPhotoColors,
  parseOBJ,
  sceneSchema,
} from "../src/lib/roblox/scene.ts";

// Colour read from the attached photo. The photo never becomes a texture — a
// scene file cannot hold one — so what is pinned here is narrower and must stay
// true: the colours come from the photo's own pixels, they are averaged the same
// way every time, and a region that points at nothing is refused instead of
// filled with a plausible-looking guess.

/** Red on top, blue underneath — a region then names a colour unambiguously. */
const splitPalette = { columns: 4, rows: 4, colors: [] as string[] };
for (let row = 0; row < 4; row++)
  for (let column = 0; column < 4; column++)
    splitPalette.colors.push(row < 2 ? "#c02020" : "#2040c0");

const flat = (color: string, columns = 4, rows = 4) => ({
  columns,
  rows,
  colors: Array.from({ length: columns * rows }, () => color),
});

test("a palette is only accepted when every cell is a real colour", () => {
  assert.equal(isPalette(splitPalette), true);
  assert.equal(isPalette(flat("#ffffff", 1, 1)), true);
  assert.equal(isPalette({ columns: 4, rows: 4, colors: [] }), false);
  // One cell short: the grid no longer describes the photo it came from.
  assert.equal(
    isPalette({
      columns: 4,
      rows: 4,
      colors: splitPalette.colors.slice(0, 15),
    }),
    false,
  );
  assert.equal(
    isPalette({
      columns: 4,
      rows: 4,
      colors: ["red", ...splitPalette.colors.slice(1)],
    }),
    false,
  );
  assert.equal(isPalette({ columns: 0, rows: 4, colors: [] }), false);
  assert.equal(
    isPalette({
      columns: 32,
      rows: 32,
      colors: Array.from({ length: 1024 }, () => "#ffffff"),
    }),
    true,
  );
  assert.equal(
    isPalette({
      columns: 40,
      rows: 40,
      colors: Array.from({ length: 1600 }, () => "#ffffff"),
    }),
    false,
  );
  assert.equal(PALETTE_CELLS_MAX, 1024);
  // A grid at the exact limit stays inside it.
  assert.equal(splitPalette.colors.length, 16);
});

test("a palette slot is matched to the photo the model cited, and only if it is one", () => {
  assert.equal(paletteFor([splitPalette], 1), splitPalette);
  assert.equal(paletteFor([splitPalette], 2), null);
  assert.equal(paletteFor([null, splitPalette], 2), splitPalette);
  // A malformed grid is treated as "no sample", never as a reason to invent one.
  assert.equal(paletteFor([{ columns: 4, rows: 4, colors: [] }], 1), null);
});

test("a region is averaged from the photo's cells, and clamped inside the grid", () => {
  const top = regionColor(splitPalette, [0, 0, 1, 0.5]);
  const bottom = regionColor(splitPalette, [0, 0.5, 1, 1]);
  assert.equal(top, "#c02020");
  assert.equal(bottom, "#2040c0");
  // A region thinner than one cell still gets the colour it straddles.
  assert.equal(regionColor(splitPalette, [0.2, 0.1, 0.22, 0.12]), "#c02020");
  // The whole photo averages both halves into something in between.
  assert.equal(regionColor(splitPalette, [0, 0, 1, 1]), "#703070");
  const cells = regionCells(splitPalette, [0, 0, 1, 1]);
  assert.equal(cells.length, 16);
  assert.deepEqual(cells[0], { column: 0, row: 0, color: "#c02020" });
  // Only the cells the region actually covers are sampled.
  assert.equal(regionCells(splitPalette, [0, 0, 0.5, 0.5]).length, 4);
  assert.deepEqual(cellAt(splitPalette, 1.9, -3), {
    column: 3,
    row: 0,
    color: "#c02020",
  });
});

test("every face of a shape gets the photo colour of the region it sits in", () => {
  const mesh = shapeMesh("box", 1);
  const { groups, dropped } = faceGroups(
    splitPalette,
    [0, 0, 1, 1],
    mesh,
    "#ffffff",
  );
  assert.equal(dropped, 0);
  const covered = groups
    .flatMap((group: any) => group.faces)
    .sort((a, b) => a - b);
  assert.deepEqual(
    covered,
    mesh.faces.map((_: any, index: number) => index),
  );
  // Box faces point up/down/sideways: the two halves of the photo are both used.
  assert.deepEqual(groups.map((group: any) => group.color).sort(), [
    "#2040c0",
    "#c02020",
  ]);
  // Deterministic: the same mesh and palette give byte-identical groups.
  const again = faceGroups(splitPalette, [0, 0, 1, 1], mesh, "#ffffff");
  assert.deepEqual(again.groups, groups);
  // A sphere is many more faces than the group cap allows, so the extra groups
  // are dropped and counted rather than silently merged into a wrong colour.
  const sphere = faceGroups(
    flat("#123456"),
    [0, 0, 1, 1],
    shapeMesh("sphere", 1, 12),
    "#ffffff",
  );
  assert.equal(sphere.dropped, 0);
  assert.ok(sphere.groups.length <= GROUPS_MAX);
  // Without a region the face keeps the colour the model chose.
  const plain = faceGroups(splitPalette, [0, 0, 1, 1], mesh, "#8b5a2b");
  assert.ok(plain.groups.every((group: any) => group.faces.length > 0));
});

test("scene.build paints nodes from the photo and reports exactly where the colour came from", () => {
  const run = (palettes: any[]) =>
    applySceneOps({
      scene: JSON.stringify({ version: 1, objects: [] }, null, 2),
      photos: 1,
      palettes,
      ops: [
        {
          kind: "scene.build",
          name: "Kursi",
          photo: 1,
          position: [0, 0, 0],
          nodes: [
            {
              name: "Dudukan",
              shape: "box",
              position: [0, 1, 0],
              size: [3, 0.4, 3],
              region: [0, 0, 1, 0.5],
            },
            {
              name: "Kaki",
              shape: "box",
              position: [0, 0.5, 0],
              region: [0, 0.5, 1, 1],
            },
          ],
        },
      ],
    });
  const result = run([splitPalette]);
  assert.equal(result.report.sceneChanged, true);
  const built = JSON.parse(result.scene);
  const seat = built.objects.find((o: any) => o.name === "Dudukan");
  const legs = built.objects.find((o: any) => o.name === "Kaki");
  assert.equal(seat.color, "#c02020");
  assert.equal(legs.color, "#2040c0");
  const applied = result.report.applied[0];
  assert.equal(applied.colorSource, "photo");
  // Parts keep one flat colour each, so there are no per-face groups here.
  assert.equal(applied.colorGroups, undefined);
  assert.match(applied.changes.join(" "), /rata-rata area foto 1/);
  // Even the flat colour path says what it is not.
  assert.match(applied.changes.join(" "), /bukan peta tekstur UV/);
  // No sample for that photo: the whole batch is refused, nothing is painted.
  const refused = run([]);
  assert.equal(refused.report.sceneChanged, false);
  assert.match(refused.report.rejected[0].reason, /sampel warna foto/);
  // Nothing is written back: the caller keeps the scene it already had.
  assert.equal(refused.scene, null);
  // A malformed grid counts as no sample as well.
  const malformed = run([{ columns: 2, rows: 2, colors: ["#ffffff"] }]);
  assert.equal(malformed.report.sceneChanged, false);
});

test("a merged mesh keeps the photo's colours per side, and says it is not a UV texture", () => {
  const result = applySceneOps({
    scene: JSON.stringify({ version: 1, objects: [] }, null, 2),
    photos: 1,
    palettes: [splitPalette],
    ops: [
      {
        kind: "scene.build",
        name: "Kursi",
        photo: 1,
        asMesh: true,
        nodes: [
          {
            name: "Dudukan",
            shape: "box",
            position: [0, 1, 0],
            size: [3, 0.4, 3],
            region: [0, 0, 1, 0.5],
          },
          {
            name: "Kaki",
            shape: "box",
            position: [0, 0.5, 0],
            region: [0, 0.5, 1, 1],
          },
        ],
      },
    ],
  });
  assert.equal(result.report.sceneChanged, true);
  const built = JSON.parse(result.scene);
  const mesh = built.objects.find((o: any) => o.kind === "mesh").mesh;
  assert.ok(mesh.groups.length >= 2);
  const covered = mesh.groups
    .flatMap((group: any) => group.faces)
    .sort((a, b) => a - b);
  assert.deepEqual(
    covered,
    mesh.faces.map((_: any, index: number) => index),
  );
  assert.ok(mesh.groups.length <= GROUPS_MAX);
  const colors = new Set(mesh.groups.map((group: any) => group.color));
  assert.deepEqual([...colors].sort(), ["#2040c0", "#c02020"]);
  const applied = result.report.applied[0];
  assert.equal(applied.colorSource, "photo-faces");
  assert.equal(applied.groups, mesh.groups.length);
  // The colours themselves travel in the report, so the chat can show them
  // instead of asking the reader to trust a number.
  assert.deepEqual(
    applied.colorGroups.map((group: any) => group.color).sort(),
    ["#2040c0", "#c02020"],
  );
  assert.equal(
    applied.colorGroups.reduce((n: number, g: any) => n + g.faces, 0),
    mesh.faces.length,
  );
  const text = applied.changes.join(" ");
  assert.match(text, /warna per sisi/);
  assert.match(text, /Roblox mengabaikan warna di file OBJ/);
  // The scene still validates: a grouped mesh goes back through the schema.
  const parsed = sceneSchema.parse(built);
  assert.equal(
    (parsed.objects.find((o: any) => o.kind === "mesh") as any).mesh.groups
      .length,
    mesh.groups.length,
  );
});

test("the browser reads a photo into a small grid of average colours", () => {
  // A 4×4 photo: red on the left, blue on the right.
  const pixels = new Uint8ClampedArray(4 * 4 * 4);
  for (let y = 0; y < 4; y++)
    for (let x = 0; x < 4; x++) {
      const at = (y * 4 + x) * 4;
      const red = x < 2;
      pixels[at] = red ? 200 : 32;
      pixels[at + 1] = 0;
      pixels[at + 2] = red ? 32 : 192;
      pixels[at + 3] = 255;
    }
  const palette = samplePalette(pixels, 4, 4, 2, 2);
  assert.equal(palette.columns, 2);
  assert.equal(palette.rows, 2);
  assert.equal(palette.colors.length, 4);
  assert.deepEqual(palette.colors, [
    "#c80020",
    "#2000c0",
    "#c80020",
    "#2000c0",
  ]);
  assert.equal(isPalette(palette), true);
  // The default is the coarse 16×16 grid the prompt tells the model about.
  const coarse = samplePalette(pixels, 4, 4);
  assert.equal(coarse.columns, 16);
  assert.equal(coarse.colors.length, 256);
  // A truncated buffer is an error, not a black photo.
  assert.throws(() => samplePalette(pixels.slice(0, 8), 4, 4), /tidak terbaca/);
});

test("a grouped mesh renders and exports per face, and the schema refuses broken groups", () => {
  const object: any = {
    id: "m1",
    name: "Mesh",
    kind: "mesh",
    parent: null,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    size: [1, 1, 1],
    color: "#8b5a2b",
    anchored: true,
    mesh: {
      vertices: [
        [0, 0, 0],
        [1, 0, 0],
        [0, 1, 0],
        [1, 1, 0],
      ],
      faces: [
        [0, 1, 2],
        [1, 3, 2],
      ],
      groups: [
        { color: "#c02020", faces: [0] },
        { color: "#2040c0", faces: [1] },
      ],
    },
  };
  // The schema keeps groups (they used to be stripped, which lost the photo).
  const parsed = sceneSchema.parse({ version: 1, objects: [object] });
  assert.equal((parsed.objects[0] as any).mesh.groups.length, 2);
  const photo = meshPhotoColors(object.mesh, object.color);
  assert.equal(photo.position.length, 6 * 3);
  assert.deepEqual(photo.color.slice(0, 3), [192 / 255, 32 / 255, 32 / 255]);
  assert.deepEqual(photo.color.slice(9, 12), [32 / 255, 64 / 255, 192 / 255]);
  // A face in two groups, or a face that is not there, is a broken scene.
  assert.throws(
    () =>
      sceneSchema.parse({
        version: 1,
        objects: [
          {
            ...object,
            mesh: {
              ...object.mesh,
              groups: [{ color: "#ffffff", faces: [0, 0] }],
            },
          },
        ],
      }),
    /Grup warna mesh tidak valid/,
  );
  assert.throws(
    () =>
      sceneSchema.parse({
        version: 1,
        objects: [
          {
            ...object,
            mesh: {
              ...object.mesh,
              groups: [{ color: "#ffffff", faces: [7] }],
            },
          },
        ],
      }),
    /Grup warna mesh tidak valid/,
  );
  // The OBJ carries the colour of each side as vertex colours, and its face
  // indices still point at vertices — an exported file must stay importable.
  const obj = meshOBJ(object);
  assert.match(obj, /^# PiwuApp mesh dengan warna per sisi/m);
  assert.match(obj, /Roblox mengabaikan warna di file OBJ/);
  const imported = parseOBJ(obj);
  assert.equal(imported.mesh?.faces.length, 2);
  assert.equal(imported.mesh?.vertices.length, 6);
  // Plain meshes keep the compact one-vertex-per-point export.
  const plain = meshOBJ({
    ...object,
    mesh: { vertices: object.mesh.vertices, faces: object.mesh.faces },
  } as any);
  assert.equal(
    plain.split("\n").filter((line) => line.startsWith("v ")).length,
    4,
  );
  assert.match(plain, /^f 1 2 3$/m);
});
