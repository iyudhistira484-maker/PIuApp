import { HttpError, wrap } from "./core.mjs";
export const defaultSite = {
  maintenance: false,
  maintenance_message:
    "Pemeliharaan sedang berlangsung. Coba kembali sebentar lagi.",
  hero_title: "",
  hero_subtitle: "",
  support_email: "",
  enabled_services: {
    ai: true,
    sandbox: true,
    payments: true,
    marketplace: true,
    studio: true,
    // Admin-editable package prices live here because migration 005's
    // piwu_admin_action() whitelists the top-level keys of the value; adding a
    // new top-level key would need a migration. Empty = shared price ladder.
    plan_overrides: {},
    // Minimum package per enforced capability. "free" keeps today's promise
    // that no feature is locked; an operator can raise a row without a
    // migration because it lives inside enabled_services.
    plan_features: {
      sandbox: "free",
      studio: "free",
      marketplace_sell: "free",
    },
  },
};
export const schemaMissing = (e) =>
  ["42P01", "PGRST205", "PGRST202"].includes(e?.code);
/**
 * Package overrides from a stored settings value. They live beside the service
 * switches (`enabled_services.plan_overrides`) and a future top-level key is
 * accepted too, so a later migration can move them without breaking readers.
 */
export function planOverridesOf(value) {
  return value?.enabled_services?.plan_overrides ?? value?.plan_overrides ?? {};
}
export const PLAN_FEATURES = ["sandbox", "studio", "marketplace_sell"];
const PLAN_RANK = { free: 0, pro: 1, team: 2 };
/**
 * Minimum package per capability. Unknown or missing values mean "free", so
 * settings saved before this field existed never lock anyone out.
 */
export function planFeaturesOf(value) {
  const stored = value?.enabled_services?.plan_features;
  return Object.fromEntries(
    PLAN_FEATURES.map((key) => [
      key,
      Object.hasOwn(PLAN_RANK, stored?.[key]) ? stored[key] : "free",
    ]),
  );
}
export function planAllows(plan, minimum) {
  return (
    (PLAN_RANK[String(plan).toLowerCase()] ?? 0) >= (PLAN_RANK[minimum] ?? 0)
  );
}
/** Which gated capability a request touches, independent of the service switch. */
export function featureForRequest(path, method = "GET") {
  const route = String(path).replace(/^\/api/, "");
  if (route === "/marketplace" && method === "POST") return "marketplace_sell";
  if (/\/sandbox|\/packages|\/audit$/.test(route)) return "sandbox";
  if (/(^|\/)studio(\/|$)/.test(route)) return "studio";
  return null;
}
/** Active paid package, or Free when there is no covering subscription row. */
export async function userPlan(ctx, id) {
  const now = new Date().toISOString();
  const r = await ctx
    .needAdmin()
    .from("subscriptions")
    .select("plan")
    .eq("user_id", id)
    .eq("status", "active")
    .gt("current_period_end", now)
    .lte("current_period_start", now)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (schemaMissing(r.error)) return "free";
  if (r.error)
    throw new HttpError(
      503,
      "Paket akun belum dapat diverifikasi. Coba kembali sebentar lagi.",
      "PLAN_UNAVAILABLE",
    );
  const plan = String(r.data?.plan || "").toLowerCase();
  return Object.hasOwn(PLAN_RANK, plan) ? plan : "free";
}
export async function enforcePlan(ctx, req, user, settings) {
  if (!ctx.admin || !user?.id) return;
  const feature = featureForRequest(req.path, req.method);
  if (!feature) return;
  // enforcePlatform already read the settings for this request; reuse them.
  const value = settings ?? (await siteSettings(ctx)).value;
  const minimum = planFeaturesOf(value)[feature];
  if (minimum === "free") return;
  const plan = await userPlan(ctx, user.id);
  if (!planAllows(plan, minimum))
    throw new HttpError(
      403,
      `Fitur ini tersedia untuk paket ${minimum === "team" ? "Team" : "Pro"}. Buka /upgrade untuk melihat paket.`,
      "PLAN_REQUIRED",
    );
}
export function platformResult(result) {
  if (result.error) {
    const m = result.error.message || "";
    if (schemaMissing(result.error))
      throw new HttpError(
        503,
        "Panel admin belum disiapkan. Periksa migration 005_admin.sql dan 008_admin_directory.sql.",
        "ADMIN_SETUP",
      );
    const messages = {
      ADMIN_CONFLICT:
        "Data berubah atau proses sudah berjalan. Muat ulang sebelum mencoba lagi.",
      ADMIN_DUPLICATE: "ID permintaan sudah digunakan untuk tindakan berbeda.",
      ADMIN_LAST_SUPERADMIN:
        "Superadmin terakhir tidak boleh dihapus atau diturunkan perannya.",
      ADMIN_REMOVE_ROLE_FIRST:
        "Cabut peran admin pengguna ini sebelum menangguhkan atau menghapus akun.",
      ADMIN_SELF: "Akun Anda sendiri tidak dapat dihapus dari panel admin.",
      ADMIN_NEGATIVE_BALANCE: "Pengurangan akan membuat saldo negatif.",
      ADMIN_NOT_FOUND: "Data tidak ditemukan.",
      ADMIN_INVALID: "Format tindakan admin tidak valid.",
    };
    const code = Object.keys(messages).find((k) => m.includes(k));
    // A superadmin deleting their own account is forbidden for a different
    // reason than a missing role, so it keeps its own message.
    if (code === "ADMIN_SELF")
      throw new HttpError(403, messages[code], "ADMIN_SELF");
    if (result.error.code === "42501")
      throw new HttpError(
        403,
        "Anda tidak memiliki izin untuk tindakan admin ini.",
        "ADMIN_FORBIDDEN",
      );
    throw new HttpError(
      code === "ADMIN_NOT_FOUND" ? 404 : code === "ADMIN_INVALID" ? 400 : 409,
      code
        ? messages[code]
        : "Operasi admin gagal; perubahan belum dikonfirmasi.",
      code || "ADMIN_FAILED",
    );
  }
  return result.data;
}
export async function userActive(ctx, id) {
  if (!ctx.admin) return;
  const r = await ctx.admin
    .from("platform_user_controls")
    .select("suspended")
    .eq("user_id", id)
    .maybeSingle();
  if (schemaMissing(r.error)) {
    if (ctx.env?.NODE_ENV === "production")
      throw new HttpError(
        503,
        "Kontrol keamanan platform belum tersedia. Terapkan migration admin sebelum melanjutkan.",
        "ADMIN_SETUP",
      );
    return;
  }
  if (r.error)
    throw new HttpError(503, "Status akun belum dapat diverifikasi.");
  if (r.data?.suspended)
    throw new HttpError(
      403,
      "Akun Anda sedang ditangguhkan. Hubungi administrator.",
      "ACCOUNT_SUSPENDED",
    );
}
export async function projectUnlocked(ctx, id) {
  const r = await ctx
    .needAdmin()
    .from("platform_project_controls")
    .select("locked")
    .eq("project_id", id)
    .maybeSingle();
  if (schemaMissing(r.error)) {
    if (ctx.env?.NODE_ENV === "production")
      throw new HttpError(
        503,
        "Kontrol keamanan platform belum tersedia. Terapkan migration admin sebelum melanjutkan.",
        "ADMIN_SETUP",
      );
    return;
  }
  if (r.error)
    throw new HttpError(503, "Status project belum dapat diverifikasi.");
  if (r.data?.locked)
    throw new HttpError(
      423,
      "Project dikunci administrator. Baca dan ekspor tetap tersedia.",
      "PROJECT_LOCKED",
    );
}
export async function siteSettings(ctx) {
  if (!ctx.admin) return { revision: 0, value: defaultSite };
  const r = await ctx.admin
    .from("site_configuration")
    .select("revision,value")
    .eq("id", true)
    .maybeSingle();
  if (schemaMissing(r.error)) {
    if (ctx.env?.NODE_ENV === "production")
      throw new HttpError(
        503,
        "Konfigurasi keamanan platform belum tersedia.",
        "ADMIN_SETUP",
      );
    return { revision: 0, value: defaultSite };
  }
  if (r.error)
    throw new HttpError(503, "Konfigurasi platform tidak dapat dibaca.");
  return r.data || { revision: 0, value: defaultSite };
}
export async function enforcePlatform(ctx, req) {
  const path = req.path.replace(/^\/api/, "");
  if (
    ["/health", "/status", "/verify"].includes(path) ||
    path.startsWith("/admin") ||
    path.startsWith("/public") ||
    path.startsWith("/webhooks") ||
    path.startsWith("/announcements")
  )
    return;
  if (!ctx.admin) return;
  const { value } = await siteSettings(ctx);
  if (value.maintenance && !["GET", "HEAD", "OPTIONS"].includes(req.method))
    throw new HttpError(
      503,
      value.maintenance_message || defaultSite.maintenance_message,
      "MAINTENANCE",
    );
  const service = /\/ai$/.test(path)
    ? "ai"
    : /\/sandbox|\/packages|\/audit$/.test(path)
      ? "sandbox"
      : path === "/checkout"
        ? "payments"
        : /^\/marketplace|\/template$/.test(path)
          ? "marketplace"
          : /(^|\/)studio(\/|$)/.test(path)
            ? "studio"
            : null;
  if (
    (service && value.enabled_services?.[service] === false) ||
    (path === "/checkout" &&
      req.body?.sku === "template" &&
      value.enabled_services?.marketplace === false)
  )
    throw new HttpError(
      503,
      "Layanan ini sementara dinonaktifkan administrator.",
      "SERVICE_PAUSED",
    );
  return value;
}
export function platformGate(ctx) {
  return wrap(async (req, res, next) => {
    if (req.path === "/marketplace" && req.method === "GET")
      await enforcePlatform(ctx, req);
    next();
  });
}
export function platformAdmin(ctx, minimum = "auditor") {
  return wrap(async (req, res, next) => {
    const row = platformResult(
      await ctx
        .needAdmin()
        .from("platform_admins")
        .select("role")
        .eq("user_id", req.user.id)
        .maybeSingle(),
    );
    const rank = { auditor: 1, operator: 2, superadmin: 3 };
    if (
      !row ||
      !Object.hasOwn(rank, row.role) ||
      rank[row.role] < rank[minimum]
    )
      throw new HttpError(
        403,
        "Akun ini tidak memiliki akses administrator platform.",
        "ADMIN_FORBIDDEN",
      );
    req.adminRole = row.role;
    next();
  });
}
