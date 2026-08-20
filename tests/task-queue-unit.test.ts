import assert from "node:assert/strict";
import test from "node:test";

import {
  availableTaskScopes,
  DEFAULT_TASK_QUEUE_PARAMS,
  parseTaskQueueParams,
  priorityRank,
  taskQueueHref,
  TASK_QUEUE_PRESETS,
} from "../lib/tasks/queue-params";
import { planBulkTaskChange, type TaskBulkCandidate } from "../lib/tasks/bulk";

test("task queue parameters default to the viewer's own active list", () => {
  const params = parseTaskQueueParams({});
  assert.equal(params.scope, "mine");
  assert.equal(params.status, "Active");
  assert.equal(params.priority, "all");
  assert.equal(params.view, "list");
  assert.equal(params.sort, "due");
  assert.deepEqual(params, DEFAULT_TASK_QUEUE_PARAMS);
});

test("task queue parameters round-trip through a href", () => {
  const params = parseTaskQueueParams({ priority: "urgent", scope: "firm", sort: "priority", status: "Waiting", view: "board" });
  const parsed = parseTaskQueueParams(Object.fromEntries(new URL(`http://x${taskQueueHref(params)}`).searchParams));
  assert.deepEqual(parsed, params);
});

test("unknown task parameters fall back to defaults instead of erroring", () => {
  const params = parseTaskQueueParams({ priority: "screaming", scope: "everyone", sort: "vibes", status: "Nonsense", view: "gantt" });
  assert.deepEqual(params, DEFAULT_TASK_QUEUE_PARAMS);
});

test("owner applies only to the firm scope", () => {
  const owner = "3f1a2b4c-5d6e-4f70-8901-a2b3c4d5e6f7";
  assert.equal(parseTaskQueueParams({ owner, scope: "firm" }).owner, owner);
  for (const scope of ["mine", "reviewing", "assigned"]) {
    assert.equal(parseTaskQueueParams({ owner, scope }).owner, null, `${scope} fixes the owner already`);
  }
});

test("priority ranks urgent first so an urgent overdue task outranks a low one", () => {
  assert.deepEqual(
    ["low", "urgent", "normal", "high"].sort((a, b) => priorityRank(a) - priorityRank(b)),
    ["urgent", "high", "normal", "low"],
  );
  // An unknown priority must sort last, never ahead of a real one.
  assert.ok(priorityRank("mystery") > priorityRank("low"));
});

test("scopes that the access floor can never satisfy are not offered", () => {
  // Only viewers who can manage all tasks can see rows they neither own nor were assigned.
  assert.deepEqual(availableTaskScopes(false).map((scope) => scope.key), ["mine"]);
  assert.deepEqual(availableTaskScopes(true).map((scope) => scope.key), ["mine", "reviewing", "assigned", "firm"]);
});

test("every task preset produces a workspace href that parses back to its own parameters", () => {
  for (const preset of TASK_QUEUE_PRESETS) {
    const href = taskQueueHref(preset.params);
    assert.ok(href.startsWith("/?workspace=tasks"), `${preset.key} must stay on the tasks workspace`);
    const parsed = parseTaskQueueParams(Object.fromEntries(new URL(`http://x${href}`).searchParams));
    for (const [key, value] of Object.entries(preset.params)) {
      assert.deepEqual(parsed[key as keyof typeof parsed], value, `${preset.key}.${key}`);
    }
  }
});

const candidate = (over: Partial<TaskBulkCandidate> = {}): TaskBulkCandidate => ({
  assigneeId: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa",
  blockerNote: "",
  dueDate: "2026-08-27",
  id: "11111111-1111-4111-8111-111111111111",
  reviewerId: null,
  status: "todo",
  ...over,
});

test("bulk reassign skips a task whose new assignee already reviews it", () => {
  const reviewer = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";
  const plan = planBulkTaskChange(
    [candidate(), candidate({ id: "22222222-2222-4222-8222-222222222222", reviewerId: reviewer })],
    { kind: "assignee", memberId: reviewer },
  );
  assert.equal(plan.apply.length, 1);
  assert.match(plan.skip[0]!.reason, /already reviews/i);
});

test("bulk status to waiting skips tasks with no recorded dependency", () => {
  const plan = planBulkTaskChange(
    [candidate(), candidate({ id: "33333333-3333-4333-8333-333333333333", blockerNote: "Awaiting client PAN" })],
    { kind: "status", status: "waiting" },
  );
  assert.equal(plan.apply.length, 1);
  assert.equal(plan.apply[0]!.id, "33333333-3333-4333-8333-333333333333");
  assert.match(plan.skip[0]!.reason, /dependency/i);
});

test("bulk status cannot complete or cancel a task", () => {
  for (const status of ["completed", "cancelled"]) {
    assert.throws(() => planBulkTaskChange([candidate()], { kind: "status", status: status as never }), /completed|cancelled/i);
  }
});

test("bulk changes never touch a task that is already closed", () => {
  const plan = planBulkTaskChange(
    [candidate({ status: "completed" }), candidate({ id: "44444444-4444-4444-8444-444444444444", status: "cancelled" })],
    { kind: "priority", priority: "urgent" },
  );
  assert.equal(plan.apply.length, 0);
  assert.equal(plan.skip.length, 2);
  for (const skipped of plan.skip) assert.match(skipped.reason, /closed/i);
});

test("shifting a due date moves it by whole days in either direction", () => {
  assert.equal(planBulkTaskChange([candidate()], { kind: "dueDate", shiftDays: 3 }).apply[0]!.dueDate, "2026-08-30");
  assert.equal(planBulkTaskChange([candidate()], { kind: "dueDate", shiftDays: -2 }).apply[0]!.dueDate, "2026-08-25");
});

test("an empty task selection plans nothing rather than throwing", () => {
  assert.deepEqual(planBulkTaskChange([], { kind: "priority", priority: "high" }), { apply: [], skip: [] });
});
