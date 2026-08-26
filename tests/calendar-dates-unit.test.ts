import assert from "node:assert/strict";
import test from "node:test";

import {
  addDays,
  addMonths,
  dayDifference,
  eachDay,
  endOfMonth,
  isDateKey,
  isWeekend,
  monthLabel,
  relativeDayLabel,
  startOfMonth,
  startOfWeek,
  weekdayIndex,
} from "../lib/calendar/dates";

test("a date that the calendar does not have is not a date key", () => {
  // The pattern alone accepts 30 February. A URL carrying one must fall back to
  // today rather than render a month around a day that does not exist.
  assert.equal(isDateKey("2026-02-28"), true);
  assert.equal(isDateKey("2026-02-30"), false);
  assert.equal(isDateKey("2025-02-29"), false);
  assert.equal(isDateKey("2024-02-29"), true, "2024 is a leap year");
  assert.equal(isDateKey("2026-13-01"), false);
  assert.equal(isDateKey("2026-1-01"), false);
  assert.equal(isDateKey(""), false);
});

test("stepping a month clamps instead of overflowing", () => {
  // Stepping forward from 31 January must land in February. Naive month
  // arithmetic lands on 3 March, which silently skips a month of deadlines.
  assert.equal(addMonths("2026-01-31", 1), "2026-02-28");
  assert.equal(addMonths("2024-01-31", 1), "2024-02-29");
  assert.equal(addMonths("2026-03-31", -1), "2026-02-28");
  assert.equal(addMonths("2026-12-15", 1), "2027-01-15");
  assert.equal(addMonths("2026-01-15", -1), "2025-12-15");
});

test("stepping back and forward returns to the same month", () => {
  for (const start of ["2026-01-01", "2026-06-15", "2026-12-01"]) {
    assert.equal(addMonths(addMonths(start, 1), -1), start);
  }
});

test("days are added across month and year boundaries", () => {
  assert.equal(addDays("2026-08-31", 1), "2026-09-01");
  assert.equal(addDays("2026-01-01", -1), "2025-12-31");
  assert.equal(addDays("2026-02-28", 1), "2026-03-01");
  assert.equal(addDays("2024-02-28", 1), "2024-02-29");
});

test("the difference between two days is whole days in both directions", () => {
  assert.equal(dayDifference("2026-08-21", "2026-08-21"), 0);
  assert.equal(dayDifference("2026-08-25", "2026-08-21"), 4);
  assert.equal(dayDifference("2026-08-18", "2026-08-21"), -3);
  assert.equal(dayDifference("2027-01-01", "2026-01-01"), 365);
});

test("the week starts on Monday", () => {
  // An Indian practice week runs Monday to Saturday, so a grid that started on
  // Sunday would push the working week out of alignment with the office.
  assert.equal(weekdayIndex("2026-08-24"), 0, "Monday");
  assert.equal(weekdayIndex("2026-08-30"), 6, "Sunday");
  assert.equal(startOfWeek("2026-08-27"), "2026-08-24");
  assert.equal(startOfWeek("2026-08-24"), "2026-08-24", "Monday is its own week start");
  assert.equal(startOfWeek("2026-08-30"), "2026-08-24", "Sunday belongs to the week before");
});

test("only Sunday is treated as non-working", () => {
  // Saturday is a working day in most Indian practices; shading it as a weekend
  // would tell a partner the office is shut when it is not.
  assert.equal(isWeekend("2026-08-29"), false, "Saturday");
  assert.equal(isWeekend("2026-08-30"), true, "Sunday");
});

test("month bounds cover every length of month", () => {
  assert.equal(startOfMonth("2026-08-21"), "2026-08-01");
  assert.equal(endOfMonth("2026-02-10"), "2026-02-28");
  assert.equal(endOfMonth("2024-02-10"), "2024-02-29");
  assert.equal(endOfMonth("2026-04-10"), "2026-04-30");
  assert.equal(endOfMonth("2026-12-01"), "2026-12-31");
});

test("a day range is inclusive at both ends and empty when inverted", () => {
  assert.deepEqual(eachDay("2026-08-21", "2026-08-23"), ["2026-08-21", "2026-08-22", "2026-08-23"]);
  assert.deepEqual(eachDay("2026-08-21", "2026-08-21"), ["2026-08-21"]);
  assert.deepEqual(eachDay("2026-08-23", "2026-08-21"), []);
  assert.equal(eachDay("2026-01-01", "2026-12-31").length, 365);
});

test("relative labels read the way a deadline is discussed", () => {
  const today = "2026-08-21";
  assert.equal(relativeDayLabel("2026-08-21", today), "Today");
  assert.equal(relativeDayLabel("2026-08-22", today), "Tomorrow");
  assert.equal(relativeDayLabel("2026-08-20", today), "Yesterday");
  assert.equal(relativeDayLabel("2026-08-26", today), "In 5 days");
  assert.equal(relativeDayLabel("2026-08-18", today), "3 days ago");
});

test("the month heading names the month", () => {
  assert.equal(monthLabel("2026-08-21"), "August 2026");
  assert.equal(monthLabel("2026-01-01"), "January 2026");
});
