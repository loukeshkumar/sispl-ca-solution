import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import {
  auditEvents,
  legalEntities,
  serviceCatalog,
  tenantMemberships,
  users,
  workItems,
} from "../../db/schema";
import type { DashboardDatabase } from "../dashboard/postgres/repository";
import { isServiceEntitled, listEntitledServices } from "../packages/repository";
import { planBulkChange, type BulkAction, type BulkPlan } from "./bulk";
import { workServiceEntitlementCode, type WorkInput } from "./validation";

const assigneeUsers = alias(users, "work_assignee");
const reviewerUsers = alias(users, "work_reviewer");

export class WorkRepositoryError extends Error {
  constructor(public readonly code: "not_found" | "invalid_client" | "invalid_member" | "invalid_service") {
    super({
      not_found: "Work item not found.",
      invalid_client: "The selected client is not active in this tenant.",
      invalid_member: "The selected team member is not active in this tenant.",
      invalid_service: "The selected service is not included in this client's active package or add-ons.",
    }[code]);
    this.name = "WorkRepositoryError";
  }
}

export type WorkClientOption = { id: string; displayName: string; legalName: string; services: Array<{ key: string; label: string }> };
export type WorkMemberOption = { id: string; fullName: string; roleKey: string };

export type WorkEditorData = WorkInput & {
  id: string;
  clientName: string;
};

export type Work360Data = Omit<WorkEditorData, "status"> & {
  assigneeName: string | null;
  reviewerName: string | null;
  status: WorkInput["status"] | "completed";
};

async function assertActiveClient(database: Pick<DashboardDatabase, "select">, tenantId: string, clientId: string) {
  const [client] = await database.select({ id: legalEntities.id }).from(legalEntities).where(and(
    eq(legalEntities.id, clientId),
    eq(legalEntities.tenantId, tenantId),
    eq(legalEntities.status, "active"),
  )).limit(1).for("key share");
  if (!client) throw new WorkRepositoryError("invalid_client");
}

async function assertActiveMember(database: Pick<DashboardDatabase, "select">, tenantId: string, userId: string | null) {
  if (!userId) return;
  const [member] = await database.select({ id: users.id }).from(tenantMemberships)
    .innerJoin(users, eq(users.id, tenantMemberships.userId))
    .where(and(
      eq(tenantMemberships.tenantId, tenantId),
      eq(tenantMemberships.userId, userId),
      eq(tenantMemberships.status, "active"),
      eq(users.status, "active"),
    )).limit(1);
  if (!member) throw new WorkRepositoryError("invalid_member");
}

export async function listWorkClients(database: DashboardDatabase, tenantId: string) {
  if (!tenantId.trim()) throw new Error("tenantId is required.");
  const clients = await database.select({
    id: legalEntities.id,
    displayName: legalEntities.displayName,
    legalName: legalEntities.legalName,
  }).from(legalEntities).where(and(
    eq(legalEntities.tenantId, tenantId),
    eq(legalEntities.status, "active"),
  )).orderBy(asc(legalEntities.displayName));
  return Promise.all(clients.map(async (client) => {
    const entitlements = await listEntitledServices(database, tenantId, client.id);
    const services = new Map<string, { key: string; label: string }>();
    for (const service of entitlements) {
      const key = service.code.toUpperCase();
      if (!services.has(key)) services.set(key, { key, label: service.name });
    }
    return {
      ...client,
      services: [...services.values()],
    };
  }));
}

async function assertServiceEntitlement(database: Pick<DashboardDatabase, "select">, tenantId: string, legalEntityId: string, serviceKey: string) {
  const entitled = await isServiceEntitled(database, tenantId, legalEntityId, workServiceEntitlementCode(serviceKey));
  if (!entitled) throw new WorkRepositoryError("invalid_service");
}

export async function listWorkMembers(database: DashboardDatabase, tenantId: string) {
  if (!tenantId.trim()) throw new Error("tenantId is required.");
  return database.select({ id: users.id, fullName: users.fullName, roleKey: tenantMemberships.roleKey })
    .from(tenantMemberships)
    .innerJoin(users, eq(users.id, tenantMemberships.userId))
    .where(and(
      eq(tenantMemberships.tenantId, tenantId),
      eq(tenantMemberships.status, "active"),
      eq(users.status, "active"),
    )).orderBy(asc(users.fullName));
}

export async function createWorkItem(
  database: DashboardDatabase,
  tenantId: string,
  actorUserId: string,
  input: WorkInput,
) {
  if (!tenantId.trim() || !actorUserId.trim()) throw new Error("Tenant and actor are required.");
  return database.transaction(async (transaction) => {
    await assertActiveClient(transaction, tenantId, input.legalEntityId);
    await assertServiceEntitlement(transaction, tenantId, input.legalEntityId, input.serviceKey);
    await assertActiveMember(transaction, tenantId, input.assigneeId);
    await assertActiveMember(transaction, tenantId, input.reviewerId);
    // Copied once, at creation. Editing the service standard later must never
    // rewrite the budget on obligations already raised against the old figure.
    let budgetMinutes = input.budgetMinutes;
    if (budgetMinutes === null) {
      const [standard] = await transaction.select({ standardMinutes: serviceCatalog.standardMinutes })
        .from(serviceCatalog)
        .where(and(
          eq(serviceCatalog.tenantId, tenantId),
          sql`upper(${serviceCatalog.code}) = ${workServiceEntitlementCode(input.serviceKey)}`,
        )).limit(1);
      budgetMinutes = standard?.standardMinutes ?? null;
    }
    const workItemId = randomUUID();
    await transaction.insert(workItems).values({
      id: workItemId,
      tenantId,
      budgetMinutes,
      legalEntityId: input.legalEntityId,
      serviceKey: input.serviceKey,
      periodKey: input.periodKey,
      status: input.status,
      statutoryDueDate: input.statutoryDueDate,
      internalDueDate: input.internalDueDate,
      assigneeId: input.assigneeId,
      reviewerId: input.reviewerId,
      blockerNote: input.blockerNote,
      progress: input.progress,
      missingItemCount: input.missingItemCount,
    });
    await transaction.insert(auditEvents).values({
      tenantId,
      actorUserId,
      resourceType: "work_item",
      resourceId: workItemId,
      action: "work.created",
      reason: "Created from the compliance workspace",
    });
    return workItemId;
  });
}

export async function updateWorkItem(
  database: DashboardDatabase,
  tenantId: string,
  actorUserId: string,
  workItemId: string,
  input: WorkInput,
) {
  if (!tenantId.trim() || !actorUserId.trim() || !workItemId.trim()) throw new Error("Tenant, actor, and work item are required.");
  await database.transaction(async (transaction) => {
    const [current] = await transaction.select({ legalEntityId: workItems.legalEntityId, serviceKey: workItems.serviceKey }).from(workItems).where(and(
      eq(workItems.id, workItemId), eq(workItems.tenantId, tenantId), ne(workItems.status, "completed"),
    )).limit(1).for("update");
    if (!current) throw new WorkRepositoryError("not_found");
    await assertActiveClient(transaction, tenantId, input.legalEntityId);
    if (current.legalEntityId !== input.legalEntityId || current.serviceKey !== input.serviceKey) {
      await assertServiceEntitlement(transaction, tenantId, input.legalEntityId, input.serviceKey);
    }
    await assertActiveMember(transaction, tenantId, input.assigneeId);
    await assertActiveMember(transaction, tenantId, input.reviewerId);

    const [updated] = await transaction.update(workItems).set({
      // An explicit edit always wins, and clearing the field returns the item to
      // unbudgeted. The catalogue is deliberately not re-read here.
      budgetMinutes: input.budgetMinutes,
      legalEntityId: input.legalEntityId,
      serviceKey: input.serviceKey,
      periodKey: input.periodKey,
      status: input.status,
      statutoryDueDate: input.statutoryDueDate,
      internalDueDate: input.internalDueDate,
      assigneeId: input.assigneeId,
      reviewerId: input.reviewerId,
      blockerNote: input.blockerNote,
      progress: input.progress,
      missingItemCount: input.missingItemCount,
      updatedAt: new Date(),
    }).where(and(eq(workItems.id, workItemId), eq(workItems.tenantId, tenantId), ne(workItems.status, "completed"))).returning({ id: workItems.id });
    if (!updated) throw new WorkRepositoryError("not_found");
    await transaction.insert(auditEvents).values({
      tenantId,
      actorUserId,
      resourceType: "work_item",
      resourceId: workItemId,
      action: "work.updated",
      reason: "Updated from Work Item 360",
    });
  });
}

export async function completeWorkItem(
  database: DashboardDatabase,
  tenantId: string,
  actorUserId: string,
  workItemId: string,
) {
  if (!tenantId.trim() || !actorUserId.trim() || !workItemId.trim()) throw new Error("Tenant, actor, and work item are required.");
  await database.transaction(async (transaction) => {
    const [completed] = await transaction.update(workItems).set({
      status: "completed",
      progress: 100,
      missingItemCount: 0,
      blockerNote: "",
      updatedAt: new Date(),
    }).where(and(
      eq(workItems.id, workItemId),
      eq(workItems.tenantId, tenantId),
      ne(workItems.status, "completed"),
    )).returning({ id: workItems.id });
    if (!completed) throw new WorkRepositoryError("not_found");
    await transaction.insert(auditEvents).values({
      tenantId,
      actorUserId,
      resourceType: "work_item",
      resourceId: workItemId,
      action: "work.completed",
      reason: "Completed from Work Item 360",
    });
  });
}

export async function getWorkItem360(database: DashboardDatabase, tenantId: string, workItemId: string): Promise<Work360Data | null> {
  if (!tenantId.trim() || !workItemId.trim()) return null;
  const [item] = await database.select({
    id: workItems.id,
    legalEntityId: workItems.legalEntityId,
    clientName: legalEntities.displayName,
    serviceKey: workItems.serviceKey,
    periodKey: workItems.periodKey,
    status: workItems.status,
    statutoryDueDate: workItems.statutoryDueDate,
    internalDueDate: workItems.internalDueDate,
    assigneeId: workItems.assigneeId,
    reviewerId: workItems.reviewerId,
    assigneeName: assigneeUsers.fullName,
    reviewerName: reviewerUsers.fullName,
    blockerNote: workItems.blockerNote,
    progress: workItems.progress,
    missingItemCount: workItems.missingItemCount,
    budgetMinutes: workItems.budgetMinutes,
  }).from(workItems)
    .innerJoin(legalEntities, and(eq(legalEntities.id, workItems.legalEntityId), eq(legalEntities.tenantId, tenantId)))
    .leftJoin(assigneeUsers, eq(assigneeUsers.id, workItems.assigneeId))
    .leftJoin(reviewerUsers, eq(reviewerUsers.id, workItems.reviewerId))
    .where(and(
      eq(workItems.id, workItemId),
      eq(workItems.tenantId, tenantId),
      eq(legalEntities.status, "active"),
    )).limit(1);
  if (!item) return null;
  return {
    ...item,
    assigneeId: item.assigneeId ?? null,
    reviewerId: item.reviewerId ?? null,
    internalDueDate: item.internalDueDate ?? null,
    assigneeName: item.assigneeName ?? null,
    reviewerName: item.reviewerName ?? null,
    status: item.status as Work360Data["status"],
  };
}

/**
 * Narrows a loaded Work Item 360 record to the editable fields. Pure, so a page
 * that already holds the 360 record can open the edit dialog without a second
 * round trip. Completed items are not editable.
 */
export function workEditorFrom(item: Work360Data | null): WorkEditorData | null {
  if (!item || item.status === "completed") return null;
  return {
    id: item.id,
    clientName: item.clientName,
    legalEntityId: item.legalEntityId,
    serviceKey: item.serviceKey,
    periodKey: item.periodKey,
    status: item.status,
    statutoryDueDate: item.statutoryDueDate,
    internalDueDate: item.internalDueDate,
    assigneeId: item.assigneeId,
    reviewerId: item.reviewerId,
    blockerNote: item.blockerNote,
    progress: item.progress,
    missingItemCount: item.missingItemCount,
    budgetMinutes: item.budgetMinutes,
  };
}

export async function getWorkItemEditor(database: DashboardDatabase, tenantId: string, workItemId: string): Promise<WorkEditorData | null> {
  return workEditorFrom(await getWorkItem360(database, tenantId, workItemId));
}

/**
 * Applies one change across many work items. The whole selection is validated
 * first, so the caller can report exactly what was skipped and why, and the
 * valid subset commits together — never a half-applied batch.
 */
export async function applyBulkWorkChange(
  database: DashboardDatabase,
  tenantId: string,
  actorUserId: string,
  workItemIds: string[],
  action: BulkAction,
): Promise<BulkPlan> {
  if (!tenantId.trim() || !actorUserId.trim()) throw new Error("Tenant and actor are required.");
  if (!workItemIds.length) return { apply: [], skip: [] };
  return database.transaction(async (transaction) => {
    if (action.kind === "assignee" || action.kind === "reviewer") {
      await assertActiveMember(transaction, tenantId, action.memberId);
    }
    const current = await transaction.select({
      assigneeId: workItems.assigneeId,
      blockerNote: workItems.blockerNote,
      id: workItems.id,
      internalDueDate: workItems.internalDueDate,
      reviewerId: workItems.reviewerId,
      statutoryDueDate: workItems.statutoryDueDate,
    }).from(workItems).where(and(
      eq(workItems.tenantId, tenantId),
      inArray(workItems.id, workItemIds),
      ne(workItems.status, "completed"),
    )).for("update");

    const plan = planBulkChange(current, action);
    for (const item of plan.apply) {
      const set = action.kind === "assignee" ? { assigneeId: action.memberId }
        : action.kind === "reviewer" ? { reviewerId: action.memberId }
        : action.kind === "internalDue" ? { internalDueDate: item.internalDueDate! }
        : { status: action.status };
      await transaction.update(workItems).set({ ...set, updatedAt: new Date() })
        .where(and(eq(workItems.id, item.id), eq(workItems.tenantId, tenantId), ne(workItems.status, "completed")));
      // One event per item so Work Item 360 history stays per-item rather than
      // showing one opaque "bulk edit".
      await transaction.insert(auditEvents).values({
        tenantId,
        actorUserId,
        resourceType: "work_item",
        resourceId: item.id,
        action: `work.bulk.${action.kind}`,
        reason: "Changed from a My Work bulk action",
      });
    }
    return plan;
  });
}
