import type { ComplianceFrequency } from "./recurrence";

export const complianceFrequencies = ["monthly", "quarterly", "annual"] as const;

export type ComplianceScheduleInput = {
  serviceCode: string;
  frequency: ComplianceFrequency;
  dueMonthOffset: number;
  dueDay: number;
  internalLeadDays: number;
  effectiveFrom: string;
  status: "active" | "archived";
};

export type ComplianceScheduleFieldErrors = Partial<Record<keyof ComplianceScheduleInput, string>>;
export type ComplianceScheduleActionState = { error: string; fieldErrors: ComplianceScheduleFieldErrors };

const SERVICE_CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{1,19}$/;

function text(fields: Record<string, string | undefined>, key: string) {
  return fields[key]?.trim() ?? "";
}

function integer(raw: string) {
  return /^-?\d{1,4}$/.test(raw) ? Number(raw) : Number.NaN;
}

export function validateComplianceScheduleFields(fields: Record<string, string | undefined>):
  | { success: true; data: ComplianceScheduleInput }
  | { success: false; fieldErrors: ComplianceScheduleFieldErrors } {
  const serviceCode = text(fields, "serviceCode").toUpperCase();
  const frequency = text(fields, "frequency");
  const dueMonthOffset = integer(text(fields, "dueMonthOffset"));
  const dueDay = integer(text(fields, "dueDay"));
  const internalLeadDays = integer(text(fields, "internalLeadDays") || "3");
  const effectiveFrom = text(fields, "effectiveFrom");
  const status = text(fields, "status") || "active";
  const fieldErrors: ComplianceScheduleFieldErrors = {};

  if (!SERVICE_CODE_PATTERN.test(serviceCode)) fieldErrors.serviceCode = "Enter a service code from the service master, e.g. GST.";
  if (!complianceFrequencies.includes(frequency as ComplianceFrequency)) fieldErrors.frequency = "Select how often the obligation recurs.";
  if (!Number.isInteger(dueMonthOffset) || dueMonthOffset < 0 || dueMonthOffset > 12) fieldErrors.dueMonthOffset = "Months after the period ends must be between 0 and 12.";
  if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31) fieldErrors.dueDay = "Due day must be between 1 and 31.";
  if (!Number.isInteger(internalLeadDays) || internalLeadDays < 0 || internalLeadDays > 60) fieldErrors.internalLeadDays = "Internal lead days must be between 0 and 60.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom) || Number.isNaN(Date.parse(`${effectiveFrom}T00:00:00Z`))) fieldErrors.effectiveFrom = "Enter the date this rule takes effect.";
  if (status !== "active" && status !== "archived") fieldErrors.status = "Select a valid status.";

  if (Object.keys(fieldErrors).length) return { success: false, fieldErrors };
  return {
    success: true,
    data: {
      serviceCode,
      frequency: frequency as ComplianceFrequency,
      dueMonthOffset,
      dueDay,
      internalLeadDays,
      effectiveFrom,
      status: status as "active" | "archived",
    },
  };
}

export function describeSchedule(input: Pick<ComplianceScheduleInput, "frequency" | "dueMonthOffset" | "dueDay">) {
  const cadence = { monthly: "Every month", quarterly: "Every quarter", annual: "Every financial year" }[input.frequency];
  const offset = input.dueMonthOffset === 0
    ? "in the closing month"
    : `${input.dueMonthOffset} month${input.dueMonthOffset === 1 ? "" : "s"} after the period ends`;
  return `${cadence}, due on day ${input.dueDay} ${offset}.`;
}
