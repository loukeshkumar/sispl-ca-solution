import assert from "node:assert/strict";
import test from "node:test";

import { planBulkRequestCancel, type RequestBulkCandidate } from "../lib/documents/bulk";
import { DEFAULT_DOCUMENT_PARAMS, documentsHref, parseDocumentParams } from "../lib/documents/queue-params";
import { ageLabel, groupRequestsByClient } from "../lib/documents/chase";

const TODAY = "2026-08-21";

test("age reads the way someone asks about it out loud", () => {
  assert.equal(ageLabel("2026-08-21T09:00:00.000Z", TODAY), "asked today");
  assert.equal(ageLabel("2026-08-20T09:00:00.000Z", TODAY), "asked yesterday");
  assert.equal(ageLabel("2026-07-31T09:00:00.000Z", TODAY), "asked 21 days ago");
  assert.equal(ageLabel("2026-08-22T09:00:00.000Z", TODAY), "asked today", "a future stamp never reads as negative");
  assert.equal(ageLabel("", TODAY), "");
});

const request = (over: Partial<Parameters<typeof groupRequestsByClient>[0][number]> = {}) => ({
  clientName: "Aarav Retail Pvt. Ltd.",
  createdAt: "2026-08-18T09:00:00.000Z",
  dueDate: "2026-08-25",
  id: "r1",
  legalEntityId: "c1",
  status: "requested",
  title: "Bank statement",
  ...over,
});

test("client groups carry the count and the oldest outstanding request", () => {
  const groups = groupRequestsByClient([
    request(),
    request({ createdAt: "2026-07-25T09:00:00.000Z", id: "r2", title: "Purchase register" }),
    request({ clientName: "Koshi Infra LLP", id: "r3", legalEntityId: "c2" }),
  ], TODAY);
  assert.deepEqual(groups.map((group) => group.clientName), ["Aarav Retail Pvt. Ltd.", "Koshi Infra LLP"]);
  assert.equal(groups[0]!.items.length, 2);
  // Escalation is driven by the oldest item, not the newest or the average.
  assert.equal(groups[0]!.oldestDays, 27);
  assert.match(groups[0]!.oldestLabel, /27 days/);
});

test("groups sort by the longest wait, because that is what gets chased first", () => {
  const groups = groupRequestsByClient([
    request({ clientName: "Recent", createdAt: "2026-08-20T09:00:00.000Z", id: "r1", legalEntityId: "c1" }),
    request({ clientName: "Ancient", createdAt: "2026-06-01T09:00:00.000Z", id: "r2", legalEntityId: "c2" }),
  ], TODAY);
  assert.deepEqual(groups.map((group) => group.clientName), ["Ancient", "Recent"]);
});

test("document parameters round-trip and reject nonsense", () => {
  const params = parseDocumentParams({ layout: "client", q: "bank", scope: "received" });
  assert.deepEqual(parseDocumentParams(Object.fromEntries(new URL(`http://x${documentsHref(params)}`).searchParams)), params);
  assert.deepEqual(parseDocumentParams({ layout: "spiral", scope: "everything" }), DEFAULT_DOCUMENT_PARAMS);
  assert.equal(DEFAULT_DOCUMENT_PARAMS.scope, "chase", "chasing is the job, so it opens there");
});

const candidate = (over: Partial<RequestBulkCandidate> = {}): RequestBulkCandidate => ({
  id: "r1", status: "requested", ...over,
});

test("bulk cancel only touches requests still outstanding", () => {
  const plan = planBulkRequestCancel([
    candidate(),
    candidate({ id: "r2", status: "received" }),
    candidate({ id: "r3", status: "cancelled" }),
  ]);
  assert.equal(plan.apply.length, 1);
  assert.equal(plan.apply[0]!.id, "r1");
  assert.match(plan.skip.find((item) => item.id === "r2")!.reason, /already received/i);
  assert.match(plan.skip.find((item) => item.id === "r3")!.reason, /already cancelled/i);
});

test("an empty selection plans nothing rather than throwing", () => {
  assert.deepEqual(planBulkRequestCancel([]), { apply: [], skip: [] });
});

test("the request row declares a column for every cell it renders", async () => {
  const { readFile } = await import("node:fs/promises");
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  const rule = css.slice(css.indexOf(".document-request-row {"));
  const columns = rule.slice(rule.indexOf("grid-template-columns:"), rule.indexOf("}"));
  const declared = (columns.match(/minmax\([^)]*\)|\bauto\b/g) ?? []).length;
  // Adding a selection cell without a column silently wraps the row.
  assert.ok(declared >= 5, `the row renders five cells but declares ${declared} columns`);
  assert.match(rule, /:not\(:has\(\.document-row-select\)\)/, "and four when selection is hidden");
});
