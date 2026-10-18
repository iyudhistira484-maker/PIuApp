import test from "node:test";
import assert from "node:assert/strict";
import {
  createResearchJobs,
  jobKey,
  jobRange,
  RESEARCH_JOBS_MAX,
} from "../server/lib/research-jobs.mjs";

// The store is what makes a closed tab harmless: a finished answer waits for the
// same account and project, is handed over exactly once, and never grows without
// a bound. Time is injected, so expiry is proven instead of waited for.
//
// Since migration 009 exists, finished jobs are also mirrored to the shared
// `runtime_search_cache` table under the `research-job:` key prefix, so an
// answer survives a restart. The fake below speaks the same PostgREST subset
// the real client uses (select/eq/gte/lt/upsert/delete).
const owner = { userId: "user-1", projectId: "project-1" };
const PROJECT = "11111111-2222-4333-8444-555555555555";

type Row = Record<string, any>;

function fakeAdmin(
  rows: Map<string, Row>,
  { missing = false, track }: { missing?: boolean; track?: string[] } = {},
) {
  const respond = (mode: string, filters: Array<[string, string, string]>) => {
    track?.push(mode);
    if (missing)
      return { data: null, error: { code: "PGRST205", message: "no table" } };
    const matches = [...rows.values()].filter((row) =>
      filters.every(([column, op, value]) => {
        const cell = String(row[column] ?? "");
        if (op === "eq") return cell === value;
        if (op === "lt") return cell < value;
        if (op === "gte") return cell >= value;
        return true;
      }),
    );
    if (mode === "select") return { data: matches, error: null };
    for (const row of matches) rows.delete(row.key);
    return { data: null, error: null };
  };
  return {
    from: () => {
      const filters: Array<[string, string, string]> = [];
      let mode = "select";
      const builder: any = {
        select: () => builder,
        eq: (column: string, value: string) => {
          filters.push([column, "eq", value]);
          return builder;
        },
        gte: (column: string, value: string) => {
          filters.push([column, "gte", value]);
          return builder;
        },
        lt: (column: string, value: string) => {
          filters.push([column, "lt", value]);
          return builder;
        },
        abortSignal: () => builder,
        delete: () => {
          mode = "delete";
          return builder;
        },
        upsert: async (row: Row) => {
          track?.push("upsert");
          if (missing)
            return { error: { code: "PGRST205", message: "no table" } };
          rows.set(row.key, row);
          return { error: null };
        },
        then: (resolve: any, reject?: any) =>
          Promise.resolve(respond(mode, filters)).then(resolve, reject),
      };
      return builder;
    },
  } as any;
}

const finished = (content: string) => ({ content, sources: [] });

test("a finished job waits for its own account and project and is handed over once", async () => {
  const jobs = createResearchJobs();
  jobs.start({
    requestId: "r1",
    ...owner,
    prompt: "Cari dokumentasi",
    mode: "Ask",
  });
  // Still running: nothing to collect yet, and nobody else can see it.
  assert.equal((await jobs.list(owner))[0].state, "running");
  assert.deepEqual(
    await jobs.list({ userId: "user-2", projectId: "project-1" }),
    [],
  );
  assert.deepEqual(
    await jobs.list({ userId: "user-1", projectId: "project-2" }),
    [],
  );

  await jobs.finish("r1", { result: finished("Jawaban [1]"), creditsUsed: 2 });
  const [listed] = await jobs.list(owner);
  assert.equal(listed.state, "ready");
  assert.equal(listed.creditsUsed, 2);
  assert.equal(listed.result.content, "Jawaban [1]");
  assert.match(listed.prompt, /Cari dokumentasi/);

  // Claiming hands it over exactly once, and only to its owner.
  assert.equal(
    await jobs.claim({
      requestId: "r1",
      userId: "user-2",
      projectId: "project-1",
    }),
    null,
  );
  assert.equal(
    (await jobs.claim({ requestId: "r1", ...owner })).requestId,
    "r1",
  );
  assert.equal(await jobs.claim({ requestId: "r1", ...owner }), null);
  assert.deepEqual(await jobs.list(owner), []);
});

test("a job that failed keeps the real reason instead of a fake answer", async () => {
  const jobs = createResearchJobs();
  jobs.start({ requestId: "r2", ...owner });
  await jobs.finish("r2", {
    error: "Mode riset aktif, tetapi belum ada provider.",
  });
  const [job] = await jobs.list(owner);
  assert.equal(job.state, "failed");
  assert.equal(job.error, "Mode riset aktif, tetapi belum ada provider.");
  assert.equal(job.result, undefined);
});

test("an expired job is dropped instead of delivered late", async () => {
  let clock = 1_000;
  const jobs = createResearchJobs({ ttlMs: 60_000, now: () => clock });
  jobs.start({ requestId: "r3", ...owner });
  await jobs.finish("r3", { result: finished("Lama") });
  clock += 59_000;
  assert.equal((await jobs.list(owner)).length, 1);
  clock += 2_000;
  assert.deepEqual(await jobs.list(owner), []);
  assert.equal(await jobs.claim({ requestId: "r3", ...owner }), null);
  assert.equal(jobs.size(), 0);
});

test("the store stays bounded: the oldest finished job per project is evicted first", async () => {
  let clock = 5_000;
  const jobs = createResearchJobs({
    max: 3,
    perProject: 2,
    now: () => (clock += 10),
  });
  for (const requestId of ["a", "b", "c"])
    jobs.start({ requestId, ...owner, prompt: requestId });
  await jobs.finish("a", { result: finished("a") });
  await jobs.finish("b", { result: finished("b") });
  assert.ok(jobs.size() <= 3);
  // A third finished job in the same project drops the oldest finished one, not
  // the run that is still working.
  await jobs.finish("c", { result: finished("c") });
  const ids = (await jobs.list(owner)).map((job: any) => job.requestId).sort();
  assert.deepEqual(ids, ["b", "c"]);
  assert.ok(jobs.size() <= 3);
});

test("the cap holds across many projects and a dropped run is simply not collectable", async () => {
  const jobs = createResearchJobs({ max: 4, perProject: 2 });
  for (let i = 0; i < 12; i++) {
    jobs.start({ requestId: "job-" + i, userId: "u", projectId: "p-" + i });
  }
  assert.ok(jobs.size() <= 4, `expected at most 4 jobs, got ${jobs.size()}`);
  assert.equal(RESEARCH_JOBS_MAX > 0, true);
  const stats = await jobs.stats();
  assert.equal(stats.jobs, jobs.size());
  assert.equal(stats.running, jobs.size());
  assert.equal(stats.ttlMinutes > 0, true);
  // No table attached: the honest answer is "in-process only".
  assert.equal(stats.durable, false);
});

test("the same request id is never registered twice", () => {
  const jobs = createResearchJobs();
  const first = jobs.start({ requestId: "r4", ...owner, prompt: "Awal" });
  const again = jobs.start({ requestId: "r4", ...owner, prompt: "Ulang" });
  assert.equal(first, again);
  assert.equal(jobs.size(), 1);
  void jobs.list(owner).then(([job]) => assert.match(job.prompt, /Awal/));
});

test("a finished answer survives a restart and is still collectable once", async () => {
  const rows = new Map<string, Row>();
  const admin = fakeAdmin(rows);
  const before = createResearchJobs({
    admin,
    ttlMinutes: 360,
    now: () => 1_000_000,
  });
  before.start({
    requestId: "req-1",
    userId: "user-1",
    projectId: PROJECT,
    prompt: "Riset retry",
    mode: "Ask",
    model: "deepseek-chat",
  });
  // A running job is never written: a restarted process cannot resume it, and a
  // row would promise an answer nobody is producing.
  assert.equal(rows.size, 0);
  await before.finish("req-1", {
    result: finished("Pakai backoff [1]"),
    creditsUsed: 2,
  });
  assert.equal(rows.size, 1);
  const [key] = [...rows.keys()];
  assert.equal(key, jobKey(PROJECT, "req-1"));
  assert.equal(key, "research-job:" + PROJECT + ":req-1");
  assert.equal(
    rows.get(key).expires_at,
    new Date(1_000_000 + 360 * 60000).toISOString(),
  );

  // A brand-new process, same table: the answer is found and handed over once.
  const after = createResearchJobs({
    admin,
    ttlMinutes: 360,
    now: () => 1_000_000 + 60_000,
  });
  const [listed] = await after.list({ userId: "user-1", projectId: PROJECT });
  assert.equal(listed.state, "ready");
  assert.equal(listed.result.content, "Pakai backoff [1]");
  assert.equal(listed.creditsUsed, 2);
  assert.equal(listed.model, "deepseek-chat");
  // The row's ownership fields never reach the browser.
  assert.equal((listed as any).userId, undefined);
  assert.equal((listed as any).projectId, undefined);

  const stats = await after.stats();
  assert.equal(stats.durable, true);
  assert.equal(stats.stored, 1);

  assert.equal(
    (
      await after.claim({
        requestId: "req-1",
        userId: "user-1",
        projectId: PROJECT,
      })
    ).requestId,
    "req-1",
  );
  assert.equal(rows.size, 0);
  assert.equal(
    await after.claim({
      requestId: "req-1",
      userId: "user-1",
      projectId: PROJECT,
    }),
    null,
  );
});

test("a stored job belongs to one account and one project, and its range is exact", async () => {
  const rows = new Map<string, Row>();
  const admin = fakeAdmin(rows);
  const store = createResearchJobs({ admin, ttlMinutes: 360 });
  store.start({ requestId: "req-2", userId: "user-1", projectId: PROJECT });
  await store.finish("req-2", {
    result: finished("Rahasia [1]"),
    creditsUsed: 1,
  });

  const other = createResearchJobs({ admin, ttlMinutes: 360 });
  assert.deepEqual(
    await other.list({ userId: "user-2", projectId: PROJECT }),
    [],
  );
  assert.deepEqual(
    await other.list({ userId: "user-1", projectId: "project-lain" }),
    [],
  );
  assert.equal(
    await other.claim({
      requestId: "req-2",
      userId: "user-2",
      projectId: PROJECT,
    }),
    null,
  );
  assert.equal(
    await other.claim({
      requestId: "req-2",
      userId: "user-1",
      projectId: "project-lain",
    }),
    null,
  );
  // A rejected claim must not delete somebody else's answer.
  assert.equal(rows.size, 1);
  assert.equal(
    (
      await other.claim({
        requestId: "req-2",
        userId: "user-1",
        projectId: PROJECT,
      })
    ).result.content,
    "Rahasia [1]",
  );
  assert.equal(rows.size, 0);

  // The key range covers exactly one project, whatever the neighbouring keys are.
  const range = jobRange(PROJECT);
  assert.ok(jobKey(PROJECT, "a") >= range.prefix);
  assert.ok(jobKey(PROJECT, "a") < range.upper);
  assert.ok(jobKey("11111111-2222-4333-8444-555555555556", "a") >= range.upper);
  assert.ok(jobKey("00000000-0000-4000-8000-000000000000", "a") < range.prefix);
  assert.ok(jobKey("99999999-9999-4999-8999-999999999999", "a") >= range.upper);
});

test("a stored job that expired is neither listed nor claimable", async () => {
  const rows = new Map<string, Row>();
  const admin = fakeAdmin(rows);
  let clock = 10_000_000;
  const store = createResearchJobs({ admin, ttlMs: 60_000, now: () => clock });
  store.start({ requestId: "req-3", userId: "user-1", projectId: PROJECT });
  await store.finish("req-3", { result: finished("Sementara") });
  clock += 61_000;
  const fresh = createResearchJobs({ admin, ttlMs: 60_000, now: () => clock });
  assert.deepEqual(
    await fresh.list({ userId: "user-1", projectId: PROJECT }),
    [],
  );
  assert.equal(
    await fresh.claim({
      requestId: "req-3",
      userId: "user-1",
      projectId: PROJECT,
    }),
    null,
  );
  // The row is left for the expiry sweep instead of being delivered late.
  assert.equal(rows.size, 1);
});

test("a stored failure keeps its reason after a restart too", async () => {
  const rows = new Map<string, Row>();
  const admin = fakeAdmin(rows);
  const store = createResearchJobs({ admin });
  store.start({ requestId: "req-4", userId: "user-1", projectId: PROJECT });
  await store.finish("req-4", {
    error: "Provider pencarian tidak dikonfigurasi.",
  });
  const restarted = createResearchJobs({ admin });
  const [job] = await restarted.list({ userId: "user-1", projectId: PROJECT });
  assert.equal(job.state, "failed");
  assert.equal(job.error, "Provider pencarian tidak dikonfigurasi.");
  assert.equal(job.result, undefined);
});

test("without migration 009 the store says so and keeps working in memory", async () => {
  const rows = new Map<string, Row>();
  const admin = fakeAdmin(rows, { missing: true });
  const store = createResearchJobs({ admin });
  store.start({ requestId: "req-5", userId: "user-1", projectId: PROJECT });
  await store.finish("req-5", { result: finished("Tetap ada [1]") });
  const stats = await store.stats();
  assert.equal(stats.durable, false);
  assert.equal(stats.stored, undefined);
  assert.equal(stats.errors, 1);
  // One failure is enough to stop asking; it is not retried on every turn.
  store.start({ requestId: "req-6", userId: "user-1", projectId: PROJECT });
  await store.finish("req-6", { result: finished("Kedua") });
  assert.equal((await store.stats()).errors, 1);
  // The answers are still there for the tab that comes back to this process.
  const listed = await store.list({ userId: "user-1", projectId: PROJECT });
  assert.equal(listed.length, 2);
  assert.equal(
    listed.find((job: any) => job.requestId === "req-6").result.content,
    "Kedua",
  );
});

test("RESEARCH_JOBS_SHARED=false never touches the table", async () => {
  const track: string[] = [];
  const rows = new Map<string, Row>();
  const store = createResearchJobs({
    admin: fakeAdmin(rows, { track }),
    env: { RESEARCH_JOBS_SHARED: "false" },
  });
  store.start({ requestId: "req-7", userId: "user-1", projectId: PROJECT });
  await store.finish("req-7", { result: finished("Lokal [1]") });
  assert.deepEqual(track, []);
  assert.equal(rows.size, 0);
  assert.equal((await store.stats()).durable, false);
  assert.equal(
    (await store.list({ userId: "user-1", projectId: PROJECT })).length,
    1,
  );
});

test("a store outage is counted, never thrown at the turn", async () => {
  const broken = {
    from: () => {
      throw new Error("basis data mati");
    },
  } as any;
  const store = createResearchJobs({ admin: broken });
  store.start({ requestId: "req-8", userId: "user-1", projectId: PROJECT });
  const view = await store.finish("req-8", {
    result: finished("Jalan terus [1]"),
  });
  assert.equal(view.state, "ready");
  const stats = await store.stats();
  assert.equal(stats.errors >= 1, true);
  // The answer is still collectable from this process.
  assert.equal(
    (
      await store.claim({
        requestId: "req-8",
        userId: "user-1",
        projectId: PROJECT,
      })
    ).result.content,
    "Jalan terus [1]",
  );
});

test("the shared TTL is configurable and clamped", async () => {
  assert.equal((await createResearchJobs({ env: {} }).stats()).ttlMinutes, 360);
  assert.equal(
    (
      await createResearchJobs({
        env: { RESEARCH_JOB_TTL_MINUTES: "90" },
      }).stats()
    ).ttlMinutes,
    90,
  );
  // Nonsense falls back to the default instead of expiring instantly, and a
  // week is the ceiling.
  assert.equal(
    (
      await createResearchJobs({
        env: { RESEARCH_JOB_TTL_MINUTES: "0" },
      }).stats()
    ).ttlMinutes,
    360,
  );
  assert.equal(
    (
      await createResearchJobs({
        env: { RESEARCH_JOB_TTL_MINUTES: "99999" },
      }).stats()
    ).ttlMinutes,
    7 * 24 * 60,
  );
});
