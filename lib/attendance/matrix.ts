import { and, asc, eq, gte, inArray, lte, sql } from "drizzle-orm";

import { attendanceDays, attendancePeriods, employeeProfiles, holidayCalendar, tenantMemberships, users } from "../../db/schema";
import type { DashboardDatabase } from "../dashboard/postgres/repository";

export type MatrixDay = {
  date: string;
  dayOfMonth: number;
  holidayName: string | null;
  isToday: boolean;
  isWeeklyOff: boolean;
  weekday: string;
};

export type MatrixCell = {
  checkIn: string | null;
  checkOut: string | null;
  note: string;
  status: string;
};

export type MatrixEmployee = {
  cells: Record<string, MatrixCell>;
  designation: string;
  employeeCode: string;
  fullName: string;
  totals: { absent: number; halfDay: number; leave: number; present: number };
  userId: string;
};

export type AttendanceMatrix = {
  days: MatrixDay[];
  employees: MatrixEmployee[];
  locked: boolean;
  periodKey: string;
};

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

/** Days that count toward the "present" tally when the month is totalled. */
const PRESENT_LIKE = new Set(["present", "late", "wfh", "tour"]);

/**
 * Builds every date in the month with its weekday, using UTC arithmetic.
 *
 * Local-time date maths would drift by a day for anyone whose machine is behind
 * UTC, which would silently shift the whole grid by one column.
 */
function daysOfMonth(periodKey: string, workingWeekMask: string, todayKey: string): MatrixDay[] {
  const [year, month] = periodKey.split("-").map(Number);
  const total = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return Array.from({ length: total }, (_, index) => {
    const date = new Date(Date.UTC(year, month - 1, index + 1));
    const key = date.toISOString().slice(0, 10);
    const weekday = date.getUTCDay();
    // The mask reads Monday-first, so Sunday moves from index 0 to index 6.
    const maskIndex = (weekday + 6) % 7;
    return {
      date: key,
      dayOfMonth: index + 1,
      holidayName: null,
      isToday: key === todayKey,
      isWeeklyOff: workingWeekMask[maskIndex] !== "1",
      weekday: WEEKDAYS[weekday],
    };
  });
}

/**
 * The month as a grid: every employee on the payroll for that month, every date
 * in it, and whatever has been recorded in each cell.
 *
 * Read-only. Marking a cell goes through `recordManualAttendance`, which is
 * where the period lock, the employment-date check, and the audit event live.
 */
export async function getAttendanceMatrix(
  database: DashboardDatabase,
  tenantId: string,
  periodKey: string,
  workingWeekMask: string,
  todayKey: string,
): Promise<AttendanceMatrix> {
  const [year, month] = periodKey.split("-").map(Number);
  const start = `${periodKey}-01`;
  const end = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);

  const roster = await database
    .select({
      designation: employeeProfiles.designation,
      employeeCode: employeeProfiles.employeeCode,
      fullName: users.fullName,
      userId: users.id,
    })
    .from(employeeProfiles)
    .innerJoin(users, eq(users.id, employeeProfiles.userId))
    .innerJoin(tenantMemberships, and(eq(tenantMemberships.tenantId, tenantId), eq(tenantMemberships.userId, employeeProfiles.userId)))
    .where(and(
      eq(employeeProfiles.tenantId, tenantId),
      // On the payroll at some point during this month, joiners and leavers included.
      lte(employeeProfiles.joiningDate, end),
      sql`${employeeProfiles.employmentEndDate} is null or ${employeeProfiles.employmentEndDate} >= ${start}`,
    ))
    .orderBy(asc(users.fullName));

  const userIds = roster.map((row) => row.userId);
  const [recorded, holidays, period] = await Promise.all([
    userIds.length
      ? database
        .select({
          attendanceDate: attendanceDays.attendanceDate,
          employeeUserId: attendanceDays.employeeUserId,
          firstCheckIn: attendanceDays.firstCheckIn,
          lastCheckOut: attendanceDays.lastCheckOut,
          note: attendanceDays.note,
          status: attendanceDays.status,
        })
        .from(attendanceDays)
        .where(and(
          eq(attendanceDays.tenantId, tenantId),
          inArray(attendanceDays.employeeUserId, userIds),
          gte(attendanceDays.attendanceDate, start),
          lte(attendanceDays.attendanceDate, end),
        ))
      : Promise.resolve([]),
    database
      .select({ holidayDate: holidayCalendar.holidayDate, name: holidayCalendar.name })
      .from(holidayCalendar)
      .where(and(
        eq(holidayCalendar.tenantId, tenantId),
        eq(holidayCalendar.status, "active"),
        gte(holidayCalendar.holidayDate, start),
        lte(holidayCalendar.holidayDate, end),
      )),
    database
      .select({ status: attendancePeriods.status })
      .from(attendancePeriods)
      .where(and(eq(attendancePeriods.tenantId, tenantId), eq(attendancePeriods.periodKey, periodKey)))
      .limit(1),
  ]);

  const holidayByDate = new Map(holidays.map((row) => [row.holidayDate, row.name]));
  const days = daysOfMonth(periodKey, workingWeekMask, todayKey).map((day) => ({
    ...day,
    holidayName: holidayByDate.get(day.date) ?? null,
  }));

  const byEmployee = new Map<string, Record<string, MatrixCell>>();
  for (const row of recorded) {
    const cells = byEmployee.get(row.employeeUserId) ?? {};
    cells[row.attendanceDate] = {
      checkIn: row.firstCheckIn ? row.firstCheckIn.toISOString() : null,
      checkOut: row.lastCheckOut ? row.lastCheckOut.toISOString() : null,
      note: row.note,
      status: row.status,
    };
    byEmployee.set(row.employeeUserId, cells);
  }

  const employees = roster.map((row) => {
    const cells = byEmployee.get(row.userId) ?? {};
    const statuses = Object.values(cells).map((cell) => cell.status);
    return {
      cells,
      designation: row.designation,
      employeeCode: row.employeeCode,
      fullName: row.fullName,
      totals: {
        absent: statuses.filter((status) => status === "absent" || status === "missing_punch").length,
        halfDay: statuses.filter((status) => status === "half_day").length,
        leave: statuses.filter((status) => status === "leave").length,
        present: statuses.filter((status) => PRESENT_LIKE.has(status)).length,
      },
      userId: row.userId,
    };
  });

  return { days, employees, locked: period[0]?.status === "locked", periodKey };
}
