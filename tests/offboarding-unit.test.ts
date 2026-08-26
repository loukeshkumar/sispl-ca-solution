import assert from "node:assert/strict";
import test from "node:test";

import {
  blockingItems,
  buildClearance,
  defaultProbationEnd,
  EMPLOYMENT_STAGES,
  isEmploymentStage,
  probationOverdue,
  STAGE_LABELS,
  type ClearanceInput,
} from "../lib/team/offboarding";

const nothing: ClearanceInput = {
  dscInCustody: 0,
  leaveToEncashHalfDays: 0,
  openOfficeTasksAssigned: 0,
  openOfficeTasksReviewing: 0,
  openWorkAssigned: 0,
  openWorkReviewing: 0,
  reportees: 0,
  soleReviewerServices: [],
};

test("a clean exit needs no clearance and no explanation", () => {
  const clearance = buildClearance(nothing);
  assert.equal(clearance.clear, true);
  assert.equal(clearance.needsReason, false);
  assert.deepEqual(clearance.items, []);
});

test("a signing token in somebody's custody stops the exit outright", () => {
  // A token whose custodian cannot log in is a token nobody is accountable for.
  const clearance = buildClearance({ ...nothing, dscInCustody: 2 });
  assert.equal(blockingItems(clearance).length, 1);
  assert.equal(clearance.items[0]!.severity, "blocking");
  assert.match(clearance.items[0]!.title, /2 digital signatures/);
  assert.match(clearance.items[0]!.action, /return or reassign/);
});

test("open delivery stops the exit, whether they were doing it or reviewing it", () => {
  const assigned = buildClearance({ ...nothing, openWorkAssigned: 3 });
  assert.equal(blockingItems(assigned).length, 1);
  assert.match(assigned.items[0]!.title, /3 open obligations assigned/);

  const reviewing = buildClearance({ ...nothing, openWorkReviewing: 1 });
  assert.equal(blockingItems(reviewing).length, 1);
  assert.match(reviewing.items[0]!.title, /1 obligation waiting on their review/);
});

test("a blocking item makes the reason field pointless, so it is not asked for", () => {
  // There is nothing to explain while the exit cannot proceed at all.
  const clearance = buildClearance({ ...nothing, dscInCustody: 1, reportees: 2 });
  assert.equal(clearance.needsReason, false);
  assert.equal(blockingItems(clearance).length, 1);
});

test("softer items let the exit proceed, but only with a reason on the record", () => {
  const clearance = buildClearance({ ...nothing, reportees: 2, soleReviewerServices: ["Audit and assurance"] });
  assert.equal(blockingItems(clearance).length, 0);
  assert.equal(clearance.needsReason, true);
  assert.equal(clearance.clear, false);
});

test("being the only reviewer for a service is named, with the service", () => {
  const clearance = buildClearance({ ...nothing, soleReviewerServices: ["Bookkeeping", "ROC compliance"] });
  const item = clearance.items.find((entry) => entry.id === "sole-reviewer");
  assert.ok(item);
  assert.match(item.title, /Only person who can review 2 services/);
  assert.match(item.detail, /Bookkeeping, ROC compliance/);
});

test("leave to encash is information, not an obstacle", () => {
  // Holding a departed employee's login hostage to a payroll argument helps
  // nobody, so the ledger records it and the exit proceeds.
  const clearance = buildClearance({ ...nothing, leaveToEncashHalfDays: 9 });
  assert.equal(blockingItems(clearance).length, 0);
  assert.equal(clearance.needsReason, false, "a note alone does not demand an explanation");
  assert.match(clearance.items[0]!.detail, /4\.5 days/);
});

test("the clearance leads with what stops the exit", () => {
  const clearance = buildClearance({
    ...nothing, dscInCustody: 1, leaveToEncashHalfDays: 4, openWorkAssigned: 2, reportees: 1,
  });
  assert.equal(clearance.items[0]!.severity, "blocking");
  assert.equal(clearance.items.at(-1)!.severity, "note");
  const severities = clearance.items.map((item) => item.severity);
  assert.deepEqual([...severities].sort((left, right) => {
    const rank = { blocking: 0, warning: 1, note: 2 } as const;
    return rank[left] - rank[right];
  }), severities, "already ordered by what matters first");
});

test("counts read as English, singular and plural", () => {
  assert.match(buildClearance({ ...nothing, reportees: 1 }).items[0]!.title, /1 person reports to them/);
  assert.match(buildClearance({ ...nothing, reportees: 3 }).items[0]!.title, /3 people report to them/);
});

test("probation that ran out without a decision is flagged, not left to drift", () => {
  assert.equal(probationOverdue("probation", "2026-08-01", "2026-08-24"), true);
  assert.equal(probationOverdue("probation", "2026-09-01", "2026-08-24"), false);
  // Somebody already confirmed is not overdue, whatever the old date says.
  assert.equal(probationOverdue("confirmed", "2026-08-01", "2026-08-24"), false);
  assert.equal(probationOverdue("probation", null, "2026-08-24"), false);
});

test("probation defaults to six months from joining and clamps a short month", () => {
  assert.equal(defaultProbationEnd("2026-02-17"), "2026-08-17");
  assert.equal(defaultProbationEnd("2026-08-31"), "2027-03-03", "31 February rolls forward rather than throwing");
});

test("only the four stages are stages, and each reads as English", () => {
  assert.ok(isEmploymentStage("probation"));
  assert.ok(!isEmploymentStage("intern"));
  for (const stage of EMPLOYMENT_STAGES) assert.ok(STAGE_LABELS[stage].length > 0);
});
