import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { auditEvents, documentRequests, legalEntities, users, workDependencies, workItems } from "../../db/schema";
import type { DashboardDatabase } from "../dashboard/postgres/repository";
import { indiaDateKey, insertNotifications } from "../notifications/repository";
import {
  clearedNotice,
  RAISE_REFUSAL_NOTES,
  reaches,
  refuseRaise,
  standingOf,
  type Dependency,
  type DependencyKind,
  type DependencyStanding,
  type RaiseRefusal,
} from "./waiting";

/**
 * Raising and clearing what work waits on.
 *
 * The important half is not `raiseDependency` — a firm could always type a note.
 * It is `clearForRequest` and `clearForCompletedWork`, which are what finally
 * notice that the thing arrived.
 */

type HandRefusal = "not_found" | "already_cleared" | "wrong_kind";

const HAND_REFUSAL_NOTES: Record<HandRefusal, string> = {
  already_cleared: "That dependency has already been cleared.",
  not_found: "That dependency was not found.",
  wrong_kind: "This one clears itself when the thing it names arrives. It is not ticked off by hand.",
};

export class DependencyError extends Error {
  constructor(public readonly code: RaiseRefusal | HandRefusal, message?: string) {
    super(message ?? HAND_REFUSAL_NOTES[code as HandRefusal] ?? "That dependency could not be raised.");
    this.name = "DependencyError";
  }
}

const raiser = alias(users, "dependency_raiser");
const clearer = alias(users, "dependency_clearer");
const predecessor = alias(workItems, "dependency_predecessor");

export type DependencyRow = Dependency & {
  clearanceNote: string;
  clearedByName: string | null;
  dependsOnWorkItemId: string | null;
  documentRequestId: string | null;
  externalParty: string | null;
  /** The predecessor's own status, so the list says why it has not cleared. */
  predecessorStatus: string | null;
  raisedByName: string;
};

export async function listDependencies(
  database: DashboardDatabase,
  tenantId: string,
  workItemId: string,
): Promise<DependencyRow[]> {
  const rows = await database.select({
    clearanceNote: workDependencies.clearanceNote,
    clearedAt: workDependencies.clearedAt,
    clearedByName: clearer.fullName,
    dependsOnWorkItemId: workDependencies.dependsOnWorkItemId,
    documentRequestId: workDependencies.documentRequestId,
    expectedOn: workDependencies.expectedOn,
    externalParty: workDependencies.externalParty,
    id: workDependencies.id,
    kind: workDependencies.kind,
    predecessorStatus: predecessor.status,
    raisedByName: raiser.fullName,
    title: workDependencies.title,
  }).from(workDependencies)
    .innerJoin(raiser, eq(raiser.id, workDependencies.raisedByUserId))
    .leftJoin(clearer, eq(clearer.id, workDependencies.clearedByUserId))
    .leftJoin(predecessor, eq(predecessor.id, workDependencies.dependsOnWorkItemId))
    .where(and(eq(workDependencies.tenantId, tenantId), eq(workDependencies.workItemId, workItemId)));

  return rows.map((row) => ({
    ...row,
    clearedAt: row.clearedAt?.toISOString() ?? null,
    kind: row.kind as DependencyKind,
  }));
}

/** Where one obligation stands with everything it waits on. */
export async function dependencyStanding(
  database: DashboardDatabase,
  tenantId: string,
  workItemId: string,
  todayKey = indiaDateKey(),
): Promise<DependencyStanding> {
  const rows = await database.select({
    clearedAt: workDependencies.clearedAt,
    expectedOn: workDependencies.expectedOn,
    id: workDependencies.id,
    kind: workDependencies.kind,
    title: workDependencies.title,
  }).from(workDependencies)
    .where(and(eq(workDependencies.tenantId, tenantId), eq(workDependencies.workItemId, workItemId)));

  return standingOf(rows.map((row) => ({
    ...row,
    clearedAt: row.clearedAt?.toISOString() ?? null,
    kind: row.kind as DependencyKind,
  })), todayKey);
}

/** How many things each of these obligations is still waiting on. */
export const openDependencyCounts = async (
  database: DashboardDatabase,
  tenantId: string,
  workItemIds: readonly string[],
) => (workItemIds.length === 0 ? [] : database.select({
  open: sql<number>`count(*)::int`,
  workItemId: workDependencies.workItemId,
}).from(workDependencies)
  .where(and(
    eq(workDependencies.tenantId, tenantId),
    inArray(workDependencies.workItemId, [...workItemIds]),
    isNull(workDependencies.clearedAt),
  ))
  .groupBy(workDependencies.workItemId));

type Transaction = Parameters<Parameters<DashboardDatabase["transaction"]>[0]>[0];

/**
 * Every open "waits on" edge in the tenant, for the cycle check.
 *
 * Loaded whole rather than walked in SQL: open predecessor edges number in the
 * hundreds for a firm, and a recursive CTE here would be harder to be sure of
 * than a depth-first walk with a test around it.
 */
async function predecessorEdges(transaction: Transaction, tenantId: string) {
  const rows = await transaction.select({
    dependsOnWorkItemId: workDependencies.dependsOnWorkItemId,
    workItemId: workDependencies.workItemId,
  }).from(workDependencies)
    .where(and(
      eq(workDependencies.tenantId, tenantId),
      eq(workDependencies.kind, "work_item"),
      isNull(workDependencies.clearedAt),
    ));

  const edges = new Map<string, string[]>();
  for (const row of rows) {
    if (!row.dependsOnWorkItemId) continue;
    edges.set(row.workItemId, [...(edges.get(row.workItemId) ?? []), row.dependsOnWorkItemId]);
  }
  return edges;
}

/**
 * The count on the work item, kept true.
 *
 * `missingItemCount` was typed into a form and never went down. It is now the
 * number of open dependencies and nothing else, so a stale figure cannot exist.
 */
async function syncMissingCount(transaction: Transaction, tenantId: string, workItemId: string) {
  await transaction.update(workItems).set({
    missingItemCount: sql`(select count(*) from ${workDependencies}
      where ${workDependencies.tenantId} = ${tenantId}
        and ${workDependencies.workItemId} = ${workItemId}
        and ${workDependencies.clearedAt} is null)`,
    updatedAt: new Date(),
  }).where(and(eq(workItems.tenantId, tenantId), eq(workItems.id, workItemId)));
}

/**
 * Tell the assignee when the last thing they were waiting on arrives.
 *
 * No status is changed. The firm put the work where it is, and a person decides
 * what it becomes now the wait is over — this only makes sure they find out on
 * the day rather than the next time they happen to look.
 */
async function announceIfSettled(
  transaction: Transaction,
  tenantId: string,
  workItemIds: readonly string[],
  todayKey: string,
) {
  for (const workItemId of new Set(workItemIds)) {
    const standing = await dependencyStanding(transaction as unknown as DashboardDatabase, tenantId, workItemId, todayKey);
    if (!standing.settled) continue;

    const [item] = await transaction.select({
      assigneeId: workItems.assigneeId,
      clientName: legalEntities.displayName,
      periodKey: workItems.periodKey,
      serviceKey: workItems.serviceKey,
      status: workItems.status,
    }).from(workItems)
      .innerJoin(legalEntities, eq(legalEntities.id, workItems.legalEntityId))
      .where(and(eq(workItems.tenantId, tenantId), eq(workItems.id, workItemId))).limit(1);
    if (!item?.assigneeId || item.status === "completed") continue;

    const notice = clearedNotice(item);
    await insertNotifications(transaction, tenantId, [{
      body: notice.body,
      // One announcement per obligation per day. A second trip through waiting
      // is worth saying again; twice in an afternoon is not.
      dedupeKey: `dependency_cleared:${workItemId}:${todayKey}`,
      recipientUserId: item.assigneeId,
      resourceId: workItemId,
      resourceType: "work_item",
      title: notice.title,
      type: "work_dependency_cleared",
    }]);
  }
}

export type RaiseDependencyInput = {
  dependsOnWorkItemId: string | null;
  documentRequestId: string | null;
  expectedOn: string;
  externalParty: string | null;
  kind: string;
  title: string;
};

export async function raiseDependency(
  database: DashboardDatabase,
  tenantId: string,
  actorUserId: string,
  workItemId: string,
  input: RaiseDependencyInput,
) {
  return database.transaction(async (transaction) => {
    const [item] = await transaction.select({ id: workItems.id }).from(workItems)
      .where(and(eq(workItems.tenantId, tenantId), eq(workItems.id, workItemId))).limit(1);
    if (!item) throw new DependencyError("not_found");

    const target = input.kind === "client_request" ? input.documentRequestId
      : input.kind === "work_item" ? input.dependsOnWorkItemId
        : (input.externalParty?.trim() || null);

    let requestStatus: string | null = null;
    if (input.kind === "client_request" && input.documentRequestId) {
      const [request] = await transaction.select({ status: documentRequests.status }).from(documentRequests)
        .where(and(eq(documentRequests.tenantId, tenantId), eq(documentRequests.id, input.documentRequestId))).limit(1);
      requestStatus = request?.status ?? null;
    }

    let predecessorStatus: string | null = null;
    let reachesSelf = false;
    if (input.kind === "work_item" && input.dependsOnWorkItemId) {
      const [row] = await transaction.select({ status: workItems.status }).from(workItems)
        .where(and(eq(workItems.tenantId, tenantId), eq(workItems.id, input.dependsOnWorkItemId))).limit(1);
      if (!row) throw new DependencyError("no_target", RAISE_REFUSAL_NOTES.no_target);
      predecessorStatus = row.status;
      // Would following "waits on" from the predecessor arrive back here?
      reachesSelf = reaches(await predecessorEdges(transaction, tenantId), input.dependsOnWorkItemId, workItemId);
    }

    const openDuplicate = target !== null && (await transaction.select({ id: workDependencies.id })
      .from(workDependencies)
      .where(and(
        eq(workDependencies.tenantId, tenantId),
        eq(workDependencies.workItemId, workItemId),
        isNull(workDependencies.clearedAt),
        // A request and a predecessor are each one thing, so the target alone
        // identifies them. An external party is not: the same bank owes a
        // statement and a certificate, and those are two separate waits.
        input.kind === "client_request" ? eq(workDependencies.documentRequestId, target)
          : input.kind === "work_item" ? eq(workDependencies.dependsOnWorkItemId, target)
            : and(eq(workDependencies.externalParty, target), eq(workDependencies.title, input.title.trim().slice(0, 200)))!,
      )).limit(1)).length > 0;

    const refusal = refuseRaise({
      expectedOn: input.expectedOn,
      kind: input.kind,
      openDuplicate,
      predecessorStatus,
      reachesSelf,
      requestStatus,
      target,
      title: input.title,
      workItemId,
    });
    if (refusal) throw new DependencyError(refusal, RAISE_REFUSAL_NOTES[refusal]);

    const [saved] = await transaction.insert(workDependencies).values({
      dependsOnWorkItemId: input.kind === "work_item" ? input.dependsOnWorkItemId : null,
      documentRequestId: input.kind === "client_request" ? input.documentRequestId : null,
      expectedOn: input.expectedOn,
      externalParty: input.kind === "external" ? input.externalParty!.trim().slice(0, 120) : null,
      kind: input.kind,
      raisedByUserId: actorUserId,
      tenantId,
      title: input.title.trim().slice(0, 200),
      workItemId,
    }).returning({ id: workDependencies.id });

    await syncMissingCount(transaction, tenantId, workItemId);
    await transaction.insert(auditEvents).values({
      tenantId, actorUserId, resourceType: "work_item", resourceId: workItemId,
      action: "work.dependency_raised", reason: input.title.trim().slice(0, 200),
    });
    return saved!.id;
  });
}

/**
 * A client deliverable arrived, or stopped being expected.
 *
 * Called from every path that closes a document request. This is the half the
 * blocker note could never do: notice.
 */
export async function clearForRequest(
  transaction: Transaction,
  tenantId: string,
  actorUserId: string,
  requestId: string,
  note: string,
  todayKey = indiaDateKey(),
) {
  const cleared = await transaction.update(workDependencies).set({
    clearanceNote: note.slice(0, 500),
    clearedAt: new Date(),
    clearedByUserId: actorUserId,
    updatedAt: new Date(),
  }).where(and(
    eq(workDependencies.tenantId, tenantId),
    eq(workDependencies.documentRequestId, requestId),
    isNull(workDependencies.clearedAt),
  )).returning({ workItemId: workDependencies.workItemId });

  for (const row of cleared) await syncMissingCount(transaction, tenantId, row.workItemId);
  await announceIfSettled(transaction, tenantId, cleared.map((row) => row.workItemId), todayKey);
  return cleared.length;
}

/** A predecessor finished, so everything waiting on it stops waiting. */
export async function clearForCompletedWork(
  transaction: Transaction,
  tenantId: string,
  actorUserId: string,
  completedWorkItemId: string,
  todayKey = indiaDateKey(),
) {
  const cleared = await transaction.update(workDependencies).set({
    clearanceNote: "The obligation this waited on was completed.",
    clearedAt: new Date(),
    clearedByUserId: actorUserId,
    updatedAt: new Date(),
  }).where(and(
    eq(workDependencies.tenantId, tenantId),
    eq(workDependencies.dependsOnWorkItemId, completedWorkItemId),
    isNull(workDependencies.clearedAt),
  )).returning({ workItemId: workDependencies.workItemId });

  for (const row of cleared) await syncMissingCount(transaction, tenantId, row.workItemId);
  await announceIfSettled(transaction, tenantId, cleared.map((row) => row.workItemId), todayKey);
  return cleared.length;
}

/**
 * Clear an external wait by hand.
 *
 * Only the `external` kind. The other two are closed by the thing they name, and
 * letting somebody tick off a document request from here would put the two
 * records out of step with each other.
 */
export async function clearDependency(
  database: DashboardDatabase,
  tenantId: string,
  actorUserId: string,
  dependencyId: string,
  note: string,
) {
  return database.transaction(async (transaction) => {
    const [row] = await transaction.select({
      clearedAt: workDependencies.clearedAt,
      kind: workDependencies.kind,
      title: workDependencies.title,
      workItemId: workDependencies.workItemId,
    }).from(workDependencies)
      .where(and(eq(workDependencies.tenantId, tenantId), eq(workDependencies.id, dependencyId)))
      .limit(1).for("update");
    if (!row) throw new DependencyError("not_found");
    if (row.clearedAt) throw new DependencyError("already_cleared");
    if (row.kind !== "external") throw new DependencyError("wrong_kind");

    await transaction.update(workDependencies).set({
      clearanceNote: note.trim().slice(0, 500),
      clearedAt: new Date(),
      clearedByUserId: actorUserId,
      updatedAt: new Date(),
    }).where(and(eq(workDependencies.tenantId, tenantId), eq(workDependencies.id, dependencyId)));

    await syncMissingCount(transaction, tenantId, row.workItemId);
    await transaction.insert(auditEvents).values({
      tenantId, actorUserId, resourceType: "work_item", resourceId: row.workItemId,
      action: "work.dependency_cleared", reason: row.title,
    });
    await announceIfSettled(transaction, tenantId, [row.workItemId], indiaDateKey());
  });
}

/**
 * What this obligation could be made to wait on.
 *
 * Only things that exist: open requests already raised for the client, and the
 * client's other open obligations. Anything else is an external party, which is
 * typed rather than chosen because a bank is not a record in this system.
 */
export async function dependencyTargets(
  database: DashboardDatabase,
  tenantId: string,
  workItemId: string,
  legalEntityId: string,
) {
  const [requests, predecessors] = await Promise.all([
    database.select({
      dueDate: documentRequests.dueDate,
      id: documentRequests.id,
      title: documentRequests.title,
    }).from(documentRequests)
      .where(and(
        eq(documentRequests.tenantId, tenantId),
        eq(documentRequests.legalEntityId, legalEntityId),
        eq(documentRequests.status, "requested"),
      )),
    database.select({
      id: workItems.id,
      periodKey: workItems.periodKey,
      serviceKey: workItems.serviceKey,
    }).from(workItems)
      .where(and(
        eq(workItems.tenantId, tenantId),
        eq(workItems.legalEntityId, legalEntityId),
        sql`${workItems.status} <> 'completed'`,
        sql`${workItems.id} <> ${workItemId}`,
      )),
  ]);

  return {
    predecessors: predecessors.map((item) => ({ id: item.id, label: `${item.serviceKey} · ${item.periodKey}` })),
    requests: requests.map((request) => ({ id: request.id, label: `${request.title} · due ${request.dueDate}` })),
  };
}
