import {
  createHash,
  randomBytes,
  timingSafeEqual,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";
export class HttpError extends Error {
  constructor(status, message, code = "REQUEST_FAILED") {
    super(message);
    this.status = status;
    this.code = code;
  }
}
export const hash = (s) => createHash("sha256").update(s).digest("hex");
export const token = () => randomBytes(32).toString("hex");
export const equal = (a, b) =>
  typeof a === "string" &&
  typeof b === "string" &&
  Buffer.byteLength(a) === Buffer.byteLength(b) &&
  timingSafeEqual(Buffer.from(a), Buffer.from(b));
export const uuid = (s) =>
  typeof s === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    s,
  );
export const secretPattern =
  /sk-[a-zA-Z0-9_-]{20,}|-----BEGIN[ A-Z]*PRIVATE KEY-----|(?:ghp_|github_pat_)[A-Za-z0-9_]{20,}|AKIA[A-Z0-9]{16}/;
export function assertNoSecrets(value) {
  if (
    secretPattern.test(
      typeof value === "string" ? value : JSON.stringify(value),
    )
  )
    throw new HttpError(
      422,
      "Konten diblokir karena kemungkinan mengandung kredensial. Hapus dan rotasi secret sebelum melanjutkan.",
      "SECRET_DETECTED",
    );
}
export function validFiles(files) {
  if (
    !files ||
    Array.isArray(files) ||
    typeof files !== "object" ||
    Object.keys(files).length > 200
  )
    throw new HttpError(400, "Struktur file tidak valid.");
  for (const [path, content] of Object.entries(files)) {
    if (
      !path ||
      path.length > 240 ||
      path.startsWith("/") ||
      path.includes("\\") ||
      path.includes("\0") ||
      /(^|\/)\.git(\/|$)/.test(path) ||
      /(^|\/)\.\.(\/|$)|(^|\/)\.env($|[./])/.test(path) ||
      typeof content !== "string" ||
      Buffer.byteLength(content) > 262144
    )
      throw new HttpError(400, "Path atau ukuran file tidak valid.");
  }
  assertNoSecrets(files);
  return files;
}
export function seal(value, key, aad) {
  if (!/^[a-f0-9]{64}$/i.test(key || ""))
    throw new HttpError(503, "Enkripsi server belum dikonfigurasi.");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(key, "hex"), iv);
  cipher.setAAD(Buffer.from(aad));
  const encrypted = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([
    Buffer.from([1]),
    iv,
    cipher.getAuthTag(),
    encrypted,
  ]).toString("hex");
}
export function unseal(hex, key, aad) {
  const b = Buffer.from(hex.replace(/^\\x/, ""), "hex");
  if (b[0] !== 1) throw new Error("Versi ciphertext tidak didukung");
  const d = createDecipheriv(
    "aes-256-gcm",
    Buffer.from(key, "hex"),
    b.subarray(1, 13),
  );
  d.setAAD(Buffer.from(aad));
  d.setAuthTag(b.subarray(13, 29));
  return Buffer.concat([d.update(b.subarray(29)), d.final()]).toString("utf8");
}
export function check(result) {
  if (result.error) {
    const m = result.error.message || "";
    if (m.includes("PIWU_CREDITS"))
      throw new HttpError(
        402,
        "Kredit tidak cukup. Tambahkan kredit sebelum melanjutkan.",
      );
    if (m.includes("PIWU_DUPLICATE"))
      throw new HttpError(
        409,
        "Permintaan ini sudah diproses. Jangan mengirim ulang ID yang sama.",
      );
    if (m.includes("PIWU_RATE"))
      throw new HttpError(429, "Batas per jam tercapai. Coba lagi nanti.");
    if (m.includes("PIWU_INVITE_EMAIL"))
      throw new HttpError(403, "Masuk dengan alamat email penerima undangan.");
    if (m.includes("PIWU_INVITE_"))
      throw new HttpError(
        410,
        "Undangan sudah dipakai, dicabut, atau kedaluwarsa.",
      );
    if (["42P01", "PGRST202", "PGRST205", "42703"].includes(result.error.code))
      throw new HttpError(
        503,
        "Skema layanan belum siap. Periksa migration 001–006 sesuai fitur yang digunakan; jangan mengulang migration yang sudah terpasang.",
      );
    throw new HttpError(
      502,
      "Operasi database gagal. Tidak ada konfirmasi perubahan dari server.",
    );
  }
  return result.data;
}
export const wrap = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);
export const html = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export const limitText = (s, max = 2000) =>
  typeof s === "string" ? s.slice(0, max) : "";
export function appOrigin(env) {
  try {
    const u = new URL(env.APP_BASE_URL);
    if (
      (u.protocol !== "https:" &&
        !(u.protocol === "http:" && u.hostname === "localhost")) ||
      u.username ||
      u.password
    )
      throw 0;
    return u.origin;
  } catch {
    throw new HttpError(503, "APP_BASE_URL HTTPS belum dikonfigurasi.");
  }
}
/** `SEARCH_ENABLED=false` switches every outbound search off, so an operator
 * can keep the server from making (and billing) those calls. */
export function searchDisabled(env) {
  const flag = String(env.SEARCH_ENABLED ?? "true").toLowerCase();
  return flag === "false" || flag === "0" || flag === "off" || flag === "no";
}
export function capabilities(env) {
  const auth = Boolean(env.VITE_SUPABASE_URL && env.VITE_SUPABASE_ANON_KEY);
  const db = auth && Boolean(env.SUPABASE_SERVICE_ROLE_KEY);
  return {
    auth,
    cloud: db,
    // LLM_MODEL is optional: when it is empty the first model the API key
    // offers is used, resolved per request from GET {LLM_BASE_URL}/models.
    ai: db && Boolean(env.LLM_API_KEY && env.LLM_BASE_URL),
    // Search is only usable when a provider is both named and keyed; which one
    // that is (and whether it is ready) is reported by researchStatus().
    search: db && !searchDisabled(env),
    whatsapp:
      db &&
      Boolean(
        env.WHATSAPP_TOKEN &&
        env.WHATSAPP_PHONE_ID &&
        env.WHATSAPP_TEMPLATE &&
        env.SUPABASE_SMS_HOOK_SECRET,
      ),
    sandbox: db && Boolean(env.E2B_API_KEY),
    payments:
      db &&
      Boolean(
        env.APP_BASE_URL &&
        ((env.PAYMENT_PROVIDER === "midtrans" && env.MIDTRANS_SERVER_KEY) ||
          (env.PAYMENT_PROVIDER === "xendit" &&
            env.XENDIT_SECRET_KEY &&
            env.XENDIT_WEBHOOK_TOKEN)),
      ),
    email:
      db && Boolean(env.RESEND_API_KEY && env.EMAIL_FROM && env.APP_BASE_URL),
    secrets: db && /^[a-f0-9]{64}$/i.test(env.SECRETS_ENCRYPTION_KEY || ""),
    audit: db && Boolean(env.E2B_API_KEY && env.E2B_TEMPLATE),
    marketplace: db,
    recordings: db,
  };
}
