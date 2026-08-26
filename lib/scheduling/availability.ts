import { weekStartKey, workingDaysInMask } from "./capacity";

/**
 * What a person is actually available for in one week.
 *
 * Capacity used to be one number: full-day minutes times working days in the
 * shift mask. The same figure every week, for ever. It did not know that the
 * 25th is a holiday, that Vikram is on approved leave from the 16th, or that
 * Ayesha is away the whole week — so a manager loading a week looked at a lane
 * that said 2,700 minutes when the honest answer was 900, and the plan was
 * built on it.
 *
 * The firm already records all of this. Nothing here is a new fact; it is the
 * facts finally reaching the number.
 */

const DAY_MS = 86_400_000;

export type DayPortion = "full" | "first_half" | "second_half";

export type LeaveWindow = {
  dateFrom: string;
  dateTo: string;
  dayPortion: DayPortion;
  employeeUserId: string;
  /** Only `approved` reduces the number; `pending` is reported beside it. */
  status: string;
};

export type Holiday = {
  holidayDate: string;
  /** Only a public holiday closes the office. See `closesOffice`. */
  holidayType: string;
  jurisdictionState: string;
  name: string;
};

/**
 * A restricted or optional holiday is one an employee may choose to take, so
 * the office is open and the day is working time until somebody applies for
 * leave. Treating it as closed would hand the firm a quieter week than it has.
 */
export const closesOffice = (holiday: Holiday) => holiday.holidayType === "public";

const sameState = (left: string, right: string) => left.trim().toLowerCase() === right.trim().toLowerCase();

/** The seven date keys of the week beginning `weekStart`, Monday first. */
export function weekDays(weekStart: string): string[] {
  const start = Date.parse(`${weekStart}T00:00:00Z`);
  return Array.from({ length: 7 }, (_unused, index) => new Date(start + index * DAY_MS).toISOString().slice(0, 10));
}

/** Monday-first index into the shift mask, so `'1111110'` means Sunday is off. */
export function isWorkingDay(dateKey: string, mask: string) {
  const weekday = (new Date(`${dateKey}T00:00:00Z`).getUTCDay() + 6) % 7;
  return mask[weekday] === "1";
}

const coversDay = (leave: LeaveWindow, dateKey: string) => leave.dateFrom <= dateKey && dateKey <= leave.dateTo;

/**
 * How much of one day a leave window takes.
 *
 * A half-day portion applies to every day of a multi-day request, which is how
 * the attendance module already reads it: somebody taking afternoons off for a
 * week has asked for five half days, not one.
 */
const portionOf = (leave: LeaveWindow) => (leave.dayPortion === "full" ? 1 : 0.5);

export type WeekAvailability = {
  /** Minutes left after holidays and approved leave. Never negative. */
  availableMinutes: number;
  /** Minutes the shift mask alone would have given. The old number. */
  baseMinutes: number;
  /** Public holidays that fell on a working day, named. */
  holidays: Array<{ dateKey: string; name: string }>;
  /** Minutes removed by approved leave. */
  leaveMinutes: number;
  /** Minutes that would go if everything pending were granted. Not subtracted. */
  pendingMinutes: number;
  weekStart: string;
  /** True where nothing at all is left: away, or the week is all holiday. */
  awayAllWeek: boolean;
};

/**
 * One person's real availability for one week.
 *
 * Holidays are taken first and leave second, and a day already lost to a
 * holiday is not lost twice — somebody on leave across a public holiday has not
 * given the firm negative time.
 */
export function weekAvailability(input: {
  employeeUserId: string;
  fullDayMinutes: number;
  holidays: readonly Holiday[];
  leave: readonly LeaveWindow[];
  weekStart: string;
  workLocationState: string;
  workingWeekMask: string;
}): WeekAvailability {
  const days = weekDays(input.weekStart).filter((dateKey) => isWorkingDay(dateKey, input.workingWeekMask));
  const baseMinutes = days.length * input.fullDayMinutes;

  const closed = new Map<string, string>();
  for (const holiday of input.holidays) {
    if (!closesOffice(holiday)) continue;
    if (!sameState(holiday.jurisdictionState, input.workLocationState)) continue;
    if (days.includes(holiday.holidayDate)) closed.set(holiday.holidayDate, holiday.name);
  }

  const mine = input.leave.filter((leave) => leave.employeeUserId === input.employeeUserId);
  const portionFor = (dateKey: string, status: string) => {
    // A day the office is closed is already gone; leave across it removes nothing
    // further, and counting it twice would take more than the day contained.
    if (closed.has(dateKey)) return 0;
    const covering = mine.filter((leave) => leave.status === status && coversDay(leave, dateKey));
    if (covering.length === 0) return 0;
    return Math.min(1, covering.reduce((total, leave) => total + portionOf(leave), 0));
  };

  const leaveDays = days.reduce((total, dateKey) => total + portionFor(dateKey, "approved"), 0);
  const pendingDays = days.reduce((total, dateKey) => {
    // Pending is only meaningful for time not already gone to approved leave.
    const remaining = 1 - portionFor(dateKey, "approved");
    return total + Math.min(remaining, portionFor(dateKey, "pending"));
  }, 0);

  const holidayMinutes = closed.size * input.fullDayMinutes;
  const leaveMinutes = Math.round(leaveDays * input.fullDayMinutes);
  const availableMinutes = Math.max(0, baseMinutes - holidayMinutes - leaveMinutes);

  return {
    availableMinutes,
    awayAllWeek: baseMinutes > 0 && availableMinutes === 0,
    baseMinutes,
    holidays: [...closed.entries()]
      .map(([dateKey, name]) => ({ dateKey, name }))
      .sort((left, right) => left.dateKey.localeCompare(right.dateKey)),
    leaveMinutes,
    pendingMinutes: Math.round(pendingDays * input.fullDayMinutes),
    weekStart: input.weekStart,
  };
}

/** Percentage of a week already committed, or null where nothing is available. */
export function loadPercentage(loadMinutes: number, availableMinutes: number) {
  if (availableMinutes <= 0) return null;
  return Math.round((loadMinutes / availableMinutes) * 100);
}

export type LoadBand = "away" | "free" | "healthy" | "tight" | "over";

/**
 * How a lane reads at a glance.
 *
 * `away` is separated from `over` deliberately: a person with no time at all and
 * work assigned is a different problem from one who is merely busy, and showing
 * them both as red loses the distinction that decides what to do.
 */
export function loadBand(input: { availableMinutes: number; loadMinutes: number }): LoadBand {
  if (input.availableMinutes <= 0) return "away";
  const percent = (input.loadMinutes / input.availableMinutes) * 100;
  if (percent > 100) return "over";
  if (percent >= 85) return "tight";
  if (percent >= 40) return "healthy";
  return "free";
}

export const BAND_LABELS: Record<LoadBand, string> = {
  away: "Away",
  free: "Room",
  healthy: "Loaded",
  over: "Over",
  tight: "Tight",
};

const hours = (minutes: number) => `${(minutes / 60).toFixed(minutes % 60 === 0 ? 0 : 1)}h`;

/**
 * The week in a sentence, saying what was taken out and why.
 *
 * A number a manager cannot account for is a number they will not trust, and
 * "1,800 minutes" with no explanation is exactly the figure somebody overrides
 * from memory.
 */
export function availabilitySummary(week: WeekAvailability): string {
  if (week.baseMinutes === 0) return "No working days this week";
  const taken: string[] = [];
  const holidayMinutes = week.baseMinutes - week.availableMinutes - week.leaveMinutes;
  if (holidayMinutes > 0) {
    taken.push(`${hours(holidayMinutes)} holiday${week.holidays.length === 1 ? ` (${week.holidays[0]!.name})` : ""}`);
  }
  if (week.leaveMinutes > 0) taken.push(`${hours(week.leaveMinutes)} leave`);
  const base = taken.length === 0
    ? `${hours(week.availableMinutes)} available`
    : `${hours(week.availableMinutes)} available · ${hours(week.baseMinutes)} less ${taken.join(" and ")}`;
  return week.pendingMinutes > 0 ? `${base} · ${hours(week.pendingMinutes)} awaiting a decision` : base;
}

/** What a pending request would do to the week if it were granted. */
export function pendingWarning(week: WeekAvailability, loadMinutes: number): string | null {
  if (week.pendingMinutes <= 0) return null;
  const wouldBe = Math.max(0, week.availableMinutes - week.pendingMinutes);
  if (loadMinutes <= wouldBe) return null;
  return wouldBe === 0
    ? "If the pending leave is granted, this week has no time left at all."
    : `If the pending leave is granted, this week is over by ${hours(loadMinutes - wouldBe)}.`;
}

export { weekStartKey, workingDaysInMask };
