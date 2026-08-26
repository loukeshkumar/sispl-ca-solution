export const attendanceStatuses = ["present", "absent", "leave", "half_day", "late", "missing_punch", "weekly_off", "holiday", "wfh", "tour"] as const;
export const employmentTypes = ["employee", "articled_assistant"] as const;
export const leaveTypes = ["casual", "sick", "earned", "maternity", "compensatory", "other"] as const;
export type AttendanceStatus = typeof attendanceStatuses[number];
export type EmploymentType = typeof employmentTypes[number];
export type AttendanceFields = Record<string, string | undefined>;
export type AttendanceValidation<T> = { success: true; data: T } | { success: false; fieldErrors: Record<string, string> };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
const value = (fields: AttendanceFields, key: string) => fields[key]?.trim() ?? "";
const validDate = (input: string) => {
  if (!DATE_PATTERN.test(input)) return false;
  const date = new Date(`${input}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === input;
};
const minuteOfDay = (input: string) => Number(input.slice(0, 2)) * 60 + Number(input.slice(3, 5));
const integer = (input: string) => /^\d+$/.test(input) ? Number(input) : Number.NaN;

export type AttendancePolicyInput = {
  effectiveFrom: string; fullDayMinutes: number; halfDayMinutes: number; jurisdictionState: string;
  lateGraceMinutes: number; standardEndTime: string; standardStartTime: string; timeZone: string; workingWeekMask: string;
};

export function validateAttendancePolicyFields(fields: AttendanceFields): AttendanceValidation<AttendancePolicyInput> {
  const data = {
    effectiveFrom: value(fields, "effectiveFrom"), fullDayMinutes: integer(value(fields, "fullDayMinutes")),
    halfDayMinutes: integer(value(fields, "halfDayMinutes")), jurisdictionState: value(fields, "jurisdictionState").replace(/\s+/g, " "),
    lateGraceMinutes: integer(value(fields, "lateGraceMinutes")), standardEndTime: value(fields, "standardEndTime"),
    standardStartTime: value(fields, "standardStartTime"), timeZone: value(fields, "timeZone"), workingWeekMask: value(fields, "workingWeekMask"),
  };
  const fieldErrors: Record<string, string> = {};
  if (!validDate(data.effectiveFrom) || !data.effectiveFrom.endsWith("-01")) fieldErrors.effectiveFrom = "Policy versions must begin on the first day of a month.";
  if (!Number.isInteger(data.fullDayMinutes) || data.fullDayMinutes < 60 || data.fullDayMinutes > 960) fieldErrors.fullDayMinutes = "Full-day minutes must be between 60 and 960.";
  if (!Number.isInteger(data.halfDayMinutes) || data.halfDayMinutes < 30 || data.halfDayMinutes >= data.fullDayMinutes) fieldErrors.halfDayMinutes = "Half-day minutes must be lower than full-day minutes.";
  if (data.jurisdictionState.length < 2 || data.jurisdictionState.length > 80) fieldErrors.jurisdictionState = "Enter the work-location State or UT.";
  if (!Number.isInteger(data.lateGraceMinutes) || data.lateGraceMinutes < 0 || data.lateGraceMinutes > 180) fieldErrors.lateGraceMinutes = "Late grace must be between 0 and 180 minutes.";
  if (!TIME_PATTERN.test(data.standardStartTime)) fieldErrors.standardStartTime = "Enter a valid start time.";
  if (!TIME_PATTERN.test(data.standardEndTime) || (TIME_PATTERN.test(data.standardStartTime) && minuteOfDay(data.standardEndTime) <= minuteOfDay(data.standardStartTime))) fieldErrors.standardEndTime = "End time must be after start time.";
  if (data.timeZone !== "Asia/Kolkata") fieldErrors.timeZone = "This release supports Asia/Kolkata.";
  if (!/^[01]{7}$/.test(data.workingWeekMask) || !data.workingWeekMask.includes("1")) fieldErrors.workingWeekMask = "Choose at least one working weekday.";
  return Object.keys(fieldErrors).length ? { success: false, fieldErrors } : { success: true, data };
}

export type EmployeeWorkProfileInput = { employeeUserId: string; managerUserId: string | null; employmentType: EmploymentType; workLocationState: string };
export function validateEmployeeWorkProfileFields(fields: AttendanceFields): AttendanceValidation<EmployeeWorkProfileInput> {
  const employeeUserId = value(fields, "employeeUserId");
  const rawManager = value(fields, "managerUserId");
  const employmentType = value(fields, "employmentType");
  const workLocationState = value(fields, "workLocationState").replace(/\s+/g, " ");
  const fieldErrors: Record<string, string> = {};
  if (!UUID_PATTERN.test(employeeUserId)) fieldErrors.employeeUserId = "Choose a valid employee.";
  if (rawManager && !UUID_PATTERN.test(rawManager)) fieldErrors.managerUserId = "Choose a valid reporting manager.";
  if (rawManager && rawManager === employeeUserId) fieldErrors.managerUserId = "An employee cannot report to themselves.";
  if (!employmentTypes.includes(employmentType as EmploymentType)) fieldErrors.employmentType = "Choose a valid employment classification.";
  if (workLocationState.length < 2 || workLocationState.length > 80) fieldErrors.workLocationState = "Enter the work-location State or UT.";
  return Object.keys(fieldErrors).length ? { success: false, fieldErrors } : { success: true, data: { employeeUserId, managerUserId: rawManager || null, employmentType: employmentType as EmploymentType, workLocationState } };
}

export type ManualAttendanceInput = { attendanceDate: string; checkInTime: string | null; checkOutTime: string | null; note: string; status: AttendanceStatus };
export function validateManualAttendanceFields(fields: AttendanceFields): AttendanceValidation<ManualAttendanceInput> {
  const attendanceDate = value(fields, "attendanceDate");
  const checkInTime = value(fields, "checkInTime");
  const checkOutTime = value(fields, "checkOutTime");
  const note = value(fields, "note");
  const status = value(fields, "status");
  const fieldErrors: Record<string, string> = {};
  if (!validDate(attendanceDate)) fieldErrors.attendanceDate = "Enter a valid attendance date.";
  if (checkInTime && !TIME_PATTERN.test(checkInTime)) fieldErrors.checkInTime = "Enter a valid check-in time.";
  if (checkOutTime && !TIME_PATTERN.test(checkOutTime)) fieldErrors.checkOutTime = "Enter a valid check-out time.";
  if (checkInTime && checkOutTime && TIME_PATTERN.test(checkInTime) && TIME_PATTERN.test(checkOutTime) && minuteOfDay(checkOutTime) <= minuteOfDay(checkInTime)) fieldErrors.checkOutTime = "Check-out must be after check-in.";
  if (!attendanceStatuses.includes(status as AttendanceStatus)) fieldErrors.status = "Choose a valid attendance status.";
  if (note.length > 500) fieldErrors.note = "Attendance notes cannot exceed 500 characters.";
  return Object.keys(fieldErrors).length ? { success: false, fieldErrors } : { success: true, data: { attendanceDate, checkInTime: checkInTime || null, checkOutTime: checkOutTime || null, note, status: status as AttendanceStatus } };
}

const LEAVE_TYPE_CODE = /^[a-z][a-z0-9_]{1,29}$/;

export type LeaveRequestInput = { dateFrom: string; dateTo: string; dayPortion: "full" | "first_half" | "second_half"; leaveType: string; paidClassification: "paid" | "unpaid"; reason: string };
/**
 * `allowedLeaveTypes` comes from the firm's leave-type master. It is optional so
 * existing callers keep the built-in list; when supplied, only those codes pass.
 */
export function validateLeaveRequestFields(fields: AttendanceFields, allowedLeaveTypes?: readonly string[]): AttendanceValidation<LeaveRequestInput> {
  const dateFrom = value(fields, "dateFrom"); const dateTo = value(fields, "dateTo");
  const dayPortion = value(fields, "dayPortion"); const leaveType = value(fields, "leaveType");
  const paidClassification = value(fields, "paidClassification"); const reason = value(fields, "reason");
  const fieldErrors: Record<string, string> = {};
  if (!validDate(dateFrom)) fieldErrors.dateFrom = "Enter a valid start date.";
  if (!validDate(dateTo) || (validDate(dateFrom) && dateTo < dateFrom)) fieldErrors.dateTo = "End date cannot be before the start date.";
  const permitted = allowedLeaveTypes ?? leaveTypes;
  if (!LEAVE_TYPE_CODE.test(leaveType) || !permitted.includes(leaveType)) fieldErrors.leaveType = "Choose a valid leave type.";
  if (!["full", "first_half", "second_half"].includes(dayPortion)) fieldErrors.dayPortion = "Choose a valid leave duration.";
  if (!["paid", "unpaid"].includes(paidClassification)) fieldErrors.paidClassification = "Choose paid or unpaid leave.";
  if (reason.length < 3 || reason.length > 500) fieldErrors.reason = "Enter a reason between 3 and 500 characters.";
  return Object.keys(fieldErrors).length ? { success: false, fieldErrors } : { success: true, data: { dateFrom, dateTo, dayPortion: dayPortion as LeaveRequestInput["dayPortion"], leaveType, paidClassification: paidClassification as LeaveRequestInput["paidClassification"], reason } };
}

export type CorrectionRequestInput = { attendanceDate: string; proposedCheckInTime: string | null; proposedCheckOutTime: string | null; proposedStatus: AttendanceStatus; reason: string };
export function validateCorrectionRequestFields(fields: AttendanceFields): AttendanceValidation<CorrectionRequestInput> {
  const manual = validateManualAttendanceFields({ attendanceDate: fields.attendanceDate, checkInTime: fields.proposedCheckInTime, checkOutTime: fields.proposedCheckOutTime, note: "", status: fields.proposedStatus });
  const reason = value(fields, "reason");
  const fieldErrors = manual.success ? {} : { ...manual.fieldErrors };
  if (reason.length < 3 || reason.length > 500) fieldErrors.reason = "Enter a reason between 3 and 500 characters.";
  return Object.keys(fieldErrors).length || !manual.success ? { success: false, fieldErrors } : { success: true, data: { attendanceDate: manual.data.attendanceDate, proposedCheckInTime: manual.data.checkInTime, proposedCheckOutTime: manual.data.checkOutTime, proposedStatus: manual.data.status, reason } };
}

export function validatePeriodFields(fields: AttendanceFields): AttendanceValidation<{ periodKey: string }> {
  const periodKey = value(fields, "periodKey");
  return MONTH_PATTERN.test(periodKey) ? { success: true, data: { periodKey } } : { success: false, fieldErrors: { periodKey: "Enter a valid payroll month." } };
}
