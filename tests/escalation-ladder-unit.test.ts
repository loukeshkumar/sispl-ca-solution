import assert from "node:assert/strict";
import test from "node:test";

import {
  addDays,
  ANCHOR_LABELS,
  dueRungs,
  EMPTY_LADDER_NOTE,
  escalationNotice,
  ESCALATION_ANCHORS,
  ESCALATION_ROLES,
  isEscalationAnchor,
  isEscalationRole,
  isTargetKind,
  overtakenBy,
  refuseRule,
  ROLE_LABELS,
  rungDate,
  rungSummary,
  TARGET_KINDS,
  type EscalationRule,
} from "../lib/escalation/ladder";

const rule = (over: Partial<EscalationRule> = {}): EscalationRule => ({
  anchor: "internal_due",
  id: `rung-${over.rung ?? 1}`,
  label: "Internal deadline passed",
  offsetDays: 0,
  rung: 1,
  targetKind: "role",
  targetRole: "manager",
  ...over,
});

/** A three-rung ladder: assignee first, then managers, then partners. */
const LADDER: EscalationRule[] = [
  rule({ anchor: "internal_due", label: "Two days to the internal deadline", offsetDays: -2, rung: 1, targetKind: "assignee", targetRole: null }),
  rule({ anchor: "internal_due", label: "Internal deadline passed", offsetDays: 0, rung: 2, targetRole: "manager" }),
  rule({ anchor: "statutory_due", label: "Statutory deadline passed", offsetDays: 1, rung: 3, targetRole: "partner" }),
];

const ITEM = { internalDueDate: "2026-12-15", statutoryDueDate: "2026-12-20" };

const fire = (todayKey: string, alreadyFired: number[] = [], item = ITEM) =>
  dueRungs({ alreadyFired, item, rules: LADDER, todayKey });

test("dates step forward and backward across month ends", () => {
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2027-01-01", -1), "2026-12-31");
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
  assert.equal(addDays("2028-03-01", -1), "2028-02-29", "a leap year is still a leap year");
});

test("a rung falls where its offset puts it", () => {
  assert.equal(rungDate(LADDER[0]!, ITEM), "2026-12-13", "two days before the internal date");
  assert.equal(rungDate(LADDER[1]!, ITEM), "2026-12-15", "on the internal date");
  assert.equal(rungDate(LADDER[2]!, ITEM), "2026-12-21", "the day after the statutory date");
});

test("an obligation with no internal date falls back to the statutory one", () => {
  // Dropping the rung would be the exact failure this ladder exists to prevent.
  const noInternal = { internalDueDate: null, statutoryDueDate: "2026-12-20" };
  assert.equal(rungDate(LADDER[0]!, noInternal), "2026-12-18");
  assert.equal(rungDate(LADDER[1]!, noInternal), "2026-12-20");
});

test("nothing fires before its day", () => {
  assert.deepEqual(fire("2026-12-12"), []);
});

test("a rung fires on its day and names the audience", () => {
  const fired = fire("2026-12-13");
  assert.equal(fired.length, 1);
  assert.equal(fired[0]!.rule.rung, 1);
  assert.equal(fired[0]!.overtaken, false);
  assert.equal(fired[0]!.dueOn, "2026-12-13");
});

test("a rung already fired never fires again", () => {
  assert.deepEqual(fire("2026-12-13", [1]), [], "the ladder climbs, it does not re-climb");
  const next = fire("2026-12-15", [1]);
  assert.equal(next.length, 1);
  assert.equal(next[0]!.rule.rung, 2);
});

test("where several came due, only the highest tells anybody", () => {
  // A job that did not run for a week, or work raised already late. Telling a
  // manager after a partner knows is the ladder run backwards.
  const fired = fire("2026-12-25");
  assert.deepEqual(fired.map((entry) => entry.rule.rung), [1, 2, 3], "all three are recorded");
  assert.deepEqual(fired.map((entry) => entry.overtaken), [true, true, false]);
  assert.equal(fired.filter((entry) => !entry.overtaken).length, 1, "exactly one notification");
});

test("the rungs it passed are still written down", () => {
  // Recording only the highest would let the history claim rung 2 never came due.
  const fired = fire("2026-12-25");
  assert.equal(fired.length, 3);
  assert.match(overtakenBy(3), /Overtaken by rung 3/);
});

test("rungs already fired do not affect which of the rest is highest", () => {
  const fired = fire("2026-12-25", [3]);
  assert.deepEqual(fired.map((entry) => entry.rule.rung), [1, 2]);
  assert.deepEqual(fired.map((entry) => entry.overtaken), [true, false], "rung 2 now speaks");
});

test("a firm with no ladder escalates nothing", () => {
  assert.deepEqual(dueRungs({ alreadyFired: [], item: ITEM, rules: [], todayKey: "2027-06-01" }), []);
  assert.ok(EMPTY_LADDER_NOTE.length > 0);
});

test("rungs arrive in order however the rules were listed", () => {
  const shuffled = [LADDER[2]!, LADDER[0]!, LADDER[1]!];
  const fired = dueRungs({ alreadyFired: [], item: ITEM, rules: shuffled, todayKey: "2026-12-25" });
  assert.deepEqual(fired.map((entry) => entry.rule.rung), [1, 2, 3]);
  assert.equal(fired[2]!.overtaken, false);
});

const raise = (over: Partial<Parameters<typeof refuseRule>[0]> = {}) => refuseRule({
  anchor: "internal_due",
  existingRungs: [],
  label: "Internal deadline passed",
  offsetDays: 0,
  previous: null,
  rung: 2,
  targetKind: "role",
  targetRole: "manager",
  ...over,
});

test("a rung needs a number, an anchor, an audience and a meaning", () => {
  assert.equal(raise(), null);
  assert.equal(raise({ rung: 0 }), "rung_out_of_range");
  assert.equal(raise({ rung: 21 }), "rung_out_of_range");
  assert.equal(raise({ existingRungs: [2] }), "rung_taken");
  assert.equal(raise({ anchor: "some_day" }), "unknown_anchor");
  assert.equal(raise({ targetKind: "everyone" }), "unknown_target");
  assert.equal(raise({ offsetDays: 61 }), "offset_out_of_range");
  assert.equal(raise({ offsetDays: -61 }), "offset_out_of_range");
  assert.equal(raise({ offsetDays: 1.5 }), "offset_out_of_range");
  assert.equal(raise({ label: "  " }), "label_required");
});

test("a role rung names a role and an assignee rung does not", () => {
  assert.equal(raise({ targetRole: null }), "role_required");
  assert.equal(raise({ targetRole: "everybody" }), "unknown_role");
  assert.equal(raise({ targetKind: "assignee", targetRole: null }), null);
  assert.equal(raise({ targetKind: "assignee", targetRole: "partner" }), "role_not_allowed");
});

test("a ladder cannot climb downwards", () => {
  // Rung 3 firing before rung 2 tells a partner while the manager still has days
  // in hand. That is a leapfrog, not an escalation.
  assert.equal(raise({ offsetDays: -5, previous: { anchor: "internal_due", offsetDays: 0 }, rung: 3 }), "not_later_than_previous");
  assert.equal(raise({ offsetDays: 3, previous: { anchor: "internal_due", offsetDays: 0 }, rung: 3 }), null);
  // The statutory date is never before the internal one, so the same offset on
  // the statutory anchor is always at or later than on the internal one.
  assert.equal(raise({ anchor: "statutory_due", offsetDays: -5, previous: { anchor: "internal_due", offsetDays: 0 }, rung: 3 }), null);
  assert.equal(raise({ anchor: "internal_due", offsetDays: 0, previous: { anchor: "statutory_due", offsetDays: 0 }, rung: 3 }), "not_later_than_previous");
  // Two rungs on the same day are allowed: a manager and a partner told together.
  assert.equal(raise({ offsetDays: 0, previous: { anchor: "internal_due", offsetDays: 0 }, rung: 3 }), null);
});

test("a rung reads as a sentence somebody would say", () => {
  assert.equal(rungSummary(LADDER[0]!), "Rung 1 · 2 days before the internal due date · the assignee");
  assert.equal(rungSummary(LADDER[1]!), "Rung 2 · on the internal due date · Managers");
  assert.equal(rungSummary(LADDER[2]!), "Rung 3 · 1 day after the statutory due date · Partners");
});

test("the notice says where the deadline stands and that nothing moved", () => {
  const late = escalationNotice({
    clientName: "Aarav Ltd", label: "Statutory deadline passed", periodKey: "Nov 2026",
    rung: 3, serviceKey: "GST", statutoryDueDate: "2026-12-20", todayKey: "2026-12-25",
  });
  assert.equal(late.title, "Rung 3: GST · Aarav Ltd · Nov 2026");
  assert.match(late.body, /5 days past its statutory due date/);
  assert.match(late.body, /has not been reassigned/, "the ladder tells, it does not move work");

  assert.match(escalationNotice({
    clientName: "Aarav Ltd", label: "Due", periodKey: "Nov 2026", rung: 1,
    serviceKey: "GST", statutoryDueDate: "2026-12-20", todayKey: "2026-12-20",
  }).body, /due today/);
  assert.match(escalationNotice({
    clientName: "Aarav Ltd", label: "Due", periodKey: "Nov 2026", rung: 1,
    serviceKey: "GST", statutoryDueDate: "2026-12-20", todayKey: "2026-12-19",
  }).body, /due in 1 day/);
  assert.match(escalationNotice({
    clientName: "Aarav Ltd", label: "Due", periodKey: "Nov 2026", rung: 1,
    serviceKey: "GST", statutoryDueDate: "2026-12-20", todayKey: "2026-12-21",
  }).body, /1 day past/, "one day, not one days");
});

test("anchors, targets and roles are the listed ones and each reads as English", () => {
  assert.ok(isEscalationAnchor("statutory_due"));
  assert.ok(!isEscalationAnchor("some_day"));
  assert.ok(isTargetKind("assignee"));
  assert.ok(!isTargetKind("team"));
  assert.ok(isEscalationRole("partner"));
  assert.ok(!isEscalationRole("director"));
  for (const anchor of ESCALATION_ANCHORS) assert.ok(ANCHOR_LABELS[anchor].length > 0);
  for (const role of ESCALATION_ROLES) assert.ok(ROLE_LABELS[role].length > 0);
  assert.equal(TARGET_KINDS.length, 2);
});
