// Research that outlives the tab that started it.
//
// A research turn can run for a minute and cost credits on every round, so a
// closed tab must not throw that work away: the rounds keep running, and the
// finished answer waits here for the same account and project to come back.
//
// Two layers, on purpose (the same shape as the search cache):
//
//  * memory — always available, per process, bounded;
//  * shared — the `runtime_search_cache` table (migration 009) under the
//    `research-job:<project>:<request>` key prefix, so an answer that finished
//    before a restart (or on another instance) is still collectable. The store
//    holds one row per finished job, with its own TTL, and the row is deleted
//    the moment the client claims it. Without the migration, or if the table
//    cannot be written, the code falls back to memory and reports
//    `durable: false` in the admin diagnostics instead of pretending.
//
// Only *finished* jobs are persisted. A job that is still running cannot be
// resumed by a restarted process, and pretending otherwise would promise an
// answer nobody is producing: a run interrupted by a restart is reported to
// the browser as lost, while the credits of its unfinished rounds come back
// through the existing `piwu_recover_credits` sweep.
export const RESEARCH_JOB_TTL_MS = 6 * 60 * 60 * 1000;
export const RESEARCH_JOB_TTL_DEFAULT_MINUTES = RESEARCH_JOB_TTL_MS / 60000;
export const RESEARCH_JOBS_MAX = 20;
export const RESEARCH_JOBS_PER_PROJECT = 4;
const TABLE = "runtime_search_cache";
// Same codes the search cache treats as "this deployment has no migration 009".
const MISSING = ["42P01", "PGRST205", "PGRST202"];
const KEY_PREFIX = "research-job:";
const SWEEP_EVERY_WRITES = 10;

export const ttlMinutesFrom = (env = {}) => {
  const value = Number(env.RESEARCH_JOB_TTL_MINUTES);
  if (!Number.isFinite(value) || value < 1)
    return RESEARCH_JOB_TTL_DEFAULT_MINUTES;
  return Math.min(Math.round(value), 7 * 24 * 60);
};

export const jobKey = (projectId, requestId) =>
  `${KEY_PREFIX}${projectId}:${requestId}`;

/**
 * The lexicographic range that covers exactly one project's jobs. The upper
 * bound is the same prefix with `;` (0x3b, the character right after `:`) as
 * its last character — a UUID can never contain it, so no unrelated row can
 * fall inside the range.
 */
export const jobRange = (projectId) => {
  const prefix = `${KEY_PREFIX}${projectId}:`;
  return { prefix, upper: prefix.slice(0, -1) + ";" };
};

/** Public shape: no internal promise, no cross-project data, no raw prompt. */
function view(job) {
  return {
    requestId: job.requestId,
    state: job.state,
    prompt: job.prompt,
    mode: job.mode,
    model: job.model,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt || 0,
    creditsUsed: job.creditsUsed || 0,
    error: job.error || "",
    ...(job.state === "ready" ? { result: job.result } : {}),
  };
}

/** What a stored row carries: the public view plus who may collect it. */
function stored(job) {
  return { ...view(job), userId: job.userId, projectId: job.projectId };
}

/** A stored payload back to the public view: the caller's own ids stay inside. */
function publicOf(payload) {
  return {
    requestId: payload.requestId,
    state: payload.state,
    prompt: payload.prompt,
    mode: payload.mode,
    model: payload.model,
    startedAt: payload.startedAt,
    finishedAt: payload.finishedAt || 0,
    creditsUsed: payload.creditsUsed || 0,
    error: payload.error || "",
    ...(payload.state === "ready" ? { result: payload.result } : {}),
  };
}

const isSnapshot = (payload) =>
  Boolean(
    payload &&
    typeof payload === "object" &&
    typeof payload.requestId === "string" &&
    typeof payload.userId === "string" &&
    typeof payload.projectId === "string" &&
    (payload.state === "ready" || payload.state === "failed"),
  );

export function createResearchJobs({
  ttlMs,
  ttlMinutes,
  max = RESEARCH_JOBS_MAX,
  perProject = RESEARCH_JOBS_PER_PROJECT,
  now = Date.now,
  admin = null,
  env = {},
} = {}) {
  const minutes = ttlMinutes ?? ttlMinutesFrom(env);
  const ttl = Number.isFinite(ttlMs) ? ttlMs : minutes * 60000;
  const jobs = new Map();
  const sharedAllowed = String(env.RESEARCH_JOBS_SHARED ?? "true") !== "false";
  const tally = { errors: 0, reads: 0, writes: 0 };
  let client = sharedAllowed ? admin : null;
  // Once the table proves to be missing, every later call would fail the same
  // way: stop trying (and stop counting errors) until the process restarts.
  let disabled = false;

  // One process normally has exactly one service-role client, so this only
  // rebinds when a caller hands over a different one. Passing no client never
  // silently unbinds the shared layer.
  const attach = (next) => {
    if (!sharedAllowed || disabled || !next) return;
    if (next !== client) client = next;
  };
  const durable = () => Boolean(client) && !disabled;

  const sweep = () => {
    const t = now();
    for (const [requestId, job] of jobs)
      if (job.expiresAt <= t) jobs.delete(requestId);
  };
  const ordered = () =>
    [...jobs.values()].sort((a, b) => a.startedAt - b.startedAt);
  // One finished job per project beyond the cap is dropped, oldest first; a run
  // that is still working is only dropped when the global cap demands it.
  const trimProject = (projectId) => {
    if (!perProject) return;
    const mine = ordered().filter((job) => job.projectId === projectId);
    while (mine.length > perProject) {
      const victim = mine.find((job) => job.state !== "running") || mine[0];
      jobs.delete(victim.requestId);
      mine.splice(mine.indexOf(victim), 1);
    }
  };
  const evict = () => {
    // Leave room for the job that is about to be added.
    while (jobs.size > Math.max(1, max) - 1) {
      const all = ordered();
      const victim = all.find((job) => job.state !== "running") || all[0];
      jobs.delete(victim.requestId);
    }
  };

  const fail = (error) => {
    if (MISSING.includes(error?.code)) disabled = true;
    tally.errors++;
    return false;
  };

  const store = async (job) => {
    if (!durable()) return false;
    try {
      const { error } = await client.from(TABLE).upsert({
        key: jobKey(job.projectId, job.requestId),
        payload: stored(job),
        created_at: new Date(now()).toISOString(),
        expires_at: new Date(job.expiresAt).toISOString(),
      });
      if (error) return fail(error);
      tally.writes++;
      // Opportunistic cleanup, the same pattern the search cache uses.
      if (tally.writes % SWEEP_EVERY_WRITES === 0) await dropExpired();
      return true;
    } catch {
      // A store outage must never break a turn; it is reported, not thrown.
      tally.errors++;
      return false;
    }
  };

  const dropExpired = async () => {
    if (!durable()) return;
    try {
      await client
        .from(TABLE)
        .delete()
        .lt("expires_at", new Date(now()).toISOString())
        .abortSignal(AbortSignal.timeout(4000));
    } catch {
      tally.errors++;
    }
  };

  const drop = async (projectId, requestId) => {
    if (!durable()) return false;
    try {
      const { error } = await client
        .from(TABLE)
        .delete()
        .eq("key", jobKey(projectId, requestId))
        .abortSignal(AbortSignal.timeout(4000));
      if (error) return fail(error);
      return true;
    } catch {
      tally.errors++;
      return false;
    }
  };

  /** Rows for one project, with the row's own expiry, never someone else's. */
  const readProject = async (projectId) => {
    if (!durable()) return [];
    const { prefix, upper } = jobRange(projectId);
    try {
      const { data, error } = await client
        .from(TABLE)
        .select("payload,expires_at")
        .gte("key", prefix)
        .lt("key", upper)
        .abortSignal(AbortSignal.timeout(4000));
      if (error) {
        fail(error);
        return [];
      }
      tally.reads++;
      return (Array.isArray(data) ? data : [])
        .filter((row) => isSnapshot(row?.payload))
        .map((row) => ({
          job: row.payload,
          expiresAt: Date.parse(row.expires_at),
        }));
    } catch {
      tally.errors++;
      return [];
    }
  };

  const start = ({
    requestId,
    userId,
    projectId,
    prompt = "",
    mode = "",
    model = "",
  }) => {
    sweep();
    const existing = jobs.get(requestId);
    if (existing) return existing;
    evict();
    const job = {
      requestId,
      userId,
      projectId,
      prompt: String(prompt).slice(0, 300),
      mode,
      model,
      state: "running",
      result: null,
      error: "",
      creditsUsed: 0,
      startedAt: now(),
      finishedAt: 0,
      expiresAt: now() + ttl,
    };
    jobs.set(requestId, job);
    trimProject(projectId);
    return job;
  };

  /**
   * Marks a job finished and mirrors it to the shared table (when there is
   * one), so the answer survives a restart. Returns the public view.
   */
  const finish = async (
    requestId,
    { result = null, error = "", creditsUsed = 0 } = {},
  ) => {
    const job = jobs.get(requestId);
    if (!job || job.state !== "running") return null;
    job.finishedAt = now();
    job.expiresAt = job.finishedAt + ttl;
    if (result) {
      job.state = "ready";
      job.result = result;
      job.creditsUsed = creditsUsed;
    } else {
      job.state = "failed";
      job.error = error || "Riset gagal diselesaikan.";
    }
    trimProject(job.projectId);
    await store(job);
    return view(job);
  };

  const list = async ({ userId, projectId }) => {
    sweep();
    const mine = [...jobs.values()]
      .filter((job) => job.userId === userId && job.projectId === projectId)
      .sort((a, b) => b.startedAt - a.startedAt)
      .map(view);
    const rows = (await readProject(projectId))
      .filter(
        (row) =>
          row.job.userId === userId &&
          row.expiresAt > now() &&
          !jobs.has(row.job.requestId),
      )
      .map((row) => publicOf(row.job));
    return [...mine, ...rows].sort((a, b) => b.startedAt - a.startedAt);
  };

  const claim = async ({ requestId, userId, projectId }) => {
    sweep();
    const job = jobs.get(requestId);
    if (job && job.userId === userId && job.projectId === projectId) {
      jobs.delete(requestId);
      // The stored copy is removed too, so a later visit cannot show it again.
      await drop(projectId, requestId);
      return view(job);
    }
    const row = (await readProject(projectId)).find(
      (stored) =>
        stored.job.requestId === requestId &&
        stored.job.userId === userId &&
        stored.expiresAt > now(),
    );
    if (!row) return null;
    await drop(projectId, requestId);
    return publicOf(row.job);
  };

  const stats = async () => {
    sweep();
    const all = [...jobs.values()];
    const out = {
      jobs: all.length,
      running: all.filter((job) => job.state === "running").length,
      ready: all.filter((job) => job.state === "ready").length,
      ttlMinutes: Math.round(ttl / 60000),
      max,
      // Honest reporting: false means a restart would lose finished answers.
      durable: durable(),
      errors: tally.errors,
    };
    if (!durable()) return out;
    try {
      // How many answers the shared table is holding right now, so the admin
      // panel can show the durable half instead of only this process's memory.
      const { data, error } = await client
        .from(TABLE)
        .select("key")
        .gte("key", KEY_PREFIX)
        .lt("key", KEY_PREFIX.slice(0, -1) + ";")
        .abortSignal(AbortSignal.timeout(4000));
      if (error) {
        fail(error);
        return out;
      }
      return { ...out, stored: Array.isArray(data) ? data.length : 0 };
    } catch {
      tally.errors++;
      return out;
    }
  };

  return {
    start,
    finish,
    list,
    claim,
    stats,
    attach,
    durable,
    reset() {
      jobs.clear();
      client = sharedAllowed ? null : client;
      disabled = false;
      tally.errors = 0;
      tally.reads = 0;
      tally.writes = 0;
    },
    size: () => jobs.size,
  };
}
