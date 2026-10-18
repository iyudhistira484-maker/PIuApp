import test from "node:test";
import assert from "node:assert/strict";
import {
  API_TIMEOUT_AUDIT,
  API_TIMEOUT_DEFAULT,
  API_TIMEOUT_LONG,
  apiTimeoutMs,
} from "../src/lib/api-budget.ts";

// The client's patience per call. What has to stay true: slow paid work gets a
// budget that matches it, and everything else still fails fast instead of
// leaving the UI waiting on a request that will never answer.

test("slow work gets a budget that matches what it does", () => {
  // Studio hands a GLB (up to 12 MB) to Roblox Open Cloud through the server.
  assert.equal(apiTimeoutMs("/projects/p-1/studio/assets"), API_TIMEOUT_LONG);
  for (const path of [
    "/projects/p-1/audit",
    "/projects/p-1/sandbox/command",
    "/projects/p-1/sandbox/preview",
    "/projects/p-1/sandbox/files",
    "/projects/p-1/packages",
  ])
    assert.ok(
      apiTimeoutMs(path) >= API_TIMEOUT_LONG,
      `${path} harus punya anggaran panjang`,
    );
  // A Lighthouse audit is the longest of all: sandbox, build, serve, then run.
  assert.equal(apiTimeoutMs("/projects/p-1/audit"), API_TIMEOUT_AUDIT);
  assert.ok(API_TIMEOUT_AUDIT > API_TIMEOUT_LONG);
});

test("everything else fails fast, and only the exact slow paths are extended", () => {
  assert.equal(apiTimeoutMs("/account"), API_TIMEOUT_DEFAULT);
  assert.equal(apiTimeoutMs("/projects"), API_TIMEOUT_DEFAULT);
  assert.equal(apiTimeoutMs("/projects/p-1/comments"), API_TIMEOUT_DEFAULT);
  assert.equal(apiTimeoutMs("/projects/p-1/studio"), API_TIMEOUT_DEFAULT);
  // A GET that only polls an upload operation is a normal call.
  assert.equal(
    apiTimeoutMs("/projects/p-1/studio/assets/operation"),
    API_TIMEOUT_DEFAULT,
  );
  // The audit rule is anchored: a path that merely mentions it stays normal.
  assert.equal(apiTimeoutMs("/projects/p-1/audits"), API_TIMEOUT_DEFAULT);
  assert.equal(
    apiTimeoutMs("/projects/p-1/sandbox/command/extra"),
    API_TIMEOUT_DEFAULT,
  );
  assert.equal(
    apiTimeoutMs("/projects/p-1/packages/extra"),
    API_TIMEOUT_DEFAULT,
  );
  // The studio rule is anchored too — an id that ends in "studio/assets" is not
  // an upload, and the query string the client appends does not change the path.
  assert.equal(apiTimeoutMs("/projects/studio-1/status"), API_TIMEOUT_DEFAULT);
  assert.equal(
    apiTimeoutMs("/projects/p-1/studio/assets?operation=operations%2Fx"),
    API_TIMEOUT_LONG,
  );
});
