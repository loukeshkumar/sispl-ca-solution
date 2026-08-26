import { randomUUID } from "node:crypto";
import { and, asc, eq, gte, lte, ne } from "drizzle-orm";

import { auditEvents, holidayCalendar, leaveTypes, shiftTypes } from "../../db/schema";
import type { DashboardDatabase } from "../dashboard/postgres/repository";
import type { HolidayInput, LeaveTypeInput, ShiftTypeInput } from "./validation";

export class AttendanceMasterError extends Error {
  constructor(public readonly code: "not_found" | "duplicate" | "in_use") {
    super(
      code === "not_found" ? "The master record was not found."
        : code === "duplicate" ? "That code or date is already recorded."
          : "This record is still referenced and cannot be removed.",
    );
    this.name = "AttendanceMasterError";
  }
}

export type LeaveTypeRow = LeaveTypeInput & { id: string };
export type HolidayRow = HolidayInput & { id: string };
export type ShiftTypeRow = ShiftTypeInput & { id: string };

export type AttendanceMastersWorkspace = {
  leaveTypes: LeaveTypeRow[];
  holidays: HolidayRow[];
  shifts: ShiftTypeRow[];
  metrics: { activeLeaveTypes: number; upcomingHolidays: number; activeShifts: number };
  todayKey: string;
};

function requireTenant(tenantId: string) {
  if (!tenantId.trim()) throw new Error("Tenant is required.");
}

export function indiaDateKey(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export async function listAttendanceMasters(database: DashboardDatabase, tenantId: string, todayKey = indiaDateKey()): Promise<AttendanceMastersWorkspace> {
  requireTenant(tenantId);
  const [leaveRows, holidayRows, shiftRows] = await Promise.all([
    database.select().from(leaveTypes).where(eq(leaveTypes.tenantId, tenantId))
      .orderBy(asc(leaveTypes.displayOrder), asc(leaveTypes.name)),
    database.select().from(holidayCalendar).where(eq(holidayCalendar.tenantId, tenantId))
      .orderBy(asc(holidayCalendar.holidayDate)),
    database.select().from(shiftTypes).where(eq(shiftTypes.tenantId, tenantId))
      .orderBy(asc(shiftTypes.name)),
  ]);
  return {
    leaveTypes: leaveRows.map((row) => ({
      id: row.id, code: row.code, name: row.name, paidByDefault: row.paidByDefault, allowsHalfDay: row.allowsHalfDay,
      requiresReason: row.requiresReason, annualQuotaDays: row.annualQuotaDays,
      accrualMethod: row.accrualMethod as LeaveTypeRow["accrualMethod"],
      carryForwardCap: row.carryForwardCap, carryForwardExpiryMonths: row.carryForwardExpiryMonths,
      encashableOnExit: row.encashableOnExit, displayOrder: row.displayOrder,
      status: row.status as "active" | "archived",
    })),
    holidays: holidayRows.map((row) => ({
      id: row.id, holidayDate: row.holidayDate, name: row.name,
      holidayType: row.holidayType as HolidayRow["holidayType"], jurisdictionState: row.jurisdictionState,
      status: row.status as "active" | "archived",
    })),
    shifts: shiftRows.map((row) => ({
      id: row.id, code: row.code, name: row.name, startTime: row.startTime, endTime: row.endTime,
      fullDayMinutes: row.fullDayMinutes, halfDayMinutes: row.halfDayMinutes, lateGraceMinutes: row.lateGraceMinutes,
      workingWeekMask: row.workingWeekMask, isDefault: row.isDefault, status: row.status as "active" | "archived",
    })),
    metrics: {
      activeLeaveTypes: leaveRows.filter((row) => row.status === "active").length,
      upcomingHolidays: holidayRows.filter((row) => row.status === "active" && row.holidayDate >= todayKey).length,
      activeShifts: shiftRows.filter((row) => row.status === "active").length,
    },
    todayKey,
  };
}

/** Active leave types offered on the leave request form. */
export async function listActiveLeaveTypes(database: DashboardDatabase, tenantId: string) {
  requireTenant(tenantId);
  return database.select({
    code: leaveTypes.code, name: leaveTypes.name, paidByDefault: leaveTypes.paidByDefault,
    allowsHalfDay: leaveTypes.allowsHalfDay, requiresReason: leaveTypes.requiresReason,
  }).from(leaveTypes).where(and(eq(leaveTypes.tenantId, tenantId), eq(leaveTypes.status, "active")))
    .orderBy(asc(leaveTypes.displayOrder), asc(leaveTypes.name));
}

/** Holiday dates within a period, used to exclude them from scheduled working days. */
export async function listHolidayDateKeys(database: DashboardDatabase, tenantId: string, periodKey: string, jurisdictionState?: string) {
  const [year, month] = periodKey.split("-").map(Number);
  if (!year || !month) return [];
  const end = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  return listHolidayDateKeysInRange(database, tenantId, `${periodKey}-01`, end, jurisdictionState);
}

/**
 * Declared public holidays between two dates. Leave runs from one date to
 * another rather than over a month, and a holiday inside a leave range is not
 * time the employee should be charged for.
 */
export async function listHolidayDateKeysInRange(database: DashboardDatabase, tenantId: string, start: string, end: string, jurisdictionState?: string) {
  requireTenant(tenantId);
  if (end < start) return [];
  const rows = await database.select({ holidayDate: holidayCalendar.holidayDate, jurisdictionState: holidayCalendar.jurisdictionState })
    .from(holidayCalendar).where(and(
      eq(holidayCalendar.tenantId, tenantId),
      eq(holidayCalendar.status, "active"),
      eq(holidayCalendar.holidayType, "public"),
      gte(holidayCalendar.holidayDate, start),
      lte(holidayCalendar.holidayDate, end),
    ));
  const scoped = jurisdictionState
    ? rows.filter((row) => row.jurisdictionState.toLowerCase() === jurisdictionState.toLowerCase())
    : rows;
  return [...new Set(scoped.map((row) => row.holidayDate))].sort();
}

export async function listActiveShiftTypes(database: DashboardDatabase, tenantId: string) {
  requireTenant(tenantId);
  return database.select({
    id: shiftTypes.id, code: shiftTypes.code, name: shiftTypes.name, startTime: shiftTypes.startTime,
    endTime: shiftTypes.endTime, isDefault: shiftTypes.isDefault,
  }).from(shiftTypes).where(and(eq(shiftTypes.tenantId, tenantId), eq(shiftTypes.status, "active")))
    .orderBy(asc(shiftTypes.name));
}

async function audit(database: DashboardDatabase, tenantId: string, actorUserId: string, resourceType: string, resourceId: string, action: string, reason: string) {
  await database.insert(auditEvents).values({ tenantId, actorUserId, resourceType, resourceId, action, reason });
}

export async function saveLeaveType(database: DashboardDatabase, tenantId: string, actorUserId: string, input: LeaveTypeInput, leaveTypeId?: string) {
  requireTenant(tenantId);
  if (leaveTypeId) {
    const [updated] = await database.update(leaveTypes).set({ ...input, updatedAt: new Date() })
      .where(and(eq(leaveTypes.tenantId, tenantId), eq(leaveTypes.id, leaveTypeId))).returning({ id: leaveTypes.id });
    if (!updated) throw new AttendanceMasterError("not_found");
    await audit(database, tenantId, actorUserId, "leave_type", leaveTypeId, "leave_type.updated", `${input.code} · ${input.name}`);
    return leaveTypeId;
  }
  const id = randomUUID();
  const inserted = await database.insert(leaveTypes).values({ id, tenantId, ...input }).onConflictDoNothing().returning({ id: leaveTypes.id });
  if (inserted.length === 0) throw new AttendanceMasterError("duplicate");
  await audit(database, tenantId, actorUserId, "leave_type", id, "leave_type.created", `${input.code} · ${input.name}`);
  return id;
}

export async function saveHoliday(database: DashboardDatabase, tenantId: string, actorUserId: string, input: HolidayInput, holidayId?: string) {
  requireTenant(tenantId);
  if (holidayId) {
    const [updated] = await database.update(holidayCalendar).set({ ...input, updatedAt: new Date() })
      .where(and(eq(holidayCalendar.tenantId, tenantId), eq(holidayCalendar.id, holidayId))).returning({ id: holidayCalendar.id });
    if (!updated) throw new AttendanceMasterError("not_found");
    await audit(database, tenantId, actorUserId, "holiday", holidayId, "holiday.updated", `${input.holidayDate} · ${input.name}`);
    return holidayId;
  }
  const id = randomUUID();
  const inserted = await database.insert(holidayCalendar).values({ id, tenantId, ...input, createdByUserId: actorUserId })
    .onConflictDoNothing().returning({ id: holidayCalendar.id });
  if (inserted.length === 0) throw new AttendanceMasterError("duplicate");
  await audit(database, tenantId, actorUserId, "holiday", id, "holiday.created", `${input.holidayDate} · ${input.name}`);
  return id;
}

export async function saveShiftType(database: DashboardDatabase, tenantId: string, actorUserId: string, input: ShiftTypeInput, shiftTypeId?: string) {
  requireTenant(tenantId);
  return database.transaction(async (transaction) => {
    // Only one shift may be the default; promoting one demotes the rest.
    if (input.isDefault && input.status === "active") {
      await transaction.update(shiftTypes).set({ isDefault: false, updatedAt: new Date() }).where(and(
        eq(shiftTypes.tenantId, tenantId),
        eq(shiftTypes.isDefault, true),
        ...(shiftTypeId ? [ne(shiftTypes.id, shiftTypeId)] : []),
      ));
    }
    if (shiftTypeId) {
      const [updated] = await transaction.update(shiftTypes).set({ ...input, updatedAt: new Date() })
        .where(and(eq(shiftTypes.tenantId, tenantId), eq(shiftTypes.id, shiftTypeId))).returning({ id: shiftTypes.id });
      if (!updated) throw new AttendanceMasterError("not_found");
      await transaction.insert(auditEvents).values({ tenantId, actorUserId, resourceType: "shift_type", resourceId: shiftTypeId, action: "shift_type.updated", reason: `${input.code} · ${input.name}` });
      return shiftTypeId;
    }
    const id = randomUUID();
    const inserted = await transaction.insert(shiftTypes).values({ id, tenantId, ...input }).onConflictDoNothing().returning({ id: shiftTypes.id });
    if (inserted.length === 0) throw new AttendanceMasterError("duplicate");
    await transaction.insert(auditEvents).values({ tenantId, actorUserId, resourceType: "shift_type", resourceId: id, action: "shift_type.created", reason: `${input.code} · ${input.name}` });
    return id;
  });
}
