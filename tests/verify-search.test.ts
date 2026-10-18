import test from "node:test";
import assert from "node:assert/strict";
import {
  NEXT_STEPS,
  exitCodeFor,
  parseArgs,
  plan,
  redact,
} from "../scripts/lib/verify-search.mjs";

// The verification tool itself must be honest: it may never call a vendor that
// the server would not call, never claim a skip as a pass, and never print a key.
const KEY = "tvly-real-looking-but-not-a-credential";

test("a disabled server means no vendor call at all, only skips", () => {
  const { capability, decisions } = plan({
    env: {
      SEARCH_ENABLED: "false",
      SEARCH_PROVIDER: "tavily",
      SEARCH_API_KEY: KEY,
    },
    args: parseArgs([]),
  });
  assert.equal(capability.disabled, true);
  assert.ok(decisions.length > 0);
  assert.ok(decisions.every((d) => d.status === "skipped"));
  assert.ok(decisions.every((d) => /SEARCH_ENABLED=false/.test(d.reason)));
});

test("by default only the provider the app would really use is tested", () => {
  const { decisions } = plan({
    env: { SEARCH_PROVIDER: "exa", SEARCH_API_KEY: KEY },
    args: parseArgs([]),
  });
  assert.deepEqual(
    decisions.map((d) => [d.provider, d.status]),
    [["exa", "run"]],
  );
});

test("an unconfigured web provider is reported with the exact next step", () => {
  const { decisions } = plan({
    env: { SEARCH_PROVIDER: "tavily" },
    args: parseArgs([]),
  });
  assert.deepEqual(
    decisions.map((d) => [d.provider, d.status, d.reason]),
    [["tavily", "skipped", "SEARCH_API_KEY belum diisi."]],
  );
  // Nothing selected at all is not a pass either.
  const empty = plan({ env: {}, args: parseArgs([]) });
  assert.equal(empty.decisions[0].status, "nothing_to_do");
  assert.match(empty.decisions[0].reason, /SEARCH_PROVIDER/);
  assert.equal(
    exitCodeFor(empty.decisions, { strict: false, provider: "" }),
    0,
  );
  assert.equal(exitCodeFor(empty.decisions, { strict: true }), 1);
});

test("--all spends one real call on every web provider, and says so", () => {
  const { decisions } = plan({
    env: { SEARCH_PROVIDER: "tavily", SEARCH_API_KEY: KEY },
    args: parseArgs(["--all"]),
  });
  // Every provider left is web, and each one reads the same key: only an
  // explicit --all may fire them all, never the default path.
  assert.deepEqual(
    decisions.map((d) => `${d.provider}:${d.kind}:${d.status}`).sort(),
    ["brave:web:run", "exa:web:run", "parallel:web:run", "tavily:web:run"],
  );
  // The default path still fires exactly one vendor.
  const single = plan({
    env: { SEARCH_PROVIDER: "tavily", SEARCH_API_KEY: KEY },
    args: parseArgs([]),
  });
  assert.deepEqual(
    single.decisions.map((d) => [d.provider, d.status]),
    [["tavily", "run"]],
  );
});

test("--all without a key reports every provider as skipped, not as working", () => {
  const { decisions } = plan({ env: {}, args: parseArgs(["--all"]) });
  assert.deepEqual(
    decisions.map((d) => `${d.provider}:${d.kind}:${d.status}`).sort(),
    [
      "brave:web:skipped",
      "exa:web:skipped",
      "parallel:web:skipped",
      "tavily:web:skipped",
    ],
  );
  assert.ok(
    decisions.every((d) => /SEARCH_API_KEY belum diisi/.test(d.reason)),
  );
});

test("a provider or a kind that no longer exists is reported, never guessed", () => {
  // The keyless providers are gone from the registry.
  const removed = plan({ env: {}, args: parseArgs(["--provider=grepp"]) });
  assert.deepEqual(
    removed.decisions.map((d) => [d.provider, d.status]),
    [["grepp", "unknown_provider"]],
  );
  assert.equal(exitCodeFor(removed.decisions, { provider: "grepp" }), 1);
  // Asking for a removed kind is answered with what happened to it, and it is
  // never a pass: there is nothing left to test there.
  const byKind = plan({ env: {}, args: parseArgs(["--kind=docs"]) });
  assert.equal(byKind.decisions[0].status, "retired");
  assert.match(byKind.decisions[0].reason, /sudah dihapus/);
  assert.equal(byKind.decisions[0].kind, "docs");
  assert.equal(exitCodeFor(byKind.decisions, {}), 1);
  // A kind that is fine (web) is not treated as retired.
  assert.equal(parseArgs(["--kind=web"]).retiredKind, "");
  const unknown = plan({ env: {}, args: parseArgs(["--provider=nope"]) });
  assert.equal(unknown.decisions[0].status, "unknown_provider");
  assert.equal(exitCodeFor(unknown.decisions, { provider: "nope" }), 1);
});

test("a named provider that cannot be tested is a failure, not a pass", () => {
  const { decisions } = plan({
    env: { SEARCH_PROVIDER: "brave" },
    args: parseArgs(["--provider=brave"]),
  });
  assert.equal(decisions[0].status, "skipped");
  assert.equal(exitCodeFor(decisions, { provider: "brave" }), 1);
  assert.equal(exitCodeFor(decisions, {}), 0);
  assert.equal(exitCodeFor([{ status: "ok" }], { provider: "brave" }), 0);
  assert.equal(exitCodeFor([{ status: "failed" }], {}), 1);
});

test("keys never reach the output, even when a vendor echoes them back", () => {
  const env = { SEARCH_API_KEY: KEY, LLM_API_KEY: "llm-1234567890" };
  const line = redact(`gagal 401: {"key":"${KEY}"} dan llm-1234567890`, env);
  assert.ok(!line.includes(KEY));
  assert.ok(!line.includes("llm-1234567890"));
  assert.match(line, /\*\*\*/);
  // Short values are not secrets and stay readable for diagnosis.
  assert.equal(redact("abc", { SEARCH_API_KEY: "abc" }), "abc");
});

test("the printed next steps name the real environment variables", () => {
  const text = NEXT_STEPS.join("\n");
  assert.match(text, /SEARCH_PROVIDER=tavily/);
  assert.match(text, /SEARCH_API_KEY=/);
  assert.match(text, /keempat provider web/);
  // The removed options are not advertised as if they still worked.
  assert.doesNotMatch(text, /--kind=/);
  assert.match(text, /DILEWATI berarti belum diuji/);
});

test("argument parsing keeps the documented flags working", () => {
  const args = parseArgs([
    "--provider=Tavily",
    "--read",
    "--json",
    "--query=ganti kata kunci",
    "--strict",
  ]);
  assert.equal(args.provider, "tavily");
  assert.equal(args.read, true);
  assert.equal(args.json, true);
  assert.equal(args.strict, true);
  assert.equal(args.query, "ganti kata kunci");
  // No kind is selected any more; only a removed one is remembered, so it can
  // be answered instead of ignored.
  assert.equal(parseArgs([]).retiredKind, "");
  assert.equal(parseArgs(["--kind=code"]).retiredKind, "code");
  assert.equal(parseArgs(["--kind=web"]).retiredKind, "");
});
