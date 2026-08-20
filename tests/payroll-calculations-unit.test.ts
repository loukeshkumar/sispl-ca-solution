import assert from "node:assert/strict";
import test from "node:test";

import { calculatePayrollEntry, calculateVarianceBasisPoints, PayrollCalculationError } from "../lib/payroll/calculations";

const salaryLines = [
  { code: "BASIC", kind: "earning" as const, label: "Basic", monthlyAmountPaise: 3_000_000 },
  { code: "HRA", kind: "earning" as const, label: "House rent allowance", monthlyAmountPaise: 1_200_000 },
  { code: "REC_DED", kind: "deduction" as const, label: "Recurring deduction", monthlyAmountPaise: 50_000 },
  { code: "ER_PF", kind: "employer_contribution" as const, label: "Employer provident fund", monthlyAmountPaise: 360_000 },
];

test("payroll calculation prorates exact half-day units with deterministic paise rounding", () => {
  const result = calculatePayrollEntry({
    employeeProvidentFundPaise: 100_000,
    employeeStateInsurancePaise: 20_000,
    incomeTaxPaise: 150_000,
    lopHalfDays: 1,
    oneTimeAdditionPaise: 10_000,
    oneTimeDeductionPaise: 5_000,
    payableHalfDays: 51,
    professionalTaxPaise: 20_000,
    salaryLines,
    scheduledHalfDays: 52,
  });

  assert.equal(result.fullGrossPaise, 4_200_000);
  assert.equal(result.earnedGrossPaise, 4_119_231);
  assert.equal(result.attendanceDeductionPaise, 80_769);
  assert.equal(result.recurringDeductionPaise, 50_000);
  assert.equal(result.totalDeductionsPaise, 425_769);
  assert.equal(result.netPayPaise, 3_784_231);
  assert.equal(result.employerCostPaise, 4_482_308);
  assert.deepEqual(result.lines.find((line) => line.code === "ATTENDANCE_LOP"), {
    amountPaise: 80_769, code: "ATTENDANCE_LOP", kind: "deduction", label: "Loss of pay", source: "attendance",
  });
});

test("payroll calculation rejects inconsistent units and negative net pay", () => {
  assert.throws(() => calculatePayrollEntry({ salaryLines, scheduledHalfDays: 52, payableHalfDays: 50, lopHalfDays: 1 }), PayrollCalculationError);
  assert.throws(() => calculatePayrollEntry({ salaryLines, scheduledHalfDays: 52, payableHalfDays: 52, lopHalfDays: 0, oneTimeDeductionPaise: 5_000_000 }), /negative/i);
});

test("payroll variance is expressed in integer basis points", () => {
  assert.equal(calculateVarianceBasisPoints(110_000, 100_000), 1_000);
  assert.equal(calculateVarianceBasisPoints(90_000, 100_000), -1_000);
  assert.equal(calculateVarianceBasisPoints(50_000, 0), null);
});

test("employment eligibility uses the full month divisor for a mid-month joiner", () => {
  const result = calculatePayrollEntry({
    periodScheduledHalfDays: 52,
    employmentExcludedHalfDays: 26,
    scheduledHalfDays: 26,
    payableHalfDays: 26,
    lopHalfDays: 0,
    salaryLines: [{ code: "BASIC", kind: "earning", label: "Basic", monthlyAmountPaise: 3_000_000 }],
  });
  assert.equal(result.earnedGrossPaise, 1_500_000);
  assert.equal(result.employmentProrationDeductionPaise, 1_500_000);
  assert.equal(result.attendanceDeductionPaise, 0);
  assert.ok(result.lines.some((line) => line.code === "EMPLOYMENT_PRORATION" && line.amountPaise === 1_500_000));
});
