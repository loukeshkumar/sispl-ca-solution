import { parseMoneyToPaise } from "./money";

export const salaryLineKinds = ["earning", "deduction", "employer_contribution"] as const;
export type SalaryLineKind = typeof salaryLineKinds[number];
export type SalaryStructureLineInput = { code: string; label: string; kind: SalaryLineKind; monthlyAmountPaise: number };
export type SalaryStructureInput = { employeeUserId: string; effectiveFrom: string; lines: SalaryStructureLineInput[] };
export type PayrollValidation<T> = { success: true; data: T } | { success: false; fieldErrors: Record<string, string> };
export type PayrollFields = Record<string, string | undefined>;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
const RESERVED_COMPONENT_CODES = new Set(["EMPLOYMENT_PRORATION", "ATTENDANCE_LOP", "ONE_TIME_ADD", "ONE_TIME_DED", "EMP_PF", "EMP_ESI", "PROF_TAX", "INCOME_TAX"]);
const validDate = (input: string) => {
  if (!DATE_PATTERN.test(input)) return false;
  const date = new Date(`${input}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === input;
};
const value = (fields: PayrollFields, key: string) => fields[key]?.trim() ?? "";

export function validateSalaryStructureFields(fields: PayrollFields): PayrollValidation<SalaryStructureInput> {
  const employeeUserId = value(fields, "employeeUserId");
  const effectiveFrom = value(fields, "effectiveFrom");
  const fieldErrors: Record<string, string> = {};
  if (!UUID_PATTERN.test(employeeUserId)) fieldErrors.employeeUserId = "Choose a valid employee.";
  if (!validDate(effectiveFrom)) fieldErrors.effectiveFrom = "Enter a valid effective date.";
  let parsed: unknown = [];
  try { parsed = JSON.parse(value(fields, "lines")); } catch { fieldErrors.lines = "Salary components are invalid."; }
  const lines: SalaryStructureLineInput[] = [];
  const codes = new Set<string>();
  if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > 30) fieldErrors.lines = "Add between 1 and 30 salary components.";
  if (Array.isArray(parsed)) parsed.forEach((raw, index) => {
    if (!raw || typeof raw !== "object") { fieldErrors[`lines.${index}`] = "Salary component is invalid."; return; }
    const item = raw as Record<string, unknown>;
    const code = String(item.code ?? "").trim().toUpperCase();
    const label = String(item.label ?? "").trim().replace(/\s+/g, " ");
    const kind = String(item.kind ?? "");
    const amount = parseMoneyToPaise(String(item.monthlyAmount ?? ""));
    if (!/^[A-Z][A-Z0-9_]{1,29}$/.test(code)) fieldErrors[`lines.${index}.code`] = "Use a unique component code.";
    if (RESERVED_COMPONENT_CODES.has(code)) fieldErrors[`lines.${index}.code`] = "This component code is reserved for payroll calculations.";
    if (codes.has(code)) fieldErrors[`lines.${index}.code`] = "Component codes must be unique.";
    codes.add(code);
    if (label.length < 2 || label.length > 80) fieldErrors[`lines.${index}.label`] = "Component label must be 2 to 80 characters.";
    if (!salaryLineKinds.includes(kind as SalaryLineKind)) fieldErrors[`lines.${index}.kind`] = "Choose a valid component kind.";
    if (amount === null) fieldErrors[`lines.${index}.monthlyAmount`] = "Enter a non-negative amount with no more than two decimals.";
    if (amount !== null) lines.push({ code, label, kind: kind as SalaryLineKind, monthlyAmountPaise: amount });
  });
  if (!lines.some((line) => line.kind === "earning")) fieldErrors.lines = "Add at least one earning component.";
  return Object.keys(fieldErrors).length ? { success: false, fieldErrors } : { success: true, data: { employeeUserId, effectiveFrom, lines } };
}

export function validatePayrollPeriodFields(fields: PayrollFields): PayrollValidation<{ periodKey: string; payDate: string }> {
  const periodKey = value(fields, "periodKey"); const payDate = value(fields, "payDate");
  const fieldErrors: Record<string, string> = {};
  if (!MONTH_PATTERN.test(periodKey)) fieldErrors.periodKey = "Enter a valid payroll month.";
  if (!validDate(payDate)) fieldErrors.payDate = "Enter a valid pay date.";
  return Object.keys(fieldErrors).length ? { success: false, fieldErrors } : { success: true, data: { periodKey, payDate } };
}

export type PayrollEntryInput = { employeeUserId: string; employeeProvidentFundPaise: number; employeeStateInsurancePaise: number; hold: boolean; holdReason: string; incomeTaxPaise: number; note: string; oneTimeAdditionPaise: number; oneTimeDeductionPaise: number; professionalTaxPaise: number };
export function validatePayrollEntryFields(fields: PayrollFields): PayrollValidation<PayrollEntryInput> {
  const employeeUserId = value(fields, "employeeUserId"); const note = value(fields, "note");
  const hold = ["on", "true", "1"].includes(value(fields, "hold").toLowerCase());
  const holdReason = value(fields, "holdReason").replace(/\s+/g, " ");
  const mappings = { employeeProvidentFund: "employeeProvidentFundPaise", employeeStateInsurance: "employeeStateInsurancePaise", incomeTax: "incomeTaxPaise", oneTimeAddition: "oneTimeAdditionPaise", oneTimeDeduction: "oneTimeDeductionPaise", professionalTax: "professionalTaxPaise" } as const;
  const fieldErrors: Record<string, string> = {};
  if (!UUID_PATTERN.test(employeeUserId)) fieldErrors.employeeUserId = "Choose a valid employee.";
  if (note.length > 500) fieldErrors.note = "Payroll notes cannot exceed 500 characters.";
  if (hold && (holdReason.length < 3 || holdReason.length > 500)) fieldErrors.holdReason = "Enter a hold reason between 3 and 500 characters.";
  if (!hold && holdReason.length > 500) fieldErrors.holdReason = "Hold reason cannot exceed 500 characters.";
  const amounts: Record<string, number> = {};
  for (const [field, target] of Object.entries(mappings)) {
    const amount = parseMoneyToPaise(value(fields, field));
    if (amount === null) fieldErrors[field] = "Enter a non-negative amount with no more than two decimals.";
    else amounts[target] = amount;
  }
  return Object.keys(fieldErrors).length ? { success: false, fieldErrors } : { success: true, data: { employeeUserId, hold, holdReason: hold ? holdReason : "", note, ...amounts } as PayrollEntryInput };
}

export function validateTransitionReason(raw: string, required: boolean): PayrollValidation<{ reason: string }> {
  const reason = raw.trim().replace(/\s+/g, " ");
  if ((required && reason.length < 3) || reason.length > 500) return { success: false, fieldErrors: { reason: required ? "Enter a reason between 3 and 500 characters." : "Reason cannot exceed 500 characters." } };
  return { success: true, data: { reason } };
}
