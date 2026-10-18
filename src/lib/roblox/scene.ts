import { z } from "zod";
export const SCENE_PATH = "scene.roblox.json";
const vec = z.tuple([
  z.number().finite().min(-10000).max(10000),
  z.number().finite().min(-10000).max(10000),
  z.number().finite().min(-10000).max(10000),
]);
/** Faces that share a colour — usually sampled from a photo. */
export const MESH_GROUPS_MAX = 24;
const mesh = z
  .object({
    vertices: z.array(vec).min(3).max(512),
    faces: z
      .array(
        z.tuple([
          z.number().int().nonnegative(),
          z.number().int().nonnegative(),
          z.number().int().nonnegative(),
        ]),
      )
      .max(1024),
    groups: z
      .array(
        z.object({
          color: z.string().regex(/^#[0-9a-f]{6}$/i),
          faces: z.array(z.number().int().nonnegative()).min(1),
          // The rectangle of the photo this group's faces were sampled from,
          // kept so the colours can become a real texture at export time.
          region: z
            .tuple([z.number(), z.number(), z.number(), z.number()])
            .optional(),
        }),
      )
      .max(MESH_GROUPS_MAX)
      .optional(),
  })
  .refine(
    (m) =>
      m.faces.every(
        (f) => new Set(f).size === 3 && f.every((i) => i < m.vertices.length),
      ),
    "Indeks face tidak valid",
  )
  .refine((m) => {
    // A face carries one colour: a face listed twice, or listed outside the
    // mesh, is a broken scene and must never render.
    const seen = new Set<number>();
    for (const group of m.groups || [])
      for (const index of group.faces) {
        if (seen.has(index) || index >= m.faces.length) return false;
        seen.add(index);
      }
    return true;
  }, "Grup warna mesh tidak valid (face ganda atau di luar jangkauan)");
export const objectSchema = z
  .object({
    id: z.string().min(1).max(100),
    name: z.string().trim().min(1).max(80),
    kind: z.enum(["block", "sphere", "cylinder", "mesh", "model"]),
    parent: z.string().max(100).nullable(),
    position: vec,
    rotation: vec,
    size: vec.refine(
      (v) => v.every((n) => n >= 0.05 && n <= 1000),
      "Ukuran harus 0,05–1000 stud",
    ),
    color: z.string().regex(/^#[0-9a-f]{6}$/i),
    anchored: z.boolean(),
    mesh: mesh.optional(),
  })
  .refine(
    (o) => o.kind !== "mesh" || !!o.mesh,
    "Mesh memerlukan vertices dan faces",
  );
export const sceneSchema = z
  .object({ version: z.literal(1), objects: z.array(objectSchema).max(250) })
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
            message: "Parent harus Model yang valid dan tidak membentuk siklus",
          });
          break;
        }
        seen.add(parent);
        parent = p.parent;
      }
    }
  });
export type SceneObject = z.infer<typeof objectSchema>;
/** The custom geometry one object may carry. */
export type SceneMesh = NonNullable<SceneObject["mesh"]>;
export type RobloxScene = z.infer<typeof sceneSchema>;
export function newObject(kind: SceneObject["kind"]): SceneObject {
  return {
    id: crypto.randomUUID(),
    name: kind === "model" ? "Model" : kind === "mesh" ? "Mesh baru" : "Part",
    kind,
    parent: null,
    position: [0, 2, 0],
    rotation: [0, 0, 0],
    size: [4, 4, 4],
    color: "#6daea1",
    anchored: true,
    ...(kind === "mesh"
      ? {
          mesh: {
            vertices: [
              [-0.5, 0, 0],
              [0.5, 0, 0],
              [0, 1, 0],
            ],
            faces: [[0, 1, 2]],
          },
        }
      : {}),
  };
}
export function initialScene(): RobloxScene {
  return {
    version: 1,
    objects: [
      {
        ...newObject("block"),
        id: "baseplate",
        name: "Baseplate",
        position: [0, -0.5, 0],
        size: [40, 1, 40],
        color: "#65736e",
      },
    ],
  };
}
export function deleteObject(scene: RobloxScene, id: string): RobloxScene {
  const removed = new Set([id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const o of scene.objects)
      if (o.parent && removed.has(o.parent) && !removed.has(o.id)) {
        removed.add(o.id);
        changed = true;
      }
  }
  return { ...scene, objects: scene.objects.filter((o) => !removed.has(o.id)) };
}
/**
 * Expands a grouped mesh into non-indexed triangles with a colour per vertex.
 * Three.js cannot give two faces of one mesh different colours while they share
 * a vertex, so the geometry is expanded — that is what the renderer and the
 * export both need, and both read it from here.
 */
export function meshPhotoColors(
  mesh: NonNullable<SceneObject["mesh"]>,
  fallback: string,
) {
  const colorOf = new Map<number, string>();
  for (const group of mesh.groups || [])
    for (const index of group.faces) colorOf.set(index, group.color);
  const rgb = (hex: string) => [
    parseInt(hex.slice(1, 3), 16) / 255,
    parseInt(hex.slice(3, 5), 16) / 255,
    parseInt(hex.slice(5, 7), 16) / 255,
  ];
  const position: number[] = [];
  const color: number[] = [];
  mesh.faces.forEach((face, index) => {
    const [r, g, b] = rgb(colorOf.get(index) || fallback);
    for (const vertex of face) {
      position.push(...mesh.vertices[vertex]);
      color.push(r, g, b);
    }
  });
  return { position, color };
}

export function meshOBJ(object: SceneObject) {
  if (!object.mesh) throw new Error("Pilih mesh kustom.");
  objectSchema.parse(object);
  const groups = object.mesh.groups || [];
  if (!groups.length)
    return (
      [
        "# PiwuApp mesh; local coordinates, import scale separately",
        "o PiwuMesh",
        ...object.mesh.vertices.map((v) => "v " + v.join(" ")),
        ...object.mesh.faces.map((f) => "f " + f.map((i) => i + 1).join(" ")),
      ].join("\n") + "\n"
    );
  // Photo-coloured mesh: every face keeps its own colour, written as vertex
  // colours in the widely-read `v x y z r g b` extension. Roblox itself ignores
  // these, so the export says so instead of pretending.
  const { color: perFace } = meshPhotoColors(object.mesh, object.color);
  const lines = [
    "# PiwuApp mesh dengan warna per sisi dari foto (vertex colour extension)",
    "# Roblox mengabaikan warna di file OBJ ini; pakai Ekspor GLB di panel Properti untuk tekstur.",
    "o PiwuMeshColored",
  ];
  let emitted = 0;
  object.mesh.faces.forEach((face, index) => {
    for (const [slot, vertex] of face.entries()) {
      const v = object.mesh!.vertices[vertex];
      const at = (index * 3 + slot) * 3;
      const rgb = [perFace[at], perFace[at + 1], perFace[at + 2]];
      lines.push(
        `v ${v[0]} ${v[1]} ${v[2]} ${rgb
          .map((value) => Number(value.toFixed(4)))
          .join(" ")}`,
      );
    }
    // Face indices count vertices, not lines: the header above is not a vertex.
    lines.push(`f ${emitted + 1} ${emitted + 2} ${emitted + 3}`);
    emitted += 3;
  });
  return lines.join("\n") + "\n";
}
export function parseOBJ(text: string): SceneObject {
  if (text.length > 1000000) throw new Error("OBJ maksimal 1 MB.");
  const vertices: number[][] = [],
    faces: number[][] = [];
  for (const raw of text.split(/\r?\n/)) {
    const [tag, ...parts] = raw.trim().split(/\s+/);
    if (tag === "v") {
      if (parts.length < 3) throw new Error("Vertex OBJ tidak valid.");
      vertices.push(parts.slice(0, 3).map(Number));
    }
    if (tag === "f") {
      const f = parts
        .map((p) => Number(p.split("/")[0]))
        .map((i) => (i < 0 ? vertices.length + i : i - 1));
      for (let i = 1; i < f.length - 1; i++) faces.push([f[0], f[i], f[i + 1]]);
    }
    if (vertices.length > 512 || faces.length > 1024)
      throw new Error("Maksimal 512 vertex dan 1024 face per mesh.");
  }
  return objectSchema.parse({
    ...newObject("mesh"),
    name: "Mesh impor",
    size: [1, 1, 1],
    mesh: { vertices, faces },
  });
}

/** Validate untrusted AI geometry before committing, preserving the last good scene. */
export function validateSceneChanges(files: Record<string, string>) {
  if (!(SCENE_PATH in files)) return;
  try {
    if (files[SCENE_PATH].length > 240000)
      throw new Error("Scene terlalu besar");
    sceneSchema.parse(JSON.parse(files[SCENE_PATH]));
  } catch {
    throw new Error(
      "Scene usulan AI tidak valid atau melampaui batas. Perubahan belum disimpan; perbaiki scene.roblox.json atau minta AI memperbaikinya.",
    );
  }
}
