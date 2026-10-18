/**
 * The scene a Studio plugin is allowed to build, read from a project's own
 * `scene.roblox.json`. The browser schema is the source of truth for what a
 * scene may contain; this module re-checks the same limits on the server,
 * because the plugin must never be handed a scene the app itself would refuse,
 * and it must be told exactly what is missing rather than guessing.
 */
import { HttpError } from "./core.mjs";

export const SCENE_FILE = "scene.roblox.json";
export const SCENE_ASSET_FILE = "studio.assets.json";
export const SCENE_OBJECTS_MAX = 250;
const KINDS = new Set(["block", "sphere", "cylinder", "mesh", "model"]);
const ID_PATTERN = /^[\w:.-]{1,100}$/;

const number = (value) => typeof value === "number" && Number.isFinite(value);
const vector = (value) =>
  Array.isArray(value) && value.length === 3 && value.every(number);
const color = (value) =>
  typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);

/** Geometry of one custom mesh: only what the plugin will actually use. */
function checkMesh(mesh, at) {
  if (mesh === undefined) return null;
  if (!mesh || typeof mesh !== "object" || Array.isArray(mesh))
    throw new HttpError(409, `Mesh objek ke-${at + 1} bukan objek JSON.`);
  const vertices = mesh.vertices;
  const faces = mesh.faces;
  if (!Array.isArray(vertices) || !vertices.length || vertices.length > 512)
    throw new HttpError(
      409,
      `Mesh objek ke-${at + 1} harus punya 1–512 vertex.`,
    );
  if (!vertices.every(vector))
    throw new HttpError(409, `Vertex mesh ke-${at + 1} bukan tiga angka.`);
  if (!Array.isArray(faces) || !faces.length || faces.length > 1024)
    throw new HttpError(
      409,
      `Mesh objek ke-${at + 1} harus punya 1–1024 face.`,
    );
  for (const face of faces) {
    if (
      !Array.isArray(face) ||
      face.length !== 3 ||
      new Set(face).size !== 3 ||
      !face.every((index) => Number.isInteger(index) && index >= 0)
    )
      throw new HttpError(
        409,
        `Face mesh ke-${at + 1} harus tiga indeks berbeda.`,
      );
    if (face.some((index) => index >= vertices.length))
      throw new HttpError(
        409,
        `Face mesh ke-${at + 1} menunjuk vertex yang tidak ada.`,
      );
  }
  return { vertices: vertices.length, faces: faces.length };
}

/**
 * Parses and checks a stored scene. Anything that does not fit the app's own
 * scene contract is refused with a reason, so a plugin never builds half a
 * model and never invents geometry that is not in the file.
 */
export function parseScene(text) {
  if (typeof text !== "string" || !text.trim())
    throw new HttpError(
      409,
      "Project ini belum punya scene.roblox.json. Buat atau terima scene dulu di PiwuApp.",
    );
  if (text.length > 262144)
    throw new HttpError(409, "File scene melebihi batas 256 KB project.");
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new HttpError(409, "scene.roblox.json bukan JSON yang sah.");
  }
  if (
    !raw ||
    typeof raw !== "object" ||
    Array.isArray(raw) ||
    raw.version !== 1
  )
    throw new HttpError(409, "Scene harus memakai versi 1.");
  if (!Array.isArray(raw.objects) || raw.objects.length > SCENE_OBJECTS_MAX)
    throw new HttpError(
      409,
      `Scene maksimal ${SCENE_OBJECTS_MAX} objek; file ini melebihi batas itu.`,
    );
  const ids = new Set();
  const objects = raw.objects.map((object, at) => {
    const where = `Objek ke-${at + 1}`;
    if (!object || typeof object !== "object" || Array.isArray(object))
      throw new HttpError(409, `${where} bukan objek JSON.`);
    if (typeof object.id !== "string" || !ID_PATTERN.test(object.id))
      throw new HttpError(409, `${where} punya id yang tidak sah.`);
    if (ids.has(object.id))
      throw new HttpError(409, `Id objek ${object.id} dipakai dua kali.`);
    ids.add(object.id);
    if (typeof object.name !== "string" || !object.name.trim())
      throw new HttpError(409, `${where} belum punya nama.`);
    if (!KINDS.has(object.kind))
      throw new HttpError(
        409,
        `${where} memakai jenis "${String(object.kind)}" yang tidak dikenal.`,
      );
    if (object.parent !== null && typeof object.parent !== "string")
      throw new HttpError(409, `${where} punya parent yang tidak sah.`);
    if (!vector(object.position) || !vector(object.rotation))
      throw new HttpError(409, `${where} punya posisi/rotasi yang tidak sah.`);
    if (!vector(object.size) || object.size.some((n) => n < 0.05 || n > 1000))
      throw new HttpError(409, `${where} punya ukuran di luar 0,05–1000 stud.`);
    if (object.size.some((n) => Math.abs(n) < 0.05))
      throw new HttpError(409, `${where} punya ukuran nol.`);
    if (!color(object.color))
      throw new HttpError(409, `${where} punya warna yang tidak sah.`);
    if (typeof object.anchored !== "boolean")
      throw new HttpError(409, `${where} belum menentukan Anchored.`);
    const mesh = checkMesh(object.mesh, at);
    if (object.kind === "mesh" && !mesh)
      throw new HttpError(409, `${where} berjenis mesh tetapi tanpa geometri.`);
    return {
      id: object.id,
      name: object.name.trim().slice(0, 80),
      kind: object.kind,
      parent: object.parent || null,
      position: object.position,
      rotation: object.rotation,
      size: object.size,
      color: object.color.toLowerCase(),
      anchored: object.anchored,
      mesh,
    };
  });
  // Parents must exist and be models, exactly like the browser schema.
  for (const object of objects) {
    if (!object.parent) continue;
    const parent = objects.find((other) => other.id === object.parent);
    if (!parent || parent.kind !== "model")
      throw new HttpError(
        409,
        `Parent objek ${object.name} bukan Model yang ada di scene ini.`,
      );
  }
  return { version: 1, objects };
}

/** How many of each kind, how big the scene is, and which meshes have assets. */
export function sceneSummary(scene, assets = {}) {
  const kinds = {};
  for (const object of scene.objects)
    kinds[object.kind] = (kinds[object.kind] || 0) + 1;
  const meshes = scene.objects.filter((object) => object.kind === "mesh");
  const withAsset = meshes.filter((object) => assets[object.id]?.assetId);
  const bounds = { min: [0, 0, 0], max: [0, 0, 0], size: [0, 0, 0] };
  for (let axis = 0; axis < 3; axis++) {
    // A model has no geometry of its own, so only real shapes count here.
    const values = scene.objects
      .filter((object) => object.kind !== "model")
      .map((object) => object.position[axis]);
    if (!values.length) continue;
    const low = Math.min(...values);
    const high = Math.max(...values);
    bounds.min[axis] = low;
    bounds.max[axis] = high;
    bounds.size[axis] = Math.round((high - low) * 100) / 100;
  }
  return {
    objects: scene.objects.length,
    kinds,
    meshes: {
      total: meshes.length,
      withAsset: withAsset.length,
      withoutAsset: meshes.length - withAsset.length,
      missing: meshes
        .filter((object) => !assets[object.id]?.assetId)
        .map((object) => object.name)
        .slice(0, 12),
    },
    bounds,
  };
}

/**
 * The Roblox asset ids a project already paid for, kept in the project's own
 * files (`studio.assets.json`) so they sync and show up in History like every
 * other edit. A broken file is reported, never silently treated as empty.
 */
export function readSceneAssets(text) {
  if (!text || !text.trim()) return { assets: {}, problem: "" };
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return { assets: {}, problem: "studio.assets.json rusak (bukan JSON)." };
  }
  const list = raw?.assets;
  if (!list || typeof list !== "object" || Array.isArray(list))
    return {
      assets: {},
      problem: "studio.assets.json tidak memuat daftar aset.",
    };
  const assets = {};
  for (const [id, entry] of Object.entries(list)) {
    const assetId = String(entry?.assetId ?? "");
    if (!ID_PATTERN.test(id) || !/^\d{3,20}$/.test(assetId)) continue;
    assets[id] = {
      assetId,
      name: typeof entry.name === "string" ? entry.name.slice(0, 80) : id,
      at: typeof entry.at === "string" ? entry.at.slice(0, 40) : "",
      moderationState:
        typeof entry.moderationState === "string"
          ? entry.moderationState.slice(0, 40)
          : "",
    };
  }
  return { assets, problem: "" };
}

/** Folds a just-finished upload into the asset file, without losing old ids. */
export function mergeSceneAsset(text, id, entry) {
  const { assets } = readSceneAssets(text);
  return (
    JSON.stringify(
      {
        version: 1,
        assets: { ...assets, [id]: entry },
      },
      null,
      2,
    ) + "\n"
  );
}
