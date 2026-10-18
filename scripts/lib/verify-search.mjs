// Decisions behind `npm run verify:search`, kept free of network calls so they
// can be tested: which real vendor calls will be made, which ones are honestly
// skipped, and never a key in the output.
import { providers, searchCapability } from "../../server/lib/search.mjs";

export const DEFAULT_QUERY = "cara pakai vite di React 19";

export function parseArgs(argv = []) {
  const flag = (name, fallback = "") => {
    const hit = argv.find(
      (a) => a === "--" + name || a.startsWith("--" + name + "="),
    );
    if (!hit) return fallback;
    const value = hit.split("=")[1];
    return value === undefined ? "true" : value;
  };
  const kind = flag("kind").toLowerCase();
  return {
    json: argv.includes("--json"),
    read: argv.includes("--read"),
    strict: argv.includes("--strict"),
    all: argv.includes("--all"),
    provider: flag("provider").toLowerCase(),
    // `--kind` no longer selects anything: web is the only kind left. Passing a
    // removed kind is answered with a plain explanation instead of silence.
    retiredKind: kind && kind !== "web" ? kind : "",
    query: flag("query", DEFAULT_QUERY),
  };
}

/**
 * One decision per candidate provider. `run` means a real call will be made;
 * everything else is a skip with the reason a user can act on. Nothing here
 * touches the network, so the plan is exactly what the CLI then executes.
 */
export function plan({
  env = {},
  args = parseArgs([]),
  names = Object.keys(providers),
} = {}) {
  const capability = searchCapability(env);
  const decisions = [];
  const add = (name, status, reason = "", kind = "") =>
    decisions.push({
      provider: name,
      label: providers[name]?.label || name,
      kind: kind || providers[name]?.kind || "web",
      status,
      reason,
    });

  if (args.retiredKind) {
    // The keyless code/docs paths are gone, so asking for one is answered, not
    // ignored: whoever runs this needs to know the option no longer exists.
    add(
      "none",
      "retired",
      `Pencarian ${args.retiredKind} sudah dihapus bersama jalur tanpa kunci. Hanya pencarian web yang tersedia (SEARCH_PROVIDER + SEARCH_API_KEY).`,
      args.retiredKind,
    );
    return { capability, decisions };
  }

  if (capability.disabled) {
    for (const name of names)
      add(
        name,
        "skipped",
        "SEARCH_ENABLED=false: pencarian keluar dimatikan di server ini, jadi tidak ada panggilan vendor yang dibuat.",
      );
    return { capability, decisions };
  }

  // Which (provider, kind) pairs this run is about. Every provider left is web,
  // and each one decides its own kind.
  const pairs = [];
  if (args.provider) {
    pairs.push([args.provider, providers[args.provider]?.kind || "web"]);
  } else if (args.all) {
    // Explicit opt-in to spend quota on every web vendor: the four of them read
    // the same SEARCH_API_KEY, so a key alone can never tell which one works.
    for (const name of names)
      pairs.push([name, providers[name]?.kind || "web"]);
  } else if (capability.selected !== "none") {
    pairs.push([capability.selected, "web"]);
  }

  if (!pairs.length) {
    add(
      "none",
      "nothing_to_do",
      "SEARCH_PROVIDER belum diarahkan ke provider web, atau SEARCH_API_KEY belum diisi. Pakai --all untuk menguji keempat provider web, atau --provider=nama untuk satu provider.",
    );
    return { capability, decisions };
  }

  for (const [name, kind] of pairs) {
    const provider = providers[name];
    if (!provider) {
      add(name, "unknown_provider", "Nama provider tidak dikenal.", kind);
      continue;
    }
    if (provider.kind !== kind) {
      add(
        name,
        "skipped",
        `${provider.label} melayani pencarian ${provider.kind}, bukan ${kind}.`,
        kind,
      );
      continue;
    }
    // All four web providers read the same SEARCH_API_KEY, so a key alone can
    // never stand for "this vendor works": the name has to be chosen explicitly.
    if (provider.env && !env[provider.env]) {
      add(name, "skipped", `${provider.env} belum diisi.`, kind);
      continue;
    }
    add(name, "run", "", kind);
  }
  return { capability, decisions };
}

/** Every secret-looking environment value is replaced before anything prints. */
export function redact(text, env = {}) {
  let out = String(text ?? "");
  const secrets = [
    env.SEARCH_API_KEY,
    env.LLM_API_KEY,
    env.SUPABASE_SERVICE_ROLE_KEY,
  ].filter((value) => typeof value === "string" && value.length >= 6);
  for (const secret of secrets) out = out.split(secret).join("***");
  return out;
}

export function exitCodeFor(decisions, { strict = false, provider = "" } = {}) {
  if (
    decisions.some(
      (d) =>
        d.status === "failed" ||
        d.status === "unknown_provider" ||
        d.status === "retired",
    )
  )
    return 1;
  // Naming a provider (or asking for strict mode) means a skip is a gap, not a
  // pass: that is the difference between "not tested" and "works".
  if (strict || provider)
    if (decisions.some((d) => d.status !== "ok")) return 1;
  return 0;
}

export const NEXT_STEPS = [
  "Langkah berikutnya bila ada yang DILEWATI:",
  "  SEARCH_PROVIDER=tavily        # tavily | exa | brave | parallel",
  "  SEARCH_API_KEY=...            # kunci API vendor pencarian web",
  "  npm run verify:search                     # provider yang dipakai app",
  "  npm run verify:search -- --all            # keempat provider web, satu kueri nyata masing-masing",
  "Panduan: docs/SERVICES_SETUP.md · Batas: status DILEWATI berarti belum diuji, bukan berarti berfungsi.",
];
