import { schemaMissing } from "./platform.mjs";

// Today's credit allowance, as the database itself describes it.
//
// `shared/credits.mjs` and `public.piwu_credit_policy()` already hold the same
// numbers and a test keeps them equal, but the page still used to print the
// allowance from the shared model — a promise about a database it had not
// asked. This module asks instead: `public.piwu_credit_status()` (migration
// 010) answers what the plan grants per day, how much of today is unspent, how
// full the Free monthly cap is, and the instant the next allowance is granted
// (the daily lot's own expiry, so a countdown can never point at a time the
// sweep does not use).
//
// When migration 010 is not applied the answer is not silence and not a guess:
// the payload says `applied: false` with the migration name, and the pages say
// exactly that. A read that fails for another reason is reported as unreadable
// — the balance on the same page stays correct, so the account payload keeps
// loading and the note names what could not be read.

const FUNCTION = "piwu_credit_status";

export const NOTE_MISSING =
  "Jatah harian dan masa berlaku kredit belum aktif di database ini: terapkan migration 010_credit_lots.sql. Saldo tetap seperti yang tercatat.";
export const NOTE_UNREADABLE =
  "Status jatah harian tidak bisa dibaca dari database. Saldo dan riwayat di bawah tetap yang terakhir tercatat.";
export const NOTE_INVALID =
  "Database mengembalikan status jatah harian yang tidak bisa dipahami; halaman ini tidak menampilkan angka jatah.";

const finite = (value) =>
  value === null || value === undefined ? null : Number(value);

const count = (value) => {
  const number = finite(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number) : null;
};

/** Numbers and timestamps from the RPC, or null when the shape is unusable. */
export function normalizeCreditStatus(raw) {
  if (!raw || typeof raw !== "object") return null;
  const daily = count(raw.daily);
  const dailyRemaining = count(raw.dailyRemaining);
  const resetAt = raw.resetAt ? new Date(raw.resetAt) : null;
  if (daily === null || dailyRemaining === null) return null;
  if (!resetAt || Number.isNaN(resetAt.getTime())) return null;
  return {
    applied: true,
    source: "database",
    plan: typeof raw.plan === "string" && raw.plan ? raw.plan : "Free",
    daily,
    dailyClaimed: count(raw.dailyClaimed) ?? 0,
    dailyRemaining,
    // Free has a monthly ceiling; a paid plan reports null, not zero.
    monthlyCap: count(raw.monthlyCap),
    monthlyUsed: count(raw.monthlyUsed) ?? 0,
    resetUtcHour: count(raw.resetUtcHour) ?? 0,
    resetAt: resetAt.toISOString(),
    planMonths: count(raw.planMonths),
    topupMonths: count(raw.topupMonths),
  };
}

/**
 * Ask the database for this account's daily allowance. Never throws for a
 * missing migration or an unreadable answer; the caller gets a payload that
 * says which of those happened.
 */
export async function creditStatus(admin, userId) {
  let result;
  try {
    result = await admin.rpc(FUNCTION, { p_user: userId });
  } catch {
    // A client that throws (network, service role missing) is the same answer
    // to the page as an unreadable row: the note says it could not be read.
    return { applied: false, source: "error", note: NOTE_UNREADABLE };
  }
  const error = result?.error;
  if (error) {
    if (schemaMissing(error))
      return { applied: false, source: "migration", note: NOTE_MISSING };
    return {
      applied: false,
      source: "error",
      code: error.code || "",
      note: NOTE_UNREADABLE,
    };
  }
  const status = normalizeCreditStatus(result?.data);
  if (!status) return { applied: false, source: "invalid", note: NOTE_INVALID };
  return status;
}
