import type { SalaryLineKind, SalaryStructureLineInput } from "./validation";

export class PayrollCalculationError extends Error {
  constructor(public readonly code: "invalid_amount" | "invalid_units" | "negative_net") {
    super({
      invalid_amount: "Payroll amounts must be non-negative integer paise.",
      invalid_units: "Attendance units are inconsistent for this payroll entry.",
      negative_net: "Payroll deductions would make net pay negative.",
    }[code]);
    this.name = "PayrollCalculationError";
  }
}

export type PayrollLineSource = "salary_structure" | "employment" | "attendance" | "adjustment" | "statutory";
export type CalculatedPayrollLine = {
  amountPaise: number;
  code: string;
  kind: SalaryLineKind;
  label: string;
  source: PayrollLineSource;
};

export type PayrollCalculationInput = {
  employeeProvidentFundPaise?: number;
  employeeStateInsurancePaise?: number;
  incomeTaxPaise?: number;
  employmentExcludedHalfDays?: number;
  lopHalfDays: number;
  oneTimeAdditionPaise?: number;
  oneTimeDeductionPaise?: number;
  payableHalfDays: number;
  periodScheduledHalfDays?: number;
  professionalTaxPaise?: number;
  salaryLines: SalaryStructureLineInput[];
  scheduledHalfDays: number;
};

export type PayrollCalculationResult = {
  attendanceDeductionPaise: number;
  earnedGrossPaise: number;
  employmentProrationDeductionPaise: number;
  employerCostPaise: number;
  fullGrossPaise: number;
  lines: CalculatedPayrollLine[];
  netPayPaise: number;
  recurringDeductionPaise: number;
  totalDeductionsPaise: number;
};

function requireMoney(...amounts: number[]) {
  if (amounts.some((amount) => !Number.isSafeInteger(amount) || amount < 0)) throw new PayrollCalculationError("invalid_amount");
}

function roundedRatio(amountPaise: number, numerator: number, denominator: number) {
  if (denominator <= 0) return 0;
  const whole = Math.floor(amountPaise / denominator);
  const remainder = amountPaise % denominator;
  const result = whole * numerator + Math.floor((remainder * numerator * 2 + denominator) / (denominator * 2));
  if (!Number.isSafeInteger(result)) throw new PayrollCalculationError("invalid_amount");
  return result;
}

export function calculatePayrollEntry(input: PayrollCalculationInput): PayrollCalculationResult {
  const employeeProvidentFundPaise = input.employeeProvidentFundPaise ?? 0;
  const employeeStateInsurancePaise = input.employeeStateInsurancePaise ?? 0;
  const professionalTaxPaise = input.professionalTaxPaise ?? 0;
  const incomeTaxPaise = input.incomeTaxPaise ?? 0;
  const oneTimeAdditionPaise = input.oneTimeAdditionPaise ?? 0;
  const oneTimeDeductionPaise = input.oneTimeDeductionPaise ?? 0;
  requireMoney(
    employeeProvidentFundPaise, employeeStateInsurancePaise, professionalTaxPaise,
    incomeTaxPaise, oneTimeAdditionPaise, oneTimeDeductionPaise,
    ...input.salaryLines.map((line) => line.monthlyAmountPaise),
  );
  const periodScheduledHalfDays = input.periodScheduledHalfDays ?? input.scheduledHalfDays;
  const employmentExcludedHalfDays = input.employmentExcludedHalfDays ?? periodScheduledHalfDays - input.scheduledHalfDays;
  if (
    !Number.isInteger(periodScheduledHalfDays) || periodScheduledHalfDays <= 0 ||
    !Number.isInteger(input.scheduledHalfDays) || input.scheduledHalfDays < 0 ||
    !Number.isInteger(employmentExcludedHalfDays) || employmentExcludedHalfDays < 0 ||
    input.scheduledHalfDays + employmentExcludedHalfDays !== periodScheduledHalfDays ||
    !Number.isInteger(input.payableHalfDays) || input.payableHalfDays < 0 ||
    !Number.isInteger(input.lopHalfDays) || input.lopHalfDays < 0 ||
    input.payableHalfDays + input.lopHalfDays !== input.scheduledHalfDays
  ) throw new PayrollCalculationError("invalid_units");

  const fullGrossPaise = input.salaryLines.filter((line) => line.kind === "earning").reduce((sum, line) => sum + line.monthlyAmountPaise, 0);
  const employmentEligibleGrossPaise = input.salaryLines.filter((line) => line.kind === "earning").reduce(
    (sum, line) => sum + roundedRatio(line.monthlyAmountPaise, input.scheduledHalfDays, periodScheduledHalfDays), 0,
  );
  const earnedGrossPaise = input.salaryLines.filter((line) => line.kind === "earning").reduce(
    (sum, line) => sum + roundedRatio(line.monthlyAmountPaise, input.payableHalfDays, periodScheduledHalfDays), 0,
  );
  const recurringDeductionPaise = input.salaryLines.filter((line) => line.kind === "deduction").reduce((sum, line) => sum + line.monthlyAmountPaise, 0);
  const employmentProrationDeductionPaise = fullGrossPaise - employmentEligibleGrossPaise;
  const attendanceDeductionPaise = employmentEligibleGrossPaise - earnedGrossPaise;
  const totalDeductionsPaise = employmentProrationDeductionPaise + attendanceDeductionPaise + recurringDeductionPaise + oneTimeDeductionPaise +
    employeeProvidentFundPaise + employeeStateInsurancePaise + professionalTaxPaise + incomeTaxPaise;
  const netPayPaise = fullGrossPaise + oneTimeAdditionPaise - totalDeductionsPaise;
  if (netPayPaise < 0) throw new PayrollCalculationError("negative_net");
  const employerContributionPaise = input.salaryLines.filter((line) => line.kind === "employer_contribution").reduce(
    (sum, line) => sum + roundedRatio(line.monthlyAmountPaise, input.payableHalfDays, periodScheduledHalfDays), 0,
  );
  const employerCostPaise = earnedGrossPaise + employerContributionPaise + oneTimeAdditionPaise;
  requireMoney(fullGrossPaise, earnedGrossPaise, employmentProrationDeductionPaise, recurringDeductionPaise, attendanceDeductionPaise, totalDeductionsPaise, netPayPaise, employerCostPaise);

  const lines: CalculatedPayrollLine[] = input.salaryLines.map((line) => ({
    amountPaise: line.kind === "employer_contribution"
      ? roundedRatio(line.monthlyAmountPaise, input.payableHalfDays, periodScheduledHalfDays)
      : line.monthlyAmountPaise,
    code: line.code,
    kind: line.kind,
    label: line.label,
    source: "salary_structure",
  }));
  if (employmentProrationDeductionPaise > 0) lines.push({ amountPaise: employmentProrationDeductionPaise, code: "EMPLOYMENT_PRORATION", kind: "deduction", label: "Employment-period proration", source: "employment" });
  if (attendanceDeductionPaise > 0) lines.push({ amountPaise: attendanceDeductionPaise, code: "ATTENDANCE_LOP", kind: "deduction", label: "Loss of pay", source: "attendance" });
  if (oneTimeAdditionPaise > 0) lines.push({ amountPaise: oneTimeAdditionPaise, code: "ONE_TIME_ADD", kind: "earning", label: "One-time addition", source: "adjustment" });
  if (oneTimeDeductionPaise > 0) lines.push({ amountPaise: oneTimeDeductionPaise, code: "ONE_TIME_DED", kind: "deduction", label: "One-time deduction", source: "adjustment" });
  for (const [amountPaise, code, label] of [
    [employeeProvidentFundPaise, "EMP_PF", "Employee provident fund"],
    [employeeStateInsurancePaise, "EMP_ESI", "Employee state insurance"],
    [professionalTaxPaise, "PROF_TAX", "Professional tax"],
    [incomeTaxPaise, "INCOME_TAX", "Income tax / TDS"],
  ] as const) if (amountPaise > 0) lines.push({ amountPaise, code, kind: "deduction", label, source: "statutory" });

  return { attendanceDeductionPaise, earnedGrossPaise, employmentProrationDeductionPaise, employerCostPaise, fullGrossPaise, lines, netPayPaise, recurringDeductionPaise, totalDeductionsPaise };
}

export function calculateVarianceBasisPoints(currentPaise: number, previousPaise: number) {
  requireMoney(currentPaise, previousPaise);
  if (previousPaise === 0) return null;
  return Math.trunc(((currentPaise - previousPaise) / previousPaise) * 10_000);
}
