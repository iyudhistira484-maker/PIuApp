/**
 * Credits, read the way a user asks about them: "how much is left, and what did
 * it go on?" The ledger rows carry a `reason` written by the server
 * (`ai`, `sandbox` — plus payment and welcome rows that are positive),
 * so a breakdown is possible without storing anything new.
 */
export const LEDGER_DAYS = 7;

/**
 * Below this, a top up is worth mentioning: an audit costs 3 credits and the
 * starting balance is 30. Ten credits is "a couple of things left".
 */
export const CREDIT_LOW = 10;

const SPEND_LABELS: Record<string, string> = {
  ai: "Percakapan AI",
  sandbox: "Build & audit",
};

/** Server reasons are short slugs; anything unknown is shown as it arrived. */
export function spendLabel(reason: string | undefined) {
  const key = (reason || "").trim().toLowerCase();
  if (!key) return "Lainnya";
  return SPEND_LABELS[key] || key;
}

export interface SpendRow {
  reason: string;
  label: string;
  credits: number;
  count: number;
}

/**
 * Credits spent in the window, grouped by what they were spent on, biggest
 * first. Positive rows (top ups, the welcome credit) are not spending.
 */
export function spendByReason(
  ledger:
    { delta?: number; reason?: string; created_at?: string }[] | undefined,
  days = LEDGER_DAYS,
  now = Date.now(),
): SpendRow[] {
  const since = now - days * 86400000;
  const rows = new Map<string, SpendRow>();
  for (const entry of ledger || []) {
    const at = entry.created_at ? Date.parse(entry.created_at) : NaN;
    const delta = Number(entry.delta || 0);
    if (Number.isNaN(at) || at < since || delta >= 0) continue;
    const reason = (entry.reason || "").trim().toLowerCase();
    const row = rows.get(reason) || {
      reason,
      label: spendLabel(reason),
      credits: 0,
      count: 0,
    };
    row.credits += Math.abs(delta);
    row.count += 1;
    rows.set(reason, row);
  }
  return [...rows.values()].sort((a, b) => b.credits - a.credits);
}

export const isLowBalance = (balance: number) =>
  Number.isFinite(balance) && balance <= CREDIT_LOW;
