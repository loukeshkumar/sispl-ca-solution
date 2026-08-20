import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { buildRecurringWorkDrafts } from "../lib/compliance/recurrence";
import { diffCoverage, isEntitledAt, type EntitlementWindow } from "../lib/compliance/coverage";
import { buildComplianceMatrix } from "../lib/compliance/matrix";
import { complianceHref, COMPLIANCE_PRESETS, DEFAULT_COMPLIANCE_PARAMS, parseComplianceParams } from "../lib/compliance/queue-params";

const window = (over: Partial<EntitlementWindow> = {}): EntitlementWindow => ({
  effectiveFrom: "2026-04-01",
  effectiveTo: null,
  legalEntityId: "40000000-0000-4000-8000-000000000001",
  serviceCode: "GST",
  ...over,
});

test("entitlement includes its first day and excludes the day before", () => {
  assert.equal(isEntitledAt(window(), "2026-04-01"), true);
  assert.equal(isEntitledAt(window(), "2026-03-31"), false);
});

test("an open-ended entitlement never expires", () => {
  assert.equal(isEntitledAt(window(), "2099-01-01"), true);
});

test("a closed entitlement includes its last day and excludes the day after", () => {
  const closed = window({ effectiveTo: "2026-06-30" });
  assert.equal(isEntitledAt(closed, "2026-06-30"), true);
  assert.equal(isEntitledAt(closed, "2026-07-01"), false);
});

test("a client onboarded recently is not held to obligations from before they engaged", () => {
  // The whole point of evaluating entitlement per period: applying today's
  // entitlements backwards would invent months of missed filings for a client
  // who was never engaged for them.
  const recent = window({ effectiveFrom: "2026-08-01" });
  assert.equal(isEntitledAt(recent, "2026-05-20"), false);
  assert.equal(isEntitledAt(recent, "2026-08-20"), true);
});

const schedule = { serviceCode: "GST", frequency: "monthly" as const, dueMonthOffset: 1, dueDay: 20, internalLeadDays: 3 };
const entitlements = [{ legalEntityId: "40000000-0000-4000-8000-000000000001", serviceCode: "GST" }];

test("the generator's behaviour is unchanged when no lookback is given", () => {
  // fromKey defaults to todayKey, so the daily job keeps producing exactly what
  // it produced before coverage existed.
  const withoutFrom = buildRecurringWorkDrafts({ schedules: [schedule], entitlements, todayKey: "2026-08-21" });
  const withToday = buildRecurringWorkDrafts({ schedules: [schedule], entitlements, todayKey: "2026-08-21", fromKey: "2026-08-21" });
  assert.deepEqual(withoutFrom, withToday);
  assert.ok(withoutFrom.every((draft) => draft.statutoryDueDate >= "2026-08-21"), "nothing already due is generated");
});

test("a lookback surfaces periods whose deadline has already passed", () => {
  const past = buildRecurringWorkDrafts({ schedules: [schedule], entitlements, todayKey: "2026-08-21", fromKey: "2026-05-01" });
  const future = buildRecurringWorkDrafts({ schedules: [schedule], entitlements, todayKey: "2026-08-21" });
  assert.ok(past.length > future.length, "looking back must find more than looking forward alone");
  assert.ok(past.some((draft) => draft.statutoryDueDate < "2026-08-21"), "an already-passed deadline is included");
  assert.ok(past.every((draft) => draft.statutoryDueDate >= "2026-05-01"), "nothing before the lookback window");
});

test("coverage reports only obligations with no work item on the same composite key", () => {
  const expected = [
    { legalEntityId: "c1", serviceKey: "GST", periodKey: "July 2026", statutoryDueDate: "2026-08-20", internalDueDate: "2026-08-17" },
    { legalEntityId: "c1", serviceKey: "GST", periodKey: "August 2026", statutoryDueDate: "2026-09-20", internalDueDate: "2026-09-17" },
    { legalEntityId: "c2", serviceKey: "GST", periodKey: "July 2026", statutoryDueDate: "2026-08-20", internalDueDate: "2026-08-17" },
  ];
  const existing = [{ legalEntityId: "c1", serviceKey: "GST", periodKey: "July 2026" }];
  const gaps = diffCoverage(expected, existing);
  assert.equal(gaps.length, 2);
  assert.deepEqual(gaps.map((gap) => `${gap.legalEntityId}:${gap.periodKey}`), ["c1:August 2026", "c2:July 2026"]);
});

test("coverage matches service keys case-insensitively, because stored keys are inconsistent", () => {
  // Seeded work carries keys like 'gstr_3b'; generated work carries 'GST'.
  const expected = [{ legalEntityId: "c1", serviceKey: "GST", periodKey: "July 2026", statutoryDueDate: "2026-08-20", internalDueDate: "2026-08-17" }];
  assert.deepEqual(diffCoverage(expected, [{ legalEntityId: "c1", serviceKey: "gst", periodKey: "July 2026" }]), []);
});

test("an expected obligation already raised under a different period label is still a gap", () => {
  const expected = [{ legalEntityId: "c1", serviceKey: "GST", periodKey: "July 2026", statutoryDueDate: "2026-08-20", internalDueDate: "2026-08-17" }];
  assert.equal(diffCoverage(expected, [{ legalEntityId: "c1", serviceKey: "GST", periodKey: "Q2 · FY 26–27" }]).length, 1);
});

test("compliance parameters round-trip and reject nonsense", () => {
  const params = parseComplianceParams({ evidence: "missing", service: "gst", status: "Overdue", view: "matrix" });
  assert.equal(params.service, "GST", "service keys are compared uppercase throughout");
  assert.deepEqual(parseComplianceParams(Object.fromEntries(new URL(`http://x${complianceHref(params)}`).searchParams)), params);
  assert.deepEqual(parseComplianceParams({ evidence: "maybe", service: "!!", status: "Vibes", view: "gantt" }), DEFAULT_COMPLIANCE_PARAMS);
});

test("every compliance preset parses back to its own parameters", () => {
  for (const preset of COMPLIANCE_PRESETS) {
    const href = complianceHref(preset.params);
    assert.ok(href.startsWith("/?workspace=compliance"));
    const parsed = parseComplianceParams(Object.fromEntries(new URL(`http://x${href}`).searchParams));
    for (const [key, value] of Object.entries(preset.params)) {
      assert.deepEqual(parsed[key as keyof typeof parsed], value, `${preset.key}.${key}`);
    }
  }
});

test("the matrix keeps a hole where no obligation was raised", () => {
  const matrix = buildComplianceMatrix([
    { clientName: "Beta", id: "w1", legalEntityId: "c2", periodKey: "July 2026", status: "waiting" },
    { clientName: "Alpha", id: "w2", legalEntityId: "c1", periodKey: "July 2026", status: "review" },
    { clientName: "Alpha", id: "w3", legalEntityId: "c1", periodKey: "August 2026", status: "critical" },
  ]);
  assert.deepEqual(matrix.periods, ["August 2026", "July 2026"], "periods sort deterministically");
  assert.deepEqual(matrix.rows.map((row) => row.clientName), ["Alpha", "Beta"], "clients sort by name");
  const beta = matrix.rows.find((row) => row.clientName === "Beta")!;
  const august = beta.cells.find((cell) => cell.periodKey === "August 2026")!;
  // A missing obligation must be a visible hole, not an absent cell that
  // silently shortens the row.
  assert.equal(august.status, null);
  assert.equal(august.id, null);
  assert.equal(beta.cells.length, matrix.periods.length);
});

test("the matrix bounds its columns so a long history cannot widen the grid forever", () => {
  const rows = Array.from({ length: 12 }, (_unused, index) => ({
    clientName: "Alpha", id: `w${index}`, legalEntityId: "c1",
    periodKey: `2026-${String(index + 1).padStart(2, "0")}`, status: "waiting",
  }));
  assert.equal(buildComplianceMatrix(rows, 6).periods.length, 6);
  assert.equal(buildComplianceMatrix(rows, 6).periods.at(-1), "2026-12", "the most recent periods are kept");
});

test("the compliance register declares a column for every cell it renders", async () => {
  const [workspace, css] = await Promise.all([
    readFile(new URL("../app/dashboard/compliance-workspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  // The row gained an evidence cell while the grid still declared five columns,
  // which pushed the arrow onto its own row and collided evidence with status.
  const rule = css.slice(css.indexOf(".compliance-register-list > a {"));
  const columns = rule.slice(rule.indexOf("grid-template-columns:"), rule.indexOf("}"));
  const declared = (columns.match(/minmax\([^)]*\)|\bauto\b|\d+px/g) ?? []).length;
  assert.ok(declared >= 6, `the register renders six cells but declares ${declared} columns`);
  assert.ok(workspace.includes("compliance-evidence"), "the evidence cell is the sixth");
});

test("service readiness rows keep their grid after becoming links", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  const rule = css.slice(css.indexOf(".compliance-health-card > div"), css.indexOf(".compliance-deadline-card > div"));
  // Drilling through turned these rows from divs into anchors; a rule targeting
  // only divs left them as inline links with the bar stacked underneath.
  assert.match(rule, /\.compliance-health-card > a/, "the grid must cover links too");
  assert.match(rule, /grid-template-columns: 48px 1fr 34px/);
});
