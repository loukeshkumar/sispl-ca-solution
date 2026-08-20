import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("payroll repository exposes the controlled lifecycle and scopes confidential reads", async () => {
  const source = await read("lib/payroll/repository.ts");
  for (const operation of [
    "listSalaryWorkspace", "getPublishedPayslip", "createSalaryStructure", "createPayrollRun",
    "updatePayrollEntryInputs", "submitPayrollRun", "approvePayrollRun", "rejectPayrollRun",
    "reopenPayrollRun", "publishPayslips", "markPayrollPaid", "recordPayrollAccess",
  ]) assert.match(source, new RegExp(`export async function ${operation}\\b`), `missing ${operation}`);
  assert.match(source, /eq\(payrollRuns\.tenantId, tenantId\)/);
  assert.match(source, /eq\(payrollEntries\.employeeUserId, viewerUserId\)/);
  assert.match(source, /eq\(attendancePeriods\.status, "locked"\)/);
  assert.match(source, /eq\(payrollRuns\.status, "submitted"\)/);
  assert.match(source, /for\("update"/);
  assert.match(source, /salaryStructures\.effectiveFrom/);
  assert.match(source, /holdReason:\s*input\.holdReason/);
  assert.match(source, /assertApprovalActor/);
  assert.match(source, /payroll\.(workspace|run|payslip|export)_viewed/);
  assert.doesNotMatch(source, /tenantId:\s*input\./);
});

test("published payslip access is explicitly owner-or-payroll-admin scoped", async () => {
  const source = await read("lib/payroll/repository.ts");
  assert.match(source, /canManage\s*\?[^:]+:\s*eq\(payrollEntries\.employeeUserId, viewerUserId\)/);
  assert.match(source, /inArray\(payrollRuns\.status, \["payslips_published", "paid"\]\)/);
});
