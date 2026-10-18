import type { Page } from "@playwright/test";
import { realAccountFixture, loginRealFixture } from "./helpers-real";

// Shared fixtures for the paid-service pages (upgrade, profile). The product
// list is copied from server/providers/payments.mjs, so a product change there
// is meant to show up as a failing assertion here rather than a silent drift.
export const ACCOUNT_URL = "**/api/account";

export const accountPayload = (overrides: Record<string, unknown> = {}) => ({
  balance: 128,
  ledger: [
    {
      id: "l1",
      delta: -3,
      reason: "ai",
      reference: "reserve:r1",
      created_at: "2026-03-03T08:00:00.000Z",
    },
  ],
  orders: [
    {
      id: "o1",
      sku: "pro",
      amount: 199000,
      status: "pending",
      checkout_url: "https://checkout.midtrans.test/o1",
      created_at: "2026-03-02T08:00:00.000Z",
    },
  ],
  plan: { plan: "Free" },
  // What `GET /api/account` answers about today's allowance: the database's own
  // numbers and the instant of the next reset.
  credits: {
    applied: true,
    source: "database",
    plan: "Free",
    daily: 20,
    dailyClaimed: 20,
    dailyRemaining: 12,
    monthlyCap: 600,
    monthlyUsed: 120,
    resetUtcHour: 0,
    resetAt: new Date(Date.now() + 3 * 3600000).toISOString(),
    planMonths: 2,
    topupMonths: 12,
  },
  products: {
    pro: {
      kind: "plan",
      plan: "Pro",
      amount: 199000,
      credits: 1500,
      label: "PiwuApp Pro · 30 hari",
    },
    team: {
      kind: "plan",
      plan: "Team",
      amount: 499000,
      credits: 4500,
      label: "PiwuApp Team · 30 hari",
    },
    credits300: {
      kind: "topup",
      amount: 49000,
      credits: 300,
      label: "Top-up 300 kredit",
    },
    credits1400: {
      kind: "topup",
      amount: 199000,
      credits: 1400,
      label: "Top-up 1.400 kredit",
    },
  },
  paymentsEnabled: false,
  provider: null,
  referral: { code: "PIWU123", total: 0, rewarded: 0 },
  sales: [
    { gross: 50000, net: 42500, status: "accrued", created_at: "2026-03-01" },
    { gross: 90000, net: 76500, status: "refunded", created_at: "2026-02-01" },
  ],
  ...overrides,
});

/** The auth client adds its own null defaults; only real fields are asserted. */
export const meaningful = (body: Record<string, any> | null) => {
  const out: Record<string, any> = {};
  for (const [key, value] of Object.entries(body || {}))
    if (value !== null && value !== undefined && key !== "captchaToken")
      out[key] = value;
  return out;
};

/** Signs in through the real Supabase client, with /api/account under our control. */
export async function signedIn(
  page: Page,
  account: Record<string, unknown>,
  onCheckout?: (body: any) => void,
) {
  await realAccountFixture(page);
  await page.route(ACCOUNT_URL, (route) =>
    route.fulfill({ json: accountPayload(account) }),
  );
  if (onCheckout)
    await page.route("**/api/checkout", (route) => {
      onCheckout(route.request().postDataJSON());
      return route.fulfill({
        json: { url: "https://checkout.midtrans.test/session-1" },
      });
    });
  await page.goto("/login");
  await loginRealFixture(page);
}
