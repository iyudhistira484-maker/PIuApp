import { z } from "zod";
import { HttpError } from "./core.mjs";
import {
  PART_KIND,
  SEGMENTS_MAX,
  SEGMENTS_MIN,
  SHAPES,
  mergeMeshes,
  meshBudget,
  round3,
  shapeMesh,
  transformMesh,
} from "./lowpoly.mjs";
import {
  GROUPS_MAX,
  faceGroups,
  isPalette,
  paletteFor,
  regionColor,
} from "./photo-palette.mjs";

// Deterministic scene ops. The model never rewrites scene.roblox.json for a
// small edit; it returns structured ops and this module applies them, so the
// result is reproducible, validated against the scene limits below, and either
// fully applied or fully rejected.
//
// The scene schema mirrors src/lib/roblox/scene.ts (the source of truth for the
// browser renderer). The server cannot import that TypeScript module, so the
// limits are repeated here and pinned by tests on both sides.
export const SCENE_PATH = "scene.roblox.json";
export const OPS_VERSION = 1;
export const OPS_MAX = 40;
/** Total nodes one `scene.build` may create, children included. */
export const BUILD_NODES_MAX = 40;
/** Children one node may carry. Models nest, but not without a limit. */
export const BUILD_CHILDREN_MAX = 12;
export const SCENE_LIMITS = {
  objects: 250,
  meshVertices: 512,
  meshFaces: 1024,
  vector: 10000,
  sizeMin: 0.05,
  sizeMax: 1000,
  characters: 240000,
};

const component = z
  .number()
  .finite()
  .min(-SCENE_LIMITS.vector)
  .max(SCENE_LIMITS.vector);
const vec = z.tuple([component, component, component]);
const size = vec.refine(
  (v) => v.every((n) => n >= SCENE_LIMITS.sizeMin && n <= SCENE_LIMITS.sizeMax),
  "Ukuran harus 0,05–1000 stud",
);
const meshGroups = z
  .array(
    z
      .object({
        color: z.string().regex(/^#[0-9a-f]{6}$/i),
        faces: z.array(z.number().int().nonnegative()).min(1),
        // Area of the photo the group's faces were sampled from. The server
        // writes it so an exported texture uses the very pixels behind the
        // colour; a model-authored mesh may leave it out.
        region: z
          .tuple([
            z.number().min(0).max(1),
            z.number().min(0).max(1),
            z.number().min(0).max(1),
            z.number().min(0).max(1),
          ])
          .optional(),
      })
      .strict(),
  )
  .max(GROUPS_MAX);
const mesh = z
  .object({
    vertices: z.array(vec).min(3).max(SCENE_LIMITS.meshVertices),
    faces: z
      .array(
        z.tuple([
          z.number().int().nonnegative(),
          z.number().int().nonnegative(),
          z.number().int().nonnegative(),
        ]),
      )
      .max(SCENE_LIMITS.meshFaces),
    // Per-face colours (usually sampled from a photo). A face in no group uses
    // the object's own colour.
    groups: meshGroups.optional(),
  })
  .refine(
    (m) =>
      m.faces.every(
        (f) => new Set(f).size === 3 && f.every((i) => i < m.vertices.length),
      ),
    "Indeks face tidak valid",
  )
  .refine((m) => {
    const seen = new Set();
    for (const group of m.groups || [])
      for (const index of group.faces) {
        // A face cannot have two colours at once.
        if (seen.has(index)) return false;
        if (index >= m.faces.length) return false;
        seen.add(index);
      }
    return true;
  }, "Grup warna tidak valid (face ganda atau di luar jangkauan)");
export const sceneObjectSchema = z
  .object({
    id: z.string().min(1).max(100),
    name: z.string().trim().min(1).max(80),
    kind: z.enum(["block", "sphere", "cylinder", "mesh", "model"]),
    parent: z.string().max(100).nullable(),
    position: vec,
    rotation: vec,
    size,
    color: z.string().regex(/^#[0-9a-f]{6}$/i),
    anchored: z.boolean(),
    mesh: mesh.optional(),
  })
  .refine(
    (o) => o.kind !== "mesh" || !!o.mesh,
    "Mesh memerlukan vertices dan faces",
  );
export const sceneSchema = z
  .object({
    version: z.literal(1),
    objects: z.array(sceneObjectSchema).max(SCENE_LIMITS.objects),
  })
  .superRefine((s, ctx) => {
    const ids = new Set(s.objects.map((o) => o.id));
    if (ids.size !== s.objects.length)
      ctx.addIssue({ code: "custom", message: "ID objek harus unik" });
    for (const o of s.objects) {
      const seen = new Set([o.id]);
      let parent = o.parent;
      while (parent) {
        const p = s.objects.find((n) => n.id === parent);
        if (!p || p.kind !== "model" || seen.has(parent)) {
          ctx.addIssue({
            code: "custom",
            message: "Struktur parent tidak valid",
          });
          break;
        }
        seen.add(parent);
        parent = p.parent;
      }
    }
  });

const change = z
  .object({
    target: z.string().trim().min(1).max(100),
    move: vec.optional(),
    rotate: vec.optional(),
    scale: z
      .union([z.number().finite().min(SCENE_LIMITS.sizeMin).max(100), size])
      .optional(),
    color: z
      .string()
      .regex(/^#[0-9a-f]{6}$/i)
      .optional(),
  })
  .strict()
  .refine(
    (c) =>
      c.move !== undefined ||
      c.rotate !== undefined ||
      c.scale !== undefined ||
      c.color !== undefined,
    "Operasi tidak mengubah apa pun",
  );

const hex = z.string().regex(/^#[0-9a-f]{6}$/i);

/**
 * One node of a model built from a description (usually a photo). A node is
 * either a shape the server knows how to build, or geometry the model spelled
 * out itself; a node with children is a plain container, so a shape is never
 * silently dropped.
 */
const buildNode = z.lazy(() =>
  z
    .object({
      name: z.string().trim().min(1).max(60),
      shape: z.enum(SHAPES).optional(),
      segments: z.number().int().min(SEGMENTS_MIN).max(SEGMENTS_MAX).optional(),
      mesh: mesh.optional(),
      position: vec.optional(),
      rotation: vec.optional(),
      size: size.optional(),
      color: hex.optional(),
      // Normalized box on the photo this shape's colours come from:
      // [x0, y0, x1, y1], 0..1, x left→right, y top→bottom.
      region: z
        .tuple([
          z.number().min(0).max(1),
          z.number().min(0).max(1),
          z.number().min(0).max(1),
          z.number().min(0).max(1),
        ])
        .refine(
          (r) => Math.abs(r[2] - r[0]) >= 0.01 && Math.abs(r[3] - r[1]) >= 0.01,
          "Region warna terlalu kecil",
        )
        .optional(),
      nodes: z.array(buildNode).max(BUILD_CHILDREN_MAX).optional(),
    })
    .strict()
    .refine((n) => !(n.shape && n.mesh), "Pilih salah satu: shape atau mesh")
    .refine(
      (n) => !n.segments || ["sphere", "cylinder", "cone"].includes(n.shape),
      "segments hanya berlaku untuk sphere, cylinder, atau cone",
    )
    .refine(
      (n) => !n.nodes?.length || (!n.shape && !n.mesh),
      "Node yang punya anak harus jadi wadah model tanpa bentuk sendiri",
    )
    .refine(
      (n) => Boolean(n.nodes?.length) || Boolean(n.shape || n.mesh),
      "Node tanpa anak harus punya shape atau mesh",
    ),
);

// One entry per op kind, so a new kind is added explicitly and anything else is
// reported as unsupported instead of being silently dropped.
const opEntry = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("scene.transform"),
      ops: z.array(change).min(1).max(OPS_MAX),
    })
    .strict(),
  z
    .object({
      kind: z.literal("scene.build"),
      name: z.string().trim().min(1).max(80),
      // Which attached photo this model was read from. Checked against the
      // request, so "made from photo 2" is never accepted when one was sent.
      photo: z.number().int().min(1).max(3).optional(),
      parent: z.string().trim().min(1).max(100).optional(),
      position: vec.optional(),
      rotation: vec.optional(),
      color: hex.optional(),
      // Bake every node into one mesh object instead of one object per shape.
      asMesh: z.boolean().optional(),
      nodes: z.array(buildNode).min(1).max(BUILD_NODES_MAX),
    })
    .strict()
    .refine(
      (op) => !op.asMesh || op.nodes.every((n) => !n.nodes?.length),
      "asMesh hanya untuk daftar node datar; jangan pakai nodes bersarang",
    ),
]);
export const opsSchema = z.array(opEntry).min(1).max(OPS_MAX);

const round = (n) => Number(n.toFixed(3));
const trimmed = (v) => JSON.stringify(v.map(round));

/** Resolves a target string to exactly one object; ambiguity is a rejection. */
function resolveTarget(objects, target) {
  const byId = objects.find((o) => o.id === target);
  if (byId) return byId;
  const lower = target.toLowerCase();
  const byName = objects.filter((o) => o.name.toLowerCase() === lower);
  if (byName.length === 1) return byName[0];
  return {
    error: byName.length
      ? "Nama dipakai lebih dari satu objek"
      : "Objek tidak ditemukan",
  };
}

/** Descendants of a model, so scaling it also scales what it contains. */
function descendants(objects, id) {
  const out = [];
  const queue = objects.filter((o) => o.parent === id);
  while (queue.length) {
    const next = queue.shift();
    out.push(next);
    queue.push(...objects.filter((o) => o.parent === next.id));
  }
  return out;
}

function applyChange(objects, change, report) {
  const found = resolveTarget(objects, change.target);
  if (found.error) {
    report.rejected.push({
      kind: "scene.transform",
      target: change.target,
      reason:
        found.error === "Objek tidak ditemukan"
          ? `Objek "${change.target}" tidak ditemukan`
          : `Nama "${change.target}" dipakai lebih dari satu objek; pakai ID`,
    });
    return false;
  }
  const changes = [];
  const touched =
    change.scale !== undefined
      ? [found, ...descendants(objects, found.id)]
      : [found];
  if (change.move) {
    for (const object of [found]) {
      object.position = object.position.map((n, i) =>
        round(n + change.move[i]),
      );
    }
    changes.push("geser " + trimmed(change.move));
  }
  if (change.rotate) {
    for (const object of [found]) {
      object.rotation = object.rotation.map((n, i) =>
        round(n + change.rotate[i]),
      );
    }
    changes.push("putar " + trimmed(change.rotate) + " derajat");
  }
  if (change.scale !== undefined) {
    const factors = Array.isArray(change.scale)
      ? change.scale
      : [change.scale, change.scale, change.scale];
    for (const object of touched) {
      object.position = object.position.map((n, i) => round(n * factors[i]));
      // A model size is ignored by the renderer, so only its descendants grow.
      if (object.kind !== "model")
        object.size = object.size.map((n, i) => round(n * factors[i]));
    }
    changes.push(
      "skala " +
        trimmed(factors) +
        (touched.length > 1 ? ` (${touched.length - 1} turunan)` : ""),
    );
  }
  if (change.color) {
    found.color = change.color.toLowerCase();
    changes.push("warna " + change.color.toLowerCase());
  }
  report.applied.push({
    kind: "scene.transform",
    target: change.target,
    id: found.id,
    name: found.name,
    changes,
  });
  return true;
}

const DEFAULT_BUILD_COLOR = "#a1a1aa";

const slug = (value) =>
  String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "objek";

/** A stable, readable id that cannot collide with the scene or a sibling. */
function freshId(objects, taken, name) {
  const root = "ai-" + slug(name);
  let id = root;
  let n = 2;
  while (taken.has(id) || objects.some((o) => o.id === id))
    id = `${root}-${n++}`;
  taken.add(id);
  return id;
}

/** The geometry one node describes: a built shape, or the model's own mesh. */
function nodeMesh(node) {
  if (node.mesh)
    return { vertices: node.mesh.vertices, faces: node.mesh.faces };
  const mesh = shapeMesh(node.shape || "box", { segments: node.segments });
  return mesh ? { vertices: mesh.vertices, faces: mesh.faces } : null;
}

/**
 * `scene.build` — the op that turns a described object into scene geometry.
 *
 * The model supplies a tree of shapes (usually read from an attached photo);
 * the server builds every vertex itself, so nothing is invented and the result
 * is the same every time. Geometry only appears as Roblox Parts where a Part
 * exists, meshes elsewhere, or as ONE merged mesh when `asMesh` is asked for.
 * A claim to be "from photo n" is checked against the photos actually attached:
 * a model built from a photo that was never sent is refused, not accepted.
 */
function applyBuild(objects, op, { photos = 0, palettes = [] } = {}, report) {
  const target = op.name;
  const reject = (reason) => {
    report.rejected.push({ kind: "scene.build", target, reason });
    return false;
  };
  if (op.photo !== undefined && op.photo > photos)
    return reject(
      photos
        ? `Operasi ini dibuat dari foto ${op.photo}, tetapi permintaan ini hanya melampirkan ${photos} foto. Tidak ada yang diterapkan dari foto yang tidak ada.`
        : `Operasi ini dibuat dari foto ${op.photo}, tetapi permintaan ini tidak melampirkan foto apa pun. Lampirkan fotonya lalu kirim ulang.`,
    );
  const flat = [];
  const walk = (nodes, parent) => {
    for (const node of nodes) {
      flat.push({ node, parent });
      if (node.nodes?.length) walk(node.nodes, node);
    }
  };
  walk(op.nodes, null);
  if (flat.length > BUILD_NODES_MAX)
    return reject(
      `Model ini meminta ${flat.length} bagian; batasnya ${BUILD_NODES_MAX} per operasi. Kurangi detail atau pecah jadi beberapa operasi.`,
    );
  if (objects.length + flat.length + 1 > SCENE_LIMITS.objects)
    return reject(
      `Scene sudah berisi ${objects.length} objek; menambah ${flat.length + 1} objek lagi melewati batas ${SCENE_LIMITS.objects}. Hapus objek lain dulu.`,
    );
  let parentId = null;
  if (op.parent) {
    const found = resolveTarget(objects, op.parent);
    if (found.error)
      return reject(`Induk "${op.parent}" tidak ditemukan di scene ini.`);
    if (found.kind !== "model")
      return reject(
        `Induk "${op.parent}" adalah ${found.kind}, bukan model, jadi tidak bisa menampung objek baru.`,
      );
    parentId = found.id;
  }
  const containerPosition = op.position || [0, 0, 0];
  const containerRotation = op.rotation || [0, 0, 0];
  // Every node is baked in the container's space: honest bounds, and the exact
  // geometry an `asMesh` result needs.
  // The palette of the photo this op was read from, when the client sampled one.
  const palette = op.photo ? paletteFor(palettes, op.photo) : null;
  if (op.photo && flat.some((entry) => entry.node.region) && !palette)
    return reject(
      `Operasi ini memakai region warna dari foto ${op.photo}, tetapi sampel warna foto itu tidak ada${photos ? "" : " (tidak ada foto yang dilampirkan)"}. Lampirkan ulang fotonya supaya warnanya benar-benar diambil dari piksel foto.`,
    );
  const built = flat.map(({ node, parent }) => {
    const mesh = nodeMesh(node);
    const size = node.size || [1, 1, 1];
    const rotation = node.rotation || [0, 0, 0];
    const position = node.position || [0, 0, 0];
    // Colour precedence, from the most photo-true to the least:
    //  1. a region the model pointed at → sampled from the photo's pixels;
    //  2. the model's own hex → kept, and reported as the model's choice;
    //  3. the photo as a whole, when the model cited a photo but gave no region;
    //  4. the neutral default.
    let color = (node.color || "").toLowerCase() || null;
    let source = color ? "ai" : "default";
    if (palette && node.region) {
      color = regionColor(palette, node.region);
      source = "photo";
    } else if (palette && op.photo) {
      color = regionColor(palette, [0, 0, 1, 1]);
      source = "photo-full";
    }
    return {
      node,
      parent,
      size,
      color: color || DEFAULT_BUILD_COLOR,
      colorSource: source,
      region: node.region || null,
      baked: mesh ? transformMesh(mesh, { size, rotation, position }) : null,
      mesh,
    };
  });
  // Per-face colours for mesh surfaces, from the same region.
  for (const entry of built) {
    entry.groups = null;
    // A standalone Part can only carry one colour, but inside an `asMesh`
    // merge every node becomes faces of one mesh, so those faces can be painted
    // one by one as well.
    if (
      palette &&
      entry.region &&
      entry.mesh &&
      (op.asMesh || nodeKind(entry.node) === "mesh")
    ) {
      const sampled = faceGroups(
        palette,
        entry.region,
        entry.mesh,
        entry.color,
      );
      entry.groups = sampled.groups;
      entry.droppedGroups = sampled.dropped;
    }
  }
  if (built.some((entry) => !entry.mesh))
    return reject("Ada bagian dengan bentuk yang tidak dikenal server ini.");
  const merged = mergeMeshes(built.map((entry) => entry.baked));
  // A merged model keeps its photo colours: every merged face remembers which
  // node (and which face) it came from, so the groups can be rebuilt exactly.
  const mergedGroups = (() => {
    if (!built.some((entry) => entry.groups)) return null;
    const byColor = new Map();
    merged.faceOrigin.forEach((origin, index) => {
      const entry = built[origin];
      const group = entry.groups?.find((candidate) =>
        candidate.faces.includes(merged.faceLocal[index]),
      );
      const color = group?.color || entry.color;
      const region = group?.region || entry.region || null;
      // Colour *and* area: two parts of the same colour taken from different
      // places on the photo must stay two groups, or one part would be textured
      // with the other's pixels.
      const key = `${color}|${region ? region.map(round3).join(",") : ""}`;
      const found = byColor.get(key) || { color, region, faces: [] };
      found.faces.push(index);
      byColor.set(key, found);
    });
    const groups = [...byColor.values()].map((group) => ({
      color: group.color,
      faces: group.faces,
      ...(group.region ? { region: group.region } : {}),
    }));
    groups.sort((a, b) => b.faces.length - a.faces.length);
    const kept = groups.slice(0, GROUPS_MAX);
    // Every face is covered: whatever is left keeps the object's own colour.
    const covered = new Set(kept.flatMap((group) => group.faces));
    if (covered.size !== merged.faces.length)
      kept.push({
        color: (op.color || built[0].color).toLowerCase(),
        faces: merged.faces
          .map((_, index) => index)
          .filter((index) => !covered.has(index)),
      });
    return kept.filter((group) => group.faces.length);
  })();
  const budget = meshBudget(merged, {
    maxVertices: SCENE_LIMITS.meshVertices,
    maxFaces: SCENE_LIMITS.meshFaces,
  });
  const bounds = merged.vertices.reduce(
    (box, vertex) =>
      box.map(([lo, hi], i) => [
        Math.min(lo, vertex[i]),
        Math.max(hi, vertex[i]),
      ]),
    [
      [Infinity, -Infinity],
      [Infinity, -Infinity],
      [Infinity, -Infinity],
    ],
  );
  const extent = bounds.map(([lo, hi]) =>
    Number.isFinite(lo) ? round3(hi - lo) : 0,
  );
  const taken = new Set();
  const meshParts = built.filter((entry) => nodeKind(entry.node) === "mesh");
  const summary = [
    op.photo ? `dari foto ${op.photo}` : "",
    `ukurannya ≈ ${extent.join(" × ")} stud`,
    scopeSummary(built),
  ].filter(Boolean);
  if (op.asMesh) {
    if (!budget.fits)
      return reject(
        `Model gabungan ini butuh ${budget.vertices} vertex dan ${budget.faces} face, sedangkan batas scene ${budget.maxVertices}/${budget.maxFaces}. Kurangi jumlah bagian, kecilkan \`segments\`, atau kirim tanpa asMesh supaya tiap bentuk jadi objek sendiri.`,
      );
    const colors = [...new Set(built.map((entry) => entry.color))];
    // The colours the photo actually produced, so the chat can show them as
    // swatches instead of asking the reader to trust a count.
    // One row per colour: the mesh keeps a group per colour *and* per photo
    // area (so the atlas can take pixels from the right place), but the chat
    // reports colours a person reads — two areas that happen to be the same
    // colour must not read as "3 colours" when there are only two.
    const colorGroups = [
      ...(mergedGroups || [])
        .reduce((byColor, group) => {
          const faces = byColor.get(group.color) || 0;
          return byColor.set(group.color, faces + group.faces.length);
        }, new Map())
        .entries(),
    ]
      .map(([color, faces]) => ({ color, faces }))
      .sort((a, b) => b.faces - a.faces);
    const color = (op.color || colors[0]).toLowerCase();
    const id = freshId(objects, taken, op.name);
    objects.push({
      id,
      name: op.name,
      kind: "mesh",
      parent: parentId,
      position: containerPosition,
      rotation: containerRotation,
      size: [1, 1, 1],
      color,
      anchored: true,
      mesh: {
        vertices: merged.vertices,
        faces: merged.faces,
        ...(mergedGroups?.length ? { groups: mergedGroups } : {}),
      },
    });
    report.applied.push({
      kind: "scene.build",
      target,
      id,
      name: op.name,
      photo: op.photo ?? null,
      asMesh: true,
      parts: [],
      geometry: { vertices: budget.vertices, faces: budget.faces },
      colorSource: mergedGroups?.length
        ? "photo-faces"
        : built.some((entry) => entry.colorSource === "photo")
          ? "photo"
          : built.some((entry) => entry.colorSource === "ai")
            ? "ai"
            : "default",
      groups: mergedGroups?.length || 0,
      colorGroups,
      changes: [
        ...summary,
        `1 mesh gabungan: ${budget.vertices} vertex, ${budget.faces} face`,
        ...colorNote(
          {
            groups: mergedGroups?.length || 0,
            sources: built.map((entry) => entry.colorSource),
          },
          { color, colors, photo: op.photo },
        ),
      ],
    });
    return true;
  }
  const partColorGroups = [
    ...built
      .flatMap((entry) => entry.groups || [])
      .reduce((byColor, group) => {
        const faces = byColor.get(group.color) || 0;
        return byColor.set(group.color, faces + group.faces.length);
      }, new Map())
      .entries(),
  ]
    .map(([color, faces]) => ({ color, faces }))
    .sort((a, b) => b.faces - a.faces)
    .slice(0, GROUPS_MAX);
  const containerId = freshId(objects, taken, op.name);
  objects.push({
    id: containerId,
    name: op.name,
    kind: "model",
    parent: parentId,
    position: containerPosition,
    rotation: containerRotation,
    size: [1, 1, 1],
    color: (op.color || DEFAULT_BUILD_COLOR).toLowerCase(),
    anchored: true,
  });
  const ids = new Map();
  for (const entry of built) {
    const id = freshId(objects, taken, entry.node.name);
    objects.push({
      id,
      name: entry.node.name,
      kind: nodeKind(entry.node),
      parent: entry.parent
        ? (ids.get(entry.parent) ?? containerId)
        : containerId,
      position: entry.node.position || [0, 0, 0],
      rotation: entry.node.rotation || [0, 0, 0],
      size: entry.size,
      color: entry.color,
      anchored: true,
      ...(nodeKind(entry.node) === "mesh"
        ? {
            mesh: {
              vertices: entry.mesh.vertices,
              faces: entry.mesh.faces,
              ...(entry.groups?.length ? { groups: entry.groups } : {}),
            },
          }
        : {}),
    });
    ids.set(entry.node, id);
  }
  report.applied.push({
    kind: "scene.build",
    target,
    id: containerId,
    name: op.name,
    photo: op.photo ?? null,
    asMesh: false,
    parts: built.map((entry) => ({
      name: entry.node.name,
      kind: nodeKind(entry.node),
      shape:
        entry.node.shape ||
        (entry.node.mesh ? "mesh" : entry.node.nodes?.length ? "model" : "box"),
      ...(nodeKind(entry.node) === "mesh"
        ? {
            vertices: entry.mesh.vertices.length,
            faces: entry.mesh.faces.length,
          }
        : {}),
    })),
    geometry: meshParts.length
      ? {
          vertices: meshParts.reduce((n, e) => n + e.mesh.vertices.length, 0),
          faces: meshParts.reduce((n, e) => n + e.mesh.faces.length, 0),
        }
      : null,
    colorSource: built.some((entry) => entry.colorSource === "photo")
      ? built.some((entry) => entry.groups?.length)
        ? "photo-faces"
        : "photo"
      : built.some((entry) => entry.colorSource === "ai")
        ? "ai"
        : "default",
    groups: built.reduce((n, entry) => n + (entry.groups?.length || 0), 0),
    // Per-mesh groups in one list, one row per colour, biggest first and capped
    // like a merged mesh is: two parts of the same colour are one swatch. With
    // no photo colours at all the field is left out entirely.
    ...(partColorGroups.length ? { colorGroups: partColorGroups } : {}),
    changes: [
      ...summary,
      `${built.length} bagian`,
      ...(meshParts.length
        ? [
            `${meshParts.length} mesh: ${meshParts.reduce((n, e) => n + e.mesh.vertices.length, 0)} vertex, ${meshParts.reduce((n, e) => n + e.mesh.faces.length, 0)} face`,
          ]
        : []),
      ...colorNote(
        {
          groups: built.reduce(
            (n, entry) => n + (entry.groups?.length || 0),
            0,
          ),
          sources: built.map((entry) => entry.colorSource),
          dropped: built.reduce(
            (n, entry) => n + (entry.droppedGroups || 0),
            0,
          ),
        },
        {
          color: null,
          colors: [...new Set(built.map((e) => e.color))],
          photo: op.photo,
        },
      ),
    ],
  });
  return true;
}

/** The scene kind a node becomes: a Part where one exists, a mesh otherwise. */
function nodeKind(node) {
  if (node.nodes?.length) return "model";
  if (node.mesh) return "mesh";
  if (node.segments) return "mesh";
  return PART_KIND[node.shape || "box"] || "mesh";
}

/**
 * One honest sentence about the colours: where they came from, and — when a
 * merged mesh carries no per-face groups — the flat-colour limit.
 */
const colorNote = ({ groups = 0, sources = [], dropped = 0 } = {}, context) => {
  const fromPhoto = sources.filter(
    (s) => s === "photo" || s === "photo-full",
  ).length;
  const chose = sources.filter((s) => s === "ai").length;
  const lines = [];
  if (groups)
    lines.push(
      `warna per sisi diambil dari piksel foto ${context.photo} (${groups} grup warna) — bukan peta tekstur UV`,
    );
  else if (fromPhoto)
    lines.push(
      `warna diambil dari rata-rata area foto ${context.photo}${context.color ? ` → ${context.color}` : ""} — bukan peta tekstur UV`,
    );
  if (chose)
    lines.push(
      `${chose} bagian memakai warna pilihan AI (foto tidak menunjukkan bagian itu)`,
    );
  if (dropped)
    lines.push(
      `${dropped} grup warna dilebihkan dari batas ${GROUPS_MAX}; sisanya memakai warna objek`,
    );
  if (groups)
    lines.push(
      "Roblox mengabaikan warna di file OBJ; kalau foto project masih tersimpan di browser ini, tombol Ekspor GLB di panel Properti membawa tekstur asli foto itu ke Studio (satu file, tekstur 1024×1024 tertanam)",
    );
  else if (context.colors?.length > 1 && !fromPhoto)
    lines.push(
      `satu mesh hanya punya satu warna, jadi dipakai ${context.color || context.colors[0]}`,
    );
  return lines;
};

const scopeSummary = (built) => {
  const counts = new Map();
  for (const entry of built) {
    const kind = nodeKind(entry.node);
    counts.set(kind, (counts.get(kind) || 0) + 1);
  }
  return [...counts.entries()].map(([kind, n]) => `${n} ${kind}`).join(" · ");
};

export function parseOps(value) {
  const parsed = opsSchema.safeParse(value);
  if (parsed.success) return { value: parsed.data, issues: [] };
  const issues = parsed.error.issues.slice(0, 10).map((i) => {
    const where = i.path.join(".") || "ops";
    if (/Too small: expected array to have >=1 items/.test(i.message))
      return `${where}: operasi scene.build butuh minimal satu bagian di "nodes"`;
    const tooBig = /Too big: expected array to have <=(\d+) items/.exec(
      i.message,
    );
    if (tooBig && /nodes$/.test(where))
      return `${where}: terlalu banyak bagian (maksimum ${tooBig[1]}); pecah jadi beberapa operasi scene.build`;
    if (/Invalid discriminator/.test(i.message))
      return `${where}: jenis operasi tidak didukung (hanya scene.transform dan scene.build)`;
    if (/Unrecognized key/.test(i.message))
      return `${where}: ada kolom yang tidak dikenal pada operasi`;
    return `${where}: ${i.message}`;
  });
  return { value: [], issues };
}

/**
 * Applies an ops batch to a saved scene. Atomic on purpose: if any single op is
 * invalid the scene is left untouched, so a review never shows a half-applied
 * batch. Returns the scene text, or null when nothing may be written.
 */
export function applySceneOps({ scene, ops, photos = 0, palettes = [] }) {
  const report = {
    version: OPS_VERSION,
    applied: [],
    rejected: [],
    sceneChanged: false,
    note: "",
  };
  if (scene === undefined || scene === null || scene === "") {
    report.note = `${SCENE_PATH} belum ada di project ini, jadi operasi tidak diterapkan.`;
    return { scene: null, report };
  }
  let parsed;
  try {
    parsed = typeof scene === "string" ? JSON.parse(scene) : scene;
  } catch {
    report.note = `${SCENE_PATH} tidak dapat dibaca sebagai JSON, jadi operasi tidak diterapkan.`;
    return { scene: null, report };
  }
  const valid = sceneSchema.safeParse(parsed);
  if (!valid.success) {
    report.note = `${SCENE_PATH} tidak lolos validasi skema (${valid.error.issues[0]?.message || "tidak diketahui"}), jadi operasi tidak diterapkan.`;
    return { scene: null, report };
  }
  const { value, issues } = parseOps(ops);
  if (issues.length) {
    report.rejected.push({
      kind: "ops",
      target: "",
      reason: issues.join("; "),
    });
    report.note =
      "Batch operasi tidak valid, jadi tidak ada perubahan diterapkan.";
    return { scene: null, report };
  }
  const working = structuredClone(valid.data);
  for (const entry of value) {
    const entryReport = { applied: [], rejected: [] };
    if (entry.kind === "scene.build")
      applyBuild(working.objects, entry, { photos, palettes }, entryReport);
    else
      for (const item of entry.ops)
        applyChange(working.objects, item, entryReport);
    if (entryReport.rejected.length) {
      report.rejected.push(...entryReport.rejected);
      report.note =
        "Ada operasi yang tidak dapat diterapkan, jadi tidak ada perubahan diterapkan (batch bersifat semua-atau-tidak).";
      return { scene: null, report };
    }
    report.applied.push(...entryReport.applied);
  }
  const finalCheck = sceneSchema.safeParse(working);
  if (!finalCheck.success) {
    report.applied = [];
    report.rejected.push({
      kind: "scene.transform",
      target: "",
      reason: finalCheck.error.issues[0]?.message || "Hasil tidak valid",
    });
    report.note =
      "Hasil operasi melanggar batas scene, jadi tidak ada perubahan diterapkan.";
    return { scene: null, report };
  }
  const text = JSON.stringify(finalCheck.data, null, 2);
  if (text.length > SCENE_LIMITS.characters) {
    report.applied = [];
    report.rejected.push({
      kind: "scene.transform",
      target: "",
      reason: `Scene melebihi ${SCENE_LIMITS.characters} karakter`,
    });
    report.reason = `Hasil operasi terlalu besar untuk disimpan (batas ${SCENE_LIMITS.characters} karakter untuk ${SCENE_PATH}). Kurangi jumlah bagian atau kecilkan \`segments\` supaya geometrinya lebih ringkas.`;
    report.rejected[report.rejected.length - 1].reason = report.reason;
    report.note = "Hasil operasi terlalu besar untuk disimpan.";
    return { scene: null, report };
  }
  report.sceneChanged = true;
  report.note = `${report.applied.length} operasi diterapkan pada ${SCENE_PATH}. Tinjau sebelum dipakai.`;
  return { scene: text, report };
}

/**
 * Turns an AI result that may carry ops into files plus an honest report.
 * `saved` is the file set the browser sent with the request: that is the scene
 * ops are applied to. `files` is what the reply proposed.
 * Only Roblox Builder replies may change geometry; ops on anything else are
 * dropped with a note instead of being ignored silently.
 */
export function applyResultOps({
  kind,
  mode,
  files,
  saved,
  result,
  photos = 0,
  palettes = [],
}) {
  if (!result?.ops?.length) return { files, report: null };
  if (kind !== "roblox" || mode !== "Builder")
    return {
      files,
      report: {
        version: OPS_VERSION,
        applied: [],
        rejected: result.ops.map((entry) => ({
          kind: entry?.kind || "ops",
          target: "",
          reason:
            kind !== "roblox"
              ? "Operasi scene hanya berlaku untuk project Roblox"
              : "Operasi scene hanya dijalankan pada mode Builder",
        })),
        sceneChanged: false,
        note: "Tidak ada operasi scene yang dijalankan.",
      },
    };
  // A reply that carries ops may not also replace the scene file: the batch is
  // authoritative, so an invalid scene cannot slip in beside it.
  const proposed = { ...(files || {}) };
  const replacedScene = proposed[SCENE_PATH] !== undefined;
  delete proposed[SCENE_PATH];
  const trimmed = replacedScene ? proposed : files;
  const { scene, report } = applySceneOps({
    scene: saved?.[SCENE_PATH],
    ops: result.ops,
    photos,
    palettes,
  });
  if (!scene) return { files: trimmed, report };
  const hasFiles = Object.keys(proposed).length > 0;
  return { files: { ...proposed, [SCENE_PATH]: scene }, report, hasFiles };
}

/** Validates ops coming straight from a model reply, before they are applied. */
export function validateResultOps(value) {
  if (value === undefined) return undefined;
  const { value: ops, issues } = parseOps(value);
  if (issues.length)
    throw new HttpError(
      502,
      "Struktur operasi scene dari AI tidak valid: " + issues[0],
    );
  return ops;
}
