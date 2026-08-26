import assert from "node:assert/strict";
import test from "node:test";

import { buildRecurringWorkDrafts, periodLabel, type ComplianceScheduleRule, type EntitledService } from "../lib/compliance/recurrence";

const TODAY = "2026-08-17";
const ENTITY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const gstMonthly: ComplianceScheduleRule = { serviceCode: "GST", frequency: "monthly", dueMonthOffset: 1, dueDay: 20, internalLeadDays: 3 };
const tdsQuarterly: ComplianceScheduleRule = { serviceCode: "TDS", frequency: "quarterly", dueMonthOffset: 1, dueDay: 31, internalLeadDays: 3 };
const auditAnnual: ComplianceScheduleRule = { serviceCode: "AUDIT", frequency: "annual", dueMonthOffset: 6, dueDay: 30, internalLeadDays: 3 };

const entitled = (serviceCode: string, legalEntityId = ENTITY): EntitledService => ({ legalEntityId, serviceCode });

test("period labels follow the workspace display conventions", () => {
  assert.equal(periodLabel("monthly", { year: 2026, month: 7 }), "July 2026");
  assert.equal(periodLabel("quarterly", { year: 2026, month: 6 }), "Q1 · FY 26–27");
  assert.equal(periodLabel("quarterly", { year: 2027, month: 3 }), "Q4 · FY 26–27");
  assert.equal(periodLabel("annual", { year: 2026, month: 3 }), "FY 2025–26");
});

test("a monthly schedule generates the periods whose statutory due dates fall inside the lookahead window", () => {
  const drafts = buildRecurringWorkDrafts({ schedules: [gstMonthly], entitlements: [entitled("GST")], todayKey: TODAY });
  assert.deepEqual(drafts.map((draft) => [draft.periodKey, draft.statutoryDueDate, draft.internalDueDate]), [
    ["July 2026", "2026-08-20", "2026-08-17"],
    ["August 2026", "2026-09-20", "2026-09-17"],
  ]);
  assert.equal(drafts[0].serviceKey, "GST");
  // Not `waiting`: generated work waits on nothing that has been recorded, and
  // `waiting` now means at least one named, chaseable thing is outstanding.
  assert.equal(drafts[0].status, "at_risk");
  assert.ok(drafts[0].blockerNote.length >= 3);
});

test("periods already past due or beyond the window are not generated", () => {
  const drafts = buildRecurringWorkDrafts({ schedules: [tdsQuarterly], entitlements: [entitled("TDS")], todayKey: TODAY });
  assert.equal(drafts.length, 0);
});

test("annual schedules anchor to the Indian financial year end", () => {
  const drafts = buildRecurringWorkDrafts({ schedules: [auditAnnual], entitlements: [entitled("AUDIT")], todayKey: TODAY });
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].periodKey, "FY 2025–26");
  assert.equal(drafts[0].statutoryDueDate, "2026-09-30");
});

test("due days are clamped to the length of the due month", () => {
  const januaryRule: ComplianceScheduleRule = { serviceCode: "BOOKS", frequency: "monthly", dueMonthOffset: 1, dueDay: 31, internalLeadDays: 0 };
  const drafts = buildRecurringWorkDrafts({ schedules: [januaryRule], entitlements: [entitled("BOOKS")], todayKey: "2027-02-10", lookaheadDays: 20 });
  const january = drafts.find((draft) => draft.periodKey === "January 2027");
  assert.ok(january);
  assert.equal(january.statutoryDueDate, "2027-02-28");
});

test("entitlement matching is case-insensitive and services without entitlement generate nothing", () => {
  const drafts = buildRecurringWorkDrafts({
    schedules: [gstMonthly, auditAnnual],
    entitlements: [entitled("gst")],
    todayKey: TODAY,
  });
  assert.ok(drafts.length > 0);
  assert.ok(drafts.every((draft) => draft.serviceKey === "GST"));
});

test("duplicate entitlements for the same entity produce one draft per period", () => {
  const drafts = buildRecurringWorkDrafts({
    schedules: [gstMonthly],
    entitlements: [entitled("GST"), entitled("GST")],
    todayKey: TODAY,
  });
  assert.equal(new Set(drafts.map((draft) => `${draft.legalEntityId}:${draft.periodKey}`)).size, drafts.length);
  assert.equal(drafts.length, 2);
});
