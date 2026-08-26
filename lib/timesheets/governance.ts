/**
 * Time, governed.
 *
 * It was collected and nothing else. An entry could be made for any date, edited
 * for ever, and deleted by whoever made it. No month was ever approved, nothing
 * froze once an invoice had been raised against it, and the figure a client was
 * quoted on Tuesday could be a different figure on Friday with no record that it
 * had moved.
 *
 * Three things govern it now, and they are separate on purpose:
 *
 *   the window    how late a person may record their own time
 *   the period    submitted by the person, approved by somebody else
 *   the freeze    an approved month is a statement, not a working note
 */

export type PeriodStatus = "open" | "submitted" | "approved";

export const PERIOD_STATUSES: readonly PeriodStatus[] = ["open", "submitted", "approved"];

export const PERIOD_LABELS: Record<PeriodStatus, string> = {
  approved: "Approved",
  open: "Open",
  submitted: "With the reviewer",
};

export const PERIOD_TONE: Record<PeriodStatus, "mint" | "blue" | "slate"> = {
  approved: "mint",
  open: "slate",
  submitted: "blue",
};

export const isPeriodStatus = (value: string): value is PeriodStatus =>
  (PERIOD_STATUSES as readonly string[]).includes(value);

export type TimesheetPolicy = {
  allowFutureDates: boolean;
  backdateWindowDays: number;
  expectedMonthlyMinutes: number | null;
};

/** What the firm falls back to before it has said anything. */
export const DEFAULT_POLICY: TimesheetPolicy = {
  allowFutureDates: false,
  backdateWindowDays: 14,
  expectedMonthlyMinutes: null,
};

/** `2026-12-14` → `2026-12`. The month an entry belongs to. */
export const periodKeyOf = (dateKey: string) => dateKey.slice(0, 7);

export function daysBetween(fromKey: string, toKey: string) {
  return Math.round((Date.parse(`${toKey}T00:00:00Z`) - Date.parse(`${fromKey}T00:00:00Z`)) / 86_400_000);
}

export type EntryRefusal =
  | "period_approved" | "period_submitted" | "outside_window" | "future_date"
  | "reason_required" | "not_permitted" | "invalid_date";

export const ENTRY_REFUSAL_NOTES: Record<EntryRefusal, string> = {
  future_date: "Time cannot be recorded against a date that has not happened.",
  invalid_date: "Enter a valid date.",
  not_permitted: "Only a manager can record time outside the firm's window.",
  outside_window: "That date is outside the window for recording your own time. A manager can record it, with a reason.",
  period_approved: "That month has been approved. Ask for it to be reopened before changing anything in it.",
  period_submitted: "That month is with its reviewer. Nothing in it can change until they decide.",
  reason_required: "Say why this is being recorded late.",
};

/**
 * Whether one entry may be written at all.
 *
 * The order matters: an approved month refuses everybody, including a manager
 * with a reason, because the point of approval is that the number stopped
 * moving. Reopening it is a deliberate act with its own record.
 */
export function refuseEntry(input: {
  actorIsManager: boolean;
  /** Present only where the actor is recording on somebody else's behalf. */
  backdateReason: string;
  entryDate: string;
  periodStatus: PeriodStatus;
  policy: TimesheetPolicy;
  todayKey: string;
}): EntryRefusal | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.entryDate)) return "invalid_date";
  if (input.periodStatus === "approved") return "period_approved";
  if (input.periodStatus === "submitted") return "period_submitted";

  const age = daysBetween(input.entryDate, input.todayKey);
  if (age < 0 && !input.policy.allowFutureDates) return "future_date";
  if (age <= input.policy.backdateWindowDays) return null;

  // Beyond the window. A manager may still record it, saying why.
  if (!input.actorIsManager) return "outside_window";
  if (input.backdateReason.trim().length < 3) return "reason_required";
  return null;
}

/** True where this entry needs a reason and a manager to exist at all. */
export function needsBackdateReason(input: {
  entryDate: string;
  policy: TimesheetPolicy;
  todayKey: string;
}) {
  return daysBetween(input.entryDate, input.todayKey) > input.policy.backdateWindowDays;
}

export type SubmitRefusal = "already_submitted" | "already_approved" | "nothing_logged" | "period_incomplete";

export const SUBMIT_REFUSAL_NOTES: Record<SubmitRefusal, string> = {
  already_approved: "That month has already been approved.",
  already_submitted: "That month is already with its reviewer.",
  nothing_logged: "There is no time recorded for that month, so there is nothing to submit.",
  period_incomplete: "That month has not finished yet.",
};

/**
 * Whether a month can be sent for approval.
 *
 * A month still running cannot be submitted: half a month approved is a
 * statement about a period that has not happened, and the entries that arrive
 * afterwards would have nowhere to go.
 */
export function refuseSubmit(input: {
  loggedMinutes: number;
  periodKey: string;
  status: PeriodStatus;
  todayKey: string;
}): SubmitRefusal | null {
  if (input.status === "approved") return "already_approved";
  if (input.status === "submitted") return "already_submitted";
  if (input.periodKey >= periodKeyOf(input.todayKey)) return "period_incomplete";
  if (input.loggedMinutes <= 0) return "nothing_logged";
  return null;
}

export type DecideRefusal = "not_submitted" | "self_approval" | "reason_required" | "unknown_outcome";

export const DECIDE_REFUSAL_NOTES: Record<DecideRefusal, string> = {
  not_submitted: "That month is not with a reviewer.",
  reason_required: "Say what needs correcting before returning a month.",
  self_approval: "You cannot approve your own timesheet.",
  unknown_outcome: "Choose whether the month is approved or returned.",
};

/**
 * Whether a decision may be recorded.
 *
 * Self-approval is refused here and by a database constraint, because a
 * timesheet somebody signed off for themselves is not a control — it is the
 * same person's word twice.
 */
export function refuseDecision(input: {
  actorUserId: string;
  employeeUserId: string;
  note: string;
  outcome: string;
  status: PeriodStatus;
}): DecideRefusal | null {
  if (input.status !== "submitted") return "not_submitted";
  if (input.outcome !== "approved" && input.outcome !== "returned") return "unknown_outcome";
  if (input.actorUserId === input.employeeUserId) return "self_approval";
  if (input.outcome === "returned" && input.note.trim().length < 3) return "reason_required";
  return null;
}

export type ReopenRefusal = "not_approved" | "reason_required";

export const REOPEN_REFUSAL_NOTES: Record<ReopenRefusal, string> = {
  not_approved: "Only an approved month is reopened; this one is still open.",
  reason_required: "Say why an approved month is being reopened. That is the whole record of it.",
};

export function refuseReopen(input: { reason: string; status: PeriodStatus }): ReopenRefusal | null {
  if (input.status !== "approved") return "not_approved";
  if (input.reason.trim().length < 3) return "reason_required";
  return null;
}

export type PeriodStanding = {
  /** Minutes recorded now, which may differ from what was submitted. */
  loggedMinutes: number;
  /** True where the month has moved since it was submitted. */
  changedSinceSubmission: boolean;
  /** Null where the firm has set no expectation. */
  completeness: number | null;
  frozen: boolean;
  status: PeriodStatus;
};

/**
 * Where one month stands.
 *
 * `changedSinceSubmission` exists because the submitted total is snapshotted:
 * a month that reads differently from the figure a reviewer was shown is worth
 * saying out loud rather than leaving to be noticed.
 */
export function standingOf(input: {
  expectedMinutes: number | null;
  loggedMinutes: number;
  status: PeriodStatus;
  submittedMinutes: number | null;
}): PeriodStanding {
  return {
    changedSinceSubmission: input.submittedMinutes !== null && input.submittedMinutes !== input.loggedMinutes,
    completeness: input.expectedMinutes && input.expectedMinutes > 0
      ? Math.round((input.loggedMinutes / input.expectedMinutes) * 100)
      : null,
    frozen: input.status !== "open",
    loggedMinutes: input.loggedMinutes,
    status: input.status,
  };
}

const hours = (minutes: number) => `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;

/** How the month reads at a glance. */
export function periodSummary(standing: PeriodStanding): string {
  const total = hours(standing.loggedMinutes);
  const complete = standing.completeness === null ? "" : ` · ${standing.completeness}% of what the firm expects`;
  if (standing.status === "open") return `${total} recorded${complete} · still open`;
  if (standing.status === "submitted") {
    return `${total} with the reviewer${standing.changedSinceSubmission ? " · changed since it was submitted" : ""}`;
  }
  return `${total} approved${complete}`;
}
