import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("attendance repository exposes the complete lifecycle and scopes every operation", async () => {
  const source = await read("lib/attendance/repository.ts");
  for (const operation of [
    "getAttendanceWorkspace", "checkIn", "checkOut", "recordManualAttendance",
    "createLeaveRequest", "createCorrectionRequest", "decideLeaveRequest",
    "decideCorrectionRequest", "prepareAttendancePeriod", "moveAttendancePeriodToReview",
    "lockAttendancePeriod", "reopenAttendancePeriod",
    "createAttendancePolicy", "upsertEmployeeWorkProfile",
  ]) assert.match(source, new RegExp(`export async function ${operation}\\b`), `missing ${operation}`);
  assert.match(source, /eq\(attendanceDays\.tenantId, tenantId\)/);
  assert.match(source, /eq\(attendanceDays\.employeeUserId, employeeUserId\)/);
  assert.match(source, /employeeWorkProfiles\.managerUserId/);
  assert.match(source, /for\("update"/);
  assert.match(source, /attendancePeriodSummaries/);
  assert.match(source, /payrollRuns/);
  assert.match(source, /lockAttendancePeriodKey/);
  assert.match(source, /eligibleWorkingDateKeys/);
  assert.match(source, /employmentEndDate/);
  assert.match(source, /assertEmployeeEligibleForDate/);
  assert.match(source, /attendancePolicies\.id/);
  assert.match(source, /attendancePeriods\.policyId/);
  assert.match(source, /values\(\{ tenantId, periodKey, policyId: policy\.id \}\)/);
  assert.match(source, /policyById\(transaction, tenantId, period\.policyId\)/);
  assert.match(source, /policyForAttendanceDate/);
  assert.match(source, /affectedAttendanceDay/);
  assert.match(source, /period\?\.status === "locked"/);
  assert.match(source, /payroll\.status !== "draft"/);
  assert.match(source, /payroll\.invalidated_by_attendance_reopen/);
  assert.doesNotMatch(source, /tenantId:\s*input\./);
});
