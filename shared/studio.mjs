import { z } from "zod";
/**
 * The Studio plugin the app tells people to install. The version is published
 * here so the web panel, the server and the plugin file itself can be checked
 * against one number — tests/studio-plugin.test.ts fails if they drift apart,
 * which is the only warning a user gets that their installed copy is old.
 */
export const STUDIO_PLUGIN = {
  version: "2.2.0",
  file: "PiwuStudio.luau",
  /** The one-download install: a Script wrapped in XML for the Plugins folder. */
  bundle: "PiwuStudio.rbxmx",
  name: "PiwuStudio",
  limits: {
    nodes: 750,
    scripts: 140,
    sourceBytes: 100000,
    snapshotBytes: 4000000,
    changes: 300,
    sceneObjects: 250,
  },
};
export const editableClasses = [
  "Folder",
  "Model",
  "Part",
  "Script",
  "LocalScript",
  "ModuleScript",
];
const id = z.string().regex(/^[\w:.-]{1,100}$/);
const vec = z.tuple([
  z.number().finite().min(-100000).max(100000),
  z.number().finite().min(-100000).max(100000),
  z.number().finite().min(-100000).max(100000),
]);
const path = z
  .string()
  .max(240)
  .refine(
    (s) =>
      /\.lua(u)?$/.test(s) &&
      !s.startsWith("/") &&
      !s.includes("\\") &&
      !/(^|\/)\.\.?($|\/)|(^|\/)\.env/.test(s),
  );
export const studioNodeSchema = z
  .object({
    id,
    parentId: id.or(z.literal("")).nullable(),
    name: z.string().min(1).max(100),
    className: z.string().min(1).max(80),
    scriptPath: path.optional(),
    source: z.string().max(100000).optional(),
    readable: z.boolean().optional(),
    properties: z
      .object({
        position: vec.optional(),
        rotation: vec.optional(),
        size: vec
          .refine((v) => v.every((n) => n >= 0.05 && n <= 1000))
          .optional(),
        color: z
          .string()
          .regex(/^#[\da-f]{6}$/i)
          .optional(),
        anchored: z.boolean().optional(),
        shape: z.enum(["Block", "Ball", "Cylinder"]).optional(),
      })
      .strict(),
  })
  .strict();
export const snapshotSchema = z
  .object({
    version: z.literal(1),
    snapshotId: z.uuid(),
    placeId: z.string().max(40),
    nodes: z.array(studioNodeSchema).max(750),
  })
  .strict()
  .superRefine((s, c) => {
    const ids = new Set(s.nodes.map((n) => n.id));
    if (ids.size !== s.nodes.length)
      c.addIssue({ code: "custom", message: "ID Studio duplikat" });
    const paths = s.nodes.flatMap((n) => (n.scriptPath ? [n.scriptPath] : []));
    if (paths.length > 140 || new Set(paths).size !== paths.length)
      c.addIssue({
        code: "custom",
        message: "Maksimal 140 script; path harus unik",
      });
    for (const n of s.nodes) {
      let p = n.parentId;
      const seen = new Set([n.id]);
      while (p) {
        if (!ids.has(p) || seen.has(p)) {
          c.addIssue({ code: "custom", message: "Parent tidak valid/siklus" });
          break;
        }
        seen.add(p);
        p = s.nodes.find((x) => x.id === p)?.parentId;
      }
    }
    if (JSON.stringify(s).length > 4000000)
      c.addIssue({ code: "custom", message: "Snapshot maksimal 4 MB" });
  });
export const bundleSchema = z
  .object({
    version: z.literal(1),
    id: z.uuid(),
    baseSnapshotId: z.uuid(),
    placeId: z.string().max(40),
    changes: z
      .array(
        z.discriminatedUnion("op", [
          z.object({ op: z.literal("create"), node: studioNodeSchema }),
          z.object({ op: z.literal("update"), node: studioNodeSchema }),
          z.object({ op: z.literal("delete"), id }),
        ]),
      )
      .max(300),
  })
  .strict();
export function canonical(value) {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.keys(value)
        .sort()
        .filter((k) => value[k] !== undefined)
        .map((k) => JSON.stringify(k) + ":" + canonical(value[k]))
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}
export function buildBundle(snapshot, desired, files) {
  snapshot = snapshotSchema.parse(snapshot);
  desired = snapshotSchema.parse(desired);
  if (
    desired.snapshotId !== snapshot.snapshotId ||
    desired.placeId !== snapshot.placeId
  )
    throw Error("Snapshot dasar tidak cocok. Impor ulang dari Studio.");
  const before = new Map(snapshot.nodes.map((n) => [n.id, n]));
  const after = new Map(desired.nodes.map((n) => [n.id, n]));
  const changes = [];
  for (const old of snapshot.nodes) {
    if (!after.has(old.id)) {
      if (!old.parentId || !editableClasses.includes(old.className))
        throw Error("Service atau class read-only tidak boleh dihapus.");
      changes.push({ op: "delete", id: old.id });
    }
  }
  for (const raw of desired.nodes) {
    const old = before.get(raw.id);
    const node = { ...raw };
    if (node.scriptPath) {
      if (typeof files[node.scriptPath] !== "string")
        throw Error(
          "File script hilang: " +
            node.scriptPath +
            ". Hapus objek secara eksplisit, bukan file saja.",
        );
      node.source = files[node.scriptPath];
    }
    if (
      old &&
      (old.className !== node.className || old.scriptPath !== node.scriptPath)
    )
      throw Error(
        "Class/path script objek lama tidak boleh diubah. Buat objek baru.",
      );
    if (!old || canonical(node) !== canonical(old)) {
      if (
        !node.parentId ||
        !editableClasses.includes(node.className) ||
        old?.readable === false
      )
        throw Error("Objek read-only tidak boleh diubah.");
      changes.push({ op: old ? "update" : "create", node });
    }
  }
  return bundleSchema.parse({
    version: 1,
    id: crypto.randomUUID(),
    baseSnapshotId: snapshot.snapshotId,
    placeId: snapshot.placeId,
    changes,
  });
}
export function validateBundle(snapshot, bundle) {
  snapshot = snapshotSchema.parse(snapshot);
  bundle = bundleSchema.parse(bundle);
  if (
    snapshot.snapshotId !== bundle.baseSnapshotId ||
    snapshot.placeId !== bundle.placeId
  )
    throw Error("Snapshot telah berubah.");
  const nodes = new Map(snapshot.nodes.map((n) => [n.id, n]));
  const seen = new Set();
  for (const change of bundle.changes) {
    const key = change.op === "delete" ? change.id : change.node.id;
    if (seen.has(key)) throw Error("Operasi ID duplikat");
    seen.add(key);
    const old = nodes.get(key);
    if (change.op === "delete") {
      if (!old?.parentId || !editableClasses.includes(old.className))
        throw Error("Penghapusan ditolak");
      nodes.delete(key);
    } else {
      const n = change.node;
      if (
        !n.parentId ||
        !editableClasses.includes(n.className) ||
        old?.readable === false
      )
        throw Error("Perubahan ditolak");
      if (change.op === "create" && old) throw Error("ID sudah ada");
      if (
        change.op === "update" &&
        (!old ||
          old.className !== n.className ||
          old.scriptPath !== n.scriptPath)
      )
        throw Error("Objek tidak cocok");
      nodes.set(key, n);
    }
  }
  snapshotSchema.parse({ ...snapshot, nodes: [...nodes.values()] });
  return bundle;
}
