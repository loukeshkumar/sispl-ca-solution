import assert from "node:assert/strict";
import test from "node:test";

import {
  addDays,
  addMonths,
  alertsFor,
  ARTICLESHIP_STATUSES,
  computeTerm,
  COMPLETION_NOTICE_DAYS,
  daysBetween,
  fractionLabel,
  isArticleshipStatus,
  STATUS_LABELS,
  termLabel,
  type ArticleshipInput,
} from "../lib/articleship/register";

const SIXTH = { denominator: 6, numerator: 1 };

const training = (over: Partial<ArticleshipInput> = {}): ArticleshipInput => ({
  commencedOn: "2025-02-17",
  endedOn: null,
  leaveDaysTaken: 0,
  leaveFraction: SIXTH,
  status: "active",
  todayKey: "2026-08-24",
  trainingMonths: 24,
  ...over,
});

test("a term runs whole months from commencement", () => {
  assert.equal(addMonths("2025-02-17", 24), "2027-02-17");
  assert.equal(addMonths("2025-02-17", 36), "2028-02-17");
});

test("a month that has no such day ends on its own last day rather than rolling", () => {
  // Six months from 31 August is the end of February, not the 3rd of March.
  assert.equal(addMonths("2026-08-31", 6), "2027-02-28");
  assert.equal(addMonths("2024-08-31", 6), "2025-02-28");
  assert.equal(addMonths("2026-01-31", 1), "2026-02-28");
});

test("a training period is counted inclusively, the way it is served", () => {
  assert.equal(daysBetween("2026-08-01", "2026-08-01"), 1, "the first day is a day served");
  assert.equal(daysBetween("2026-08-01", "2026-08-31"), 31);
  assert.equal(daysBetween("2026-08-31", "2026-08-01"), 0, "a range that runs backwards is no range");
});

test("with no leave taken, the term ends exactly when it was scheduled to", () => {
  const term = computeTerm(training());
  assert.equal(term.scheduledCompletionOn, "2027-02-17");
  assert.equal(term.expectedCompletionOn, "2027-02-17");
  assert.equal(term.excessLeaveDays, 0);
  assert.equal(term.leaveTakenDays, 0);
});

test("leave is earned against the period actually served, not the calendar", () => {
  // 554 days elapsed, 30 of them on leave, so 524 served and a sixth of that
  // earned. A day of leave both fails to earn entitlement and consumes it.
  const term = computeTerm(training({ leaveDaysTaken: 30 }));
  assert.equal(term.elapsedDays, daysBetween("2025-02-17", "2026-08-24"));
  assert.equal(term.servedDays, term.elapsedDays - 30);
  assert.equal(term.leaveEntitlementDays, Math.floor(term.servedDays / 6));
  assert.equal(term.excessLeaveDays, 0, "well within a sixth");
});

test("leave beyond entitlement extends the term by exactly the excess", () => {
  // Far more leave than a sixth of the service can earn.
  const term = computeTerm(training({ leaveDaysTaken: 200 }));
  assert.ok(term.excessLeaveDays > 0, "200 days is beyond any sixth of this period");
  assert.equal(term.excessLeaveDays, 200 - term.leaveEntitlementDays);
  assert.equal(term.expectedCompletionOn, addDays(term.scheduledCompletionOn, term.excessLeaveDays));
  assert.ok(term.expectedCompletionOn > term.scheduledCompletionOn);
});

test("the leave fraction is the firm's, not the module's", () => {
  const generous = computeTerm(training({ leaveDaysTaken: 120, leaveFraction: { denominator: 4, numerator: 1 } }));
  const strict = computeTerm(training({ leaveDaysTaken: 120, leaveFraction: { denominator: 12, numerator: 1 } }));
  assert.ok(generous.leaveEntitlementDays > strict.leaveEntitlementDays);
  assert.ok(generous.excessLeaveDays < strict.excessLeaveDays, "a stricter fraction extends the term further");
});

test("leave cannot exceed the days that have elapsed", () => {
  // A miscounted register must not produce negative service.
  const term = computeTerm(training({ leaveDaysTaken: 100_000 }));
  assert.equal(term.leaveTakenDays, term.elapsedDays);
  assert.equal(term.servedDays, 0);
  assert.equal(term.leaveEntitlementDays, 0);
});

test("elapsed time stops at the scheduled end, not at today", () => {
  // Somebody whose term ended last year has not been serving since.
  const term = computeTerm(training({ commencedOn: "2020-04-01", todayKey: "2026-08-24" }));
  assert.equal(term.scheduledCompletionOn, "2022-04-01");
  assert.equal(term.elapsedDays, daysBetween("2020-04-01", "2022-04-01"));
});

test("a registration that has ended is measured to its end date", () => {
  const term = computeTerm(training({ endedOn: "2026-03-31", status: "completed" }));
  assert.equal(term.elapsedDays, daysBetween("2025-02-17", "2026-03-31"));
  assert.equal(term.remainingDays, null, "nothing remains of a finished articleship");
});

test("remaining days count down and stop at zero", () => {
  const soon = computeTerm(training({ commencedOn: "2024-09-01", todayKey: "2026-08-24" }));
  assert.equal(soon.scheduledCompletionOn, "2026-09-01");
  assert.equal(soon.remainingDays, 8);

  const past = computeTerm(training({ commencedOn: "2020-01-01", todayKey: "2026-08-24" }));
  assert.equal(past.remainingDays, 0, "an overrun is zero remaining, never negative");
});

test("missing registration paperwork is the first thing raised", () => {
  const term = computeTerm(training());
  const alerts = alertsFor({ form103Date: null, status: "active", term });
  assert.equal(alerts[0], "forms_missing");
  assert.deepEqual(alertsFor({ form103Date: "2025-03-01", status: "active", term }), []);
});

test("excess leave and an approaching completion are both raised", () => {
  const overLeave = computeTerm(training({ leaveDaysTaken: 300 }));
  assert.ok(alertsFor({ form103Date: "2025-03-01", status: "active", term: overLeave }).includes("leave_exceeded"));

  const nearlyDone = computeTerm(training({ commencedOn: "2024-09-30", todayKey: "2026-08-24" }));
  assert.ok(nearlyDone.remainingDays !== null && nearlyDone.remainingDays <= COMPLETION_NOTICE_DAYS);
  assert.ok(alertsFor({ form103Date: "2024-10-01", status: "active", term: nearlyDone }).includes("completing_soon"));

  const overdue = computeTerm(training({ commencedOn: "2019-01-01", todayKey: "2026-08-24" }));
  assert.ok(alertsFor({ form103Date: "2019-02-01", status: "active", term: overdue }).includes("overdue_completion"));
});

test("a finished registration raises nothing, whatever its history", () => {
  const term = computeTerm(training({ endedOn: "2026-01-01", leaveDaysTaken: 400, status: "terminated" }));
  assert.deepEqual(alertsFor({ form103Date: null, status: "terminated", term }), []);
});

test("terms and fractions read the way people say them", () => {
  assert.equal(termLabel(24), "2 years");
  assert.equal(termLabel(36), "3 years");
  assert.equal(termLabel(18), "1y 6m");
  assert.equal(termLabel(1), "1 month");
  assert.equal(fractionLabel(SIXTH), "1/6");
});

test("only the four statuses are statuses, and each reads as English", () => {
  assert.ok(isArticleshipStatus("completed"));
  assert.ok(!isArticleshipStatus("paused"));
  for (const status of ARTICLESHIP_STATUSES) assert.ok(STATUS_LABELS[status].length > 0);
});
