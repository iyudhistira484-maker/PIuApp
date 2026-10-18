export const CREDIT_COSTS: {
  ask: number;
  plan: number;
  chat: { Cepat: number; Seimbang: number; Kuat: number };
  researchRound: number;
  researchRoundsPerRequest: number;
  sandboxCommand: number;
  sandboxJob: number;
  audit: number;
};
export const PLAN_PERIOD_DAYS: number;
export const DAILY_RESET_UTC_HOUR: number;
export const CREDIT_EXPIRY_MONTHS: {
  daily: number;
  plan: number;
  topup: number;
  bonus: number;
  refund: number;
  admin: null;
};
export const FREE_PLAN: {
  plan: string;
  credits: number;
  daily: boolean;
  monthlyCap: number;
  reason: string;
};
export interface PlanRow {
  plan: string;
  sku: string | null;
  monthly: number;
  /** Credits granted per paid period, or the daily allowance for Free. */
  credits: number;
  /** Daily allowance that refills every day at 00:00 UTC. */
  daily: number;
  /** Monthly ceiling a Free account may not pass; null when there is none. */
  monthlyCap: number | null;
  /** Months until a granted lot expires; 0 means "at the end of that day". */
  expiryMonths: number;
}
export const PLAN_LADDER: PlanRow[];
export interface PlanOverride {
  amount?: number;
  credits?: number;
}
/** Overrides keyed by plan name (lowercase) or top-up SKU. */
export type PlanOverrides = Record<string, PlanOverride>;
export function mergePlans(
  overrides?: PlanOverrides,
): (PlanRow & { overridden: boolean })[];
export const TOPUP_LADDER: {
  sku: string;
  amount: number;
  credits: number;
  expiryMonths: number;
}[];
export function mergeTopups(overrides?: PlanOverrides): {
  sku: string;
  amount: number;
  credits: number;
  expiryMonths: number;
  overridden: boolean;
}[];
export function planForSku(sku: string): PlanRow | undefined;
export function dailyAllowance(planName: string): number;
export function expiryLabel(months?: number | null): string;
export function usageProfile(id: string): UsageProfile;
export function costLine(): string;
export interface UsageProfile {
  id: string;
  label: string;
  detail: string;
  chatSeimbang?: number;
  chatKuat?: number;
  chatCepat?: number;
  ask?: number;
  plan?: number;
  researchRounds?: number;
  sandboxJobsPerWeek?: number;
  auditsPerMonth?: number;
}
export const USAGE_PROFILES: UsageProfile[];
export function creditsPerDay(profile?: UsageProfile): number;
export function durationDays(credits: number, profile?: UsageProfile): number;
export function lastsLabel(credits: number, profile?: UsageProfile): string;
export function ratePerCredit(amount: number, credits: number): number;
export function ratesAreMonotonic(
  offers: { amount: number; credits: number }[],
): boolean;
