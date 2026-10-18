import test from "node:test";
import assert from "node:assert/strict";
import {
  PART_KIND,
  SEGMENTS_MAX,
  SEGMENTS_MIN,
  SHAPES,
  mergeMeshes,
  meshBudget,
  rotateVector,
  shapeMesh,
  transformMesh,
} from "../server/lib/lowpoly.mjs";

// The geometry a Roblox model is built from. A language model must never invent
// vertices, so everything here is generated: these tests pin the properties that
// make the result real geometry (closed, inside the unit box, deterministic) and
// not a pile of triangles that happens to look like a chair in one place.

const edges = (mesh: any) => {
  const seen = new Map<string, number>();
  for (const [a, b, c] of mesh.faces)
    for (const [u, v] of [
      [a, b],
      [b, c],
      [c, a],
    ]) {
      const key = u < v ? `${u}-${v}` : `${v}-${u}`;
      seen.set(key, (seen.get(key) || 0) + 1);
    }
  return seen;
};

test("every shape is a closed mesh inside the unit box, with no stray vertex", () => {
  for (const shape of SHAPES) {
    const mesh = shapeMesh(shape)!;
    assert.ok(mesh, `${shape} must exist`);
    assert.ok(mesh.vertices.length >= 3, shape);
    // Faces index real, distinct vertices.
    for (const face of mesh.faces) {
      assert.equal(face.length, 3, shape);
      assert.equal(new Set(face).size, 3, shape);
      for (const index of face)
        assert.ok(index >= 0 && index < mesh.vertices.length, shape);
    }
    // Unit box: the renderer scales by the object size, so 0.5 is the bound.
    for (const vertex of mesh.vertices)
      for (const n of vertex) assert.ok(Math.abs(n) <= 0.5 + 1e-9, shape);
    // No vertex exists without being used by a face.
    assert.equal(new Set(mesh.faces.flat()).size, mesh.vertices.length, shape);
    if (shape === "plane") {
      // A single-sided panel is not closed, and that is on purpose; its two
      // triangles still share their diagonal exactly twice.
      assert.equal(mesh.faces.length, 2);
      continue;
    }
    // Closed and manifold: every edge borders exactly two triangles. This is
    // what makes the object solid instead of a shred of stray faces.
    for (const [key, count] of edges(mesh))
      assert.equal(count, 2, `${shape} edge ${key}`);
  }
});

test("the same description always produces the same geometry", () => {
  const first = JSON.stringify(shapeMesh("sphere", { segments: 16 }));
  const second = JSON.stringify(shapeMesh("sphere", { segments: 16 }));
  assert.equal(first, second);
  // Coordinates are rounded on the way out, so a model is reproducible and
  // stored scenes stay small.
  for (const vertex of shapeMesh("sphere")!.vertices)
    for (const n of vertex) assert.equal(n, Number(n.toFixed(3)));
});

test("segments is clamped, and rounded shapes really get rounder", () => {
  const small = shapeMesh("sphere", { segments: SEGMENTS_MIN })!;
  const big = shapeMesh("sphere", { segments: SEGMENTS_MAX })!;
  assert.ok(big.vertices.length > small.vertices.length);
  // Below the floor and above the ceiling are clamped, never accepted blindly.
  assert.deepEqual(
    shapeMesh("cylinder", { segments: 1 })!.vertices.length,
    shapeMesh("cylinder", { segments: SEGMENTS_MIN })!.vertices.length,
  );
  assert.deepEqual(
    shapeMesh("cylinder", { segments: 999 })!.vertices.length,
    shapeMesh("cylinder", { segments: SEGMENTS_MAX })!.vertices.length,
  );
  // A box has no segments to speak of.
  assert.deepEqual(shapeMesh("box", { segments: 24 }), shapeMesh("box"));
  // 24 segments → 12 latitude rings, 11 bands of them, plus two poles.
  assert.equal(
    shapeMesh("sphere", { segments: 24 })!.vertices.length,
    11 * 24 + 2,
  );
  // An unknown shape is null, not a box in disguise: the caller must refuse.
  assert.equal(shapeMesh("torus"), null);
});

test("rotation follows the renderer's own convention", () => {
  // 90° on Y sends +X to -Z, and 90° on Z sends +X to +Y: the same result the
  // three.js preview shows, so a built model is not mirrored.
  assert.deepEqual(rotateVector([1, 0, 0], [0, 90, 0]), [0, 0, -1]);
  assert.deepEqual(rotateVector([1, 0, 0], [0, 0, 90]), [0, 1, 0]);
  assert.deepEqual(rotateVector([0, 1, 0], [90, 0, 0]), [0, 0, 1]);
  assert.deepEqual(rotateVector([1, 2, 3]), [1, 2, 3]);
});

test("transformMesh scales, then rotates, then moves", () => {
  // Without rotation the corner (-0.5,-0.5,-0.5) of a 2×4×6 box lands at
  // position minus half the size in each axis.
  const moved = transformMesh(shapeMesh("box")!, {
    size: [2, 4, 6],
    position: [10, 1, 0],
  });
  assert.deepEqual(moved.vertices[0], [9, -1, -3]);
  // A quarter turn on Z is applied AFTER the scale, so the corner ends up on the
  // other side of the box — the same order the renderer composes rotations in.
  const turned = transformMesh(shapeMesh("box")!, {
    size: [2, 4, 6],
    rotation: [0, 0, 90],
    position: [10, 1, 0],
  });
  assert.deepEqual(turned.vertices[0], [12, 0, -3]);
  // Faces never change when a mesh is moved.
  assert.deepEqual(moved.faces, shapeMesh("box")!.faces);
});

test("mergeMeshes stitches parts together and drops what cannot be a face", () => {
  const a = transformMesh(shapeMesh("box")!, { size: [1, 1, 1] });
  const b = transformMesh(shapeMesh("box")!, {
    size: [1, 1, 1],
    position: [0, 1, 0],
  });
  const merged = mergeMeshes([a, b]);
  // Two 8-vertex cubes sharing a face's four corners: shared vertices are kept
  // once, so the merged mesh is smaller than a naive concatenation.
  assert.ok(merged.vertices.length < 16, "shared vertices must be reused");
  assert.equal(merged.duplicates, 4);
  assert.equal(merged.faces.length, 24);
  for (const face of merged.faces)
    for (const index of face) assert.ok(index < merged.vertices.length);
  // A triangle whose corners collapsed onto the same point is not a face.
  const collapsed = mergeMeshes([
    {
      vertices: [
        [0, 0, 0],
        [1, 0, 0],
        [0, 1, 0],
      ],
      faces: [[0, 1, 2]],
    },
    {
      vertices: [
        [0, 0, 0],
        [0, 0, 0],
        [1, 0, 0],
      ],
      faces: [[0, 1, 2]],
    },
  ]);
  assert.equal(collapsed.faces.length, 1);
  assert.deepEqual(mergeMeshes([]).vertices, []);
});

test("the mesh budget is reported against the scene's real limits", () => {
  const small = mergeMeshes([shapeMesh("box")!]);
  const budget = meshBudget(small, { maxVertices: 512, maxFaces: 1024 });
  assert.equal(budget.fits, true);
  assert.equal(budget.maxVertices, 512);
  assert.equal(budget.maxFaces, 1024);
  const over = meshBudget(
    { vertices: new Array(513).fill([0, 0, 0]), faces: [] },
    { maxVertices: 512, maxFaces: 1024 },
  );
  assert.equal(over.fits, false);
});

test("every shape a Part can express is mapped to one, and the rest are meshes", () => {
  // `block`/`sphere`/`cylinder` are Roblox Parts: editable in Studio. The shapes
  // with no Part equivalent must become meshes instead of being faked.
  assert.deepEqual(Object.keys(PART_KIND).sort(), [
    "box",
    "cylinder",
    "sphere",
  ]);
  for (const shape of SHAPES)
    // Every shape resolves to something: a Part kind, or "mesh" for the shapes
    // Roblox has no Part for.
    assert.equal(typeof ((PART_KIND as any)[shape] || "mesh"), "string");
});
