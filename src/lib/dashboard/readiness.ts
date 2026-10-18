/**
 * "Kok fiturnya nggak nyala?" — the dashboard answers that itself.
 *
 * Every switch here is a capability the server already reports from its own
 * environment (`GET /api/status`), plus the one thing the server cannot know
 * for the user: whether the Studio plugin has ever talked to it. No new
 * endpoint, no guessing: a capability that is not reported is simply "belum
 * aktif", never assumed.
 */
export interface Capabilities {
  [key: string]: boolean | undefined;
}

export interface ReadyItem {
  id: string;
  label: string;
  /** What works once this is on. */
  hint: string;
  /** What is missing, named exactly. */
  missing: string;
  ready: boolean;
}

const CORE: (Omit<ReadyItem, "ready"> & { key: string })[] = [
  {
    id: "cloud",
    key: "cloud",
    label: "Sinkron cloud",
    hint: "Project tersimpan di akun Anda dan bisa dibuka dari perangkat lain.",
    missing:
      "Belum ada database: butuh VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, dan SUPABASE_SERVICE_ROLE_KEY.",
  },
  {
    id: "ai",
    key: "ai",
    label: "Percakapan AI",
    hint: "Mode Builder, Plan, dan Ask menjawab dan mengubah project.",
    missing: "Belum ada penyedia model: butuh LLM_API_KEY dan LLM_BASE_URL.",
  },
  {
    id: "search",
    key: "search",
    label: "Pencarian web",
    hint: "Jawaban bisa menyertakan sumber dari web, bukan hanya ingatan model.",
    missing: "Belum ada provider pencarian berkunci (contoh: TAVILY_API_KEY).",
  },
  {
    id: "sandbox",
    key: "sandbox",
    label: "Build di sandbox",
    hint: "Project dijalankan di sandbox terisolasi sebelum ditampilkan.",
    missing: "Belum ada sandbox: butuh E2B_API_KEY.",
  },
  {
    id: "audit",
    key: "audit",
    label: "Audit Lighthouse",
    hint: "Skor kualitas project diukur dari hasil build asli.",
    missing:
      "Butuh E2B_API_KEY dan E2B_TEMPLATE yang berisi Chromium + Lighthouse.",
  },
  {
    id: "payments",
    key: "payments",
    label: "Top up kredit",
    hint: "Kredit bisa dibeli sendiri lewat halaman Akun.",
    missing:
      "Butuh kredensial pembayaran (Midtrans atau Xendit) dan APP_BASE_URL.",
  },
];

export function readinessItems(
  capabilities: Capabilities | undefined,
  extra: ReadyItem[] = [],
): ReadyItem[] {
  const core = CORE.map(({ key, ...item }) => ({
    ...item,
    ready: Boolean(capabilities?.[key]),
  }));
  return [...core, ...extra];
}

export interface ReadinessSummary {
  ready: number;
  total: number;
  missing: ReadyItem[];
}

export function readinessSummary(items: ReadyItem[]): ReadinessSummary {
  const missing = items.filter((item) => !item.ready);
  return { ready: items.length - missing.length, total: items.length, missing };
}

/**
 * The plugin item only exists for accounts that have a Roblox project: for
 * everyone else a "plugin belum terpasang" line would be noise.
 */
export function pluginItem(
  status: { plugin?: { version?: string } } | null | undefined,
  expected: string,
): ReadyItem {
  const installed = status?.plugin?.version || "";
  const base = {
    id: "studio",
    label: "Plugin Studio",
    hint: "Roblox Studio bisa mengirim dan menerima perubahan lewat plugin.",
  };
  if (!installed)
    return {
      ...base,
      ready: false,
      missing:
        "Plugin belum pernah menghubungi server ini. Pasang dari panel Roblox di project Studio Anda.",
    };
  if (installed !== expected)
    return {
      ...base,
      ready: false,
      missing: `Plugin v${installed} terpasang, aplikasi ini memakai v${expected}. Unduh ulang plugin dari panel Roblox lalu pasang lagi.`,
    };
  return { ...base, ready: true, missing: "" };
}
