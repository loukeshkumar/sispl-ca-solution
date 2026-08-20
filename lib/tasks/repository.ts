import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, ne } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import {
  auditEvents,
  legalEntities,
  officeTasks,
  tenantMemberships,
  users,
  workItems,
} from "../../db/schema";
import type { DashboardDatabase } from "../dashboard/postgres/repository";
import { insertNotifications } from "../notifications/repository";
import { planBulkTaskChange, type TaskBulkAction, type TaskBulkPlan } from "./bulk";
import type { OfficeTaskInput, TaskPriority, TaskSelfUpdateInput, TaskStatus } from "./validation";

const assigneeUsers = alias(users, "office_task_assignee");
const reviewerUsers = alias(users, "office_task_reviewer");
const assignerUsers = alias(users, "office_task_assigner");
const ACTIVE_STATUSES = ["todo", "in_progress", "waiting", "review"];

export class TaskRepositoryError extends Error {
  constructor(public readonly code: "not_found" | "invalid_member" | "invalid_client" | "invalid_work" | "context_mismatch" | "invalid_state") {
    super({
      not_found: "Task not found or no longer available for this action.",
      invalid_member: "The selected employee is not active in this firm.",
      invalid_client: "The selected client is not active in this firm.",
      invalid_work: "The selected compliance work item is not available in this firm.",
      context_mismatch: "The selected compliance work item belongs to a different client.",
      invalid_state: "Use an assignee status update or a terminal task control to change workflow state.",
    }[code]);
    this.name = "TaskRepositoryError";
  }
}

export type OfficeTaskRow = {
  id: string;
  title: string;
  description: string;
  assigneeId: string;
  assigneeName: string;
  reviewerId: string | null;
  reviewerName: string | null;
  assignedByUserId: string;
  assignedByName: string;
  priority: TaskPriority;
  status: TaskStatus;
  dueDate: string;
  blockerNote: string;
  legalEntityId: string | null;
  clientName: string | null;
  workItemId: string | null;
  workLabel: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type TaskWorkspaceData = {
  tasks: OfficeTaskRow[];
  metrics: { dueToday: number; overdue: number; waiting: number; review: number };
};

const canManageAllTasks = (roleKey: string) => ["firm_administrator", "partner", "manager"].includes(roleKey);

function indiaDateKey(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

async function assertActiveMember(database: Pick<DashboardDatabase, "select">, tenantId: string, userId: string | null) {
  if (!userId) return;
  const [member] = await database.select({ id: tenantMemberships.id }).from(tenantMemberships)
    .innerJoin(users, eq(users.id, tenantMemberships.userId))
    .where(and(
      eq(tenantMemberships.tenantId, tenantId),
      eq(tenantMemberships.userId, userId),
      eq(tenantMemberships.status, "active"),
      eq(users.status, "active"),
    )).limit(1).for("update", { of: tenantMemberships });
  if (!member) throw new TaskRepositoryError("invalid_member");
}

async function resolveTaskContext(
  database: Pick<DashboardDatabase, "select">,
  tenantId: string,
  legalEntityId: string | null,
  workItemId: string | null,
) {
  if (workItemId) {
    const [work] = await database.select({ legalEntityId: workItems.legalEntityId }).from(workItems).where(and(
      eq(workItems.id, workItemId), eq(workItems.tenantId, tenantId),
    )).limit(1).for("key share");
    if (!work) throw new TaskRepositoryError("invalid_work");
    if (legalEntityId && legalEntityId !== work.legalEntityId) throw new TaskRepositoryError("context_mismatch");
    return { legalEntityId: work.legalEntityId, workItemId };
  }
  if (legalEntityId) {
    const [client] = await database.select({ id: legalEntities.id }).from(legalEntities).where(and(
      eq(legalEntities.id, legalEntityId), eq(legalEntities.tenantId, tenantId), eq(legalEntities.status, "active"),
    )).limit(1).for("key share");
    if (!client) throw new TaskRepositoryError("invalid_client");
  }
  return { legalEntityId, workItemId: null };
}

export async function listTaskWorkspace(
  database: DashboardDatabase,
  tenantId: string,
  viewerUserId: string,
  viewerRoleKey: string,
  todayKey = indiaDateKey(),
): Promise<TaskWorkspaceData> {
  if (!tenantId.trim() || !viewerUserId.trim()) throw new Error("Tenant and viewer are required.");
  const accessCondition = canManageAllTasks(viewerRoleKey)
    ? eq(officeTasks.tenantId, tenantId)
    : and(eq(officeTasks.tenantId, tenantId), eq(officeTasks.assigneeId, viewerUserId));
  const rows = await database.select({
    id: officeTasks.id,
    title: officeTasks.title,
    description: officeTasks.description,
    assigneeId: officeTasks.assigneeId,
    assigneeName: assigneeUsers.fullName,
    reviewerId: officeTasks.reviewerId,
    reviewerName: reviewerUsers.fullName,
    assignedByUserId: officeTasks.assignedByUserId,
    assignedByName: assignerUsers.fullName,
    priority: officeTasks.priority,
    status: officeTasks.status,
    dueDate: officeTasks.dueDate,
    blockerNote: officeTasks.blockerNote,
    legalEntityId: officeTasks.legalEntityId,
    clientName: legalEntities.displayName,
    workItemId: officeTasks.workItemId,
    workServiceKey: workItems.serviceKey,
    workPeriodKey: workItems.periodKey,
    completedAt: officeTasks.completedAt,
    createdAt: officeTasks.createdAt,
    updatedAt: officeTasks.updatedAt,
  }).from(officeTasks)
    .innerJoin(assigneeUsers, eq(assigneeUsers.id, officeTasks.assigneeId))
    .innerJoin(assignerUsers, eq(assignerUsers.id, officeTasks.assignedByUserId))
    .leftJoin(reviewerUsers, eq(reviewerUsers.id, officeTasks.reviewerId))
    .leftJoin(legalEntities, and(eq(legalEntities.id, officeTasks.legalEntityId), eq(legalEntities.tenantId, tenantId)))
    .leftJoin(workItems, and(eq(workItems.id, officeTasks.workItemId), eq(workItems.tenantId, tenantId)))
    .where(accessCondition)
    .orderBy(asc(officeTasks.dueDate), desc(officeTasks.createdAt));
  const tasks: OfficeTaskRow[] = rows.map((row) => ({
    id: row.id,
    title: row.title,
    description: row.description,
    assigneeId: row.assigneeId,
    assigneeName: row.assigneeName,
    reviewerId: row.reviewerId,
    reviewerName: row.reviewerName,
    assignedByUserId: row.assignedByUserId,
    assignedByName: row.assignedByName,
    priority: row.priority as TaskPriority,
    status: row.status as TaskStatus,
    dueDate: row.dueDate,
    blockerNote: row.blockerNote,
    legalEntityId: row.legalEntityId,
    clientName: row.clientName,
    workItemId: row.workItemId,
    workLabel: row.workServiceKey ? `${row.workServiceKey.replaceAll("_", " ").toUpperCase()} · ${row.workPeriodKey}` : null,
    completedAt: row.completedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }));
  const active = tasks.filter((task) => ACTIVE_STATUSES.includes(task.status));
  return {
    tasks,
    metrics: {
      dueToday: active.filter((task) => task.dueDate === todayKey).length,
      overdue: active.filter((task) => task.dueDate < todayKey).length,
      waiting: active.filter((task) => task.status === "waiting").length,
      review: active.filter((task) => task.status === "review").length,
    },
  };
}

export async function getTask360(database: DashboardDatabase, tenantId: string, viewerUserId: string, viewerRoleKey: string, taskId: string) {
  const workspace = await listTaskWorkspace(database, tenantId, viewerUserId, viewerRoleKey);
  return workspace.tasks.find((task) => task.id === taskId) ?? null;
}

export async function listTaskFormOptions(database: DashboardDatabase, tenantId: string) {
  const [members, clients, work] = await Promise.all([
    database.select({ id: users.id, fullName: users.fullName, roleKey: tenantMemberships.roleKey }).from(tenantMemberships)
      .innerJoin(users, eq(users.id, tenantMemberships.userId)).where(and(eq(tenantMemberships.tenantId, tenantId), eq(tenantMemberships.status, "active"), eq(users.status, "active"))).orderBy(asc(users.fullName)),
    database.select({ id: legalEntities.id, label: legalEntities.displayName }).from(legalEntities)
      .where(and(eq(legalEntities.tenantId, tenantId), eq(legalEntities.status, "active"))).orderBy(asc(legalEntities.displayName)),
    database.select({ id: workItems.id, legalEntityId: workItems.legalEntityId, serviceKey: workItems.serviceKey, periodKey: workItems.periodKey }).from(workItems)
      .where(and(eq(workItems.tenantId, tenantId), ne(workItems.status, "completed"))).orderBy(asc(workItems.statutoryDueDate)),
  ]);
  return { members, clients, work: work.map((item) => ({ id: item.id, legalEntityId: item.legalEntityId, label: `${item.serviceKey.replaceAll("_", " ").toUpperCase()} · ${item.periodKey}` })) };
}

export async function createOfficeTask(database: DashboardDatabase, tenantId: string, actorUserId: string, input: OfficeTaskInput) {
  return database.transaction(async (transaction) => {
    await assertActiveMember(transaction, tenantId, actorUserId);
    await assertActiveMember(transaction, tenantId, input.assigneeId);
    await assertActiveMember(transaction, tenantId, input.reviewerId);
    const context = await resolveTaskContext(transaction, tenantId, input.legalEntityId, input.workItemId);
    const id = randomUUID();
    await transaction.insert(officeTasks).values({
      id,
      tenantId,
      title: input.title,
      description: input.description,
      assigneeId: input.assigneeId,
      reviewerId: input.reviewerId,
      assignedByUserId: actorUserId,
      priority: input.priority,
      status: "todo",
      dueDate: input.dueDate,
      blockerNote: "",
      estimateMinutes: input.estimateMinutes,
      ...context,
    });
    await transaction.insert(auditEvents).values({ tenantId, actorUserId, resourceType: "office_task", resourceId: id, action: "task.created", reason: input.title });
    if (input.assigneeId && input.assigneeId !== actorUserId) {
      await insertNotifications(transaction, tenantId, [{
        recipientUserId: input.assigneeId,
        type: "task_assigned",
        title: `New task assigned: ${input.title}`,
        body: input.description,
        resourceType: "office_task",
        resourceId: id,
        dedupeKey: null,
      }]);
    }
    return id;
  });
}

export async function updateOfficeTask(database: DashboardDatabase, tenantId: string, actorUserId: string, taskId: string, input: OfficeTaskInput) {
  await database.transaction(async (transaction) => {
    await assertActiveMember(transaction, tenantId, input.assigneeId);
    await assertActiveMember(transaction, tenantId, input.reviewerId);
    const context = await resolveTaskContext(transaction, tenantId, input.legalEntityId, input.workItemId);
    const [current] = await transaction.select({ assigneeId: officeTasks.assigneeId, status: officeTasks.status }).from(officeTasks).where(and(
      eq(officeTasks.id, taskId), eq(officeTasks.tenantId, tenantId), inArray(officeTasks.status, ACTIVE_STATUSES),
    )).limit(1).for("update");
    if (!current) throw new TaskRepositoryError("not_found");
    if (["completed", "cancelled"].includes(input.status) || input.status !== current.status) throw new TaskRepositoryError("invalid_state");
    await transaction.update(officeTasks).set({
      title: input.title,
      description: input.description,
      assigneeId: input.assigneeId,
      reviewerId: input.reviewerId,
      ...(current.assigneeId === input.assigneeId ? {} : { assignedByUserId: actorUserId }),
      priority: input.priority,
      dueDate: input.dueDate,
      estimateMinutes: input.estimateMinutes,
      updatedAt: new Date(),
      ...context,
    }).where(and(eq(officeTasks.id, taskId), eq(officeTasks.tenantId, tenantId)));
    await transaction.insert(auditEvents).values({
      tenantId,
      actorUserId,
      resourceType: "office_task",
      resourceId: taskId,
      action: current.assigneeId === input.assigneeId ? "task.updated" : "task.reassigned",
    });
    if (current.assigneeId !== input.assigneeId && input.assigneeId && input.assigneeId !== actorUserId) {
      await insertNotifications(transaction, tenantId, [{
        recipientUserId: input.assigneeId,
        type: "task_assigned",
        title: `Task reassigned to you: ${input.title}`,
        body: input.description,
        resourceType: "office_task",
        resourceId: taskId,
        dedupeKey: null,
      }]);
    }
  });
}

export async function updateOwnTaskStatus(database: DashboardDatabase, tenantId: string, actorUserId: string, taskId: string, input: TaskSelfUpdateInput) {
  await database.transaction(async (transaction) => {
    const [updated] = await transaction.update(officeTasks).set({
      status: input.status,
      blockerNote: input.blockerNote,
      updatedAt: new Date(),
    }).where(and(
      eq(officeTasks.id, taskId),
      eq(officeTasks.tenantId, tenantId),
      eq(officeTasks.assigneeId, actorUserId),
      inArray(officeTasks.status, ACTIVE_STATUSES),
    )).returning({ id: officeTasks.id });
    if (!updated) throw new TaskRepositoryError("not_found");
    await transaction.insert(auditEvents).values({ tenantId, actorUserId, resourceType: "office_task", resourceId: taskId, action: "task.status_updated", reason: input.status });
  });
}

export async function completeOfficeTask(database: DashboardDatabase, tenantId: string, actorUserId: string, taskId: string) {
  await database.transaction(async (transaction) => {
    const [completed] = await transaction.update(officeTasks).set({
      status: "completed",
      completedAt: new Date(),
      blockerNote: "",
      updatedAt: new Date(),
    }).where(and(eq(officeTasks.id, taskId), eq(officeTasks.tenantId, tenantId), inArray(officeTasks.status, ACTIVE_STATUSES))).returning({ id: officeTasks.id });
    if (!completed) throw new TaskRepositoryError("not_found");
    await transaction.insert(auditEvents).values({ tenantId, actorUserId, resourceType: "office_task", resourceId: taskId, action: "task.completed" });
  });
}

export async function cancelOfficeTask(database: DashboardDatabase, tenantId: string, actorUserId: string, taskId: string) {
  await database.transaction(async (transaction) => {
    const [cancelled] = await transaction.update(officeTasks).set({ status: "cancelled", completedAt: null, updatedAt: new Date() })
      .where(and(eq(officeTasks.id, taskId), eq(officeTasks.tenantId, tenantId), inArray(officeTasks.status, ACTIVE_STATUSES))).returning({ id: officeTasks.id });
    if (!cancelled) throw new TaskRepositoryError("not_found");
    await transaction.insert(auditEvents).values({ tenantId, actorUserId, resourceType: "office_task", resourceId: taskId, action: "task.cancelled" });
  });
}

export async function reopenOfficeTask(database: DashboardDatabase, tenantId: string, actorUserId: string, taskId: string) {
  await database.transaction(async (transaction) => {
    const [reopened] = await transaction.update(officeTasks).set({ status: "todo", completedAt: null, blockerNote: "", updatedAt: new Date() })
      .where(and(eq(officeTasks.id, taskId), eq(officeTasks.tenantId, tenantId), inArray(officeTasks.status, ["completed", "cancelled"]))).returning({ id: officeTasks.id });
    if (!reopened) throw new TaskRepositoryError("not_found");
    await transaction.insert(auditEvents).values({ tenantId, actorUserId, resourceType: "office_task", resourceId: taskId, action: "task.reopened" });
  });
}

/**
 * Applies one change across many tasks. The whole selection is validated first,
 * so the caller can report exactly what was skipped and why, and the valid
 * subset commits together — never a half-applied batch.
 */
export async function applyBulkTaskChange(
  database: DashboardDatabase,
  tenantId: string,
  actorUserId: string,
  taskIds: string[],
  action: TaskBulkAction,
): Promise<TaskBulkPlan> {
  if (!tenantId.trim() || !actorUserId.trim()) throw new Error("Tenant and actor are required.");
  if (!taskIds.length) return { apply: [], skip: [] };
  return database.transaction(async (transaction) => {
    if (action.kind === "assignee" || action.kind === "reviewer") {
      await assertActiveMember(transaction, tenantId, action.kind === "assignee" ? action.memberId : action.memberId);
    }
    const current = await transaction.select({
      assigneeId: officeTasks.assigneeId,
      blockerNote: officeTasks.blockerNote,
      dueDate: officeTasks.dueDate,
      id: officeTasks.id,
      reviewerId: officeTasks.reviewerId,
      status: officeTasks.status,
      title: officeTasks.title,
    }).from(officeTasks).where(and(
      eq(officeTasks.tenantId, tenantId),
      inArray(officeTasks.id, taskIds),
    )).for("update");

    const plan = planBulkTaskChange(current, action);
    const byId = new Map(current.map((task) => [task.id, task]));
    for (const item of plan.apply) {
      const set = action.kind === "assignee" ? { assignedByUserId: actorUserId, assigneeId: action.memberId }
        : action.kind === "reviewer" ? { reviewerId: action.memberId }
        : action.kind === "priority" ? { priority: action.priority }
        : action.kind === "dueDate" ? { dueDate: item.dueDate! }
        : { status: action.status };
      await transaction.update(officeTasks).set({ ...set, updatedAt: new Date() })
        .where(and(eq(officeTasks.id, item.id), eq(officeTasks.tenantId, tenantId)));
      // One event per task so Task 360 history stays per-task rather than
      // showing one opaque "bulk edit".
      await transaction.insert(auditEvents).values({
        tenantId,
        actorUserId,
        resourceType: "office_task",
        resourceId: item.id,
        action: `task.bulk.${action.kind}`,
        reason: "Changed from a Tasks bulk action",
      });
      // A reassignment is how someone learns they now own the task.
      if (action.kind === "assignee" && action.memberId !== actorUserId && byId.get(item.id)?.assigneeId !== action.memberId) {
        await insertNotifications(transaction, tenantId, [{
          recipientUserId: action.memberId,
          type: "task_assigned",
          title: `Task reassigned to you: ${byId.get(item.id)?.title ?? "Task"}`,
          body: "",
          resourceType: "office_task",
          resourceId: item.id,
          dedupeKey: null,
        }]);
      }
    }
    return plan;
  });
}
