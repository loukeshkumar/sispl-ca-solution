import assert from "node:assert/strict";
import test from "node:test";

import {
  accumulate,
  buildRateBook,
  costPerHourFromPayroll,
  emptyEffortValue,
  formatBasisPoints,
  hoursLabel,
  marginBasisPoints,
  rateInForce,
  resolveCharge,
  resolveCost,
  summariseEffort,
  valueEntry,
  valueOf,
  type ClientRateOverrideRow,
  type EmployeeRateRow,
} from "../lib/rates/valuation";

const NISHA = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const RAHUL = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const KOSHI = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const AARAV = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

/** ₹3,500/hr in paise. Money is never a float in this system. */
const rupees = (amount: number) => amount * 100;

const rate = (over: Partial<EmployeeRateRow> = {}): EmployeeRateRow => ({
  chargePaisePerHour: rupees(3500),
  costPaisePerHour: null,
  effectiveFrom: "2026-04-01",
  employeeUserId: NISHA,
  ...over,
});

const override = (over: Partial<ClientRateOverrideRow> = {}): ClientRateOverrideRow => ({
  chargePaisePerHour: rupees(2800),
  effectiveFrom: "2026-04-01",
  employeeUserId: NISHA,
  legalEntityId: KOSHI,
  ...over,
});

const noPayroll = () => null;

test("the rate in force is the latest one that had already started", () => {
  const rows = [
    { effectiveFrom: "2025-04-01", chargePaisePerHour: rupees(3000) },
    { effectiveFrom: "2026-04-01", chargePaisePerHour: rupees(3500) },
    { effectiveFrom: "2027-04-01", chargePaisePerHour: rupees(4000) },
  ];
  assert.equal(rateInForce(rows, "2026-08-24")?.chargePaisePerHour, rupees(3500));
  assert.equal(rateInForce(rows, "2025-06-01")?.chargePaisePerHour, rupees(3000));
  // A revision dated ahead is a decision made but not yet applied.
  assert.equal(rateInForce(rows, "2027-03-31")?.chargePaisePerHour, rupees(3500));
  assert.equal(rateInForce(rows, "2027-04-01")?.chargePaisePerHour, rupees(4000));
  assert.equal(rateInForce(rows, "2024-01-01"), null, "no rate had started yet");
});

test("a rate revision never rewrites what earlier work was worth", () => {
  const book = buildRateBook([
    rate({ effectiveFrom: "2026-04-01", chargePaisePerHour: rupees(3000) }),
    rate({ effectiveFrom: "2026-07-01", chargePaisePerHour: rupees(3500) }),
  ], []);
  const before = valueEntry({ billable: true, employeeUserId: NISHA, entryDate: "2026-05-10", legalEntityId: AARAV, minutes: 60 }, book, noPayroll);
  const after = valueEntry({ billable: true, employeeUserId: NISHA, entryDate: "2026-08-10", legalEntityId: AARAV, minutes: 60 }, book, noPayroll);
  assert.equal(before.chargePaise, rupees(3000));
  assert.equal(after.chargePaise, rupees(3500));
});

test("a client's negotiated rate beats the house rate, for that client only", () => {
  const book = buildRateBook([rate()], [override()]);
  const negotiated = resolveCharge(book, NISHA, KOSHI, "2026-08-24");
  assert.equal(negotiated.basis, "override");
  assert.equal(negotiated.paisePerHour, rupees(2800));

  const standard = resolveCharge(book, NISHA, AARAV, "2026-08-24");
  assert.equal(standard.basis, "standard");
  assert.equal(standard.paisePerHour, rupees(3500));
});

test("an override belongs to one person, not to the whole client", () => {
  const book = buildRateBook([rate(), rate({ employeeUserId: RAHUL })], [override()]);
  assert.equal(resolveCharge(book, RAHUL, KOSHI, "2026-08-24").basis, "standard");
});

test("an override that has not started yet is not applied", () => {
  const book = buildRateBook([rate()], [override({ effectiveFrom: "2027-01-01" })]);
  const resolved = resolveCharge(book, NISHA, KOSHI, "2026-08-24");
  assert.equal(resolved.basis, "standard");
  assert.equal(resolved.paisePerHour, rupees(3500));
});

test("internal time has no client, so it can only use the house rate", () => {
  const book = buildRateBook([rate()], [override()]);
  assert.equal(resolveCharge(book, NISHA, null, "2026-08-24").basis, "standard");
});

test("an unrated hour is worth nothing known, not nothing", () => {
  // Zero would report a client as pure profit and a person as free — a worse
  // answer than admitting the rate is missing.
  const book = buildRateBook([], []);
  const resolved = resolveCharge(book, NISHA, AARAV, "2026-08-24");
  assert.equal(resolved.basis, "none");
  assert.equal(resolved.paisePerHour, null);
  assert.equal(valueOf(120, null), null);
});

test("non-billable time is never charged, whatever the rate card says", () => {
  const book = buildRateBook([rate()], []);
  const valued = valueEntry({ billable: false, employeeUserId: NISHA, entryDate: "2026-08-24", legalEntityId: AARAV, minutes: 120 }, book, noPayroll);
  assert.equal(valued.chargePaise, 0);
});

test("non-billable time still costs the firm, which is the point of counting it", () => {
  const book = buildRateBook([rate({ costPaisePerHour: rupees(700) })], []);
  const valued = valueEntry({ billable: false, employeeUserId: NISHA, entryDate: "2026-08-24", legalEntityId: null, minutes: 120 }, book, noPayroll);
  assert.equal(valued.chargePaise, 0);
  assert.equal(valued.costPaise, rupees(1400), "two hours of unbillable effort is two hours of cost");
});

test("minutes are valued proportionally and rounded once", () => {
  assert.equal(valueOf(60, rupees(3500)), rupees(3500));
  assert.equal(valueOf(30, rupees(3500)), rupees(1750));
  assert.equal(valueOf(90, rupees(3500)), rupees(5250));
  // 7 minutes at ₹3,333/hr is not a whole paise; it must round, not truncate.
  assert.equal(valueOf(7, 333_300), Math.round((7 * 333_300) / 60));
});

test("cost per hour comes from what employment costs, over scheduled hours", () => {
  // ₹95,000 salary plus ₹11,400 employer contributions, over 152 scheduled hours.
  const monthlyCost = rupees(95_000) + rupees(11_400);
  const perHour = costPerHourFromPayroll(monthlyCost, 152 * 60);
  assert.equal(perHour, Math.round((monthlyCost * 60) / (152 * 60)));
  assert.equal(perHour, rupees(700));
});

test("a month with no scheduled hours makes nobody free", () => {
  assert.equal(costPerHourFromPayroll(rupees(100_000), 0), null);
  assert.equal(costPerHourFromPayroll(0, 152 * 60), null);
});

test("payroll answers first; the rate card only covers who it cannot", () => {
  const book = buildRateBook([rate({ costPaisePerHour: rupees(2500) })], []);
  const derived = resolveCost(book, () => rupees(700), NISHA, "2026-08-24");
  assert.equal(derived.basis, "payroll");
  assert.equal(derived.paisePerHour, rupees(700), "salary is the truth when there is one");

  const fallback = resolveCost(book, noPayroll, NISHA, "2026-08-24");
  assert.equal(fallback.basis, "rate_card");
  assert.equal(fallback.paisePerHour, rupees(2500));

  const unknown = resolveCost(buildRateBook([rate()], []), noPayroll, NISHA, "2026-08-24");
  assert.equal(unknown.basis, "none");
  assert.equal(unknown.paisePerHour, null);
});

test("a total reports what it could not value rather than absorbing it", () => {
  const book = buildRateBook([rate()], []);
  const total = summariseEffort([
    { billable: true, employeeUserId: NISHA, entryDate: "2026-08-24", legalEntityId: AARAV, minutes: 60 },
    { billable: true, employeeUserId: RAHUL, entryDate: "2026-08-24", legalEntityId: AARAV, minutes: 120 },
  ], book, noPayroll);
  assert.equal(total.chargePaise, rupees(3500), "only the rated hour is valued");
  assert.equal(total.unratedChargeMinutes, 120, "and the unrated two hours are declared");
  assert.equal(total.billableMinutes, 180);
});

test("unrated non-billable time is not counted as an unrated charge", () => {
  const book = buildRateBook([], []);
  const total = summariseEffort([
    { billable: false, employeeUserId: RAHUL, entryDate: "2026-08-24", legalEntityId: null, minutes: 45 },
  ], book, noPayroll);
  assert.equal(total.unratedChargeMinutes, 0, "nothing was going to be charged for it anyway");
  assert.equal(total.unratedCostMinutes, 45);
  assert.equal(total.nonBillableMinutes, 45);
});

test("accumulating one entry at a time matches summarising them together", () => {
  const book = buildRateBook([rate()], [override()]);
  const entries = [
    { billable: true, employeeUserId: NISHA, entryDate: "2026-08-01", legalEntityId: KOSHI, minutes: 90 },
    { billable: true, employeeUserId: NISHA, entryDate: "2026-08-02", legalEntityId: AARAV, minutes: 45 },
    { billable: false, employeeUserId: NISHA, entryDate: "2026-08-03", legalEntityId: null, minutes: 30 },
  ];
  const stepwise = entries.reduce((total, entry) => accumulate(total, entry, valueEntry(entry, book, noPayroll)), emptyEffortValue());
  assert.deepEqual(stepwise, summariseEffort(entries, book, noPayroll));
  assert.equal(stepwise.chargePaise, valueOf(90, rupees(2800))! + valueOf(45, rupees(3500))!);
});

test("margin is basis points, and is unknowable without revenue", () => {
  assert.equal(marginBasisPoints(rupees(10_000), rupees(4_000)), 6000);
  assert.equal(marginBasisPoints(rupees(10_000), rupees(12_000)), -2000, "a loss reads as a loss");
  assert.equal(marginBasisPoints(0, rupees(4_000)), null, "not zero, which would read as breaking even");
  assert.equal(formatBasisPoints(6000), "60.0%");
  assert.equal(formatBasisPoints(null), "—");
});

test("hours are how people speak; minutes stay the unit of record", () => {
  assert.equal(hoursLabel(90), "1.5h");
  assert.equal(hoursLabel(60), "1.0h");
  assert.equal(hoursLabel(0), "0.0h");
});
