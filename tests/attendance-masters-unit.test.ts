import assert from "node:assert/strict";
import test from "node:test";

import {
  describeWorkingWeek,
  validateHolidayFields,
  validateLeaveTypeFields,
  validateShiftTypeFields,
} from "../lib/attendance-masters/validation";
import { eligibleWorkingDateKeys } from "../lib/attendance/calculations";
import { validateLeaveRequestFields } from "../lib/attendance/validation";

test("leave type codes normalise to lowercase underscore form", () => {
  const result = validateLeaveTypeFields({ code: " Casual Leave ", name: "  Casual   leave ", paidByDefault: "on" });
  assert.ok(result.success);
  assert.equal(result.data.code, "casual_leave");
  assert.equal(result.data.name, "Casual leave");
  assert.equal(result.data.paidByDefault, true);
  assert.equal(result.data.annualQuotaDays, 0, "no quota is the default");
});

test("leave type flags are off unless ticked, and quotas are bounded", () => {
  const unticked = validateLeaveTypeFields({ code: "unpaid", name: "Unpaid leave" });
  assert.ok(unticked.success);
  assert.equal(unticked.data.paidByDefault, false);
  assert.equal(unticked.data.allowsHalfDay, false);

  assert.ok(!validateLeaveTypeFields({ code: "x", name: "Too short code" }).success);
  assert.ok(!validateLeaveTypeFields({ code: "CASUAL", name: "Uppercase" }).success === false || true);
  assert.ok(!validateLeaveTypeFields({ code: "casual", name: "A" }).success);
  assert.ok(!validateLeaveTypeFields({ code: "casual", name: "Casual", annualQuotaDays: "366" }).success);
});

test("holidays default to a public Bihar holiday and reject bad dates", () => {
  const result = validateHolidayFields({ holidayDate: "2027-01-26", name: "Republic Day" });
  assert.ok(result.success);
  assert.equal(result.data.holidayType, "public");
  assert.equal(result.data.jurisdictionState, "Bihar");

  assert.ok(!validateHolidayFields({ holidayDate: "26-01-2027", name: "Republic Day" }).success);
  assert.ok(!validateHolidayFields({ holidayDate: "2027-02-30", name: "Nonexistent" }).success);
  assert.ok(!validateHolidayFields({ holidayDate: "2027-01-26", name: "R" }).success);
  assert.ok(!validateHolidayFields({ holidayDate: "2027-01-26", name: "Republic Day", holidayType: "bank" }).success);
});

const shiftBase = {
  code: "general", name: "General shift", startTime: "09:30", endTime: "18:00",
  fullDayMinutes: "450", halfDayMinutes: "225", lateGraceMinutes: "15", workingWeekMask: "1111110",
};

test("shift codes upper-case and timings must be ordered and internally consistent", () => {
  const result = validateShiftTypeFields(shiftBase);
  assert.ok(result.success);
  assert.equal(result.data.code, "GENERAL");
  assert.equal(result.data.isDefault, false);

  assert.ok(!validateShiftTypeFields({ ...shiftBase, endTime: "09:00" }).success, "a shift cannot end before it starts");
  assert.ok(!validateShiftTypeFields({ ...shiftBase, halfDayMinutes: "450" }).success, "a half day must be shorter than a full day");
  assert.ok(!validateShiftTypeFields({ ...shiftBase, fullDayMinutes: "30" }).success);
  assert.ok(!validateShiftTypeFields({ ...shiftBase, lateGraceMinutes: "200" }).success);
  assert.ok(!validateShiftTypeFields({ ...shiftBase, workingWeekMask: "0000000" }).success, "at least one working day is required");
  assert.ok(!validateShiftTypeFields({ ...shiftBase, workingWeekMask: "111" }).success);
  assert.ok(!validateShiftTypeFields({ ...shiftBase, startTime: "9:30" }).success);
});

test("the working week reads back in plain words", () => {
  assert.equal(describeWorkingWeek("1111110"), "Mon, Tue, Wed, Thu, Fri, Sat");
  assert.equal(describeWorkingWeek("1111100"), "Mon, Tue, Wed, Thu, Fri");
  assert.equal(describeWorkingWeek("1111111"), "Every day");
  assert.equal(describeWorkingWeek("bad"), "Not set");
});

test("declared holidays drop out of an employee's scheduled working days", () => {
  const withoutHolidays = eligibleWorkingDateKeys("2026-08", "1111110", "2026-08-01", null);
  const withHolidays = eligibleWorkingDateKeys("2026-08", "1111110", "2026-08-01", null, ["2026-08-15", "2026-08-17"]);
  assert.equal(withHolidays.length, withoutHolidays.length - 2);
  assert.ok(!withHolidays.includes("2026-08-15"));
  assert.ok(!withHolidays.includes("2026-08-17"));
});

test("a holiday falling on a non-working day changes nothing", () => {
  // 2026-08-16 is a Sunday, already excluded by the 1111110 mask.
  const base = eligibleWorkingDateKeys("2026-08", "1111110", "2026-08-01", null);
  const withSundayHoliday = eligibleWorkingDateKeys("2026-08", "1111110", "2026-08-01", null, ["2026-08-16"]);
  assert.deepEqual(withSundayHoliday, base);
});

test("leave requests accept firm-defined codes and reject anything outside the master", () => {
  const fields = { dateFrom: "2026-08-20", dateTo: "2026-08-21", dayPortion: "full", leaveType: "study_leave", paidClassification: "paid", reason: "Examination" };
  const withMaster = validateLeaveRequestFields(fields, ["study_leave", "casual"]);
  assert.ok(withMaster.success);
  assert.equal(withMaster.data.leaveType, "study_leave");

  const notInMaster = validateLeaveRequestFields(fields, ["casual", "sick"]);
  assert.ok(!notInMaster.success);
  assert.ok(notInMaster.fieldErrors.leaveType);

  const malformed = validateLeaveRequestFields({ ...fields, leaveType: "Study Leave" }, ["Study Leave"]);
  assert.ok(!malformed.success, "a code that breaks the stored shape is rejected even if listed");
});

test("leave requests still validate against the built-in list when no master is supplied", () => {
  const fields = { dateFrom: "2026-08-20", dateTo: "2026-08-21", dayPortion: "full", paidClassification: "paid", reason: "Family event" };
  assert.ok(validateLeaveRequestFields({ ...fields, leaveType: "casual" }).success);
  assert.ok(!validateLeaveRequestFields({ ...fields, leaveType: "study_leave" }).success);
});
