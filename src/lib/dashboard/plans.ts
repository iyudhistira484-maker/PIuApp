import {
  CREDIT_COSTS,
  CREDIT_EXPIRY_MONTHS,
  DAILY_RESET_UTC_HOUR,
  FREE_PLAN,
  PLAN_LADDER,
  PLAN_PERIOD_DAYS,
  TOPUP_LADDER,
  USAGE_PROFILES,
  costLine,
  dailyAllowance,
  durationDays,
  expiryLabel,
  lastsLabel,
  ratePerCredit,
  usageProfile,
  type PlanRow,
} from "../../../shared/credits.mjs";

/**
 * The upgrade page's data, as pure functions so the wording and the arithmetic
 * can be tested without a browser.
 *
 * Where the numbers come from: `GET /api/account`, which returns the products
 * the server really sells (`server/providers/payments.mjs`) — price, credits and
 * label. How long those credits last comes from `shared/credits.mjs`, the same
 * price list the server bills with, so the page cannot promise a duration the
 * billing does not match. Nothing here invents features per plan: this app does
 * not gate features by plan yet, and the page says so instead of implying it.
 */
export interface ProductLike {
  kind?: string;
  plan?: string;
  amount?: number;
  credits?: number;
  label?: string;
}

export interface DurationRow {
  id: string;
  label: string;
  detail: string;
  /** Credits this profile spends per day, from the operations it lists. */
  perDay: number;
  days: number;
  text: string;
}

export interface Offer {
  sku: string;
  label: string;
  price: number;
  credits: number;
  /** "plan" or "topup", straight from the server product. */
  kind: string;
  /** Plan name for a subscription product, empty for a top-up. */
  plan: string;
  /** What the price buys per day over the 30-day period (arithmetic, not a promise). */
  perDayCredits: number;
  /** Daily allowance that refills every day at 00:00 UTC; 0 when there is none. */
  daily: number;
  /** Monthly ceiling on a Free allowance; null when the plan has no ceiling. */
  monthlyCap: number | null;
  /** Months until a granted lot expires; 0 means "at the end of that day". */
  expiryMonths: number;
  /** Effective price of one credit at this package size. */
  rate: number;
  /** How long these credits last at each usage profile, from the real costs. */
  durations: DurationRow[];
  /** True when this is the plan the account is on right now. */
  current: boolean;
}

/**
 * How long a paid plan's period runs. This is a duration of the *plan*, not of
 * the credits: plan credits roll over between months but expire 2 months after
 * they are granted, and top-ups last 12 months (supabase/010_credit_lots.sql).
 * The server applies the same 30 days in supabase/003_services.sql.
 */
export const PLAN_DAYS = PLAN_PERIOD_DAYS;

/** Rupiah per credit, and how long a balance lasts, at every usage profile. */
export function priceFacts(price: number, credits: number) {
  return {
    rate: ratePerCredit(price, credits),
    durations: creditDurations(credits),
  };
}

/** The usage profiles as table rows: what a day looks like, and what it costs. */
export function usageRows() {
  return USAGE_PROFILES.map((profile) => ({
    id: profile.id,
    label: profile.label,
    detail: profile.detail,
    perDay: Math.round(creditsPerDayOf(profile.id) * 10) / 10,
  }));
}

/** Durations for a credit balance, one row per usage profile. */
export function creditDurations(credits: number): DurationRow[] {
  return USAGE_PROFILES.map((profile) => ({
    id: profile.id,
    label: profile.label,
    detail: profile.detail,
    perDay: Math.round(creditsPerDayOf(profile.id) * 10) / 10,
    days: durationDays(credits, profile),
    text: lastsLabel(credits, profile),
  }));
}

/** Credits one day of a named usage profile costs. */
export function creditsPerDayOf(profileId: string) {
  const profile = usageProfile(profileId);
  const per = (value?: number) => (value ? Number(value) : 0);
  return (
    per(profile.chatSeimbang) * CREDIT_COSTS.chat.Seimbang +
    per(profile.chatKuat) * CREDIT_COSTS.chat.Kuat +
    per(profile.ask) * CREDIT_COSTS.ask +
    per(profile.researchRounds) * CREDIT_COSTS.researchRound +
    (per(profile.sandboxJobsPerWeek) * CREDIT_COSTS.sandboxJob) / 7 +
    (per(profile.auditsPerMonth) * CREDIT_COSTS.audit) / PLAN_PERIOD_DAYS
  );
}

/** Re-exported from the shared model so pages import one module, not two. */
export {
  costLine,
  lastsLabel,
  usageProfile,
} from "../../../shared/credits.mjs";

/** Plain counts written the Indonesian way (2.500, not 2500). */
export function count(value: number) {
  return new Intl.NumberFormat("id-ID").format(
    Number.isFinite(Number(value)) ? Number(value) : 0,
  );
}

export function rupiah(amount: number) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(Number.isFinite(amount) ? amount : 0);
}

export interface PlanBenefits {
  plan: string;
  /** One line under the plan name on the pricing card. */
  summary: string;
  /** What the plan includes, as sentences a buyer can check. */
  items: string[];
}

/**
 * What each plan includes, built from the same ladder the checkout charges.
 *
 * Everything in the builder — templates, editor, preview, ZIP export, cloud
 * projects, collaboration and AI when a provider is configured — is available
 * on every plan. The plans differ in price and in how many credits they grant,
 * so these lists say exactly that instead of advertising a gated feature that
 * the app does not enforce (`planFacts()` says the same in prose). A test
 * asserts the credit numbers here match PLAN_LADDER.
 */
export function planBenefits(plans: PlanRow[] = PLAN_LADDER): PlanBenefits[] {
  const free = plans.find((plan) => !plan.monthly) || PLAN_LADDER[0];
  const pro =
    plans.find((plan) => plan.plan === "Pro") ||
    PLAN_LADDER.find((plan) => plan.plan === "Pro")!;
  const team =
    plans.find((plan) => plan.plan === "Team") ||
    PLAN_LADDER.find((plan) => plan.plan === "Team")!;
  const rate = (plan: PlanRow) =>
    `${rupiah(ratePerCredit(plan.monthly, plan.credits))}/kredit`;
  return [
    {
      plan: free.plan,
      summary: "Untuk ide pertama, tanpa tagihan.",
      items: [
        "Tanpa biaya bulanan dan tanpa kartu kredit",
        "Template web, Roblox, dan aplikasi mobile",
        "Editor kode, preview, dan Export ZIP",
        "Project lokal maupun cloud tanpa batas",
        "Kolaborasi anggota project dengan peran",
        "AI Plan, Ask, dan Builder saat provider aktif",
      ],
    },
    {
      plan: pro.plan,
      summary: "Untuk pemakaian harian yang lebih panjang.",
      items: [
        "Semua yang ada di Free",
        `${count(pro.credits)} kredit/bulan · ${rate(pro)}`,
        `Bonus ${count(pro.daily)} kredit/hari, direset 00:00 UTC`,
        `Kredit paket bergulir; ${expiryLabel(pro.expiryMonths)}`,
      ],
    },
    {
      plan: team.plan,
      summary: "Untuk pemakaian berat satu akun atau tim kecil.",
      items: [
        "Semua yang ada di Pro",
        `${count(team.credits)} kredit/bulan · ${rate(team)}`,
        `Bonus ${count(team.daily)} kredit/hari, direset 00:00 UTC`,
        `Kredit paket bergulir; ${expiryLabel(team.expiryMonths)}`,
      ],
    },
  ];
}

function toOffer(
  sku: string,
  product: ProductLike,
  currentPlan: string,
  kind: string,
): Offer | null {
  const price = Number(product?.amount);
  const credits = Number(product?.credits);
  if (!Number.isFinite(price) || !Number.isFinite(credits)) return null;
  // The allowance and the deadline come from the same ladder the server sells
  // from, so a card cannot print a validity the store does not honour.
  const ladderPlan = PLAN_LADDER.find((row) => row.sku === sku);
  const ladderTopup = TOPUP_LADDER.find((row) => row.sku === sku);
  return {
    sku,
    label: product.label || sku,
    price,
    credits,
    kind,
    plan: product.plan || "",
    perDayCredits: Math.round(credits / PLAN_DAYS),
    daily: ladderPlan?.daily ?? 0,
    monthlyCap: ladderPlan?.monthlyCap ?? null,
    expiryMonths:
      ladderPlan?.expiryMonths ??
      ladderTopup?.expiryMonths ??
      CREDIT_EXPIRY_MONTHS.topup,
    ...priceFacts(price, credits),
    current:
      kind === "plan" &&
      Boolean(currentPlan) &&
      (product.plan || "").toLowerCase() === currentPlan.toLowerCase(),
  };
}

/** Products the server sells, with their kind kept beside the parsed offer. */
function pricedProducts(
  products: Record<string, ProductLike> | undefined,
  currentPlan: string,
) {
  return Object.entries(products || {}).flatMap(([sku, product]) => {
    const kind = product?.kind || "topup";
    const offer = toOffer(sku, product, currentPlan, kind);
    return offer ? [{ kind, offer }] : [];
  });
}

export const planOffers = (
  products: Record<string, ProductLike> | undefined,
  currentPlan = "Free",
) =>
  pricedProducts(products, currentPlan)
    .filter((entry) => entry.kind === "plan")
    .map((entry) => entry.offer);

export const topupOffers = (
  products: Record<string, ProductLike> | undefined,
) =>
  pricedProducts(products, "")
    .filter((entry) => entry.kind === "topup")
    .map((entry) => entry.offer);

/**
 * What the page may promise about paying. When payments are off, this is the
 * sentence shown instead of a checkout button that cannot work.
 */
export function paymentsNotice(
  paymentsEnabled: boolean | undefined,
  provider: string | null | undefined,
) {
  if (paymentsEnabled)
    return {
      ready: true,
      text: `Checkout dibuka oleh provider${provider ? ` (${provider})` : ""}. Metode pembayaran yang tersedia dipilih di halaman provider. Prabayar 30 hari — tanpa penagihan otomatis.`,
    };
  return {
    ready: false,
    text: "Pembayaran belum dikonfigurasi di server ini, jadi tombol checkout dinonaktifkan dan tidak ada tagihan yang dibuat. Kredit yang ada tetap bisa dipakai.",
  };
}

/**
 * What is true about plans today. Kept as data so the page cannot drift into
 * advertising a gated feature that does not exist.
 */
export function planFacts() {
  const free = PLAN_LADDER.find((plan) => !plan.monthly)!;
  const pro = PLAN_LADDER.find((plan) => plan.plan === "Pro")!;
  const team = PLAN_LADDER.find((plan) => plan.plan === "Team")!;
  return [
    {
      title: "Jatah harian kembali penuh setiap hari",
      detail: `Free ${count(free.daily)} kredit/hari, Pro ${count(pro.daily)} kredit/hari, Team ${count(team.daily)} kredit/hari, direset pada pukul 00:00 UTC. Jatah yang tidak terpakai hangus — tidak menumpuk ke hari berikutnya. Akun Free dibatasi plafon ${count(FREE_PLAN.monthlyCap)} kredit per bulan.`,
    },
    {
      title: "Setiap kredit punya masa berlaku yang tercatat",
      detail: `Kredit paket boleh menumpuk antar bulan, tetapi ${expiryLabel(CREDIT_EXPIRY_MONTHS.plan)}. Kredit top-up berlaku ${CREDIT_EXPIRY_MONTHS.topup} bulan sejak pembelian, dan bonus referral mengikuti masa berlaku yang sama. Tiap lot menyimpan tanggal hangusnya sendiri di database, jadi tidak ada tanggal yang hilang diam-diam.`,
    },
    {
      title: "Harga menentukan jumlah kredit",
      detail: `${rateSentence()} Semakin besar paket, semakin murah harga per kreditnya. Free tetap tanpa tagihan: ${count(FREE_PLAN.credits)} kredit/hari dengan plafon ${count(FREE_PLAN.monthlyCap)} per bulan. Saat ini Pro dan Team hanya berbeda pada harga dan jumlah kreditnya. Panel admin punya matriks akses per paket untuk sandbox, Studio bridge, dan penjualan template, tetapi bawaannya "Semua paket" — jadi tidak ada fitur yang dikunci diam-diam.`,
    },
    {
      title: "Perkiraan berapa lama jatah bertahan",
      detail: `Durasi di halaman ini aritmetika dari daftar harga di bawah, bukan janji: ${profileSentence()}`,
    },
    {
      title: "Kredit dipakai per operasi",
      detail: `Tidak ada biaya langganan per operasi di luar saldo. ${costLine()}. Rinciannya tercatat di ledger dan bisa dilihat di halaman Akun & kredit.`,
    },
    {
      title: "Referral bonus untuk kedua pihak",
      detail:
        "50 kredit untuk masing-masing akun setelah pembelian paket/top-up minimal Rp49.000 terverifikasi. Bonus dibatalkan bila penyedia membatalkan atau menarik pembayaran.",
    },
  ];
}

/**
 * One sentence with every deadline in the model, for the page header. Built
 * from the same numbers the database enforces, so it cannot drift.
 */
export function expiryLine(credits?: ServerCredits | null) {
  const free = PLAN_LADDER.find((plan) => !plan.monthly);
  const pro = PLAN_LADDER.find((plan) => plan.plan === "Pro");
  const team = PLAN_LADDER[PLAN_LADDER.length - 1];
  // The header prefers what the database answered about this account, so the
  // sentence describes the deployment the reader is actually on.
  const fromServer = credits?.applied === true ? credits : null;
  const daily = fromServer ? wholeNumber(fromServer.daily) : null;
  const hour = fromServer
    ? (wholeNumber(fromServer.resetUtcHour) ?? DAILY_RESET_UTC_HOUR)
    : DAILY_RESET_UTC_HOUR;
  const planMonths = fromServer
    ? (wholeNumber(fromServer.planMonths) ?? CREDIT_EXPIRY_MONTHS.plan)
    : CREDIT_EXPIRY_MONTHS.plan;
  const topupMonths = fromServer
    ? (wholeNumber(fromServer.topupMonths) ?? CREDIT_EXPIRY_MONTHS.topup)
    : CREDIT_EXPIRY_MONTHS.topup;
  const reset = `direset setiap hari pukul ${String(hour).padStart(2, "0")}:00 UTC dan tidak menumpuk`;
  if (fromServer && daily)
    return `Jatah harian paket ${fromServer.plan || "ini"} ${count(daily)} kredit, ${reset}; kredit paket ${expiryLabel(planMonths)}, kredit top-up berlaku ${topupMonths} bulan sejak pembelian.`;
  return `Jatah harian ${count(free?.daily || 0)} kredit (Pro ${count(pro?.daily || 0)}, Team ${count(team.daily)}) ${reset}; kredit paket ${expiryLabel(planMonths)}, kredit top-up berlaku ${topupMonths} bulan sejak pembelian.`;
}

/**
 * What the server answers about today's allowance (`credits` in
 * `GET /api/account`). `applied: false` means the database could not describe
 * it — a missing migration or an unreadable answer — and then the note is what
 * the page says instead of a number nobody verified.
 */
export interface ServerCredits {
  applied: boolean;
  source: string;
  note?: string;
  plan?: string;
  daily?: number;
  dailyClaimed?: number;
  dailyRemaining?: number;
  monthlyCap?: number | null;
  monthlyUsed?: number;
  resetUtcHour?: number;
  resetAt?: string;
  planMonths?: number | null;
  topupMonths?: number | null;
}

const wholeNumber = (value: unknown) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) : null;
};

/**
 * When the daily allowance next refills (00:00 UTC by default), as a timestamp.
 * When the server sent the instant of the next reset, that is the one used: it
 * is the daily lot's own expiry, so the countdown cannot point at a time the
 * database does not use. Otherwise the hour comes from the same constant
 * migration 010 uses.
 */
export function nextResetAt(now = Date.now()) {
  const date = new Date(now);
  const today = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    DAILY_RESET_UTC_HOUR,
  );
  return today > now ? today : today + 86400000;
}

/** Whole hours to that reset, never negative. */
export function hoursToReset(now = Date.now(), resetAt?: string | null) {
  const target = resetAt ? Date.parse(resetAt) : Number.NaN;
  if (Number.isFinite(target))
    return Math.max(0, Math.ceil((target - now) / 3600000));
  return Math.max(0, Math.ceil((nextResetAt(now) - now) / 3600000));
}

/**
 * "20 kredit/hari · direset 00:00 UTC (dalam 9 jam) · sisa hari ini 12", from
 * what the server answered. Empty until the server confirms the allowance is
 * actually enforced (`applied`), so a page never prints a daily quota that the
 * database it is talking to does not grant.
 */
export function serverDailyLine(
  credits: ServerCredits | null | undefined,
  now = Date.now(),
) {
  if (!credits || credits.applied !== true) return "";
  const daily = wholeNumber(credits.daily);
  if (daily === null || daily <= 0) return "";
  const hour = wholeNumber(credits.resetUtcHour) ?? DAILY_RESET_UTC_HOUR;
  const hours = hoursToReset(now, credits.resetAt);
  let line = `${count(daily)} kredit/hari · direset ${String(hour).padStart(2, "0")}:00 UTC (dalam ${hours} jam)`;
  const left = wholeNumber(credits.dailyRemaining);
  if (left !== null)
    line += ` · sisa hari ini ${count(Math.max(0, Math.min(left, daily)))}`;
  return line;
}

/**
 * "Plafon 600 kredit/bulan · terpakai 120" for the plan that has a ceiling.
 * Empty for a paid plan (which reports null) and before the server confirmed.
 */
export function capLine(credits: ServerCredits | null | undefined) {
  if (!credits || credits.applied !== true) return "";
  const cap = wholeNumber(credits.monthlyCap);
  if (cap === null || cap <= 0) return "";
  const used = Math.max(0, wholeNumber(credits.monthlyUsed) ?? 0);
  return `Plafon ${count(cap)} kredit/bulan · terpakai ${count(Math.min(used, cap))}`;
}

/** What to say when the server could not describe the allowance; "" when it did. */
export function creditsNote(credits: ServerCredits | null | undefined) {
  if (!credits || credits.applied === true) return "";
  return typeof credits.note === "string" && credits.note ? credits.note : "";
}

/**
 * "20 kredit/hari · direset 00:00 UTC (dalam 9 jam)" for one plan name. Empty
 * for a name the ladder does not know, so a card never prints a number the
 * account would not receive.
 */
export function dailyLine(planName: string, now = Date.now()) {
  const daily = dailyAllowance(planName);
  if (!daily) return "";
  return `${count(daily)} kredit/hari · direset 00:00 UTC (dalam ${hoursToReset(now)} jam)`;
}

/** The deadline sentence for one card, from the ladder row it came from. */
export function offerExpiry(offer: Pick<Offer, "kind" | "expiryMonths">) {
  if (offer.kind === "plan")
    return offer.expiryMonths
      ? `Kredit bulanan boleh menumpuk antar bulan, tetapi ${expiryLabel(offer.expiryMonths)}; jatah harian tidak menumpuk.`
      : "Jatah harian direset setiap hari dan tidak menumpuk.";
  return offer.expiryMonths
    ? `Berlaku ${offer.expiryMonths} bulan sejak pembelian.`
    : "Tidak kedaluwarsa.";
}

/** "Pro Rp 133/kredit · Team Rp 111/kredit" — computed, never typed twice. */
function rateSentence() {
  return PLAN_LADDER.filter((plan) => plan.monthly > 0)
    .map(
      (plan) =>
        `${plan.plan} ${rupiah(ratePerCredit(plan.monthly, plan.credits))}/kredit`,
    )
    .join(" · ");
}

/** One clause per usage profile, built from the profile definitions. */
function profileSentence() {
  return USAGE_PROFILES.map(
    (profile) =>
      `${profile.label} ${profile.detail} (±${Math.round(creditsPerDayOf(profile.id) * 10) / 10} kredit/hari)`,
  ).join("; ");
}

/**
 * "Sisa 18 hari" from the active period. An expired end date is reported as
 * ended today only when it really is today; older dates return nothing rather
 * than a line that implies the plan is still running.
 */
export function periodLeft(currentPeriodEnd?: string | null, now = Date.now()) {
  if (!currentPeriodEnd) return "";
  const end = Date.parse(currentPeriodEnd);
  if (Number.isNaN(end)) return "";
  const days = Math.ceil((end - now) / 86400000);
  if (days > 0) return `Sisa ${days} hari`;
  if (days === 0) return "Masa aktif berakhir hari ini";
  return "";
}
