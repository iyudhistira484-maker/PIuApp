import {
  userActive,
  projectUnlocked,
  enforcePlatform,
  enforcePlan,
} from "./platform.mjs";
import { createClient } from "@supabase/supabase-js";
import { HttpError, check, uuid, wrap } from "./core.mjs";
export function createContext(env = process.env, fetcher = fetch) {
  const url = env.VITE_SUPABASE_URL,
    key = env.VITE_SUPABASE_ANON_KEY;
  const admin =
    url && env.SUPABASE_SERVICE_ROLE_KEY
      ? createClient(url, env.SUPABASE_SERVICE_ROLE_KEY, {
          auth: { persistSession: false, autoRefreshToken: false },
          global: { fetch: fetcher },
        })
      : null;
  const ctx = {
    env,
    fetcher,
    admin,
    needAdmin() {
      if (!admin)
        throw new HttpError(
          503,
          "Supabase server belum dikonfigurasi. Isi URL, anon key, dan service-role key di environment server.",
        );
      return admin;
    },
  };
  ctx.auth = wrap(async (req, res, next) => {
    if (!url || !key)
      throw new HttpError(503, "Autentikasi Supabase belum dikonfigurasi.");
    const bearer = req.get("Authorization");
    if (!bearer?.startsWith("Bearer "))
      throw new HttpError(
        401,
        "Masuk ke akun Supabase untuk menggunakan layanan cloud.",
      );
    const result = await fetcher(url.replace(/\/$/, "") + "/auth/v1/user", {
      headers: { apikey: key, Authorization: bearer },
      signal: AbortSignal.timeout(10000),
    }).catch(() => null);
    if (!result || result.status >= 500)
      throw new HttpError(
        503,
        "Layanan autentikasi tidak dapat dijangkau. Coba kembali setelah koneksi pulih.",
        "AUTH_UNAVAILABLE",
      );
    if (!result.ok)
      throw new HttpError(
        401,
        "Sesi tidak dapat diverifikasi. Silakan masuk kembali.",
      );
    const user = await result.json();
    if (
      !uuid(user.id) ||
      user.is_anonymous ||
      (!user.email_confirmed_at && !user.phone_confirmed_at)
    )
      throw new HttpError(401, "Akun terverifikasi diperlukan.");
    await userActive(ctx, user.id);
    const settings = await enforcePlatform(ctx, req);
    await enforcePlan(ctx, req, user, settings);
    req.user = user;
    req.db = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: bearer }, fetch: fetcher },
    });
    next();
  });
  ctx.project = (minimum = "Viewer") =>
    wrap(async (req, res, next) => {
      if (!uuid(req.params.id))
        throw new HttpError(400, "ID project tidak valid.");
      const db = ctx.needAdmin();
      const p = check(
        await db
          .from("projects")
          .select("id,name,owner_id")
          .eq("id", req.params.id)
          .maybeSingle(),
      );
      if (!p) throw new HttpError(404, "Project tidak tersedia.");
      let role =
        p.owner_id === req.user.id
          ? "Owner"
          : check(
              await db
                .from("collaborators")
                .select("role")
                .eq("project_id", p.id)
                .eq("user_id", req.user.id)
                .maybeSingle(),
            )?.role;
      if (
        !role ||
        ({ Viewer: 1, Editor: 2, Owner: 3 }[role] || 0) <
          { Viewer: 1, Editor: 2, Owner: 3 }[minimum]
      )
        throw new HttpError(403, "Peran Anda tidak mengizinkan tindakan ini.");
      if (minimum !== "Viewer" || !["GET", "HEAD"].includes(req.method))
        await projectUnlocked(ctx, p.id);
      req.project = p;
      req.projectRole = role;
      next();
    });
  ctx.snapshot = async (id) => {
    const data = check(
      await ctx
        .needAdmin()
        .from("project_workspaces")
        .select("payload,revision")
        .eq("project_id", id)
        .single(),
    );
    if (!data?.payload)
      throw new HttpError(409, "Sinkronkan project ke cloud terlebih dahulu.");
    return data;
  };
  ctx.reserve = async (user, id, amount, purpose) =>
    check(
      await ctx.needAdmin().rpc("piwu_reserve_credits", {
        p_user: user,
        p_id: id,
        p_amount: amount,
        p_purpose: purpose,
      }),
    );
  ctx.finish = async (id, success) =>
    check(
      await ctx
        .needAdmin()
        .rpc("piwu_finish_credits", { p_id: id, p_success: success }),
    );
  return ctx;
}
export function rateLimit({ max = 30, windowMs = 60000 } = {}) {
  const buckets = new Map();
  return async (req, res, next) => {
    const coordination = req.app?.locals.coordination;
    if (coordination?.mode === "database") {
      try {
        const result = await coordination.take(req, max, windowMs);
        res.set("X-RateLimit-Limit", String(max));
        res.set("X-RateLimit-Remaining", String(result.remaining));
        if (!result.allowed) {
          res.set("Retry-After", String(result.retryAfter));
          return next(
            new HttpError(
              429,
              "Terlalu banyak permintaan. Coba lagi sebentar.",
              "RATE_LIMITED",
            ),
          );
        }
        return next();
      } catch (e) {
        return next(e);
      }
    }
    const now = Date.now();
    if (buckets.size > 10000)
      for (const [k, v] of buckets) if (v.until < now) buckets.delete(k);
    const key = req.user?.id || req.ip;
    let b = buckets.get(key);
    if (!b || b.until < now) b = { n: 0, until: now + windowMs };
    if (!buckets.has(key) && buckets.size >= 10000)
      return next(new HttpError(429, "Layanan sedang sibuk."));
    buckets.set(key, b);
    if (++b.n > max)
      return next(
        new HttpError(429, "Terlalu banyak permintaan. Coba lagi sebentar."),
      );
    next();
  };
}
