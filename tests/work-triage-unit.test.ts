import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { dayDifference } from "../lib/dashboard/filters";

const read = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

test("deadline distance is a date difference, not a clock difference", () => {
  assert.equal(dayDifference("2026-08-18", "2026-08-18"), 0);
  assert.equal(dayDifference("2026-08-19", "2026-08-18"), 1);
  assert.equal(dayDifference("2026-08-17", "2026-08-18"), -1);
  assert.equal(dayDifference("2026-08-25", "2026-08-18"), 7);
  // Across a month and a year boundary, where naive arithmetic slips.
  assert.equal(dayDifference("2026-09-01", "2026-08-31"), 1);
  assert.equal(dayDifference("2027-01-01", "2026-12-31"), 1);
  // Across an India DST-free but UTC-offset boundary the answer must not drift.
  assert.equal(dayDifference("2026-03-29", "2026-03-28"), 1);
});

test("every work item lands in exactly one urgency group", async () => {
  const source = await read("../app/dashboard/work-workspace.tsx");
  const block = source.slice(source.indexOf("const URGENCY"), source.indexOf("] as const;"));

  // Re-declare the boundaries the component uses, then prove they partition the
  // number line: a gap silently hides an item, an overlap shows it twice.
  const tests: Array<(days: number) => boolean> = [
    (days) => days < 0,
    (days) => days === 0,
    (days) => days > 0 && days <= 7,
    (days) => days > 7,
  ];
  for (const boundary of ["days < 0", "days === 0", "days > 0 && days <= 7", "days > 7"]) {
    assert.ok(block.includes(boundary), `urgency boundary ${boundary} must be the one tested here`);
  }
  for (let days = -400; days <= 400; days += 1) {
    const matches = tests.filter((predicate) => predicate(days)).length;
    assert.equal(matches, 1, `${days} days matched ${matches} groups`);
  }
});

test("the countdown reads correctly at each boundary", async () => {
  const source = await read("../app/dashboard/work-workspace.tsx");
  const chip = source.slice(source.indexOf("function dueChip"), source.indexOf("function WorkRow"));
  for (const [condition, phrasing] of [["days < 0", "overdue"], ["days === 0", "Due today"], ["days === 1", "Due tomorrow"]]) {
    const line = chip.split(/\r?\n/).find((row) => row.includes(condition));
    assert.ok(line?.includes(phrasing), `${condition} must read as "${phrasing}"`);
  }
  // Singular/plural and sign are the details that make a countdown trustworthy.
  assert.match(chip, /Math\.abs\(days\)/, "an overdue count must not render as negative");
});

test("every view is offered and none invents an ordering", async () => {
  const source = await read("../app/dashboard/work-workspace.tsx");
  assert.match(source, /aria-label="Choose a view"/);
  for (const view of ["Deadline list", "Status board", "Capacity"]) {
    assert.ok(source.includes(view), `${view} must be offered`);
  }
  // Ordering moved into SQL, so the component must not re-sort at all — sorting
  // a prop in place corrupts the caller's state, and re-sorting a server-ordered
  // list silently disagrees with the query that produced it.
  assert.doesNotMatch(source, /\.sort\(/, "the workspace must render the server's order, not impose its own");
});

test("the queue orders in SQL, least-finished first", async () => {
  const source = await read("../lib/work/queue.ts");
  const ordering = source.slice(source.indexOf(".orderBy("), source.indexOf(".orderBy(") + 400);
  // Least-finished first is the useful order, not nearly-done first.
  assert.match(ordering, /asc\(workItems\.progress\)/);
  assert.match(ordering, /asc\(legalEntities\.displayName\)/);
  assert.match(ordering, /asc\(EFFECTIVE_DUE\)/);
});

test("the deadline the queue sorts and groups by is the one the firm manages to", async () => {
  const queue = await read("../lib/work/queue.ts");
  // coalesce, not statutory alone: recurrence sets an internal date ahead of the
  // statutory one, and that earlier date is the one delivery is measured against.
  assert.match(queue, /coalesce\(\$\{workItems\.internalDueDate\}, \$\{workItems\.statutoryDueDate\}\)/);
  const workspace = await read("../app/dashboard/work-workspace.tsx");
  assert.match(workspace, /item\.internalDueDate \?\? item\.statutoryDueDate/);
});
