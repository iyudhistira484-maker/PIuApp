/**
 * glTF binary (.glb) export — the format that actually carries a texture.
 *
 * Why a second export at all: Roblox's importer reads textures from FBX and
 * glTF, while OBJ carries geometry only, so an OBJ always arrives grey and its
 * texture has to be uploaded and assigned by hand. A `.glb` is one file: mesh,
 * UVs, vertex colours and the PNG embedded in its binary chunk.
 *
 * Written by hand rather than with a library because the output is small and
 * fixed: one node, one mesh, one material, one image. Everything here is pure
 * arithmetic over numbers and bytes, so the file can be parsed and checked in
 * Node — see tests/glb.test.ts.
 */
import type { SceneMesh, SceneObject } from "./scene";
import { ATLAS_SIZE, faceUVs, atlasLayout } from "./atlas";

const MAGIC = 0x46546c67; // "glTF"
const JSON_CHUNK = 0x4e4f534a; // "JSON"
const BIN_CHUNK = 0x004e4942; // "BIN\0"
const UNSIGNED_SHORT = 5123;
const FLOAT = 5126;

export interface GLBInput {
  name: string;
  /** 3 numbers per vertex, in the object's final size and orientation. */
  positions: number[];
  normals: number[];
  uvs?: number[];
  /** 3 or 4 numbers per vertex, 0–1; the photo colours, kept beside the texture. */
  colors?: number[];
  translation?: [number, number, number];
  /** PNG bytes of the atlas; omitted means a colours-only export. */
  texturePng?: Uint8Array;
  textureName?: string;
}

const pad4 = (length: number) => (4 - (length % 4)) % 4;

/**
 * Per-face-vertex geometry: a texture and a per-face colour both need each face
 * to own its corners, because a shared corner cannot hold two values.
 */
export function faceVertexGeometry(
  mesh: SceneMesh,
  { size = [1, 1, 1], rotation = [0, 0, 0] } = {} as {
    size?: number[];
    rotation?: number[];
  },
) {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const [rx, ry, rz] = rotation.map(radians);
  // Rotation is RX·RY·RZ, the same product three.js builds for an XYZ Euler
  // angle — so the exported mesh faces the same way as the preview. The vector
  // meets RZ first (rightmost factor), then RY, then RX. `rotateVector` in
  // server/lib/lowpoly.mjs is the same math for the server-built geometry and
  // tests/glb.test.ts pins the two together.
  const rotate = (point: number[]) => {
    const [x, y, z] = point;
    const afterZ = [
      x * Math.cos(rz) - y * Math.sin(rz),
      x * Math.sin(rz) + y * Math.cos(rz),
      z,
    ];
    const afterY = [
      afterZ[0] * Math.cos(ry) + afterZ[2] * Math.sin(ry),
      afterZ[1],
      -afterZ[0] * Math.sin(ry) + afterZ[2] * Math.cos(ry),
    ];
    return [
      afterY[0],
      afterY[1] * Math.cos(rx) - afterY[2] * Math.sin(rx),
      afterY[1] * Math.sin(rx) + afterY[2] * Math.cos(rx),
    ];
  };
  const scale = (point: number[]) => point.map((value, at) => value * size[at]);
  const positions: number[] = [];
  const normals: number[] = [];
  mesh.faces.forEach((face) => {
    const points = face.map((index) => rotate(scale(mesh.vertices[index])));
    const [a, b, c] = points;
    const u = [0, 1, 2].map((i) => b[i] - a[i]);
    const v = [0, 1, 2].map((i) => c[i] - a[i]);
    const normal = [
      u[1] * v[2] - u[2] * v[1],
      u[2] * v[0] - u[0] * v[2],
      u[0] * v[1] - u[1] * v[0],
    ];
    const width = Math.hypot(...normal) || 1;
    for (const point of points) {
      positions.push(...point);
      normals.push(...normal.map((value) => value / width));
    }
  });
  return { positions, normals };
}

/** Assembles the binary container: header, JSON chunk, BIN chunk. */
export function buildGLB(input: GLBInput): Uint8Array {
  const { positions, normals, uvs, colors } = input;
  const vertexCount = positions.length / 3;
  if (
    !vertexCount ||
    positions.length % 3 ||
    normals.length !== positions.length
  )
    throw new Error("Geometri GLB tidak lengkap.");
  if (uvs && uvs.length !== vertexCount * 2)
    throw new Error("UV GLB tidak cocok dengan jumlah vertex.");
  if (
    colors &&
    colors.length !== vertexCount * 3 &&
    colors.length !== vertexCount * 4
  )
    throw new Error("Warna vertex GLB tidak cocok dengan jumlah vertex.");

  // Every block of the binary chunk starts on a 4-byte boundary, which is what
  // the glTF reader expects; the padding is part of the chunk, not of a block.
  const blocks: { start: number; length: number }[] = [];
  let cursor = 0;
  const allocate = (byteLength: number) => {
    cursor += pad4(cursor);
    const block = { start: cursor, length: byteLength };
    cursor += byteLength;
    blocks.push(block);
    return block;
  };
  const arrays = {
    position: new Float32Array(positions),
    normal: new Float32Array(normals),
    uv: uvs ? new Float32Array(uvs) : null,
    color: colors ? new Float32Array(colors) : null,
  };
  const positionBlock = allocate(arrays.position.byteLength);
  const normalBlock = allocate(arrays.normal.byteLength);
  const uvBlock = arrays.uv ? allocate(arrays.uv.byteLength) : null;
  const colorBlock = arrays.color ? allocate(arrays.color.byteLength) : null;
  const textureBlock = input.texturePng?.length
    ? allocate(input.texturePng.length)
    : null;
  const binLength = cursor;

  const binary = new Uint8Array(binLength);
  const bytes = (array: Float32Array) =>
    new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
  binary.set(bytes(arrays.position), positionBlock.start);
  binary.set(bytes(arrays.normal), normalBlock.start);
  if (arrays.uv && uvBlock) binary.set(bytes(arrays.uv), uvBlock.start);
  if (arrays.color && colorBlock)
    binary.set(bytes(arrays.color), colorBlock.start);
  if (input.texturePng && textureBlock)
    binary.set(input.texturePng, textureBlock.start);

  // POSITION must declare its bounds; viewers rely on them to frame the model.
  const bounds = (values: number[], stride: number) => {
    const min = new Array(stride).fill(Infinity);
    const max = new Array(stride).fill(-Infinity);
    values.forEach((value, at) => {
      const axis = at % stride;
      min[axis] = Math.min(min[axis], value);
      max[axis] = Math.max(max[axis], value);
    });
    return { min, max };
  };

  const bufferViews: any[] = [
    {
      buffer: 0,
      byteOffset: positionBlock.start,
      byteLength: positionBlock.length,
      target: 34962,
    },
    {
      buffer: 0,
      byteOffset: normalBlock.start,
      byteLength: normalBlock.length,
      target: 34962,
    },
  ];
  const attributes: Record<string, number> = { POSITION: 0, NORMAL: 1 };
  const accessors: any[] = [
    {
      bufferView: 0,
      componentType: FLOAT,
      count: vertexCount,
      type: "VEC3",
      ...bounds(positions, 3),
    },
    { bufferView: 1, componentType: FLOAT, count: vertexCount, type: "VEC3" },
  ];
  if (uvBlock) {
    bufferViews.push({
      buffer: 0,
      byteOffset: uvBlock.start,
      byteLength: uvBlock.length,
      target: 34962,
    });
    accessors.push({
      bufferView: bufferViews.length - 1,
      componentType: FLOAT,
      count: vertexCount,
      type: "VEC2",
    });
    attributes.TEXCOORD_0 = accessors.length - 1;
  }
  if (colorBlock) {
    bufferViews.push({
      buffer: 0,
      byteOffset: colorBlock.start,
      byteLength: colorBlock.length,
      target: 34962,
    });
    accessors.push({
      bufferView: bufferViews.length - 1,
      componentType: FLOAT,
      count: vertexCount,
      type: colors!.length / vertexCount === 4 ? "VEC4" : "VEC3",
    });
    attributes.COLOR_0 = accessors.length - 1;
  }

  const images: any[] = [];
  const textures: any[] = [];
  if (textureBlock) {
    bufferViews.push({
      buffer: 0,
      byteOffset: textureBlock.start,
      byteLength: textureBlock.length,
    });
    images.push({
      bufferView: bufferViews.length - 1,
      mimeType: "image/png",
      name: input.textureName || `${input.name}-atlas`,
    });
    textures.push({ source: 0, sampler: 0 });
  }

  const gltf: any = {
    asset: { version: "2.0", generator: "PiwuApp" },
    scene: 0,
    scenes: [{ nodes: [0], name: input.name }],
    nodes: [
      {
        mesh: 0,
        name: input.name,
        ...(input.translation ? { translation: input.translation } : {}),
      },
    ],
    meshes: [
      {
        name: input.name,
        primitives: [{ attributes, mode: 4, material: 0 }],
      },
    ],
    materials: [
      {
        name: `${input.name}-material`,
        doubleSided: true,
        pbrMetallicRoughness: {
          metallicFactor: 0,
          roughnessFactor: 0.7,
          ...(textureBlock ? { baseColorTexture: { index: 0 } } : {}),
        },
      },
    ],
    accessors,
    bufferViews,
    buffers: [{ byteLength: binLength }],
  };
  if (textures.length) {
    gltf.images = images;
    gltf.textures = textures;
    gltf.samplers = [
      { magFilter: 9729, minFilter: 9987, wrapS: 33071, wrapT: 33071 },
    ];
  }

  const json = new TextEncoder().encode(JSON.stringify(gltf));
  const jsonPadding = pad4(json.length);
  const binPadding = pad4(binLength);
  const file = new Uint8Array(
    20 + json.length + jsonPadding + 8 + binLength + binPadding,
  );
  const view = new DataView(file.buffer);
  view.setUint32(0, MAGIC, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, file.byteLength, true);
  view.setUint32(12, json.length + jsonPadding, true);
  view.setUint32(16, JSON_CHUNK, true);
  file.set(json, 20);
  for (let at = 0; at < jsonPadding; at++) file[20 + json.length + at] = 0x20; // JSON pads with spaces
  const binStart = 20 + json.length + jsonPadding;
  view.setUint32(binStart, binLength + binPadding, true);
  view.setUint32(binStart + 4, BIN_CHUNK, true);
  file.set(binary, binStart + 8);
  return file;
}

/** The same photo colours the preview shows, as 0–1 triples per vertex. */
export function vertexColors(mesh: SceneMesh, fallback: string) {
  const table: string[] = mesh.faces.map(() => fallback);
  for (const group of mesh.groups || []) {
    for (const index of group.faces)
      if (index < table.length) table[index] = group.color;
  }
  const colors: number[] = [];
  // One triple per corner, because the geometry is expanded the same way.
  for (const hex of table) {
    const rgb = [
      parseInt(hex.slice(1, 3), 16) / 255,
      parseInt(hex.slice(3, 5), 16) / 255,
      parseInt(hex.slice(5, 7), 16) / 255,
    ];
    for (let corner = 0; corner < 3; corner++) colors.push(...rgb);
  }
  return colors;
}

export interface GLBOptions {
  /** PNG of the atlas; without it the export carries colours but no texture. */
  texturePng?: Uint8Array;
  atlasSize?: number;
}

/**
 * A scene object as a .glb in studs, positioned where it sits in the scene. The
 * size and rotation are baked into the geometry so the imported mesh needs no
 * extra scaling, and the node keeps the object's position.
 */
export function objectGLB(object: SceneObject, options: GLBOptions = {}) {
  if (!object.mesh) throw new Error("Pilih mesh kustom.");
  const { positions, normals } = faceVertexGeometry(object.mesh, {
    size: object.size,
    rotation: object.rotation,
  });
  const layout = atlasLayout(
    (object.mesh.groups || []).length,
    options.atlasSize ?? ATLAS_SIZE,
  );
  const uvs = options.texturePng ? faceUVs(object.mesh, layout) : null;
  return buildGLB({
    name: object.name || "PiwuMesh",
    positions,
    normals,
    ...(uvs ? { uvs: uvs.flat() } : {}),
    colors: vertexColors(object.mesh, object.color),
    translation: object.position as [number, number, number],
    ...(options.texturePng ? { texturePng: options.texturePng } : {}),
  });
}
