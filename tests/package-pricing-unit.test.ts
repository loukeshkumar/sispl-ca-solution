import assert from "node:assert/strict";
import test from "node:test";

import {
  BAND_LABELS,
  CHARGES_A_YEAR,
  expectedEffort,
  marginBand,
  marginOf,
  minutesToPaise,
  OCCURRENCES_A_YEAR,
  priceAtDesign,
  pricingSummary,
  refusePricing,
  standingOf,
  standingSummary,
  type PackageService,
} from "../lib/packages/pricing";

/** A retainer: GST monthly, books monthly, TDS quarterly. */
const SERVICES: PackageService[] = [
  { frequency: "monthly", serviceCode: "GST", serviceName: "GST returns", standardMinutes: 180 },
  { frequency: "monthly", serviceCode: "BOOKS", serviceName: "Bookkeeping", standardMinutes: 240 },
  { frequency: "quarterly", serviceCode: "TDS", serviceName: "TDS returns", standardMinutes: 300 },
];

const COST_RATE = 45_000; // ₹450 an hour
const FEE = 10_000_000; // ₹1,00,000 a year

test("effort is occurrences times the standard time, per service", () => {
  const effort = expectedEffort(SERVICES);
  assert.equal(effort.services.find((s) => s.serviceCode === "GST")!.minutesAYear, 2160, "12 × 180");
  assert.equal(effort.services.find((s) => s.serviceCode === "TDS")!.minutesAYear, 1200, "4 × 300");
  assert.equal(effort.minutesAYear, 2160 + 2880 + 1200, "104 hours");
  assert.equal(effort.assumedServices.length, 0);
});

test("a service with no standard time contributes nothing and is named", () => {
  // An estimate built partly on invention reads exactly like one built on
  // record, and the firm would price against it either way.
  const effort = expectedEffort([...SERVICES, { frequency: "monthly", serviceCode: "ADV", serviceName: "Advisory", standardMinutes: null }]);
  assert.deepEqual(effort.assumedServices, ["ADV"]);
  assert.equal(effort.minutesAYear, 6240, "unchanged: nothing was invented for it");
  assert.equal(effort.services.find((s) => s.serviceCode === "ADV")!.assumed, true);
});

test("a service no schedule governs is equally assumed", () => {
  const effort = expectedEffort([{ frequency: null, serviceCode: "ROC", serviceName: "ROC filings", standardMinutes: 600 }]);
  assert.deepEqual(effort.assumedServices, ["ROC"]);
  assert.equal(effort.minutesAYear, 0, "nothing says how often it comes round");
});

test("an empty package commits the firm to nothing", () => {
  const effort = expectedEffort([]);
  assert.equal(effort.minutesAYear, 0);
  assert.deepEqual(effort.services, []);
});

test("minutes become money at the rate, rounded once", () => {
  assert.equal(minutesToPaise(6240, COST_RATE), 4_680_000, "104 hours at ₹450");
  assert.equal(minutesToPaise(7, 100_000), 11_667);
});

test("a package is priced against the firm's own standards", () => {
  const pricing = priceAtDesign({ billingCycle: "annual", costPaisePerHour: COST_RATE, feePaise: FEE, services: SERVICES });
  assert.equal(pricing.annualFeePaise, FEE);
  assert.equal(pricing.expectedMargin.costPaise, 4_680_000);
  assert.equal(pricing.expectedMargin.marginPaise, 5_320_000);
  assert.equal(pricing.expectedMargin.percent, 53);
  assert.equal(pricing.incomplete, false);
  assert.equal(pricingSummary(pricing), "104:00 a year · ₹46,800 at cost · ₹53,200 margin (53%)");
});

test("a monthly fee is annualised before it is compared", () => {
  // Comparing one month's fee against a year of effort would say every retainer
  // in the firm was a disaster.
  const monthly = priceAtDesign({ billingCycle: "monthly", costPaisePerHour: COST_RATE, feePaise: 833_400, services: SERVICES });
  assert.equal(monthly.annualFeePaise, 10_000_800);
  assert.equal(monthly.expectedMargin.percent, 53);
  assert.equal(CHARGES_A_YEAR.quarterly, 4);
  assert.equal(CHARGES_A_YEAR.one_time, 1, "a one-time fee recurs once");
  assert.equal(OCCURRENCES_A_YEAR.monthly, 12);
});

test("a package priced under its own cost says so plainly", () => {
  const pricing = priceAtDesign({ billingCycle: "annual", costPaisePerHour: COST_RATE, feePaise: 3_000_000, services: SERVICES });
  assert.ok(pricing.expectedMargin.marginPaise < 0);
  assert.equal(pricing.expectedMargin.percent, -56);
  assert.equal(marginBand(pricing.expectedMargin), "loss");
  assert.match(pricingSummary(pricing), /₹16,800 short \(-56%\)/);
});

test("a package leaning on services without standards flags the estimate", () => {
  const pricing = priceAtDesign({
    billingCycle: "annual",
    costPaisePerHour: COST_RATE,
    feePaise: FEE,
    services: [...SERVICES, { frequency: "monthly", serviceCode: "ADV", serviceName: "Advisory", standardMinutes: null }],
  });
  assert.equal(pricing.incomplete, true);
  assert.match(pricingSummary(pricing), /1 service without a standard/);
});

test("bands separate a thin margin from a negative one", () => {
  // A thin margin is a pricing discussion at renewal; a negative one is a
  // conversation this week.
  assert.equal(marginBand(marginOf({ costPaise: 110, revenuePaise: 100 })), "loss");
  assert.equal(marginBand(marginOf({ costPaise: 85, revenuePaise: 100 })), "thin");
  assert.equal(marginBand(marginOf({ costPaise: 81, revenuePaise: 100 })), "thin", "19% is thin");
  assert.equal(marginBand(marginOf({ costPaise: 80, revenuePaise: 100 })), "healthy", "20% is where healthy starts");
  assert.equal(marginBand(marginOf({ costPaise: 49, revenuePaise: 100 })), "strong");
  assert.equal(marginBand(marginOf({ costPaise: 0, revenuePaise: 0 })), "unknown");
  for (const band of Object.keys(BAND_LABELS)) assert.ok(BAND_LABELS[band as keyof typeof BAND_LABELS].length > 0);
});

test("margin against cost and realisation against charge are different facts", () => {
  // A package delivered at 38% margin and 61% realisation is profitable and
  // heavily discounted at once. A firm that sees only the first keeps renewing.
  const standing = standingOf({
    actual: { chargeValuePaise: 16_500_000, costPaise: 6_187_500, minutes: 8250 },
    expectedMinutes: 6240,
    feePaise: FEE,
  });
  assert.equal(standing.margin.percent, 38, "the package still makes money");
  assert.equal(standing.realisedPercent, 61, "and gives away nearly two fifths of its value");
  assert.equal(standing.effortOverrunPercent, 32);
  assert.equal(
    standingSummary(standing),
    "137:30 delivered · 38% margin · 61% realised · 32% over the estimate",
  );
});

test("delivering under the estimate reads as under, not as a negative overrun", () => {
  const standing = standingOf({
    actual: { chargeValuePaise: 9_000_000, costPaise: 3_000_000, minutes: 4680 },
    expectedMinutes: 6240,
    feePaise: FEE,
  });
  assert.equal(standing.effortOverrunPercent, -25);
  assert.match(standingSummary(standing), /25% under the estimate/);
});

test("exactly on the estimate says nothing about the estimate at all", () => {
  const standing = standingOf({
    actual: { chargeValuePaise: 9_000_000, costPaise: 4_680_000, minutes: 6240 },
    expectedMinutes: 6240,
    feePaise: FEE,
  });
  assert.equal(standing.effortOverrunPercent, 0);
  assert.ok(!standingSummary(standing).includes("estimate"));
});

test("a package with no expectation and no time reports neither", () => {
  const standing = standingOf({
    actual: { chargeValuePaise: 0, costPaise: 0, minutes: 0 },
    expectedMinutes: 0,
    feePaise: FEE,
  });
  assert.equal(standing.effortOverrunPercent, null, "nothing to overrun");
  assert.equal(standing.realisedPercent, null, "nothing was worth anything");
  assert.equal(standing.margin.percent, 100, "a fee with no cost against it is all margin");
});

test("pricing needs services, a fee and a cost rate", () => {
  const base = { costPaisePerHour: COST_RATE, feePaise: FEE, serviceCount: 3 };
  assert.equal(refusePricing(base), null);
  assert.equal(refusePricing({ ...base, serviceCount: 0 }), "no_services");
  assert.equal(refusePricing({ ...base, feePaise: -1 }), "negative_fee");
  assert.equal(refusePricing({ ...base, costPaisePerHour: null }), "no_cost_rate");
  assert.equal(refusePricing({ ...base, costPaisePerHour: 0 }), "no_cost_rate");
  assert.equal(refusePricing({ ...base, feePaise: 0 }), null, "a free package is a choice, not an error");
});
