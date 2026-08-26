import assert from "node:assert/strict";
import test from "node:test";

import {
  availability,
  bandFor,
  computeUtilisation,
  formatHours,
  MISSING_TIME_THRESHOLD_BPS,
  ON_TARGET_TOLERANCE_BPS,
  resolveTarget,
  shareBasisPoints,
  summariseFirm,
  type UtilisationTargetRow,
} from "../lib/rates/utilisation";

const NISHA = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const RAHUL = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const FULL_DAY = 450;

const roleTarget = (roleKey: string, bps: number, effectiveFrom = "2026-04-01"): UtilisationTargetRow => ({
  effectiveFrom, employeeUserId: null, roleKey, scope: "role", targetBasisPoints: bps,
});

const personTarget = (employeeUserId: string, bps: number, effectiveFrom = "2026-04-01"): UtilisationTargetRow => ({
  effectiveFrom, employeeUserId, roleKey: null, scope: "employee", targetBasisPoints: bps,
});

test("a person's own target beats their role's", () => {
  const targets = [roleTarget("manager", 6500), personTarget(NISHA, 7500)];
  const own = resolveTarget(targets, NISHA, "manager", "2026-08-24");
  assert.equal(own.basisPoints, 7500);
  assert.equal(own.source, "employee");

  const inherited = resolveTarget(targets, RAHUL, "manager", "2026-08-24");
  assert.equal(inherited.basisPoints, 6500);
  assert.equal(inherited.source, "role");
});

test("somebody with neither target is reported unmeasured, not as zero", () => {
  // Zero would read as total failure every month, which is worse than silence.
  const resolved = resolveTarget([roleTarget("manager", 6500)], RAHUL, "associate", "2026-08-24");
  assert.equal(resolved.basisPoints, null);
  assert.equal(resolved.source, "none");
  assert.equal(bandFor(8000, null), "unmeasured");
});

test("raising a target next quarter does not make last quarter a failure", () => {
  const targets = [roleTarget("associate", 7000, "2026-04-01"), roleTarget("associate", 8500, "2026-10-01")];
  assert.equal(resolveTarget(targets, RAHUL, "associate", "2026-08-31").basisPoints, 7000);
  assert.equal(resolveTarget(targets, RAHUL, "associate", "2026-10-01").basisPoints, 8500);
});

test("available time is the working month less holidays and approved leave", () => {
  // 26 scheduled days already excludes weekends and public holidays; four
  // half-days of approved leave come off on top.
  const hours = availability({ fullDayMinutes: FULL_DAY, leaveHalfDays: 4, scheduledDays: 26 });
  assert.equal(hours.scheduledMinutes, 26 * FULL_DAY);
  assert.equal(hours.leaveMinutes, 2 * FULL_DAY, "four half-days is two whole days");
  assert.equal(hours.availableMinutes, 24 * FULL_DAY);
});

test("somebody on leave all month is not idle, they are unavailable", () => {
  const hours = availability({ fullDayMinutes: FULL_DAY, leaveHalfDays: 60, scheduledDays: 26 });
  assert.equal(hours.availableMinutes, 0, "and never negative");
  // No available time means no utilisation to report, rather than a zero.
  assert.equal(shareBasisPoints(0, hours.availableMinutes), null);
});

test("leave recorded beyond the scheduled month cannot drive availability negative", () => {
  const hours = availability({ fullDayMinutes: FULL_DAY, leaveHalfDays: 200, scheduledDays: 10 });
  assert.equal(hours.leaveMinutes, 10 * FULL_DAY);
  assert.equal(hours.availableMinutes, 0);
});

test("utilisation is chargeable time over available time", () => {
  const result = computeUtilisation({
    availability: { fullDayMinutes: FULL_DAY, leaveHalfDays: 4, scheduledDays: 26 },
    chargeableMinutes: 24 * FULL_DAY * 0.8,
    employeeUserId: NISHA,
    fullName: "Nisha S.",
    recordedMinutes: 24 * FULL_DAY,
    roleKey: "manager",
  }, [roleTarget("manager", 7500)], "2026-08-31");

  assert.equal(result.utilisationBps, 8000);
  assert.equal(result.targetBasisPoints, 7500);
  assert.equal(result.varianceBps, 500);
  assert.equal(result.band, "over");
  assert.equal(result.missingMinutes, 0);
});

test("two days of leave do not cost anybody utilisation", () => {
  // The whole point of netting leave off: the same chargeable share reads the
  // same whether or not the person took leave.
  const base = {
    chargeableMinutes: 20 * FULL_DAY, employeeUserId: NISHA, fullName: "Nisha S.",
    recordedMinutes: 25 * FULL_DAY, roleKey: "manager",
  };
  const withLeave = computeUtilisation({
    ...base, availability: { fullDayMinutes: FULL_DAY, leaveHalfDays: 4, scheduledDays: 26 },
  }, [], "2026-08-31");
  const withoutLeave = computeUtilisation({
    ...base, availability: { fullDayMinutes: FULL_DAY, leaveHalfDays: 0, scheduledDays: 24 },
  }, [], "2026-08-31");
  assert.equal(withLeave.utilisationBps, withoutLeave.utilisationBps);
});

test("unrecorded time is measured against available time, and never goes negative", () => {
  const short = computeUtilisation({
    availability: { fullDayMinutes: FULL_DAY, leaveHalfDays: 0, scheduledDays: 20 },
    chargeableMinutes: 3_000, employeeUserId: NISHA, fullName: "Nisha S.",
    recordedMinutes: 4_000, roleKey: "manager",
  }, [], "2026-08-31");
  assert.equal(short.missingMinutes, 20 * FULL_DAY - 4_000);
  assert.equal(short.recordingBps, shareBasisPoints(4_000, 20 * FULL_DAY));

  const overtime = computeUtilisation({
    availability: { fullDayMinutes: FULL_DAY, leaveHalfDays: 0, scheduledDays: 20 },
    chargeableMinutes: 9_000, employeeUserId: NISHA, fullName: "Nisha S.",
    recordedMinutes: 12_000, roleKey: "manager",
  }, [], "2026-08-31");
  // Working more than scheduled is overtime, a different problem from a gap.
  assert.equal(overtime.missingMinutes, 0);
});

test("a target is met within tolerance, because a month is not a precise instrument", () => {
  assert.equal(bandFor(8000, 8000), "on_target");
  assert.equal(bandFor(8000 - ON_TARGET_TOLERANCE_BPS, 8000), "on_target");
  assert.equal(bandFor(8000 + ON_TARGET_TOLERANCE_BPS, 8000), "on_target");
  assert.equal(bandFor(8000 - ON_TARGET_TOLERANCE_BPS - 1, 8000), "under");
  assert.equal(bandFor(8000 + ON_TARGET_TOLERANCE_BPS + 1, 8000), "over");
});

test("the firm figure is chargeable over available across everyone", () => {
  const make = (id: string, chargeable: number, available: number, recorded: number) => computeUtilisation({
    availability: { fullDayMinutes: FULL_DAY, leaveHalfDays: 0, scheduledDays: available / FULL_DAY },
    chargeableMinutes: chargeable, employeeUserId: id, fullName: id, recordedMinutes: recorded, roleKey: "associate",
  }, [roleTarget("associate", 8000)], "2026-08-31");

  const firm = summariseFirm([
    make("a", 8_000, 10_000, 10_000),
    make("b", 6_000, 10_000, 10_000),
  ]);
  assert.equal(firm.chargeableMinutes, 14_000);
  assert.equal(firm.availableMinutes, 20_000);
  assert.equal(firm.utilisationBps, 7000);
  assert.equal(firm.unmeasured, 0);
});

test("substantially unfilled timesheets are counted, because they make the rest a guess", () => {
  const make = (id: string, recorded: number) => computeUtilisation({
    availability: { fullDayMinutes: FULL_DAY, leaveHalfDays: 0, scheduledDays: 20 },
    chargeableMinutes: recorded, employeeUserId: id, fullName: id, recordedMinutes: recorded, roleKey: "associate",
  }, [], "2026-08-31");

  const available = 20 * FULL_DAY;
  const justUnder = available - Math.ceil((available * MISSING_TIME_THRESHOLD_BPS) / 10_000) + 1;
  const firm = summariseFirm([
    make("filled", available),
    make("empty", 0),
    make("borderline", justUnder),
  ]);
  assert.equal(firm.missingTimesheets, 1, "only the genuinely empty one");
});

test("a person with no available time is not counted as a missing timesheet", () => {
  const onLeave = computeUtilisation({
    availability: { fullDayMinutes: FULL_DAY, leaveHalfDays: 52, scheduledDays: 26 },
    chargeableMinutes: 0, employeeUserId: NISHA, fullName: "Nisha S.", recordedMinutes: 0, roleKey: "manager",
  }, [roleTarget("manager", 7500)], "2026-08-31");
  assert.equal(onLeave.availableMinutes, 0);
  assert.equal(summariseFirm([onLeave]).missingTimesheets, 0);
  assert.equal(onLeave.band, "unmeasured", "nothing to divide by is not a failure to hit target");
});

test("hours read the way people speak about them", () => {
  assert.equal(formatHours(450), "7.5h");
  assert.equal(formatHours(11_700), "195.0h");
});
