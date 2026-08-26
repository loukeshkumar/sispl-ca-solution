import { and, asc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import {
  employeeWorkProfiles,
  holidayCalendar,
  leaveRequests,
  legalEntities,
  officeTasks,
  shiftTypes,
  tenantMemberships,
  timeEntries,
  users,
  workItems,
} from "../../db/schema";
import type { DashboardDatabase } from "../dashboard/postgres/repository";
import { capacityHorizonWeeks, weeklyAvailableMinutes, weekStartKey } from "../scheduling/capacity";
import { weekAvailability, type DayPortion, type WeekAvailability } from "../scheduling/availability";
import type { TaskQueueParams, TaskScope } from "./queue-params";
import type { TaskPriority, TaskStatus } from "./validation";

const assigneeUsers = alias(users, "task_queue_assignee");
const reviewerUsers = alias(users, "task_queue_reviewer");
const assignerUsers = alias(users, "task_queue_assigner");

export const ACTIVE_TASK_STATUSES = ["todo", "in_progress", "waiting", "review"];

export const canManageAllTasks = (roleKey: string) => ["firm_administrator", "partner", "manager"].includes(roleKey);

export type TaskQueueRow = {
  assignedByName: string;
  assigneeId: string;
  assigneeInitials: string;
  assigneeName: string;
  blockerNote: string;
  clientName: string | null;
  dueDate: string;
  estimateMinutes: number | null;
  id: string;
  loggedMinutes: number;
  priority: TaskPriority;
  reviewerId: string | null;
  reviewerName: string | null;
  status: TaskStatus;
  title: string;
  workLabel: string | null;
};

export type TaskQueueTotals = { dueToday: number; overdue: number; review: number; waiting: number };

function initialsOf(value: string) {
  return value.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]!.toUpperCase()).join("") || "??";
}

/** Urgent first, expressed in SQL so ordering matches priorityRank exactly. */
const PRIORITY_RANK = sql`case ${officeTasks.priority}
  when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 when 'low' then 3 else 4 end`;

const OVER_ESTIMATE = sql`${officeTasks.estimateMinutes} is not null and (
  select coalesce(sum(${timeEntries.minutes}), 0)
  from ${timeEntries}
  where ${timeEntries.tenantId} = ${officeTasks.tenantId} and ${timeEntries.officeTaskId} = ${officeTasks.id}
) > ${officeTasks.estimateMinutes}`;

/**
 * The pre-existing visibility rule, unchanged: task administrators see the
 * whole firm, everyone else sees only their own assignments. Applied before any
 * scope predicate, so a hand-edited query string can never widen access.
 */
function accessFloor(tenantId: string, viewerId: string, viewerRoleKey: string) {
  return canManageAllTasks(viewerRoleKey)
    ? eq(officeTasks.tenantId, tenantId)
    : and(eq(officeTasks.tenantId, tenantId), eq(officeTasks.assigneeId, viewerId));
}

function scopePredicate(scope: TaskScope, viewerId: string, owner: string | null) {
  if (scope === "mine") return eq(officeTasks.assigneeId, viewerId);
  if (scope === "reviewing") return eq(officeTasks.reviewerId, viewerId);
  if (scope === "assigned") return eq(officeTasks.assignedByUserId, viewerId);
  return owner ? eq(officeTasks.assigneeId, owner) : undefined;
}

function statusPredicate(status: TaskQueueParams["status"]) {
  if (status === "Active") return inArray(officeTasks.status, ACTIVE_TASK_STATUSES);
  return eq(officeTasks.status, status.toLowerCase());
}

function conditions(tenantId: string, viewerId: string, viewerRoleKey: string, params: TaskQueueParams) {
  const parts: Array<SQL | undefined> = [
    accessFloor(tenantId, viewerId, viewerRoleKey),
    scopePredicate(params.scope, viewerId, params.owner),
    statusPredicate(params.status),
    params.priority === "all" ? undefined : eq(officeTasks.priority, params.priority),
    params.estimate === "over" ? OVER_ESTIMATE : undefined,
    params.q
      ? or(
        ilike(officeTasks.title, `%${params.q}%`),
        ilike(assigneeUsers.fullName, `%${params.q}%`),
        ilike(legalEntities.displayName, `%${params.q}%`),
      )
      : undefined,
  ];
  return and(...parts.filter(Boolean));
}

export async function listTaskQueue(
  database: DashboardDatabase,
  tenantId: string,
  viewerId: string,
  viewerRoleKey: string,
  params: TaskQueueParams,
): Promise<TaskQueueRow[]> {
  if (!tenantId.trim() || !viewerId.trim()) throw new Error("Tenant and viewer are required.");
  const loggedMinutes = sql<number>`(
    select coalesce(sum(${timeEntries.minutes}), 0)
    from ${timeEntries}
    where ${timeEntries.tenantId} = ${officeTasks.tenantId} and ${timeEntries.officeTaskId} = ${officeTasks.id}
  )`;
  const rows = await database.select({
    assignedByName: assignerUsers.fullName,
    assigneeId: officeTasks.assigneeId,
    assigneeName: assigneeUsers.fullName,
    blockerNote: officeTasks.blockerNote,
    clientName: legalEntities.displayName,
    dueDate: officeTasks.dueDate,
    estimateMinutes: officeTasks.estimateMinutes,
    id: officeTasks.id,
    loggedMinutes,
    priority: officeTasks.priority,
    reviewerId: officeTasks.reviewerId,
    reviewerName: reviewerUsers.fullName,
    status: officeTasks.status,
    title: officeTasks.title,
    workPeriodKey: workItems.periodKey,
    workServiceKey: workItems.serviceKey,
  }).from(officeTasks)
    .innerJoin(assigneeUsers, eq(assigneeUsers.id, officeTasks.assigneeId))
    .innerJoin(assignerUsers, eq(assignerUsers.id, officeTasks.assignedByUserId))
    .leftJoin(reviewerUsers, eq(reviewerUsers.id, officeTasks.reviewerId))
    .leftJoin(legalEntities, and(eq(legalEntities.id, officeTasks.legalEntityId), eq(legalEntities.tenantId, tenantId)))
    .leftJoin(workItems, and(eq(workItems.id, officeTasks.workItemId), eq(workItems.tenantId, tenantId)))
    .where(conditions(tenantId, viewerId, viewerRoleKey, params))
    .orderBy(
      // Deadline first, then urgency — an urgent task and a low one due the same
      // day should not be ordered by whichever the planner returned first.
      ...(params.sort === "priority" ? [PRIORITY_RANK, asc(officeTasks.dueDate)]
        : params.sort === "assignee" ? [asc(assigneeUsers.fullName), asc(officeTasks.dueDate)]
        : [asc(officeTasks.dueDate), PRIORITY_RANK]),
    );

  return rows.map((row) => ({
    assignedByName: row.assignedByName,
    assigneeId: row.assigneeId,
    assigneeInitials: initialsOf(row.assigneeName),
    assigneeName: row.assigneeName,
    blockerNote: row.blockerNote,
    clientName: row.clientName,
    dueDate: row.dueDate,
    estimateMinutes: row.estimateMinutes,
    id: row.id,
    loggedMinutes: Number(row.loggedMinutes),
    priority: row.priority as TaskPriority,
    reviewerId: row.reviewerId,
    reviewerName: row.reviewerName,
    status: row.status as TaskStatus,
    title: row.title,
    workLabel: row.workServiceKey ? `${row.workServiceKey.replaceAll("_", " ").toUpperCase()} · ${row.workPeriodKey}` : null,
  }));
}

/** Counters describe the active scope, so the cards cannot disagree with the list. */
export async function getTaskQueueTotals(
  database: DashboardDatabase,
  tenantId: string,
  viewerId: string,
  viewerRoleKey: string,
  params: TaskQueueParams,
  todayKey: string,
): Promise<TaskQueueTotals> {
  const scoped: TaskQueueParams = { ...params, estimate: null, priority: "all", q: "", status: "Active" };
  const [totals] = await database.select({
    dueToday: sql<number>`count(*) filter (where ${officeTasks.dueDate} = ${todayKey}::date)`,
    overdue: sql<number>`count(*) filter (where ${officeTasks.dueDate} < ${todayKey}::date)`,
    review: sql<number>`count(*) filter (where ${officeTasks.status} = 'review')`,
    waiting: sql<number>`count(*) filter (where ${officeTasks.status} = 'waiting')`,
  }).from(officeTasks)
    .innerJoin(assigneeUsers, eq(assigneeUsers.id, officeTasks.assigneeId))
    .innerJoin(assignerUsers, eq(assignerUsers.id, officeTasks.assignedByUserId))
    .leftJoin(reviewerUsers, eq(reviewerUsers.id, officeTasks.reviewerId))
    .leftJoin(legalEntities, and(eq(legalEntities.id, officeTasks.legalEntityId), eq(legalEntities.tenantId, tenantId)))
    .where(conditions(tenantId, viewerId, viewerRoleKey, scoped));
  return {
    dueToday: Number(totals?.dueToday ?? 0),
    overdue: Number(totals?.overdue ?? 0),
    review: Number(totals?.review ?? 0),
    waiting: Number(totals?.waiting ?? 0),
  };
}

export type TaskCapacityCell = WeekAvailability & { loadMinutes: number; unestimatedCount: number };
export type TaskCapacityLane = {
  /** The shift mask alone, for a lane header. Individual weeks differ from it. */
  availableMinutes: number;
  memberId: string;
  memberName: string;
  weeks: TaskCapacityCell[];
};

const CAPACITY_WEEKS = 4;

/**
 * Committed task effort against configured availability. Office tasks carry no
 * progress percentage, so a task counts fully until it leaves the active
 * statuses — load is not discounted part-way the way work-item load is.
 */
export async function getTaskCapacityLanes(
  database: DashboardDatabase,
  tenantId: string,
  todayKey: string,
  weeks = CAPACITY_WEEKS,
): Promise<TaskCapacityLane[]> {
  if (!tenantId.trim()) throw new Error("tenantId is required.");
  const horizon = capacityHorizonWeeks(todayKey, weeks);
  const horizonEnd = new Date(Date.parse(`${horizon.at(-1)!}T00:00:00Z`) + 7 * 86_400_000).toISOString().slice(0, 10);
  const defaultShift = alias(shiftTypes, "task_default_shift");

  const members = await database.select({
    fullDayMinutes: sql<number>`coalesce(${shiftTypes.fullDayMinutes}, ${defaultShift.fullDayMinutes}, 450)`,
    memberId: users.id,
    memberName: users.fullName,
    workLocationState: employeeWorkProfiles.workLocationState,
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
    assigneeId: officeTasks.assigneeId,
    dueDate: officeTasks.dueDate,
    estimateMinutes: officeTasks.estimateMinutes,
  }).from(officeTasks).where(and(
    eq(officeTasks.tenantId, tenantId),
    inArray(officeTasks.status, ACTIVE_TASK_STATUSES),
    sql`${officeTasks.dueDate} >= ${horizon[0]}::date`,
    sql`${officeTasks.dueDate} < ${horizonEnd}::date`,
  ));

  // Availability is now a fact about each week rather than one number repeated
  // across the horizon: a lane that read 2,700 minutes while somebody was on
  // approved leave was a plan built on a figure nobody had checked.
  const [holidayRows, leaveRows] = await Promise.all([
    database.select({
      holidayDate: holidayCalendar.holidayDate,
      holidayType: holidayCalendar.holidayType,
      jurisdictionState: holidayCalendar.jurisdictionState,
      name: holidayCalendar.name,
    }).from(holidayCalendar).where(and(
      eq(holidayCalendar.tenantId, tenantId),
      eq(holidayCalendar.status, "active"),
      sql`${holidayCalendar.holidayDate} >= ${horizon[0]}::date`,
      sql`${holidayCalendar.holidayDate} < ${horizonEnd}::date`,
    )),
    database.select({
      dateFrom: leaveRequests.dateFrom,
      dateTo: leaveRequests.dateTo,
      dayPortion: leaveRequests.dayPortion,
      employeeUserId: leaveRequests.employeeUserId,
      status: leaveRequests.status,
    }).from(leaveRequests).where(and(
      eq(leaveRequests.tenantId, tenantId),
      inArray(leaveRequests.status, ["approved", "pending"]),
      sql`${leaveRequests.dateTo} >= ${horizon[0]}::date`,
      sql`${leaveRequests.dateFrom} < ${horizonEnd}::date`,
    )),
  ]);

  const holidays = holidayRows.map((row) => ({ ...row }));
  const leave = leaveRows.map((row) => ({ ...row, dayPortion: row.dayPortion as DayPortion }));

  return members.map((member) => {
    const mine = open.filter((task) => task.assigneeId === member.memberId);
    return {
      availableMinutes: weeklyAvailableMinutes(Number(member.fullDayMinutes), member.workingWeekMask),
      memberId: member.memberId,
      memberName: member.memberName,
      weeks: horizon.map((weekStart) => {
        const inWeek = mine.filter((task) => weekStartKey(task.dueDate) === weekStart);
        return {
          ...weekAvailability({
            employeeUserId: member.memberId,
            fullDayMinutes: Number(member.fullDayMinutes),
            holidays,
            leave,
            weekStart,
            workLocationState: member.workLocationState,
            workingWeekMask: member.workingWeekMask,
          }),
          loadMinutes: inWeek.reduce((total, task) => total + (task.estimateMinutes ?? 0), 0),
          // Reported separately so an empty-looking lane reads as unknown, not free.
          unestimatedCount: inWeek.filter((task) => task.estimateMinutes === null).length,
        };
      }),
    };
  });
}
