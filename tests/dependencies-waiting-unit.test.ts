import assert from "node:assert/strict";
import test from "node:test";

import {
  clearedNotice,
  DEPENDENCY_KINDS,
  isDependencyKind,
  KIND_CLEARS,
  KIND_LABELS,
  reaches,
  refuseRaise,
  refuseWaiting,
  standingOf,
  waitingSummary,
  type Dependency,
} from "../lib/dependencies/waiting";

const TODAY = "2026-12-08";

const dependency = (over: Partial<Dependency> = {}): Dependency => ({
  clearedAt: null,
  expectedOn: "2026-12-12",
  id: "d1",
  kind: "client_request",
  title: "Bank statement — Nov 2026",
  ...over,
});

test("work that never waited on anything is not 'unblocked'", () => {
  // Telling an assignee their work is no longer waiting, when it never was,
  // is exactly the noise that teaches people to ignore notifications.
  const standing = standingOf([], TODAY);
  assert.equal(standing.settled, false);
  assert.equal(standing.open.length, 0);
  assert.equal(standing.nextExpectedOn, null);
  assert.equal(waitingSummary(standing, (key) => key), "No dependencies recorded");
});

test("a wait that has ended is settled; one still running is not", () => {
  const ended = standingOf([dependency({ clearedAt: "2026-12-06T04:00:00Z" })], TODAY);
  assert.equal(ended.settled, true);
  assert.equal(ended.cleared, 1);
  assert.equal(waitingSummary(ended, (key) => key), "Nothing outstanding");

  const running = standingOf([dependency({ clearedAt: "2026-12-06T04:00:00Z" }), dependency({ id: "d2" })], TODAY);
  assert.equal(running.settled, false, "one still open means the wait has not ended");
});

test("open dependencies come back soonest first, so the chase list is in order", () => {
  const standing = standingOf([
    dependency({ expectedOn: "2026-12-15", id: "late", title: "Valuation report" }),
    dependency({ expectedOn: "2026-12-10", id: "soon", title: "TDS return" }),
    dependency({ clearedAt: "2026-12-01T00:00:00Z", expectedOn: "2026-12-02", id: "done" }),
  ], TODAY);
  assert.deepEqual(standing.open.map((entry) => entry.id), ["soon", "late"]);
  assert.equal(standing.nextExpectedOn, "2026-12-10");
  assert.equal(standing.cleared, 1);
});

test("two things expected the same day are ordered by name, not by chance", () => {
  const standing = standingOf([
    dependency({ expectedOn: "2026-12-10", id: "b", title: "Purchase register" }),
    dependency({ expectedOn: "2026-12-10", id: "a", title: "Bank statement" }),
  ], TODAY);
  assert.deepEqual(standing.open.map((entry) => entry.title), ["Bank statement", "Purchase register"]);
});

test("something expected before today is overdue, and today is not late yet", () => {
  const standing = standingOf([
    dependency({ expectedOn: "2026-12-01", id: "late" }),
    dependency({ expectedOn: TODAY, id: "today" }),
    dependency({ expectedOn: "2026-12-20", id: "future" }),
  ], TODAY);
  assert.deepEqual(standing.overdue.map((entry) => entry.id), ["late"], "the day it is due, it is not yet overdue");
  assert.match(waitingSummary(standing, (key) => key), /3 outstanding · next expected 2026-12-01 · 1 overdue/);
});

test("waiting means something is outstanding, not whatever the note said", () => {
  assert.equal(refuseWaiting({ openCount: 2, status: "waiting" }), null);
  assert.equal(refuseWaiting({ openCount: 0, status: "waiting" }), "no_dependency");
  // Every other status is none of this rule's business.
  assert.equal(refuseWaiting({ openCount: 0, status: "critical" }), null);
  assert.equal(refuseWaiting({ openCount: 0, status: "completed" }), null);
});

const raise = (over: Partial<Parameters<typeof refuseRaise>[0]> = {}) => refuseRaise({
  expectedOn: "2026-12-12",
  kind: "client_request",
  openDuplicate: false,
  predecessorStatus: null,
  reachesSelf: false,
  requestStatus: "requested",
  target: "req-1",
  title: "Bank statement — Nov 2026",
  workItemId: "work-1",
  ...over,
});

test("a dependency needs a name, a kind, a target and a date", () => {
  assert.equal(raise(), null);
  assert.equal(raise({ kind: "someday" }), "unknown_kind");
  assert.equal(raise({ title: "  " }), "title_required");
  assert.equal(raise({ title: "ok" }), "title_required", "two characters is not a description");
  assert.equal(raise({ target: null }), "no_target");
  assert.equal(raise({ expectedOn: "" }), "date_required");
  assert.equal(raise({ expectedOn: "soon" }), "date_required");
});

test("the same thing is not awaited twice", () => {
  assert.equal(raise({ openDuplicate: true }), "duplicate");
});

test("a request already received or cancelled is not something to wait for", () => {
  assert.equal(raise({ requestStatus: "received" }), "request_closed");
  assert.equal(raise({ requestStatus: "cancelled" }), "request_closed");
  assert.equal(raise({ requestStatus: null }), "request_closed");
});

test("work does not wait on itself, or on work already finished", () => {
  const predecessor = { kind: "work_item", requestStatus: null, target: "work-2" } as const;
  assert.equal(raise({ ...predecessor, predecessorStatus: "at_risk" }), null);
  assert.equal(raise({ ...predecessor, target: "work-1" }), "self_dependency");
  assert.equal(raise({ ...predecessor, predecessorStatus: "completed" }), "predecessor_completed");
});

test("a chain that comes back on itself is refused", () => {
  // A waits on B, B waits on A. Not a slow project — a deadlock invisible from
  // either end, because each person sees only their own side of it.
  assert.equal(raise({ kind: "work_item", reachesSelf: true, requestStatus: null, target: "work-2" }), "cycle");
  // The same guard does not apply to the kinds that cannot form one.
  assert.equal(raise({ reachesSelf: true }), null, "a document request waits on nothing");
});

test("reaches follows the chain, however long", () => {
  const edges = new Map([
    ["b", ["c"]],
    ["c", ["d"]],
    ["d", ["a"]],
  ]);
  assert.equal(reaches(edges, "b", "a"), true, "b → c → d → a");
  assert.equal(reaches(edges, "b", "z"), false);
  assert.equal(reaches(new Map(), "b", "a"), false, "nothing waits on anything");
  assert.equal(reaches(edges, "a", "a"), true, "the start is trivially itself");
});

test("a cycle already in the data does not hang the check", () => {
  // If a bad row ever got in, the walk must still terminate.
  const edges = new Map([["b", ["c"]], ["c", ["b"]]]);
  assert.equal(reaches(edges, "b", "z"), false);
});

test("branches are all followed, not just the first", () => {
  const edges = new Map([
    ["b", ["c", "d"]],
    ["d", ["a"]],
  ]);
  assert.equal(reaches(edges, "b", "a"), true, "the answer is down the second branch");
});

test("the notice names the obligation, and does not claim to have moved it", () => {
  const notice = clearedNotice({ clientName: "Aarav Ltd", periodKey: "2026-11", serviceKey: "GST" });
  assert.equal(notice.title, "Everything you were waiting on for GST · Aarav Ltd · 2026-11 has arrived");
  assert.match(notice.body, /yours to pick up/);
  // The workflow status is a separate thing a person sets. Work whose
  // dependencies clear while it sits in Review must not be told it "is no
  // longer waiting", which reads as a claim about the status.
  // "you were waiting on" is about the dependencies and is past tense. What must
  // not appear is a present-tense claim about the workflow status, which a
  // person sets and this does not touch.
  assert.ok(!/is (no longer|not) waiting|status/i.test(notice.title + notice.body));
});

test("each kind reads as English and says how it stops being outstanding", () => {
  assert.ok(isDependencyKind("external"));
  assert.ok(!isDependencyKind("blocked"));
  for (const kind of DEPENDENCY_KINDS) {
    assert.ok(KIND_LABELS[kind].length > 0);
    assert.ok(KIND_CLEARS[kind].length > 0);
  }
});
