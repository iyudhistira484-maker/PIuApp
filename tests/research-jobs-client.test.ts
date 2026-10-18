import test from "node:test";
import assert from "node:assert/strict";
import {
  PENDING_GRACE_MS,
  forgetPendingJob,
  lostJobs,
  readClaimedJobs,
  readPendingJobs,
  rememberClaimedJob,
  rememberPendingJob,
} from "../src/lib/research-jobs";

// The browser is the only place that knows which background runs this account
// started, so this bookkeeping decides whether the user is told the truth about
// a run that died with the server. It is asserted here instead of only in a
// browser test, because the grace window and the caps are easy to get wrong.

test.beforeEach(() => localStorage.clear());

test("an answer already applied is remembered once, per account", () => {
  assert.deepEqual(readClaimedJobs("akun-a"), []);
  rememberClaimedJob("akun-a", "req-1");
  rememberClaimedJob("akun-a", "req-1");
  rememberClaimedJob("akun-a", "req-2");
  assert.deepEqual(readClaimedJobs("akun-a"), ["req-1", "req-2"]);
  // Another account never sees it.
  assert.deepEqual(readClaimedJobs("akun-b"), []);
  // The list stays bounded: a long-lived browser does not grow forever.
  for (let i = 0; i < 60; i += 1) rememberClaimedJob("akun-a", `req-${i}`);
  assert.equal(readClaimedJobs("akun-a").length, 40);
  assert.equal(readClaimedJobs("akun-a").at(-1), "req-59");
});

test("a started research turn is pending until it is collected", () => {
  const before = Date.now();
  rememberPendingJob("akun-a", "req-1");
  const pending = readPendingJobs("akun-a");
  assert.equal(pending.length, 1);
  assert.equal(pending[0].requestId, "req-1");
  assert.ok(pending[0].at >= before && pending[0].at <= Date.now());
  // Re-sending the same id replaces it instead of duplicating it.
  rememberPendingJob("akun-a", "req-1");
  assert.equal(readPendingJobs("akun-a").length, 1);
  // Collected: gone. Other ids stay.
  rememberPendingJob("akun-a", "req-2");
  forgetPendingJob("akun-a", "req-1");
  assert.deepEqual(
    readPendingJobs("akun-a").map((x) => x.requestId),
    ["req-2"],
  );
  assert.deepEqual(readPendingJobs("akun-b"), []);
});

test("a pending list that is too long or unreadable is handled, never trusted", () => {
  for (let i = 0; i < 30; i += 1) rememberPendingJob("akun-a", `req-${i}`);
  assert.equal(readPendingJobs("akun-a").length, 20);
  // Garbage in storage is ignored instead of crashing the workspace.
  localStorage.setItem("piwu-ai-research-pending-v1:akun-a", "{not json");
  assert.deepEqual(readPendingJobs("akun-a"), []);
  localStorage.setItem("piwu-ai-research-pending-v1:akun-a", '{"a":1}');
  assert.deepEqual(readPendingJobs("akun-a"), []);
  localStorage.setItem(
    "piwu-ai-research-pending-v1:akun-a",
    JSON.stringify([
      { requestId: 7, at: "x" },
      { requestId: "ok", at: 1 },
    ]),
  );
  assert.deepEqual(readPendingJobs("akun-a"), [{ requestId: "ok", at: 1 }]);
  localStorage.setItem("piwu-ai-research-jobs-v1:akun-a", '[1,null,"req-9"]');
  assert.deepEqual(readClaimedJobs("akun-a"), ["req-9"]);
});

test("only a run the server no longer lists is called lost", () => {
  const now = 1_700_000_000_000;
  const pending = [
    { requestId: "hidup", at: now - PENDING_GRACE_MS * 2 },
    { requestId: "baru", at: now - 1000 },
    { requestId: "hilang", at: now - PENDING_GRACE_MS * 2 },
  ];
  assert.deepEqual(lostJobs(pending, ["hidup"], now), ["hilang"]);
  // Nothing is called lost while the run is still listed, or right after it was
  // sent (the server has not registered it yet, or the list call was early).
  assert.deepEqual(lostJobs(pending, ["hidup", "hilang"], now), []);
  assert.deepEqual(
    lostJobs([{ requestId: "baru", at: now - 1000 }], [], now),
    [],
  );
  // Right at the boundary it is lost: the grace window is inclusive.
  assert.deepEqual(
    lostJobs([{ requestId: "batas", at: now - PENDING_GRACE_MS }], [], now),
    ["batas"],
  );
  assert.deepEqual(lostJobs([], [], now), []);
});
