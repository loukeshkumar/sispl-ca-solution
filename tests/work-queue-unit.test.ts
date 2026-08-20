import assert from "node:assert/strict";
import test from "node:test";

import { planBulkChange, type BulkPlanCandidate } from "../lib/work/bulk";
import { burnPercentage, capacityHorizonWeeks, remainingBudgetMinutes, weeklyAvailableMinutes, weekStartKey, workingDaysInMask } from "../lib/scheduling/capacity";
import { DEFAULT_WORK_QUEUE_PARAMS, parseWorkQueueParams, workQueueHref, WORK_QUEUE_PRESETS } from "../lib/work/queue-params";

test("queue parameters default to the viewer's own list", () => {
  const params = parseWorkQueueParams({});
  assert.equal(params.scope, "mine");
  assert.equal(params.filter, "All");
  assert.equal(params.sort, "due");
  assert.equal(params.view, "list");
  assert.equal(params.owner, null);
  assert.deepEqual(params, DEFAULT_WORK_QUEUE_PARAMS);
});

test("queue parameters round-trip through a href", () => {
  const params = parseWorkQueueParams({ filter: "Due this week", scope: "firm", sort: "progress", view: "board" });
  const parsed = parseWorkQueueParams(Object.fromEntries(new URL(`http://x${workQueueHref(params)}`).searchParams));
  assert.deepEqual(parsed, params);
});

test("unknown parameter values fall back to defaults instead of erroring", () => {
  const params = parseWorkQueueParams({ filter: "Nonsense", scope: "everyone", sort: "colour", view: "gantt" });
  assert.equal(params.scope, "mine");
  assert.equal(params.filter, "All");
  assert.equal(params.sort, "due");
  assert.equal(params.view, "list");
});

test("owner applies only to the firm scope", () => {
  const owner = "3f1a2b4c-5d6e-4f70-8901-a2b3c4d5e6f7";
  assert.equal(parseWorkQueueParams({ owner, scope: "firm" }).owner, owner);
  assert.equal(parseWorkQueueParams({ owner, scope: "mine" }).owner, null);
  assert.equal(parseWorkQueueParams({ owner, scope: "reviewing" }).owner, null);
});

test("repeated parameters take the first value rather than concatenating", () => {
  assert.equal(parseWorkQueueParams({ scope: ["firm", "mine"] }).scope, "firm");
});

test("the unassigned sentinel survives parsing but only under the firm scope", () => {
  assert.equal(parseWorkQueueParams({ owner: "unassigned", scope: "firm" }).owner, "unassigned");
  assert.equal(parseWorkQueueParams({ owner: "unassigned", scope: "mine" }).owner, null);
});

test("the over-budget flag is a real filter, not a sort", () => {
  assert.equal(parseWorkQueueParams({ budget: "over" }).budget, "over");
  assert.equal(parseWorkQueueParams({ budget: "under" }).budget, null);
  assert.equal(parseWorkQueueParams({}).budget, null);
});

test("every preset produces a workspace href that parses back to its own parameters", () => {
  for (const preset of WORK_QUEUE_PRESETS) {
    const href = workQueueHref(preset.params);
    assert.ok(href.startsWith("/?workspace=work"), `${preset.key} must stay on the work workspace`);
    const parsed = parseWorkQueueParams(Object.fromEntries(new URL(`http://x${href}`).searchParams));
    for (const [key, value] of Object.entries(preset.params)) {
      assert.deepEqual(parsed[key as keyof typeof parsed], value, `${preset.key}.${key}`);
    }
  }
});

test("working days come from the configured week mask", () => {
  assert.equal(workingDaysInMask("1111110"), 6);
  assert.equal(workingDaysInMask("1111100"), 5);
  assert.equal(workingDaysInMask("0000000"), 0);
});

test("weekly available minutes multiply the shift full day by its working days", () => {
  assert.equal(weeklyAvailableMinutes(450, "1111110"), 2700);
  assert.equal(weeklyAvailableMinutes(450, "1111100"), 2250);
});

test("remaining budget discounts work already done", () => {
  assert.equal(remainingBudgetMinutes(100, 0), 100);
  assert.equal(remainingBudgetMinutes(100, 90), 10);
  assert.equal(remainingBudgetMinutes(100, 100), 0);
});

test("an unbudgeted item contributes nothing to load rather than a zero-minute estimate", () => {
  assert.equal(remainingBudgetMinutes(null, 50), 0);
});

test("weeks start on Monday regardless of which day the date falls on", () => {
  assert.equal(weekStartKey("2026-08-20"), "2026-08-17");
  assert.equal(weekStartKey("2026-08-17"), "2026-08-17");
  assert.equal(weekStartKey("2026-08-23"), "2026-08-17");
  assert.equal(weekStartKey("2026-08-24"), "2026-08-24");
});

test("the capacity horizon is consecutive week starts beginning with the current week", () => {
  assert.deepEqual(capacityHorizonWeeks("2026-08-20", 4), ["2026-08-17", "2026-08-24", "2026-08-31", "2026-09-07"]);
});

test("burn percentage is null when no budget exists, so the view can say so", () => {
  assert.equal(burnPercentage(120, null), null);
  assert.equal(burnPercentage(0, 90), 0);
  assert.equal(burnPercentage(45, 90), 50);
  assert.equal(burnPercentage(180, 90), 200);
});

const candidate = (over: Partial<BulkPlanCandidate> = {}): BulkPlanCandidate => ({
  assigneeId: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa",
  blockerNote: "",
  id: "11111111-1111-4111-8111-111111111111",
  internalDueDate: "2026-08-17",
  reviewerId: null,
  statutoryDueDate: "2026-08-20",
  ...over,
});

test("bulk reassign skips items where the new assignee already reviews them", () => {
  const reviewer = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";
  const plan = planBulkChange(
    [candidate(), candidate({ id: "22222222-2222-4222-8222-222222222222", reviewerId: reviewer })],
    { kind: "assignee", memberId: reviewer },
  );
  assert.equal(plan.apply.length, 1);
  assert.equal(plan.skip.length, 1);
  assert.match(plan.skip[0]!.reason, /already reviews/i);
});

test("shifting the internal date never crosses the statutory date", () => {
  const plan = planBulkChange([candidate(), candidate({ id: "33333333-3333-4333-8333-333333333333", internalDueDate: "2026-08-19" })], { kind: "internalDue", shiftDays: 3 });
  assert.equal(plan.apply.length, 1);
  assert.equal(plan.apply[0]!.internalDueDate, "2026-08-20");
  assert.match(plan.skip[0]!.reason, /statutory/i);
});

test("shifting an item with no internal date starts from its statutory date", () => {
  const plan = planBulkChange([candidate({ internalDueDate: null })], { kind: "internalDue", shiftDays: -2 });
  assert.equal(plan.apply[0]!.internalDueDate, "2026-08-18");
});

test("bulk status cannot complete work", () => {
  assert.throws(() => planBulkChange([candidate()], { kind: "status", status: "completed" as never }), /completed/i);
});

test("bulk status to waiting requires a recorded dependency", () => {
  const plan = planBulkChange(
    [candidate(), candidate({ id: "44444444-4444-4444-8444-444444444444", blockerNote: "Awaiting bank statements" })],
    { kind: "status", status: "waiting" },
  );
  assert.equal(plan.apply.length, 1);
  assert.equal(plan.apply[0]!.id, "44444444-4444-4444-8444-444444444444");
  assert.match(plan.skip[0]!.reason, /dependency/i);
});

test("an empty selection plans nothing rather than throwing", () => {
  assert.deepEqual(planBulkChange([], { kind: "assignee", memberId: null }), { apply: [], skip: [] });
});
