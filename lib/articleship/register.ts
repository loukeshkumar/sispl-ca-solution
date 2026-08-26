/**
 * Articleship arithmetic.
 *
 * A firm that trains articled assistants has a statutory record to keep, and it
 * was being kept in a spreadsheet: who is registered under whom, from when, how
 * much leave they have earned, and when their training actually finishes once
 * that leave is accounted for.
 *
 * The figures the arithmetic runs on — the training period, the leave fraction —
 * are the firm's, not this module's. ICAI revises them by notification, and a
 * number written into software is a number nobody can correct.
 */

const DAY_MS = 86_400_000;

export type ArticleshipStatus = "active" | "transferred" | "terminated" | "completed";

export const ARTICLESHIP_STATUSES: readonly ArticleshipStatus[] = ["active", "transferred", "terminated", "completed"];

export const STATUS_LABELS: Record<ArticleshipStatus, string> = {
  active: "In training",
  transferred: "Transferred out",
  terminated: "Terminated",
  completed: "Completed",
};

export const STATUS_TONE: Record<ArticleshipStatus, "mint" | "amber" | "red" | "blue"> = {
  active: "mint",
  transferred: "blue",
  terminated: "red",
  completed: "mint",
};

export const isArticleshipStatus = (value: string): value is ArticleshipStatus =>
  (ARTICLESHIP_STATUSES as readonly string[]).includes(value);

export type LeaveFraction = { denominator: number; numerator: number };

export type ArticleshipPolicy = {
  /** False until somebody has checked these against the current notification. */
  confirmed: boolean;
  effectiveFrom: string;
  leaveFraction: LeaveFraction;
  trainingMonths: number;
};

export function addMonths(dateKey: string, months: number): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const target = new Date(Date.UTC(year!, month! - 1 + months, 1));
  // Clamp rather than roll: three years from 31 May is 31 May, and a month that
  // has no 31st ends on its own last day instead of drifting into the next.
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  return `${target.getUTCFullYear()}-${String(target.getUTCMonth() + 1).padStart(2, "0")}-${String(Math.min(day!, lastDay)).padStart(2, "0")}`;
}

export function addDays(dateKey: string, days: number): string {
  return new Date(Date.parse(`${dateKey}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Inclusive day count, the way a training period is actually counted. */
export function daysBetween(fromKey: string, toKey: string): number {
  if (toKey < fromKey) return 0;
  return Math.round((Date.parse(`${toKey}T00:00:00Z`) - Date.parse(`${fromKey}T00:00:00Z`)) / DAY_MS) + 1;
}

export type ArticleshipInput = {
  commencedOn: string;
  /** Null while the article is still in training. */
  endedOn: string | null;
  leaveDaysTaken: number;
  leaveFraction: LeaveFraction;
  status: ArticleshipStatus;
  todayKey: string;
  trainingMonths: number;
};

export type ArticleshipTerm = {
  /** Where the training ends once excess leave is served. */
  expectedCompletionOn: string;
  /** Leave earned so far: a fraction of the period actually served. */
  leaveEntitlementDays: number;
  leaveTakenDays: number;
  /** Leave beyond entitlement, which has to be served and so extends the term. */
  excessLeaveDays: number;
  /** Calendar days elapsed since commencement, capped at the end. */
  elapsedDays: number;
  /** Elapsed less leave: the period actually served. */
  servedDays: number;
  /** The term before any extension, for showing what the extension cost. */
  scheduledCompletionOn: string;
  /** Null once the article is no longer in training. */
  remainingDays: number | null;
};

/**
 * The term, and what leave has done to it.
 *
 * Leave is earned against the period actually served, not against the calendar,
 * so a day of leave both fails to earn entitlement and consumes it. Leave beyond
 * what has been earned has to be served, which is why the completion date moves
 * rather than the leave being refused — an article is entitled to be ill.
 */
export function computeTerm(input: ArticleshipInput): ArticleshipTerm {
  const scheduledCompletionOn = addMonths(input.commencedOn, input.trainingMonths);
  const asAt = input.endedOn ?? (input.todayKey < scheduledCompletionOn ? input.todayKey : scheduledCompletionOn);
  const elapsedDays = daysBetween(input.commencedOn, asAt);
  const leaveTakenDays = Math.max(0, Math.min(input.leaveDaysTaken, elapsedDays));
  const servedDays = Math.max(0, elapsedDays - leaveTakenDays);

  const { denominator, numerator } = input.leaveFraction;
  const leaveEntitlementDays = denominator > 0
    ? Math.floor((servedDays * numerator) / denominator)
    : 0;
  const excessLeaveDays = Math.max(0, leaveTakenDays - leaveEntitlementDays);
  const expectedCompletionOn = excessLeaveDays > 0
    ? addDays(scheduledCompletionOn, excessLeaveDays)
    : scheduledCompletionOn;

  return {
    elapsedDays,
    excessLeaveDays,
    expectedCompletionOn,
    leaveEntitlementDays,
    leaveTakenDays,
    remainingDays: input.status === "active"
      ? Math.max(0, daysBetween(input.todayKey, expectedCompletionOn) - 1)
      : null,
    scheduledCompletionOn,
    servedDays,
  };
}

export type ArticleshipAlert = "none" | "leave_exceeded" | "completing_soon" | "overdue_completion" | "forms_missing";

export type AlertInput = {
  form103Date: string | null;
  status: ArticleshipStatus;
  term: ArticleshipTerm;
};

/** How near completion has to be before the paperwork needs starting. */
export const COMPLETION_NOTICE_DAYS = 60;

/**
 * What needs attention on one registration, most pressing first.
 *
 * Missing registration paperwork leads, because an article training without a
 * lodged Form 103 is training the firm cannot later evidence.
 */
export function alertsFor({ form103Date, status, term }: AlertInput): ArticleshipAlert[] {
  if (status !== "active") return [];
  const alerts: ArticleshipAlert[] = [];
  if (!form103Date) alerts.push("forms_missing");
  if (term.excessLeaveDays > 0) alerts.push("leave_exceeded");
  if (term.remainingDays !== null) {
    if (term.remainingDays === 0) alerts.push("overdue_completion");
    else if (term.remainingDays <= COMPLETION_NOTICE_DAYS) alerts.push("completing_soon");
  }
  return alerts;
}

export const ALERT_LABELS: Record<Exclude<ArticleshipAlert, "none">, string> = {
  forms_missing: "Form 103 not recorded",
  leave_exceeded: "Leave beyond entitlement",
  completing_soon: "Completing soon",
  overdue_completion: "Term has run out",
};

export const ALERT_NOTES: Record<Exclude<ArticleshipAlert, "none">, string> = {
  forms_missing: "Training the firm cannot evidence. Record the registration date.",
  leave_exceeded: "The excess has to be served, so the completion date has moved out.",
  completing_soon: "Form 108 will be due. Start the completion paperwork.",
  overdue_completion: "The term has ended and the registration is still open.",
};

export const ALERT_TONE: Record<Exclude<ArticleshipAlert, "none">, "red" | "amber" | "blue"> = {
  forms_missing: "red",
  leave_exceeded: "amber",
  completing_soon: "blue",
  overdue_completion: "red",
};

export const fractionLabel = (fraction: LeaveFraction) => `${fraction.numerator}/${fraction.denominator}`;

/** Years and months, because a training period is spoken about in both. */
export function termLabel(months: number): string {
  const years = Math.floor(months / 12);
  const rest = months % 12;
  if (years === 0) return `${months} month${months === 1 ? "" : "s"}`;
  if (rest === 0) return `${years} year${years === 1 ? "" : "s"}`;
  return `${years}y ${rest}m`;
}
