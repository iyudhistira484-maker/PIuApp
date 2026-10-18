import { apiTimeoutMs } from "../lib/api-budget";
import { supabase } from "../lib/supabase";
import { useStore } from "../lib/store";
export class APIError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: string,
  ) {
    super(message);
    this.name = "APIError";
  }
}
export interface Attachment {
  name: string;
  mime: string;
  data: string;
}
export async function api<T = any>(
  path: string,
  body?: unknown,
  method = body === undefined ? "GET" : "POST",
  signal?: AbortSignal,
): Promise<T> {
  const user = useStore.getState().user;
  const isPublic =
    path === "/status" ||
    path === "/marketplace" ||
    path.startsWith("/public/");
  const session =
    !isPublic && supabase
      ? (await supabase.auth.getSession()).data.session
      : null;
  if (
    !isPublic &&
    (!user || user.demo || !session || session.user.id !== user.id)
  )
    throw new Error(
      "Masuk dengan akun Supabase untuk menggunakan layanan ini. Tidak ada permintaan yang dikirim tanpa sesi terverifikasi.",
    );
  // Budget per operation, in one testable place: see src/lib/api-budget.ts.
  const deadline = AbortSignal.timeout(apiTimeoutMs(path));
  let response: Response;
  try {
    response = await fetch("/api" + path, {
      method,
      signal: signal ? AbortSignal.any([signal, deadline]) : deadline,
      headers: {
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(session ? { Authorization: "Bearer " + session.access_token } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new APIError(
      deadline.aborted
        ? "Batas waktu API tercapai. Hasil operasi belum terkonfirmasi; periksa status sebelum mengulang."
        : "Koneksi API gagal. Hasil operasi belum terkonfirmasi; periksa koneksi dan status sebelum mengulang.",
      0,
      deadline.aborted ? "REQUEST_TIMEOUT" : "NETWORK_UNAVAILABLE",
    );
  }
  const result =
    response.status === 204
      ? null
      : await response.json().catch(() => {
          throw new APIError(
            "Server tidak mengembalikan respons JSON yang valid. Periksa koneksi API; operasi belum terkonfirmasi.",
            response.status,
            "INVALID_RESPONSE",
          );
        });
  if (!isPublic && useStore.getState().user?.id !== user?.id)
    throw new Error("Akun berubah. Respons sebelumnya diabaikan.");
  if (!response.ok)
    throw new APIError(
      result?.error || "Layanan tidak dapat menyelesaikan permintaan.",
      response.status,
      result?.code || "SERVICE_ERROR",
    );
  return result;
}
export function projectApi<T = any>(
  id: string,
  path: string,
  body?: unknown,
  method?: string,
) {
  const sync = useStore.getState().sync[id];
  if (
    body !== undefined &&
    [
      "template",
      "audit",
      "sandbox/command",
      "sandbox/preview",
      "packages",
    ].includes(path) &&
    sync?.phase !== "synced"
  )
    return Promise.reject(
      new Error(
        "Tunggu sampai project tersinkron ke cloud sebelum menjalankan operasi ini.",
      ),
    );
  return api<T>("/projects/" + id + "/" + path, body, method);
}
export async function readAttachment(file: File): Promise<Attachment> {
  if (file.size > 4 * 1024 * 1024) throw new Error("Lampiran maksimal 4 MB.");
  if (
    ![
      "image/png",
      "image/jpeg",
      "image/webp",
      "application/pdf",
      "text/plain",
    ].includes(file.type)
  )
    throw new Error(
      "Gunakan PNG, JPG, WebP, PDF, atau TXT. Ekspor file Figma sebagai gambar/PDF.",
    );
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () => reject(new Error("File tidak dapat dibaca."));
    reader.readAsDataURL(file);
  });
  return { name: file.name, mime: file.type, data };
}
