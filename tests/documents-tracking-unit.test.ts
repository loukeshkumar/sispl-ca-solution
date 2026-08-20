import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { dayDifference } from "../lib/dashboard/filters";

const read = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

test("age counts forward from when the request was raised", () => {
  const today = "2026-08-18";
  // The component computes dayDifference(today, createdAt). Reversing the
  // arguments would show every outstanding request as raised in the future.
  assert.equal(dayDifference(today, "2026-08-18"), 0, "raised today");
  assert.equal(dayDifference(today, "2026-08-06"), 12, "raised twelve days ago");
  assert.equal(dayDifference(today, "2026-07-18"), 31, "raised last month");
  assert.ok(dayDifference(today, "2026-08-06") > 0, "an older request must have a larger age, not a negative one");
});

test("the register measures a deadline only where one is still live", async () => {
  const source = await read("../app/dashboard/documents-workspace.tsx");
  // A received or cancelled request has no deadline left to miss, so banding it
  // as "overdue" would accuse a client of owing something they already sent.
  assert.match(source, /const banded = scope === "received" \|\| scope === "cancelled" \|\| scope === "all"/);
  assert.match(source, /const outstanding = request\.status === "requested"/);
  assert.match(source, /outstanding\s*\n\s*\?\s*<small className=\{`work-due-chip/);
  assert.match(source, /\{outstanding && <small className="document-request-age"/);
});

test("chasing is a strict subset of open, and the scopes cover every request", async () => {
  const source = await read("../app/dashboard/documents-workspace.tsx");
  assert.match(source, /scope === "chase" && request\.status === "requested" && request\.dueDate < todayKey/);

  // Re-derive the scope predicates and prove they behave: everything appears
  // under "all", chasing never includes a request that is not open.
  const today = "2026-08-18";
  const rows = [
    { dueDate: "2026-08-01", status: "requested" },
    { dueDate: "2026-08-18", status: "requested" },
    { dueDate: "2026-09-30", status: "requested" },
    { dueDate: "2026-08-01", status: "received" },
    { dueDate: "2026-08-01", status: "cancelled" },
  ];
  const inScope = (scope: string, row: { dueDate: string; status: string }) => scope === "all"
    || (scope === "chase" && row.status === "requested" && row.dueDate < today)
    || (scope === "open" && row.status === "requested")
    || (scope === "received" && row.status === "received")
    || (scope === "cancelled" && row.status === "cancelled");

  assert.equal(rows.filter((row) => inScope("all", row)).length, rows.length);
  assert.equal(rows.filter((row) => inScope("chase", row)).length, 1);
  assert.equal(rows.filter((row) => inScope("open", row)).length, 3);
  for (const row of rows.filter((entry) => inScope("chase", entry))) {
    assert.ok(inScope("open", row), "a request being chased must also be open");
  }
  // Open, received and cancelled partition the register between them.
  const partitioned = ["open", "received", "cancelled"].reduce((total, scope) => total + rows.filter((row) => inScope(scope, row)).length, 0);
  assert.equal(partitioned, rows.length, "every request belongs to exactly one state");
});

test("the two document surfaces point at each other rather than duplicating", async () => {
  const documents = await read("../app/dashboard/documents-workspace.tsx");
  const library = await read("../app/dashboard/client-documents-workspace.tsx");
  // Requests are chased here; the full per-client library lives next door.
  assert.match(documents, /workspace=client-documents/);
  assert.match(library, /workspace=documents/);
  assert.match(documents, /workspace\.documents\.slice\(0, 12\)/, "the aside is a recent list, not the whole library");
});
