import test from "node:test";
import assert from "node:assert/strict";
import {
  ATLAS_SIZE,
  atlasLayout,
  atlasPlan,
  cellOrigin,
  faceFootprints,
  faceGroupIndex,
  faceUVs,
  patchSource,
} from "../src/lib/roblox/atlas.ts";
import {
  buildGLB,
  faceVertexGeometry,
  objectGLB,
  vertexColors,
} from "../src/lib/roblox/glb.ts";
import { sceneSchema } from "../src/lib/roblox/scene.ts";
import { applySceneOps } from "../server/lib/ai-ops.mjs";
import { rotateVector } from "../server/lib/lowpoly.mjs";
import * as THREE from "three";

// A texture needs two halves to line up: the atlas pixels and the UV coordinates
// that point into them. These tests pin the arithmetic (the browser-only canvas
// work is `bakeAtlas`, covered by tests/roblox-texture.spec.ts) and the .glb that
// carries them — because a file that claims to be textured and is not would be
// worse than the flat colours it replaces.

/** A 1×1 PNG, so the embedded image is real bytes and not a stub. */
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==",
  "base64",
);

const mesh = (over: any = {}) => ({
  vertices: [
    [0, 0, 0],
    [1, 0, 0],
    [1, 1, 0],
    [0, 1, 0],
    [0, 0, 1],
    [1, 0, 1],
    [1, 1, 1],
    [0, 1, 1],
  ],
  faces: [
    [0, 1, 2],
    [0, 2, 3],
    [4, 6, 5],
    [4, 7, 6],
  ],
  groups: [
    { color: "#c02020", faces: [0, 1], region: [0, 0, 1, 0.5] },
    { color: "#2040c0", faces: [2, 3], region: [0, 0.5, 1, 1] },
  ],
  ...over,
});

const object = (over: any = {}) => ({
  id: "obj-mesh",
  name: "Kursi",
  kind: "mesh",
  parent: null,
  position: [4, 2, 0],
  rotation: [0, 0, 0],
  size: [2, 2, 2],
  color: "#8b5a2b",
  anchored: true,
  mesh: mesh(),
  ...over,
});

/** A .glb is a container: header, JSON chunk, binary chunk. */
function readGLB(file: Uint8Array) {
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  assert.equal(view.getUint32(0, true), 0x46546c67, "magic is glTF");
  assert.equal(view.getUint32(4, true), 2, "version 2");
  assert.equal(
    view.getUint32(8, true),
    file.byteLength,
    "length covers the file",
  );
  const jsonLength = view.getUint32(12, true);
  assert.equal(view.getUint32(16, true), 0x4e4f534a, "first chunk is JSON");
  assert.equal(jsonLength % 4, 0, "JSON chunk is aligned");
  const json = JSON.parse(
    new TextDecoder().decode(file.subarray(20, 20 + jsonLength)).trim(),
  );
  const binStart = 20 + jsonLength;
  const binLength = view.getUint32(binStart, true);
  assert.equal(
    view.getUint32(binStart + 4, true),
    0x004e4942,
    "second chunk is BIN",
  );
  assert.equal(binLength % 4, 0, "BIN chunk is aligned");
  const bin = file.subarray(binStart + 8, binStart + 8 + binLength);
  return { json, bin, view };
}

test("the atlas is a square grid of patches inside the 1024px limit", () => {
  assert.equal(ATLAS_SIZE, 1024);
  assert.deepEqual(atlasLayout(0), { size: 1024, columns: 1, cell: 1024 });
  assert.deepEqual(atlasLayout(1), { size: 1024, columns: 1, cell: 1024 });
  assert.deepEqual(atlasLayout(4), { size: 1024, columns: 2, cell: 512 });
  assert.deepEqual(atlasLayout(5), { size: 1024, columns: 3, cell: 341 });
  const full = atlasLayout(24);
  assert.equal(full.columns, 5);
  assert.equal(full.cell, 204);
  assert.ok(full.columns * full.cell <= ATLAS_SIZE);
  // Patches never overlap and never leave the image.
  const origin = cellOrigin(full, 23);
  assert.equal(origin.x, 3 * 204);
  assert.equal(origin.y, 4 * 204);
  assert.ok(origin.x + full.cell <= ATLAS_SIZE);
  assert.ok(origin.y + full.cell <= ATLAS_SIZE);
});

test("every face gets coordinates inside its own group's patch", () => {
  const layout = atlasLayout(2);
  const uvs = faceUVs(mesh(), layout);
  assert.ok(uvs);
  assert.equal(uvs.length, 4 * 3, "three corners per face");
  for (const [u, v] of uvs) {
    assert.ok(u >= 0 && u <= 1, "u inside the atlas");
    assert.ok(v >= 0 && v <= 1, "v inside the atlas");
  }
  // Face 0 sits in group 0 (top-left patch), face 2 in group 1 (top-right).
  const [u0] = uvs[0];
  const [u2] = uvs[2 * 3];
  assert.ok(u0 < 0.5, "first patch is the left half");
  assert.ok(u2 >= 0.5, "second patch is the right half");
  // Same input, same output: an exported texture must not drift between runs.
  assert.deepEqual(faceUVs(mesh(), layout), uvs);
  // A mesh without groups has no patch to point at, so it gets no UVs.
  assert.equal(faceUVs(mesh({ groups: undefined }), layout), null);
  assert.deepEqual(faceGroupIndex(mesh()), [0, 0, 1, 1]);
});

test("a face is flattened onto itself, never outside [0,1]", () => {
  const footprints = faceFootprints(mesh());
  assert.equal(footprints.length, 4);
  for (const face of footprints) {
    assert.equal(face.length, 3);
    for (const [across, along] of face)
      for (const value of [across, along])
        assert.ok(value >= 0 && value <= 1, `footprint ${value} in range`);
  }
  // The four corners of a quad use the whole square, so a patch fills it.
  const corners = footprints[0];
  assert.deepEqual(
    [...new Set(corners.map(([across]) => across))].sort(),
    [0, 1],
  );
  assert.deepEqual(
    [...new Set(corners.map(([, along]) => along))].sort(),
    [0, 1],
  );
});

test("a patch says which pixels of the photo it comes from, or says it has none", () => {
  assert.deepEqual(
    patchSource({ color: "#ffffff", region: [0.2, 0.8, 0.6, 0.1] }),
    {
      region: [0.2, 0.1, 0.6, 0.8],
      color: "#ffffff",
    },
  );
  // A group with no region (a model-authored mesh, or a colour the model chose)
  // is a flat patch, never photo pixels the server never saw.
  assert.deepEqual(patchSource({ color: "#123456" }), {
    region: null,
    color: "#123456",
  });
  assert.deepEqual(
    patchSource({ color: "#123456", region: [0, 0, 1] } as any),
    {
      region: null,
      color: "#123456",
    },
  );
  const plan = atlasPlan(mesh());
  assert.equal(plan.patches.length, 2);
  assert.equal(plan.patches[0].size, 512);
  assert.deepEqual(plan.patches[1].region, [0, 0.5, 1, 1]);
});

test("the server keeps the photo area beside the colour it was sampled from", () => {
  const palette = {
    columns: 4,
    rows: 4,
    colors: Array.from({ length: 16 }, (_, at) =>
      at < 8 ? "#c02020" : "#2040c0",
    ),
  };
  const result = applySceneOps({
    scene: JSON.stringify({ version: 1, objects: [] }),
    photos: 1,
    palettes: [palette],
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
            region: [0.1, 0.2, 0.9, 0.45],
          },
          {
            name: "Kaki",
            shape: "box",
            position: [0, 0.5, 0],
            region: [0.1, 0.6, 0.9, 0.95],
          },
        ],
      },
    ],
  });
  assert.equal(result.report.sceneChanged, true);
  const built = JSON.parse(result.scene);
  const scene = sceneSchema.parse(built);
  const groups = (scene.objects[0] as any).mesh.groups;
  assert.ok(groups.length >= 2);
  for (const group of groups) {
    assert.ok(Array.isArray(group.region), "every group remembers its area");
    const [x0, y0, x1, y1] = group.region;
    assert.ok(x0 <= x1 && y0 <= y1, "the area is stored in reading order");
  }
  // The areas really are the ones the model pointed at, per part.
  const regions = groups.map((group: any) => group.region.join(","));
  assert.ok(regions.includes("0.1,0.2,0.9,0.45"));
  assert.ok(regions.includes("0.1,0.6,0.9,0.95"));
  // Every face is covered exactly once, so every face gets a patch.
  const covered = groups.flatMap((group: any) => group.faces);
  assert.equal(new Set(covered).size, covered.length);
  assert.equal(covered.length, (scene.objects[0] as any).mesh.faces.length);
});

test("the exported .glb is a real glTF with the texture inside it", () => {
  const file = objectGLB(object() as any, { texturePng: PNG_1X1 });
  const { json, bin } = readGLB(file);
  assert.equal(json.asset.version, "2.0");
  assert.equal(json.scenes[0].nodes[0], 0);
  assert.deepEqual(json.nodes[0].translation, [4, 2, 0]);
  const primitive = json.meshes[0].primitives[0];
  assert.equal(primitive.mode, 4, "triangles");
  assert.deepEqual(Object.keys(primitive.attributes).sort(), [
    "COLOR_0",
    "NORMAL",
    "POSITION",
    "TEXCOORD_0",
  ]);
  // Four faces of three corners each, after the mesh was expanded per face.
  const vertexCount = 12;
  for (const name of Object.keys(primitive.attributes))
    assert.equal(
      json.accessors[primitive.attributes[name]].count,
      vertexCount,
      `${name} covers every corner`,
    );
  assert.equal(json.accessors[primitive.attributes.POSITION].type, "VEC3");
  assert.equal(json.accessors[primitive.attributes.TEXCOORD_0].type, "VEC2");
  // POSITION declares bounds, which is how a viewer frames the model.
  const bounds = json.accessors[primitive.attributes.POSITION];
  assert.deepEqual(bounds.min, [0, 0, 0]);
  assert.deepEqual(bounds.max, [2, 2, 2]);
  // The texture is the PNG that went in, byte for byte, reachable from material.
  assert.equal(json.images.length, 1);
  assert.equal(json.images[0].mimeType, "image/png");
  const imageView = json.bufferViews[json.images[0].bufferView];
  assert.equal(imageView.byteLength, PNG_1X1.length);
  assert.deepEqual(
    Buffer.from(
      bin.subarray(
        imageView.byteOffset,
        imageView.byteOffset + imageView.byteLength,
      ),
    ),
    PNG_1X1,
  );
  const texture = json.materials[0].pbrMetallicRoughness.baseColorTexture;
  assert.equal(texture.index, 0);
  assert.equal(json.textures[0].source, json.images[0].bufferView ? 0 : 0);
  assert.equal(
    json.samplers[0].wrapS,
    33071,
    "clamped, so a patch cannot bleed",
  );
  // Every block starts aligned, which is what a glTF reader requires.
  for (const view of json.bufferViews)
    assert.equal(view.byteOffset % 4, 0, "bufferView is aligned");
  // The BIN chunk may be padded up to 3 bytes beyond the declared buffer, and
  // the declared length must still cover every byte a bufferView points at.
  assert.ok(json.buffers[0].byteLength <= bin.length);
  assert.ok(bin.length - json.buffers[0].byteLength < 4);
  for (const view of json.bufferViews)
    assert.ok(view.byteOffset + view.byteLength <= json.buffers[0].byteLength);
});

test("without a texture the same export still carries the photo's colours", () => {
  const file = objectGLB(object() as any);
  const { json } = readGLB(file);
  const primitive = json.meshes[0].primitives[0];
  assert.equal(primitive.attributes.TEXCOORD_0, undefined);
  assert.ok(primitive.attributes.COLOR_0 !== undefined);
  assert.equal(json.images, undefined);
  assert.equal(
    json.materials[0].pbrMetallicRoughness.baseColorTexture,
    undefined,
  );
  // The colours are the group colours, per face: red for the first two faces.
  const colors = vertexColors(mesh() as any, "#8b5a2b");
  assert.equal(colors.length, 12 * 3);
  assert.deepEqual(colors.slice(0, 3), [192 / 255, 32 / 255, 32 / 255]);
  assert.deepEqual(colors.slice(6, 9), [192 / 255, 32 / 255, 32 / 255]);
  // Nine numbers per face (three corners), so face 2 starts at 18.
  assert.deepEqual(colors.slice(18, 21), [32 / 255, 64 / 255, 192 / 255]);
  // A face with no group keeps the object colour rather than turning black.
  const fallback = vertexColors(mesh({ groups: undefined }) as any, "#8b5a2b");
  assert.deepEqual(fallback.slice(0, 3), [139 / 255, 90 / 255, 43 / 255]);
});

test("the object's size and rotation are baked in, so Studio needs no scaling", () => {
  const scaled = faceVertexGeometry(mesh(), {
    size: [2, 2, 2],
    rotation: [0, 0, 0],
  });
  assert.equal(scaled.positions.length, 12 * 3);
  assert.deepEqual(scaled.positions.slice(0, 3), [0, 0, 0]);
  assert.deepEqual(scaled.positions.slice(3, 6), [2, 0, 0]);
  assert.deepEqual(scaled.positions.slice(6, 9), [2, 2, 0]);
  // Every corner of a face carries that face's own flat normal: the front faces
  // look at +Z, the two back-facing ones at -Z.
  for (let at = 0; at < 6; at++)
    assert.deepEqual(scaled.normals.slice(at * 3, at * 3 + 3), [0, 0, 1]);
  for (let at = 6; at < 12; at++)
    assert.deepEqual(scaled.normals.slice(at * 3, at * 3 + 3), [0, 0, -1]);
  // A 90° turn on Z swaps X and Y, the same way the renderer turns an object.
  const turned = faceVertexGeometry(mesh(), {
    size: [1, 1, 1],
    rotation: [0, 0, 90],
  });
  const corner = turned.positions.slice(3, 6);
  assert.ok(Math.abs(corner[0] - 0) < 1e-9);
  assert.ok(Math.abs(corner[1] - 1) < 1e-9);
  assert.ok(Math.abs(corner[2] - 0) < 1e-9);
});

test("rotation means the same thing here, in the server and in the renderer", () => {
  // One rotation touching all three axes: with a single axis a wrong product
  // order still looks right, which is exactly how the export drifted from the
  // preview before this test existed. The server generator and the Three.js
  // renderer both use RX·RY·RZ, so the exported mesh must too.
  const rotation = [20, 30, 40];
  const point = [1, 2, 3];
  const baked = faceVertexGeometry(
    { vertices: [point, [0, 0, 0], [0, 1, 0]], faces: [[0, 1, 2]] },
    { size: [1, 1, 1], rotation },
  ).positions.slice(0, 3);
  const server = rotateVector(point, rotation);
  const three = new THREE.Vector3(...(point as [number, number, number]))
    .applyEuler(
      new THREE.Euler(
        ...(rotation.map((d) => (d * Math.PI) / 180) as [
          number,
          number,
          number,
        ]),
        "XYZ",
      ),
    )
    .toArray();
  for (let at = 0; at < 3; at++) {
    assert.ok(
      Math.abs(baked[at] - server[at]) < 1e-3,
      `server: ${baked[at]} vs ${server[at]}`,
    );
    assert.ok(
      Math.abs(baked[at] - three[at]) < 1e-6,
      `renderer: ${baked[at]} vs ${three[at]}`,
    );
  }
  // A wrong order is not a rounding difference: it moves the corner far away.
  assert.ok(Math.abs(baked[0] - 1.4567) > 0.1);
});

test("broken input is refused instead of written as a broken file", () => {
  assert.throws(
    () => buildGLB({ name: "x", positions: [0, 0, 0], normals: [] }),
    /tidak lengkap/,
  );
  assert.throws(
    () =>
      buildGLB({
        name: "x",
        positions: [0, 0, 0, 1, 1, 1],
        normals: [0, 0, 1, 0, 0, 1],
        uvs: [0, 0],
      }),
    /UV GLB tidak cocok/,
  );
  assert.throws(
    () =>
      buildGLB({
        name: "x",
        positions: [0, 0, 0],
        normals: [0, 0, 1],
        colors: [1, 1],
      }),
    /Warna vertex GLB tidak cocok/,
  );
  assert.throws(
    () => objectGLB(object({ mesh: undefined }) as any),
    /mesh kustom/,
  );
});
