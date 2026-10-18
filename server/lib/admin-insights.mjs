import { capabilities, HttpError } from "./core.mjs";
import { platformResult } from "./platform.mjs";
import {
  listProviderModels,
  modelCatalog,
  tierCost,
  tierModels,
} from "./ai-models.mjs";
import { STUDIO_PLUGIN } from "../../shared/studio.mjs";

// Read-only admin insight for the AI provider, per-account credits, and runtime
// coordination. Nothing here writes: actions still go through
// piwu_admin_action. Secrets are never projected — the AI key is reported as
// present/absent only, and the base URL is reduced to host + path.

const DAY = 86400000;
const WINDOW_DAYS = 30;
const MAX_ROWS = 5000;

/**
 * The same "credits are running out" threshold the dashboard shows a user, so
 * an operator looking at the panel sees the account at the moment its owner
 * does. Keep the two numbers together: src/lib/dashboard/credits.ts CREDIT_LOW.
 */
export const LOW_BALANCE = 10;
/** A cloud copy nobody has saved to for this long is dormant, not broken. */
const DORMANT_DAYS = 7;

/** Host and path of LLM_BASE_URL, with credentials, query, and hash dropped. */
export function maskBaseUrl(value) {
  if (!value) return { host: "", path: "" };
  try {
    const url = new URL(String(value));
    return { host: url.host, path: url.pathname.replace(/\/$/, "") };
  } catch {
    return { host: "tidak valid", path: "" };
  }
}

export function tierMapping(env, catalog) {
  const configured = tierModels(env);
  return ["Cepat", "Seimbang", "Kuat"].map((tier) => ({
    tier,
    model: configured[tier] || "",
    source: configured[tier]
      ? "LLM_MODEL_" + tier.toUpperCase()
      : env.LLM_MODEL
        ? "LLM_MODEL"
        : catalog?.defaultModel
          ? "model pertama provider"
          : "belum ditentukan",
    // What one chat turn on this tier bills, from the shared price list.
    cost: tierCost(tier),
  }));
}

function schemaMissing(error) {
  return ["42P01", "PGRST205", "PGRST202"].includes(error?.code);
}

async function usage(ctx, since) {
  const result = {
    windowDays: WINDOW_DAYS,
    since,
    aiCreditsSpent: 0,
    truncated: false,
    purposes: [],
  };
  if (!ctx.admin) return result;
  const ledger = await ctx.admin
    .from("credit_ledger")
    .select("delta,reference")
    .eq("reason", "ai")
    .gte("created_at", since)
    .limit(MAX_ROWS);
  if (ledger.error) {
    if (schemaMissing(ledger.error)) return result;
    platformResult(ledger);
  }
  for (const row of ledger.data || []) result.aiCreditsSpent += -row.delta;
  result.truncated = (ledger.data || []).length === MAX_ROWS;
  const reservations = await ctx.admin
    .from("credit_reservations")
    .select("purpose,status,amount")
    .gte("created_at", since)
    .limit(MAX_ROWS);
  if (reservations.error) {
    if (schemaMissing(reservations.error)) return result;
    platformResult(reservations);
  }
  const buckets = new Map();
  for (const row of reservations.data || []) {
    const entry = buckets.get(row.purpose) || {
      purpose: row.purpose,
      reserved: 0,
      settled: 0,
      refunded: 0,
      settledCredits: 0,
    };
    entry[row.status] = (entry[row.status] || 0) + 1;
    if (row.status === "settled") entry.settledCredits += row.amount;
    buckets.set(row.purpose, entry);
  }
  result.purposes = [...buckets.values()].sort((a, b) =>
    a.purpose.localeCompare(b.purpose),
  );
  return result;
}

export async function aiOverview(
  ctx,
  { refresh = false, now = Date.now() } = {},
) {
  const env = ctx.env;
  const configured = capabilities(env).ai;
  const base = maskBaseUrl(env.LLM_BASE_URL);
  const overview = {
    configured,
    baseHost: base.host,
    basePath: base.path,
    keyPresent: Boolean(env.LLM_API_KEY),
    // The key value never leaves the server, not even for superadmins.
    keyShown: false,
    defaultModel: env.LLM_MODEL || "",
    defaultSource: env.LLM_MODEL
      ? "LLM_MODEL"
      : "model pertama dari daftar provider",
    tiers: [],
    catalog: null,
    catalogError: "",
    catalogAt: "",
    usage: await usage(ctx, new Date(now - WINDOW_DAYS * DAY).toISOString()),
    notice:
      "Katalog dibaca langsung dari endpoint /models provider. Baris ini tidak menjalankan inference dan bukan bukti model benar-benar menjawab.",
  };
  if (!configured) {
    overview.tiers = tierMapping(env, null);
    return overview;
  }
  try {
    const models = await listProviderModels(ctx, { force: refresh });
    overview.catalog = modelCatalog(env, models);
    overview.catalogAt = new Date(now).toISOString();
    overview.tiers = tierMapping(env, overview.catalog);
  } catch (e) {
    overview.catalogError =
      e instanceof HttpError ? e.message : "Provider AI tidak dapat dijangkau.";
    overview.tiers = tierMapping(env, null);
  }
  return overview;
}

export async function accountDetail(ctx, id) {
  if (!ctx.admin)
    throw new HttpError(503, "Database cloud belum dikonfigurasi di server.");
  const user = await ctx.admin.auth.admin
    .getUserById(id)
    .catch(() => ({ data: null, error: true }));
  if (!user?.data?.user)
    throw new HttpError(404, "Akun tidak ditemukan di direktori auth.");
  const since = new Date(Date.now() - WINDOW_DAYS * DAY).toISOString();
  const balance = platformResult(
    await ctx.admin
      .from("credit_accounts")
      .select("balance,updated_at")
      .eq("user_id", id)
      .maybeSingle(),
  );
  const controls = platformResult(
    await ctx.admin
      .from("platform_user_controls")
      .select("suspended,reason,updated_at")
      .eq("user_id", id)
      .maybeSingle(),
  );
  const role = platformResult(
    await ctx.admin
      .from("platform_admins")
      .select("role,created_at")
      .eq("user_id", id)
      .maybeSingle(),
  );
  const projects = await ctx.admin
    .from("projects")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", id);
  if (projects.error && !schemaMissing(projects.error))
    platformResult(projects);
  const ledger = platformResult(
    await ctx.admin
      .from("credit_ledger")
      .select("id,delta,reason,reference,created_at")
      .eq("user_id", id)
      .order("created_at", { ascending: false })
      .limit(25),
  );
  const reservations = platformResult(
    await ctx.admin
      .from("credit_reservations")
      .select("id,amount,purpose,status,created_at")
      .eq("user_id", id)
      .order("created_at", { ascending: false })
      .limit(25),
  );
  const window = await ctx.admin
    .from("credit_ledger")
    .select("delta")
    .eq("user_id", id)
    .gte("created_at", since)
    .limit(MAX_ROWS);
  if (window.error && !schemaMissing(window.error)) platformResult(window);
  let added = 0,
    spent = 0;
  for (const row of window.data || []) {
    if (row.delta > 0) added += row.delta;
    else spent += -row.delta;
  }
  // Storage and Studio, per account: when the cloud copy was last written and
  // whether a plugin is paired right now. Both are counts/dates, never content.
  const lastProject = await ctx.admin
    .from("projects")
    .select("updated_at")
    .eq("owner_id", id)
    .order("updated_at", { ascending: false })
    .limit(1);
  if (lastProject.error && !schemaMissing(lastProject.error))
    platformResult(lastProject);
  const bridges = await ctx.admin
    .from("studio_bridges")
    .select("state,expires_at")
    .eq("user_id", id)
    .limit(20);
  if (bridges.error && !schemaMissing(bridges.error)) platformResult(bridges);
  const bridgeRows = bridges.error ? [] : bridges.data || [];
  return {
    account: {
      id,
      email: user.data.user.email || "",
      name: user.data.user.user_metadata?.name || "",
      createdAt: user.data.user.created_at || "",
      lastSignInAt: user.data.user.last_sign_in_at || "",
      verified: Boolean(
        user.data.user.email_confirmed_at || user.data.user.phone_confirmed_at,
      ),
    },
    balance: balance?.balance ?? null,
    balanceUpdatedAt: balance?.updated_at || "",
    suspended: Boolean(controls?.suspended),
    suspendedReason: controls?.reason || "",
    adminRole: role?.role || "",
    projects: projects.count || 0,
    // The same "running out" line the dashboard draws for this account.
    lowBalance:
      balance?.balance === null || balance?.balance === undefined
        ? null
        : balance.balance < LOW_BALANCE,
    lowBalanceThreshold: LOW_BALANCE,
    storage: {
      lastProjectUpdateAt: lastProject.error
        ? ""
        : lastProject.data?.[0]?.updated_at || "",
    },
    studio: {
      bridges: bridgeRows.length,
      active: bridgeRows.filter(
        (row) => Date.parse(row.expires_at) > Date.now(),
      ).length,
      lastState: bridgeRows[0]?.state || "",
      pluginVersion: STUDIO_PLUGIN.version,
    },
    ledger,
    reservations,
    window: {
      days: WINDOW_DAYS,
      added,
      spent,
      truncated: (window.data || []).length === MAX_ROWS,
    },
  };
}

export async function runtimeOverview(ctx, coordination) {
  const result = {
    mode: coordination?.mode || "memory",
    sandboxRouting:
      coordination?.mode === "database"
        ? "sticky-owner-lease"
        : "process-local",
    available: true,
    reason: "",
    slots: { active: 0, total: 0, max: 50, perUser: 2 },
    buckets: { active: 0, total: 0, hits: 0 },
    items: [],
    notice:
      "Angka dibaca dari tabel koordinasi bersama. Lease kedaluwarsa tidak dihitung sebagai sesi aktif.",
  };
  if (!ctx.admin) {
    result.available = false;
    result.reason = "not_configured";
    return result;
  }
  const now = Date.now();
  const slots = await ctx.admin
    .from("runtime_sandbox_slots")
    .select("user_id,project_id,owner,expires_at")
    .limit(200);
  const buckets = await ctx.admin
    .from("runtime_rate_buckets")
    .select("key,hits,expires_at")
    .limit(500);
  for (const query of [slots, buckets]) {
    if (!query.error) continue;
    if (schemaMissing(query.error)) {
      result.available = false;
      result.reason = "schema_missing";
      result.notice =
        "Tabel koordinasi runtime belum ada. Terapkan migration 007_runtime_coordination.sql, lalu muat ulang.";
      return result;
    }
    platformResult(query);
  }
  for (const row of slots.data || []) {
    result.slots.total += 1;
    if (Date.parse(row.expires_at) > now) {
      result.slots.active += 1;
      if (result.items.length < 20)
        result.items.push({
          user_id: row.user_id,
          project_id: row.project_id,
          owner: row.owner,
          expires_at: row.expires_at,
        });
    }
  }
  for (const row of buckets.data || []) {
    result.buckets.total += 1;
    if (Date.parse(row.expires_at) > now) {
      result.buckets.active += 1;
      result.buckets.hits += row.hits || 0;
    }
  }
  return result;
}

/**
 * Storage and backup, as the platform sees it. Counts only: no project payload,
 * no file content, no user text ever leaves the database for this panel.
 */
export async function storageOverview(ctx, { now = Date.now() } = {}) {
  const result = {
    available: true,
    reason: "",
    dormantDays: DORMANT_DAYS,
    workspaces: { total: 0, dormant: 0 },
    datasets: { total: 0, reported: true },
    // The feature that exists for this: a project backup is downloaded by its
    // owner as JSON. The server keeps no second copy.
    backup:
      "Cadangan project dibuat di peramban sebagai unduhan JSON oleh pemiliknya. Server tidak menyimpan salinan cadangan.",
    notice:
      "Hitungan baris tabel. Isi project tidak pernah diproyeksikan ke panel ini.",
  };
  if (!ctx.admin) {
    result.available = false;
    result.reason = "not_configured";
    return result;
  }
  const count = async (table, filter) => {
    let query = ctx.admin
      .from(table)
      .select("*", { count: "exact", head: true });
    if (filter) query = filter(query);
    const answer = await query;
    if (answer.error) {
      if (schemaMissing(answer.error)) return null;
      platformResult(answer);
    }
    return answer.count || 0;
  };
  const cutoff = new Date(now - DORMANT_DAYS * DAY).toISOString();
  const [total, dormant, datasets] = await Promise.all([
    count("project_workspaces"),
    count("project_workspaces", (q) => q.lt("updated_at", cutoff)),
    count("project_datasets"),
  ]);
  if (total === null) {
    result.available = false;
    result.reason = "schema_missing";
    result.notice =
      "Tabel salinan cloud belum ada. Terapkan migration 002_workspace_sync.sql (dan 004 untuk dataset), lalu muat ulang.";
    return result;
  }
  result.workspaces = { total, dormant: dormant ?? 0 };
  result.datasets = { total: datasets ?? 0, reported: datasets !== null };
  return result;
}

/**
 * The Roblox Studio bridge and the plugin version the server hands out.
 *
 * This reports the version the app serves. It cannot report the version a
 * person has installed: the plugin never sends it, so a mismatch is only
 * visible inside Studio when the plugin compares itself against /studio/status.
 */
export async function studioOverview(ctx, { now = Date.now() } = {}) {
  const result = {
    available: true,
    reason: "",
    plugin: {
      version: STUDIO_PLUGIN.version,
      file: STUDIO_PLUGIN.file,
      bundle: STUDIO_PLUGIN.bundle,
    },
    bridges: { total: 0, active: 0, states: [], truncated: false },
    notice:
      "Token bridge disimpan hanya sebagai hash dan tidak pernah ditampilkan. Versi plugin yang terpasang tidak dilaporkan ke server, jadi panel tidak bisa memastikan salinan pengguna sudah " +
      STUDIO_PLUGIN.version +
      ".",
  };
  if (!ctx.admin) {
    result.available = false;
    result.reason = "not_configured";
    return result;
  }
  const rows = await ctx.admin
    .from("studio_bridges")
    .select("state,expires_at")
    .limit(MAX_ROWS / 10);
  if (rows.error) {
    if (schemaMissing(rows.error)) {
      result.available = false;
      result.reason = "schema_missing";
      result.notice =
        "Tabel bridge Studio belum ada. Terapkan migration 006_studio_bridge.sql, lalu muat ulang.";
      return result;
    }
    platformResult(rows);
  }
  const states = new Map();
  for (const row of rows.data || []) {
    result.bridges.total += 1;
    if (Date.parse(row.expires_at) > now) result.bridges.active += 1;
    states.set(row.state, (states.get(row.state) || 0) + 1);
  }
  result.bridges.states = [...states.entries()]
    .map(([state, count]) => ({ state, count }))
    .sort((a, b) => a.state.localeCompare(b.state));
  result.bridges.truncated = (rows.data || []).length === MAX_ROWS / 10;
  return result;
}
