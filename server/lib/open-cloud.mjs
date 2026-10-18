/**
 * Roblox Open Cloud asset uploads. This is the optional path that turns the
 * app's textured .glb export into a Roblox asset the plugin can insert, so a
 * photo model arrives in Studio already textured instead of being grey.
 *
 * Everything here is fail-closed: without a key configured by the operator the
 * route answers 503 and says how to configure it. The key never leaves the
 * server and is never echoed back to a browser or to Studio.
 */
import { HttpError } from "./core.mjs";

const API = "https://apis.roblox.com/assets/v1";
export const UPLOAD_BYTES_MAX = 8 * 1024 * 1024;
const OPERATION_PATTERN = /^operations\/[\w-]{1,120}$/;

export function openCloudConfig(env = {}) {
  const key = String(env.ROBLOX_OPEN_CLOUD_KEY || "").trim();
  const creatorId = String(env.ROBLOX_ASSET_CREATOR_ID || "").trim();
  const creatorType =
    String(env.ROBLOX_ASSET_CREATOR_TYPE || "user").trim() === "group"
      ? "group"
      : "user";
  const configured = Boolean(key && /^\d{1,20}$/.test(creatorId));
  return { key, creatorId, creatorType, configured };
}

/** A .glb with the wrong magic, version or length is refused, not uploaded. */
export function assertGLB(buffer) {
  if (!buffer || buffer.length < 20)
    throw new HttpError(400, "Berkas GLB kosong atau terpotong.");
  if (buffer.length > UPLOAD_BYTES_MAX)
    throw new HttpError(
      413,
      `Berkas GLB melebihi ${Math.round(UPLOAD_BYTES_MAX / (1024 * 1024))} MB.`,
    );
  if (buffer.readUInt32LE(0) !== 0x46546c67)
    throw new HttpError(400, "Berkas itu bukan GLB (magic glTF tidak ada).");
  if (buffer.readUInt32LE(4) !== 2)
    throw new HttpError(400, "Hanya GLB glTF versi 2 yang didukung Roblox.");
  if (buffer.readUInt32LE(8) !== buffer.length)
    throw new HttpError(
      400,
      "Panjang di header GLB tidak cocok dengan isinya.",
    );
  return buffer;
}

const reason = (body) => {
  const text = typeof body === "string" ? body : "";
  if (!text) return "";
  try {
    const parsed = JSON.parse(text);
    return String(
      parsed?.message || parsed?.error || parsed?.errors?.[0]?.message || "",
    ).slice(0, 300);
  } catch {
    return text.slice(0, 300);
  }
};

/** Uploads the model and reports the asset id when Roblox is finished. */
export async function uploadModel(
  {
    fetcher = fetch,
    config = {},
    name = "PiwuApp model",
    description = "",
  } = {},
  glb,
) {
  if (!config.configured)
    throw new HttpError(
      503,
      "Unggah aset ke Roblox belum dikonfigurasi di server ini. Isi ROBLOX_OPEN_CLOUD_KEY dan ROBLOX_ASSET_CREATOR_ID (lihat docs/SERVICES_SETUP.md); jalur manual (unduh GLB lalu impor di Studio) tetap tersedia.",
    );
  assertGLB(glb);
  const form = new FormData();
  form.append(
    "request",
    JSON.stringify({
      assetType: "Model",
      displayName: name.slice(0, 80),
      description: description.slice(0, 500),
      creationContext: {
        creator:
          config.creatorType === "group"
            ? { groupId: config.creatorId }
            : { userId: config.creatorId },
      },
    }),
  );
  form.append(
    "fileContent",
    new Blob([glb], { type: "model/gltf-binary" }),
    `${name.replace(/[^\w-]+/g, "-").slice(0, 60) || "model"}.glb`,
  );
  let response;
  try {
    response = await fetcher(`${API}/assets`, {
      method: "POST",
      headers: { "x-api-key": config.key },
      body: form,
      signal: AbortSignal.timeout(30000),
    });
  } catch (error) {
    throw new HttpError(
      502,
      `Roblox tidak bisa dihubungi untuk unggah aset: ${String(
        error?.message || error,
      ).slice(0, 200)}`,
    );
  }
  const body = await response.text();
  if (!response.ok)
    throw new HttpError(
      502,
      `Roblox menolak unggah aset (HTTP ${response.status})${
        reason(body) ? `: ${reason(body)}` : "."
      }`,
    );
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new HttpError(502, "Balasan unggah aset dari Roblox tidak terbaca.");
  }
  const operation = String(parsed?.path || "");
  if (!OPERATION_PATTERN.test(operation))
    throw new HttpError(
      502,
      "Roblox tidak memberi id operasi unggah. Coba lagi dari panel Properti.",
    );
  return {
    operation,
    ...(await operationState({ fetcher, config }, operation)),
  };
}

/** One poll of an upload operation: asset id and moderation state when ready. */
export async function operationState(
  { fetcher = fetch, config = {} } = {},
  path,
) {
  if (!config.configured)
    throw new HttpError(503, "Unggah aset ke Roblox belum dikonfigurasi.");
  if (!OPERATION_PATTERN.test(String(path || "")))
    throw new HttpError(400, "Id operasi unggah tidak sah.");
  let response;
  try {
    response = await fetcher(`${API}/${path}`, {
      headers: { "x-api-key": config.key },
      signal: AbortSignal.timeout(15000),
    });
  } catch (error) {
    throw new HttpError(
      502,
      `Roblox tidak bisa dihubungi untuk memeriksa aset: ${String(
        error?.message || error,
      ).slice(0, 200)}`,
    );
  }
  const body = await response.text();
  if (!response.ok)
    throw new HttpError(
      502,
      `Roblox menolak pemeriksaan aset (HTTP ${response.status})${
        reason(body) ? `: ${reason(body)}` : "."
      }`,
    );
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new HttpError(502, "Balasan pemeriksaan aset tidak terbaca.");
  }
  const result = parsed?.response || {};
  const assetId = Number.isFinite(Number(result.assetId))
    ? String(result.assetId)
    : "";
  const moderationState = String(
    result?.moderationResult?.moderationState || "",
  ).slice(0, 40);
  return {
    done: parsed?.done === true,
    assetId: /^\d{3,20}$/.test(assetId) ? assetId : "",
    moderationState,
    // Roblox answers "Reviewing" for a while: the asset id can exist before the
    // asset is usable, and the plugin must be told that instead of failing.
    note:
      parsed?.done === true
        ? assetId
          ? moderationState && moderationState !== "Approved"
            ? `Aset dibuat (moderasi: ${moderationState}). Belum tentu bisa dipakai sebelum Approved.`
            : "Aset dibuat."
          : "Operasi selesai tanpa asset id."
        : "Roblox masih memproses aset ini. Periksa lagi sebentar lagi.",
  };
}
