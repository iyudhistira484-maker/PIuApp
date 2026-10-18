// Deterministic low-poly geometry: the half of "3D model from a photo" that a
// language model must never improvise.
//
// The model describes shapes (a box here, a cylinder there, this colour, this
// size); this module turns that description into real triangle geometry, the
// same way every time, inside the scene's mesh budget (512 vertices / 1024
// triangles). Two honest outcomes:
//
//  * one object per shape — a Roblox Part where a Part exists (`block`,
//    `sphere`, `cylinder`), a mesh where the shape has no Part equivalent
//    (cone, wedge, plane);
//  * one merged mesh (`asMesh`) — a single object whose geometry is all shapes
//    baked together, which the editor can export as OBJ for Studio import.
//
// Units: every shape is generated inside the unit box [-0.5, 0.5]³ and scaled
// by the object size, exactly like a Part. Cylinder and cone run along X, which
// is what the scene's own cylinder Part does (a unit cylinder rotated 90° on Z),
// so a generated mesh and a Part point the same way.
//
// Coordinates are rounded to three decimals before they leave this module, so
// the same description always produces byte-identical geometry.

export const SHAPES = ["box", "sphere", "cylinder", "cone", "wedge", "plane"];
export const SEGMENTS_DEFAULT = 12;
export const SEGMENTS_MIN = 3;
export const SEGMENTS_MAX = 24;

// -0 is coerced to 0: identical geometry, and a scene file that never stores
// the string "-0".
export const round3 = (n) => {
  const value = Number(Number(n).toFixed(3));
  return value === 0 ? 0 : value;
};
const key = (v) => v.map(round3).join("|");

/** Shapes the scene can express as a native Part, and which kind that is. */
export const PART_KIND = {
  box: "block",
  sphere: "sphere",
  cylinder: "cylinder",
};

const DEG = Math.PI / 180;

/**
 * Rotates like the browser renderer does: `rotation` is XYZ Euler in degrees and
 * three.js composes it as RX·RY·RZ, so a model built here matches the preview
 * instead of looking mirrored.
 */
export function rotateVector([x, y, z], rotation = [0, 0, 0]) {
  const [rx, ry, rz] = rotation.map((d) => d * DEG);
  const [a, b] = [Math.cos(rx), Math.sin(rx)];
  const [c, d] = [Math.cos(ry), Math.sin(ry)];
  const [e, f] = [Math.cos(rz), Math.sin(rz)];
  // R = RX·RY·RZ
  return [
    round3(c * e * x + -c * f * y + d * z),
    round3((b * d * e + a * f) * x + (-b * d * f + a * e) * y + -b * c * z),
    round3((-a * d * e + b * f) * x + (a * d * f + b * e) * y + a * c * z),
  ];
}

/** Ring of `segments` points around the X axis, in the unit cross section. */
function ringX(segments, x) {
  return Array.from({ length: segments }, (_, i) => {
    const angle = (i / segments) * Math.PI * 2;
    return [x, round3(Math.cos(angle) / 2), round3(Math.sin(angle) / 2)];
  });
}

/**
 * One unit shape. Vertex order is part of the contract: it is what makes the
 * generated mesh reproducible, so tests pin exact counts and a few positions.
 */
export function shapeMesh(shape, { segments = SEGMENTS_DEFAULT } = {}) {
  const sides = Math.min(
    SEGMENTS_MAX,
    Math.max(SEGMENTS_MIN, Math.round(segments) || SEGMENTS_DEFAULT),
  );
  if (shape === "box")
    return {
      vertices: [
        [-0.5, -0.5, -0.5],
        [0.5, -0.5, -0.5],
        [0.5, 0.5, -0.5],
        [-0.5, 0.5, -0.5],
        [-0.5, -0.5, 0.5],
        [0.5, -0.5, 0.5],
        [0.5, 0.5, 0.5],
        [-0.5, 0.5, 0.5],
      ],
      faces: [
        [0, 3, 2],
        [0, 2, 1],
        [4, 5, 6],
        [4, 6, 7],
        [0, 1, 5],
        [0, 5, 4],
        [2, 3, 7],
        [2, 7, 6],
        [1, 2, 6],
        [1, 6, 5],
        [0, 4, 7],
        [0, 7, 3],
      ],
    };
  if (shape === "plane")
    return {
      vertices: [
        [-0.5, 0, -0.5],
        [0.5, 0, -0.5],
        [0.5, 0, 0.5],
        [-0.5, 0, 0.5],
      ],
      faces: [
        [0, 1, 2],
        [0, 2, 3],
      ],
    };
  if (shape === "wedge") {
    // A ramp: triangle in XY, extruded along Z. Rises toward -X.
    const vertices = [
      [0.5, -0.5, -0.5],
      [-0.5, -0.5, -0.5],
      [-0.5, 0.5, -0.5],
      [0.5, -0.5, 0.5],
      [-0.5, -0.5, 0.5],
      [-0.5, 0.5, 0.5],
    ];
    return {
      vertices,
      faces: [
        [0, 2, 1],
        [3, 4, 5],
        [0, 1, 4],
        [0, 4, 3],
        [1, 2, 5],
        [1, 5, 4],
        [2, 0, 3],
        [2, 3, 5],
      ],
    };
  }
  if (shape === "cylinder") {
    const back = ringX(sides, -0.5);
    const front = ringX(sides, 0.5);
    const vertices = [...back, ...front];
    const faces = [];
    for (let i = 0; i < sides; i++) {
      const next = (i + 1) % sides;
      faces.push([i, next, sides + next]);
      faces.push([i, sides + next, sides + i]);
    }
    // Caps reuse the ring vertices: a fan needs no extra centre vertex.
    for (let i = 1; i < sides - 1; i++) faces.push([0, i + 1, i]);
    for (let i = 1; i < sides - 1; i++)
      faces.push([sides, sides + i, sides + i + 1]);
    return { vertices, faces };
  }
  if (shape === "cone") {
    const base = ringX(sides, -0.5);
    const vertices = [...base, [0.5, 0, 0]];
    const faces = [];
    for (let i = 0; i < sides; i++) faces.push([i, (i + 1) % sides, sides]);
    for (let i = 1; i < sides - 1; i++) faces.push([0, i + 1, i]);
    return { vertices, faces };
  }
  if (shape === "sphere") {
    // Latitude bands, poles on Y. `segments` drives both directions so a
    // higher number really means rounder, and never a bigger mesh than asked.
    const rings = Math.max(2, Math.round(sides / 2));
    const vertices = [[0, 0.5, 0]];
    const faces = [];
    for (let ring = 1; ring < rings; ring++) {
      const phi = (ring / rings) * Math.PI;
      for (let i = 0; i < sides; i++) {
        const theta = (i / sides) * Math.PI * 2;
        vertices.push([
          round3((Math.sin(phi) * Math.cos(theta)) / 2),
          round3(Math.cos(phi) / 2),
          round3((Math.sin(phi) * Math.sin(theta)) / 2),
        ]);
      }
    }
    vertices.push([0, -0.5, 0]);
    const south = vertices.length - 1;
    const at = (ring, i) => 1 + (ring - 1) * sides + (i % sides);
    for (let i = 0; i < sides; i++) faces.push([0, at(1, i), at(1, i + 1)]);
    for (let ring = 1; ring < rings - 1; ring++)
      for (let i = 0; i < sides; i++) {
        const a = at(ring, i);
        const b = at(ring + 1, i);
        faces.push([a, b, at(ring + 1, i + 1)]);
        faces.push([a, at(ring + 1, i + 1), at(ring, i + 1)]);
      }
    for (let i = 0; i < sides; i++)
      faces.push([south, at(rings - 1, i + 1), at(rings - 1, i)]);
    return { vertices, faces };
  }
  // Anything else is not a shape this server knows how to build.
  return null;
}

/** Scales, rotates and moves a mesh. Order: scale, rotate, translate. */
export function transformMesh(
  mesh,
  { size = [1, 1, 1], rotation = [0, 0, 0], position = [0, 0, 0] } = {},
) {
  return {
    vertices: mesh.vertices.map((vertex) =>
      rotateVector(
        vertex.map((n, i) => n * (size[i] ?? 1)),
        rotation,
      ).map((n, i) => round3(n + (position[i] ?? 0))),
    ),
    faces: mesh.faces.map((face) => [...face]),
  };
}

/**
 * Joins meshes into one, dropping duplicated vertices so the result stays inside
 * the budget longer than the naive concatenation would. Face order and vertex
 * order follow the input order, so the same tree always merges the same way.
 */
export function mergeMeshes(meshes) {
  const vertices = [];
  const faces = [];
  // Which input mesh (and which face of it) every output face came from, so a
  // per-face colour decided on the part survives the stitch exactly.
  const faceOrigin = [];
  const faceLocal = [];
  const index = new Map();
  let duplicates = 0;
  for (const [origin, mesh] of meshes.entries()) {
    const map = mesh.vertices.map((vertex) => {
      const id = key(vertex);
      if (index.has(id)) {
        duplicates++;
        return index.get(id);
      }
      const at = vertices.length;
      vertices.push(vertex.map(round3));
      index.set(id, at);
      return at;
    });
    mesh.faces.forEach((face, local) => {
      const [a, b, c] = face.map((i) => map[i]);
      // A face whose corners collapsed together is not a face; it would be
      // rejected by the schema anyway, so it is dropped here and counted.
      if (new Set([a, b, c]).size < 3) return;
      faces.push([a, b, c]);
      faceOrigin.push(origin);
      faceLocal.push(local);
    });
  }
  return { vertices, faces, duplicates, faceOrigin, faceLocal };
}

/**
 * Honest fit report against the caller's limits — the scene's own numbers are
 * passed in, so this module never repeats (and never drifts from) the schema.
 */
export function meshBudget(mesh, limits) {
  const vertices = mesh?.vertices?.length ?? 0;
  const faces = mesh?.faces?.length ?? 0;
  const maxVertices = limits?.maxVertices ?? 512;
  const maxFaces = limits?.maxFaces ?? 1024;
  return {
    vertices,
    faces,
    fits: vertices <= maxVertices && faces <= maxFaces,
    maxVertices,
    maxFaces,
  };
}
