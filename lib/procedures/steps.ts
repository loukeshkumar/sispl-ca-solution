/**
 * Work procedures: the steps a firm follows, and the record that it did.
 *
 * Progress was an integer somebody typed. It could say 60% on a job nobody had
 * started, and nothing anywhere recorded what had actually been done, by whom,
 * or in what order. This is the difference between software that tracks work and
 * software that controls quality — and the project's own non-negotiable that
 * every filing carries an evidence chain cannot be met without it.
 *
 * Everything here is pure. The awkward cases — a step skipped for a reason, a
 * procedure revised after the work was raised, an item whose service has no
 * procedure at all — are settled in tests rather than in production.
 */

export type StepStatus = "pending" | "done" | "not_applicable";

export const STEP_STATUSES: readonly StepStatus[] = ["pending", "done", "not_applicable"];

export const STEP_LABELS: Record<StepStatus, string> = {
  pending: "Not done",
  done: "Done",
  not_applicable: "Not applicable",
};

export const isStepStatus = (value: string): value is StepStatus =>
  (STEP_STATUSES as readonly string[]).includes(value);

export type ProcedureStatus = "draft" | "published" | "archived";

export const PROCEDURE_STATUSES: readonly ProcedureStatus[] = ["draft", "published", "archived"];

export const PROCEDURE_LABELS: Record<ProcedureStatus, string> = {
  draft: "Draft",
  published: "Published",
  archived: "Archived",
};

export const PROCEDURE_TONE: Record<ProcedureStatus, "amber" | "mint" | "neutral"> = {
  draft: "amber",
  published: "mint",
  archived: "neutral",
};

export const isProcedureStatus = (value: string): value is ProcedureStatus =>
  (PROCEDURE_STATUSES as readonly string[]).includes(value);

export type StepRecord = {
  mandatory: boolean;
  position: number;
  status: StepStatus;
};

export type StepProgress = {
  /** Steps neither done nor deliberately skipped. */
  outstanding: number;
  /** Mandatory steps still outstanding. These are what stop a completion. */
  outstandingMandatory: number;
  /** Null when there is no procedure, so the caller keeps the typed figure. */
  percent: number | null;
  settled: number;
  total: number;
};

/**
 * Progress counted rather than claimed.
 *
 * A step deliberately marked not applicable counts as settled: the firm has
 * decided about it, which is what progress is measuring. Rounding is toward
 * zero so a job is never reported complete while anything is outstanding —
 * 99% with one step left is honest; 100% with one step left is not.
 */
export function deriveProgress(steps: readonly StepRecord[]): StepProgress {
  if (steps.length === 0) {
    return { outstanding: 0, outstandingMandatory: 0, percent: null, settled: 0, total: 0 };
  }
  const settled = steps.filter((step) => step.status !== "pending").length;
  const outstanding = steps.length - settled;
  const exact = (settled / steps.length) * 100;
  return {
    outstanding,
    outstandingMandatory: steps.filter((step) => step.status === "pending" && step.mandatory).length,
    percent: settled === steps.length ? 100 : Math.min(99, Math.floor(exact)),
    settled,
    total: steps.length,
  };
}

export type CompletionBlocker = { position: number; title: string };

/**
 * What stops this obligation being marked complete.
 *
 * Only mandatory steps block. An optional step left undone is a choice the firm
 * is entitled to make, and refusing on it would teach people to mark everything
 * optional.
 */
export function completionBlockers(
  steps: readonly (StepRecord & { title: string })[],
): CompletionBlocker[] {
  return steps
    .filter((step) => step.status === "pending" && step.mandatory)
    .sort((left, right) => left.position - right.position)
    .map((step) => ({ position: step.position, title: step.title }));
}

export type StepTransition = {
  note: string;
  status: StepStatus;
};

export type TransitionRefusal = "unknown_status" | "reason_required";

export const REFUSAL_NOTES: Record<TransitionRefusal, string> = {
  unknown_status: "Choose whether the step is done, not done, or not applicable.",
  reason_required: "Say why the step does not apply. A step skipped without a reason cannot be told from one forgotten.",
};

/** Validates a tick before it reaches the database, so the message is a sentence. */
export function refuseTransition(transition: StepTransition): TransitionRefusal | null {
  if (!isStepStatus(transition.status)) return "unknown_status";
  if (transition.status === "not_applicable" && transition.note.trim().length < 3) return "reason_required";
  return null;
}

export type DraftStep = {
  instruction: string;
  mandatory: boolean;
  title: string;
};

/**
 * Renumber steps into a contiguous run from one.
 *
 * Positions carry a unique key, so a procedure edited by inserting and removing
 * rows has to be renumbered rather than left with gaps — and a gap in a
 * numbered procedure reads as a step somebody deleted on purpose.
 */
export function sequence(steps: readonly DraftStep[]): Array<DraftStep & { position: number }> {
  return steps
    .filter((step) => step.title.trim().length >= 2)
    .map((step, index) => ({
      instruction: step.instruction.trim().slice(0, 1000),
      mandatory: step.mandatory,
      position: index + 1,
      title: step.title.trim().slice(0, 200),
    }));
}

export type PublishRefusal = "no_steps" | "already_published";

export const PUBLISH_REFUSAL_NOTES: Record<PublishRefusal, string> = {
  no_steps: "A procedure with no steps would instantiate nothing. Add at least one.",
  already_published: "This version is already published. Draft a new version to change it.",
};

export function refusePublish(input: { status: ProcedureStatus; stepCount: number }): PublishRefusal | null {
  if (input.status !== "draft") return "already_published";
  if (input.stepCount === 0) return "no_steps";
  return null;
}

/** `4 of 7 steps` — the phrase a person would use out loud. */
export const progressLabel = (progress: StepProgress) =>
  progress.total === 0 ? "No procedure" : `${progress.settled} of ${progress.total} steps`;
