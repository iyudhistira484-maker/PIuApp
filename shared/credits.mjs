/**
 * The credit model, in one place: what an operation costs, what "normal usage"
 * means, and how long a number of credits lasts.
 *
 * Why it lives in shared/: the server bills with these numbers and the pages
 * explain prices with the same numbers, so a plan page can never promise a
 * duration that the billing does not match. Both sides import it, like
 * shared/studio.mjs.
 *
 * Credits live as lots in the database (supabase/010_credit_lots.sql) and each
 * lot carries its own deadline:
 *   - the daily allowance refills to its limit every day at 00:00 UTC and never
 *     accumulates (Free 20/day, Pro 30/day, Team 40/day; Free is capped at 600 per
 *     month);
 *   - plan credits roll over between months but expire 2 months after they are
 *     granted;
 *   - top-up (and referral) credits are valid for 12 months.
 * The numbers below mirror `public.piwu_credit_policy()` in migration 010, and
 * tests/credits-model.test.ts fails if the two drift apart.
 */

/** Credits charged per operation. Every reservation in the server uses these. */
export const CREDIT_COSTS = {
  /** Read-only question: one model pass, no tools. */
  ask: 1,
  /** Structured plan, approved before any build runs. */
  plan: 2,
  /** One chat turn, billed by the tier that answered it. */
  chat: { Cepat: 1, Seimbang: 3, Kuat: 8 },
  /** One search round inside a research turn. */
  researchRound: 1,
  /** A turn may ask for this many rounds; operators can lower it, never raise it. */
  researchRoundsPerRequest: 2,
  /** One shell/npm command in the sandbox. */
  sandboxCommand: 1,
  /** One build/preview/files/packages job in the sandbox. */
  sandboxJob: 2,
  /** One Lighthouse audit run. */
  audit: 3,
};

/**
 * Prepaid plan period. Must stay equal to the `interval '30 days'` in
 * supabase/003_services.sql (piwu_apply_payment); tests/credits-model.test.ts
 * fails if the two drift apart.
 */
export const PLAN_PERIOD_DAYS = 30;

/** The hour (UTC) the daily allowance refills. Mirrors migration 010. */
export const DAILY_RESET_UTC_HOUR = 0;

/**
 * How long a credit lot of each source stays valid, in months. `0` means "gone
 * at the end of the day it was granted" (the daily allowance); `null` means the
 * database never expires it (hand-made admin corrections).
 */
export const CREDIT_EXPIRY_MONTHS = {
  daily: 0,
  plan: 2,
  topup: 12,
  bonus: 12,
  refund: 12,
  admin: null,
};

/**
 * The daily allowance Free gets, and the monthly cap it may not pass. Must stay
 * equal to `piwu_credit_policy()` in supabase/010_credit_lots.sql; guarded by
 * tests/credits-model.test.ts.
 */
export const FREE_PLAN = {
  plan: "Free",
  credits: 20,
  daily: true,
  monthlyCap: 600,
  reason: "Jatah harian",
};

/**
 * Public plan ladder: what each plan costs and how many credits it grants.
 * The server's billing catalogue (server/providers/payments.mjs) is the source
 * of truth for real purchases; tests/credits-model.test.ts fails if the two
 * disagree, and if a bigger package ever becomes pricier per credit. Only
 * 30-day plans exist: there is deliberately no annual figure, because the
 * landing page must not show a price the store cannot charge.
 */
export const PLAN_LADDER = [
  {
    plan: "Free",
    sku: null,
    monthly: 0,
    credits: FREE_PLAN.credits,
    daily: FREE_PLAN.credits,
    monthlyCap: FREE_PLAN.monthlyCap,
    expiryMonths: CREDIT_EXPIRY_MONTHS.daily,
  },
  {
    plan: "Pro",
    sku: "pro",
    monthly: 199000,
    credits: 1500,
    // A bit above Free, a bit below Team: the daily allowance grows with the
    // plan, while the monthly grant (1.500) stays what the plan sells.
    daily: 30,
    monthlyCap: null,
    expiryMonths: CREDIT_EXPIRY_MONTHS.plan,
  },
  {
    plan: "Team",
    sku: "team",
    monthly: 499000,
    credits: 4500,
    daily: 40,
    monthlyCap: null,
    expiryMonths: CREDIT_EXPIRY_MONTHS.plan,
  },
];

/**
 * The plan ladder with the administrator's price/credit overrides applied.
 * Only money and credits move: the daily allowance, monthly cap and expiry come
 * from the database policy and are deliberately not editable.
 */
export function mergePlans(overrides = {}) {
  return PLAN_LADDER.map((plan) => {
    const override = overrides?.[plan.plan.toLowerCase()];
    const amount = Number(override?.amount ?? plan.monthly);
    const credits = Number(override?.credits ?? plan.credits);
    return {
      ...plan,
      monthly: Number.isFinite(amount) ? amount : plan.monthly,
      credits: Number.isFinite(credits) ? credits : plan.credits,
      overridden: Boolean(override),
    };
  });
}

/** Top-ups have no plan and no period: they only add credits to the balance. */
export const TOPUP_LADDER = [
  {
    sku: "credits300",
    amount: 49000,
    credits: 300,
    expiryMonths: CREDIT_EXPIRY_MONTHS.topup,
  },
  {
    sku: "credits1400",
    amount: 199000,
    credits: 1400,
    expiryMonths: CREDIT_EXPIRY_MONTHS.topup,
  },
];

/** The plan ladder row a product SKU sells, or undefined for an unknown SKU. */
export function planForSku(sku) {
  return PLAN_LADDER.find((plan) => plan.sku === sku);
}

/** Daily allowance a plan name gets; 0 for a name the ladder does not know. */
export function dailyAllowance(planName) {
  const plan = PLAN_LADDER.find((row) => row.plan === planName);
  return plan ? plan.daily : 0;
}

/**
 * One plain sentence for a deadline, from the same number the database uses:
 * "hangus 2 bulan setelah terbit", "hangus pada akhir hari", or
 * "tidak kedaluwarsa" for a lot the database never expires.
 */
export function expiryLabel(months) {
  if (months === null || months === undefined) return "tidak kedaluwarsa";
  if (!months) return "hangus pada akhir hari";
  return `hangus ${months} bulan setelah terbit`;
}

/**
 * What an active account does in a day, written as operations rather than as a
 * credit number, so the number follows the price list instead of guessing.
 * Weekly/monthly operations are divided down over the period.
 */
export const USAGE_PROFILES = [
  {
    id: "ringan",
    label: "pemakaian ringan",
    detail:
      "2 chat Seimbang + 1 tanya-jawab + 1 ronde riset per hari, 1 build/preview per minggu",
    chatSeimbang: 2,
    ask: 1,
    researchRounds: 1,
    sandboxJobsPerWeek: 1,
  },
  {
    id: "normal",
    label: "pemakaian normal",
    detail:
      "10 chat Seimbang + 1 tanya-jawab + 1 ronde riset per hari, 4 build/preview per minggu, 2 audit per bulan",
    chatSeimbang: 10,
    ask: 1,
    researchRounds: 1,
    sandboxJobsPerWeek: 4,
    auditsPerMonth: 2,
  },
  {
    id: "intens",
    label: "pemakaian intens",
    detail:
      "20 chat Seimbang + 4 chat Kuat + 2 tanya-jawab + 4 ronde riset per hari, 1 build/preview per hari, 8 audit per bulan",
    chatSeimbang: 20,
    chatKuat: 4,
    ask: 2,
    researchRounds: 4,
    sandboxJobsPerWeek: 7,
    auditsPerMonth: 8,
  },
];

/** One profile by id; falls back to "normal" so callers never get undefined. */
export function usageProfile(id) {
  return (
    USAGE_PROFILES.find((profile) => profile.id === id) ||
    USAGE_PROFILES.find((profile) => profile.id === "normal")
  );
}

/**
 * The price list as one honest sentence, built from CREDIT_COSTS so the text can
 * never disagree with what the server charges.
 */
export function costLine() {
  const chat = Object.entries(CREDIT_COSTS.chat)
    .map(([tier, cost]) => `${tier} ${cost}`)
    .join(" / ");
  return `chat ${chat} kredit, tanya-jawab ${CREDIT_COSTS.ask}, plan ${CREDIT_COSTS.plan}, ronde riset ${CREDIT_COSTS.researchRound} (maks ${CREDIT_COSTS.researchRoundsPerRequest} per permintaan), perintah sandbox ${CREDIT_COSTS.sandboxCommand}, build/preview ${CREDIT_COSTS.sandboxJob}, audit Lighthouse ${CREDIT_COSTS.audit}`;
}

/** Credits one day of this usage mix costs, from CREDIT_COSTS. */
export function creditsPerDay(profile) {
  if (!profile) return 0;
  const per = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);
  return (
    per(profile.chatSeimbang) * CREDIT_COSTS.chat.Seimbang +
    per(profile.chatKuat) * CREDIT_COSTS.chat.Kuat +
    per(profile.chatCepat) * CREDIT_COSTS.chat.Cepat +
    per(profile.ask) * CREDIT_COSTS.ask +
    per(profile.plan) * CREDIT_COSTS.plan +
    per(profile.researchRounds) * CREDIT_COSTS.researchRound +
    (per(profile.sandboxJobsPerWeek) * CREDIT_COSTS.sandboxJob) / 7 +
    (per(profile.auditsPerMonth) * CREDIT_COSTS.audit) / PLAN_PERIOD_DAYS
  );
}

/**
 * Whole days a credit balance covers at that usage; 0 when it cannot be told.
 * This is arithmetic, not a deadline: the lots themselves expire (2 months for
 * plan credits, 12 for top-ups), so a big balance can still lapse unspent.
 */
export function durationDays(credits, profile) {
  const perDay = creditsPerDay(profile);
  const total = Number(credits);
  if (!Number.isFinite(total) || total <= 0 || perDay <= 0) return 0;
  return Math.floor(total / perDay);
}

/** "±37 hari", "±1 hari", or "kurang dari sehari" for a tiny balance. */
export function lastsLabel(credits, profile) {
  const days = durationDays(credits, profile);
  if (days >= 1) return `±${days} hari`;
  const total = Number(credits);
  if (!Number.isFinite(total) || total <= 0) return "tidak cukup untuk sehari";
  return "kurang dari sehari";
}

/** The top-up ladder with the administrator's overrides applied. */
export function mergeTopups(overrides = {}) {
  return TOPUP_LADDER.map((topup) => {
    const override = overrides?.[topup.sku];
    const amount = Number(override?.amount ?? topup.amount);
    const credits = Number(override?.credits ?? topup.credits);
    return {
      ...topup,
      amount: Number.isFinite(amount) ? amount : topup.amount,
      credits: Number.isFinite(credits) ? credits : topup.credits,
      overridden: Boolean(override),
    };
  });
}

/** Effective price of one credit, rounded to whole rupiah. */
export function ratePerCredit(amount, credits) {
  const price = Number(amount);
  const total = Number(credits);
  if (!Number.isFinite(price) || !Number.isFinite(total) || total <= 0)
    return 0;
  return Math.round(price / total);
}

/**
 * The rule the paid products follow: a bigger package is never more expensive
 * per credit than a smaller one. tests/credits-model.test.ts checks the real
 * product list against this, so a hand-edited number cannot silently invert it.
 */
export function ratesAreMonotonic(offers) {
  const rates = offers.map((offer) =>
    ratePerCredit(offer.amount, offer.credits),
  );
  return rates.every((rate, index) => index === 0 || rate <= rates[index - 1]);
}
