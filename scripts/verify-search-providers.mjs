// Live verification of the search providers against the real APIs.
//
// Why this exists: unit tests only prove that our parser matches the contract we
// wrote down. This script proves the contract itself — one real query per
// provider, straight to the vendor, through exactly the code the app uses.
//
//   npm run verify:search                      # provider web yang benar-benar dipakai app
//   npm run verify:search -- --all             # keempat provider web, satu kueri nyata masing-masing
//   npm run verify:search -- --provider=exa    # paksa satu provider
//   npm run verify:search -- --read            # juga baca halaman hasil pertama
//   npm run verify:search -- --json            # laporan siap-mesin
//
// Honest bounds: each web call spends real vendor quota/credits, `skipped` means
// "not tested here" (never "works"), and keys are read from the environment and
// never printed. Exit code 1 means a real call failed — or, with --strict or a
// named --provider, that the provider could not be tested at all.
import {
  providers,
  searchOne,
  fetchSourceBodies,
} from "../server/lib/search.mjs";
import {
  NEXT_STEPS,
  exitCodeFor,
  parseArgs,
  plan,
  redact,
} from "./lib/verify-search.mjs";

const args = parseArgs(process.argv.slice(2));
const env = process.env;
const ctx = { env, fetcher: fetch };
const { capability, decisions } = plan({ env, args });

// Which provider the running app would actually use, before any call is made.
const status = {
  searchEnabled: !capability.disabled,
  selected: capability.selected,
  selectedAvailable: capability.selectedAvailable,
  kinds: { web: capability.web },
  roundsMax: Number(env.SEARCH_ROUNDS_MAX || 2),
  country: env.SEARCH_COUNTRY || "",
  language: env.SEARCH_LANGUAGE || "",
};

const checks = [];
for (const decision of decisions) {
  if (decision.status !== "run") {
    checks.push(decision);
    continue;
  }
  const name = decision.provider;
  const started = Date.now();
  try {
    const result = await searchOne(ctx, {
      query: args.query,
      kind: decision.kind,
      provider: name,
    });
    const check = {
      provider: name,
      label: result.label,
      kind: decision.kind,
      status: "ok",
      ms: Date.now() - started,
      results: result.sources.length,
      cached: result.cached,
      first: result.sources[0]
        ? {
            title: result.sources[0].title,
            url: result.sources[0].url,
            snippetChars: result.sources[0].snippet.length,
          }
        : null,
    };
    if (!result.sources.length)
      check.warning =
        "API menjawab tanpa hasil. Cek kuota langganan dan kata kunci.";
    if (args.read && result.sources.length) {
      const bodies = await fetchSourceBodies(ctx, result.sources, { limit: 1 });
      check.read = {
        url: bodies[0]?.url || "",
        title: bodies[0]?.title || "",
        chars: (bodies[0]?.text || "").length,
        error: bodies[0]?.error || "",
      };
    }
    checks.push(check);
  } catch (error) {
    checks.push({
      provider: name,
      label: providers[name]?.label || name,
      kind: decision.kind,
      status: "failed",
      ms: Date.now() - started,
      // Never echo a response body here: it is untrusted and may quote secrets.
      error: redact(String(error?.message || error), env).slice(0, 200),
    });
  }
}

const failed = checks.filter(
  (c) => c.status === "failed" || c.status === "unknown_provider",
);
const skipped = checks.filter(
  (c) => c.status !== "ok" && c.status !== "failed" && c.status !== "retired",
);
const report = {
  status,
  query: args.query,
  checks,
  notice:
    "Satu kueri nyata per provider yang diuji (memakai kuota/langganan vendor). Status DILEWATI berarti tidak diuji, bukan berarti berfungsi.",
};
if (args.json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(
    `Konfigurasi app: provider terpilih ${status.selected || "none"} (web=${status.kinds.web}), ronde riset maksimum ${status.roundsMax}${
      status.country || status.language
        ? `, bias ${status.country || "-"}/${status.language || "-"}`
        : ", tanpa bias lokal"
    }.`,
  );
  if (capability.disabled)
    console.log(
      "SEARCH_ENABLED=false: seluruh pencarian keluar dimatikan, jadi tidak ada panggilan vendor yang dibuat.",
    );
  for (const check of checks) {
    if (check.status === "ok")
      console.log(
        `OK       ${check.label || check.provider}: ${check.results} hasil dalam ${check.ms} ms${
          check.cached ? " (dari cache)" : ""
        }${
          check.first
            ? ` — contoh: ${check.first.title} (${check.first.snippetChars} char cuplikan)`
            : ""
        }`,
      );
    else if (check.status === "failed")
      console.log(`GAGAL    ${check.provider}: ${check.error}`);
    else if (check.status === "retired")
      console.log(`DIPENSIUN jalur ${check.kind}: ${check.reason}`);
    else
      console.log(
        `DILEWATI ${check.provider}: ${check.reason || check.status}`,
      );
    if (check.warning) console.log(`         peringatan: ${check.warning}`);
    if (check.read)
      console.log(
        `         baca halaman: ${check.read.chars} char dari ${check.read.url || "-"}${
          check.read.error ? " (" + check.read.error + ")" : ""
        }`,
      );
  }
  console.log(report.notice);
  if (skipped.length || !checks.length)
    for (const line of NEXT_STEPS) console.log(line);
}
process.exitCode = exitCodeFor(checks, {
  strict: args.strict,
  provider: args.provider,
});
