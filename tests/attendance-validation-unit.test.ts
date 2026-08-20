import assert from "node:assert/strict";
import test from "node:test";

import {
  validateAttendancePolicyFields,
  validateCorrectionRequestFields,
  validateEmployeeWorkProfileFields,
  validateLeaveRequestFields,
  validateManualAttendanceFields,
  validatePeriodFields,
} from "../lib/attendance/validation";

const userId = "20000000-0000-4000-8000-000000000002";
const managerId = "20000000-0000-4000-8000-000000000001";

test("attendance policy and employee work profile validation normalize safe configuration", () => {
  const policy = validateAttendancePolicyFields({
    effectiveFrom: "2026-08-01", fullDayMinutes: "450", halfDayMinutes: "225",
    jurisdictionState: " Bihar ", lateGraceMinutes: "15", standardEndTime: "18:00",
    standardStartTime: "09:30", timeZone: "Asia/Kolkata", workingWeekMask: "1111110",
  });
  assert.equal(policy.success, true);
  if (policy.success) assert.deepEqual(policy.data, {
    effectiveFrom: "2026-08-01", fullDayMinutes: 450, halfDayMinutes: 225,
    jurisdictionState: "Bihar", lateGraceMinutes: 15, standardEndTime: "18:00",
    standardStartTime: "09:30", timeZone: "Asia/Kolkata", workingWeekMask: "1111110",
  });

  const profile = validateEmployeeWorkProfileFields({
    employeeUserId: userId, employmentType: "articled_assistant", managerUserId: managerId,
    workLocationState: " Bihar ",
  });
  assert.equal(profile.success, true);
  if (profile.success) assert.equal(profile.data.workLocationState, "Bihar");
});

test("attendance validation rejects unsafe policy, self-management, bad day values, and reversed leave", () => {
  const policy = validateAttendancePolicyFields({
    effectiveFrom: "2026-02-30", fullDayMinutes: "0", halfDayMinutes: "500",
    jurisdictionState: "", lateGraceMinutes: "999", standardEndTime: "09:00",
    standardStartTime: "18:00", timeZone: "UTC", workingWeekMask: "0000000",
  });
  assert.equal(policy.success, false);
  assert.equal(validateAttendancePolicyFields({
    effectiveFrom: "2026-08-15", fullDayMinutes: "450", halfDayMinutes: "225",
    jurisdictionState: "Bihar", lateGraceMinutes: "15", standardEndTime: "18:00",
    standardStartTime: "09:30", timeZone: "Asia/Kolkata", workingWeekMask: "1111110",
  }).success, false, "policy versions must begin on the first day of a payroll month");

  const profile = validateEmployeeWorkProfileFields({ employeeUserId: userId, employmentType: "employee", managerUserId: userId, workLocationState: "Bihar" });
  assert.equal(profile.success, false);

  const day = validateManualAttendanceFields({ attendanceDate: "bad", checkInTime: "18:00", checkOutTime: "09:00", note: "x".repeat(501), status: "unknown" });
  assert.equal(day.success, false);

  const leave = validateLeaveRequestFields({ dateFrom: "2026-08-20", dateTo: "2026-08-19", dayPortion: "full", leaveType: "casual", paidClassification: "paid", reason: "x" });
  assert.equal(leave.success, false);

  const correction = validateCorrectionRequestFields({ attendanceDate: "2026-08-16", proposedCheckInTime: "17:00", proposedCheckOutTime: "09:00", proposedStatus: "present", reason: "" });
  assert.equal(correction.success, false);
  assert.equal(validatePeriodFields({ periodKey: "2026-13" }).success, false);
});
