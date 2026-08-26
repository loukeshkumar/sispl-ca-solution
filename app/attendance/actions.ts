"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import type { Role } from "../../lib/auth/authorization";
import { requirePermission } from "../../lib/auth/server";
import {
  AttendanceRepositoryError, checkIn, checkOut, createAttendancePolicy, createCorrectionRequest, createLeaveRequest,
  decideCorrectionRequest, decideLeaveRequest, lockAttendancePeriod, moveAttendancePeriodToReview,
  getAttendanceWorkspace, prepareAttendancePeriod, recordManualAttendance, reopenAttendancePeriod, upsertEmployeeWorkProfile,
} from "../../lib/attendance/repository";
import { getAttendanceMatrix, type AttendanceMatrix } from "../../lib/attendance/matrix";
import { indiaPeriodKey } from "../../lib/attendance/calculations";
import {
  validateAttendancePolicyFields, validateCorrectionRequestFields, validateEmployeeWorkProfileFields,
  validateLeaveRequestFields, validateManualAttendanceFields, validatePeriodFields, type AttendanceFields,
} from "../../lib/attendance/validation";
import { getDatabase } from "../../lib/dashboard/postgres/pool";

export type AttendanceActionState = { error: string; fieldErrors: Record<string, string> };
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fields = (formData: FormData, names: string[]): AttendanceFields => Object.fromEntries(names.map((name) => [name, typeof formData.get(name) === "string" ? String(formData.get(name)) : ""]));
const actionError = (error: unknown): AttendanceActionState => ({ error: error instanceof AttendanceRepositoryError ? error.message : "Attendance could not be updated. Refresh and try again.", fieldErrors: {} });
const refreshAttendance = () => revalidatePath("/");

export async function checkInAttendanceAction() {
  const session = await requirePermission("attendance:use", "/?workspace=attendance");
  try { await checkIn(getDatabase(), session.tenantId, session.userId); } catch { redirect("/?workspace=attendance&attendanceError=clock"); }
  refreshAttendance(); redirect("/?workspace=attendance&toast=attendance-clocked");
}

export async function checkOutAttendanceAction() {
  const session = await requirePermission("attendance:use", "/?workspace=attendance");
  try { await checkOut(getDatabase(), session.tenantId, session.userId); } catch { redirect("/?workspace=attendance&attendanceError=clock"); }
  refreshAttendance(); redirect("/?workspace=attendance&toast=attendance-clocked");
}

export async function createLeaveRequestAction(_previous: AttendanceActionState, formData: FormData): Promise<AttendanceActionState> {
  const session = await requirePermission("attendance:use", "/?workspace=attendance");
  const validation = validateLeaveRequestFields(fields(formData, ["dateFrom", "dateTo", "leaveType", "dayPortion", "paidClassification", "reason"]));
  if (!validation.success) return { error: "Review the highlighted fields.", fieldErrors: validation.fieldErrors };
  try { await createLeaveRequest(getDatabase(), session.tenantId, session.userId, validation.data); } catch (error) { return actionError(error); }
  refreshAttendance(); redirect("/?workspace=attendance&toast=attendance-requested");
}

export async function createCorrectionRequestAction(_previous: AttendanceActionState, formData: FormData): Promise<AttendanceActionState> {
  const session = await requirePermission("attendance:use", "/?workspace=attendance");
  const validation = validateCorrectionRequestFields(fields(formData, ["attendanceDate", "proposedCheckInTime", "proposedCheckOutTime", "proposedStatus", "reason"]));
  if (!validation.success) return { error: "Review the highlighted fields.", fieldErrors: validation.fieldErrors };
  try { await createCorrectionRequest(getDatabase(), session.tenantId, session.userId, validation.data); } catch (error) { return actionError(error); }
  refreshAttendance(); redirect("/?workspace=attendance&toast=attendance-requested");
}

/**
 * The month grid. Gated on `attendance:manage` — the same permission that
 * allows marking — because the grid shows every employee's month at once, which
 * is more than the people workspaces expose to a regular employee.
 */
export async function loadAttendanceMatrixAction(periodKey: string): Promise<AttendanceMatrix> {
  const session = await requirePermission("attendance:manage", "/?workspace=attendance");
  const database = getDatabase();
  const safeKey = /^\d{4}-\d{2}$/.test(periodKey) ? periodKey : indiaPeriodKey();
  const workspace = await getAttendanceWorkspace(database, session.tenantId, session.userId, session.roleKey as Role, safeKey);
  return getAttendanceMatrix(database, session.tenantId, safeKey, workspace.policy.workingWeekMask, workspace.todayKey);
}

/**
 * Marks one cell of the grid. Delegates to the same audited write the manual
 * form uses, so a fast click carries the identical period lock, employment-date
 * check, and audit event as a considered entry.
 */
export async function markAttendanceCellAction(input: {
  attendanceDate: string;
  checkInTime: string;
  checkOutTime: string;
  employeeUserId: string;
  note: string;
  status: string;
}): Promise<{ error: string }> {
  const session = await requirePermission("attendance:manage", "/?workspace=attendance");
  if (!UUID_PATTERN.test(input.employeeUserId)) return { error: "Choose a valid employee." };
  const validation = validateManualAttendanceFields({
    attendanceDate: input.attendanceDate,
    checkInTime: input.checkInTime,
    checkOutTime: input.checkOutTime,
    note: input.note,
    status: input.status,
  });
  if (!validation.success) return { error: Object.values(validation.fieldErrors)[0] ?? "Review the entry." };
  try {
    await recordManualAttendance(getDatabase(), session.tenantId, session.userId, session.roleKey as Role, input.employeeUserId, validation.data);
  } catch (error) {
    return { error: actionError(error).error };
  }
  refreshAttendance();
  return { error: "" };
}

export async function recordManualAttendanceAction(_previous: AttendanceActionState, formData: FormData): Promise<AttendanceActionState> {
  const session = await requirePermission("attendance:manage", "/?workspace=attendance");
  const employeeUserId = String(formData.get("employeeUserId") ?? "");
  if (!UUID_PATTERN.test(employeeUserId)) return { error: "Choose a valid employee.", fieldErrors: { employeeUserId: "Choose a valid employee." } };
  const validation = validateManualAttendanceFields(fields(formData, ["attendanceDate", "checkInTime", "checkOutTime", "status", "note"]));
  if (!validation.success) return { error: "Review the highlighted fields.", fieldErrors: validation.fieldErrors };
  try { await recordManualAttendance(getDatabase(), session.tenantId, session.userId, session.roleKey as Role, employeeUserId, validation.data); } catch (error) { return actionError(error); }
  refreshAttendance(); return { error: "", fieldErrors: {} };
}

export async function createAttendancePolicyAction(_previous: AttendanceActionState, formData: FormData): Promise<AttendanceActionState> {
  const session = await requirePermission("attendance:manage", "/?workspace=attendance");
  const validation = validateAttendancePolicyFields(fields(formData, ["effectiveFrom", "fullDayMinutes", "halfDayMinutes", "jurisdictionState", "lateGraceMinutes", "standardEndTime", "standardStartTime", "timeZone", "workingWeekMask"]));
  if (!validation.success) return { error: "Review the attendance policy fields.", fieldErrors: validation.fieldErrors };
  try { await createAttendancePolicy(getDatabase(), session.tenantId, session.userId, validation.data); } catch (error) { return actionError(error); }
  refreshAttendance(); return { error: "", fieldErrors: {} };
}

export async function updateEmployeeWorkProfileAction(_previous: AttendanceActionState, formData: FormData): Promise<AttendanceActionState> {
  const session = await requirePermission("attendance:manage", "/?workspace=attendance");
  const validation = validateEmployeeWorkProfileFields(fields(formData, ["employeeUserId", "managerUserId", "employmentType", "workLocationState"]));
  if (!validation.success) return { error: "Review the employee work profile.", fieldErrors: validation.fieldErrors };
  try { await upsertEmployeeWorkProfile(getDatabase(), session.tenantId, session.userId, validation.data); } catch (error) { return actionError(error); }
  refreshAttendance(); return { error: "", fieldErrors: {} };
}

export async function decideAttendanceRequestAction(formData: FormData) {
  const session = await requirePermission("attendance:review", "/?workspace=attendance");
  const requestId = String(formData.get("requestId") ?? "");
  const kind = String(formData.get("kind") ?? "");
  const decision = String(formData.get("decision") ?? "");
  const decisionNote = String(formData.get("decisionNote") ?? "").trim();
  const quotaExceptionReason = String(formData.get("quotaExceptionReason") ?? "").trim();
  if (!UUID_PATTERN.test(requestId) || !["leave", "correction"].includes(kind) || !["approved", "rejected"].includes(decision)) redirect("/?workspace=attendance&attendanceError=request");
  try {
    if (kind === "leave") await decideLeaveRequest(getDatabase(), session.tenantId, session.userId, session.roleKey as Role, requestId, decision as "approved" | "rejected", decisionNote, quotaExceptionReason);
    else await decideCorrectionRequest(getDatabase(), session.tenantId, session.userId, session.roleKey as Role, requestId, decision as "approved" | "rejected", decisionNote);
  } catch (error) {
    // A refused approval is a decision the reviewer has to make, not a fault to
    // hide behind the generic message.
    if (error instanceof AttendanceRepositoryError && error.code === "quota_exceeded") {
      redirect("/?workspace=attendance&toast=attendance-quota-blocked");
    }
    redirect("/?workspace=attendance&attendanceError=request");
  }
  refreshAttendance(); redirect("/?workspace=attendance&toast=attendance-decided");
}

export async function prepareAttendancePeriodAction(formData: FormData) {
  const session = await requirePermission("attendance:manage", "/?workspace=attendance");
  const validation = validatePeriodFields({ periodKey: String(formData.get("periodKey") ?? "") });
  if (!validation.success) redirect("/?workspace=attendance&attendanceError=period");
  try { await prepareAttendancePeriod(getDatabase(), session.tenantId, session.userId, validation.data.periodKey); } catch { redirect("/?workspace=attendance&attendanceError=period"); }
  refreshAttendance(); redirect("/?workspace=attendance");
}

async function periodTransition(formData: FormData, operation: "review" | "lock" | "reopen") {
  const session = await requirePermission("attendance:manage", "/?workspace=attendance");
  const periodId = String(formData.get("periodId") ?? "");
  const reason = String(formData.get("reason") ?? "");
  if (!UUID_PATTERN.test(periodId)) redirect("/?workspace=attendance&attendanceError=period");
  try {
    if (operation === "review") await moveAttendancePeriodToReview(getDatabase(), session.tenantId, session.userId, periodId);
    else if (operation === "lock") await lockAttendancePeriod(getDatabase(), session.tenantId, session.userId, periodId);
    else await reopenAttendancePeriod(getDatabase(), session.tenantId, session.userId, periodId, reason);
  } catch { redirect("/?workspace=attendance&attendanceError=period"); }
  refreshAttendance(); redirect("/?workspace=attendance");
}

export async function reviewAttendancePeriodAction(formData: FormData) { return periodTransition(formData, "review"); }
export async function lockAttendancePeriodAction(formData: FormData) { return periodTransition(formData, "lock"); }
export async function reopenAttendancePeriodAction(formData: FormData) { return periodTransition(formData, "reopen"); }
