import test from "node:test";
import assert from "node:assert/strict";
import {
  PLAN_DAYS,
  capLine,
  creditsNote,
  dailyLine,
  expiryLine,
  hoursToReset,
  nextResetAt,
  offerExpiry,
  serverDailyLine,
  paymentsNotice,
  periodLeft,
  planBenefits,
  planFacts,
  planOffers,
  rupiah,
  topupOffers,
} from "../src/lib/dashboard/plans";
import {
  CREDIT_EXPIRY_MONTHS,
  PLAN_LADDER,
  mergePlans,
} from "../shared/credits.mjs";

// The exact products the server sells today (server/providers/payments.mjs).
const products = {
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
};

test("the upgrade page splits plans from top-ups using the server's own kind", () => {
  assert.deepEqual(
    planOffers(products, "Free").map((o) => o.sku),
    ["pro", "team"],
  );
  assert.deepEqual(
    topupOffers(products).map((o) => o.sku),
    ["credits300", "credits1400"],
  );
  const [pro] = planOffers(products, "Free");
  assert.equal(pro.price, 199000);
  assert.equal(pro.credits, 1500);
  assert.equal(pro.plan, "Pro");
  assert.equal(pro.perDayCredits, Math.round(1500 / PLAN_DAYS));
  // The price per credit is written on the card and comes from the same model
  // the server bills with, so a package that got bigger cannot keep the old
  // rate printed beside it.
  assert.equal(pro.rate, 133);
  const [team] = planOffers(products, "Free").slice(1);
  assert.equal(team.rate, 111);
  assert.ok(team.rate < pro.rate, "a bigger package is cheaper per credit");
  // The allowance and the deadline on a card come from the ladder the server
  // sells from, not from copy typed into the page.
  assert.equal(pro.daily, 30);
  assert.equal(team.daily, 40);
  assert.equal(pro.expiryMonths, CREDIT_EXPIRY_MONTHS.plan);
  assert.equal(pro.monthlyCap, null);
  const [topup] = topupOffers(products);
  assert.equal(topup.daily, 0);
  assert.equal(topup.expiryMonths, CREDIT_EXPIRY_MONTHS.topup);
  assert.match(offerExpiry(pro), /hangus 2 bulan setelah terbit/);
  assert.match(offerExpiry(topup), /Berlaku 12 bulan sejak pembelian/);
  // The header sentence names every deadline in the model.
  assert.match(expiryLine(), /direset setiap hari pukul 00:00 UTC/);
  assert.match(expiryLine(), /kredit top-up berlaku 12 bulan/);
  // Durations are arithmetic over the real operation costs, not a promise.
  const normal = pro.durations.find((d) => d.id === "normal")!;
  const intens = pro.durations.find((d) => d.id === "intens")!;
  assert.ok(normal.perDay > 0 && intens.perDay > normal.perDay);
  assert.ok(normal.days > intens.days);
  assert.match(normal.text, /^±\d+ hari$/);
  assert.equal(pro.current, false);
  assert.equal(topupOffers(products)[0].plan, "");
});

test("only the plan the account is on is flagged as current", () => {
  const offers = planOffers(products, "Pro");
  assert.deepEqual(
    offers.map((o) => [o.sku, o.current]),
    [
      ["pro", true],
      ["team", false],
    ],
  );
  // A plan name that matches no product flags nothing.
  assert.equal(
    planOffers(products, "Enterprise").some((o) => o.current),
    false,
  );
  // Free is not a purchasable product, so nothing is marked current.
  assert.equal(
    planOffers(products, "Free").some((o) => o.current),
    false,
  );
});

test("products without a numeric price or credit are not offered", () => {
  const partial = {
    pro: { kind: "plan", plan: "Pro", amount: 199000, credits: 1500 },
    broken: { kind: "plan", plan: "Broken", label: "Tanpa harga" },
    odd: { kind: "topup", amount: "gratis", credits: 10 },
  };
  assert.deepEqual(
    planOffers(partial, "Free").map((o) => o.sku),
    ["pro"],
  );
  assert.deepEqual(topupOffers(partial), []);
  // Nothing to read at all stays empty instead of inventing a product.
  assert.deepEqual(planOffers(undefined, "Free"), []);
  assert.deepEqual(topupOffers(undefined), []);
});

test("checkout is only offered when the server says payments are configured", () => {
  assert.equal(paymentsNotice(true, "midtrans").ready, true);
  assert.match(paymentsNotice(true, "midtrans").text, /midtrans/);
  assert.equal(
    paymentsNotice(false, null).ready,
    false,
    "no provider means no checkout",
  );
  assert.match(paymentsNotice(undefined, null).text, /belum dikonfigurasi/i);
  assert.match(paymentsNotice(undefined, null).text, /Kredit yang ada tetap/);
});

test("the period line counts days left and never shows a negative day", () => {
  const now = Date.parse("2026-10-16T00:00:00.000Z");
  assert.equal(periodLeft("2026-11-03T00:00:00.000Z", now), "Sisa 18 hari");
  assert.equal(periodLeft("2026-10-16T12:00:00.000Z", now), "Sisa 1 hari");
  assert.equal(periodLeft("2026-10-01T00:00:00.000Z", now), "");
  assert.equal(periodLeft("bukan tanggal", now), "");
  assert.equal(periodLeft(null, now), "");
  assert.equal(
    periodLeft("2026-10-15T23:00:00.000Z", now),
    "Masa aktif berakhir hari ini",
  );
});

test("the page states what is true about plans instead of implying gating", () => {
  const facts = planFacts();
  assert.equal(facts.length, 6);
  // Intl writes "Rp\u00a0249" with a non-breaking space; normalise it so the
  // assertions read like the text a person sees.
  const joined = facts
    .map((f) => f.title + " " + f.detail)
    .join(" ")
    .replace(/\u00a0/g, " ");
  // Gating now exists as an operator-controlled matrix, but it ships open.
  assert.match(joined, /matriks akses per paket/i);
  assert.match(joined, /bawaan(nya)? "Semua paket"/i);
  assert.match(joined, /tidak ada fitur yang dikunci diam-diam/i);
  // The deadlines are stated with the same numbers the database enforces: the
  // daily allowance never accumulates and each lot has its own expiry.
  assert.match(joined, /direset pada pukul 00:00 UTC/);
  assert.match(joined, /tidak menumpuk/i);
  assert.match(joined, /hangus 2 bulan setelah terbit/);
  assert.match(joined, /berlaku 12 bulan sejak pembelian/);
  assert.match(joined, /plafon 600 kredit per bulan/);
  // The rate sentence is derived from the ladder, so both plans appear.
  assert.match(joined, /Pro Rp 133\/kredit/);
  assert.match(joined, /Team Rp 111\/kredit/);
  // And the durations are explained, not asserted.
  assert.match(joined, /pemakaian normal/i);
  assert.match(joined, /pemakaian intens/i);
  assert.match(joined, /50 kredit/);
  for (const fact of facts) {
    assert.ok(fact.title.length > 3);
    assert.ok(fact.detail.length > 20);
  }
});

test("the daily allowance line counts down to the real reset, in UTC", () => {
  const noon = Date.parse("2026-10-16T12:00:00.000Z");
  assert.equal(
    new Date(nextResetAt(noon)).toISOString(),
    "2026-10-17T00:00:00.000Z",
  );
  assert.equal(hoursToReset(noon), 12);
  // A minute before the reset the next one is still the coming midnight, not
  // two days away, and never a negative count.
  assert.equal(
    new Date(nextResetAt(Date.parse("2026-10-16T23:59:00.000Z"))).toISOString(),
    "2026-10-17T00:00:00.000Z",
  );
  assert.equal(hoursToReset(Date.parse("2026-10-16T23:59:00.000Z")), 1);
  // Exactly at midnight the allowance has just been refilled: the countdown
  // names the next midnight, and a Jakarta evening (UTC+7) is the same clock.
  assert.equal(
    new Date(nextResetAt(Date.parse("2026-10-16T00:00:00.000Z"))).toISOString(),
    "2026-10-17T00:00:00.000Z",
  );
  assert.equal(
    new Date(nextResetAt(Date.parse("2026-10-16T18:00:00.000Z"))).toISOString(),
    "2026-10-17T00:00:00.000Z",
  );
  // The line names the plan's own allowance from the ladder, and stays empty
  // for a name the ladder does not know instead of inventing a number.
  assert.match(
    dailyLine("Free", noon),
    /^20 kredit\/hari · direset 00:00 UTC \(dalam 12 jam\)$/,
  );
  assert.match(dailyLine("Pro", noon), /^30 kredit\/hari/);
  assert.match(dailyLine("Team", noon), /^40 kredit\/hari/);
  assert.equal(dailyLine("Enterprise", noon), "");
  assert.equal(dailyLine("", noon), "");
});

test("the daily line follows the server's allowance, not the shared ladder", () => {
  const noon = Date.parse("2026-10-16T12:00:00.000Z");
  const credits = {
    applied: true,
    source: "database",
    plan: "Free",
    daily: 20,
    dailyClaimed: 20,
    dailyRemaining: 12,
    monthlyCap: 600,
    monthlyUsed: 120,
    resetUtcHour: 0,
    resetAt: "2026-10-17T00:00:00.000Z",
    planMonths: 2,
    topupMonths: 12,
  };
  // The countdown uses the instant the database sent (the daily lot's expiry),
  // even when that is not what the shared model would compute from the hour.
  assert.equal(
    serverDailyLine(credits, noon),
    "20 kredit/hari · direset 00:00 UTC (dalam 12 jam) · sisa hari ini 12",
  );
  assert.equal(
    serverDailyLine({ ...credits, resetAt: "2026-10-16T14:00:00.000Z" }, noon),
    "20 kredit/hari · direset 00:00 UTC (dalam 2 jam) · sisa hari ini 12",
  );
  // A Team seat reports its own allowance and no ceiling.
  assert.match(
    serverDailyLine(
      {
        ...credits,
        plan: "Team",
        daily: 40,
        dailyRemaining: 40,
        monthlyCap: null,
      },
      noon,
    ),
    /^40 kredit\/hari/,
  );
  assert.equal(capLine({ ...credits, monthlyCap: null }), "");
  assert.equal(capLine(credits), "Plafon 600 kredit/bulan · terpakai 120");
  assert.equal(
    capLine({ ...credits, monthlyUsed: 900 }),
    "Plafon 600 kredit/bulan · terpakai 600",
  );
  // Nothing is printed before the server confirms the allowance exists: an
  // unreadable or missing migration answer becomes the note instead of a number.
  const missing = {
    applied: false,
    source: "migration",
    note: "Jatah harian dan masa berlaku kredit belum aktif di database ini: terapkan migration 010_credit_lots.sql. Saldo tetap seperti yang tercatat.",
  };
  assert.equal(serverDailyLine(missing, noon), "");
  assert.equal(serverDailyLine(null, noon), "");
  assert.equal(capLine(missing), "");
  assert.equal(creditsNote(missing), missing.note);
  assert.equal(creditsNote(credits), "");
  assert.equal(creditsNote(undefined), "");
  // A missing or unparsable instant falls back to the shared hour, so the line
  // is still a countdown rather than an empty sentence.
  assert.equal(hoursToReset(noon, "bukan tanggal"), 12);
  assert.equal(hoursToReset(noon, "2026-10-16T11:00:00.000Z"), 0);
  assert.equal(
    serverDailyLine({ ...credits, resetAt: undefined }, noon),
    "20 kredit/hari · direset 00:00 UTC (dalam 12 jam) · sisa hari ini 12",
  );
  // And the header sentence speaks about the account the reader is on.
  const line = expiryLine(credits);
  assert.match(line, /Jatah harian paket Free 20 kredit/);
  assert.match(line, /kredit top-up berlaku 12 bulan/);
  assert.equal(/Enterprise/.test(line), false);
});

test("prices are written as rupiah without hidden decimals", () => {
  const text = rupiah(199000);
  assert.match(text, /199\.000/);
  assert.equal(text.includes(",00"), false);
  assert.equal(rupiah(Number.NaN), rupiah(0));
});

test("each plan's benefits state the real credits and nothing the app gates", () => {
  const benefits = planBenefits();
  assert.deepEqual(
    benefits.map((entry) => entry.plan),
    ["Free", "Pro", "Team"],
  );
  const text = benefits
    .flatMap((entry) => [entry.summary, ...entry.items])
    .join(" ")
    .replace(/\u00a0/g, " ");
  // Credits are printed from PLAN_LADDER, including the rate the checkout uses.
  for (const plan of PLAN_LADDER) {
    const row = benefits.find((entry) => entry.plan === plan.plan)!;
    assert.ok(row.items.length >= 3, plan.plan);
    if (!plan.monthly) continue;
    const number = new Intl.NumberFormat("id-ID").format(plan.credits);
    assert.match(row.items.join(" "), new RegExp(number));
    assert.match(row.items.join(" "), /kredit\/bulan/);
    assert.match(row.items.join(" "), new RegExp(`${plan.daily} kredit/hari`));
  }
  assert.match(text, /Rp 133\/kredit/);
  assert.match(text, /Rp 111\/kredit/);
  assert.match(text, /tanpa kartu kredit/);
  // The free allowance is already printed in the credit line above the list;
  // the benefits do not restate it a second time.
  assert.ok(!text.includes("plafon 600 kredit/bulan"));
  // No feature is sold as unlocked by a plan: those claims were removed with
  // the old pricing copy, and this keeps them from creeping back.
  for (const claim of [
    "Workspace bersama",
    "Tagihan terpusat",
    "3 project lokal",
    "Role & kontrol akses",
  ])
    assert.ok(!text.includes(claim), `klaim tanpa fitur: ${claim}`);
});

test("a saved admin price flows into the landing card's benefits", () => {
  const plans = mergePlans({ pro: { amount: 249000, credits: 2000 } });
  const pro = planBenefits(plans).find((row) => row.plan === "Pro")!;
  const text = pro.items.join(" ").replace(/\u00a0/g, " ");
  assert.match(text, /2\.000 kredit\/bulan/);
  // 249.000 / 2.000 = 124,5 → 125 per credit.
  assert.match(text, /Rp 125\/kredit/);
  // The database-owned allowance is unchanged.
  assert.match(text, /30 kredit\/hari/);
  assert.match(text, /hangus 2 bulan setelah terbit/);
});
