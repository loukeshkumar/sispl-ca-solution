import assert from "node:assert/strict";
import test from "node:test";

import { eligibleWorkingDatesInRange } from "../lib/attendance/calculations";
import {
  accrualPostings,
  assessQuota,
  balanceHalfDays,
  cappedLapse,
  carryForwardPostings,
  formatHalfDays,
  HALF_DAYS_PER_DAY,
  leaveYearBounds,
  leaveYearKey,
  leaveYearsInRange,
  previousLeaveYear,
  type LeaveTypePolicy,
} from "../lib/attendance/leave-ledger";
import { validateLeaveTypeFields } from "../lib/attendance-masters/validation";

const MON_TO_SAT = "1111110";

const policy = (over: Partial<LeaveTypePolicy> = {}): LeaveTypePolicy => ({
  accrualMethod: "annual",
  annualQuotaDays: 12,
  carryForwardCap: 0,
  carryForwardExpiryMonths: null,
  code: "casual",
  encashableOnExit: false,
  ...over,
});

const fullYear = { employmentEndDate: null, joiningDate: "2020-01-01" };

test("the leave year runs April to March, the clock the practice already keeps", () => {
  assert.equal(leaveYearKey("2026-04-01"), "2026-27");
  assert.equal(leaveYearKey("2027-03-31"), "2026-27");
  // January belongs to the year that opened the previous April, not its own.
  assert.equal(leaveYearKey("2027-01-15"), "2026-27");
  assert.equal(leaveYearKey("2027-04-01"), "2027-28");
  assert.deepEqual(leaveYearBounds("2026-27"), { from: "2026-04-01", to: "2027-03-31" });
  assert.equal(previousLeaveYear("2026-27"), "2025-26");
});

test("a leave straddling 31 March is two leave years, not one", () => {
  assert.deepEqual(leaveYearsInRange("2027-03-30", "2027-04-02"), ["2026-27", "2027-28"]);
  assert.deepEqual(leaveYearsInRange("2026-06-01", "2026-06-05"), ["2026-27"]);
});

test("a full year of service is granted the whole quota, once", () => {
  const postings = accrualPostings({ leaveYear: "2026-27", policy: policy(), service: fullYear, todayKey: "2027-03-31" });
  assert.equal(postings.length, 1);
  assert.equal(postings[0]!.halfDays, 24);
  assert.equal(postings[0]!.effectiveDate, "2026-04-01");
});

test("an annual grant is pro-rated for someone who joins part way through", () => {
  // Joining 10 September earns September through March: seven months.
  const postings = accrualPostings({
    leaveYear: "2026-27",
    policy: policy(),
    service: { employmentEndDate: null, joiningDate: "2026-09-10" },
    todayKey: "2027-03-31",
  });
  assert.equal(postings.length, 1);
  assert.equal(postings[0]!.halfDays, Math.round((24 * 7) / 12));
  // The entitlement cannot start before the person did.
  assert.equal(postings[0]!.effectiveDate, "2026-09-10");
  assert.match(postings[0]!.reason, /7 of 12 months/);
});

test("an annual grant is the whole year in April, not a slice of the year so far", () => {
  // Mid-August of a year that started in April. "Granted all at once" has to
  // mean all of it — pro-rating by elapsed months would silently turn every
  // annual type into a monthly one.
  const postings = accrualPostings({ leaveYear: "2026-27", policy: policy(), service: fullYear, todayKey: "2026-08-24" });
  assert.equal(postings.length, 1);
  assert.equal(postings[0]!.halfDays, 24, "twelve days, not the four months elapsed");
});

test("an annual grant is withheld until the leave year has actually opened", () => {
  assert.deepEqual(accrualPostings({ leaveYear: "2027-28", policy: policy(), service: fullYear, todayKey: "2027-03-31" }), []);
  assert.equal(accrualPostings({ leaveYear: "2027-28", policy: policy(), service: fullYear, todayKey: "2027-04-01" }).length, 1);
});

test("someone leaving part way through the year earns only the months they served", () => {
  const postings = accrualPostings({
    leaveYear: "2026-27", policy: policy(),
    service: { employmentEndDate: "2026-09-30", joiningDate: "2020-01-01" }, todayKey: "2026-08-24",
  });
  // April to September is six months, whatever the calendar says today.
  assert.equal(postings[0]!.halfDays, Math.round((24 * 6) / 12));
});

test("joining after the middle of a month does not earn that month", () => {
  const late = accrualPostings({
    leaveYear: "2026-27", policy: policy(),
    service: { employmentEndDate: null, joiningDate: "2026-09-20" }, todayKey: "2027-03-31",
  });
  const early = accrualPostings({
    leaveYear: "2026-27", policy: policy(),
    service: { employmentEndDate: null, joiningDate: "2026-09-02" }, todayKey: "2027-03-31",
  });
  assert.ok(late[0]!.halfDays < early[0]!.halfDays, "a late joiner earns less than an early one");
});

test("monthly accrual credits only months that have finished", () => {
  const postings = accrualPostings({
    leaveYear: "2026-27", policy: policy({ accrualMethod: "monthly" }), service: fullYear, todayKey: "2026-08-15",
  });
  // April, May, June and July have ended; August is still running.
  assert.equal(postings.length, 4);
  assert.deepEqual(postings.map((posting) => posting.effectiveDate), ["2026-04-30", "2026-05-31", "2026-06-30", "2026-07-31"]);
});

test("twelve monthly credits sum to exactly the annual quota, however badly it divides", () => {
  for (const quota of [12, 15, 7, 1, 22]) {
    const postings = accrualPostings({
      leaveYear: "2026-27", policy: policy({ accrualMethod: "monthly", annualQuotaDays: quota }),
      service: fullYear, todayKey: "2027-03-31",
    });
    assert.equal(
      balanceHalfDays(postings),
      quota * HALF_DAYS_PER_DAY,
      `${quota} days must accrue to exactly ${quota} days, not ${balanceHalfDays(postings) / 2}`,
    );
  }
});

test("a quota of zero means the firm does not cap the type, so nothing is granted", () => {
  assert.deepEqual(accrualPostings({ leaveYear: "2026-27", policy: policy({ annualQuotaDays: 0 }), service: fullYear, todayKey: "2027-03-31" }), []);
  assert.deepEqual(accrualPostings({ leaveYear: "2026-27", policy: policy({ accrualMethod: "none" }), service: fullYear, todayKey: "2027-03-31" }), []);
});

test("entitlement is never granted for a year the employee had not joined", () => {
  const postings = accrualPostings({
    leaveYear: "2026-27", policy: policy(),
    service: { employmentEndDate: null, joiningDate: "2028-01-01" }, todayKey: "2027-03-31",
  });
  assert.deepEqual(postings, []);
});

test("carry-forward is capped, and nothing carries when the firm allows none", () => {
  const carried = carryForwardPostings({
    closingHalfDays: 20, leaveYear: "2027-28", policy: policy({ carryForwardCap: 5 }), todayKey: "2027-04-01",
  });
  assert.equal(carried.length, 1);
  assert.equal(carried[0]!.halfDays, 10, "five days is ten half-days, whatever was left");
  assert.equal(carried[0]!.effectiveDate, "2027-04-01");

  assert.deepEqual(carryForwardPostings({ closingHalfDays: 20, leaveYear: "2027-28", policy: policy(), todayKey: "2027-04-01" }), []);
});

test("carried days lapse once the window closes, and not before", () => {
  const withExpiry = policy({ carryForwardCap: 5, carryForwardExpiryMonths: 3 });
  const early = carryForwardPostings({ closingHalfDays: 20, leaveYear: "2027-28", policy: withExpiry, todayKey: "2027-06-30" });
  assert.deepEqual(early.map((posting) => posting.entryType), ["carry_forward"], "June is still inside the window");

  const late = carryForwardPostings({ closingHalfDays: 20, leaveYear: "2027-28", policy: withExpiry, todayKey: "2027-07-05" });
  assert.deepEqual(late.map((posting) => posting.entryType), ["carry_forward", "lapse"]);
  assert.equal(late[1]!.halfDays, -10);
  assert.equal(late[1]!.effectiveDate, "2027-07-01");
});

test("a lapse cannot drive an employee negative for days they already spent", () => {
  const lapse = { dedupeKey: "x", effectiveDate: "2027-07-01", entryType: "lapse" as const, halfDays: -10, leaveYear: "2027-28", reason: "" };
  // Ten carried half-days, but only four are left — the rest were taken.
  assert.equal(cappedLapse(lapse, 4)!.halfDays, -4);
  // Nothing left at all: there is nothing to lapse, so no posting is made.
  assert.equal(cappedLapse(lapse, 0), null);
  assert.equal(cappedLapse(lapse, -6), null);
});

test("a weekend inside a leave range is not charged to the employee", () => {
  // Friday 11 September 2026 to Monday 14 September, on a Monday-to-Saturday week.
  const dates = eligibleWorkingDatesInRange("2026-09-11", "2026-09-14", MON_TO_SAT, "2020-01-01", null);
  assert.deepEqual(dates, ["2026-09-11", "2026-09-12", "2026-09-14"], "Sunday is not the firm's to charge for");
});

test("a declared holiday inside a leave range is not charged either", () => {
  const dates = eligibleWorkingDatesInRange("2026-09-11", "2026-09-14", MON_TO_SAT, "2020-01-01", null, ["2026-09-12"]);
  assert.deepEqual(dates, ["2026-09-11", "2026-09-14"]);
});

test("days before joining or after leaving are outside the range that counts", () => {
  const dates = eligibleWorkingDatesInRange("2026-09-07", "2026-09-11", MON_TO_SAT, "2026-09-09", "2026-09-10");
  assert.deepEqual(dates, ["2026-09-09", "2026-09-10"]);
});

test("a request inside the balance is allowed; one beyond it reports the shortfall", () => {
  const within = assessQuota({
    balances: [{ halfDays: 8, leaveYear: "2026-27" }],
    consumption: [{ halfDays: 6, leaveYear: "2026-27" }],
    policy: { annualQuotaDays: 12 },
  });
  assert.equal(within.withinBalance, true);
  assert.equal(within.exceedsByHalfDays, 0);

  const beyond = assessQuota({
    balances: [{ halfDays: 6, leaveYear: "2026-27" }],
    consumption: [{ halfDays: 8, leaveYear: "2026-27" }],
    policy: { annualQuotaDays: 12 },
  });
  assert.equal(beyond.withinBalance, false);
  assert.equal(beyond.exceedsByHalfDays, 2, "one day short, reported in half-days");
});

test("an uncapped leave type is never refused", () => {
  const verdict = assessQuota({
    balances: [{ halfDays: 0, leaveYear: "2026-27" }],
    consumption: [{ halfDays: 40, leaveYear: "2026-27" }],
    policy: { annualQuotaDays: 0 },
  });
  assert.equal(verdict.uncapped, true);
  assert.equal(verdict.withinBalance, true, "a quota of zero means no limit, not an entitlement of nothing");
});

test("a leave straddling the year end cannot borrow next year's entitlement", () => {
  // Two days this year against a balance of nothing, two next year against plenty.
  const verdict = assessQuota({
    balances: [{ halfDays: 0, leaveYear: "2026-27" }, { halfDays: 20, leaveYear: "2027-28" }],
    consumption: [{ halfDays: 4, leaveYear: "2026-27" }, { halfDays: 4, leaveYear: "2027-28" }],
    policy: { annualQuotaDays: 12 },
  });
  assert.equal(verdict.withinBalance, false);
  assert.equal(verdict.exceedsByHalfDays, 4, "only the year that is short counts against the request");
});

test("an already-negative balance offers nothing to draw on", () => {
  const verdict = assessQuota({
    balances: [{ halfDays: -4, leaveYear: "2026-27" }],
    consumption: [{ halfDays: 2, leaveYear: "2026-27" }],
    policy: { annualQuotaDays: 12 },
  });
  assert.equal(verdict.exceedsByHalfDays, 2, "a debt is not a balance to spend from");
});

test("balances read back as the days people actually talk in", () => {
  assert.equal(formatHalfDays(24), "12 days");
  assert.equal(formatHalfDays(1), "0.5 days");
  assert.equal(formatHalfDays(2), "1 day");
  assert.equal(formatHalfDays(-3), "-1.5 days");
});

test("a carry-forward expiry with no carry-forward to expire is refused", () => {
  const rejected = validateLeaveTypeFields({
    code: "casual", name: "Casual leave", annualQuotaDays: "12",
    accrualMethod: "annual", carryForwardCap: "0", carryForwardExpiryMonths: "3", displayOrder: "10", status: "active",
  });
  assert.equal(rejected.success, false);
  assert.ok(rejected.success === false && rejected.fieldErrors.carryForwardExpiryMonths);

  const accepted = validateLeaveTypeFields({
    code: "casual", name: "Casual leave", annualQuotaDays: "12",
    accrualMethod: "monthly", carryForwardCap: "5", carryForwardExpiryMonths: "3", displayOrder: "10", status: "active",
  });
  assert.equal(accepted.success, true);
  assert.ok(accepted.success === true && accepted.data.accrualMethod === "monthly");
  assert.ok(accepted.success === true && accepted.data.carryForwardExpiryMonths === 3);
});

test("a blank expiry means carried days never lapse, which is a valid choice", () => {
  const result = validateLeaveTypeFields({
    code: "earned", name: "Earned leave", annualQuotaDays: "15",
    accrualMethod: "monthly", carryForwardCap: "30", carryForwardExpiryMonths: "", displayOrder: "20", status: "active",
  });
  assert.equal(result.success, true);
  assert.ok(result.success === true && result.data.carryForwardExpiryMonths === null);
});
