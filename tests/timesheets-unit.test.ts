import assert from "node:assert/strict";
import test from "node:test";

import { formatMinutes, parseDurationToMinutes, validateTimeEntryFields } from "../lib/timesheets/validation";
import { buildEngagementEffort, monthBounds, summariseEntries, type TimeEntryRow } from "../lib/timesheets/repository";

const ENTITY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ME = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const COLLEAGUE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const OTHER_ENTITY = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const entry = (overrides: Partial<TimeEntryRow>): TimeEntryRow => ({
  id: "1", entryDate: "2026-08-17", minutes: 60, employeeName: "Me", employeeUserId: ME,
  legalEntityId: ENTITY, clientName: "Aurora Textiles", workLabel: null, taskTitle: null,
  billable: true, narration: "Work",
  chargeBasis: "standard", chargePaise: 0, costPaise: 0,
  ...overrides,
});

test("durations accept clock and minute forms and reject out-of-range values", () => {
  assert.equal(parseDurationToMinutes("1:30"), 90);
  assert.equal(parseDurationToMinutes("0:45"), 45);
  assert.equal(parseDurationToMinutes("90"), 90);
  assert.equal(parseDurationToMinutes("24:00"), 1440);
  assert.equal(parseDurationToMinutes("0:00"), null);
  assert.equal(parseDurationToMinutes("25:00"), null);
  assert.equal(parseDurationToMinutes("1:60"), null);
  assert.equal(parseDurationToMinutes("ninety"), null);
  assert.equal(parseDurationToMinutes(""), null);
});

test("minutes format as hours and minutes", () => {
  assert.equal(formatMinutes(90), "1h 30m");
  assert.equal(formatMinutes(5), "0h 05m");
  assert.equal(formatMinutes(600), "10h 00m");
});

test("billable time must name a client, internal time need not", () => {
  const billableWithoutClient = validateTimeEntryFields({ entryDate: "2026-08-17", duration: "1:00", narration: "Reviewed filings", billable: "on" });
  assert.ok(!billableWithoutClient.success);
  assert.ok(billableWithoutClient.fieldErrors.legalEntityId);

  const internal = validateTimeEntryFields({ entryDate: "2026-08-17", duration: "45", narration: "Internal training" });
  assert.ok(internal.success);
  assert.equal(internal.data.billable, false);
  assert.equal(internal.data.legalEntityId, null);
  assert.equal(internal.data.minutes, 45);

  const billable = validateTimeEntryFields({ entryDate: "2026-08-17", duration: "2:15", narration: "GST reconciliation", billable: "on", legalEntityId: ENTITY });
  assert.ok(billable.success);
  assert.equal(billable.data.minutes, 135);
  assert.equal(billable.data.billable, true);
});

test("time entry validation rejects bad dates, durations, and narrations", () => {
  assert.ok(!validateTimeEntryFields({ entryDate: "17-08-2026", duration: "1:00", narration: "Work" }).success);
  assert.ok(!validateTimeEntryFields({ entryDate: "2026-08-17", duration: "0", narration: "Work" }).success);
  assert.ok(!validateTimeEntryFields({ entryDate: "2026-08-17", duration: "1:00", narration: "x" }).success);
});

test("summaries separate own time from firm time and count billable minutes", () => {
  const metrics = summariseEntries([
    entry({ id: "1", minutes: 120, billable: true }),
    entry({ id: "2", minutes: 60, billable: false, clientName: null }),
    entry({ id: "3", minutes: 90, billable: true, employeeUserId: COLLEAGUE, employeeName: "Colleague" }),
  ], ME);
  assert.equal(metrics.ownMinutes, 180);
  assert.equal(metrics.ownBillableMinutes, 120);
  assert.equal(metrics.firmMinutes, 270);
  assert.equal(metrics.firmBillableMinutes, 210);
  assert.equal(metrics.entryCount, 3);
});

test("engagement effort groups by client, splits billable, and ignores internal time", () => {
  const engagements = buildEngagementEffort([
    entry({ id: "1", minutes: 120, billable: true }),
    entry({ id: "2", minutes: 30, billable: false }),
    entry({ id: "3", minutes: 200, billable: true, clientName: "Koshi Infra", legalEntityId: OTHER_ENTITY }),
    // Internal time belongs to no client, so it belongs in no engagement.
    entry({ id: "4", minutes: 60, billable: false, clientName: null, legalEntityId: null }),
  ]);
  assert.equal(engagements.length, 2);
  assert.equal(engagements[0].clientName, "Koshi Infra");
  assert.equal(engagements[0].billableMinutes, 200);
  const aurora = engagements.find((row) => row.clientName === "Aurora Textiles");
  assert.equal(aurora?.billableMinutes, 120);
  assert.equal(aurora?.nonBillableMinutes, 30);
});

test("a client with any uncosted effort reports no margin at all", () => {
  // A missing cost counted as zero reports the shortfall as profit, which is the
  // most flattering possible way to be wrong.
  const engagements = buildEngagementEffort([
    entry({ id: "1", minutes: 60, chargePaise: 350_000, costPaise: 70_000 }),
    entry({ id: "2", minutes: 60, chargePaise: 350_000, costPaise: null }),
  ]);
  assert.equal(engagements[0].marginBps, null);
  assert.equal(engagements[0].unratedCostMinutes, 60);
});

test("a fully costed client reports a real margin", () => {
  const engagements = buildEngagementEffort([
    entry({ id: "1", minutes: 60, chargePaise: 350_000, costPaise: 70_000 }),
    entry({ id: "2", minutes: 60, chargePaise: 350_000, costPaise: 70_000 }),
  ]);
  assert.equal(engagements[0].unratedCostMinutes, 0);
  assert.equal(engagements[0].marginBps, 8000, "700,000 charged against 140,000 of cost");
});

test("billable time with no charge rate is reported, not absorbed", () => {
  const engagements = buildEngagementEffort([
    entry({ id: "1", minutes: 120, billable: true, chargePaise: null, costPaise: 0 }),
    entry({ id: "2", minutes: 60, billable: true, chargePaise: 350_000, costPaise: 0 }),
  ]);
  assert.equal(engagements[0].chargePaise, 350_000, "only the rated hour is valued");
  assert.equal(engagements[0].unratedChargeMinutes, 120);
});

test("two clients sharing a name stay two engagements", () => {
  // Grouped by the client's id, because a display name is not an identity and a
  // negotiated rate is looked up by id.
  const engagements = buildEngagementEffort([
    entry({ id: "1", minutes: 60, legalEntityId: ENTITY, clientName: "Sharma & Co" }),
    entry({ id: "2", minutes: 90, legalEntityId: OTHER_ENTITY, clientName: "Sharma & Co" }),
  ]);
  assert.equal(engagements.length, 2);
});

test("month bounds cover the whole calendar month including leap February", () => {
  assert.deepEqual(monthBounds("2026-08"), { start: "2026-08-01", end: "2026-08-31" });
  assert.deepEqual(monthBounds("2026-02"), { start: "2026-02-01", end: "2026-02-28" });
  assert.deepEqual(monthBounds("2028-02"), { start: "2028-02-01", end: "2028-02-29" });
});
