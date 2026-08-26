import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";

import {
  attendanceDays,
  attendancePolicies,
  auditEvents,
  employeeProfiles,
  holidayCalendar,
  tenantMemberships,
  timeEntries,
  users,
  utilisationTargets,
} from "../../db/schema";
import { eligibleWorkingDateKeys } from "../attendance/calculations";
import type { DashboardDatabase } from "../dashboard/postgres/repository";
import {
  computeUtilisation,
  summariseFirm,
  type FirmUtilisation,
  type TargetScope,
  type UtilisationTargetRow,
} from "./utilisation";

/**
 * Measuring utilisation for a month.
 *
 * Everything the arithmetic needs already existed and was never joined up:
 * the working calendar from attendance policy and holidays, approved leave from
 * the attendance register, and recorded effort from timesheets.
 */

export class UtilisationError extends Error {
  constructor(public readonly code: "not_found" | "invalid_target" | "invalid_date" | "invalid_scope") {
    super({
      not_found: "That employee is not part of this firm.",
      invalid_target: "Enter a target between 0% and 100%.",
      invalid_date: "Enter a valid date for the target to take effect.",
      invalid_scope: "Choose a role or an employee for this target.",
    }[code]);
    this.name = "UtilisationError";
  }
}

const monthEnd = (periodKey: string) => {
  const [year, month] = periodKey.split("-").map(Number);
  return `${periodKey}-${String(new Date(Date.UTC(year!, month!, 0)).getUTCDate()).padStart(2, "0")}`;
};

export async function listUtilisationTargets(database: DashboardDatabase, tenantId: string) {
  const rows = await database.select({
    effectiveFrom: utilisationTargets.effectiveFrom,
    employeeUserId: utilisationTargets.employeeUserId,
    roleKey: utilisationTargets.roleKey,
    scope: utilisationTargets.scope,
    targetBasisPoints: utilisationTargets.targetBasisPoints,
  }).from(utilisationTargets).where(eq(utilisationTargets.tenantId, tenantId));
  return rows.map((row) => ({ ...row, scope: row.scope as TargetScope })) as UtilisationTargetRow[];
}

export type UtilisationTargetView = UtilisationTargetRow & {
  employeeName: string | null;
  id: string;
  note: string;
};

export async function listUtilisationTargetRows(database: DashboardDatabase, tenantId: string): Promise<UtilisationTargetView[]> {
  const rows = await database.select({
    effectiveFrom: utilisationTargets.effectiveFrom,
    employeeName: users.fullName,
    employeeUserId: utilisationTargets.employeeUserId,
    id: utilisationTargets.id,
    note: utilisationTargets.note,
    roleKey: utilisationTargets.roleKey,
    scope: utilisationTargets.scope,
    targetBasisPoints: utilisationTargets.targetBasisPoints,
  }).from(utilisationTargets)
    .leftJoin(users, eq(users.id, utilisationTargets.employeeUserId))
    .where(eq(utilisationTargets.tenantId, tenantId))
    .orderBy(asc(utilisationTargets.scope), desc(utilisationTargets.effectiveFrom));
  return rows.map((row) => ({ ...row, scope: row.scope as TargetScope }));
}

/**
 * Utilisation for everyone, for one month.
 *
 * Leave is counted only where it fell on a day the person was scheduled to work
 * — the attendance register writes a leave row for every calendar day in a
 * range, including the weekend, and those days were never available to sell.
 */
export async function listFirmUtilisation(
  database: DashboardDatabase,
  tenantId: string,
  periodKey: string,
): Promise<FirmUtilisation> {
  const start = `${periodKey}-01`;
  const end = monthEnd(periodKey);

  const [members, policyRows, holidays, leaveRows, timeRows, targets] = await Promise.all([
    database.select({
      employmentEndDate: employeeProfiles.employmentEndDate,
      fullName: users.fullName,
      joiningDate: employeeProfiles.joiningDate,
      roleKey: tenantMemberships.roleKey,
      userId: employeeProfiles.userId,
    }).from(employeeProfiles)
      .innerJoin(users, eq(users.id, employeeProfiles.userId))
      .innerJoin(tenantMemberships, and(
        eq(tenantMemberships.tenantId, employeeProfiles.tenantId),
        eq(tenantMemberships.userId, employeeProfiles.userId),
      ))
      .where(and(eq(employeeProfiles.tenantId, tenantId), eq(tenantMemberships.status, "active")))
      .orderBy(asc(users.fullName)),
    database.select({
      fullDayMinutes: attendancePolicies.fullDayMinutes,
      jurisdictionState: attendancePolicies.jurisdictionState,
      workingWeekMask: attendancePolicies.workingWeekMask,
    }).from(attendancePolicies).where(and(
      eq(attendancePolicies.tenantId, tenantId),
      lte(attendancePolicies.effectiveFrom, end),
    )).orderBy(desc(attendancePolicies.effectiveFrom)).limit(1),
    database.select({ holidayDate: holidayCalendar.holidayDate }).from(holidayCalendar).where(and(
      eq(holidayCalendar.tenantId, tenantId),
      eq(holidayCalendar.status, "active"),
      eq(holidayCalendar.holidayType, "public"),
      gte(holidayCalendar.holidayDate, start),
      lte(holidayCalendar.holidayDate, end),
    )),
    database.select({
      attendanceDate: attendanceDays.attendanceDate,
      employeeUserId: attendanceDays.employeeUserId,
      halfDays: sql<number>`(${attendanceDays.paidHalfDays} + ${attendanceDays.lopHalfDays})`.mapWith(Number),
    }).from(attendanceDays).where(and(
      eq(attendanceDays.tenantId, tenantId),
      eq(attendanceDays.status, "leave"),
      gte(attendanceDays.attendanceDate, start),
      lte(attendanceDays.attendanceDate, end),
    )),
    database.select({
      billable: timeEntries.billable,
      employeeUserId: timeEntries.employeeUserId,
      minutes: timeEntries.minutes,
    }).from(timeEntries).where(and(
      eq(timeEntries.tenantId, tenantId),
      gte(timeEntries.entryDate, start),
      lte(timeEntries.entryDate, end),
    )),
    listUtilisationTargets(database, tenantId),
  ]);

  const policy = policyRows[0] ?? { fullDayMinutes: 450, jurisdictionState: "", workingWeekMask: "1111110" };
  const holidayKeys = holidays.map((row) => row.holidayDate);

  const recorded = new Map<string, { chargeable: number; total: number }>();
  for (const row of timeRows) {
    const current = recorded.get(row.employeeUserId) ?? { chargeable: 0, total: 0 };
    current.total += row.minutes;
    if (row.billable) current.chargeable += row.minutes;
    recorded.set(row.employeeUserId, current);
  }

  const people = members.map((member) => {
    const scheduled = eligibleWorkingDateKeys(
      periodKey, policy.workingWeekMask, member.joiningDate, member.employmentEndDate, holidayKeys,
    );
    const scheduledSet = new Set(scheduled);
    const leaveHalfDays = leaveRows
      .filter((row) => row.employeeUserId === member.userId && scheduledSet.has(row.attendanceDate))
      .reduce((total, row) => total + row.halfDays, 0);
    const effort = recorded.get(member.userId) ?? { chargeable: 0, total: 0 };

    return computeUtilisation({
      availability: { fullDayMinutes: policy.fullDayMinutes, leaveHalfDays, scheduledDays: scheduled.length },
      chargeableMinutes: effort.chargeable,
      employeeUserId: member.userId,
      fullName: member.fullName,
      recordedMinutes: effort.total,
      roleKey: member.roleKey,
    }, targets, end);
  });

  return summariseFirm(people);
}

export type UtilisationTargetInput = {
  effectiveFrom: string;
  employeeUserId: string | null;
  note: string;
  roleKey: string | null;
  scope: TargetScope;
  targetBasisPoints: number;
};

export async function saveUtilisationTarget(
  database: DashboardDatabase,
  tenantId: string,
  actorUserId: string,
  input: UtilisationTargetInput,
) {
  if (!Number.isInteger(input.targetBasisPoints) || input.targetBasisPoints < 0 || input.targetBasisPoints > 10_000) {
    throw new UtilisationError("invalid_target");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.effectiveFrom)) throw new UtilisationError("invalid_date");
  const isRole = input.scope === "role";
  if (isRole ? !input.roleKey : !input.employeeUserId) throw new UtilisationError("invalid_scope");

  return database.transaction(async (transaction) => {
    if (!isRole) {
      const [member] = await transaction.select({ userId: employeeProfiles.userId }).from(employeeProfiles)
        .where(and(eq(employeeProfiles.tenantId, tenantId), eq(employeeProfiles.userId, input.employeeUserId!))).limit(1);
      if (!member) throw new UtilisationError("not_found");
    }

    // Two partial unique keys means two upsert targets; the scope decides which.
    const values = {
      tenantId,
      scope: input.scope,
      roleKey: isRole ? input.roleKey : null,
      employeeUserId: isRole ? null : input.employeeUserId,
      targetBasisPoints: input.targetBasisPoints,
      effectiveFrom: input.effectiveFrom,
      note: input.note.slice(0, 300),
      createdByUserId: actorUserId,
    };
    const set = { targetBasisPoints: input.targetBasisPoints, note: input.note.slice(0, 300), createdByUserId: actorUserId, updatedAt: new Date() };

    const [saved] = isRole
      ? await transaction.insert(utilisationTargets).values(values).onConflictDoUpdate({
        target: [utilisationTargets.tenantId, utilisationTargets.roleKey, utilisationTargets.effectiveFrom],
        targetWhere: sql`${utilisationTargets.scope} = 'role'`,
        set,
      }).returning({ id: utilisationTargets.id })
      : await transaction.insert(utilisationTargets).values(values).onConflictDoUpdate({
        target: [utilisationTargets.tenantId, utilisationTargets.employeeUserId, utilisationTargets.effectiveFrom],
        targetWhere: sql`${utilisationTargets.scope} = 'employee'`,
        set,
      }).returning({ id: utilisationTargets.id });

    await transaction.insert(auditEvents).values({
      tenantId, actorUserId, resourceType: "utilisation_target", resourceId: saved!.id,
      action: "utilisation.target_set",
      reason: `${isRole ? input.roleKey : "employee"}: ${input.targetBasisPoints} bps from ${input.effectiveFrom}`,
    });
    return saved!.id;
  });
}

export async function removeUtilisationTarget(
  database: DashboardDatabase,
  tenantId: string,
  actorUserId: string,
  targetId: string,
) {
  await database.transaction(async (transaction) => {
    const [removed] = await transaction.delete(utilisationTargets)
      .where(and(eq(utilisationTargets.tenantId, tenantId), eq(utilisationTargets.id, targetId)))
      .returning({ id: utilisationTargets.id });
    if (!removed) throw new UtilisationError("not_found");
    await transaction.insert(auditEvents).values({
      tenantId, actorUserId, resourceType: "utilisation_target", resourceId: removed.id,
      action: "utilisation.target_removed", reason: "Withdrawn",
    });
  });
}

export const listTargetSubjects = async (database: DashboardDatabase, tenantId: string, userIds: readonly string[]) =>
  userIds.length === 0 ? [] : database.select({ fullName: users.fullName, id: users.id }).from(users)
    .where(inArray(users.id, [...userIds]));
