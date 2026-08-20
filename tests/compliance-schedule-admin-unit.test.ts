import assert from "node:assert/strict";
import test from "node:test";

import { describeSchedule, validateComplianceScheduleFields } from "../lib/compliance/validation";

const base = {
  serviceCode: "gst",
  frequency: "monthly",
  dueMonthOffset: "1",
  dueDay: "20",
  internalLeadDays: "3",
  effectiveFrom: "2026-04-01",
  status: "active",
};

test("schedule validation upper-cases the service code and applies the default lead time", () => {
  const result = validateComplianceScheduleFields(base);
  assert.ok(result.success);
  assert.equal(result.data.serviceCode, "GST");
  assert.equal(result.data.frequency, "monthly");
  assert.equal(result.data.dueDay, 20);

  const defaulted = validateComplianceScheduleFields({ ...base, internalLeadDays: "" });
  assert.ok(defaulted.success);
  assert.equal(defaulted.data.internalLeadDays, 3);
});

test("schedule validation keeps every numeric field inside its database constraint", () => {
  assert.ok(!validateComplianceScheduleFields({ ...base, dueDay: "0" }).success);
  assert.ok(!validateComplianceScheduleFields({ ...base, dueDay: "32" }).success);
  assert.ok(!validateComplianceScheduleFields({ ...base, dueMonthOffset: "13" }).success);
  assert.ok(!validateComplianceScheduleFields({ ...base, dueMonthOffset: "-1" }).success);
  assert.ok(!validateComplianceScheduleFields({ ...base, internalLeadDays: "61" }).success);
  assert.ok(validateComplianceScheduleFields({ ...base, dueMonthOffset: "0" }).success);
});

test("schedule validation rejects unusable service codes, frequencies, dates, and statuses", () => {
  assert.ok(!validateComplianceScheduleFields({ ...base, serviceCode: "" }).success);
  assert.ok(!validateComplianceScheduleFields({ ...base, serviceCode: "has space" }).success);
  assert.ok(!validateComplianceScheduleFields({ ...base, frequency: "fortnightly" }).success);
  assert.ok(!validateComplianceScheduleFields({ ...base, effectiveFrom: "01-04-2026" }).success);
  assert.ok(!validateComplianceScheduleFields({ ...base, status: "deleted" }).success);
  assert.ok(validateComplianceScheduleFields({ ...base, status: "archived" }).success);
});

test("schedules describe themselves in the words a reviewer would use", () => {
  assert.equal(describeSchedule({ frequency: "monthly", dueMonthOffset: 1, dueDay: 20 }), "Every month, due on day 20 1 month after the period ends.");
  assert.equal(describeSchedule({ frequency: "quarterly", dueMonthOffset: 1, dueDay: 31 }), "Every quarter, due on day 31 1 month after the period ends.");
  assert.equal(describeSchedule({ frequency: "annual", dueMonthOffset: 0, dueDay: 30 }), "Every financial year, due on day 30 in the closing month.");
});
