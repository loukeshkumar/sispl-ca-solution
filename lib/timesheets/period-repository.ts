import { and, asc, desc, eq, lte, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import {
  auditEvents,
  tenantMemberships,
  timeEntries,
  timesheetPeriods,
  timesheetPolicies,
  users,
} from "../../db/schema";
import type { DashboardDatabase } from "../dashboard/postgres/repository";
import {
  DECIDE_REFUSAL_NOTES,
  DEFAULT_POLICY,
  ENTRY_REFUSAL_NOTES,
  periodKeyOf,
  refuseDecision,
  refuseEntry,
  refuseReopen,
  refuseSubmit,
  REOPEN_REFUSAL_NOTES,
  standingOf,
  SUBMIT_REFUSAL_NOTES,
  type DecideRefusal,
  type EntryRefusal,
  type PeriodStanding,
  type PeriodStatus,
  type ReopenRefusal,
  type SubmitRefusal,
  type TimesheetPolicy,
} from "./governance";

/**
 * Defined here rather than imported from `./repository`, which now imports this
 * module for the entry gate. The codebase already carries this four-line helper
 * per module for the same reason.
 */
export function indiaDateKey(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { day: "2-digit", month: "2-digit", timeZone: "Asia/Kolkata", year: "numeric" }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

/**
 * Months of time, and the policy that governs how they are filled.
 *
 * `guardEntry` is the part everything else exists for: it is called from every
 * path that writes a time entry, and it is the reason an approved month stops
 * moving.
 */

export class TimesheetGovernanceError extends Error {
  constructor(
    public readonly code: EntryRefusal | SubmitRefusal | DecideRefusal | ReopenRefusal | "not_found",
    message?: string,
  ) {
    super(message ?? "That timesheet period was not found.");
    this.name = "TimesheetGovernanceError";
  }
}

const decider = alias(users, "timesheet_decider");
const reopener = alias(users, "timesheet_reopener");

/** The policy in force on a date. The firm's defaults until it says otherwise. */
export async function policyInForce(
  database: DashboardDatabase,
  tenantId: string,
  dateKey = indiaDateKey(),
): Promise<TimesheetPolicy> {
  const [row] = await database.select({
    allowFutureDates: timesheetPolicies.allowFutureDates,
    backdateWindowDays: timesheetPolicies.backdateWindowDays,
    expectedMonthlyMinutes: timesheetPolicies.expectedMonthlyMinutes,
  }).from(timesheetPolicies)
    .where(and(eq(timesheetPolicies.tenantId, tenantId), lte(timesheetPolicies.effectiveFrom, dateKey)))
    .orderBy(desc(timesheetPolicies.effectiveFrom))
    .limit(1);
  return row ?? DEFAULT_POLICY;
}

/** The status of one person's month. Absent rows are open, not missing. */
export async function periodStatusOf(
  database: DashboardDatabase,
  tenantId: string,
  employeeUserId: string,
  periodKey: string,
): Promise<PeriodStatus> {
  const [row] = await database.select({ status: timesheetPeriods.status }).from(timesheetPeriods)
    .where(and(
      eq(timesheetPeriods.tenantId, tenantId),
      eq(timesheetPeriods.employeeUserId, employeeUserId),
      eq(timesheetPeriods.periodKey, periodKey),
    )).limit(1);
  return (row?.status as PeriodStatus) ?? "open";
}

const MANAGING_ROLES = ["firm_administrator", "partner", "manager"];

export async function isManager(database: DashboardDatabase, tenantId: string, userId: string) {
  const [row] = await database.select({ roleKey: tenantMemberships.roleKey }).from(tenantMemberships)
    .where(and(
      eq(tenantMemberships.tenantId, tenantId),
      eq(tenantMemberships.userId, userId),
      eq(tenantMemberships.status, "active"),
    )).limit(1);
  return row ? MANAGING_ROLES.includes(row.roleKey) : false;
}

type Transaction = Parameters<Parameters<DashboardDatabase["transaction"]>[0]>[0];

/**
 * The gate every write to a time entry goes through.
 *
 * Deliberately one function rather than a check repeated at each call site: the
 * whole failure being fixed here is that nothing stood between an entry and the
 * table, and three near-identical checks would drift within a release.
 */
export async function guardEntry(
  transaction: Transaction,
  tenantId: string,
  input: {
    actorUserId: string;
    backdateReason: string;
    employeeUserId: string;
    entryDate: string;
    todayKey?: string;
  },
) {
  const todayKey = input.todayKey ?? indiaDateKey();
  const database = transaction as unknown as DashboardDatabase;
  const [policy, periodStatus, actorIsManager] = await Promise.all([
    policyInForce(database, tenantId, todayKey),
    periodStatusOf(database, tenantId, input.employeeUserId, periodKeyOf(input.entryDate || todayKey)),
    isManager(database, tenantId, input.actorUserId),
  ]);

  const refusal = refuseEntry({
    actorIsManager,
    backdateReason: input.backdateReason,
    entryDate: input.entryDate,
    periodStatus,
    policy,
    todayKey,
  });
  if (refusal) throw new TimesheetGovernanceError(refusal, ENTRY_REFUSAL_NOTES[refusal]);
  return { actorIsManager, policy };
}

/**
 * The gate for changing an entry that already exists.
 *
 * Only the period status, deliberately. The back-dating window governs how late
 * a person may *record* time they did; it has nothing to say about correcting an
 * entry already on the record. Applying it here meant a month reopened for
 * correction refused the very correction it was reopened for.
 */
export async function guardExistingEntry(
  transaction: Transaction,
  tenantId: string,
  input: { employeeUserId: string; entryDate: string },
) {
  const status = await periodStatusOf(
    transaction as unknown as DashboardDatabase,
    tenantId,
    input.employeeUserId,
    periodKeyOf(input.entryDate),
  );
  if (status === "approved") throw new TimesheetGovernanceError("period_approved", ENTRY_REFUSAL_NOTES.period_approved);
  if (status === "submitted") throw new TimesheetGovernanceError("period_submitted", ENTRY_REFUSAL_NOTES.period_submitted);
}

export type TimesheetPeriodRow = PeriodStanding & {
  decidedByName: string | null;
  decisionNote: string;
  employeeName: string;
  employeeUserId: string;
  periodKey: string;
  reopenReason: string;
  reopenedByName: string | null;
  submittedAt: string | null;
};

/** One month for one person, with the totals it actually holds now. */
export async function getPeriod(
  database: DashboardDatabase,
  tenantId: string,
  employeeUserId: string,
  periodKey: string,
): Promise<TimesheetPeriodRow> {
  const [[row], [totals], policy, [employee]] = await Promise.all([
    database.select({
      decidedByName: decider.fullName,
      decisionNote: timesheetPeriods.decisionNote,
      reopenReason: timesheetPeriods.reopenReason,
      reopenedByName: reopener.fullName,
      status: timesheetPeriods.status,
      submittedAt: timesheetPeriods.submittedAt,
      submittedMinutes: timesheetPeriods.submittedMinutes,
    }).from(timesheetPeriods)
      .leftJoin(decider, eq(decider.id, timesheetPeriods.decidedByUserId))
      .leftJoin(reopener, eq(reopener.id, timesheetPeriods.reopenedByUserId))
      .where(and(
        eq(timesheetPeriods.tenantId, tenantId),
        eq(timesheetPeriods.employeeUserId, employeeUserId),
        eq(timesheetPeriods.periodKey, periodKey),
      )).limit(1),
    database.select({ minutes: sql<number>`coalesce(sum(${timeEntries.minutes}), 0)::int` })
      .from(timeEntries)
      .where(and(
        eq(timeEntries.tenantId, tenantId),
        eq(timeEntries.employeeUserId, employeeUserId),
        sql`to_char(${timeEntries.entryDate}, 'YYYY-MM') = ${periodKey}`,
      )),
    policyInForce(database, tenantId),
    database.select({ fullName: users.fullName }).from(users).where(eq(users.id, employeeUserId)).limit(1),
  ]);

  return {
    ...standingOf({
      expectedMinutes: policy.expectedMonthlyMinutes,
      loggedMinutes: totals?.minutes ?? 0,
      status: (row?.status as PeriodStatus) ?? "open",
      submittedMinutes: row?.submittedMinutes ?? null,
    }),
    decidedByName: row?.decidedByName ?? null,
    decisionNote: row?.decisionNote ?? "",
    employeeName: employee?.fullName ?? "Unknown",
    employeeUserId,
    periodKey,
    reopenReason: row?.reopenReason ?? "",
    reopenedByName: row?.reopenedByName ?? null,
    submittedAt: row?.submittedAt?.toISOString() ?? null,
  };
}

/** Send a finished month to a reviewer, snapshotting what it totalled. */
export async function submitPeriod(
  database: DashboardDatabase,
  tenantId: string,
  employeeUserId: string,
  periodKey: string,
  todayKey = indiaDateKey(),
) {
  return database.transaction(async (transaction) => {
    const status = await periodStatusOf(transaction as unknown as DashboardDatabase, tenantId, employeeUserId, periodKey);
    const [totals] = await transaction.select({ minutes: sql<number>`coalesce(sum(${timeEntries.minutes}), 0)::int` })
      .from(timeEntries)
      .where(and(
        eq(timeEntries.tenantId, tenantId),
        eq(timeEntries.employeeUserId, employeeUserId),
        sql`to_char(${timeEntries.entryDate}, 'YYYY-MM') = ${periodKey}`,
      ));
    const loggedMinutes = totals?.minutes ?? 0;

    const refusal = refuseSubmit({ loggedMinutes, periodKey, status, todayKey });
    if (refusal) throw new TimesheetGovernanceError(refusal, SUBMIT_REFUSAL_NOTES[refusal]);

    await transaction.insert(timesheetPeriods).values({
      employeeUserId,
      periodKey,
      status: "submitted",
      submittedAt: new Date(),
      submittedMinutes: loggedMinutes,
      tenantId,
    }).onConflictDoUpdate({
      set: {
        decidedAt: null,
        decidedByUserId: null,
        decisionNote: "",
        status: "submitted",
        submittedAt: new Date(),
        submittedMinutes: loggedMinutes,
        updatedAt: new Date(),
      },
      target: [timesheetPeriods.tenantId, timesheetPeriods.employeeUserId, timesheetPeriods.periodKey],
    });

    await transaction.insert(auditEvents).values({
      action: "timesheet.submitted",
      actorUserId: employeeUserId,
      reason: `${periodKey} · ${loggedMinutes} minutes`,
      resourceId: employeeUserId,
      resourceType: "timesheet_period",
      tenantId,
    });
    return loggedMinutes;
  });
}

/**
 * Approve or return a submitted month.
 *
 * Approving freezes the entries. Returning reopens them, which is the whole
 * reason a return carries a note: the person has to know what to change.
 */
export async function decidePeriod(
  database: DashboardDatabase,
  tenantId: string,
  actorUserId: string,
  employeeUserId: string,
  periodKey: string,
  outcome: string,
  note: string,
) {
  return database.transaction(async (transaction) => {
    const status = await periodStatusOf(transaction as unknown as DashboardDatabase, tenantId, employeeUserId, periodKey);
    const refusal = refuseDecision({ actorUserId, employeeUserId, note, outcome, status });
    if (refusal) throw new TimesheetGovernanceError(refusal, DECIDE_REFUSAL_NOTES[refusal]);

    const now = new Date();
    await transaction.update(timesheetPeriods).set(outcome === "approved"
      ? { decidedAt: now, decidedByUserId: actorUserId, decisionNote: note.trim().slice(0, 500), status: "approved", updatedAt: now }
      // A return puts the month back where it was: open, and editable again.
      : { decidedAt: null, decidedByUserId: null, decisionNote: note.trim().slice(0, 500), status: "open", submittedAt: null, submittedMinutes: null, updatedAt: now })
      .where(and(
        eq(timesheetPeriods.tenantId, tenantId),
        eq(timesheetPeriods.employeeUserId, employeeUserId),
        eq(timesheetPeriods.periodKey, periodKey),
      ));

    await transaction.insert(auditEvents).values({
      action: `timesheet.${outcome}`,
      actorUserId,
      reason: `${periodKey}${note.trim() ? ` — ${note.trim().slice(0, 200)}` : ""}`,
      resourceId: employeeUserId,
      resourceType: "timesheet_period",
      tenantId,
    });
  });
}

/**
 * Reopen an approved month.
 *
 * The reason is the whole record of it. A correction that required somebody to
 * lie about the original would be worse than the error it fixed.
 */
export async function reopenPeriod(
  database: DashboardDatabase,
  tenantId: string,
  actorUserId: string,
  employeeUserId: string,
  periodKey: string,
  reason: string,
) {
  return database.transaction(async (transaction) => {
    const status = await periodStatusOf(transaction as unknown as DashboardDatabase, tenantId, employeeUserId, periodKey);
    const refusal = refuseReopen({ reason, status });
    if (refusal) throw new TimesheetGovernanceError(refusal, REOPEN_REFUSAL_NOTES[refusal]);

    const now = new Date();
    await transaction.update(timesheetPeriods).set({
      decidedAt: null,
      decidedByUserId: null,
      reopenReason: reason.trim().slice(0, 500),
      reopenedAt: now,
      reopenedByUserId: actorUserId,
      status: "open",
      submittedAt: null,
      submittedMinutes: null,
      updatedAt: now,
    }).where(and(
      eq(timesheetPeriods.tenantId, tenantId),
      eq(timesheetPeriods.employeeUserId, employeeUserId),
      eq(timesheetPeriods.periodKey, periodKey),
    ));

    await transaction.insert(auditEvents).values({
      action: "timesheet.reopened",
      actorUserId,
      reason: `${periodKey} — ${reason.trim().slice(0, 200)}`,
      resourceId: employeeUserId,
      resourceType: "timesheet_period",
      tenantId,
    });
  });
}

/** Every person's standing for one month, for a reviewer's queue. */
export async function listPeriodQueue(
  database: DashboardDatabase,
  tenantId: string,
  periodKey: string,
): Promise<TimesheetPeriodRow[]> {
  const members = await database.select({ fullName: users.fullName, userId: tenantMemberships.userId })
    .from(tenantMemberships)
    .innerJoin(users, eq(users.id, tenantMemberships.userId))
    .where(and(eq(tenantMemberships.tenantId, tenantId), eq(tenantMemberships.status, "active")))
    .orderBy(asc(users.fullName));

  return Promise.all(members.map((member) => getPeriod(database, tenantId, member.userId, periodKey)));
}

export type TimesheetPolicyInput = {
  allowFutureDates: boolean;
  backdateWindowDays: number;
  effectiveFrom: string;
  expectedMonthlyMinutes: number | null;
};

export async function saveTimesheetPolicy(
  database: DashboardDatabase,
  tenantId: string,
  actorUserId: string,
  input: TimesheetPolicyInput,
) {
  return database.transaction(async (transaction) => {
    const [saved] = await transaction.insert(timesheetPolicies).values({
      allowFutureDates: input.allowFutureDates,
      backdateWindowDays: input.backdateWindowDays,
      createdByUserId: actorUserId,
      effectiveFrom: input.effectiveFrom,
      expectedMonthlyMinutes: input.expectedMonthlyMinutes,
      tenantId,
    }).onConflictDoUpdate({
      set: {
        allowFutureDates: input.allowFutureDates,
        backdateWindowDays: input.backdateWindowDays,
        expectedMonthlyMinutes: input.expectedMonthlyMinutes,
      },
      target: [timesheetPolicies.tenantId, timesheetPolicies.effectiveFrom],
    }).returning({ id: timesheetPolicies.id });

    await transaction.insert(auditEvents).values({
      action: "timesheet_policy.saved",
      actorUserId,
      reason: `From ${input.effectiveFrom} · ${input.backdateWindowDays}-day window`,
      resourceId: saved!.id,
      resourceType: "timesheet_policy",
      tenantId,
    });
    return saved!.id;
  });
}

export async function listTimesheetPolicies(database: DashboardDatabase, tenantId: string) {
  return database.select({
    allowFutureDates: timesheetPolicies.allowFutureDates,
    backdateWindowDays: timesheetPolicies.backdateWindowDays,
    createdByName: users.fullName,
    effectiveFrom: timesheetPolicies.effectiveFrom,
    expectedMonthlyMinutes: timesheetPolicies.expectedMonthlyMinutes,
    id: timesheetPolicies.id,
  }).from(timesheetPolicies)
    .innerJoin(users, eq(users.id, timesheetPolicies.createdByUserId))
    .where(eq(timesheetPolicies.tenantId, tenantId))
    .orderBy(desc(timesheetPolicies.effectiveFrom));
}
