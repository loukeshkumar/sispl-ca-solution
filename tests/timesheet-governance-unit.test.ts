import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_POLICY,
  daysBetween,
  isPeriodStatus,
  needsBackdateReason,
  PERIOD_LABELS,
  PERIOD_STATUSES,
  periodKeyOf,
  periodSummary,
  refuseDecision,
  refuseEntry,
  refuseReopen,
  refuseSubmit,
  standingOf,
} from "../lib/timesheets/governance";

const TODAY = "2026-12-20";
const VIKRAM = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const NISHA = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const entry = (over: Partial<Parameters<typeof refuseEntry>[0]> = {}) => refuseEntry({
  actorIsManager: false,
  backdateReason: "",
  entryDate: "2026-12-18",
  periodStatus: "open",
  policy: DEFAULT_POLICY,
  todayKey: TODAY,
  ...over,
});

test("a month is the first seven characters of a date", () => {
  assert.equal(periodKeyOf("2026-12-14"), "2026-12");
  assert.equal(daysBetween("2026-12-18", "2026-12-20"), 2);
  assert.equal(daysBetween("2026-12-22", "2026-12-20"), -2, "a future date is negative");
});

test("time inside the window is recorded by the person who did the work", () => {
  assert.equal(entry(), null);
  assert.equal(entry({ entryDate: TODAY }), null, "today is inside any window");
  assert.equal(entry({ entryDate: "2026-12-06" }), null, "exactly fourteen days");
});

test("time older than the window needs a manager and a reason", () => {
  // Late entry happens. An exception that cannot be recorded is taken anyway
  // and leaves the register looking as though nothing was ever late.
  assert.equal(entry({ entryDate: "2026-12-05" }), "outside_window");
  assert.equal(entry({ actorIsManager: true, entryDate: "2026-12-05" }), "reason_required");
  assert.equal(entry({ actorIsManager: true, backdateReason: "  ", entryDate: "2026-12-05" }), "reason_required");
  assert.equal(entry({ actorIsManager: true, backdateReason: "Reconstructed from the filing log", entryDate: "2026-12-05" }), null);
});

test("the window is the firm's, not a constant", () => {
  const tight = { ...DEFAULT_POLICY, backdateWindowDays: 2 };
  // The window is inclusive: a two-day window reaches back exactly two days.
  assert.equal(entry({ entryDate: "2026-12-18", policy: tight }), null, "two days ago, inside");
  assert.equal(entry({ entryDate: "2026-12-17", policy: tight }), "outside_window", "three days ago, outside");
  const open = { ...DEFAULT_POLICY, backdateWindowDays: 365 };
  assert.equal(entry({ entryDate: "2026-06-01", policy: open }), null);
  // A zero-day window means today only.
  assert.equal(entry({ entryDate: TODAY, policy: { ...DEFAULT_POLICY, backdateWindowDays: 0 } }), null);
  assert.equal(entry({ entryDate: "2026-12-19", policy: { ...DEFAULT_POLICY, backdateWindowDays: 0 } }), "outside_window");
});

test("time for a day that has not happened is refused unless the firm allows it", () => {
  assert.equal(entry({ entryDate: "2026-12-25" }), "future_date");
  assert.equal(entry({ entryDate: "2026-12-25", policy: { ...DEFAULT_POLICY, allowFutureDates: true } }), null);
});

test("an approved month refuses everybody, manager and reason included", () => {
  // The point of approval is that the number stopped moving. Reopening it is a
  // deliberate act with its own record, not something a reason on an entry buys.
  assert.equal(entry({ periodStatus: "approved" }), "period_approved");
  assert.equal(entry({ actorIsManager: true, backdateReason: "A good reason", periodStatus: "approved" }), "period_approved");
});

test("a month with its reviewer is equally closed, and says something different", () => {
  assert.equal(entry({ periodStatus: "submitted" }), "period_submitted");
  assert.equal(entry({ actorIsManager: true, backdateReason: "A good reason", periodStatus: "submitted" }), "period_submitted");
});

test("a date that is not a date is refused before anything else", () => {
  assert.equal(entry({ entryDate: "" }), "invalid_date");
  assert.equal(entry({ entryDate: "last Tuesday" }), "invalid_date");
  assert.equal(entry({ entryDate: "", periodStatus: "approved" }), "invalid_date");
});

test("the form can tell in advance whether a reason will be wanted", () => {
  assert.equal(needsBackdateReason({ entryDate: "2026-12-18", policy: DEFAULT_POLICY, todayKey: TODAY }), false);
  assert.equal(needsBackdateReason({ entryDate: "2026-11-18", policy: DEFAULT_POLICY, todayKey: TODAY }), true);
});

const submit = (over: Partial<Parameters<typeof refuseSubmit>[0]> = {}) => refuseSubmit({
  loggedMinutes: 8400,
  periodKey: "2026-11",
  status: "open",
  todayKey: TODAY,
  ...over,
});

test("a finished month with time in it can be submitted", () => {
  assert.equal(submit(), null);
});

test("a month still running cannot be submitted", () => {
  // Half a month approved is a statement about a period that has not happened,
  // and the entries arriving afterwards would have nowhere to go.
  assert.equal(submit({ periodKey: "2026-12" }), "period_incomplete");
  assert.equal(submit({ periodKey: "2027-01" }), "period_incomplete");
});

test("an empty month has nothing to submit", () => {
  assert.equal(submit({ loggedMinutes: 0 }), "nothing_logged");
});

test("a month cannot be submitted twice, or after approval", () => {
  assert.equal(submit({ status: "submitted" }), "already_submitted");
  assert.equal(submit({ status: "approved" }), "already_approved");
});

const decide = (over: Partial<Parameters<typeof refuseDecision>[0]> = {}) => refuseDecision({
  actorUserId: NISHA,
  employeeUserId: VIKRAM,
  note: "",
  outcome: "approved",
  status: "submitted",
  ...over,
});

test("only a submitted month is decided, and only by somebody else", () => {
  assert.equal(decide(), null);
  assert.equal(decide({ status: "open" }), "not_submitted");
  assert.equal(decide({ status: "approved" }), "not_submitted");
  assert.equal(decide({ outcome: "maybe" }), "unknown_outcome");
});

test("nobody approves their own timesheet", () => {
  // The same person's word twice is not a control.
  assert.equal(decide({ actorUserId: VIKRAM }), "self_approval");
  assert.equal(decide({ actorUserId: VIKRAM, note: "Fine", outcome: "returned" }), "self_approval");
});

test("returning a month requires saying what needs correcting", () => {
  assert.equal(decide({ outcome: "returned" }), "reason_required");
  assert.equal(decide({ note: " ", outcome: "returned" }), "reason_required");
  assert.equal(decide({ note: "3 Dec shows 11 hours on one client", outcome: "returned" }), null);
  assert.equal(decide({ note: "", outcome: "approved" }), null, "approving needs no essay");
});

test("only an approved month is reopened, and only with a reason", () => {
  assert.equal(refuseReopen({ reason: "Client disputed the December bill", status: "approved" }), null);
  assert.equal(refuseReopen({ reason: "", status: "approved" }), "reason_required");
  assert.equal(refuseReopen({ reason: "Because", status: "open" }), "not_approved");
  assert.equal(refuseReopen({ reason: "Because", status: "submitted" }), "not_approved");
});

test("an open month is not frozen; a submitted or approved one is", () => {
  const open = standingOf({ expectedMinutes: null, loggedMinutes: 8400, status: "open", submittedMinutes: null });
  assert.equal(open.frozen, false);
  assert.equal(open.completeness, null, "no expectation, no percentage");
  assert.equal(periodSummary(open), "140h 00m recorded · still open");

  for (const status of ["submitted", "approved"] as const) {
    assert.equal(standingOf({ expectedMinutes: null, loggedMinutes: 1, status, submittedMinutes: 1 }).frozen, true);
  }
});

test("completeness is measured against what the firm expects", () => {
  const standing = standingOf({ expectedMinutes: 10500, loggedMinutes: 8400, status: "approved", submittedMinutes: 8400 });
  assert.equal(standing.completeness, 80);
  assert.equal(periodSummary(standing), "140h 00m approved · 80% of what the firm expects");
});

test("a month that moved after it was submitted says so", () => {
  // The reviewer was shown a figure. A different figure now is worth saying out
  // loud rather than leaving to be noticed.
  const moved = standingOf({ expectedMinutes: null, loggedMinutes: 9000, status: "submitted", submittedMinutes: 8400 });
  assert.equal(moved.changedSinceSubmission, true);
  assert.match(periodSummary(moved), /changed since it was submitted/);

  const steady = standingOf({ expectedMinutes: null, loggedMinutes: 8400, status: "submitted", submittedMinutes: 8400 });
  assert.equal(steady.changedSinceSubmission, false);
  assert.equal(periodSummary(steady), "140h 00m with the reviewer");
});

test("statuses are the listed ones and each reads as English", () => {
  assert.ok(isPeriodStatus("submitted"));
  assert.ok(!isPeriodStatus("locked"));
  for (const status of PERIOD_STATUSES) assert.ok(PERIOD_LABELS[status].length > 0);
});
