export const holidayTypes = ["public", "restricted", "optional"] as const;
export type HolidayType = typeof holidayTypes[number];

export const accrualMethods = ["annual", "monthly", "none"] as const;
export type AccrualMethod = typeof accrualMethods[number];

export type LeaveTypeInput = {
  code: string;
  name: string;
  paidByDefault: boolean;
  allowsHalfDay: boolean;
  requiresReason: boolean;
  annualQuotaDays: number;
  accrualMethod: AccrualMethod;
  carryForwardCap: number;
  carryForwardExpiryMonths: number | null;
  encashableOnExit: boolean;
  displayOrder: number;
  status: "active" | "archived";
};

export type HolidayInput = {
  holidayDate: string;
  name: string;
  holidayType: HolidayType;
  jurisdictionState: string;
  status: "active" | "archived";
};

export type ShiftTypeInput = {
  code: string;
  name: string;
  startTime: string;
  endTime: string;
  fullDayMinutes: number;
  halfDayMinutes: number;
  lateGraceMinutes: number;
  workingWeekMask: string;
  isDefault: boolean;
  status: "active" | "archived";
};

export type FieldErrors<K extends string> = Partial<Record<K, string>>;
export type MasterActionState<K extends string> = { error: string; fieldErrors: FieldErrors<K> };
export type LeaveTypeActionState = MasterActionState<keyof LeaveTypeInput>;
export type HolidayActionState = MasterActionState<keyof HolidayInput>;
export type ShiftTypeActionState = MasterActionState<keyof ShiftTypeInput>;

const LEAVE_CODE = /^[a-z][a-z0-9_]{1,29}$/;
const SHIFT_CODE = /^[A-Z0-9][A-Z0-9_-]{1,19}$/;
const TIME = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
const WEEK_MASK = /^[01]{7}$/;

function text(fields: Record<string, string | undefined>, key: string) {
  return fields[key]?.trim() ?? "";
}

function flag(fields: Record<string, string | undefined>, key: string) {
  return ["on", "true", "1"].includes(text(fields, key).toLowerCase());
}

function integer(raw: string, fallback: number) {
  return raw === "" ? fallback : (/^\d{1,4}$/.test(raw) ? Number(raw) : Number.NaN);
}

export function isDateKey(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

export function validateLeaveTypeFields(fields: Record<string, string | undefined>):
  | { success: true; data: LeaveTypeInput }
  | { success: false; fieldErrors: FieldErrors<keyof LeaveTypeInput> } {
  const code = text(fields, "code").toLowerCase().replace(/[\s-]+/g, "_");
  const name = text(fields, "name").replace(/\s+/g, " ");
  const annualQuotaDays = integer(text(fields, "annualQuotaDays"), 0);
  const accrualMethod = text(fields, "accrualMethod") || "annual";
  const carryForwardCap = integer(text(fields, "carryForwardCap"), 0);
  const rawExpiry = text(fields, "carryForwardExpiryMonths");
  const carryForwardExpiryMonths = rawExpiry === "" ? null : integer(rawExpiry, Number.NaN);
  const displayOrder = integer(text(fields, "displayOrder"), 10);
  const status = text(fields, "status") || "active";
  const fieldErrors: FieldErrors<keyof LeaveTypeInput> = {};

  if (!LEAVE_CODE.test(code)) fieldErrors.code = "Use a lowercase code of 2 to 30 characters, e.g. casual.";
  if (name.length < 2 || name.length > 60) fieldErrors.name = "Enter a leave name between 2 and 60 characters.";
  if (!Number.isInteger(annualQuotaDays) || annualQuotaDays < 0 || annualQuotaDays > 365) fieldErrors.annualQuotaDays = "Annual quota must be between 0 and 365 days. Use 0 for no quota.";
  if (!(accrualMethods as readonly string[]).includes(accrualMethod)) fieldErrors.accrualMethod = "Choose how this entitlement is granted.";
  if (!Number.isInteger(carryForwardCap) || carryForwardCap < 0 || carryForwardCap > 365) fieldErrors.carryForwardCap = "Carry-forward cap must be between 0 and 365 days. Use 0 for none.";
  if (carryForwardExpiryMonths !== null && (!Number.isInteger(carryForwardExpiryMonths) || carryForwardExpiryMonths < 1 || carryForwardExpiryMonths > 12)) fieldErrors.carryForwardExpiryMonths = "Expiry must be between 1 and 12 months, or blank if carried days never lapse.";
  // An expiry with nothing to expire is a setting that cannot mean anything.
  if (carryForwardCap === 0 && carryForwardExpiryMonths !== null) fieldErrors.carryForwardExpiryMonths = "Set a carry-forward cap before choosing when carried days lapse.";
  if (!Number.isInteger(displayOrder) || displayOrder < 0 || displayOrder > 999) fieldErrors.displayOrder = "Display order must be between 0 and 999.";
  if (status !== "active" && status !== "archived") fieldErrors.status = "Select a valid status.";

  if (Object.keys(fieldErrors).length) return { success: false, fieldErrors };
  return {
    success: true,
    data: {
      code, name,
      paidByDefault: flag(fields, "paidByDefault"),
      allowsHalfDay: flag(fields, "allowsHalfDay"),
      requiresReason: flag(fields, "requiresReason"),
      annualQuotaDays,
      accrualMethod: accrualMethod as AccrualMethod,
      carryForwardCap,
      carryForwardExpiryMonths,
      encashableOnExit: flag(fields, "encashableOnExit"),
      displayOrder,
      status: status as "active" | "archived",
    },
  };
}

export function validateHolidayFields(fields: Record<string, string | undefined>):
  | { success: true; data: HolidayInput }
  | { success: false; fieldErrors: FieldErrors<keyof HolidayInput> } {
  const holidayDate = text(fields, "holidayDate");
  const name = text(fields, "name").replace(/\s+/g, " ");
  const holidayType = text(fields, "holidayType") || "public";
  const jurisdictionState = text(fields, "jurisdictionState").replace(/\s+/g, " ") || "Bihar";
  const status = text(fields, "status") || "active";
  const fieldErrors: FieldErrors<keyof HolidayInput> = {};

  if (!isDateKey(holidayDate)) fieldErrors.holidayDate = "Enter the holiday date.";
  if (name.length < 2 || name.length > 80) fieldErrors.name = "Enter the holiday name.";
  if (!holidayTypes.includes(holidayType as HolidayType)) fieldErrors.holidayType = "Select a valid holiday type.";
  if (jurisdictionState.length < 2 || jurisdictionState.length > 40) fieldErrors.jurisdictionState = "Enter the state this holiday applies to.";
  if (status !== "active" && status !== "archived") fieldErrors.status = "Select a valid status.";

  if (Object.keys(fieldErrors).length) return { success: false, fieldErrors };
  return { success: true, data: { holidayDate, name, holidayType: holidayType as HolidayType, jurisdictionState, status: status as "active" | "archived" } };
}

export function validateShiftTypeFields(fields: Record<string, string | undefined>):
  | { success: true; data: ShiftTypeInput }
  | { success: false; fieldErrors: FieldErrors<keyof ShiftTypeInput> } {
  const code = text(fields, "code").toUpperCase().replace(/\s+/g, "_");
  const name = text(fields, "name").replace(/\s+/g, " ");
  const startTime = text(fields, "startTime");
  const endTime = text(fields, "endTime");
  const fullDayMinutes = integer(text(fields, "fullDayMinutes"), 450);
  const halfDayMinutes = integer(text(fields, "halfDayMinutes"), 225);
  const lateGraceMinutes = integer(text(fields, "lateGraceMinutes"), 15);
  const workingWeekMask = text(fields, "workingWeekMask") || "1111110";
  const status = text(fields, "status") || "active";
  const fieldErrors: FieldErrors<keyof ShiftTypeInput> = {};

  if (!SHIFT_CODE.test(code)) fieldErrors.code = "Use an uppercase code of 2 to 20 characters, e.g. GENERAL.";
  if (name.length < 2 || name.length > 60) fieldErrors.name = "Enter a shift name between 2 and 60 characters.";
  if (!TIME.test(startTime)) fieldErrors.startTime = "Enter a start time as HH:MM.";
  if (!TIME.test(endTime)) fieldErrors.endTime = "Enter an end time as HH:MM.";
  if (TIME.test(startTime) && TIME.test(endTime) && startTime >= endTime) fieldErrors.endTime = "The shift must end after it starts.";
  if (!WEEK_MASK.test(workingWeekMask) || !workingWeekMask.includes("1")) fieldErrors.workingWeekMask = "Select at least one working day.";
  if (!Number.isInteger(fullDayMinutes) || fullDayMinutes < 60 || fullDayMinutes > 960) fieldErrors.fullDayMinutes = "A full day must be between 60 and 960 minutes.";
  if (!Number.isInteger(lateGraceMinutes) || lateGraceMinutes < 0 || lateGraceMinutes > 180) fieldErrors.lateGraceMinutes = "Late grace must be between 0 and 180 minutes.";
  if (!Number.isInteger(halfDayMinutes) || halfDayMinutes < 30) fieldErrors.halfDayMinutes = "A half day must be at least 30 minutes.";
  else if (Number.isInteger(fullDayMinutes) && halfDayMinutes >= fullDayMinutes) fieldErrors.halfDayMinutes = "A half day must be shorter than a full day.";
  if (status !== "active" && status !== "archived") fieldErrors.status = "Select a valid status.";

  if (Object.keys(fieldErrors).length) return { success: false, fieldErrors };
  return {
    success: true,
    data: {
      code, name, startTime, endTime, fullDayMinutes, halfDayMinutes, lateGraceMinutes, workingWeekMask,
      isDefault: flag(fields, "isDefault"),
      status: status as "active" | "archived",
    },
  };
}

const WEEK_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function describeWorkingWeek(mask: string) {
  if (!WEEK_MASK.test(mask)) return "Not set";
  const days = WEEK_LABELS.filter((_, index) => mask[index] === "1");
  return days.length === 7 ? "Every day" : days.join(", ");
}
