import { capabilities } from "./core.mjs";

// Read-only, bounded checks. No inference, shell, billing, or user
// records are returned. Configuration never means that a provider is live.
export function createReadinessReader(
  ctx,
  { now = Date.now, ttlMs = 30000, timeoutMs = 3000 } = {},
) {
  let cached,
    expires = 0,
    pending;
  async function probe() {
    const c = capabilities(ctx.env);
    const configured = (key) =>
      c[key] ? "configured_unverified" : "not_configured";
    const result = {
      mode: "real",
      checkedAt: new Date(now()).toISOString(),
      auth: configured("auth"),
      database: configured("cloud"),
      datasets: configured("cloud"),
      administration: configured("cloud"),
      studio: configured("cloud"),
      ai: configured("ai"),
      search: configured("search"),
      sandbox: configured("sandbox"),
      payments: configured("payments"),
      whatsapp: configured("whatsapp"),
      secrets: configured("secrets"),
      paymentMode: ctx.env.PAYMENT_LIVE === "true" ? "live" : "sandbox",
    };
    const request = async (path, key) => {
      const signal = AbortSignal.timeout(timeoutMs);
      // race bounds even a non-cooperative fetcher; native fetch also aborts I/O.
      return Promise.race([
        ctx
          .fetcher(ctx.env.VITE_SUPABASE_URL.replace(/\/$/, "") + path, {
            headers: { apikey: key, Authorization: "Bearer " + key },
            signal,
          })
          .then(async (r) => {
            if (r.ok) return "reachable";
            const code = await r.json().catch(() => ({}));
            return ["42P01", "PGRST205", "42703"].includes(code.code)
              ? "schema_missing"
              : "rejected";
          })
          .catch(() => "unreachable"),
        new Promise((resolve) =>
          signal.addEventListener("abort", () => resolve("unreachable"), {
            once: true,
          }),
        ),
      ]);
    };
    await Promise.all([
      c.auth &&
        request("/auth/v1/health", ctx.env.VITE_SUPABASE_ANON_KEY).then(
          (s) => (result.auth = s),
        ),
      c.cloud &&
        Promise.all(
          [
            "/rest/v1/project_workspaces?select=project_id,revision&limit=0",
            "/rest/v1/site_configuration?select=id,revision&limit=0",
            "/rest/v1/credit_accounts?select=user_id&limit=0",
          ].map((path) => request(path, ctx.env.SUPABASE_SERVICE_ROLE_KEY)),
        ).then((states) => {
          result.database = states.every((s) => s === "reachable")
            ? "reachable"
            : states.find((s) => s !== "reachable");
        }),
      ...[
        [
          "datasets",
          "/rest/v1/project_datasets?select=id,project_id,revision&limit=0",
        ],
        [
          "administration",
          "/rest/v1/platform_admins?select=user_id,role&limit=0",
        ],
        [
          "studio",
          "/rest/v1/studio_bridges?select=project_id,state,snapshot_id&limit=0",
        ],
      ].map(
        ([key, path]) =>
          c.cloud &&
          request(path, ctx.env.SUPABASE_SERVICE_ROLE_KEY).then((state) => {
            result[key] = state;
          }),
      ),
    ]);
    return result;
  }
  return () => {
    if (cached && now() < expires) return Promise.resolve(cached);
    if (pending) return pending;
    pending = probe()
      .then((result) => {
        cached = result;
        expires = now() + ttlMs;
        return result;
      })
      .finally(() => (pending = undefined));
    return pending;
  };
}
