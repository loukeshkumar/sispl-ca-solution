/**
 * Attendance for both demo months, driven through the same functions the
 * workspace calls.
 *
 * The closed month is carried all the way to `locked`, because a locked month is
 * what a payroll run needs. The current month is prepared and filled only up to
 * today, and deliberately left open: the absence of a payroll run for it
 * demonstrates the dependency rather than hiding it.
 */
import { and, eq, gte, lte } from "drizzle-orm";

import { attendanceDays, attendancePeriods } from "../../../db/schema";
import {
  lockAttendancePeriod,
  moveAttendancePeriodToReview,
  prepareAttendancePeriod,
  recordManualAttendance,
} from "../../../lib/attendance/repository";
import type { DashboardDatabase } from "../../../lib/dashboard/postgres/repository";
import type { Role } from "../../../lib/auth/authorization";
import { demoAttendanceStatus, demoDayTimes, lastDateKeyOf, type DemoContext } from "./context";

async function periodStatus(database: DashboardDatabase, tenantId: string, periodKey: string) {
  const [period] = await database.select({ id: attendancePeriods.id, status: attendancePeriods.status })
    .from(attendancePeriods)
    .where(and(eq(attendancePeriods.tenantId, tenantId), eq(attendancePeriods.periodKey, periodKey)))
    .limit(1);
  return period ?? null;
}

/**
 * Resolves the rows `prepareAttendancePeriod` just created rather than
 * recomputing the working week here. The period is the authority on which days
 * are scheduled — it has already removed holidays and honoured joining dates —
 * so reading it back cannot disagree with it.
 */
async function resolveOpenDays(
  database: DashboardDatabase,
  context: DemoContext,
  periodKey: string,
  upToDateKey: string,
) {
  const ordinalOf = new Map(context.actors.employees.map((employee, index) => [employee.userId, index]));
  const roleOf = new Map(context.actors.employees.map((employee) => [employee.userId, employee.roleKey as Role]));
  const pending = await database.select({
    employeeUserId: attendanceDays.employeeUserId,
    attendanceDate: attendanceDays.attendanceDate,
  }).from(attendanceDays).where(and(
    eq(attendanceDays.tenantId, context.tenantId),
    eq(attendanceDays.status, "missing_punch"),
    gte(attendanceDays.attendanceDate, `${periodKey}-01`),
    lte(attendanceDays.attendanceDate, upToDateKey),
  ));

  for (const day of pending) {
    const employeeOrdinal = ordinalOf.get(day.employeeUserId) ?? 0;
    const dayOrdinal = Number(day.attendanceDate.slice(-2));
    const status = demoAttendanceStatus(employeeOrdinal, dayOrdinal);
    const { checkInTime, checkOutTime } = demoDayTimes(status);
    await recordManualAttendance(
      database,
      context.tenantId,
      context.actors.administratorId,
      roleOf.get(context.actors.administratorId) ?? "firm_administrator",
      day.employeeUserId,
      { attendanceDate: day.attendanceDate, checkInTime, checkOutTime, note: "Seeded demonstration record", status },
    );
  }
  return pending.length;
}

export async function seedDemoAttendance(database: DashboardDatabase, context: DemoContext) {
  const { closedMonth, currentMonth, todayKey } = context.calendar;

  let closedDays = 0;
  const existingClosed = await periodStatus(database, context.tenantId, closedMonth);
  if (existingClosed?.status !== "locked") {
    const periodId = existingClosed?.id
      ?? await prepareAttendancePeriod(database, context.tenantId, context.actors.administratorId, closedMonth);
    closedDays = await resolveOpenDays(database, context, closedMonth, lastDateKeyOf(closedMonth, todayKey));
    // A period already moved past `open` rejects the transition, so only take
    // the steps that are still ahead of it.
    const beforeReview = await periodStatus(database, context.tenantId, closedMonth);
    if (beforeReview?.status === "open") {
      await moveAttendancePeriodToReview(database, context.tenantId, context.actors.administratorId, periodId);
    }
    const beforeLock = await periodStatus(database, context.tenantId, closedMonth);
    if (beforeLock?.status === "review") {
      await lockAttendancePeriod(database, context.tenantId, context.actors.partnerId, periodId);
    }
  }

  let currentDays = 0;
  const existingCurrent = await periodStatus(database, context.tenantId, currentMonth);
  if (!existingCurrent) {
    await prepareAttendancePeriod(database, context.tenantId, context.actors.administratorId, currentMonth);
  }
  // Only up to today. Days still ahead stay unresolved, which is what an
  // in-flight month actually looks like and why it cannot yet be locked.
  currentDays = await resolveOpenDays(database, context, currentMonth, lastDateKeyOf(currentMonth, todayKey));

  return { closedMonthDays: closedDays, currentMonthDays: currentDays };
}
