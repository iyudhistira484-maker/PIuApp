// Photo-sampled colours for a generated model.
//
// The honest limit first: a Roblox mesh asset cannot carry a texture inside an
// OBJ file (Roblox textures are uploaded separately in Studio), and the scene
// file is far too small to hold a photo. So a model built from a photo cannot
// literally wear the photo as a texture map in this pipeline.
//
// What it CAN do, and what this module does: read the real pixels of the photo
// once (in the browser, where a decoder already exists), send a small colour
// grid, and give every generated surface the colour of the photo region the
// model pointed at — per face for meshes, which is what makes a low-poly model
// look like the thing in the photograph instead of a flat grey blockout.
//
// Rules that keep it honest:
//  * a colour can only come from the grid the client sampled from an attached
//    photo — a `region` with no such grid is refused, never guessed at;
//  * sampling is deterministic (fixed cell maths, rounded hex), so the same
//    photo and the same description always produce the same colours;
//  * the report says which region produced which colour, and that this is
//    photo-coloured geometry, not a UV-mapped texture.

export const PALETTE_COLUMNS_MAX = 32;
export const PALETTE_ROWS_MAX = 32;
export const PALETTE_CELLS_MAX = 1024;
export const GROUPS_MAX = 24;
/** Faces below this share a colour: one group per face would be wasteful. */
const HEX = /^#[0-9a-f]{6}$/i;

export const isHex = (value) => HEX.test(String(value || ""));

/** A palette as the client sends it: a small grid of hex colours. */
export const isPalette = (value) =>
  Boolean(
    value &&
    typeof value === "object" &&
    Number.isInteger(value.columns) &&
    Number.isInteger(value.rows) &&
    value.columns >= 1 &&
    value.columns <= PALETTE_COLUMNS_MAX &&
    value.rows >= 1 &&
    value.rows <= PALETTE_ROWS_MAX &&
    Array.isArray(value.colors) &&
    value.colors.length === value.columns * value.rows &&
    value.colors.length <= PALETTE_CELLS_MAX &&
    value.colors.every(isHex),
  );

const clamp01 = (n) => Math.min(1, Math.max(0, n));

/**
 * The cell a normalized photo coordinate falls in. Coordinates are clamped, so
 * a region that runs slightly past the edge still samples the edge cell instead
 * of reading outside the grid.
 */
export function cellAt(palette, x, y) {
  const column = Math.min(
    palette.columns - 1,
    Math.floor(clamp01(x) * palette.columns),
  );
  const row = Math.min(palette.rows - 1, Math.floor(clamp01(y) * palette.rows));
  return {
    column,
    row,
    color: palette.colors[row * palette.columns + column].toLowerCase(),
  };
}

const mix = (values) => {
  let r = 0;
  let g = 0;
  let b = 0;
  for (const hex of values) {
    r += parseInt(hex.slice(1, 3), 16);
    g += parseInt(hex.slice(3, 5), 16);
    b += parseInt(hex.slice(5, 7), 16);
  }
  const n = values.length;
  const at = (total) =>
    Math.min(255, Math.max(0, Math.round(total / n)))
      .toString(16)
      .padStart(2, "0");
  return `#${at(r)}${at(g)}${at(b)}`;
};

/** Every cell inside a region, in row-major order. */
export function regionCells(palette, region) {
  const [x0, y0, x1, y1] = region.map(clamp01);
  const left = clamp01(Math.min(x0, x1));
  const right = clamp01(Math.max(x0, x1));
  const top = clamp01(Math.min(y0, y1));
  const bottom = clamp01(Math.max(y0, y1));
  const cells = [];
  for (let row = 0; row < palette.rows; row++) {
    const y = (row + 0.5) / palette.rows;
    if (y < top || y > bottom) continue;
    for (let column = 0; column < palette.columns; column++) {
      const x = (column + 0.5) / palette.columns;
      if (x < left || x > right) continue;
      cells.push({
        column,
        row,
        color: palette.colors[row * palette.columns + column].toLowerCase(),
      });
    }
  }
  // A region thinner than one cell still samples the cell it sits in, so a small
  // part never comes back colourless.
  if (!cells.length) {
    const middle = cellAt(palette, (left + right) / 2, (top + bottom) / 2);
    return [middle];
  }
  return cells;
}

/** The average colour of a region — one colour for a Part. */
export function regionColor(palette, region) {
  return mix(regionCells(palette, region).map((cell) => cell.color));
}

/**
 * Per-face colours for one node, sampled from the region the model pointed at.
 *
 * A face is coloured by where it sits on the node: the top face samples the top
 * of the region, the bottom face the bottom, and the sides sample along it. That
 * is a simple box projection, not a UV map — it is stated as such in the report
 * — but every colour really comes from the photo's pixels.
 */
export function faceGroups(palette, region, mesh, baseColor) {
  const [x0, y0, x1, y1] = region.map(clamp01);
  const left = clamp01(Math.min(x0, x1));
  const right = clamp01(Math.max(x0, x1));
  const top = clamp01(Math.min(y0, y1));
  const bottom = clamp01(Math.max(y0, y1));
  const spanX = right - left;
  const spanY = bottom - top;
  const byColor = new Map();
  mesh.faces.forEach((face, index) => {
    const a = mesh.vertices[face[0]];
    const b = mesh.vertices[face[1]];
    const c = mesh.vertices[face[2]];
    // Face centre in the node's own unit space.
    const centre = [0, 1, 2].map((i) => (a[i] + b[i] + c[i]) / 3);
    // Which way the face looks, from its winding.
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const normal = [
      u[1] * v[2] - u[2] * v[1],
      u[2] * v[0] - u[0] * v[2],
      u[0] * v[1] - u[1] * v[0],
    ];
    const width = Math.hypot(...normal) || 1;
    const axis = normal.map((n) => Math.abs(n) / width);
    const facing = axis.indexOf(Math.max(...axis));
    // Up/down sample across the region's height; the sides sample across its
    // width, and the remaining axis slides the sample along the region.
    const across =
      facing === 1
        ? (top + bottom) / 2 + (centre[0] + 0.5) * spanX * 0.5 - spanX * 0.25
        : (left + right) / 2 +
          (centre[facing === 0 ? 2 : 0] + 0.5) * spanX * 0.5 -
          spanX * 0.25;
    const along =
      facing === 1
        ? normal[1] > 0
          ? top
          : bottom
        : (centre[1] + 0.5) * spanY + top;
    const { color } = cellAt(palette, across, along);
    const list = byColor.get(color) || [];
    list.push(index);
    byColor.set(color, list);
  });
  const box = [left, top, right, bottom];
  const groups = [...byColor.entries()].map(([color, faces]) => ({
    color,
    faces,
    // The area of the photo these faces were coloured from. Kept beside the
    // colour so an exported texture shows the very pixels behind it.
    region: box,
  }));
  // Too many distinct colours: keep the ones that cover the most faces and let
  // the rest fall back to the object colour, which the report states.
  if (groups.length <= GROUPS_MAX)
    return { groups, dropped: 0, baseColor: null };
  groups.sort((a, b) => b.faces.length - a.faces.length);
  const kept = groups.slice(0, GROUPS_MAX);
  const dropped = groups.length - kept.length;
  const covered = new Set(kept.flatMap((group) => group.faces));
  for (const group of kept)
    group.faces = group.faces.filter((index) => covered.has(index));
  return { groups: kept, dropped, baseColor };
}

/** A palette is only useful with the photo it was sampled from. */
export function paletteFor(palettes, photo) {
  if (!photo) return null;
  const palette = Array.isArray(palettes) ? palettes[photo - 1] : null;
  return isPalette(palette) ? palette : null;
}
