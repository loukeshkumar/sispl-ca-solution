/**
 * What the firm loses when somebody leaves.
 *
 * Offboarding was a status flip: the account was disabled, the sessions revoked,
 * and everything the person actually held stayed exactly where it was. A signing
 * token in a drawer nobody can now account for, a filing assigned to an account
 * that cannot log in, a service the departing person was the only reviewer for —
 * none of it was visible at the one moment it mattered.
 *
 * None of this is typed in. It is derived from what the firm already records,
 * which is the only kind of checklist that cannot be ticked without being true.
 */

export type ClearanceSeverity = "blocking" | "warning" | "note";

export type ClearanceItem = {
  /** What to do about it, in the words of somebody who has to do it. */
  action: string;
  count: number;
  detail: string;
  id: string;
  severity: ClearanceSeverity;
  title: string;
};

export type ClearanceInput = {
  /** Certificates the person is custodian of record for, live or signed out. */
  dscInCustody: number;
  leaveToEncashHalfDays: number;
  openOfficeTasksAssigned: number;
  openOfficeTasksReviewing: number;
  openWorkAssigned: number;
  openWorkReviewing: number;
  reportees: number;
  /** Services where this person is the only one who can review. */
  soleReviewerServices: string[];
};

export type Clearance = {
  /** True when nothing blocks; warnings may still need a recorded reason. */
  clear: boolean;
  items: ClearanceItem[];
  /** Set when the exit needs a Super Admin to say why it is going ahead. */
  needsReason: boolean;
};

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/**
 * The clearance, ordered by what stops the exit first.
 *
 * Custody and open delivery block: a firm cannot afford to lose track of a
 * signing token, and an obligation assigned to a disabled account is an
 * obligation nobody is doing. Everything else is a warning the firm can proceed
 * past, provided it says why — because the alternative is a departed employee
 * keeping their login while payroll argues about encashment.
 */
export function buildClearance(input: ClearanceInput): Clearance {
  const items: ClearanceItem[] = [];

  if (input.dscInCustody > 0) {
    items.push({
      action: "Record their return or reassign custody in the DSC register.",
      count: input.dscInCustody,
      detail: "A signing token whose custodian cannot log in is a token nobody is accountable for.",
      id: "dsc-custody",
      severity: "blocking",
      title: `${plural(input.dscInCustody, "digital signature", "digital signatures")} in their custody`,
    });
  }

  if (input.openWorkAssigned > 0) {
    items.push({
      action: "Reassign or complete them before the account is disabled.",
      count: input.openWorkAssigned,
      detail: "A statutory obligation assigned to a disabled account is an obligation nobody is doing.",
      id: "work-assigned",
      severity: "blocking",
      title: `${plural(input.openWorkAssigned, "open obligation", "open obligations")} assigned to them`,
    });
  }

  if (input.openWorkReviewing > 0) {
    items.push({
      action: "Name another reviewer on each item.",
      count: input.openWorkReviewing,
      detail: "Work waiting on a review that can no longer happen will sit until its deadline.",
      id: "work-reviewing",
      severity: "blocking",
      title: `${plural(input.openWorkReviewing, "obligation", "obligations")} waiting on their review`,
    });
  }

  if (input.openOfficeTasksAssigned > 0) {
    items.push({
      action: "Reassign, complete, or cancel them.",
      count: input.openOfficeTasksAssigned,
      detail: "Open tasks on a disabled account are invisible to everyone else.",
      id: "tasks-assigned",
      severity: "blocking",
      title: `${plural(input.openOfficeTasksAssigned, "open task", "open tasks")} assigned to them`,
    });
  }

  if (input.openOfficeTasksReviewing > 0) {
    items.push({
      action: "Name another reviewer, or accept that these will need one later.",
      count: input.openOfficeTasksReviewing,
      detail: "The work can continue; only the review has lost its owner.",
      id: "tasks-reviewing",
      severity: "warning",
      title: `${plural(input.openOfficeTasksReviewing, "task", "tasks")} waiting on their review`,
    });
  }

  if (input.reportees > 0) {
    items.push({
      action: "Point their reportees at another manager.",
      count: input.reportees,
      detail: "A reporting line to a disabled account leaves nobody able to approve leave or corrections.",
      id: "reportees",
      severity: "warning",
      title: `${plural(input.reportees, "person reports", "people report")} to them`,
    });
  }

  if (input.soleReviewerServices.length > 0) {
    items.push({
      action: "Record review capability for somebody else, or accept the gap knowingly.",
      count: input.soleReviewerServices.length,
      detail: `Nobody else can review ${input.soleReviewerServices.join(", ")}. Work on those services will have no valid reviewer.`,
      id: "sole-reviewer",
      severity: "warning",
      title: `Only person who can review ${plural(input.soleReviewerServices.length, "service", "services")}`,
    });
  }

  if (input.leaveToEncashHalfDays > 0) {
    items.push({
      action: "Settle it with payroll. Disabling the account posts the encashment to the leave ledger.",
      count: input.leaveToEncashHalfDays,
      detail: `${(input.leaveToEncashHalfDays / 2).toFixed(1)} days of encashable leave remain unsettled.`,
      id: "leave-encashment",
      severity: "note",
      title: "Leave to encash",
    });
  }

  const blocking = items.some((item) => item.severity === "blocking");
  return {
    clear: items.length === 0,
    items,
    // A note is information, not an obstacle; a warning is a decision somebody
    // has to own, so it asks for a reason rather than a click.
    needsReason: !blocking && items.some((item) => item.severity === "warning"),
  };
}

export const blockingItems = (clearance: Clearance) => clearance.items.filter((item) => item.severity === "blocking");

export type EmploymentStage = "probation" | "confirmed" | "notice" | "exited";

export const EMPLOYMENT_STAGES: readonly EmploymentStage[] = ["probation", "confirmed", "notice", "exited"];

export const STAGE_LABELS: Record<EmploymentStage, string> = {
  probation: "On probation",
  confirmed: "Confirmed",
  notice: "Serving notice",
  exited: "Exited",
};

export const STAGE_TONE: Record<EmploymentStage, "amber" | "mint" | "blue" | "neutral"> = {
  probation: "amber",
  confirmed: "mint",
  notice: "blue",
  exited: "neutral",
};

export const isEmploymentStage = (value: string): value is EmploymentStage =>
  (EMPLOYMENT_STAGES as readonly string[]).includes(value);

/**
 * Whether a probation has run out without anybody deciding.
 *
 * Probation that quietly lapses is the common failure: the date passes, nobody
 * confirms, and the person is neither on probation nor confirmed in anyone's
 * mind. The record should say so rather than let it drift.
 */
export function probationOverdue(
  stage: string,
  probationEndDate: string | null,
  todayKey: string,
): boolean {
  return stage === "probation" && probationEndDate !== null && probationEndDate < todayKey;
}

/** Six months is the usual span; the form offers it and the firm can change it. */
export function defaultProbationEnd(joiningDate: string): string {
  const [year, month, day] = joiningDate.split("-").map(Number);
  const date = new Date(Date.UTC(year!, month! - 1 + 6, day!));
  return date.toISOString().slice(0, 10);
}
