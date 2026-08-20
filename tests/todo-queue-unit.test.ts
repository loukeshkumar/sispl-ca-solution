import assert from "node:assert/strict";
import test from "node:test";

import { planBulkTodoChange, type TodoBulkCandidate } from "../lib/todos/bulk";
import {
  DEFAULT_TODO_QUEUE_PARAMS,
  parseTodoQueueParams,
  todoQueueHref,
  TODO_URGENCY,
  todoUrgencyKey,
} from "../lib/todos/queue-params";
import { buildLoadStrip, nextDueDate } from "../lib/todos/recurrence";

test("a daily repeat advances by its interval", () => {
  assert.equal(nextDueDate("2026-08-21", "day", 1), "2026-08-22");
  assert.equal(nextDueDate("2026-08-21", "day", 3), "2026-08-24");
  assert.equal(nextDueDate("2026-08-30", "day", 3), "2026-09-02");
});

test("a weekly repeat lands on the same weekday", () => {
  assert.equal(nextDueDate("2026-08-21", "week", 1), "2026-08-28");
  assert.equal(nextDueDate("2026-08-21", "week", 2), "2026-09-04");
  const start = new Date("2026-08-21T00:00:00Z").getUTCDay();
  assert.equal(new Date(`${nextDueDate("2026-08-21", "week", 1)}T00:00:00Z`).getUTCDay(), start);
});

test("a monthly repeat clamps to the last day rather than drifting into the next month", () => {
  // 31 January has no 31 February. Rolling into 3 March would push a monthly
  // reminder later every single year.
  assert.equal(nextDueDate("2026-01-31", "month", 1), "2026-02-28");
  assert.equal(nextDueDate("2028-01-31", "month", 1), "2028-02-29", "leap year keeps the 29th");
  assert.equal(nextDueDate("2026-03-31", "month", 1), "2026-04-30");
  assert.equal(nextDueDate("2026-01-15", "month", 1), "2026-02-15");
  assert.equal(nextDueDate("2026-12-15", "month", 1), "2027-01-15", "crossing the year boundary");
  assert.equal(nextDueDate("2026-01-31", "month", 3), "2026-04-30");
});

test("a month-end repeat stays on the month end instead of walking backwards", () => {
  // Naive clamping compounds: 31 Jan -> 28 Feb -> 28 Mar -> 28 Apr, and a
  // month-end reminder silently drifts earlier forever. A date on its own month
  // end means "the last day", so it recurs to the next month end.
  const february = nextDueDate("2026-01-31", "month", 1)!;
  assert.equal(february, "2026-02-28");
  assert.equal(nextDueDate(february, "month", 1), "2026-03-31");
  assert.equal(nextDueDate("2026-03-31", "month", 1), "2026-04-30");
  assert.equal(nextDueDate("2026-04-30", "month", 1), "2026-05-31");
  // A mid-month date never touches the clamp and must not be dragged to the end.
  assert.equal(nextDueDate("2026-01-30", "month", 1), "2026-02-28", "30 Jan clamps once");
  assert.equal(nextDueDate("2026-02-15", "month", 1), "2026-03-15");
});

test("an unknown rule returns null rather than inventing a date", () => {
  assert.equal(nextDueDate("2026-08-21", "quarterly" as never, 1), null);
  assert.equal(nextDueDate("", "day", 1), null);
  assert.equal(nextDueDate("2026-08-21", "day", 0), null);
});

test("urgency buckets partition every to-do, including undated ones", () => {
  const today = "2026-08-21";
  assert.equal(todoUrgencyKey(null, today), "undated");
  assert.equal(todoUrgencyKey("2026-08-20", today), "overdue");
  assert.equal(todoUrgencyKey("2026-08-21", today), "today");
  assert.equal(todoUrgencyKey("2026-08-27", today), "week");
  assert.equal(todoUrgencyKey("2026-08-28", today), "week");
  assert.equal(todoUrgencyKey("2026-08-29", today), "later");
  // Every bucket the grouper can produce must have a heading to render under.
  const keys = new Set(TODO_URGENCY.map((group) => group.key));
  for (const due of [null, "2026-08-20", "2026-08-21", "2026-08-25", "2026-09-30"]) {
    assert.ok(keys.has(todoUrgencyKey(due, today)), `${due} has no group`);
  }
});

test("the default view is fixed, not chosen by whatever happens to be due", () => {
  assert.equal(DEFAULT_TODO_QUEUE_PARAMS.view, "All open");
  assert.equal(parseTodoQueueParams({}).view, "All open");
  assert.deepEqual(parseTodoQueueParams({}), DEFAULT_TODO_QUEUE_PARAMS);
});

test("to-do parameters round-trip and reject nonsense", () => {
  const params = parseTodoQueueParams({ category: "Follow-up", priority: "high", sort: "priority", view: "Overdue" });
  assert.deepEqual(parseTodoQueueParams(Object.fromEntries(new URL(`http://x${todoQueueHref(params)}`).searchParams)), params);
  assert.deepEqual(parseTodoQueueParams({ priority: "screaming", sort: "vibes", view: "Someday" }), DEFAULT_TODO_QUEUE_PARAMS);
});

test("the load strip counts only dated items across its horizon", () => {
  const strip = buildLoadStrip(
    [{ dueDate: "2026-08-21" }, { dueDate: "2026-08-21" }, { dueDate: null }, { dueDate: "2026-09-30" }],
    "2026-08-21",
    28,
  );
  assert.equal(strip.length, 28);
  assert.equal(strip[0]!.dateKey, "2026-08-21");
  assert.equal(strip[0]!.count, 2);
  // Undated items have no day to sit on, and a date past the horizon is dropped
  // rather than piled onto the last cell.
  assert.equal(strip.reduce((total, day) => total + day.count, 0), 2);
});

const candidate = (over: Partial<TodoBulkCandidate> = {}): TodoBulkCandidate => ({
  dueDate: "2026-08-27",
  id: "11111111-1111-4111-8111-111111111111",
  status: "open",
  ...over,
});

test("bulk complete skips items that are already complete", () => {
  const plan = planBulkTodoChange([candidate(), candidate({ id: "22222222-2222-4222-8222-222222222222", status: "completed" })], { kind: "complete" });
  assert.equal(plan.apply.length, 1);
  assert.match(plan.skip[0]!.reason, /already complete/i);
});

test("bulk reopen only touches items that are not open", () => {
  const plan = planBulkTodoChange([candidate({ status: "completed" }), candidate({ id: "33333333-3333-4333-8333-333333333333" })], { kind: "reopen" });
  assert.equal(plan.apply.length, 1);
  assert.match(plan.skip[0]!.reason, /already open/i);
});

test("bulk reschedule skips undated items rather than inventing a date for them", () => {
  const plan = planBulkTodoChange(
    [candidate(), candidate({ dueDate: null, id: "44444444-4444-4444-8444-444444444444" })],
    { kind: "reschedule", shiftDays: 2 },
  );
  assert.equal(plan.apply.length, 1);
  assert.equal(plan.apply[0]!.dueDate, "2026-08-29");
  assert.match(plan.skip[0]!.reason, /no due date/i);
});

test("an empty selection plans nothing rather than throwing", () => {
  assert.deepEqual(planBulkTodoChange([], { kind: "complete" }), { apply: [], skip: [] });
});
