import { createHash } from "node:crypto";

// Search results are public web data with a short useful life, so caching them
// is safe and saves both money and vendor quota. Two layers exist on purpose:
//
//  * memory — always available, per process;
//  * shared — the `runtime_search_cache` table (migration 009), so a second
//    instance does not pay the vendor again for a query another instance just
//    answered. Without the migration, or if the table cannot be read, the code
//    falls back to memory and reports mode "process" instead of pretending.
//
// The key is a hash of provider + kind + normalized query: the query never
// leaves the row in clear text, and no key or credential is part of it.

export const SEARCH_CACHE_TTL_MS = 15 * 60 * 1000;
const TABLE = "runtime_search_cache";
const MISSING = ["42P01", "PGRST205", "PGRST202"];

export const cacheKey = (parts) =>
  createHash("sha256").update(parts.join("\u0000")).digest("hex");

export function createSearchCache(
  { admin = null, env = {} } = {},
  { ttlMs = SEARCH_CACHE_TTL_MS, maxEntries = 120 } = {},
) {
  const memory = new Map();
  const stats = { hits: 0, memoryHits: 0, sharedHits: 0, writes: 0, errors: 0 };
  const sharedAllowed = String(env.SEARCH_CACHE_SHARED ?? "true") !== "false";
  let client = sharedAllowed ? admin : null;
  let cleanupCounter = 0;
  // Once the table proves to be missing, every later call would fail the same
  // way: stop trying (and stop counting errors) until the process restarts.
  let disabled = false;

  // One process normally has exactly one service-role client, so this only
  // rebinds when a caller hands over a different one (tests, or a restarted
  // context). Passing no client never silently unbinds the shared layer.
  const attach = (next) => {
    if (!sharedAllowed || disabled || !next) return;
    if (next !== client) client = next;
  };
  const mode = () => (client ? "shared" : "process");

  const remember = (key, value) => {
    memory.delete(key);
    memory.set(key, { value, expires: Date.now() + ttlMs });
    if (memory.size > maxEntries) memory.delete(memory.keys().next().value);
  };

  const usable = (value) =>
    value && typeof value === "object" && Array.isArray(value.sources)
      ? value
      : null;

  async function cleanup() {
    if (!client) return;
    try {
      const cut = new Date().toISOString();
      await client
        .from(TABLE)
        .delete()
        .lt("expires_at", cut)
        .abortSignal(AbortSignal.timeout(4000));
    } catch {
      stats.errors++;
    }
  }

  return {
    mode,
    stats,
    attach,
    size: () => memory.size,
    reset() {
      memory.clear();
      client = sharedAllowed ? null : client;
      disabled = false;
      cleanupCounter = 0;
    },
    async get(key) {
      const local = memory.get(key);
      if (local && local.expires > Date.now()) {
        stats.hits++;
        stats.memoryHits++;
        return { value: local.value, mode: "process" };
      }
      if (local) memory.delete(key);
      if (!client) {
        stats.misses++;
        return null;
      }
      try {
        // `limit(1)` + array keeps the fixture and PostgREST semantics identical
        // ("no rows" is an empty array, not a special accept header).
        const row = await client
          .from(TABLE)
          .select("payload,expires_at")
          .eq("key", key)
          .limit(1)
          .abortSignal(AbortSignal.timeout(4000));
        if (row.error) throw row.error;
        const found = Array.isArray(row.data) ? row.data[0] : null;
        const value = usable(found?.payload);
        if (!value || Date.parse(found?.expires_at || 0) <= Date.now()) {
          stats.misses++;
          return null;
        }
        stats.hits++;
        stats.sharedHits++;
        remember(key, value);
        return { value, mode: "shared" };
      } catch (error) {
        stats.errors++;
        // A missing table is a configuration fact, not a transient fault: stop
        // paying for a round trip that can never succeed in this process.
        if (MISSING.includes(error?.code)) {
          client = null;
          disabled = true;
        }
        stats.misses++;
        return null;
      }
    },
    async set(key, value) {
      remember(key, value);
      if (!client) return;
      try {
        await client.from(TABLE).upsert(
          {
            key,
            payload: value,
            expires_at: new Date(Date.now() + ttlMs).toISOString(),
          },
          { onConflict: "key" },
        );
        stats.writes++;
        if (++cleanupCounter % 20 === 0) await cleanup();
      } catch (error) {
        stats.errors++;
        if (MISSING.includes(error?.code)) {
          client = null;
          disabled = true;
        }
      }
    },
  };
}
