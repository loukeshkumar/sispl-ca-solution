import { and, asc, eq, ilike, isNull, lt, ne, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import {
  employeeWorkProfiles,
  legalEntities,
  shiftTypes,
  tenantMemberships,
  timeEntries,
  users,
  workItems,
} from "../../db/schema";
import type { DashboardDatabase } from "../dashboard/postgres/repository";
import type { WorkStatus } from "../dashboard/types";
import { capacityHorizonWeeks, remainingBudgetMinutes, weeklyAvailableMinutes, weekStartKey } from "../scheduling/capacity";
import { UNASSIGNED_OWNER, type WorkQueueParams, type WorkScope } from "./queue-params";

const STATUS_LABELS: Record<string, WorkStatus> = {
  critical: "Critical", at_risk: "At risk", waiting: "Waiting", review: "Review", completed: "Completed",
};

export type WorkQueueRow = {
  assigneeId: string | null;
  blockerNote: string;
  budgetMinutes: number | null;
  client: string;
  clientInitials: string;
  id: string;
  internalDueDate: string | null;
  loggedMinutes: number;
  missingItemCount: number;
  owner: string;
  ownerInitials: string;
  periodKey: string;
  progress: number;
  reviewerId: string | null;
  serviceKey: string;
  status: WorkStatus;
  statutoryDueDate: string;
};

export type QueueTotals = { active: number; overdue: number; review: number; waiting: number };

function initialsOf(value: string) {
  return value.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]!.toUpperCase()).join("") || "??";
}

/** The date the firm actually manages to, falling back to the statutory one. */
const EFFECTIVE_DUE = sql`coalesce(${workItems.internalDueDate}, ${workItems.statutoryDueDate})`;

/** Logged time exceeding a recorded budget. An unbudgeted item can never be over budget. */
const OVER_BUDGET = sql`${workItems.budgetMinutes} is not null and (
  select coalesce(sum(${timeEntries.minutes}), 0)
  from ${timeEntries}
  where ${timeEntries.tenantId} = ${workItems.tenantId} and ${timeEntries.workItemId} = ${workItems.id}
) > ${workItems.budgetMinutes}`;

/** Scope is resolved from the session user, never from a client-supplied identity. */
function scopePredicate(scope: WorkScope, viewerId: string, owner: string | null) {
  if (scope === "mine") return eq(workItems.assigneeId, viewerId);
  if (scope === "reviewing") return eq(workItems.reviewerId, viewerId);
  if (owner === UNASSIGNED_OWNER) return isNull(workItems.assigneeId);
  return owner ? eq(workItems.assigneeId, owner) : undefined;
}

function filterPredicate(params: WorkQueueParams, todayKey: string) {
  switch (params.filter) {
    case "Overdue": return lt(EFFECTIVE_DUE, todayKey);
    case "Due this week": return and(
      sql`${EFFECTIVE_DUE} >= ${todayKey}::date`,
      sql`${EFFECTIVE_DUE} <= ${todayKey}::date + 7`,
    );
    case "Critical": return eq(workItems.status, "critical");
    case "At risk": return eq(workItems.status, "at_risk");
    case "Waiting": return eq(workItems.status, "waiting");
    case "Review": return eq(workItems.status, "review");
    default: return undefined;
  }
}

function conditions(tenantId: string, viewerId: string, params: WorkQueueParams, todayKey: string) {
  const parts: Array<SQL | undefined> = [
    eq(workItems.tenantId, tenantId),
    eq(legalEntities.status, "active"),
    ne(workItems.status, "completed"),
    scopePredicate(params.scope, viewerId, params.owner),
    filterPredicate(params, todayKey),
    params.budget === "over" ? OVER_BUDGET : undefined,
    params.service ? sql`upper(${workItems.serviceKey}) = ${params.service.toUpperCase()}` : undefined,
    params.q
      ? or(
        ilike(legalEntities.displayName, `%${params.q}%`),
        ilike(workItems.serviceKey, `%${params.q}%`),
        ilike(users.fullName, `%${params.q}%`),
      )
      : undefined,
  ];
  return and(...parts.filter(Boolean));
}

export async function listWorkQueue(
  database: DashboardDatabase,
  tenantId: string,
  viewerId: string,
  params: WorkQueueParams,
  todayKey: string,
): Promise<WorkQueueRow[]> {
  if (!tenantId.trim() || !viewerId.trim()) throw new Error("Tenant and viewer are required.");
  const loggedMinutes = sql<number>`(
    select coalesce(sum(${timeEntries.minutes}), 0)
    from ${timeEntries}
    where ${timeEntries.tenantId} = ${workItems.tenantId} and ${timeEntries.workItemId} = ${workItems.id}
  )`;
  const rows = await database.select({
    assigneeId: workItems.assigneeId,
    blockerNote: workItems.blockerNote,
    budgetMinutes: workItems.budgetMinutes,
    client: legalEntities.displayName,
    id: workItems.id,
    internalDueDate: workItems.internalDueDate,
    loggedMinutes,
    missingItemCount: workItems.missingItemCount,
    owner: users.fullName,
    periodKey: workItems.periodKey,
    progress: workItems.progress,
    reviewerId: workItems.reviewerId,
    serviceKey: workItems.serviceKey,
    status: workItems.status,
    statutoryDueDate: workItems.statutoryDueDate,
  }).from(workItems)
    .innerJoin(legalEntities, and(eq(legalEntities.id, workItems.legalEntityId), eq(legalEntities.tenantId, tenantId)))
    .leftJoin(users, eq(users.id, workItems.assigneeId))
    .where(conditions(tenantId, viewerId, params, todayKey))
    .orderBy(
      params.sort === "progress" ? asc(workItems.progress)
        : params.sort === "client" ? asc(legalEntities.displayName)
        : asc(EFFECTIVE_DUE),
    );
  return rows.map((row) => ({
    ...row,
    clientInitials: initialsOf(row.client),
    loggedMinutes: Number(row.loggedMinutes),
    owner: row.owner ?? "Unassigned",
    ownerInitials: row.owner ? initialsOf(row.owner) : "--",
    status: STATUS_LABELS[row.status] ?? "Critical",
  }));
}

/**
 * The headline counters describe the active scope, not the current narrowing,
 * so the cards and the list beneath them can never disagree about what "mine" is.
 */
export async function getQueueTotals(
  database: DashboardDatabase,
  tenantId: string,
  viewerId: string,
  params: WorkQueueParams,
  todayKey: string,
): Promise<QueueTotals> {
  if (!tenantId.trim() || !viewerId.trim()) throw new Error("Tenant and viewer are required.");
  const scoped: WorkQueueParams = { ...params, budget: null, filter: "All", q: "" };
  const [totals] = await database.select({
    active: sql<number>`count(*)`,
    overdue: sql<number>`count(*) filter (where ${EFFECTIVE_DUE} < ${todayKey}::date)`,
    review: sql<number>`count(*) filter (where ${workItems.status} = 'review')`,
    waiting: sql<number>`count(*) filter (where ${workItems.status} = 'waiting')`,
  }).from(workItems)
    .innerJoin(legalEntities, and(eq(legalEntities.id, workItems.legalEntityId), eq(legalEntities.tenantId, tenantId)))
    .leftJoin(users, eq(users.id, workItems.assigneeId))
    .where(conditions(tenantId, viewerId, scoped, todayKey));
  return {
    active: Number(totals?.active ?? 0),
    overdue: Number(totals?.overdue ?? 0),
    review: Number(totals?.review ?? 0),
    waiting: Number(totals?.waiting ?? 0),
  };
}

export type CapacityCell = { availableMinutes: number; loadMinutes: number; unbudgetedCount: number; weekStart: string };
export type CapacityLane = { availableMinutes: number; memberId: string; memberName: string; weeks: CapacityCell[] };

const CAPACITY_WEEKS = 4;

/**
 * Availability is derived from configured attendance data — the member's shift,
 * falling back to the tenant default — rather than a constant. The horizon is
 * four weeks because the recurrence job generates work 45 days ahead, so every
 * column is populated with real obligations.
 */
export async function getCapacityLanes(
  database: DashboardDatabase,
  tenantId: string,
  todayKey: string,
  weeks = CAPACITY_WEEKS,
): Promise<CapacityLane[]> {
  if (!tenantId.trim()) throw new Error("tenantId is required.");
  const horizon = capacityHorizonWeeks(todayKey, weeks);
  const horizonEnd = new Date(Date.parse(`${horizon.at(-1)!}T00:00:00Z`) + 7 * 86_400_000).toISOString().slice(0, 10);
  const defaultShift = alias(shiftTypes, "default_shift");

  const members = await database.select({
    fullDayMinutes: sql<number>`coalesce(${shiftTypes.fullDayMinutes}, ${defaultShift.fullDayMinutes}, 450)`,
    memberId: users.id,
    memberName: users.fullName,
    workingWeekMask: sql<string>`coalesce(${shiftTypes.workingWeekMask}, ${defaultShift.workingWeekMask}, '1111110')`,
  }).from(tenantMemberships)
    .innerJoin(users, eq(users.id, tenantMemberships.userId))
    .innerJoin(employeeWorkProfiles, and(
      eq(employeeWorkProfiles.tenantId, tenantId),
      eq(employeeWorkProfiles.employeeUserId, tenantMemberships.userId),
    ))
    .leftJoin(shiftTypes, and(eq(shiftTypes.tenantId, tenantId), eq(shiftTypes.id, employeeWorkProfiles.shiftTypeId)))
    .leftJoin(defaultShift, and(eq(defaultShift.tenantId, tenantId), eq(defaultShift.isDefault, true), eq(defaultShift.status, "active")))
    .where(and(
      eq(tenantMemberships.tenantId, tenantId),
      eq(tenantMemberships.status, "active"),
      eq(users.status, "active"),
    )).orderBy(asc(users.fullName));

  const open = await database.select({
    assigneeId: workItems.assigneeId,
    budgetMinutes: workItems.budgetMinutes,
    bucketDate: sql<string>`coalesce(${workItems.internalDueDate}, ${workItems.statutoryDueDate})`,
    progress: workItems.progress,
  }).from(workItems)
    .innerJoin(legalEntities, and(eq(legalEntities.id, workItems.legalEntityId), eq(legalEntities.tenantId, tenantId)))
    .where(and(
      eq(workItems.tenantId, tenantId),
      eq(legalEntities.status, "active"),
      ne(workItems.status, "completed"),
      sql`${EFFECTIVE_DUE} >= ${horizon[0]}::date`,
      sql`${EFFECTIVE_DUE} < ${horizonEnd}::date`,
    ));

  return members.map((member) => {
    const availableMinutes = weeklyAvailableMinutes(Number(member.fullDayMinutes), member.workingWeekMask);
    const mine = open.filter((item) => item.assigneeId === member.memberId);
    return {
      availableMinutes,
      memberId: member.memberId,
      memberName: member.memberName,
      weeks: horizon.map((weekStart) => {
        const inWeek = mine.filter((item) => weekStartKey(item.bucketDate) === weekStart);
        return {
          availableMinutes,
          loadMinutes: inWeek.reduce((total, item) => total + remainingBudgetMinutes(item.budgetMinutes, item.progress), 0),
          // Reported separately so an empty-looking lane reads as unknown, not free.
          unbudgetedCount: inWeek.filter((item) => item.budgetMinutes === null).length,
          weekStart,
        };
      }),
    };
  });
}
