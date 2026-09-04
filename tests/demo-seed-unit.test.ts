import assert from "node:assert/strict";
import test from "node:test";

import { attendanceStatuses } from "../lib/attendance/validation";
import { demoAttendanceStatus, demoDayTimes, lastDateKeyOf, resolveDemoCalendar } from "../scripts/db/demo/context";

test("the demo calendar closes the previous month and leaves the current one open", () => {
  const calendar = resolveDemoCalendar(new Date("2026-09-04T06:00:00Z"));
  assert.equal(calendar.currentMonth, "2026-09");
  assert.equal(calendar.closedMonth, "2026-08");
  assert.equal(calendar.todayKey, "2026-09-04");
});

test("the calendar crosses a year boundary without producing a month zero", () => {
  const calendar = resolveDemoCalendar(new Date("2026-01-11T06:00:00Z"));
  assert.equal(calendar.currentMonth, "2026-01");
  assert.equal(calendar.closedMonth, "2025-12");
});

test("the calendar reads the IST day, not the UTC one", () => {
  // 20:00 UTC on the 31st is already the 1st in India, so the closed month moves.
  const calendar = resolveDemoCalendar(new Date("2026-08-31T20:00:00Z"));
  assert.equal(calendar.currentMonth, "2026-09");
  assert.equal(calendar.closedMonth, "2026-08");
});

test("a closed month runs to its own end while the current month stops at today", () => {
  assert.equal(lastDateKeyOf("2026-08", "2026-09-04"), "2026-08-31");
  assert.equal(lastDateKeyOf("2026-09", "2026-09-04"), "2026-09-04");
  assert.equal(lastDateKeyOf("2026-02", "2026-09-04"), "2026-02-28");
  // A leap February must not be truncated to the 28th.
  assert.equal(lastDateKeyOf("2028-02", "2028-09-04"), "2028-02-29");
});

test("every generated day resolves, because an unresolved day cannot be locked", () => {
  // `lockAttendancePeriod` refuses a period holding an unresolved half day, and
  // `missing_punch` is exactly that. A month the demo cannot lock carries no
  // payroll run, which is most of what the demo exists to show.
  for (let employeeOrdinal = 0; employeeOrdinal < 6; employeeOrdinal += 1) {
    for (let dayOrdinal = 0; dayOrdinal < 31; dayOrdinal += 1) {
      const status = demoAttendanceStatus(employeeOrdinal, dayOrdinal);
      assert.ok(attendanceStatuses.includes(status), `${status} is not an attendance status`);
      assert.notEqual(status, "missing_punch");
      assert.notEqual(status, "absent");
    }
  }
});

test("the month is a mix rather than a wall of identical days", () => {
  const month = Array.from({ length: 23 }, (_, dayOrdinal) => demoAttendanceStatus(0, dayOrdinal));
  const distinct = new Set(month);
  assert.ok(distinct.size >= 4, `expected a varied month, got ${[...distinct].join(", ")}`);
  assert.ok(distinct.has("present"), "most days should still be ordinary attendance");
});

test("the pattern is deterministic, so a re-run produces the same month", () => {
  assert.equal(demoAttendanceStatus(2, 11), demoAttendanceStatus(2, 11));
  assert.equal(demoAttendanceStatus(4, 3), demoAttendanceStatus(4, 3));
});

test("leave carries no clock times and a half day ends at midday", () => {
  assert.deepEqual(demoDayTimes("leave"), { checkInTime: null, checkOutTime: null });
  const half = demoDayTimes("half_day");
  assert.equal(half.checkInTime, "09:30");
  assert.equal(half.checkOutTime, "13:30");
  const late = demoDayTimes("late");
  assert.ok(late.checkInTime! > "09:30", "a late day must start after the standard start time");
});

test("check-out is always after check-in, which the manual attendance validator requires", () => {
  for (const status of attendanceStatuses) {
    const { checkInTime, checkOutTime } = demoDayTimes(status);
    if (!checkInTime || !checkOutTime) continue;
    assert.ok(checkOutTime > checkInTime, `${status} produced ${checkInTime}-${checkOutTime}`);
  }
});
