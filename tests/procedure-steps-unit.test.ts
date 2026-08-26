import assert from "node:assert/strict";
import test from "node:test";

import {
  completionBlockers,
  deriveProgress,
  isProcedureStatus,
  isStepStatus,
  PROCEDURE_LABELS,
  PROCEDURE_STATUSES,
  progressLabel,
  refusePublish,
  refuseTransition,
  sequence,
  STEP_LABELS,
  STEP_STATUSES,
  type StepRecord,
  type StepStatus,
} from "../lib/procedures/steps";

const step = (position: number, status: StepStatus, mandatory = true): StepRecord & { title: string } =>
  ({ mandatory, position, status, title: `Step ${position}` });

/** Mirrors the resolution in `procedureInForce`, which the repository applies. */
const inForce = <T extends { effectiveFrom: string; version: number }>(rows: readonly T[], dateKey: string): T | null => {
  const started = rows.filter((row) => row.effectiveFrom <= dateKey);
  if (started.length === 0) return null;
  return started.reduce((chosen, row) => {
    if (row.effectiveFrom !== chosen.effectiveFrom) return row.effectiveFrom > chosen.effectiveFrom ? row : chosen;
    return row.version > chosen.version ? row : chosen;
  });
};

test("no procedure means no derived progress, so the typed figure survives", () => {
  // Work raised for a service the firm has not written a procedure for must
  // keep behaving exactly as it did before any of this existed.
  const progress = deriveProgress([]);
  assert.equal(progress.percent, null);
  assert.equal(progress.total, 0);
  assert.equal(progressLabel(progress), "No procedure");
});

test("progress is counted from settled steps, not claimed", () => {
  const progress = deriveProgress([
    step(1, "done"), step(2, "done"), step(3, "done"), step(4, "done"),
    step(5, "pending"), step(6, "pending"), step(7, "pending"),
  ]);
  assert.equal(progress.settled, 4);
  assert.equal(progress.total, 7);
  assert.equal(progress.percent, 57, "four of seven, floored");
  assert.equal(progressLabel(progress), "4 of 7 steps");
});

test("a step deliberately marked not applicable counts as settled", () => {
  // The firm has decided about it, which is what progress measures.
  const progress = deriveProgress([step(1, "done"), step(2, "not_applicable"), step(3, "pending")]);
  assert.equal(progress.settled, 2);
  assert.equal(progress.outstanding, 1);
});

test("progress never reads complete while anything is outstanding", () => {
  // 199 of 200 steps rounds to 100% on any ordinary rounding. It must not.
  const nearly = deriveProgress(Array.from({ length: 200 }, (_unused, index) => step(index + 1, index === 199 ? "pending" : "done")));
  assert.equal(nearly.percent, 99);
  assert.equal(nearly.outstanding, 1);

  const finished = deriveProgress([step(1, "done"), step(2, "not_applicable")]);
  assert.equal(finished.percent, 100, "everything settled is genuinely 100");
});

test("an untouched procedure is zero, not a number somebody felt like", () => {
  const progress = deriveProgress([step(1, "pending"), step(2, "pending")]);
  assert.equal(progress.percent, 0);
  assert.equal(progress.outstandingMandatory, 2);
});

test("only mandatory steps stop a completion", () => {
  const blockers = completionBlockers([
    step(1, "done"),
    step(2, "pending", false),
    step(3, "pending"),
    step(4, "pending"),
  ]);
  assert.deepEqual(blockers.map((blocker) => blocker.position), [3, 4]);
  // Refusing on optional steps would teach everybody to mark them optional.
  assert.ok(!blockers.some((blocker) => blocker.position === 2));
});

test("blockers come back in the order the firm performs them", () => {
  const blockers = completionBlockers([step(7, "pending"), step(2, "pending"), step(5, "pending")]);
  assert.deepEqual(blockers.map((blocker) => blocker.position), [2, 5, 7]);
});

test("a fully settled procedure blocks nothing", () => {
  assert.deepEqual(completionBlockers([step(1, "done"), step(2, "not_applicable")]), []);
  assert.deepEqual(completionBlockers([]), [], "and neither does an absent one");
});

test("skipping a step requires saying why", () => {
  // A step skipped without a reason cannot be told from one forgotten, which is
  // precisely what this whole record exists to prevent.
  assert.equal(refuseTransition({ note: "", status: "not_applicable" }), "reason_required");
  assert.equal(refuseTransition({ note: "  ", status: "not_applicable" }), "reason_required");
  assert.equal(refuseTransition({ note: "Client is unregistered for GST", status: "not_applicable" }), null);
});

test("done and pending need no reason, and an unknown status is refused", () => {
  assert.equal(refuseTransition({ note: "", status: "done" }), null);
  assert.equal(refuseTransition({ note: "", status: "pending" }), null);
  assert.equal(refuseTransition({ note: "", status: "skipped" as StepStatus }), "unknown_status");
});

test("a procedure with no steps cannot be published", () => {
  assert.equal(refusePublish({ status: "draft", stepCount: 0 }), "no_steps");
  assert.equal(refusePublish({ status: "draft", stepCount: 1 }), null);
});

test("a published procedure is sealed; changing it means a new version", () => {
  assert.equal(refusePublish({ status: "published", stepCount: 5 }), "already_published");
  assert.equal(refusePublish({ status: "archived", stepCount: 5 }), "already_published");
});

test("steps are renumbered into a contiguous run, and blanks are dropped", () => {
  const ordered = sequence([
    { instruction: " Pull the register ", mandatory: true, title: " Reconcile sales " },
    { instruction: "", mandatory: true, title: "  " },
    { instruction: "", mandatory: false, title: "Optional cross-check" },
    { instruction: "", mandatory: true, title: "File on the portal" },
  ]);
  assert.deepEqual(ordered.map((entry) => entry.position), [1, 2, 3], "no gaps where the blank row was");
  assert.equal(ordered[0]!.title, "Reconcile sales", "trimmed");
  assert.equal(ordered[0]!.instruction, "Pull the register");
  assert.equal(ordered[1]!.mandatory, false);
});

test("a title too short to mean anything is not a step", () => {
  assert.deepEqual(sequence([{ instruction: "", mandatory: true, title: "x" }]), []);
});

test("two published versions sharing an effective date resolve by version", () => {
  // A firm correcting a procedure it published this morning gives both the same
  // effective date. Without a tie-break the answer depends on the order the
  // database returns rows in, which is no answer at all.
  const rows = [
    { effectiveFrom: "2026-01-01", id: "old", version: 1 },
    { effectiveFrom: "2026-01-01", id: "corrected", version: 2 },
    { effectiveFrom: "2026-10-01", id: "future", version: 3 },
  ];
  assert.equal(inForce(rows, "2026-09-20")?.id, "corrected", "the later version supersedes");
  assert.equal(inForce([...rows].reverse(), "2026-09-20")?.id, "corrected", "and does so whatever the row order");
  assert.equal(inForce(rows, "2026-10-01")?.id, "future");
  assert.equal(inForce(rows, "2025-12-31"), null, "nothing had started yet");
});

test("only the listed statuses are statuses, and each reads as English", () => {
  assert.ok(isStepStatus("not_applicable"));
  assert.ok(!isStepStatus("skipped"));
  assert.ok(isProcedureStatus("published"));
  assert.ok(!isProcedureStatus("live"));
  for (const status of STEP_STATUSES) assert.ok(STEP_LABELS[status].length > 0);
  for (const status of PROCEDURE_STATUSES) assert.ok(PROCEDURE_LABELS[status].length > 0);
});
