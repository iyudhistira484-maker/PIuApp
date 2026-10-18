/**
 * Turning a photo-coloured mesh into a real texture.
 *
 * The colours a model gets from a photo are flat per side. A texture carries the
 * photo's actual pixels — grain, print, gradient — and needs two things: UV
 * coordinates on the mesh, and one image holding the pieces.
 *
 * How it works here, and what it honestly is:
 *  - The server records, per colour group, the rectangle of the photo its faces
 *    were sampled from (`groups[].region`) — colour and area come from the same
 *    place, so they cannot drift apart.
 *  - This module packs one square patch per colour group into an atlas, crops
 *    that patch out of the photo at the group's rectangle, and gives every face
 *    UV coordinates inside its own group's patch.
 *  - That is a box projection per face, not a UV unwrap of a real object: each
 *    side shows the photo's detail of the area it was coloured from. Say so when
 *    describing it.
 *
 * Everything except `bakeAtlas` is pure arithmetic, so the packing rule and the
 * UVs are pinned by tests in Node.
 */
import type { SceneMesh } from "./scene";

/** Atlas edge in pixels. Roblox's mesh texture limit is 1024×1024. */
export const ATLAS_SIZE = 1024;

export interface AtlasLayout {
  size: number;
  columns: number;
  /** Patch edge in pixels: one patch per colour group. */
  cell: number;
}

/**
 * A square grid of patches. The atlas stays inside the 1024px limit for any
 * number of groups, and fewer groups means bigger patches.
 */
export function atlasLayout(groups: number, size = ATLAS_SIZE): AtlasLayout {
  const count = Math.max(1, Math.floor(groups) || 1);
  const columns = Math.max(1, Math.ceil(Math.sqrt(count)));
  return { size, columns, cell: Math.floor(size / columns) };
}

/** Top-left corner of a patch, in pixels. */
export function cellOrigin(layout: AtlasLayout, index: number) {
  const columns = layout.columns;
  return {
    x: (index % columns) * layout.cell,
    y: Math.floor(index / columns) * layout.cell,
  };
}

/**
 * The face's own 2D footprint, always in [0,1]²: the face is flattened onto the
 * plane it faces, then measured against itself. A back-facing face is mirrored
 * once so the patch is not seen reversed.
 */
export function faceFootprints(mesh: SceneMesh): [number, number][][] {
  return mesh.faces.map((face) => {
    const points = face.map((index) => mesh.vertices[index]);
    const a = points[0];
    const u = [0, 1, 2].map((i) => points[1][i] - a[i]);
    const v = [0, 1, 2].map((i) => points[2][i] - a[i]);
    const normal = [
      u[1] * v[2] - u[2] * v[1],
      u[2] * v[0] - u[0] * v[2],
      u[0] * v[1] - u[1] * v[0],
    ];
    const width = Math.hypot(...normal) || 1;
    const axis = normal.map((n) => Math.abs(n) / width);
    const facing = axis.indexOf(Math.max(...axis));
    const [i, j] = [0, 1, 2].filter((value) => value !== facing);
    const min = [0, 1].map((at) =>
      Math.min(...points.map((point) => point[[i, j][at]])),
    );
    const max = [0, 1].map((at) =>
      Math.max(...points.map((point) => point[[i, j][at]])),
    );
    return points.map((point) => {
      const span = [0, 1].map((at) => max[at] - min[at] || 1);
      const across = (point[i] - min[0]) / span[0];
      const along = (point[j] - min[1]) / span[1];
      // A face pointing backwards would otherwise show its patch mirrored.
      return (normal[facing] > 0 ? [across, along] : [1 - across, along]) as [
        number,
        number,
      ];
    });
  });
}

/** Which group covers each face, as an index into `mesh.groups`. */
export function faceGroupIndex(mesh: SceneMesh): (number | null)[] {
  const table: (number | null)[] = mesh.faces.map(() => null);
  (mesh.groups || []).forEach((group, at) => {
    for (const index of group.faces)
      if (index < table.length) table[index] = at;
  });
  return table;
}

/**
 * UV coordinates for every face-vertex, in atlas space. A face whose group has
 * no patch (no colour groups at all) gets no UVs — the caller then exports
 * vertex colours only instead of pointing at nothing.
 */
export function faceUVs(
  mesh: SceneMesh,
  layout: AtlasLayout,
): [number, number][] | null {
  const groups = mesh.groups || [];
  if (!groups.length) return null;
  const table = faceGroupIndex(mesh);
  const footprints = faceFootprints(mesh);
  const uvs: [number, number][] = [];
  mesh.faces.forEach((_, index) => {
    const group = table[index];
    const origin = cellOrigin(layout, group === null ? 0 : group);
    for (const [across, along] of footprints[index]) {
      const x = origin.x + across * layout.cell;
      const y = origin.y + along * layout.cell;
      uvs.push([x / layout.size, y / layout.size]);
    }
  });
  return uvs;
}

/**
 * Where a group's patch comes from in the photo. A group without a region falls
 * back to its flat colour, so a patch is never filled with something that did
 * not come from the photo.
 */
export function patchSource(group: { color: string; region?: number[] }): {
  region: number[] | null;
  color: string;
} {
  const region = group.region;
  const valid =
    Array.isArray(region) &&
    region.length === 4 &&
    region.every((value) => Number.isFinite(value));
  return {
    region: valid
      ? [
          Math.min(region[0], region[2]),
          Math.min(region[1], region[3]),
          Math.max(region[0], region[2]),
          Math.max(region[1], region[3]),
        ]
      : null,
    color: group.color,
  };
}

export interface AtlasPlan {
  layout: AtlasLayout;
  patches: {
    index: number;
    x: number;
    y: number;
    size: number;
    region: number[] | null;
    color: string;
    faces: number;
  }[];
}

/** What the atlas will contain, without touching a canvas. */
export function atlasPlan(mesh: SceneMesh, size = ATLAS_SIZE): AtlasPlan {
  const groups = mesh.groups || [];
  const layout = atlasLayout(groups.length, size);
  return {
    layout,
    patches: groups.map((group, index) => {
      const origin = cellOrigin(layout, index);
      const source = patchSource(group);
      return {
        index,
        x: origin.x,
        y: origin.y,
        size: layout.cell,
        region: source.region,
        color: source.color,
        faces: group.faces.length,
      };
    }),
  };
}

/**
 * Draws the atlas. Browser-only because the photo has to be decoded, and it
 * reports the same plan `atlasPlan` describes, so the image and the UVs cannot
 * disagree.
 */
export async function bakeAtlas(
  photo: { mime: string; data: string },
  mesh: SceneMesh,
  size = ATLAS_SIZE,
): Promise<{ png: Uint8Array; plan: AtlasPlan }> {
  if (typeof document === "undefined")
    throw new Error("Atlas tekstur butuh browser untuk membaca foto.");
  const plan = atlasPlan(mesh, size);
  const image = new Image();
  image.decoding = "async";
  const loaded = new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () =>
      reject(new Error("Foto tidak dapat dibaca untuk atlas."));
  });
  image.src = `data:${photo.mime};base64,${photo.data}`;
  await loaded;
  const canvas = document.createElement("canvas");
  canvas.width = plan.layout.size;
  canvas.height = plan.layout.size;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D tidak tersedia untuk atlas.");
  // Empty patches are visible as such instead of silently black.
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  for (const patch of plan.patches) {
    if (!patch.region) {
      context.fillStyle = patch.color;
      context.fillRect(patch.x, patch.y, patch.size, patch.size);
      continue;
    }
    const [x0, y0, x1, y1] = patch.region;
    const sx = x0 * image.naturalWidth;
    const sy = y0 * image.naturalHeight;
    const sw = Math.max(1, (x1 - x0) * image.naturalWidth);
    const sh = Math.max(1, (y1 - y0) * image.naturalHeight);
    context.drawImage(
      image,
      sx,
      sy,
      sw,
      sh,
      patch.x,
      patch.y,
      patch.size,
      patch.size,
    );
  }
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((value) => resolve(value), "image/png"),
  );
  if (!blob) throw new Error("Atlas gagal dikodekan menjadi PNG.");
  return { png: new Uint8Array(await blob.arrayBuffer()), plan };
}
