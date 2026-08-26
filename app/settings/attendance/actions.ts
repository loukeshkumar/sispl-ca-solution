"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requirePermission } from "../../../lib/auth/server";
import { getDatabase } from "../../../lib/dashboard/postgres/pool";
import { AttendanceMasterError, saveHoliday, saveLeaveType, saveShiftType } from "../../../lib/attendance-masters/repository";
import {
  validateHolidayFields,
  validateLeaveTypeFields,
  validateShiftTypeFields,
  type HolidayActionState,
  type LeaveTypeActionState,
  type ShiftTypeActionState,
} from "../../../lib/attendance-masters/validation";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function fields(formData: FormData) {
  return Object.fromEntries(
    [...formData.entries()].filter(([, value]) => typeof value === "string").map(([key, value]) => [key, String(value)]),
  );
}

function optionalId(formData: FormData, key: string) {
  const value = String(formData.get(key) ?? "");
  return UUID_PATTERN.test(value) ? value : undefined;
}

function message(error: unknown, fallback: string) {
  return error instanceof AttendanceMasterError ? error.message : fallback;
}

export async function saveLeaveTypeAction(_previous: LeaveTypeActionState, formData: FormData): Promise<LeaveTypeActionState> {
  const session = await requirePermission("attendance:manage", "/settings/attendance");
  const validation = validateLeaveTypeFields(fields(formData));
  if (!validation.success) return { error: "Review the highlighted fields.", fieldErrors: validation.fieldErrors };
  try {
    await saveLeaveType(getDatabase(), session.tenantId, session.userId, validation.data, optionalId(formData, "leaveTypeId"));
  } catch (error) {
    return { error: message(error, "The leave type could not be saved."), fieldErrors: {} };
  }
  revalidatePath("/settings/attendance");
  redirect("/settings/attendance?tab=leave&saved=1");
}

export async function saveHolidayAction(_previous: HolidayActionState, formData: FormData): Promise<HolidayActionState> {
  const session = await requirePermission("attendance:manage", "/settings/attendance");
  const validation = validateHolidayFields(fields(formData));
  if (!validation.success) return { error: "Review the highlighted fields.", fieldErrors: validation.fieldErrors };
  try {
    await saveHoliday(getDatabase(), session.tenantId, session.userId, validation.data, optionalId(formData, "holidayId"));
  } catch (error) {
    return { error: message(error, "The holiday could not be saved."), fieldErrors: {} };
  }
  revalidatePath("/settings/attendance");
  redirect("/settings/attendance?tab=holidays&saved=1");
}

export async function saveShiftTypeAction(_previous: ShiftTypeActionState, formData: FormData): Promise<ShiftTypeActionState> {
  const session = await requirePermission("attendance:manage", "/settings/attendance");
  const validation = validateShiftTypeFields(fields(formData));
  if (!validation.success) return { error: "Review the highlighted fields.", fieldErrors: validation.fieldErrors };
  try {
    await saveShiftType(getDatabase(), session.tenantId, session.userId, validation.data, optionalId(formData, "shiftTypeId"));
  } catch (error) {
    return { error: message(error, "The shift could not be saved."), fieldErrors: {} };
  }
  revalidatePath("/settings/attendance");
  redirect("/settings/attendance?tab=shifts&saved=1");
}

/** Archive and restore share one action so a master row is never deleted. */
export async function toggleAttendanceMasterAction(formData: FormData) {
  const session = await requirePermission("attendance:manage", "/settings/attendance");
  const kind = String(formData.get("kind") ?? "");
  const recordId = String(formData.get("recordId") ?? "");
  const nextStatus = String(formData.get("nextStatus") ?? "") === "archived" ? "archived" : "active";
  const tab = kind === "leave" ? "leave" : kind === "holiday" ? "holidays" : "shifts";
  if (!UUID_PATTERN.test(recordId) || !["leave", "holiday", "shift"].includes(kind)) {
    redirect(`/settings/attendance?tab=${tab}&masterError=1`);
  }
  const database = getDatabase();
  const { holidayCalendar, leaveTypes, shiftTypes } = await import("../../../db/schema");
  const { and, eq } = await import("drizzle-orm");
  const table = kind === "leave" ? leaveTypes : kind === "holiday" ? holidayCalendar : shiftTypes;
  try {
    await database.update(table).set({ status: nextStatus, updatedAt: new Date() })
      .where(and(eq(table.tenantId, session.tenantId), eq(table.id, recordId)));
  } catch {
    redirect(`/settings/attendance?tab=${tab}&masterError=1`);
  }
  revalidatePath("/settings/attendance");
  redirect(`/settings/attendance?tab=${tab}`);
}
