import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import {
  auditEvents,
  legalEntities,
  serviceCatalog,
  tenantMemberships,
  users,
  workDependencies,
  workItems,
} from "../../db/schema";
import type { DashboardDatabase } from "../dashboard/postgres/repository";
import { capabilityFor, governedServices } from "../team/capability-repository";
import { meets } from "../team/capability";
import { blockersFor, instantiateProcedure, progressFor } from "../procedures/repository";
import { clearForCompletedWork, dependencyStanding } from "../dependencies/repository";
import { refuseWaiting, WAITING_REFUSAL_NOTES } from "../dependencies/waiting";
import { reviewStanding } from "../reviews/repository";
import { refuseCompletion } from "../reviews/rounds";
import { isServiceEntitled, listEntitledServices } from "../packages/repository";
import { planBulkChange, type BulkAction, type BulkPlan } from "./bulk";
import { workServiceEntitlementCode, type WorkInput } from "./validation";

const assigneeUsers = alias(users, "work_assignee");
const reviewerUsers = alias(users, "work_reviewer");

export class WorkRepositoryError extends Error {
  constructor(public readonly code: "not_found" | "invalid_client" | "invalid_member" | "invalid_service" | "reviewer_not_capable" | "steps_outstanding" | "review_outstanding" | "review_open" | "dependencies_outstanding" | "no_dependency") {
    super({
      not_found: "Work item not found.",
      invalid_client: "The selected client is not active in this tenant.",
      invalid_member: "The selected team member is not active in this tenant.",
      invalid_service: "The selected service is not included in this client's active package or add-ons.",
      reviewer_not_capable: "The selected reviewer is not recorded as able to review this service. Choose someone who is, or record their capability first.",
      steps_outstanding: "Mandatory steps of this obligation's procedure have not been done. Complete them, or mark them not applicable with a reason.",
      review_outstanding: "The named reviewer has not approved this obligation. Submit it for review first.",
      review_open: "This obligation is with its reviewer. It cannot be completed until they decide.",
      dependencies_outstanding: "This obligation is still waiting on something. Clear what it waits on, or cancel the request, before completing it.",
      no_dependency: WAITING_REFUSAL_NOTES.no_dependency,
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
  /** Read-only: the number of open dependencies, never a typed figure. */
  missingItemCount: number;
  /** Read-only: what the statutory date was before an extension moved it. */
  originalStatutoryDueDate: string | null;
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

/**
 * The reviewer gate.
 *
 * Only for services the firm has taken a view on: a service nobody is yet
 * recorded as able to review is not governed, so nothing is refused. That keeps
 * the day this ships from being the day every reviewer field locks, and closes
 * the gate service by service as the firm fills the matrix in.
 */
async function assertReviewerCapable(
  database: DashboardDatabase,
  tenantId: string,
  reviewerId: string | null,
  serviceKey: string,
) {
  if (!reviewerId) return;
  const serviceCode = workServiceEntitlementCode(serviceKey);
  const governed = await governedServices(database, tenantId);
  if (!governed.has(serviceCode)) return;
  const level = await capabilityFor(database, tenantId, reviewerId, serviceCode);
  if (!meets(level, "review")) throw new WorkRepositoryError("reviewer_not_capable");
}

/**
 * Giving somebody work they are not rated for is how people learn, so it is
 * allowed — but recorded, because a stretch nobody can see is indistinguishable
 * from a mistake when the job goes wrong.
 */
async function recordStretchAssignment(
  database: DashboardDatabase,
  tenantId: string,
  actorUserId: string,
  workItemId: string,
  assigneeId: string | null,
  serviceKey: string,
) {
  if (!assigneeId) return;
  const serviceCode = workServiceEntitlementCode(serviceKey);
  const level = await capabilityFor(database, tenantId, assigneeId, serviceCode);
  if (meets(level, "prepare")) return;
  await database.insert(auditEvents).values({
    tenantId, actorUserId, resourceType: "work_item", resourceId: workItemId,
    action: "work.capability_stretch",
    reason: `${serviceCode}: assignee is ${level ? `only ${level}` : "unrated"}`,
  });
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
    await assertReviewerCapable(transaction, tenantId, input.reviewerId, input.serviceKey);
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
      // Nothing can be outstanding on work that does not exist yet.
      missingItemCount: 0,
    });
    await transaction.insert(auditEvents).values({
      tenantId,
      actorUserId,
      resourceType: "work_item",
      resourceId: workItemId,
      action: "work.created",
      reason: "Created from the compliance workspace",
    });
    await recordStretchAssignment(transaction, tenantId, actorUserId, workItemId, input.assigneeId, input.serviceKey);

    // The procedure is copied onto the obligation now, from the version in force
    // on its statutory date. Revising the procedure later never touches this
    // copy, so the record can always say what was actually followed.
    const versionId = await instantiateProcedure(
      transaction, tenantId, workItemId, workServiceEntitlementCode(input.serviceKey), input.statutoryDueDate,
    );
    if (versionId) {
      const progress = await progressFor(transaction, tenantId, workItemId);
      if (progress.percent !== null) {
        await transaction.update(workItems).set({ progress: progress.percent })
          .where(and(eq(workItems.tenantId, tenantId), eq(workItems.id, workItemId)));
      }
      await transaction.insert(auditEvents).values({
        tenantId, actorUserId, resourceType: "work_item", resourceId: workItemId,
        action: "work.procedure_applied", reason: `${progress.total} steps`,
      });
    }
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
    await assertReviewerCapable(transaction, tenantId, input.reviewerId, input.serviceKey);

    // Where a procedure governs this item, progress is counted from its steps
    // and whatever the form sent is ignored — two sources for one number is how
    // a figure ends up meaning nothing.
    const counted = await progressFor(transaction, tenantId, workItemId);

    // `waiting` used to mean whatever the note beside it said. It now means at
    // least one thing is outstanding, recorded and chaseable.
    const waitingRefusal = refuseWaiting({
      openCount: (await dependencyStanding(transaction as unknown as DashboardDatabase, tenantId, workItemId)).open.length,
      status: input.status,
    });
    if (waitingRefusal) throw new WorkRepositoryError(waitingRefusal);

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
      progress: counted.percent ?? input.progress,
      // Derived from the open dependencies, never from the form. A count that
      // somebody typed once and nobody decremented is how "2 items missing" came
      // to sit beside work whose documents arrived a month ago.
      missingItemCount: sql`(select count(*) from ${workDependencies}
        where ${workDependencies.tenantId} = ${tenantId}
          and ${workDependencies.workItemId} = ${workItemId}
          and ${workDependencies.clearedAt} is null)`,
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
    await recordStretchAssignment(transaction, tenantId, actorUserId, workItemId, input.assigneeId, input.serviceKey);
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
    // Where a procedure was instantiated, the steps are the completion test.
    // Marking an obligation done with its mandatory steps outstanding is the
    // exact thing a typed progress field allowed and nobody could see.
    const outstanding = await blockersFor(transaction, tenantId, workItemId);
    if (outstanding.length > 0) throw new WorkRepositoryError("steps_outstanding");

    // Where the firm named a reviewer, it said this obligation needs one. The
    // status could always be set to `review` from a dropdown; an approval
    // cannot, because somebody other than the submitter has to give it.
    const [named] = await transaction.select({ reviewerId: workItems.reviewerId }).from(workItems)
      .where(and(eq(workItems.tenantId, tenantId), eq(workItems.id, workItemId))).limit(1);
    const refusal = refuseCompletion({
      reviewerUserId: named?.reviewerId ?? null,
      standing: await reviewStanding(transaction, tenantId, workItemId),
    });
    if (refusal) throw new WorkRepositoryError(refusal);

    // Completing zeroes the missing-item count. Where that count is real rows
    // rather than a typed figure, zeroing it while things are still outstanding
    // would put the number and the record out of step with each other.
    const waiting = await dependencyStanding(transaction as unknown as DashboardDatabase, tenantId, workItemId);
    if (waiting.open.length > 0) throw new WorkRepositoryError("dependencies_outstanding");

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

    // Anything that was waiting on this one is no longer waiting.
    await clearForCompletedWork(transaction, tenantId, actorUserId, workItemId);
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
    originalStatutoryDueDate: workItems.originalStatutoryDueDate,
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
    originalStatutoryDueDate: item.originalStatutoryDueDate ?? null,
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
      serviceKey: workItems.serviceKey,
      statutoryDueDate: workItems.statutoryDueDate,
    }).from(workItems).where(and(
      eq(workItems.tenantId, tenantId),
      inArray(workItems.id, workItemIds),
      ne(workItems.status, "completed"),
    )).for("update");

    const plan = planBulkChange(current, action);

    // The reviewer gate has to hold here too. A batch is a faster way to do the
    // same thing, not a way around the rule — and bulk already skips what it
    // cannot do, with the reason attached, so an ungoverned item still applies.
    if (action.kind === "reviewer" && action.memberId) {
      const governed = await governedServices(transaction, tenantId);
      const serviceByItem = new Map(current.map((item) => [item.id, workServiceEntitlementCode(item.serviceKey)]));
      const levels = new Map<string, Awaited<ReturnType<typeof capabilityFor>>>();
      const blocked: string[] = [];
      for (const item of plan.apply) {
        const code = serviceByItem.get(item.id)!;
        if (!governed.has(code)) continue;
        if (!levels.has(code)) levels.set(code, await capabilityFor(transaction, tenantId, action.memberId, code));
        if (!meets(levels.get(code) ?? null, "review")) {
          blocked.push(item.id);
          plan.skip.push({ id: item.id, reason: `Not recorded as able to review ${code}.` });
        }
      }
      plan.apply = plan.apply.filter((item) => !blocked.includes(item.id));
    }

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
