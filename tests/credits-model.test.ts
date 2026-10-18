import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
  creditsPerDay,
  durationDays,
  lastsLabel,
  ratePerCredit,
  ratesAreMonotonic,
  usageProfile,
} from "../shared/credits.mjs";
import { products } from "../server/providers/payments.mjs";

// The point of this file: credits must follow the price. A bigger package is
// never more expensive per credit, the landing page and the checkout read the
// same ladder, and the free allowance stays exactly what the database grants.

const paid = PLAN_LADDER.filter((plan) => plan.monthly > 0);

test("the server sells exactly the credits the public ladder advertises", () => {
  for (const plan of PLAN_LADDER) {
    if (!plan.sku) continue;
    const product = products[plan.sku];
    assert.ok(product, `produk ${plan.sku} harus ada di katalog server`);
    assert.equal(product.kind, "plan");
    assert.equal(product.plan, plan.plan);
    assert.equal(product.amount, plan.monthly);
    assert.equal(product.credits, plan.credits);
  }
  for (const topup of TOPUP_LADDER) {
    const product = products[topup.sku];
    assert.ok(product, `produk ${topup.sku} harus ada di katalog server`);
    assert.equal(product.kind, "topup");
    assert.equal(product.amount, topup.amount);
    assert.equal(product.credits, topup.credits);
  }
  // No hidden SKU: every product the server sells is on a published ladder.
  const published = [
    ...PLAN_LADDER.filter((plan) => plan.sku).map((plan) => plan.sku),
    ...TOPUP_LADDER.map((topup) => topup.sku),
  ].sort();
  assert.deepEqual(Object.keys(products).sort(), published);
});

test("a bigger package is never more expensive per credit", () => {
  // Within each family of packages, paying more never buys a worse rate.
  const plans = paid.map((plan) => ({
    name: plan.plan,
    amount: plan.monthly,
    credits: plan.credits,
  }));
  const topups = TOPUP_LADDER.map((topup) => ({
    name: topup.sku,
    amount: topup.amount,
    credits: topup.credits,
  }));
  const rates = (
    packages: { name: string; amount: number; credits: number }[],
  ) =>
    packages
      .map(
        (p) =>
          `${p.name} ${p.amount}→${p.credits} (${ratePerCredit(p.amount, p.credits)} Rp/kredit)`,
      )
      .join(" > ");
  assert.ok(ratesAreMonotonic(plans), `tangga paket: ${rates(plans)}`);
  assert.ok(ratesAreMonotonic(topups), `tangga top-up: ${rates(topups)}`);
  // And the reason to upgrade before topping up: every plan is a better rate
  // than the cheapest top-up there is.
  const cheapestTopup = Math.min(
    ...topups.map((topup) => ratePerCredit(topup.amount, topup.credits)),
  );
  for (const plan of plans)
    assert.ok(
      ratePerCredit(plan.amount, plan.credits) < cheapestTopup,
      `${plan.name} harus lebih murah per kredit daripada top-up termurah`,
    );
  for (const plan of plans)
    assert.ok(ratePerCredit(plan.amount, plan.credits) > 0);
});

test("the published ladder carries the agreed rates and allowances", () => {
  const rate = (name: string) => {
    const plan = PLAN_LADDER.find((row) => row.plan === name)!;
    return ratePerCredit(plan.monthly, plan.credits);
  };
  assert.equal(rate("Pro"), 133);
  assert.equal(rate("Team"), 111);
  const rates = TOPUP_LADDER.map((topup) =>
    ratePerCredit(topup.amount, topup.credits),
  );
  assert.deepEqual(rates, [163, 142]);
  // Daily allowances: Free and Pro share one, Team gets double.
  const daily = (name: string) =>
    PLAN_LADDER.find((row) => row.plan === name)!.daily;
  assert.equal(daily("Free"), 20);
  // Pro sits between Free and Team: the allowance grows with the plan even
  // though the monthly grant is the one the price sells.
  assert.equal(daily("Pro"), 30);
  assert.equal(daily("Team"), 40);
  assert.ok(daily("Free") < daily("Pro") && daily("Pro") < daily("Team"));
  assert.equal(FREE_PLAN.monthlyCap, 600);
});

test("the credit model matches the database policy in migration 010", () => {
  const sql = readFileSync("supabase/010_credit_lots.sql", "utf8");
  const policy = /create function public\.piwu_credit_policy[\s\S]*?\$\$;/.exec(
    sql,
  )?.[0];
  assert.ok(policy, "piwu_credit_policy harus ada di 010_credit_lots.sql");
  const number = (key: string) => {
    const found = new RegExp(`'${key}',\\s*(\\d+)`).exec(policy);
    assert.ok(found, `policy ${key} harus ada`);
    return Number(found[1]);
  };
  const row = (name: string) => PLAN_LADDER.find((plan) => plan.plan === name)!;
  assert.equal(row("Free").daily, number("dailyFree"));
  assert.equal(row("Pro").daily, number("dailyPro"));
  assert.equal(row("Team").daily, number("dailyTeam"));
  assert.equal(FREE_PLAN.monthlyCap, number("freeMonthlyCap"));
  assert.equal(DAILY_RESET_UTC_HOUR, number("resetUtcHour"));
  // The lot deadlines the pages print are the ones the database applies: plan
  // 2 months, top-up and referral 12 months, daily at the end of the day.
  assert.equal(CREDIT_EXPIRY_MONTHS.plan, number("planMonths"));
  assert.equal(CREDIT_EXPIRY_MONTHS.topup, number("topupMonths"));
  assert.equal(row("Pro").expiryMonths, CREDIT_EXPIRY_MONTHS.plan);
  assert.equal(row("Team").expiryMonths, CREDIT_EXPIRY_MONTHS.plan);
  for (const source of ["daily", "plan", "topup", "bonus", "refund", "admin"])
    assert.ok(
      source in CREDIT_EXPIRY_MONTHS,
      `sumber lot ${source} harus punya masa berlaku`,
    );
  assert.equal(CREDIT_EXPIRY_MONTHS.admin, null, "hibah admin tidak hangus");
  const expiry =
    /create function public\.piwu_lot_expiry[\s\S]*?\$\$;/.exec(sql)?.[0] || "";
  assert.match(expiry, /when 'daily' then/);
  assert.match(expiry, /when 'topup' then p_at\+make_interval\(months=>tm\)/);
  assert.match(expiry, /when 'bonus' then p_at\+make_interval\(months=>tm\)/);
  assert.match(expiry, /else null/);
  // Every top-up SKU on the ladder expires like the model says.
  for (const topup of TOPUP_LADDER)
    assert.equal(topup.expiryMonths, CREDIT_EXPIRY_MONTHS.topup);
  // The plan period the payment function applies is the one the pages print.
  const services = readFileSync("supabase/003_services.sql", "utf8");
  const interval = /interval '(\d+) days'/.exec(services)?.[1];
  assert.equal(Number(interval), PLAN_PERIOD_DAYS);
  // Free is free: there is no price on it anywhere.
  assert.equal(row("Free").monthly, 0);
});

test("durations come from the real operation costs, in the stated order", () => {
  const [ringan, normal, intens] = USAGE_PROFILES;
  const day = (profile: (typeof USAGE_PROFILES)[number]) =>
    Math.round(creditsPerDay(profile) * 10) / 10;
  assert.ok(day(ringan) < day(normal) && day(normal) < day(intens));
  // The profiles are spelled out in operations, so the daily cost is a sum of
  // CREDIT_COSTS and nothing else. Changing a price must move this number.
  const expectedNormal =
    10 * CREDIT_COSTS.chat.Seimbang +
    1 * CREDIT_COSTS.ask +
    1 * CREDIT_COSTS.researchRound +
    (4 * CREDIT_COSTS.sandboxJob) / 7 +
    (2 * CREDIT_COSTS.audit) / PLAN_PERIOD_DAYS;
  assert.equal(day(normal), Math.round(expectedNormal * 10) / 10);

  const pro = PLAN_LADDER.find((plan) => plan.plan === "Pro")!;
  const team = PLAN_LADDER.find((plan) => plan.plan === "Team")!;
  assert.ok(
    durationDays(pro.credits, normal) > durationDays(pro.credits, intens),
  );
  assert.ok(
    durationDays(team.credits, normal) > durationDays(pro.credits, normal),
  );
  assert.match(lastsLabel(pro.credits, usageProfile("normal")), /^±\d+ hari$/);
  // A balance that cannot cover a day says so instead of rounding up to "1 hari".
  assert.equal(lastsLabel(0, normal), "tidak cukup untuk sehari");
  assert.equal(lastsLabel(5, usageProfile("intens")), "kurang dari sehari");
  assert.equal(durationDays(Number.NaN, normal), 0);
});

test("the printed price list is generated from the costs it describes", () => {
  const line = costLine();
  for (const value of [
    CREDIT_COSTS.chat.Cepat,
    CREDIT_COSTS.chat.Seimbang,
    CREDIT_COSTS.chat.Kuat,
    CREDIT_COSTS.ask,
    CREDIT_COSTS.plan,
    CREDIT_COSTS.researchRound,
    CREDIT_COSTS.sandboxCommand,
    CREDIT_COSTS.sandboxJob,
    CREDIT_COSTS.audit,
  ])
    assert.match(line, new RegExp(`\\b${value}\\b`));
  assert.match(line, /chat Cepat 1 \/ Seimbang 3 \/ Kuat 8 kredit/);
  // The operation list says what each action costs and nothing about time: the
  // deadlines are printed from the shared model, never mixed into this line.
  assert.equal(/kedaluwarsa|hangus/i.test(line), false);
});
