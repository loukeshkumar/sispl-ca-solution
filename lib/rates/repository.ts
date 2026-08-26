import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";

import {
  attendancePolicies,
  auditEvents,
  clientRateOverrides,
  employeeProfiles,
  employeeRates,
  holidayCalendar,
  legalEntities,
  salaryStructureLines,
  salaryStructures,
  tenantMemberships,
  users,
} from "../../db/schema";
import { eligibleWorkingDateKeys } from "../attendance/calculations";
import type { DashboardDatabase } from "../dashboard/postgres/repository";
import {
  buildRateBook,
  costPerHourFromPayroll,
  rateInForce,
  type ClientRateOverrideRow,
  type EmployeeRateRow,
  type PayrollCostLookup,
  type RateBook,
} from "./valuation";

/**
 * Loading the rate book and deriving cost from payroll.
 *
 * Rates are few — a handful of people times a handful of revisions — so the
 * whole book is read once and applied in memory rather than joined per entry.
 * That keeps the resolution rules in one pure, tested place instead of spread
 * across correlated subqueries.
 */

export class RateError extends Error {
  constructor(public readonly code: "not_found" | "invalid_amount" | "invalid_date") {
    super({
      not_found: "That employee or client is not part of this firm.",
      invalid_amount: "Enter an hourly rate between ₹0 and ₹10,00,000.",
      invalid_date: "Enter a valid date for the rate to take effect.",
    }[code]);
    this.name = "RateError";
  }
}

const MAX_PAISE_PER_HOUR = 100_000_000;

export async function loadRateBook(database: DashboardDatabase, tenantId: string): Promise<RateBook> {
  const [rates, overrides] = await Promise.all([
    database.select({
      chargePaisePerHour: employeeRates.chargePaisePerHour,
      costPaisePerHour: employeeRates.costPaisePerHour,
      effectiveFrom: employeeRates.effectiveFrom,
      employeeUserId: employeeRates.employeeUserId,
    }).from(employeeRates).where(eq(employeeRates.tenantId, tenantId)),
    database.select({
      chargePaisePerHour: clientRateOverrides.chargePaisePerHour,
      effectiveFrom: clientRateOverrides.effectiveFrom,
      employeeUserId: clientRateOverrides.employeeUserId,
      legalEntityId: clientRateOverrides.legalEntityId,
    }).from(clientRateOverrides).where(eq(clientRateOverrides.tenantId, tenantId)),
  ]);
  return buildRateBook(rates as EmployeeRateRow[], overrides as ClientRateOverrideRow[]);
}

/**
 * Cost per hour, month by month, from the salary structure in force.
 *
 * Earnings plus employer contributions is what the person actually costs; the
 * deductions come out of their pay, not the firm's pocket. Divided by the hours
 * the firm scheduled them for, which is why a short month does not make anybody
 * look cheap.
 */
export async function buildPayrollCostLookup(
  database: DashboardDatabase,
  tenantId: string,
  periodKeys: readonly string[],
): Promise<PayrollCostLookup> {
  const months = [...new Set(periodKeys)].sort();
  if (months.length === 0) return () => null;

  const [structures, profiles, policy, holidays] = await Promise.all([
    database.select({
      effectiveFrom: salaryStructures.effectiveFrom,
      employeeUserId: salaryStructures.employeeUserId,
      monthlyCostPaise: sql<number>`coalesce(sum(${salaryStructureLines.monthlyAmountPaise}) filter (where ${salaryStructureLines.kind} in ('earning', 'employer_contribution')), 0)`.mapWith(Number),
    }).from(salaryStructures)
      .leftJoin(salaryStructureLines, and(
        eq(salaryStructureLines.tenantId, salaryStructures.tenantId),
        eq(salaryStructureLines.salaryStructureId, salaryStructures.id),
      ))
      .where(eq(salaryStructures.tenantId, tenantId))
      .groupBy(salaryStructures.employeeUserId, salaryStructures.effectiveFrom),
    database.select({
      employmentEndDate: employeeProfiles.employmentEndDate,
      joiningDate: employeeProfiles.joiningDate,
      userId: employeeProfiles.userId,
    }).from(employeeProfiles).where(eq(employeeProfiles.tenantId, tenantId)),
    database.select({
      fullDayMinutes: attendancePolicies.fullDayMinutes,
      jurisdictionState: attendancePolicies.jurisdictionState,
      workingWeekMask: attendancePolicies.workingWeekMask,
    }).from(attendancePolicies).where(eq(attendancePolicies.tenantId, tenantId))
      .orderBy(desc(attendancePolicies.effectiveFrom)).limit(1),
    database.select({
      holidayDate: holidayCalendar.holidayDate,
    }).from(holidayCalendar).where(and(
      eq(holidayCalendar.tenantId, tenantId),
      eq(holidayCalendar.status, "active"),
      eq(holidayCalendar.holidayType, "public"),
      gte(holidayCalendar.holidayDate, `${months[0]}-01`),
      lte(holidayCalendar.holidayDate, `${months[months.length - 1]}-31`),
    )),
  ]);

  const shift = policy[0] ?? { fullDayMinutes: 450, jurisdictionState: "", workingWeekMask: "1111110" };
  const holidayKeys = holidays.map((row) => row.holidayDate);
  const profileById = new Map(profiles.map((row) => [row.userId, row]));
  const byEmployee = new Map<string, Array<{ effectiveFrom: string; monthlyCostPaise: number }>>();
  for (const row of structures) {
    const existing = byEmployee.get(row.employeeUserId) ?? [];
    existing.push({ effectiveFrom: row.effectiveFrom, monthlyCostPaise: row.monthlyCostPaise });
    byEmployee.set(row.employeeUserId, existing);
  }

  const cache = new Map<string, number | null>();
  return (employeeUserId: string, periodKey: string) => {
    const key = `${employeeUserId}:${periodKey}`;
    if (cache.has(key)) return cache.get(key)!;
    const profile = profileById.get(employeeUserId);
    const structure = rateInForce(byEmployee.get(employeeUserId) ?? [], `${periodKey}-28`);
    if (!profile || !structure) {
      cache.set(key, null);
      return null;
    }
    const scheduledDays = eligibleWorkingDateKeys(
      periodKey, shift.workingWeekMask, profile.joiningDate, profile.employmentEndDate, holidayKeys,
    ).length;
    const value = costPerHourFromPayroll(structure.monthlyCostPaise, scheduledDays * shift.fullDayMinutes);
    cache.set(key, value);
    return value;
  };
}

export type RateCardRow = {
  chargePaisePerHour: number | null;
  /** Where cost comes from for this person right now, so the card can say so. */
  costBasis: "payroll" | "rate_card" | "none";
  costPaisePerHour: number | null;
  designation: string;
  effectiveFrom: string | null;
  employeeUserId: string;
  fullName: string;
  overrideCount: number;
};

export type ClientOverrideRow = {
  chargePaisePerHour: number;
  clientName: string;
  effectiveFrom: string;
  employeeName: string;
  employeeUserId: string;
  id: string;
  legalEntityId: string;
  note: string;
};

export type RateCard = {
  clients: Array<{ id: string; name: string }>;
  overrides: ClientOverrideRow[];
  rows: RateCardRow[];
  todayKey: string;
};

export async function listRateCard(
  database: DashboardDatabase,
  tenantId: string,
  todayKey: string,
): Promise<RateCard> {
  const [members, rates, overrides, clients] = await Promise.all([
    database.select({
      designation: employeeProfiles.designation,
      fullName: users.fullName,
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
      chargePaisePerHour: employeeRates.chargePaisePerHour,
      costPaisePerHour: employeeRates.costPaisePerHour,
      effectiveFrom: employeeRates.effectiveFrom,
      employeeUserId: employeeRates.employeeUserId,
    }).from(employeeRates).where(eq(employeeRates.tenantId, tenantId)),
    database.select({
      chargePaisePerHour: clientRateOverrides.chargePaisePerHour,
      clientName: legalEntities.displayName,
      effectiveFrom: clientRateOverrides.effectiveFrom,
      employeeName: users.fullName,
      employeeUserId: clientRateOverrides.employeeUserId,
      id: clientRateOverrides.id,
      legalEntityId: clientRateOverrides.legalEntityId,
      note: clientRateOverrides.note,
    }).from(clientRateOverrides)
      .innerJoin(legalEntities, and(
        eq(legalEntities.tenantId, clientRateOverrides.tenantId),
        eq(legalEntities.id, clientRateOverrides.legalEntityId),
      ))
      .innerJoin(users, eq(users.id, clientRateOverrides.employeeUserId))
      .where(eq(clientRateOverrides.tenantId, tenantId))
      .orderBy(asc(legalEntities.displayName), asc(users.fullName), desc(clientRateOverrides.effectiveFrom)),
    database.select({ id: legalEntities.id, name: legalEntities.displayName }).from(legalEntities)
      .where(and(eq(legalEntities.tenantId, tenantId), eq(legalEntities.status, "active")))
      .orderBy(asc(legalEntities.displayName)),
  ]);

  const payrollCost = await buildPayrollCostLookup(database, tenantId, [todayKey.slice(0, 7)]);
  const byEmployee = new Map<string, typeof rates>();
  for (const row of rates) {
    const existing = byEmployee.get(row.employeeUserId) ?? [];
    existing.push(row);
    byEmployee.set(row.employeeUserId, existing);
  }
  const overrideCounts = new Map<string, number>();
  for (const row of overrides) {
    overrideCounts.set(row.employeeUserId, (overrideCounts.get(row.employeeUserId) ?? 0) + 1);
  }

  const rows: RateCardRow[] = members.map((member) => {
    const current = rateInForce(byEmployee.get(member.userId) ?? [], todayKey);
    const derived = payrollCost(member.userId, todayKey.slice(0, 7));
    const costPaisePerHour = derived ?? current?.costPaisePerHour ?? null;
    return {
      chargePaisePerHour: current?.chargePaisePerHour ?? null,
      costBasis: derived !== null ? "payroll" : current?.costPaisePerHour != null ? "rate_card" : "none",
      costPaisePerHour,
      designation: member.designation,
      effectiveFrom: current?.effectiveFrom ?? null,
      employeeUserId: member.userId,
      fullName: member.fullName,
      overrideCount: overrideCounts.get(member.userId) ?? 0,
    };
  });

  return { clients, overrides, rows, todayKey };
}

export type EmployeeRateInput = {
  chargePaisePerHour: number;
  costPaisePerHour: number | null;
  effectiveFrom: string;
  employeeUserId: string;
  note: string;
};

const assertAmount = (value: number | null) => {
  if (value === null) return;
  if (!Number.isInteger(value) || value < 0 || value > MAX_PAISE_PER_HOUR) throw new RateError("invalid_amount");
};

export async function saveEmployeeRate(
  database: DashboardDatabase,
  tenantId: string,
  actorUserId: string,
  input: EmployeeRateInput,
) {
  assertAmount(input.chargePaisePerHour);
  assertAmount(input.costPaisePerHour);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.effectiveFrom)) throw new RateError("invalid_date");

  return database.transaction(async (transaction) => {
    const [member] = await transaction.select({ userId: employeeProfiles.userId }).from(employeeProfiles)
      .where(and(eq(employeeProfiles.tenantId, tenantId), eq(employeeProfiles.userId, input.employeeUserId))).limit(1);
    if (!member) throw new RateError("not_found");

    const [saved] = await transaction.insert(employeeRates).values({
      tenantId,
      employeeUserId: input.employeeUserId,
      effectiveFrom: input.effectiveFrom,
      chargePaisePerHour: input.chargePaisePerHour,
      costPaisePerHour: input.costPaisePerHour,
      note: input.note.slice(0, 300),
      createdByUserId: actorUserId,
    }).onConflictDoUpdate({
      target: [employeeRates.tenantId, employeeRates.employeeUserId, employeeRates.effectiveFrom],
      set: {
        chargePaisePerHour: input.chargePaisePerHour,
        costPaisePerHour: input.costPaisePerHour,
        note: input.note.slice(0, 300),
        createdByUserId: actorUserId,
        updatedAt: new Date(),
      },
    }).returning({ id: employeeRates.id });

    await transaction.insert(auditEvents).values({
      tenantId, actorUserId, resourceType: "employee_rate", resourceId: saved!.id,
      action: "rate.set", reason: `${input.chargePaisePerHour} paise/hour from ${input.effectiveFrom}`,
    });
    return saved!.id;
  });
}

export type ClientRateInput = EmployeeRateInput & { legalEntityId: string };

export async function saveClientRateOverride(
  database: DashboardDatabase,
  tenantId: string,
  actorUserId: string,
  input: Omit<ClientRateInput, "costPaisePerHour">,
) {
  assertAmount(input.chargePaisePerHour);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.effectiveFrom)) throw new RateError("invalid_date");

  return database.transaction(async (transaction) => {
    const [client] = await transaction.select({ id: legalEntities.id }).from(legalEntities)
      .where(and(eq(legalEntities.tenantId, tenantId), eq(legalEntities.id, input.legalEntityId))).limit(1);
    const [member] = await transaction.select({ userId: employeeProfiles.userId }).from(employeeProfiles)
      .where(and(eq(employeeProfiles.tenantId, tenantId), eq(employeeProfiles.userId, input.employeeUserId))).limit(1);
    if (!client || !member) throw new RateError("not_found");

    const [saved] = await transaction.insert(clientRateOverrides).values({
      tenantId,
      legalEntityId: input.legalEntityId,
      employeeUserId: input.employeeUserId,
      effectiveFrom: input.effectiveFrom,
      chargePaisePerHour: input.chargePaisePerHour,
      note: input.note.slice(0, 300),
      createdByUserId: actorUserId,
    }).onConflictDoUpdate({
      target: [clientRateOverrides.tenantId, clientRateOverrides.legalEntityId, clientRateOverrides.employeeUserId, clientRateOverrides.effectiveFrom],
      set: {
        chargePaisePerHour: input.chargePaisePerHour,
        note: input.note.slice(0, 300),
        createdByUserId: actorUserId,
        updatedAt: new Date(),
      },
    }).returning({ id: clientRateOverrides.id });

    await transaction.insert(auditEvents).values({
      tenantId, actorUserId, resourceType: "client_rate_override", resourceId: saved!.id,
      action: "rate.override_set", reason: `${input.chargePaisePerHour} paise/hour from ${input.effectiveFrom}`,
    });
    return saved!.id;
  });
}

export async function removeClientRateOverride(
  database: DashboardDatabase,
  tenantId: string,
  actorUserId: string,
  overrideId: string,
) {
  await database.transaction(async (transaction) => {
    const [removed] = await transaction.delete(clientRateOverrides)
      .where(and(eq(clientRateOverrides.tenantId, tenantId), eq(clientRateOverrides.id, overrideId)))
      .returning({ id: clientRateOverrides.id });
    if (!removed) throw new RateError("not_found");
    await transaction.insert(auditEvents).values({
      tenantId, actorUserId, resourceType: "client_rate_override", resourceId: removed.id,
      action: "rate.override_removed", reason: "Withdrawn from the rate card",
    });
  });
}

/** History behind one person's current rate, newest first. */
export async function listRateHistory(database: DashboardDatabase, tenantId: string, employeeUserId: string) {
  return database.select({
    chargePaisePerHour: employeeRates.chargePaisePerHour,
    costPaisePerHour: employeeRates.costPaisePerHour,
    effectiveFrom: employeeRates.effectiveFrom,
    id: employeeRates.id,
    note: employeeRates.note,
  }).from(employeeRates)
    .where(and(eq(employeeRates.tenantId, tenantId), eq(employeeRates.employeeUserId, employeeUserId)))
    .orderBy(desc(employeeRates.effectiveFrom));
}

export const listRateSubjects = async (database: DashboardDatabase, tenantId: string, userIds: readonly string[]) =>
  userIds.length === 0 ? [] : database.select({ fullName: users.fullName, id: users.id }).from(users)
    .where(inArray(users.id, [...userIds]));
