import { randomUUID } from "node:crypto";
import { and, asc, count, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";

import {
  attendanceCorrectionRequests, attendanceDays, attendanceEvents, attendancePeriodSummaries,
  attendancePeriods, attendancePolicies, auditEvents, employeeProfiles, employeeWorkProfiles,
  leaveRequests, payrollEntries, payrollEntryLines, payrollRuns, tenantMemberships, users,
} from "../../db/schema";
import type { Role } from "../auth/authorization";
import type { DashboardDatabase } from "../dashboard/postgres/repository";
import { attendanceUnitsForStatus, buildAttendanceSummary, calculateClockedDay, eligibleWorkingDateKeys, indiaDateKey, indiaLocalDateTime, indiaPeriodKey, workingDateKeys } from "./calculations";
import { listHolidayDateKeys } from "../attendance-masters/repository";
import { insertNotifications } from "../notifications/repository";
import { checkLeaveQuota, consumptionForRequest, findServiceDates, listLeaveBalances, postLeaveConsumption, type LeaveBalance } from "./leave-ledger-repository";
import type { AttendancePolicyInput, CorrectionRequestInput, EmployeeWorkProfileInput, LeaveRequestInput, ManualAttendanceInput } from "./validation";

export class AttendanceRepositoryError extends Error {
  constructor(public readonly code: "not_found" | "invalid_state" | "not_reportee" | "self_approval" | "stale" | "period_locked" | "unresolved" | "payroll_dependency" | "quota_exceeded") {
    super({
      not_found: "Attendance record not found.", invalid_state: "This attendance action is no longer available.",
      not_reportee: "You cannot review this employee.", self_approval: "You cannot approve your own request.",
      stale: "Attendance changed after this request was submitted. Refresh and submit a new correction.",
      period_locked: "This attendance month is locked.", unresolved: "Resolve pending requests and missing punches before locking attendance.",
      payroll_dependency: "This attendance month is already connected to payroll and cannot be reopened.",
      quota_exceeded: "This leave exceeds the remaining entitlement. Take it as unpaid leave, or ask a reviewer to approve the excess with a reason.",
    }[code]);
    this.name = "AttendanceRepositoryError";
  }
}

const tenantWideAttendance = (role: string) => role === "firm_administrator" || role === "partner";
const rangeForPeriod = (periodKey: string) => ({ start: `${periodKey}-01`, end: `${periodKey}-${new Date(Date.UTC(Number(periodKey.slice(0, 4)), Number(periodKey.slice(5, 7)), 0)).getUTCDate()}` });
const eventSource = (role: string) => tenantWideAttendance(role) ? "administrator" : role === "manager" ? "manager" : "self_service";
const defaultPolicy = { id: null as string | null, effectiveFrom: null as string | null, fullDayMinutes: 450, halfDayMinutes: 225, lateGraceMinutes: 15, standardStartTime: "09:30", standardEndTime: "18:00", workingWeekMask: "1111110", timeZone: "Asia/Kolkata", jurisdictionState: "Bihar" };

async function policyFor(database: DashboardDatabase, tenantId: string, dateKey: string) {
  const [policy] = await database.select({
    id: attendancePolicies.id, effectiveFrom: attendancePolicies.effectiveFrom,
    fullDayMinutes: attendancePolicies.fullDayMinutes, halfDayMinutes: attendancePolicies.halfDayMinutes,
    lateGraceMinutes: attendancePolicies.lateGraceMinutes, standardStartTime: attendancePolicies.standardStartTime,
    standardEndTime: attendancePolicies.standardEndTime, workingWeekMask: attendancePolicies.workingWeekMask,
    timeZone: attendancePolicies.timeZone, jurisdictionState: attendancePolicies.jurisdictionState,
  }).from(attendancePolicies).where(and(eq(attendancePolicies.tenantId, tenantId), lte(attendancePolicies.effectiveFrom, dateKey))).orderBy(desc(attendancePolicies.effectiveFrom)).limit(1);
  return policy ?? defaultPolicy;
}

async function policyById(database: DashboardDatabase, tenantId: string, policyId: string) {
  const [policy] = await database.select({
    id: attendancePolicies.id, effectiveFrom: attendancePolicies.effectiveFrom,
    fullDayMinutes: attendancePolicies.fullDayMinutes, halfDayMinutes: attendancePolicies.halfDayMinutes,
    lateGraceMinutes: attendancePolicies.lateGraceMinutes, standardStartTime: attendancePolicies.standardStartTime,
    standardEndTime: attendancePolicies.standardEndTime, workingWeekMask: attendancePolicies.workingWeekMask,
    timeZone: attendancePolicies.timeZone, jurisdictionState: attendancePolicies.jurisdictionState,
  }).from(attendancePolicies).where(and(eq(attendancePolicies.tenantId, tenantId), eq(attendancePolicies.id, policyId))).limit(1);
  if (!policy) throw new AttendanceRepositoryError("invalid_state");
  return policy;
}

async function policyForAttendanceDate(database: DashboardDatabase, tenantId: string, dateKey: string) {
  const [period] = await database.select({ policyId: attendancePeriods.policyId }).from(attendancePeriods).where(and(
    eq(attendancePeriods.tenantId, tenantId), eq(attendancePeriods.periodKey, dateKey.slice(0, 7)),
  )).limit(1);
  return period ? policyById(database, tenantId, period.policyId) : policyFor(database, tenantId, dateKey);
}

async function assertActiveEmployee(database: DashboardDatabase, tenantId: string, employeeUserId: string) {
  const [member] = await database.select({ userId: tenantMemberships.userId }).from(tenantMemberships).where(and(
    eq(tenantMemberships.tenantId, tenantId), eq(tenantMemberships.userId, employeeUserId), eq(tenantMemberships.status, "active"),
  )).limit(1);
  if (!member) throw new AttendanceRepositoryError("not_found");
}

async function assertEmployeeEligibleForDate(database: DashboardDatabase, tenantId: string, employeeUserId: string, dateKey: string) {
  const [employee] = await database.select({ userId: employeeProfiles.userId }).from(employeeProfiles).where(and(
    eq(employeeProfiles.tenantId, tenantId), eq(employeeProfiles.userId, employeeUserId), lte(employeeProfiles.joiningDate, dateKey),
    sql`${employeeProfiles.employmentEndDate} is null or ${employeeProfiles.employmentEndDate} >= ${dateKey}`,
  )).limit(1);
  if (!employee) throw new AttendanceRepositoryError("not_found");
}

async function assertOpenDate(database: DashboardDatabase, tenantId: string, dateKey: string) {
  const [period] = await database.select({ status: attendancePeriods.status }).from(attendancePeriods).where(and(
    eq(attendancePeriods.tenantId, tenantId), eq(attendancePeriods.periodKey, dateKey.slice(0, 7)),
  )).limit(1);
  if (period?.status === "locked") throw new AttendanceRepositoryError("period_locked");
}

async function lockAttendancePeriodKey(database: DashboardDatabase, tenantId: string, periodKey: string) {
  await database.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${tenantId}:attendance`}, 0))`);
  await database.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${tenantId}:attendance:${periodKey}`}, 0))`);
}

async function lockOpenDates(database: DashboardDatabase, tenantId: string, dates: string[]) {
  const periodKeys = [...new Set(dates.map((dateKey) => dateKey.slice(0, 7)))].sort();
  for (const periodKey of periodKeys) await lockAttendancePeriodKey(database, tenantId, periodKey);
  for (const dateKey of dates) await assertOpenDate(database, tenantId, dateKey);
}

/**
 * Who should be told that a request is waiting.
 *
 * The employee's own manager, and the firm's tenant-wide reviewers when they
 * have none — a request with nobody watching it sits until somebody happens to
 * look, which is exactly what this is for.
 */
async function reviewersFor(database: DashboardDatabase, tenantId: string, employeeUserId: string): Promise<string[]> {
  const [profile] = await database.select({ managerUserId: employeeWorkProfiles.managerUserId })
    .from(employeeWorkProfiles).where(and(
      eq(employeeWorkProfiles.tenantId, tenantId),
      eq(employeeWorkProfiles.employeeUserId, employeeUserId),
    )).limit(1);
  if (profile?.managerUserId) return [profile.managerUserId];

  const fallback = await database.select({ userId: tenantMemberships.userId }).from(tenantMemberships).where(and(
    eq(tenantMemberships.tenantId, tenantId),
    eq(tenantMemberships.status, "active"),
    inArray(tenantMemberships.roleKey, ["firm_administrator", "partner"]),
  ));
  return fallback.map((row) => row.userId).filter((userId) => userId !== employeeUserId);
}

/** The employee's own name, for a notification somebody else has to read. */
async function nameOf(database: DashboardDatabase, tenantId: string, userId: string) {
  const [row] = await database.select({ fullName: users.fullName }).from(users)
    .where(eq(users.id, userId)).limit(1);
  return row?.fullName ?? "An employee";
}

async function canReview(database: DashboardDatabase, tenantId: string, reviewerUserId: string, reviewerRole: Role, employeeUserId: string) {
  if (reviewerUserId === employeeUserId) return false;
  if (tenantWideAttendance(reviewerRole)) return true;
  if (reviewerRole !== "manager") return false;
  const [profile] = await database.select({ id: employeeWorkProfiles.id }).from(employeeWorkProfiles).where(and(
    eq(employeeWorkProfiles.tenantId, tenantId), eq(employeeWorkProfiles.employeeUserId, employeeUserId), eq(employeeWorkProfiles.managerUserId, reviewerUserId),
  )).limit(1);
  return Boolean(profile);
}

function manualUnits(status: ManualAttendanceInput["status"]) {
  return attendanceUnitsForStatus(status);
}

export type AttendanceDayView = {
  id: string; employeeUserId: string; attendanceDate: string; status: string; firstCheckIn: string | null;
  lastCheckOut: string | null; workedMinutes: number; lateMinutes: number; paidHalfDays: number; lopHalfDays: number; note: string; version: number;
};
export type AttendanceRequestView = {
  id: string; kind: "leave" | "correction"; employeeUserId: string; employeeName: string; dateLabel: string;
  detail: string; reason: string; status: string; createdAt: string;
  /** Present on pending leave: what approving it would do to the entitlement. */
  quota?: { costHalfDays: number; exceedsByHalfDays: number; remainingHalfDays: number; uncapped: boolean };
};
export type AttendanceTeamMember = { userId: string; fullName: string; employeeCode: string; designation: string; managerUserId: string | null; membershipStatus: string; employmentEndDate: string | null; presentDays: number; exceptionCount: number };
export type AttendanceWorkspaceData = {
  todayKey: string; periodKey: string; policy: typeof defaultPolicy; period: { id: string; policyId: string; status: string } | null;
  selfDays: AttendanceDayView[]; selfRequests: AttendanceRequestView[]; approvals: AttendanceRequestView[]; team: AttendanceTeamMember[];
  leaveBalances: LeaveBalance[];
  metrics: { present: number; absent: number; leave: number; late: number; missingPunch: number; pendingRequests: number };
};

const daySelection = {
  id: attendanceDays.id, employeeUserId: attendanceDays.employeeUserId, attendanceDate: attendanceDays.attendanceDate,
  status: attendanceDays.status, firstCheckIn: attendanceDays.firstCheckIn, lastCheckOut: attendanceDays.lastCheckOut,
  workedMinutes: attendanceDays.workedMinutes, lateMinutes: attendanceDays.lateMinutes, paidHalfDays: attendanceDays.paidHalfDays,
  lopHalfDays: attendanceDays.lopHalfDays, note: attendanceDays.note, version: attendanceDays.version,
};

export async function getAttendanceWorkspace(database: DashboardDatabase, tenantId: string, viewerUserId: string, viewerRole: Role, periodKey = indiaPeriodKey()): Promise<AttendanceWorkspaceData> {
  if (!tenantId.trim() || !viewerUserId.trim()) throw new Error("Tenant and viewer are required.");
  const { start, end } = rangeForPeriod(periodKey);
  const [latestPolicy, periodRows, selfRows, ownLeave, ownCorrections] = await Promise.all([
    policyFor(database, tenantId, end),
    database.select({ id: attendancePeriods.id, policyId: attendancePeriods.policyId, status: attendancePeriods.status }).from(attendancePeriods).where(and(eq(attendancePeriods.tenantId, tenantId), eq(attendancePeriods.periodKey, periodKey))).limit(1),
    database.select(daySelection).from(attendanceDays).where(and(eq(attendanceDays.tenantId, tenantId), eq(attendanceDays.employeeUserId, viewerUserId), gte(attendanceDays.attendanceDate, start), lte(attendanceDays.attendanceDate, end))).orderBy(asc(attendanceDays.attendanceDate)),
    database.select({ id: leaveRequests.id, employeeUserId: leaveRequests.employeeUserId, dateFrom: leaveRequests.dateFrom, dateTo: leaveRequests.dateTo, leaveType: leaveRequests.leaveType, reason: leaveRequests.reason, status: leaveRequests.status, createdAt: leaveRequests.createdAt }).from(leaveRequests).where(and(eq(leaveRequests.tenantId, tenantId), eq(leaveRequests.employeeUserId, viewerUserId))).orderBy(desc(leaveRequests.createdAt)).limit(20),
    database.select({ id: attendanceCorrectionRequests.id, employeeUserId: attendanceCorrectionRequests.employeeUserId, attendanceDate: attendanceCorrectionRequests.attendanceDate, proposedStatus: attendanceCorrectionRequests.proposedStatus, reason: attendanceCorrectionRequests.reason, status: attendanceCorrectionRequests.status, createdAt: attendanceCorrectionRequests.createdAt }).from(attendanceCorrectionRequests).where(and(eq(attendanceCorrectionRequests.tenantId, tenantId), eq(attendanceCorrectionRequests.employeeUserId, viewerUserId))).orderBy(desc(attendanceCorrectionRequests.createdAt)).limit(20),
  ]);
  const policy = periodRows[0] ? await policyById(database, tenantId, periodRows[0].policyId) : latestPolicy;
  const reporteeCondition = tenantWideAttendance(viewerRole) ? eq(employeeWorkProfiles.tenantId, tenantId) : and(eq(employeeWorkProfiles.tenantId, tenantId), eq(employeeWorkProfiles.managerUserId, viewerUserId));
  const teamRows = viewerRole === "manager" || tenantWideAttendance(viewerRole) ? await database.select({
    userId: employeeWorkProfiles.employeeUserId, managerUserId: employeeWorkProfiles.managerUserId,
    fullName: users.fullName, employeeCode: employeeProfiles.employeeCode, designation: employeeProfiles.designation,
    membershipStatus: tenantMemberships.status, employmentEndDate: employeeProfiles.employmentEndDate,
  }).from(employeeWorkProfiles).innerJoin(users, eq(users.id, employeeWorkProfiles.employeeUserId)).innerJoin(employeeProfiles, and(eq(employeeProfiles.tenantId, tenantId), eq(employeeProfiles.userId, employeeWorkProfiles.employeeUserId))).innerJoin(tenantMemberships, and(eq(tenantMemberships.tenantId, tenantId), eq(tenantMemberships.userId, employeeWorkProfiles.employeeUserId))).where(and(
    reporteeCondition, lte(employeeProfiles.joiningDate, end), sql`${employeeProfiles.employmentEndDate} is null or ${employeeProfiles.employmentEndDate} >= ${start}`,
  )).orderBy(asc(users.fullName)) : [];
  const teamIds = teamRows.map((row) => row.userId);
  const [teamDays, pendingLeaves, pendingCorrections] = teamIds.length ? await Promise.all([
    database.select({ employeeUserId: attendanceDays.employeeUserId, status: attendanceDays.status }).from(attendanceDays).where(and(eq(attendanceDays.tenantId, tenantId), inArray(attendanceDays.employeeUserId, teamIds), gte(attendanceDays.attendanceDate, start), lte(attendanceDays.attendanceDate, end))),
    database.select({ id: leaveRequests.id, employeeUserId: leaveRequests.employeeUserId, dateFrom: leaveRequests.dateFrom, dateTo: leaveRequests.dateTo, dayPortion: leaveRequests.dayPortion, paidClassification: leaveRequests.paidClassification, leaveType: leaveRequests.leaveType, reason: leaveRequests.reason, status: leaveRequests.status, createdAt: leaveRequests.createdAt }).from(leaveRequests).where(and(eq(leaveRequests.tenantId, tenantId), inArray(leaveRequests.employeeUserId, teamIds), eq(leaveRequests.status, "pending"))),
    database.select({ id: attendanceCorrectionRequests.id, employeeUserId: attendanceCorrectionRequests.employeeUserId, attendanceDate: attendanceCorrectionRequests.attendanceDate, proposedStatus: attendanceCorrectionRequests.proposedStatus, reason: attendanceCorrectionRequests.reason, status: attendanceCorrectionRequests.status, createdAt: attendanceCorrectionRequests.createdAt }).from(attendanceCorrectionRequests).where(and(eq(attendanceCorrectionRequests.tenantId, tenantId), inArray(attendanceCorrectionRequests.employeeUserId, teamIds), eq(attendanceCorrectionRequests.status, "pending"))),
  ]) : [[], [], []];
  const names = new Map(teamRows.map((row) => [row.userId, row.fullName]));
  const selfRequests: AttendanceRequestView[] = [
    ...ownLeave.map((row) => ({ id: row.id, kind: "leave" as const, employeeUserId: row.employeeUserId, employeeName: "You", dateLabel: row.dateFrom === row.dateTo ? row.dateFrom : `${row.dateFrom} – ${row.dateTo}`, detail: row.leaveType, reason: row.reason, status: row.status, createdAt: row.createdAt.toISOString() })),
    ...ownCorrections.map((row) => ({ id: row.id, kind: "correction" as const, employeeUserId: row.employeeUserId, employeeName: "You", dateLabel: row.attendanceDate, detail: row.proposedStatus, reason: row.reason, status: row.status, createdAt: row.createdAt.toISOString() })),
  ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  // A reviewer deciding leave needs the entitlement in front of them, not after
  // the fact. Pending requests are few by definition, so this is cheap; the cap
  // is there so a neglected queue cannot turn one page load into hundreds.
  const todayKey = indiaDateKey();
  const leaveQuotas = new Map<string, AttendanceRequestView["quota"]>();
  for (const row of pendingLeaves.slice(0, 25)) {
    const assessment = await checkLeaveQuota(database, tenantId, row.employeeUserId, {
      dateFrom: row.dateFrom, dateTo: row.dateTo,
      dayPortion: row.dayPortion as "full" | "first_half" | "second_half",
      leaveType: row.leaveType,
      paidClassification: row.paidClassification as "paid" | "unpaid",
    }, policy.workingWeekMask, todayKey, policy.jurisdictionState).catch(() => null);
    if (assessment) {
      leaveQuotas.set(row.id, {
        costHalfDays: assessment.requestedHalfDays,
        exceedsByHalfDays: assessment.exceedsByHalfDays,
        remainingHalfDays: assessment.balanceHalfDays,
        uncapped: assessment.uncapped,
      });
    }
  }
  const approvals: AttendanceRequestView[] = [
    ...pendingLeaves.map((row) => ({ id: row.id, kind: "leave" as const, employeeUserId: row.employeeUserId, employeeName: names.get(row.employeeUserId) ?? "Employee", dateLabel: row.dateFrom === row.dateTo ? row.dateFrom : `${row.dateFrom} – ${row.dateTo}`, detail: row.leaveType, reason: row.reason, status: row.status, createdAt: row.createdAt.toISOString(), quota: leaveQuotas.get(row.id) })),
    ...pendingCorrections.map((row) => ({ id: row.id, kind: "correction" as const, employeeUserId: row.employeeUserId, employeeName: names.get(row.employeeUserId) ?? "Employee", dateLabel: row.attendanceDate, detail: row.proposedStatus, reason: row.reason, status: row.status, createdAt: row.createdAt.toISOString() })),
  ].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const selfDays: AttendanceDayView[] = selfRows.map((row) => ({ ...row, firstCheckIn: row.firstCheckIn?.toISOString() ?? null, lastCheckOut: row.lastCheckOut?.toISOString() ?? null }));
  const team = teamRows.map((member) => {
    const days = teamDays.filter((day) => day.employeeUserId === member.userId);
    return { ...member, presentDays: days.filter((day) => ["present", "late", "wfh", "tour"].includes(day.status)).length, exceptionCount: days.filter((day) => ["absent", "missing_punch"].includes(day.status)).length };
  });
  const leaveBalances = await listLeaveBalances(database, tenantId, viewerUserId, todayKey).catch(() => []);
  return {
    todayKey, periodKey, policy, period: periodRows[0] ?? null, selfDays, selfRequests, approvals, team, leaveBalances,
    metrics: {
      present: selfDays.filter((day) => ["present", "wfh", "tour"].includes(day.status)).length,
      absent: selfDays.filter((day) => day.status === "absent").length,
      leave: selfDays.filter((day) => day.status === "leave").length,
      late: selfDays.filter((day) => day.status === "late").length,
      missingPunch: selfDays.filter((day) => day.status === "missing_punch").length,
      pendingRequests: selfRequests.filter((request) => request.status === "pending").length,
    },
  };
}

export async function checkIn(database: DashboardDatabase, tenantId: string, employeeUserId: string, now = new Date()) {
  const dateKey = indiaDateKey(now);
  return database.transaction(async (transaction) => {
    await lockOpenDates(transaction, tenantId, [dateKey]);
    await assertActiveEmployee(transaction, tenantId, employeeUserId);
    await transaction.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${tenantId}:${employeeUserId}:${dateKey}`}, 0))`);
    await transaction.insert(attendanceDays).values({ tenantId, employeeUserId, attendanceDate: dateKey, status: "missing_punch" }).onConflictDoNothing();
    const [day] = await transaction.select({ id: attendanceDays.id, firstCheckIn: attendanceDays.firstCheckIn }).from(attendanceDays).where(and(eq(attendanceDays.tenantId, tenantId), eq(attendanceDays.employeeUserId, employeeUserId), eq(attendanceDays.attendanceDate, dateKey))).limit(1).for("update");
    if (!day || day.firstCheckIn) throw new AttendanceRepositoryError("invalid_state");
    await transaction.update(attendanceDays).set({ firstCheckIn: now, source: "self_service", updatedAt: now, version: sql`${attendanceDays.version} + 1` }).where(eq(attendanceDays.id, day.id));
    await transaction.insert(attendanceEvents).values({ tenantId, attendanceDayId: day.id, employeeUserId, actorUserId: employeeUserId, eventType: "check_in", occurredAt: now, source: "self_service" });
    return day.id;
  });
}

export async function checkOut(database: DashboardDatabase, tenantId: string, employeeUserId: string, now = new Date()) {
  const dateKey = indiaDateKey(now);
  return database.transaction(async (transaction) => {
    await lockOpenDates(transaction, tenantId, [dateKey]);
    await assertActiveEmployee(transaction, tenantId, employeeUserId);
    const policy = await policyForAttendanceDate(transaction, tenantId, dateKey);
    const [day] = await transaction.select({ id: attendanceDays.id, firstCheckIn: attendanceDays.firstCheckIn, lastCheckOut: attendanceDays.lastCheckOut }).from(attendanceDays).where(and(eq(attendanceDays.tenantId, tenantId), eq(attendanceDays.employeeUserId, employeeUserId), eq(attendanceDays.attendanceDate, dateKey))).limit(1).for("update");
    if (!day?.firstCheckIn || day.lastCheckOut || now <= day.firstCheckIn) throw new AttendanceRepositoryError("invalid_state");
    const result = calculateClockedDay({ checkIn: day.firstCheckIn, checkOut: now, ...policy });
    await transaction.update(attendanceDays).set({ ...result, lastCheckOut: now, updatedAt: now, version: sql`${attendanceDays.version} + 1` }).where(eq(attendanceDays.id, day.id));
    await transaction.insert(attendanceEvents).values({ tenantId, attendanceDayId: day.id, employeeUserId, actorUserId: employeeUserId, eventType: "check_out", occurredAt: now, source: "self_service" });
  });
}

export async function recordManualAttendance(database: DashboardDatabase, tenantId: string, actorUserId: string, actorRole: Role, employeeUserId: string, input: ManualAttendanceInput) {
  const checkIn = input.checkInTime ? indiaLocalDateTime(input.attendanceDate, input.checkInTime) : null;
  const checkOut = input.checkOutTime ? indiaLocalDateTime(input.attendanceDate, input.checkOutTime) : null;
  const workedMinutes = checkIn && checkOut ? Math.floor((checkOut.getTime() - checkIn.getTime()) / 60_000) : 0;
  const units = manualUnits(input.status);
  await database.transaction(async (transaction) => {
    await lockOpenDates(transaction, tenantId, [input.attendanceDate]);
    await assertActiveEmployee(transaction, tenantId, actorUserId);
    await assertEmployeeEligibleForDate(transaction, tenantId, employeeUserId, input.attendanceDate);
    await transaction.insert(attendanceDays).values({ tenantId, employeeUserId, attendanceDate: input.attendanceDate, status: input.status, firstCheckIn: checkIn, lastCheckOut: checkOut, workedMinutes, ...units, source: eventSource(actorRole), note: input.note }).onConflictDoUpdate({ target: [attendanceDays.tenantId, attendanceDays.employeeUserId, attendanceDays.attendanceDate], set: { status: input.status, firstCheckIn: checkIn, lastCheckOut: checkOut, workedMinutes, ...units, source: eventSource(actorRole), note: input.note, updatedAt: new Date(), version: sql`${attendanceDays.version} + 1` } });
    const [day] = await transaction.select({ id: attendanceDays.id }).from(attendanceDays).where(and(eq(attendanceDays.tenantId, tenantId), eq(attendanceDays.employeeUserId, employeeUserId), eq(attendanceDays.attendanceDate, input.attendanceDate))).limit(1);
    if (!day) throw new AttendanceRepositoryError("not_found");
    await transaction.insert(attendanceEvents).values({ tenantId, attendanceDayId: day.id, employeeUserId, actorUserId, eventType: "manual_record", occurredAt: new Date(), source: eventSource(actorRole), note: input.note });
  });
}

export async function createLeaveRequest(database: DashboardDatabase, tenantId: string, employeeUserId: string, input: LeaveRequestInput) {
  if (input.dayPortion !== "full" && input.dateFrom !== input.dateTo) throw new AttendanceRepositoryError("invalid_state");
  const id = randomUUID();
  await database.transaction(async (transaction) => {
    await lockOpenDates(transaction, tenantId, dateKeys(input.dateFrom, input.dateTo));
    await assertActiveEmployee(transaction, tenantId, employeeUserId);
    await assertEmployeeEligibleForDate(transaction, tenantId, employeeUserId, input.dateFrom);
    await assertEmployeeEligibleForDate(transaction, tenantId, employeeUserId, input.dateTo);
    // The employee is held to their entitlement; only a reviewer can go past it,
    // and only by saying why. Unpaid leave is never checked — it spends nothing.
    const policy = await policyFor(transaction, tenantId, input.dateFrom);
    const quota = await checkLeaveQuota(transaction, tenantId, employeeUserId, input, policy.workingWeekMask, indiaDateKey(), policy.jurisdictionState);
    if (quota && !quota.withinBalance) throw new AttendanceRepositoryError("quota_exceeded");
    await transaction.insert(leaveRequests).values({ id, tenantId, employeeUserId, ...input });

    const recipients = await reviewersFor(transaction, tenantId, employeeUserId);
    if (recipients.length > 0) {
      const name = await nameOf(transaction, tenantId, employeeUserId);
      const span = input.dateFrom === input.dateTo ? input.dateFrom : `${input.dateFrom} to ${input.dateTo}`;
      await insertNotifications(transaction, tenantId, recipients.map((recipientUserId) => ({
        recipientUserId,
        type: "attendance_request_raised" as const,
        title: `${name} has requested leave`,
        body: `${input.leaveType} · ${span} · ${input.paidClassification}. Reason: ${input.reason}`,
        resourceType: "leave_request" as const,
        resourceId: id,
        dedupeKey: `attendance_request_raised:${id}:${recipientUserId}`,
      })));
    }
  });
  return id;
}

/**
 * What the balance panel and the request form need before anything is submitted,
 * so the employee sees the number rather than discovering it in an error.
 */
export async function previewLeaveQuota(
  database: DashboardDatabase,
  tenantId: string,
  employeeUserId: string,
  input: LeaveRequestInput,
  todayKey = indiaDateKey(),
) {
  const policy = await policyFor(database, tenantId, input.dateFrom);
  return checkLeaveQuota(database, tenantId, employeeUserId, input, policy.workingWeekMask, todayKey, policy.jurisdictionState);
}

export async function createCorrectionRequest(database: DashboardDatabase, tenantId: string, employeeUserId: string, input: CorrectionRequestInput) {
  const id = randomUUID();
  await database.transaction(async (transaction) => {
    await lockOpenDates(transaction, tenantId, [input.attendanceDate]);
    await assertActiveEmployee(transaction, tenantId, employeeUserId);
    await assertEmployeeEligibleForDate(transaction, tenantId, employeeUserId, input.attendanceDate);
    const [day] = await transaction.select(daySelection).from(attendanceDays).where(and(eq(attendanceDays.tenantId, tenantId), eq(attendanceDays.employeeUserId, employeeUserId), eq(attendanceDays.attendanceDate, input.attendanceDate))).limit(1);
    await transaction.insert(attendanceCorrectionRequests).values({
      id, tenantId, employeeUserId, attendanceDate: input.attendanceDate, sourceAttendanceDayId: day?.id ?? null,
      sourceVersion: day?.version ?? 0, originalSnapshot: JSON.stringify(day ?? null), proposedStatus: input.proposedStatus,
      proposedCheckIn: input.proposedCheckInTime ? indiaLocalDateTime(input.attendanceDate, input.proposedCheckInTime) : null,
      proposedCheckOut: input.proposedCheckOutTime ? indiaLocalDateTime(input.attendanceDate, input.proposedCheckOutTime) : null,
      reason: input.reason,
    });

    const recipients = await reviewersFor(transaction, tenantId, employeeUserId);
    if (recipients.length > 0) {
      const name = await nameOf(transaction, tenantId, employeeUserId);
      await insertNotifications(transaction, tenantId, recipients.map((recipientUserId) => ({
        recipientUserId,
        type: "attendance_request_raised" as const,
        title: `${name} has requested an attendance correction`,
        body: `${input.attendanceDate} · proposed ${input.proposedStatus}. Reason: ${input.reason}`,
        resourceType: "attendance_correction_request" as const,
        resourceId: id,
        dedupeKey: `attendance_request_raised:${id}:${recipientUserId}`,
      })));
    }
  });
  return id;
}

function dateKeys(from: string, to: string) {
  const result: string[] = [];
  const cursor = new Date(`${from}T00:00:00Z`); const end = new Date(`${to}T00:00:00Z`);
  while (cursor <= end && result.length <= 62) { result.push(cursor.toISOString().slice(0, 10)); cursor.setUTCDate(cursor.getUTCDate() + 1); }
  if (cursor <= end) throw new AttendanceRepositoryError("invalid_state");
  return result;
}

export async function decideLeaveRequest(database: DashboardDatabase, tenantId: string, reviewerUserId: string, reviewerRole: Role, requestId: string, decision: "approved" | "rejected", decisionNote: string, quotaExceptionReason = "") {
  await database.transaction(async (transaction) => {
    const [request] = await transaction.select().from(leaveRequests).where(and(eq(leaveRequests.id, requestId), eq(leaveRequests.tenantId, tenantId))).limit(1).for("update");
    if (!request) throw new AttendanceRepositoryError("not_found");
    if (request.employeeUserId === reviewerUserId) throw new AttendanceRepositoryError("self_approval");
    if (!(await canReview(transaction, tenantId, reviewerUserId, reviewerRole, request.employeeUserId))) throw new AttendanceRepositoryError("not_reportee");
    if (request.status !== "pending") throw new AttendanceRepositoryError("invalid_state");
    const affectedDates = dateKeys(request.dateFrom, request.dateTo);
    await lockOpenDates(transaction, tenantId, affectedDates);
    await assertActiveEmployee(transaction, tenantId, reviewerUserId);
    const now = new Date();

    // Re-checked at the decision, not trusted from submission time: the balance
    // may have moved while the request sat in the queue. A reviewer may still
    // approve past the entitlement, but the reason is then part of the record.
    const policy = await policyFor(transaction, tenantId, request.dateFrom);
    const todayKey = indiaDateKey();
    const quota = decision === "approved"
      ? await checkLeaveQuota(transaction, tenantId, request.employeeUserId, {
        dateFrom: request.dateFrom, dateTo: request.dateTo,
        dayPortion: request.dayPortion as "full" | "first_half" | "second_half",
        leaveType: request.leaveType,
        paidClassification: request.paidClassification as "paid" | "unpaid",
      }, policy.workingWeekMask, todayKey, policy.jurisdictionState)
      : null;
    const exception = quota && !quota.withinBalance ? quotaExceptionReason.trim().slice(0, 500) : "";
    if (quota && !quota.withinBalance && exception.length < 3) throw new AttendanceRepositoryError("quota_exceeded");

    await transaction.update(leaveRequests).set({ status: decision, reviewerUserId, decisionNote, quotaExceptionReason: exception, decidedAt: now, updatedAt: now }).where(and(eq(leaveRequests.id, requestId), eq(leaveRequests.status, "pending")));
    if (decision === "approved") {
      const service = await findServiceDates(transaction, tenantId, request.employeeUserId);
      if (service) {
        const consumption = await consumptionForRequest(transaction, tenantId, service, {
          dateFrom: request.dateFrom, dateTo: request.dateTo,
          dayPortion: request.dayPortion as "full" | "first_half" | "second_half",
        }, policy.workingWeekMask, policy.jurisdictionState);
        await postLeaveConsumption(transaction, tenantId, request.employeeUserId, request, consumption);
      }
      if (exception) {
        await transaction.insert(auditEvents).values({
          tenantId, actorUserId: reviewerUserId, resourceType: "leave_request", resourceId: requestId,
          action: "leave.quota_exception", reason: exception,
        });
      }
      for (const dateKey of affectedDates) {
        const halfDays = request.dayPortion === "full" ? 2 : 1;
        const units = request.paidClassification === "paid" ? { paidHalfDays: halfDays, lopHalfDays: 0 } : { paidHalfDays: 0, lopHalfDays: halfDays };
        await transaction.insert(attendanceDays).values({ tenantId, employeeUserId: request.employeeUserId, attendanceDate: dateKey, status: "leave", ...units, source: eventSource(reviewerRole), note: request.reason }).onConflictDoUpdate({ target: [attendanceDays.tenantId, attendanceDays.employeeUserId, attendanceDays.attendanceDate], set: { status: "leave", ...units, source: eventSource(reviewerRole), note: request.reason, firstCheckIn: null, lastCheckOut: null, workedMinutes: 0, updatedAt: now, version: sql`${attendanceDays.version} + 1` } });
        const [day] = await transaction.select({ id: attendanceDays.id }).from(attendanceDays).where(and(eq(attendanceDays.tenantId, tenantId), eq(attendanceDays.employeeUserId, request.employeeUserId), eq(attendanceDays.attendanceDate, dateKey))).limit(1);
        if (day) await transaction.insert(attendanceEvents).values({ tenantId, attendanceDayId: day.id, employeeUserId: request.employeeUserId, actorUserId: reviewerUserId, eventType: "leave_approved", occurredAt: now, source: eventSource(reviewerRole), note: request.reason });
      }
    }

    // The decision is the whole point of raising the request. Without this the
    // employee finds out by logging in and looking.
    const span = request.dateFrom === request.dateTo ? request.dateFrom : `${request.dateFrom} to ${request.dateTo}`;
    await insertNotifications(transaction, tenantId, [{
      recipientUserId: request.employeeUserId,
      type: "attendance_request_decided" as const,
      title: `Your leave request was ${decision}`,
      body: `${request.leaveType} · ${span}${decisionNote ? ` · ${decisionNote}` : ""}`,
      resourceType: "leave_request" as const,
      resourceId: requestId,
      dedupeKey: `attendance_request_decided:${requestId}`,
    }]);
  });
}

export async function decideCorrectionRequest(database: DashboardDatabase, tenantId: string, reviewerUserId: string, reviewerRole: Role, requestId: string, decision: "approved" | "rejected", decisionNote: string) {
  await database.transaction(async (transaction) => {
    const [request] = await transaction.select().from(attendanceCorrectionRequests).where(and(eq(attendanceCorrectionRequests.id, requestId), eq(attendanceCorrectionRequests.tenantId, tenantId))).limit(1).for("update");
    if (!request) throw new AttendanceRepositoryError("not_found");
    if (request.employeeUserId === reviewerUserId) throw new AttendanceRepositoryError("self_approval");
    if (!(await canReview(transaction, tenantId, reviewerUserId, reviewerRole, request.employeeUserId))) throw new AttendanceRepositoryError("not_reportee");
    if (request.status !== "pending") throw new AttendanceRepositoryError("invalid_state");
    await lockOpenDates(transaction, tenantId, [request.attendanceDate]);
    await assertActiveEmployee(transaction, tenantId, reviewerUserId);
    const [day] = await transaction.select({ id: attendanceDays.id, version: attendanceDays.version }).from(attendanceDays).where(and(eq(attendanceDays.tenantId, tenantId), eq(attendanceDays.employeeUserId, request.employeeUserId), eq(attendanceDays.attendanceDate, request.attendanceDate))).limit(1).for("update");
    if ((day?.version ?? 0) !== request.sourceVersion) throw new AttendanceRepositoryError("stale");
    const now = new Date();
    if (decision === "approved") {
      const inputTimes = request.proposedCheckIn && request.proposedCheckOut ? Math.floor((request.proposedCheckOut.getTime() - request.proposedCheckIn.getTime()) / 60_000) : 0;
      const units = manualUnits(request.proposedStatus as ManualAttendanceInput["status"]);
      if (day) await transaction.update(attendanceDays).set({ status: request.proposedStatus, firstCheckIn: request.proposedCheckIn, lastCheckOut: request.proposedCheckOut, workedMinutes: inputTimes, ...units, source: eventSource(reviewerRole), note: request.reason, updatedAt: now, version: sql`${attendanceDays.version} + 1` }).where(and(eq(attendanceDays.id, day.id), eq(attendanceDays.version, request.sourceVersion)));
      else await transaction.insert(attendanceDays).values({ tenantId, employeeUserId: request.employeeUserId, attendanceDate: request.attendanceDate, status: request.proposedStatus, firstCheckIn: request.proposedCheckIn, lastCheckOut: request.proposedCheckOut, workedMinutes: inputTimes, ...units, source: eventSource(reviewerRole), note: request.reason });
      const [updatedDay] = await transaction.select({ id: attendanceDays.id }).from(attendanceDays).where(and(eq(attendanceDays.tenantId, tenantId), eq(attendanceDays.employeeUserId, request.employeeUserId), eq(attendanceDays.attendanceDate, request.attendanceDate))).limit(1);
      if (updatedDay) await transaction.insert(attendanceEvents).values({ tenantId, attendanceDayId: updatedDay.id, employeeUserId: request.employeeUserId, actorUserId: reviewerUserId, eventType: "correction_approved", occurredAt: now, source: eventSource(reviewerRole), note: request.reason });
    }
    await transaction.update(attendanceCorrectionRequests).set({ status: decision, reviewerUserId, decisionNote, decidedAt: now, updatedAt: now }).where(and(eq(attendanceCorrectionRequests.id, requestId), eq(attendanceCorrectionRequests.status, "pending")));

    await insertNotifications(transaction, tenantId, [{
      recipientUserId: request.employeeUserId,
      type: "attendance_request_decided" as const,
      title: `Your attendance correction was ${decision}`,
      body: `${request.attendanceDate} · ${request.proposedStatus}${decisionNote ? ` · ${decisionNote}` : ""}`,
      resourceType: "attendance_correction_request" as const,
      resourceId: requestId,
      dedupeKey: `attendance_request_decided:${requestId}`,
    }]);
  });
}

export async function prepareAttendancePeriod(database: DashboardDatabase, tenantId: string, actorUserId: string, periodKey: string) {
  return database.transaction(async (transaction) => {
    await lockAttendancePeriodKey(transaction, tenantId, periodKey);
    await assertActiveEmployee(transaction, tenantId, actorUserId);
    const policy = await policyFor(transaction, tenantId, `${periodKey}-28`);
    if (!policy.id) throw new AttendanceRepositoryError("invalid_state");
    await transaction.insert(attendancePeriods).values({ tenantId, periodKey, policyId: policy.id }).onConflictDoNothing();
    const [period] = await transaction.select({ id: attendancePeriods.id, status: attendancePeriods.status }).from(attendancePeriods).where(and(eq(attendancePeriods.tenantId, tenantId), eq(attendancePeriods.periodKey, periodKey))).limit(1).for("update");
    if (!period || period.status !== "open") throw new AttendanceRepositoryError("invalid_state");
    const { start, end } = rangeForPeriod(periodKey);
    const employees = await transaction.select({ userId: employeeProfiles.userId, joiningDate: employeeProfiles.joiningDate, employmentEndDate: employeeProfiles.employmentEndDate })
      .from(employeeProfiles).where(and(eq(employeeProfiles.tenantId, tenantId), lte(employeeProfiles.joiningDate, end), sql`${employeeProfiles.employmentEndDate} is null or ${employeeProfiles.employmentEndDate} >= ${start}`));
    // Declared public holidays are not scheduled days, so nobody is marked absent on them.
    const holidays = await listHolidayDateKeys(transaction as unknown as DashboardDatabase, tenantId, periodKey, policy.jurisdictionState);
    const values = employees.flatMap((employee) => eligibleWorkingDateKeys(periodKey, policy.workingWeekMask, employee.joiningDate, employee.employmentEndDate, holidays)
      .map((attendanceDate) => ({ tenantId, employeeUserId: employee.userId, attendanceDate, status: "missing_punch", source: "system" })));
    if (values.length) await transaction.insert(attendanceDays).values(values).onConflictDoNothing();
    const holidayValues = employees.flatMap((employee) => holidays
      .filter((dateKey) => dateKey >= employee.joiningDate && (!employee.employmentEndDate || dateKey <= employee.employmentEndDate))
      .map((attendanceDate) => ({ tenantId, employeeUserId: employee.userId, attendanceDate, status: "holiday", source: "system" })));
    if (holidayValues.length) await transaction.insert(attendanceDays).values(holidayValues).onConflictDoNothing();
    await transaction.insert(auditEvents).values({ tenantId, actorUserId, resourceType: "attendance_period", resourceId: period.id, action: "attendance.prepared", reason: periodKey });
    return period.id;
  });
}

export async function moveAttendancePeriodToReview(database: DashboardDatabase, tenantId: string, actorUserId: string, periodId: string) {
  await database.transaction(async (transaction) => {
    const [candidate] = await transaction.select({ periodKey: attendancePeriods.periodKey }).from(attendancePeriods).where(and(eq(attendancePeriods.id, periodId), eq(attendancePeriods.tenantId, tenantId))).limit(1);
    if (!candidate) throw new AttendanceRepositoryError("not_found");
    await lockAttendancePeriodKey(transaction, tenantId, candidate.periodKey);
    await assertActiveEmployee(transaction, tenantId, actorUserId);
    const now = new Date();
    const [period] = await transaction.update(attendancePeriods).set({ status: "review", reviewedAt: now, reviewedByUserId: actorUserId, updatedAt: now }).where(and(eq(attendancePeriods.id, periodId), eq(attendancePeriods.tenantId, tenantId), eq(attendancePeriods.status, "open"))).returning({ id: attendancePeriods.id });
    if (!period) throw new AttendanceRepositoryError("invalid_state");
    await transaction.insert(auditEvents).values({ tenantId, actorUserId, resourceType: "attendance_period", resourceId: periodId, action: "attendance.review_started" });
  });
}

export async function lockAttendancePeriod(database: DashboardDatabase, tenantId: string, actorUserId: string, periodId: string) {
  await database.transaction(async (transaction) => {
    const [candidate] = await transaction.select({ periodKey: attendancePeriods.periodKey }).from(attendancePeriods).where(and(eq(attendancePeriods.id, periodId), eq(attendancePeriods.tenantId, tenantId))).limit(1);
    if (!candidate) throw new AttendanceRepositoryError("not_found");
    await lockAttendancePeriodKey(transaction, tenantId, candidate.periodKey);
    await assertActiveEmployee(transaction, tenantId, actorUserId);
    const [period] = await transaction.select({ id: attendancePeriods.id, periodKey: attendancePeriods.periodKey, policyId: attendancePeriods.policyId, status: attendancePeriods.status }).from(attendancePeriods).where(and(eq(attendancePeriods.id, periodId), eq(attendancePeriods.tenantId, tenantId))).limit(1).for("update");
    if (!period || period.status !== "review") throw new AttendanceRepositoryError("invalid_state");
    const { start, end } = rangeForPeriod(period.periodKey);
    const [leaveCount] = await transaction.select({ value: count() }).from(leaveRequests).where(and(eq(leaveRequests.tenantId, tenantId), eq(leaveRequests.status, "pending"), lte(leaveRequests.dateFrom, end), gte(leaveRequests.dateTo, start)));
    const [correctionCount] = await transaction.select({ value: count() }).from(attendanceCorrectionRequests).where(and(eq(attendanceCorrectionRequests.tenantId, tenantId), eq(attendanceCorrectionRequests.status, "pending"), gte(attendanceCorrectionRequests.attendanceDate, start), lte(attendanceCorrectionRequests.attendanceDate, end)));
    if (Number(leaveCount?.value) || Number(correctionCount?.value)) throw new AttendanceRepositoryError("unresolved");
    const policy = await policyById(transaction, tenantId, period.policyId);
    // Holidays must leave the scheduled base too, otherwise the summary would book
    // them as employment exclusions rather than firm closures.
    const holidays = await listHolidayDateKeys(transaction as unknown as DashboardDatabase, tenantId, period.periodKey, policy.jurisdictionState);
    const holidaySet = new Set(holidays);
    const periodScheduledHalfDays = workingDateKeys(period.periodKey, policy.workingWeekMask).filter((dateKey) => !holidaySet.has(dateKey)).length * 2;
    const employees = await transaction.select({ userId: employeeProfiles.userId, joiningDate: employeeProfiles.joiningDate, employmentEndDate: employeeProfiles.employmentEndDate })
      .from(employeeProfiles).where(and(eq(employeeProfiles.tenantId, tenantId), lte(employeeProfiles.joiningDate, end), sql`${employeeProfiles.employmentEndDate} is null or ${employeeProfiles.employmentEndDate} >= ${start}`));
    const days = await transaction.select({ employeeUserId: attendanceDays.employeeUserId, attendanceDate: attendanceDays.attendanceDate, status: attendanceDays.status, workedMinutes: attendanceDays.workedMinutes, lateMinutes: attendanceDays.lateMinutes, paidHalfDays: attendanceDays.paidHalfDays, lopHalfDays: attendanceDays.lopHalfDays }).from(attendanceDays).where(and(eq(attendanceDays.tenantId, tenantId), gte(attendanceDays.attendanceDate, start), lte(attendanceDays.attendanceDate, end)));
    const summaries = employees.flatMap((employee) => {
      const scheduledDates = eligibleWorkingDateKeys(period.periodKey, policy.workingWeekMask, employee.joiningDate, employee.employmentEndDate, holidays);
      if (!scheduledDates.length) return [];
      const scheduledDateSet = new Set(scheduledDates);
      const scheduledHalfDays = scheduledDates.length * 2;
      return [{
        tenantId, attendancePeriodId: period.id, employeeUserId: employee.userId,
        periodScheduledHalfDays, employmentExcludedHalfDays: periodScheduledHalfDays - scheduledHalfDays,
        ...buildAttendanceSummary(days.filter((day) => day.employeeUserId === employee.userId && scheduledDateSet.has(day.attendanceDate)), scheduledHalfDays, policy.fullDayMinutes),
      }];
    });
    const lockedSummaries = summaries.map(({ unresolvedHalfDays, ...summary }) => {
      if (unresolvedHalfDays > 0) throw new AttendanceRepositoryError("unresolved");
      return summary;
    });
    if (lockedSummaries.length) await transaction.insert(attendancePeriodSummaries).values(lockedSummaries);
    const now = new Date();
    await transaction.update(attendancePeriods).set({ status: "locked", policyId: policy.id, lockedAt: now, lockedByUserId: actorUserId, updatedAt: now }).where(and(eq(attendancePeriods.id, period.id), eq(attendancePeriods.status, "review")));
    await transaction.insert(auditEvents).values({ tenantId, actorUserId, resourceType: "attendance_period", resourceId: period.id, action: "attendance.locked", reason: period.periodKey });
  });
}

export async function reopenAttendancePeriod(database: DashboardDatabase, tenantId: string, actorUserId: string, periodId: string, reason: string) {
  if (reason.trim().length < 3) throw new AttendanceRepositoryError("invalid_state");
  await database.transaction(async (transaction) => {
    const [candidate] = await transaction.select({ periodKey: attendancePeriods.periodKey }).from(attendancePeriods).where(and(eq(attendancePeriods.id, periodId), eq(attendancePeriods.tenantId, tenantId))).limit(1);
    if (!candidate) throw new AttendanceRepositoryError("not_found");
    await lockAttendancePeriodKey(transaction, tenantId, candidate.periodKey);
    await assertActiveEmployee(transaction, tenantId, actorUserId);
    const [period] = await transaction.select({ id: attendancePeriods.id, status: attendancePeriods.status }).from(attendancePeriods).where(and(eq(attendancePeriods.id, periodId), eq(attendancePeriods.tenantId, tenantId))).limit(1).for("update");
    if (!period || period.status !== "locked") throw new AttendanceRepositoryError("invalid_state");
    const [payroll] = await transaction.select({ id: payrollRuns.id, status: payrollRuns.status }).from(payrollRuns).where(and(eq(payrollRuns.tenantId, tenantId), eq(payrollRuns.attendancePeriodId, periodId))).limit(1).for("update");
    if (payroll && payroll.status !== "draft") throw new AttendanceRepositoryError("payroll_dependency");
    if (payroll) {
      const entryRows = await transaction.select({ id: payrollEntries.id }).from(payrollEntries).where(and(eq(payrollEntries.tenantId, tenantId), eq(payrollEntries.payrollRunId, payroll.id)));
      await transaction.insert(auditEvents).values({ tenantId, actorUserId, resourceType: "payroll", resourceId: payroll.id, action: "payroll.invalidated_by_attendance_reopen", reason: reason.trim() });
      if (entryRows.length) await transaction.delete(payrollEntryLines).where(and(eq(payrollEntryLines.tenantId, tenantId), inArray(payrollEntryLines.payrollEntryId, entryRows.map((entry) => entry.id))));
      await transaction.delete(payrollEntries).where(and(eq(payrollEntries.tenantId, tenantId), eq(payrollEntries.payrollRunId, payroll.id)));
      await transaction.delete(payrollRuns).where(and(eq(payrollRuns.tenantId, tenantId), eq(payrollRuns.id, payroll.id), eq(payrollRuns.status, "draft")));
    }
    await transaction.delete(attendancePeriodSummaries).where(and(eq(attendancePeriodSummaries.tenantId, tenantId), eq(attendancePeriodSummaries.attendancePeriodId, periodId)));
    await transaction.update(attendancePeriods).set({ status: "open", reviewedAt: null, reviewedByUserId: null, lockedAt: null, lockedByUserId: null, reopenReason: reason.trim(), version: sql`${attendancePeriods.version} + 1`, updatedAt: new Date() }).where(eq(attendancePeriods.id, periodId));
    await transaction.insert(auditEvents).values({ tenantId, actorUserId, resourceType: "attendance_period", resourceId: periodId, action: "attendance.reopened", reason: reason.trim() });
  });
}

export async function createAttendancePolicy(database: DashboardDatabase, tenantId: string, actorUserId: string, input: AttendancePolicyInput) {
  if (!input.effectiveFrom.endsWith("-01")) throw new AttendanceRepositoryError("invalid_state");
  return database.transaction(async (transaction) => {
    await transaction.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${tenantId}:attendance`}, 0))`);
    await assertActiveEmployee(transaction, tenantId, actorUserId);
    const [latest] = await transaction.select({ effectiveFrom: attendancePolicies.effectiveFrom }).from(attendancePolicies).where(
      eq(attendancePolicies.tenantId, tenantId),
    ).orderBy(desc(attendancePolicies.effectiveFrom)).for("update").limit(1);
    if (latest && latest.effectiveFrom >= input.effectiveFrom) throw new AttendanceRepositoryError("invalid_state");
    const [affectedPeriod] = await transaction.select({ id: attendancePeriods.id }).from(attendancePeriods).where(and(
      eq(attendancePeriods.tenantId, tenantId), gte(attendancePeriods.periodKey, input.effectiveFrom.slice(0, 7)),
    )).limit(1);
    const [affectedAttendanceDay] = await transaction.select({ id: attendanceDays.id }).from(attendanceDays).where(and(
      eq(attendanceDays.tenantId, tenantId), gte(attendanceDays.attendanceDate, input.effectiveFrom),
    )).limit(1);
    if (affectedPeriod || affectedAttendanceDay) throw new AttendanceRepositoryError("invalid_state");
    const id = randomUUID();
    await transaction.insert(attendancePolicies).values({ id, tenantId, createdByUserId: actorUserId, ...input });
    await transaction.insert(auditEvents).values({ tenantId, actorUserId, resourceType: "attendance_policy", resourceId: id, action: "attendance.policy_created", reason: input.effectiveFrom });
    return id;
  });
}

export async function upsertEmployeeWorkProfile(database: DashboardDatabase, tenantId: string, actorUserId: string, input: EmployeeWorkProfileInput) {
  await database.transaction(async (transaction) => {
    await transaction.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${tenantId}:attendance`}, 0))`);
    await assertActiveEmployee(transaction, tenantId, actorUserId);
    await assertActiveEmployee(transaction, tenantId, input.employeeUserId);
    if (input.managerUserId) await assertActiveEmployee(transaction, tenantId, input.managerUserId);
    const [profile] = await transaction.insert(employeeWorkProfiles).values({ tenantId, ...input }).onConflictDoUpdate({ target: [employeeWorkProfiles.tenantId, employeeWorkProfiles.employeeUserId], set: { managerUserId: input.managerUserId, employmentType: input.employmentType, workLocationState: input.workLocationState, updatedAt: new Date() } }).returning({ id: employeeWorkProfiles.id });
    if (!profile) throw new AttendanceRepositoryError("not_found");
    await transaction.insert(auditEvents).values({ tenantId, actorUserId, resourceType: "employee_work_profile", resourceId: profile.id, action: "attendance.work_profile_updated", reason: input.workLocationState });
  });
}
