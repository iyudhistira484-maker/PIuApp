/**
 * Photos the user attached, kept with the project instead of thrown away.
 *
 * A photo used to exist only inside the message that carried it: the model was
 * built from it, and then it was gone. That made the two things a photo is
 * actually for impossible — comparing the finished model against the picture it
 * came from, and reusing the same photo in a later session.
 *
 * Where they live, and why: browser storage (IndexedDB), not the cloud project
 * payload. The project payload is text that syncs on every save, and it has a
 * hard size ceiling; base64 photos inside it would blow that ceiling for
 * everybody. Cloud photo storage would need a storage bucket and an upload path
 * (and a migration), which this change deliberately does not add. So the panel
 * says plainly that photos stay on this browser — the same honesty rule as the
 * rest of the product.
 */
import type { Attachment } from "../services/api";
import type { PhotoPalette } from "./photo-palette";

/** Photos kept per project before the oldest is dropped. */
export const PROJECT_PHOTOS_MAX = 12;
/** Total photo bytes kept per project before the oldest is dropped. */
export const PROJECT_PHOTOS_BYTES_MAX = 16 * 1024 * 1024;
/** The same image types an attachment accepts (a PDF is not a photo). */
export const PHOTO_MIMES = ["image/png", "image/jpeg", "image/webp"];

export interface ProjectPhotoMeta {
  id: string;
  name: string;
  mime: string;
  /** Decoded byte size, so the panel can say how much room the photo takes. */
  bytes: number;
  at: number;
  /** Message the photo travelled with, when it came from a reply. */
  from?: string;
  /** Colours sampled from these exact bytes, when sampling succeeded. */
  palette?: PhotoPalette | null;
  /** Small redraw used for the list; the full image stays in `data`. */
  thumbnail?: string;
}

export interface ProjectPhoto extends ProjectPhotoMeta {
  /** Base64 without the data: prefix — the same shape an attachment uses. */
  data: string;
  key: string;
}

export const photoKey = (account: string, project: string, id: string) =>
  `${account}:${project}:${id}`;

export const isPhotoMime = (mime: string) => PHOTO_MIMES.includes(mime);

/** Decoded size of base64 payload, without allocating the bytes. */
export const photoBytes = (data: string) =>
  Math.floor((data.length * 3) / 4) -
  (data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0);

/**
 * Content-addressed id: the same picture attached twice is one photo, whatever
 * it was named. A 32-bit hash is plenty here — it only has to tell apart the
 * handful of photos a project holds, and a collision would at worst show one
 * photo under another's name in the same project.
 */
export function photoId(mime: string, data: string) {
  const text = `${mime}:${data}`;
  let hash = 0x811c9dc5;
  for (let at = 0; at < text.length; at++) {
    hash ^= text.charCodeAt(at);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/** "128 KB" / "1,4 MB" — the number a person can act on. */
export function photoSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024)
    return `${Math.round(bytes / 1024)} KB`.replace(".", ",");
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}

/**
 * Turns an attachment into a stored photo, refusing anything a photo cannot be.
 * Throwing here is the point: a photo that cannot be read must never be kept as
 * a photo that looked fine.
 */
export function photoFromAttachment(
  file: Attachment,
  extra: {
    at?: number;
    from?: string;
    palette?: PhotoPalette | null;
    thumbnail?: string;
  } = {},
): Omit<ProjectPhoto, "key"> {
  if (!file || typeof file.data !== "string" || typeof file.mime !== "string")
    throw new Error("Lampiran tidak dapat disimpan sebagai aset project.");
  if (!isPhotoMime(file.mime))
    throw new Error(
      `Hanya PNG, JPG, atau WebP yang bisa disimpan sebagai aset foto. ${file.name || "Berkas ini"} adalah ${file.mime || "jenis tak dikenal"}.`,
    );
  if (!file.data.length)
    throw new Error("Isi foto kosong, tidak ada yang disimpan.");
  const bytes = photoBytes(file.data);
  if (bytes > PROJECT_PHOTOS_BYTES_MAX)
    throw new Error(
      `Foto ${file.name} berukuran ${photoSize(bytes)}; batas per foto di aset project ${photoSize(PROJECT_PHOTOS_BYTES_MAX)}.`,
    );
  return {
    id: photoId(file.mime, file.data),
    name: (file.name || "foto").slice(0, 120),
    mime: file.mime,
    bytes,
    at: extra.at ?? Date.now(),
    data: file.data,
    ...(extra.from ? { from: extra.from } : {}),
    ...(extra.palette !== undefined ? { palette: extra.palette } : {}),
    ...(extra.thumbnail ? { thumbnail: extra.thumbnail } : {}),
  };
}

/**
 * What fits, newest first. The caps are per project and both are real: a project
 * with twelve 4 MB photos would hold 48 MB in a browser store that the user
 * cannot see or clear from anywhere else, so the byte budget bites first.
 */
export function fitPhotos(
  existing: ProjectPhotoMeta[],
  incoming: ProjectPhotoMeta[],
  {
    countMax = PROJECT_PHOTOS_MAX,
    bytesMax = PROJECT_PHOTOS_BYTES_MAX,
  }: { countMax?: number; bytesMax?: number } = {},
) {
  // Later wins: re-saving a photo that is already stored updates it (its new
  // timestamp and colours) instead of leaving a stale copy behind.
  const byId = new Map<string, ProjectPhotoMeta>();
  for (const photo of [...existing, ...incoming]) byId.set(photo.id, photo);
  const newestFirst = [...byId.values()].sort((a, b) => b.at - a.at);
  const keep: ProjectPhotoMeta[] = [];
  const dropped: ProjectPhotoMeta[] = [];
  let bytes = 0;
  for (const photo of newestFirst) {
    if (keep.length >= countMax || bytes + photo.bytes > bytesMax) {
      dropped.push(photo);
      continue;
    }
    bytes += photo.bytes;
    keep.push(photo);
  }
  return { keep, dropped };
}

/** Minimal shape check for records read back from the browser store. */
export const isStoredPhoto = (value: any): value is ProjectPhoto =>
  Boolean(
    value &&
    typeof value.key === "string" &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    isPhotoMime(value.mime) &&
    typeof value.data === "string" &&
    value.data.length > 0 &&
    Number.isFinite(value.bytes) &&
    Number.isFinite(value.at),
  );
