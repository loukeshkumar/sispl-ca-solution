import assert from "node:assert/strict";
import test from "node:test";

import { formatPaise, parseMoneyToPaise } from "../lib/payroll/money";
import { validatePayrollEntryFields, validatePayrollPeriodFields, validateSalaryStructureFields, validateTransitionReason } from "../lib/payroll/validation";

test("payroll money conversion is exact and never persists decimal floats", () => {
  assert.equal(parseMoneyToPaise("12,345.67"), 1_234_567);
  assert.equal(parseMoneyToPaise("0.05"), 5);
  assert.equal(parseMoneyToPaise("1.999"), null);
  assert.equal(parseMoneyToPaise("-1"), null);
  assert.equal(formatPaise(1_234_567), "₹12,345.67");
});

test("salary and payroll inputs normalize components and reject invalid states", () => {
  const salary = validateSalaryStructureFields({
    effectiveFrom: "2026-08-01",
    employeeUserId: "20000000-0000-4000-8000-000000000002",
    lines: JSON.stringify([
      { code: "BASIC", kind: "earning", label: "Basic", monthlyAmount: "30000.00" },
      { code: "HRA", kind: "earning", label: "House rent allowance", monthlyAmount: "12000" },
      { code: "REC_DED", kind: "deduction", label: "Recurring deduction", monthlyAmount: "500" },
    ]),
  });
  assert.equal(salary.success, true);
  if (salary.success) assert.equal(salary.data.lines[0]?.monthlyAmountPaise, 3_000_000);

  const duplicate = validateSalaryStructureFields({
    effectiveFrom: "bad", employeeUserId: "bad", lines: JSON.stringify([
      { code: "BASIC", kind: "earning", label: "Basic", monthlyAmount: "1" },
      { code: "basic", kind: "earning", label: "Duplicate", monthlyAmount: "2" },
    ]),
  });
  assert.equal(duplicate.success, false);

  const reserved = validateSalaryStructureFields({
    effectiveFrom: "2026-08-01", employeeUserId: "20000000-0000-4000-8000-000000000002", lines: JSON.stringify([
      { code: "EMPLOYMENT_PRORATION", kind: "earning", label: "Unsafe collision", monthlyAmount: "1" },
    ]),
  });
  assert.equal(reserved.success, false);

  assert.equal(validatePayrollPeriodFields({ payDate: "2026-08-31", periodKey: "2026-08" }).success, true);
  assert.equal(validatePayrollPeriodFields({ payDate: "bad", periodKey: "2026-99" }).success, false);
  assert.equal(validatePayrollEntryFields({ employeeUserId: "bad", employeeStateInsurance: "-1", employeeProvidentFund: "1.999", incomeTax: "0", note: "", oneTimeAddition: "0", oneTimeDeduction: "0", professionalTax: "0" }).success, false);
  const held = validatePayrollEntryFields({ employeeUserId: "20000000-0000-4000-8000-000000000002", employeeStateInsurance: "0", employeeProvidentFund: "0", hold: "on", holdReason: "Awaiting bank details", incomeTax: "0", note: "", oneTimeAddition: "0", oneTimeDeduction: "0", professionalTax: "0" });
  assert.equal(held.success, true);
  if (held.success) assert.deepEqual({ hold: held.data.hold, holdReason: held.data.holdReason }, { hold: true, holdReason: "Awaiting bank details" });
  assert.equal(validatePayrollEntryFields({ employeeUserId: "20000000-0000-4000-8000-000000000002", employeeStateInsurance: "0", employeeProvidentFund: "0", hold: "on", holdReason: "", incomeTax: "0", note: "", oneTimeAddition: "0", oneTimeDeduction: "0", professionalTax: "0" }).success, false);
  assert.equal(validateTransitionReason("  approved after review  ", true).success, true);
  assert.equal(validateTransitionReason("", true).success, false);
});
