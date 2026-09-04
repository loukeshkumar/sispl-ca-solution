/**
 * The pure core of the demo seed: what months it works on, who performs each
 * action, and what a believable month of attendance looks like.
 *
 * Nothing here touches the database or reads the clock on its own. `now` is
 * always passed in, which is what makes these decisions testable without a
 * PostgreSQL instance and what keeps two modules from disagreeing about which
 * month they are filling.
 */
import { indiaDateKey, indiaPeriodKey } from "../../../lib/attendance/calculations";
import type { AttendanceStatus } from "../../../lib/attendance/validation";

export type DemoCalendar = {
  /** The month the demo carries through to every terminal state. */
  closedMonth: string;
  /** The month left deliberately in flight. */
  currentMonth: string;
  /** Today, in IST. Nothing in the current month is dated after this. */
  todayKey: string;
};

/**
 * Statutory rate versions and joining dates stay fixed literals in `seed.ts`;
 * they model effective-dated law and must not be invented. Transactional
 * history is anchored here instead, so the demo does not visibly age.
 */
export function resolveDemoCalendar(now = new Date()): DemoCalendar {
  const currentMonth = indiaPeriodKey(now);
  const [year, month] = currentMonth.split("-").map(Number);
  const closedYear = month === 1 ? year - 1 : year;
  const closedMonth = month === 1 ? 12 : month - 1;
  return {
    closedMonth: `${closedYear}-${String(closedMonth).padStart(2, "0")}`,
    currentMonth,
    todayKey: indiaDateKey(now),
  };
}

/** The last date the demo may write in a period, so the current month stops at today. */
export function lastDateKeyOf(periodKey: string, todayKey: string) {
  const [year, month] = periodKey.split("-").map(Number);
  const monthEnd = `${periodKey}-${String(new Date(Date.UTC(year, month, 0)).getUTCDate()).padStart(2, "0")}`;
  return todayKey < monthEnd ? todayKey : monthEnd;
}

/**
 * A deterministic mix of attendance across a month.
 *
 * Every scheduled day must resolve to something, because `lockAttendancePeriod`
 * refuses a period holding an unresolved half day — a demo month that cannot be
 * locked cannot carry a payroll run, which is most of what there is to show. The
 * pattern is keyed on the employee ordinal and the day ordinal rather than
 * randomised, so two runs on the same month produce the same month.
 */
export function demoAttendanceStatus(employeeOrdinal: number, dayOrdinal: number): AttendanceStatus {
  const beat = (employeeOrdinal * 7 + dayOrdinal) % 23;
  if (beat === 3) return "leave";
  if (beat === 9) return "wfh";
  if (beat === 14) return "late";
  if (beat === 19) return "half_day";
  return "present";
}

/** Check-in and check-out for a status, so worked minutes are not uniformly identical. */
export function demoDayTimes(status: AttendanceStatus): { checkInTime: string | null; checkOutTime: string | null } {
  if (status === "leave") return { checkInTime: null, checkOutTime: null };
  if (status === "half_day") return { checkInTime: "09:30", checkOutTime: "13:30" };
  if (status === "late") return { checkInTime: "10:25", checkOutTime: "19:10" };
  return { checkInTime: "09:30", checkOutTime: "18:35" };
}

/**
 * Actors for each action, resolved once from the seeded fixture rather than
 * looked up per module. Payroll approval is the reason the partner is separate
 * from the administrator: approving a run you submitted yourself is an audited
 * override, and the demo should show the ordinary path instead.
 */
export type DemoActors = {
  administratorId: string;
  partnerId: string;
  managerIds: string[];
  associateIds: string[];
  /** Every active employee, in a stable order, with their seeded role. */
  employees: { userId: string; roleKey: string }[];
};

export type DemoContext = {
  tenantId: string;
  calendar: DemoCalendar;
  actors: DemoActors;
};
