import { createHash } from "node:crypto";

import type { AttendanceStatus } from "./validation";

const IST_OFFSET_MINUTES = 330;
const timeMinutes = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));

export type ClockedDayInput = {
  checkIn: Date; checkOut: Date; fullDayMinutes: number; halfDayMinutes: number;
  lateGraceMinutes: number; standardStartTime: string;
};

export function attendanceUnitsForStatus(status: AttendanceStatus) {
  if (["present", "late", "wfh", "tour", "leave", "holiday", "weekly_off"].includes(status)) return { paidHalfDays: 2, lopHalfDays: 0 };
  if (status === "half_day") return { paidHalfDays: 1, lopHalfDays: 1 };
  if (status === "absent") return { paidHalfDays: 0, lopHalfDays: 2 };
  return { paidHalfDays: 0, lopHalfDays: 0 };
}

export function calculateClockedDay(input: ClockedDayInput) {
  const workedMinutes = Math.max(0, Math.floor((input.checkOut.getTime() - input.checkIn.getTime()) / 60_000));
  const checkInInIndia = new Date(input.checkIn.getTime() + IST_OFFSET_MINUTES * 60_000);
  const checkInMinutes = checkInInIndia.getUTCHours() * 60 + checkInInIndia.getUTCMinutes();
  const lateMinutes = Math.max(0, checkInMinutes - timeMinutes(input.standardStartTime));
  if (workedMinutes >= input.fullDayMinutes) return {
    lateMinutes,
    lopHalfDays: 0,
    paidHalfDays: 2,
    status: (lateMinutes > input.lateGraceMinutes ? "late" : "present") as AttendanceStatus,
    workedMinutes,
  };
  if (workedMinutes >= input.halfDayMinutes) return { lateMinutes, lopHalfDays: 1, paidHalfDays: 1, status: "half_day" as const, workedMinutes };
  return { lateMinutes, lopHalfDays: 2, paidHalfDays: 0, status: "absent" as const, workedMinutes };
}

export type AttendanceSummaryDay = {
  attendanceDate: string; lateMinutes: number; lopHalfDays: number; paidHalfDays: number;
  status: string; workedMinutes: number;
};

export function buildAttendanceSummary(days: AttendanceSummaryDay[], scheduledHalfDays: number, fullDayMinutes: number) {
  const resolved = days.filter((day) => day.status !== "missing_punch");
  const payableHalfDays = resolved.reduce((sum, day) => sum + day.paidHalfDays, 0);
  const lopHalfDays = resolved.reduce((sum, day) => sum + day.lopHalfDays, 0);
  const unresolvedHalfDays = Math.max(0, scheduledHalfDays - payableHalfDays - lopHalfDays);
  const paidLeaveHalfDays = resolved.filter((day) => day.status === "leave" && day.paidHalfDays > 0).reduce((sum, day) => sum + day.paidHalfDays, 0);
  const unpaidLeaveHalfDays = resolved.filter((day) => day.status === "leave" && day.lopHalfDays > 0).reduce((sum, day) => sum + day.lopHalfDays, 0);
  const absenceHalfDays = resolved.filter((day) => day.status === "absent").reduce((sum, day) => sum + day.lopHalfDays, 0);
  const overtimeMinutes = resolved.reduce((sum, day) => sum + Math.max(0, day.workedMinutes - fullDayMinutes), 0);
  const sourceHash = createHash("sha256").update(JSON.stringify([...days].sort((a, b) => a.attendanceDate.localeCompare(b.attendanceDate)))).digest("hex");
  return {
    absenceHalfDays,
    lateCount: resolved.filter((day) => day.status === "late").length,
    lopHalfDays,
    overtimeMinutes,
    paidLeaveHalfDays,
    payableHalfDays,
    presentDays: resolved.filter((day) => ["present", "late", "wfh", "tour"].includes(day.status)).length,
    scheduledHalfDays,
    sourceHash,
    unpaidLeaveHalfDays,
    unresolvedHalfDays,
  };
}

export function workingDateKeys(periodKey: string, workingWeekMask: string) {
  const [year, month] = periodKey.split("-").map(Number);
  if (!year || !month || !/^[01]{7}$/.test(workingWeekMask)) return [];
  const result: string[] = [];
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = new Date(Date.UTC(year, month - 1, day));
    const mondayIndex = (date.getUTCDay() + 6) % 7;
    if (workingWeekMask[mondayIndex] === "1") result.push(`${periodKey}-${String(day).padStart(2, "0")}`);
  }
  return result;
}

/**
 * Scheduled days for an employee: the working week, minus days outside their
 * employment, minus declared public holidays. Holidays default to none so every
 * existing caller keeps its behaviour.
 */
export function eligibleWorkingDateKeys(
  periodKey: string,
  workingWeekMask: string,
  joiningDate: string,
  employmentEndDate: string | null,
  holidayDateKeys: readonly string[] = [],
) {
  const holidays = new Set(holidayDateKeys);
  return workingDateKeys(periodKey, workingWeekMask).filter((dateKey) => (
    dateKey >= joiningDate
    && (!employmentEndDate || dateKey <= employmentEndDate)
    && !holidays.has(dateKey)
  ));
}

/**
 * Working dates inside an arbitrary range, on the same definition the monthly
 * calculation uses: the firm's working week, minus declared holidays, minus days
 * outside the person's employment.
 *
 * Leave needs this because a request runs from one date to another rather than
 * over a month. Counting the Sunday inside a Friday-to-Monday leave against an
 * employee's entitlement would be indefensible, and the period summary already
 * ignores those days when it works out pay.
 */
export function eligibleWorkingDatesInRange(
  dateFrom: string,
  dateTo: string,
  workingWeekMask: string,
  joiningDate: string,
  employmentEndDate: string | null,
  holidayDateKeys: readonly string[] = [],
  maxDays = 400,
) {
  if (!/^[01]{7}$/.test(workingWeekMask) || dateTo < dateFrom) return [];
  const holidays = new Set(holidayDateKeys);
  const result: string[] = [];
  const cursor = new Date(`${dateFrom}T00:00:00Z`);
  const end = new Date(`${dateTo}T00:00:00Z`);
  for (let guard = 0; cursor <= end && guard < maxDays; guard += 1) {
    const dateKey = cursor.toISOString().slice(0, 10);
    const mondayIndex = (cursor.getUTCDay() + 6) % 7;
    if (
      workingWeekMask[mondayIndex] === "1"
      && !holidays.has(dateKey)
      && dateKey >= joiningDate
      && (!employmentEndDate || dateKey <= employmentEndDate)
    ) result.push(dateKey);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return result;
}

export function indiaDateKey(now = new Date()) {
  const shifted = new Date(now.getTime() + IST_OFFSET_MINUTES * 60_000);
  return shifted.toISOString().slice(0, 10);
}

export function indiaPeriodKey(now = new Date()) {
  return indiaDateKey(now).slice(0, 7);
}

export function indiaLocalDateTime(dateKey: string, time: string) {
  return new Date(`${dateKey}T${time}:00+05:30`);
}
