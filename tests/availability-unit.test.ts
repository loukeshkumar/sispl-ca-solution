import assert from "node:assert/strict";
import test from "node:test";

import {
  availabilitySummary,
  BAND_LABELS,
  closesOffice,
  isWorkingDay,
  loadBand,
  loadPercentage,
  pendingWarning,
  weekAvailability,
  weekDays,
  type Holiday,
  type LeaveWindow,
} from "../lib/scheduling/availability";

const VIKRAM = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const NISHA = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

/** Monday 14 December 2026. A six-day week, Sunday off, 450 minutes a day. */
const WEEK = "2026-12-14";

const base = {
  employeeUserId: VIKRAM,
  fullDayMinutes: 450,
  holidays: [] as Holiday[],
  leave: [] as LeaveWindow[],
  weekStart: WEEK,
  workLocationState: "Bihar",
  workingWeekMask: "1111110",
};

const leave = (over: Partial<LeaveWindow> = {}): LeaveWindow => ({
  dateFrom: "2026-12-16",
  dateTo: "2026-12-16",
  dayPortion: "full",
  employeeUserId: VIKRAM,
  status: "approved",
  ...over,
});

const holiday = (over: Partial<Holiday> = {}): Holiday => ({
  holidayDate: "2026-12-18",
  holidayType: "public",
  jurisdictionState: "Bihar",
  name: "Winter holiday",
  ...over,
});

test("a week is its seven days, Monday first", () => {
  const days = weekDays(WEEK);
  assert.equal(days.length, 7);
  assert.equal(days[0], "2026-12-14");
  assert.equal(days[6], "2026-12-20");
});

test("the mask decides which days are worked", () => {
  assert.equal(isWorkingDay("2026-12-14", "1111110"), true, "Monday");
  assert.equal(isWorkingDay("2026-12-19", "1111110"), true, "Saturday");
  assert.equal(isWorkingDay("2026-12-20", "1111110"), false, "Sunday");
  assert.equal(isWorkingDay("2026-12-19", "1111100"), false, "a five-day week drops Saturday");
});

test("an untouched week is the shift mask, as it always was", () => {
  const week = weekAvailability(base);
  assert.equal(week.baseMinutes, 2700, "six days at 450");
  assert.equal(week.availableMinutes, 2700);
  assert.equal(week.leaveMinutes, 0);
  assert.equal(week.pendingMinutes, 0);
  assert.equal(week.awayAllWeek, false);
  assert.equal(availabilitySummary(week), "45h available");
});

test("a public holiday takes a day out", () => {
  const week = weekAvailability({ ...base, holidays: [holiday()] });
  assert.equal(week.availableMinutes, 2250);
  assert.deepEqual(week.holidays.map((entry) => entry.name), ["Winter holiday"]);
  assert.match(availabilitySummary(week), /37.5h available · 45h less 7.5h holiday \(Winter holiday\)/);
});

test("a restricted or optional holiday leaves the office open", () => {
  // The employee may take it, and does so by applying for leave. Closing the
  // office would hand the firm a quieter week than it has.
  assert.equal(closesOffice(holiday({ holidayType: "restricted" })), false);
  assert.equal(closesOffice(holiday({ holidayType: "optional" })), false);
  assert.equal(weekAvailability({ ...base, holidays: [holiday({ holidayType: "restricted" })] }).availableMinutes, 2700);
});

test("a holiday in another state does not close this person's office", () => {
  const week = weekAvailability({ ...base, holidays: [holiday({ jurisdictionState: "Maharashtra" })] });
  assert.equal(week.availableMinutes, 2700);
  // Matching is case- and space-insensitive, because these are typed by hand.
  assert.equal(weekAvailability({ ...base, holidays: [holiday({ jurisdictionState: " bihar " })] }).availableMinutes, 2250);
});

test("a holiday falling on a non-working day takes nothing", () => {
  const week = weekAvailability({ ...base, holidays: [holiday({ holidayDate: "2026-12-20" })] });
  assert.equal(week.availableMinutes, 2700, "Sunday was never available");
  assert.equal(week.holidays.length, 0);
});

test("approved leave takes days out; a half day takes half", () => {
  assert.equal(weekAvailability({ ...base, leave: [leave()] }).availableMinutes, 2250);
  assert.equal(weekAvailability({ ...base, leave: [leave({ dayPortion: "first_half" })] }).availableMinutes, 2475);
  const threeDays = weekAvailability({ ...base, leave: [leave({ dateFrom: "2026-12-16", dateTo: "2026-12-18" })] });
  assert.equal(threeDays.availableMinutes, 1350);
  assert.equal(threeDays.leaveMinutes, 1350);
});

test("a half-day portion applies to every day of the request", () => {
  // Somebody taking afternoons off for three days has asked for three half days.
  const week = weekAvailability({
    ...base,
    leave: [leave({ dateFrom: "2026-12-16", dateTo: "2026-12-18", dayPortion: "second_half" })],
  });
  assert.equal(week.leaveMinutes, 675, "three half days");
});

test("leave belonging to somebody else changes nothing", () => {
  const week = weekAvailability({ ...base, leave: [leave({ employeeUserId: NISHA })] });
  assert.equal(week.availableMinutes, 2700);
});

test("rejected and cancelled leave changes nothing", () => {
  assert.equal(weekAvailability({ ...base, leave: [leave({ status: "rejected" })] }).availableMinutes, 2700);
  assert.equal(weekAvailability({ ...base, leave: [leave({ status: "cancelled" })] }).availableMinutes, 2700);
});

test("pending leave is reported but never subtracted", () => {
  const week = weekAvailability({
    ...base,
    leave: [leave({ dateFrom: "2026-12-17", dateTo: "2026-12-18", status: "pending" })],
  });
  assert.equal(week.availableMinutes, 2700, "a request is not a fact");
  assert.equal(week.pendingMinutes, 900);
  assert.match(availabilitySummary(week), /15h awaiting a decision/);
});

test("a day lost to a holiday is not lost twice to leave", () => {
  // Leave across a public holiday has not given the firm negative time.
  const week = weekAvailability({
    ...base,
    holidays: [holiday({ holidayDate: "2026-12-16" })],
    leave: [leave({ dateFrom: "2026-12-16", dateTo: "2026-12-17" })],
  });
  assert.equal(week.availableMinutes, 1800, "one holiday and one leave day, not three days' worth");
  assert.equal(week.leaveMinutes, 450);
});

test("pending leave over a day already approved off adds nothing", () => {
  const week = weekAvailability({
    ...base,
    leave: [leave({ dateFrom: "2026-12-16", dateTo: "2026-12-16" }), leave({ dateFrom: "2026-12-16", dateTo: "2026-12-16", status: "pending" })],
  });
  assert.equal(week.leaveMinutes, 450);
  assert.equal(week.pendingMinutes, 0, "the day is already gone");
});

test("two half-day requests on one day take the day, never more", () => {
  const week = weekAvailability({
    ...base,
    leave: [
      leave({ dayPortion: "first_half" }),
      leave({ dayPortion: "second_half" }),
    ],
  });
  assert.equal(week.leaveMinutes, 450, "a day cannot give up more than itself");
});

test("a week entirely away reads as away, not as zero", () => {
  const week = weekAvailability({
    ...base,
    leave: [leave({ dateFrom: "2026-12-14", dateTo: "2026-12-20" })],
  });
  assert.equal(week.availableMinutes, 0);
  assert.equal(week.awayAllWeek, true);
  assert.equal(loadPercentage(600, 0), null, "no percentage of nothing");
});

test("bands separate being away from being busy", () => {
  // A person with no time and work assigned is a different problem from one who
  // is merely loaded, and showing both as red loses what decides the fix.
  assert.equal(loadBand({ availableMinutes: 0, loadMinutes: 600 }), "away");
  assert.equal(loadBand({ availableMinutes: 1800, loadMinutes: 2100 }), "over");
  assert.equal(loadBand({ availableMinutes: 1800, loadMinutes: 1800 }), "tight", "exactly full is tight, not over");
  assert.equal(loadBand({ availableMinutes: 1800, loadMinutes: 1530 }), "tight", "85%");
  assert.equal(loadBand({ availableMinutes: 1800, loadMinutes: 720 }), "healthy", "40%");
  assert.equal(loadBand({ availableMinutes: 1800, loadMinutes: 700 }), "free");
  assert.equal(loadBand({ availableMinutes: 1800, loadMinutes: 0 }), "free");
  for (const band of Object.keys(BAND_LABELS)) assert.ok(BAND_LABELS[band as keyof typeof BAND_LABELS].length > 0);
});

test("the pending warning fires only where granting it would break the week", () => {
  const week = weekAvailability({
    ...base,
    leave: [leave({ dateFrom: "2026-12-17", dateTo: "2026-12-18", status: "pending" })],
  });
  assert.equal(pendingWarning(week, 1200), null, "it would still fit");
  // 2,700 available, 900 pending: granting it leaves 1,800, so a 2,100 load is
  // 300 minutes over — five hours, not the fifteen the request itself is worth.
  assert.match(pendingWarning(week, 2100) ?? "", /over by 5h/);
  assert.equal(pendingWarning(weekAvailability(base), 9000), null, "nothing pending, nothing to warn about");

  const whole = weekAvailability({ ...base, leave: [leave({ dateFrom: "2026-12-14", dateTo: "2026-12-20", status: "pending" })] });
  assert.match(pendingWarning(whole, 100) ?? "", /no time left at all/);
});

test("a person with no working days at all reads honestly", () => {
  const week = weekAvailability({ ...base, workingWeekMask: "0000000" });
  assert.equal(week.baseMinutes, 0);
  assert.equal(week.awayAllWeek, false, "no working days is not the same as being away");
  assert.equal(availabilitySummary(week), "No working days this week");
});
