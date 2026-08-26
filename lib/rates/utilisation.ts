/**
 * Utilisation: how much of the time the firm paid for it managed to sell.
 *
 * The old measure compared each person to the team median, which sounds
 * reasonable and answers the wrong question — a team that collectively records
 * half of what it works has a healthy-looking median and a serious problem. A
 * target is an absolute the firm commits to in advance, so it stays true when
 * everybody drifts together.
 *
 * Basis points throughout: 8000 is 80%. Percentages invite floats, and a number
 * people are measured against must not drift.
 */

import { rateInForce } from "./valuation";

const MINUTES_PER_HOUR = 60;
const HALF_DAYS_PER_DAY = 2;

export type TargetScope = "role" | "employee";

export type UtilisationTargetRow = {
  effectiveFrom: string;
  employeeUserId: string | null;
  roleKey: string | null;
  scope: TargetScope;
  targetBasisPoints: number;
};

export type ResolvedTarget = {
  basisPoints: number | null;
  /** How the target was arrived at, so a surprising number can be explained. */
  source: "employee" | "role" | "none";
};

/**
 * The target for one person: their own if the firm set one, otherwise their
 * role's. A person with neither is not measured — reported as such rather than
 * assumed to be at zero, which would read as total failure.
 */
export function resolveTarget(
  targets: readonly UtilisationTargetRow[],
  employeeUserId: string,
  roleKey: string,
  dateKey: string,
): ResolvedTarget {
  const own = rateInForce(
    targets.filter((row) => row.scope === "employee" && row.employeeUserId === employeeUserId),
    dateKey,
  );
  if (own) return { basisPoints: own.targetBasisPoints, source: "employee" };

  const byRole = rateInForce(
    targets.filter((row) => row.scope === "role" && row.roleKey === roleKey),
    dateKey,
  );
  if (byRole) return { basisPoints: byRole.targetBasisPoints, source: "role" };

  return { basisPoints: null, source: "none" };
}

export type AvailabilityInput = {
  fullDayMinutes: number;
  /** Half-days of approved leave that fell on days the person was scheduled. */
  leaveHalfDays: number;
  /** Days the person was scheduled to work: the working week, less holidays. */
  scheduledDays: number;
};

export type Availability = {
  availableMinutes: number;
  leaveMinutes: number;
  scheduledMinutes: number;
};

/**
 * Time the firm could actually have sold.
 *
 * Scheduled days already exclude weekends and public holidays; approved leave
 * comes off on top. Somebody on a fortnight's leave is not idle, and measuring
 * them as half-utilised would make the number useless for managing anyone.
 */
export function availability({ fullDayMinutes, leaveHalfDays, scheduledDays }: AvailabilityInput): Availability {
  const scheduledMinutes = Math.max(0, scheduledDays) * Math.max(0, fullDayMinutes);
  const leaveMinutes = Math.min(
    scheduledMinutes,
    Math.round((Math.max(0, leaveHalfDays) * fullDayMinutes) / HALF_DAYS_PER_DAY),
  );
  return { availableMinutes: scheduledMinutes - leaveMinutes, leaveMinutes, scheduledMinutes };
}

/** Basis points of `part` in `whole`. Null when there is nothing to divide by. */
export function shareBasisPoints(part: number, whole: number): number | null {
  if (whole <= 0) return null;
  return Math.round((part / whole) * 10_000);
}

export type UtilisationBand = "unmeasured" | "under" | "on_target" | "over";

export type PersonUtilisation = {
  availableMinutes: number;
  band: UtilisationBand;
  chargeableMinutes: number;
  employeeUserId: string;
  fullName: string;
  leaveMinutes: number;
  /** Scheduled time with no timesheet against it at all. */
  missingMinutes: number;
  recordedMinutes: number;
  /** Recorded against available: whether the timesheet was filled in. */
  recordingBps: number | null;
  roleKey: string;
  scheduledMinutes: number;
  targetBasisPoints: number | null;
  targetSource: ResolvedTarget["source"];
  /** Chargeable against available: the number the practice is managed by. */
  utilisationBps: number | null;
  /** Points above or below target. Null when either side is unknown. */
  varianceBps: number | null;
};

/**
 * Anything within this of target counts as meeting it. Utilisation is a
 * measure of a whole month's judgement calls; treating 79.9% as a miss and
 * 80.1% as a hit would be false precision.
 */
export const ON_TARGET_TOLERANCE_BPS = 250;

export function bandFor(utilisationBps: number | null, targetBasisPoints: number | null): UtilisationBand {
  if (utilisationBps === null || targetBasisPoints === null) return "unmeasured";
  const variance = utilisationBps - targetBasisPoints;
  if (variance < -ON_TARGET_TOLERANCE_BPS) return "under";
  if (variance > ON_TARGET_TOLERANCE_BPS) return "over";
  return "on_target";
}

export const BAND_LABELS: Record<UtilisationBand, string> = {
  unmeasured: "Not measured",
  under: "Below target",
  on_target: "On target",
  over: "Above target",
};

export const BAND_NOTES: Record<UtilisationBand, string> = {
  unmeasured: "No target is set for this person or their role.",
  under: "Less chargeable time than the firm planned for.",
  on_target: "Chargeable time is where the firm expects it.",
  over: "More chargeable time than planned. Sustained, this is how people leave.",
};

export type PersonInput = {
  availability: AvailabilityInput;
  chargeableMinutes: number;
  employeeUserId: string;
  fullName: string;
  recordedMinutes: number;
  roleKey: string;
};

export function computeUtilisation(
  person: PersonInput,
  targets: readonly UtilisationTargetRow[],
  dateKey: string,
): PersonUtilisation {
  const hours = availability(person.availability);
  const target = resolveTarget(targets, person.employeeUserId, person.roleKey, dateKey);
  const utilisationBps = shareBasisPoints(person.chargeableMinutes, hours.availableMinutes);
  return {
    availableMinutes: hours.availableMinutes,
    band: bandFor(utilisationBps, target.basisPoints),
    chargeableMinutes: person.chargeableMinutes,
    employeeUserId: person.employeeUserId,
    fullName: person.fullName,
    leaveMinutes: hours.leaveMinutes,
    // Never negative: somebody who records more than they were scheduled for has
    // worked overtime, which is a different problem from an unfilled timesheet.
    missingMinutes: Math.max(0, hours.availableMinutes - person.recordedMinutes),
    recordedMinutes: person.recordedMinutes,
    recordingBps: shareBasisPoints(person.recordedMinutes, hours.availableMinutes),
    roleKey: person.roleKey,
    scheduledMinutes: hours.scheduledMinutes,
    targetBasisPoints: target.basisPoints,
    targetSource: target.source,
    utilisationBps,
    varianceBps: utilisationBps === null || target.basisPoints === null ? null : utilisationBps - target.basisPoints,
  };
}

export type FirmUtilisation = {
  availableMinutes: number;
  chargeableMinutes: number;
  /** People whose timesheets are materially unfilled, so the rest is suspect. */
  missingTimesheets: number;
  people: PersonUtilisation[];
  recordedMinutes: number;
  unmeasured: number;
  utilisationBps: number | null;
};

/**
 * A quarter of the month unrecorded is the point at which the other numbers
 * stop meaning anything, so it is called out rather than averaged away.
 */
export const MISSING_TIME_THRESHOLD_BPS = 2500;

export function summariseFirm(people: readonly PersonUtilisation[]): FirmUtilisation {
  const availableMinutes = people.reduce((total, person) => total + person.availableMinutes, 0);
  const chargeableMinutes = people.reduce((total, person) => total + person.chargeableMinutes, 0);
  return {
    availableMinutes,
    chargeableMinutes,
    missingTimesheets: people.filter((person) => (
      person.availableMinutes > 0
      && shareBasisPoints(person.missingMinutes, person.availableMinutes)! >= MISSING_TIME_THRESHOLD_BPS
    )).length,
    people: [...people],
    recordedMinutes: people.reduce((total, person) => total + person.recordedMinutes, 0),
    unmeasured: people.filter((person) => person.band === "unmeasured").length,
    utilisationBps: shareBasisPoints(chargeableMinutes, availableMinutes),
  };
}

export const hoursOf = (minutes: number) => minutes / MINUTES_PER_HOUR;
export const formatHours = (minutes: number) => `${hoursOf(minutes).toFixed(1)}h`;
