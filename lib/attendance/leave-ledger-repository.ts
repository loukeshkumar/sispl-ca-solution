import { and, asc, eq, inArray, sql } from "drizzle-orm";

import { auditEvents, employeeProfiles, leaveLedgerEntries, leaveTypes } from "../../db/schema";
import type { DashboardDatabase } from "../dashboard/postgres/repository";
import { listHolidayDateKeysInRange } from "../attendance-masters/repository";
import { eligibleWorkingDatesInRange } from "./calculations";
import {
  accrualPostings,
  assessQuota,
  cappedLapse,
  carryForwardPostings,
  HALF_DAYS_PER_DAY,
  leaveYearBounds,
  leaveYearKey,
  leaveYearsInRange,
  previousLeaveYear,
  type AccrualMethod,
  type LeaveEntryType,
  type LeaveLedgerPosting,
  type LeaveTypePolicy,
  type QuotaAssessment,
  type ServiceDates,
} from "./leave-ledger";

/**
 * Reading and writing the leave entitlement ledger.
 *
 * Grants are materialised lazily: any read of a balance first makes sure the
 * accruals that should already exist do exist. A firm that never runs the
 * nightly job therefore still sees correct balances, and the job's only real
 * purpose is to keep the ledger complete for people who are not being looked at.
 * Every automatic posting carries a `dedupeKey`, so doing this twice is a
 * no-op rather than a double credit.
 */

/** Walking back further than this to rebuild history costs more than it tells us. */
const MAX_BACKFILL_YEARS = 5;

export type LeaveLedgerRow = {
  createdAt: string;
  effectiveDate: string;
  entryType: LeaveEntryType;
  halfDays: number;
  id: string;
  leaveYear: string;
  reason: string;
};

export type LeaveBalance = {
  accruedHalfDays: number;
  balanceHalfDays: number;
  carriedHalfDays: number;
  code: string;
  /**
   * True when nothing accrues automatically — the type is sanctioned per
   * occasion, so an untouched balance of zero means "not granted yet" rather
   * than "used up", and the two must not read the same.
   */
  grantedOnRequest: boolean;
  leaveYear: string;
  name: string;
  takenHalfDays: number;
  /** True when the firm caps this type. A quota of zero is "no limit", not "no days". */
  capped: boolean;
};

type LeaveTypeRecord = LeaveTypePolicy & { name: string; status: string };

const toPolicy = (row: {
  accrualMethod: string; annualQuotaDays: number; carryForwardCap: number;
  carryForwardExpiryMonths: number | null; code: string; encashableOnExit: boolean; name: string; status: string;
}): LeaveTypeRecord => ({
  accrualMethod: row.accrualMethod as AccrualMethod,
  annualQuotaDays: row.annualQuotaDays,
  carryForwardCap: row.carryForwardCap,
  carryForwardExpiryMonths: row.carryForwardExpiryMonths,
  code: row.code,
  encashableOnExit: row.encashableOnExit,
  name: row.name,
  status: row.status,
});

const leaveTypeSelection = {
  accrualMethod: leaveTypes.accrualMethod,
  annualQuotaDays: leaveTypes.annualQuotaDays,
  carryForwardCap: leaveTypes.carryForwardCap,
  carryForwardExpiryMonths: leaveTypes.carryForwardExpiryMonths,
  code: leaveTypes.code,
  encashableOnExit: leaveTypes.encashableOnExit,
  name: leaveTypes.name,
  status: leaveTypes.status,
};

export async function findLeaveTypePolicy(database: DashboardDatabase, tenantId: string, code: string): Promise<LeaveTypeRecord | null> {
  const [row] = await database.select(leaveTypeSelection).from(leaveTypes)
    .where(and(eq(leaveTypes.tenantId, tenantId), eq(leaveTypes.code, code))).limit(1);
  return row ? toPolicy(row) : null;
}

export async function listLeaveTypePolicies(database: DashboardDatabase, tenantId: string): Promise<LeaveTypeRecord[]> {
  const rows = await database.select(leaveTypeSelection).from(leaveTypes)
    .where(and(eq(leaveTypes.tenantId, tenantId), eq(leaveTypes.status, "active")))
    .orderBy(asc(leaveTypes.displayOrder), asc(leaveTypes.name));
  return rows.map(toPolicy);
}

export async function findServiceDates(database: DashboardDatabase, tenantId: string, employeeUserId: string): Promise<ServiceDates | null> {
  const [row] = await database.select({
    employmentEndDate: employeeProfiles.employmentEndDate, joiningDate: employeeProfiles.joiningDate,
  }).from(employeeProfiles)
    .where(and(eq(employeeProfiles.tenantId, tenantId), eq(employeeProfiles.userId, employeeUserId))).limit(1);
  return row ? { employmentEndDate: row.employmentEndDate, joiningDate: row.joiningDate } : null;
}

async function sumHalfDays(
  database: DashboardDatabase,
  tenantId: string,
  employeeUserId: string,
  code: string,
  leaveYear: string,
) {
  const [row] = await database.select({ total: sql<number>`coalesce(sum(${leaveLedgerEntries.halfDays}), 0)::int` })
    .from(leaveLedgerEntries).where(and(
      eq(leaveLedgerEntries.tenantId, tenantId),
      eq(leaveLedgerEntries.employeeUserId, employeeUserId),
      eq(leaveLedgerEntries.leaveTypeCode, code),
      eq(leaveLedgerEntries.leaveYear, leaveYear),
    ));
  return row?.total ?? 0;
}

async function insertPostings(
  database: DashboardDatabase,
  tenantId: string,
  employeeUserId: string,
  code: string,
  postings: LeaveLedgerPosting[],
) {
  if (postings.length === 0) return;
  await database.insert(leaveLedgerEntries).values(postings.map((posting) => ({
    tenantId,
    employeeUserId,
    leaveTypeCode: code,
    leaveYear: posting.leaveYear,
    entryType: posting.entryType,
    halfDays: posting.halfDays,
    effectiveDate: posting.effectiveDate,
    sourceType: "accrual_job" as const,
    reason: posting.reason,
    dedupeKey: posting.dedupeKey,
  }))).onConflictDoNothing();
}

/**
 * Make sure every grant that should exist for this employee and leave type up to
 * `leaveYear` has been posted.
 *
 * Years are walked forward from the joining year, because a year's carry-forward
 * cannot be computed until the year before it has been credited and spent.
 */
export async function ensureEntitlementPostings(
  database: DashboardDatabase,
  tenantId: string,
  employeeUserId: string,
  policy: LeaveTypePolicy,
  leaveYear: string,
  service: ServiceDates,
  todayKey: string,
) {
  const targetStart = Number(leaveYear.slice(0, 4));
  const joiningStart = Number(leaveYearKey(service.joiningDate).slice(0, 4));
  const firstStart = Math.max(joiningStart, targetStart - MAX_BACKFILL_YEARS);
  if (targetStart < joiningStart) return;

  for (let startYear = firstStart; startYear <= targetStart; startYear += 1) {
    const year = `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
    await insertPostings(database, tenantId, employeeUserId, policy.code, accrualPostings({
      leaveYear: year, policy, service, todayKey,
    }));

    if (policy.carryForwardCap > 0 && startYear > joiningStart) {
      const closing = await sumHalfDays(database, tenantId, employeeUserId, policy.code, previousLeaveYear(year));
      const postings = carryForwardPostings({ closingHalfDays: closing, leaveYear: year, policy, todayKey });
      // The credit lands first; the lapse is then sized against what is actually
      // left, so somebody who already spent the carried days is not driven under.
      const credit = postings.filter((posting) => posting.entryType === "carry_forward");
      await insertPostings(database, tenantId, employeeUserId, policy.code, credit);
      const lapse = postings.find((posting) => posting.entryType === "lapse");
      if (lapse) {
        const balance = await sumHalfDays(database, tenantId, employeeUserId, policy.code, year);
        const trimmed = cappedLapse(lapse, balance);
        if (trimmed) await insertPostings(database, tenantId, employeeUserId, policy.code, [trimmed]);
      }
    }
  }
}

export type ConsumptionSlice = { halfDays: number; leaveYear: string };

/**
 * What a leave request actually costs the employee's entitlement.
 *
 * Only working days count. A Friday-to-Monday leave spends two days, not four:
 * the weekend is not the firm's to charge for, and the period summary already
 * ignores leave written on a non-working day when it settles pay.
 */
export async function consumptionForRequest(
  database: DashboardDatabase,
  tenantId: string,
  service: ServiceDates,
  input: { dateFrom: string; dateTo: string; dayPortion: "full" | "first_half" | "second_half" },
  workingWeekMask: string,
  jurisdictionState?: string,
): Promise<ConsumptionSlice[]> {
  const holidays = await listHolidayDateKeysInRange(database, tenantId, input.dateFrom, input.dateTo, jurisdictionState);
  const dates = eligibleWorkingDatesInRange(
    input.dateFrom, input.dateTo, workingWeekMask, service.joiningDate, service.employmentEndDate, holidays,
  );
  const perDay = input.dayPortion === "full" ? HALF_DAYS_PER_DAY : 1;
  const byYear = new Map<string, number>();
  for (const dateKey of dates) {
    const year = leaveYearKey(dateKey);
    byYear.set(year, (byYear.get(year) ?? 0) + perDay);
  }
  return [...byYear.entries()].map(([leaveYear, halfDays]) => ({ halfDays, leaveYear })).sort(
    (left, right) => left.leaveYear.localeCompare(right.leaveYear),
  );
}

export type QuotaCheck = QuotaAssessment & { leaveTypeName: string };

/**
 * Whether the employee has the entitlement for this request.
 *
 * Unpaid leave is never checked — it consumes no entitlement by definition, and
 * refusing it would leave someone who has run out with nowhere to go.
 */
export async function checkLeaveQuota(
  database: DashboardDatabase,
  tenantId: string,
  employeeUserId: string,
  input: { dateFrom: string; dateTo: string; dayPortion: "full" | "first_half" | "second_half"; leaveType: string; paidClassification: "paid" | "unpaid" },
  workingWeekMask: string,
  todayKey: string,
  jurisdictionState?: string,
): Promise<QuotaCheck | null> {
  if (input.paidClassification === "unpaid") return null;
  const policy = await findLeaveTypePolicy(database, tenantId, input.leaveType);
  if (!policy) return null;
  const service = await findServiceDates(database, tenantId, employeeUserId);
  if (!service) return null;

  const consumption = await consumptionForRequest(database, tenantId, service, input, workingWeekMask, jurisdictionState);
  if (consumption.length === 0) {
    return {
      balanceHalfDays: 0, byLeaveYear: [], exceedsByHalfDays: 0, leaveTypeName: policy.name,
      requestedHalfDays: 0, uncapped: policy.annualQuotaDays <= 0, withinBalance: true,
    };
  }

  const balances: Array<{ halfDays: number; leaveYear: string }> = [];
  for (const slice of consumption) {
    await ensureEntitlementPostings(database, tenantId, employeeUserId, policy, slice.leaveYear, service, todayKey);
    balances.push({ halfDays: await sumHalfDays(database, tenantId, employeeUserId, policy.code, slice.leaveYear), leaveYear: slice.leaveYear });
  }
  return { ...assessQuota({ balances, consumption, policy }), leaveTypeName: policy.name };
}

/** Posts what an approved request spends. Idempotent, so a retry cannot double-charge. */
export async function postLeaveConsumption(
  database: DashboardDatabase,
  tenantId: string,
  employeeUserId: string,
  request: { dateFrom: string; id: string; leaveType: string; paidClassification: string },
  consumption: ConsumptionSlice[],
) {
  const slices = consumption.filter((slice) => slice.halfDays > 0);
  if (request.paidClassification !== "paid" || slices.length === 0) return;
  await database.insert(leaveLedgerEntries).values(slices.map((slice) => ({
    tenantId,
    employeeUserId,
    leaveTypeCode: request.leaveType,
    leaveYear: slice.leaveYear,
    entryType: "consumption" as const,
    halfDays: -slice.halfDays,
    effectiveDate: slice.leaveYear === leaveYearKey(request.dateFrom) ? request.dateFrom : leaveYearBounds(slice.leaveYear).from,
    sourceType: "leave_request" as const,
    sourceId: request.id,
    reason: "Leave approved",
    dedupeKey: `consumption:${request.id}:${slice.leaveYear}`,
  }))).onConflictDoNothing();
}

/**
 * A hand-made posting: a correction, a sanctioned grant outside the accrual
 * rules, or a reversal. Requires a reason and an actor at the database level,
 * because a ledger entry nobody owns cannot be questioned later.
 */
export async function postLeaveAdjustment(
  database: DashboardDatabase,
  tenantId: string,
  actorUserId: string,
  input: {
    days: number;
    employeeUserId: string;
    entryType: Extract<LeaveEntryType, "adjustment" | "reversal">;
    leaveType: string;
    leaveYear: string;
    reason: string;
  },
) {
  const halfDays = Math.round(input.days * HALF_DAYS_PER_DAY);
  if (halfDays === 0) throw new Error("An adjustment of zero days records nothing.");
  const id = await database.transaction(async (transaction) => {
    const [inserted] = await transaction.insert(leaveLedgerEntries).values({
      tenantId,
      employeeUserId: input.employeeUserId,
      leaveTypeCode: input.leaveType,
      leaveYear: input.leaveYear,
      entryType: input.entryType,
      halfDays,
      effectiveDate: leaveYearBounds(input.leaveYear).from,
      sourceType: "manual" as const,
      reason: input.reason,
      actorUserId,
    }).returning({ id: leaveLedgerEntries.id });
    await transaction.insert(auditEvents).values({
      tenantId, actorUserId, resourceType: "leave_ledger_entry", resourceId: inserted!.id,
      action: `leave.${input.entryType}`, reason: input.reason,
    });
    return inserted!.id;
  });
  return id;
}

/**
 * Settle an exiting employee's encashable balances.
 *
 * This closes the ledger, which is the record of entitlement. It deliberately
 * does not create a payroll line — payroll has no leave-encashment component,
 * and inventing one here would put money in a run that nobody approved. The
 * returned figures are what a payroll preparer needs to enter.
 */
export async function postExitEncashment(
  database: DashboardDatabase,
  tenantId: string,
  actorUserId: string,
  employeeUserId: string,
  todayKey: string,
) {
  const service = await findServiceDates(database, tenantId, employeeUserId);
  if (!service) return [];
  const exitDate = service.employmentEndDate ?? todayKey;
  const leaveYear = leaveYearKey(exitDate);
  const policies = (await listLeaveTypePolicies(database, tenantId)).filter((policy) => policy.encashableOnExit);
  const settled: Array<{ code: string; halfDays: number; name: string }> = [];

  for (const policy of policies) {
    await ensureEntitlementPostings(database, tenantId, employeeUserId, policy, leaveYear, service, todayKey);
    const balance = await sumHalfDays(database, tenantId, employeeUserId, policy.code, leaveYear);
    if (balance <= 0) continue;
    const [inserted] = await database.insert(leaveLedgerEntries).values({
      tenantId,
      employeeUserId,
      leaveTypeCode: policy.code,
      leaveYear,
      entryType: "encashment" as const,
      halfDays: -balance,
      effectiveDate: exitDate,
      sourceType: "manual" as const,
      reason: "Encashed on exit",
      actorUserId,
      dedupeKey: `encashment:${policy.code}:${leaveYear}`,
    }).onConflictDoNothing().returning({ id: leaveLedgerEntries.id });
    if (inserted) settled.push({ code: policy.code, halfDays: balance, name: policy.name });
  }

  if (settled.length > 0) {
    await database.insert(auditEvents).values({
      tenantId, actorUserId, resourceType: "employee_profile", resourceId: employeeUserId,
      action: "leave.encashed_on_exit",
      reason: settled.map((entry) => `${entry.name}: ${entry.halfDays / HALF_DAYS_PER_DAY}d`).join(", "),
    });
  }
  return settled;
}

/** Every active leave type's standing for one employee, for the balance panel. */
export async function listLeaveBalances(
  database: DashboardDatabase,
  tenantId: string,
  employeeUserId: string,
  todayKey: string,
): Promise<LeaveBalance[]> {
  const service = await findServiceDates(database, tenantId, employeeUserId);
  if (!service) return [];
  const leaveYear = leaveYearKey(todayKey);
  const policies = await listLeaveTypePolicies(database, tenantId);
  if (policies.length === 0) return [];

  for (const policy of policies) {
    await ensureEntitlementPostings(database, tenantId, employeeUserId, policy, leaveYear, service, todayKey);
  }

  const rows = await database.select({
    code: leaveLedgerEntries.leaveTypeCode,
    entryType: leaveLedgerEntries.entryType,
    total: sql<number>`coalesce(sum(${leaveLedgerEntries.halfDays}), 0)::int`,
  }).from(leaveLedgerEntries).where(and(
    eq(leaveLedgerEntries.tenantId, tenantId),
    eq(leaveLedgerEntries.employeeUserId, employeeUserId),
    eq(leaveLedgerEntries.leaveYear, leaveYear),
    inArray(leaveLedgerEntries.leaveTypeCode, policies.map((policy) => policy.code)),
  )).groupBy(leaveLedgerEntries.leaveTypeCode, leaveLedgerEntries.entryType);

  const bucket = (code: string, types: LeaveEntryType[]) => rows
    .filter((row) => row.code === code && types.includes(row.entryType as LeaveEntryType))
    .reduce((total, row) => total + row.total, 0);

  return policies.map((policy) => ({
    accruedHalfDays: bucket(policy.code, ["opening", "accrual"]),
    balanceHalfDays: rows.filter((row) => row.code === policy.code).reduce((total, row) => total + row.total, 0),
    capped: policy.annualQuotaDays > 0,
    carriedHalfDays: bucket(policy.code, ["carry_forward"]),
    code: policy.code,
    grantedOnRequest: policy.accrualMethod === "none" && policy.annualQuotaDays > 0,
    leaveYear,
    name: policy.name,
    takenHalfDays: -bucket(policy.code, ["consumption"]),
  }));
}

/** The statement behind one balance, newest posting first. */
export async function listLeaveLedger(
  database: DashboardDatabase,
  tenantId: string,
  employeeUserId: string,
  code: string,
  leaveYear: string,
): Promise<LeaveLedgerRow[]> {
  const rows = await database.select({
    createdAt: leaveLedgerEntries.createdAt,
    effectiveDate: leaveLedgerEntries.effectiveDate,
    entryType: leaveLedgerEntries.entryType,
    halfDays: leaveLedgerEntries.halfDays,
    id: leaveLedgerEntries.id,
    leaveYear: leaveLedgerEntries.leaveYear,
    reason: leaveLedgerEntries.reason,
  }).from(leaveLedgerEntries).where(and(
    eq(leaveLedgerEntries.tenantId, tenantId),
    eq(leaveLedgerEntries.employeeUserId, employeeUserId),
    eq(leaveLedgerEntries.leaveTypeCode, code),
    eq(leaveLedgerEntries.leaveYear, leaveYear),
  )).orderBy(asc(leaveLedgerEntries.effectiveDate), asc(leaveLedgerEntries.createdAt));

  return rows.map((row) => ({
    createdAt: row.createdAt.toISOString(),
    effectiveDate: row.effectiveDate,
    entryType: row.entryType as LeaveEntryType,
    halfDays: row.halfDays,
    id: row.id,
    leaveYear: row.leaveYear,
    reason: row.reason,
  }));
}

export { leaveYearKey, leaveYearsInRange };
