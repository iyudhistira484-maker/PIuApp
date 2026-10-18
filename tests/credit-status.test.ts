import test from "node:test";
import assert from "node:assert/strict";
import {
  NOTE_INVALID,
  NOTE_MISSING,
  NOTE_UNREADABLE,
  creditStatus,
  normalizeCreditStatus,
} from "../server/lib/credit-status.mjs";

// `/api/account` must tell the page what the database grants per day, or say
// why it cannot. What it may never do: keep printing the shared ladder's
// number as if the database had confirmed it.

/** What PostgREST hands back for a successful RPC: the jsonb as an object. */
const answer = (data: unknown) => ({ data, error: null });

/** A Supabase-shaped client whose single RPC answers whatever the test says. */
const admin = (result: any) => ({
  calls: [] as any[],
  async rpc(name: string, args: any) {
    this.calls.push({ name, args });
    if (result instanceof Error) throw result;
    return result;
  },
});

const databaseAnswer = {
  applied: true,
  source: "database",
  plan: "Free",
  daily: 20,
  dailyClaimed: 20,
  dailyRemaining: 12,
  monthlyCap: 600,
  monthlyUsed: 120,
  resetUtcHour: 0,
  resetAt: "2026-10-17T00:00:00+00:00",
  planMonths: 2,
  topupMonths: 12,
};

test("a healthy database answer is passed through as numbers and an instant", async () => {
  const client = admin(answer(databaseAnswer));
  const status = await creditStatus(client, "user-1");
  assert.equal(client.calls.length, 1);
  assert.equal(client.calls[0].name, "piwu_credit_status");
  assert.deepEqual(client.calls[0].args, { p_user: "user-1" });
  assert.deepEqual(status, {
    ...databaseAnswer,
    // The instant the countdown uses is normalised so the page can compare it
    // with its own clock without parsing dialects.
    resetAt: "2026-10-17T00:00:00.000Z",
  });
  // A paid plan has no ceiling: null, not zero (zero would read as "used up").
  assert.equal(
    normalizeCreditStatus({ ...databaseAnswer, plan: "Team", monthlyCap: null })
      ?.monthlyCap,
    null,
  );
  // Postgres may hand numbers as strings through jsonb; they still count.
  assert.equal(
    normalizeCreditStatus({
      ...databaseAnswer,
      daily: "40",
      dailyRemaining: "38",
    })?.dailyRemaining,
    38,
  );
});

test("a database without migration 010 is named, not guessed at", async () => {
  for (const code of ["PGRST202", "42P01", "PGRST205"]) {
    const status = await creditStatus(
      admin({ data: null, error: { code, message: "not found" } }),
      "user-1",
    );
    assert.equal(status.applied, false);
    assert.equal(status.source, "migration");
    assert.equal(status.note, NOTE_MISSING);
    assert.match(status.note, /010_credit_lots\.sql/);
    assert.equal(
      "daily" in status,
      false,
      "tanpa migration tidak ada angka jatah",
    );
  }
});

test("a read that fails for another reason is reported as unreadable, not as zero", async () => {
  const denied = await creditStatus(
    admin({
      data: null,
      error: { code: "42501", message: "permission denied" },
    }),
    "user-1",
  );
  assert.equal(denied.applied, false);
  assert.equal(denied.source, "error");
  assert.equal(denied.code, "42501");
  assert.equal(denied.note, NOTE_UNREADABLE);
  // A client that throws is the same answer: the note, never a crash and never
  // a fabricated zero.
  const thrown = await creditStatus(admin(new Error("fetch failed")), "user-1");
  assert.equal(thrown.source, "error");
  assert.equal(thrown.note, NOTE_UNREADABLE);
  assert.equal("daily" in thrown, false);
});

test("an answer that makes no sense is refused instead of half-rendered", async () => {
  for (const bad of [
    null,
    {},
    { daily: "banyak", dailyRemaining: 5, resetAt: "2026-10-17T00:00:00Z" },
    { daily: 20, dailyRemaining: 5, resetAt: "bukan tanggal" },
    { daily: -1, dailyRemaining: 5, resetAt: "2026-10-17T00:00:00Z" },
    "jatah 20 kredit",
  ]) {
    const status = await creditStatus(admin(answer(bad)), "user-1");
    assert.equal(status.applied, false, JSON.stringify(bad));
    assert.equal(status.source, "invalid");
    assert.equal(status.note, NOTE_INVALID);
  }
  // Counters that arrive damaged are floored to zero instead of rendered.
  const fixed = normalizeCreditStatus({
    ...databaseAnswer,
    dailyClaimed: -5,
    monthlyUsed: "x",
  });
  assert.equal(fixed?.dailyClaimed, 0);
  assert.equal(fixed?.monthlyUsed, 0);
  // A negative "left over today" is not a small number, it is nonsense: the
  // answer is refused rather than shown as an allowance of zero.
  assert.equal(
    normalizeCreditStatus({ ...databaseAnswer, dailyRemaining: -3 }),
    null,
  );
  // And an unknown plan name falls back to the Free wording rather than an
  // empty label in the sentence.
  assert.equal(
    normalizeCreditStatus({ ...databaseAnswer, plan: "" })?.plan,
    "Free",
  );
});
