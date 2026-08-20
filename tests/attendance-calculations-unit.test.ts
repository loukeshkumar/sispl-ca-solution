import assert from "node:assert/strict";
import test from "node:test";

import { attendanceUnitsForStatus, buildAttendanceSummary, calculateClockedDay, eligibleWorkingDateKeys, workingDateKeys } from "../lib/attendance/calculations";

test("clocked attendance derives worked time, lateness, and half-day units", () => {
  const full = calculateClockedDay({ checkIn: new Date("2026-08-17T04:05:00Z"), checkOut: new Date("2026-08-17T12:35:00Z"), fullDayMinutes: 450, halfDayMinutes: 225, lateGraceMinutes: 15, standardStartTime: "09:30" });
  assert.deepEqual(full, { lateMinutes: 5, lopHalfDays: 0, paidHalfDays: 2, status: "present", workedMinutes: 510 });
  const late = calculateClockedDay({ checkIn: new Date("2026-08-17T04:30:00Z"), checkOut: new Date("2026-08-17T12:30:00Z"), fullDayMinutes: 450, halfDayMinutes: 225, lateGraceMinutes: 15, standardStartTime: "09:30" });
  assert.equal(late.status, "late");
  assert.equal(late.lateMinutes, 30);
  const half = calculateClockedDay({ checkIn: new Date("2026-08-17T04:00:00Z"), checkOut: new Date("2026-08-17T08:00:00Z"), fullDayMinutes: 450, halfDayMinutes: 225, lateGraceMinutes: 15, standardStartTime: "09:30" });
  assert.equal(half.status, "half_day");
  assert.equal(half.paidHalfDays, 1);
  assert.equal(half.lopHalfDays, 1);
});

test("monthly summary uses exact half-day units and identifies unresolved days", () => {
  const summary = buildAttendanceSummary([
    { attendanceDate: "2026-08-01", lateMinutes: 0, lopHalfDays: 0, paidHalfDays: 2, status: "present", workedMinutes: 480 },
    { attendanceDate: "2026-08-03", lateMinutes: 20, lopHalfDays: 0, paidHalfDays: 2, status: "late", workedMinutes: 470 },
    { attendanceDate: "2026-08-04", lateMinutes: 0, lopHalfDays: 1, paidHalfDays: 1, status: "half_day", workedMinutes: 240 },
    { attendanceDate: "2026-08-05", lateMinutes: 0, lopHalfDays: 2, paidHalfDays: 0, status: "absent", workedMinutes: 0 },
    { attendanceDate: "2026-08-06", lateMinutes: 0, lopHalfDays: 0, paidHalfDays: 0, status: "missing_punch", workedMinutes: 0 },
  ], 10, 450);
  assert.equal(summary.payableHalfDays, 5);
  assert.equal(summary.lopHalfDays, 3);
  assert.equal(summary.unresolvedHalfDays, 2);
  assert.equal(summary.presentDays, 2);
  assert.equal(summary.lateCount, 1);
  assert.equal(summary.overtimeMinutes, 50);
});

test("working date generation follows a Monday-first seven-day mask", () => {
  const dates = workingDateKeys("2026-08", "1111110");
  assert.ok(dates.includes("2026-08-01"));
  assert.equal(dates.includes("2026-08-02"), false);
  assert.equal(dates.length, 26);
});

test("paid non-working and leave statuses preserve scheduled payroll units", () => {
  assert.deepEqual(attendanceUnitsForStatus("holiday"), { paidHalfDays: 2, lopHalfDays: 0 });
  assert.deepEqual(attendanceUnitsForStatus("weekly_off"), { paidHalfDays: 2, lopHalfDays: 0 });
  assert.deepEqual(attendanceUnitsForStatus("leave"), { paidHalfDays: 2, lopHalfDays: 0 });
  assert.deepEqual(attendanceUnitsForStatus("missing_punch"), { paidHalfDays: 0, lopHalfDays: 0 });
});

test("employment dates bound each employee's scheduled attendance dates", () => {
  assert.deepEqual(
    eligibleWorkingDateKeys("2026-08", "1111110", "2026-08-17", "2026-08-22"),
    ["2026-08-17", "2026-08-18", "2026-08-19", "2026-08-20", "2026-08-21", "2026-08-22"],
  );
  assert.deepEqual(eligibleWorkingDateKeys("2026-08", "1111110", "2026-09-01", null), []);
});
