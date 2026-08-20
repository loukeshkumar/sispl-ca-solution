import { randomUUID } from "node:crypto";
import { and, inArray, asc, desc, eq } from "drizzle-orm";

import { auditEvents, documentRequests, documents, legalEntities, workItems } from "../../db/schema";
import type { DashboardDatabase } from "../dashboard/postgres/repository";
import { planBulkRequestCancel, type BulkPlan } from "./bulk";
import type { DocumentRequestInput } from "./validation";

export class DocumentRepositoryError extends Error {
  constructor(public readonly code: "client_not_found" | "work_not_found" | "request_not_found" | "document_not_found" | "request_closed" | "request_mismatch") {
    super(code.replaceAll("_", " "));
    this.name = "DocumentRepositoryError";
  }
}

export type DocumentFormOption = { id: string; label: string; legalEntityId?: string };
export type DocumentWorkspaceData = {
  requests: Array<{ id: string; legalEntityId: string; clientName: string; title: string; description: string; dueDate: string; status: string; workLabel: string | null; createdAt: string }>;
  documents: Array<{ id: string; legalEntityId: string; clientName: string; originalName: string; mimeType: string; sizeBytes: number; requestTitle: string | null; createdAt: string }>;
};

async function assertClient(database: Pick<DashboardDatabase, "select">, tenantId: string, legalEntityId: string) {
  const [client] = await database.select({ id: legalEntities.id }).from(legalEntities).where(and(
    eq(legalEntities.id, legalEntityId), eq(legalEntities.tenantId, tenantId), eq(legalEntities.status, "active"),
  )).limit(1).for("key share");
  if (!client) throw new DocumentRepositoryError("client_not_found");
}

async function assertWork(database: Pick<DashboardDatabase, "select">, tenantId: string, legalEntityId: string, workItemId: string | null) {
  if (!workItemId) return;
  const [work] = await database.select({ id: workItems.id }).from(workItems).where(and(
    eq(workItems.id, workItemId), eq(workItems.tenantId, tenantId), eq(workItems.legalEntityId, legalEntityId),
  )).limit(1);
  if (!work) throw new DocumentRepositoryError("work_not_found");
}

export async function listDocumentFormOptions(database: DashboardDatabase, tenantId: string) {
  const [clients, work] = await Promise.all([
    database.select({ id: legalEntities.id, label: legalEntities.displayName }).from(legalEntities).where(and(
      eq(legalEntities.tenantId, tenantId), eq(legalEntities.status, "active"),
    )).orderBy(asc(legalEntities.displayName)),
    database.select({ id: workItems.id, legalEntityId: workItems.legalEntityId, serviceKey: workItems.serviceKey, periodKey: workItems.periodKey }).from(workItems).where(and(
      eq(workItems.tenantId, tenantId),
    )).orderBy(asc(workItems.statutoryDueDate)),
  ]);
  return { clients, work: work.map((item) => ({ id: item.id, legalEntityId: item.legalEntityId, label: `${item.serviceKey.replaceAll("_", " ").toUpperCase()} · ${item.periodKey}` })) };
}

export async function createDocumentRequest(database: DashboardDatabase, tenantId: string, actorUserId: string, input: DocumentRequestInput) {
  return database.transaction(async (transaction) => {
    await assertClient(transaction, tenantId, input.legalEntityId);
    await assertWork(transaction, tenantId, input.legalEntityId, input.workItemId);
    const id = randomUUID();
    await transaction.insert(documentRequests).values({ id, tenantId, requestedByUserId: actorUserId, ...input });
    await transaction.insert(auditEvents).values({ tenantId, actorUserId, resourceType: "document_request", resourceId: id, action: "document_request.created", reason: input.title });
    return id;
  });
}

export async function cancelDocumentRequest(database: DashboardDatabase, tenantId: string, actorUserId: string, requestId: string) {
  return database.transaction(async (transaction) => {
    const [request] = await transaction.update(documentRequests).set({ status: "cancelled", updatedAt: new Date() }).where(and(
      eq(documentRequests.id, requestId), eq(documentRequests.tenantId, tenantId), eq(documentRequests.status, "requested"),
    )).returning({ id: documentRequests.id });
    if (!request) throw new DocumentRepositoryError("request_not_found");
    await transaction.insert(auditEvents).values({ tenantId, actorUserId, resourceType: "document_request", resourceId: requestId, action: "document_request.cancelled" });
  });
}

export type DocumentUploadRecord = {
  legalEntityId: string; workItemId: string | null; requestId: string | null; originalName: string;
  storageName: string; mimeType: string; sizeBytes: number; sha256: string;
};

async function resolveUploadRelations(
  transaction: Parameters<Parameters<DashboardDatabase["transaction"]>[0]>[0],
  tenantId: string,
  input: Pick<DocumentUploadRecord, "legalEntityId" | "workItemId" | "requestId">,
) {
  await assertClient(transaction, tenantId, input.legalEntityId);
  let effectiveWorkItemId = input.workItemId;
  if (input.requestId) {
    const [request] = await transaction.select({ id: documentRequests.id, workItemId: documentRequests.workItemId }).from(documentRequests).where(and(
      eq(documentRequests.id, input.requestId), eq(documentRequests.tenantId, tenantId),
      eq(documentRequests.legalEntityId, input.legalEntityId), eq(documentRequests.status, "requested"),
    )).limit(1).for("update");
    if (!request) throw new DocumentRepositoryError("request_closed");
    if (request.workItemId && input.workItemId && request.workItemId !== input.workItemId) throw new DocumentRepositoryError("request_mismatch");
    effectiveWorkItemId = request.workItemId ?? input.workItemId;
  }
  await assertWork(transaction, tenantId, input.legalEntityId, effectiveWorkItemId);
  return effectiveWorkItemId;
}

export async function createPendingDocumentUpload(database: DashboardDatabase, tenantId: string, actorUserId: string, input: DocumentUploadRecord) {
  return database.transaction(async (transaction) => {
    const effectiveWorkItemId = await resolveUploadRelations(transaction, tenantId, input);
    const id = randomUUID();
    await transaction.insert(documents).values({ id, tenantId, uploadedByUserId: actorUserId, ...input, workItemId: effectiveWorkItemId, status: "pending" });
    return id;
  });
}

export async function finalizePendingDocumentUpload(database: DashboardDatabase, tenantId: string, actorUserId: string, documentId: string) {
  return database.transaction(async (transaction) => {
    const [document] = await transaction.update(documents).set({ status: "ready" }).where(and(
      eq(documents.id, documentId), eq(documents.tenantId, tenantId), eq(documents.status, "pending"),
    )).returning({ id: documents.id, originalName: documents.originalName, requestId: documents.requestId });
    if (!document) throw new DocumentRepositoryError("document_not_found");
    if (document.requestId) {
      const [request] = await transaction.update(documentRequests).set({ status: "received", receivedAt: new Date(), updatedAt: new Date() }).where(and(
        eq(documentRequests.id, document.requestId), eq(documentRequests.tenantId, tenantId), eq(documentRequests.status, "requested"),
      )).returning({ id: documentRequests.id });
      if (!request) throw new DocumentRepositoryError("request_closed");
      await transaction.insert(auditEvents).values({ tenantId, actorUserId, resourceType: "document_request", resourceId: document.requestId, action: "document_request.received", reason: document.originalName });
    }
    await transaction.insert(auditEvents).values({ tenantId, actorUserId, resourceType: "document", resourceId: document.id, action: "document.uploaded", reason: document.originalName });
  });
}

export async function discardPendingDocumentUpload(database: DashboardDatabase, tenantId: string, documentId: string) {
  const [discarded] = await database.delete(documents).where(and(
    eq(documents.id, documentId), eq(documents.tenantId, tenantId), eq(documents.status, "pending"),
  )).returning({ storageName: documents.storageName });
  return discarded ?? null;
}

export async function recordDocumentUpload(database: DashboardDatabase, tenantId: string, actorUserId: string, input: DocumentUploadRecord) {
  return database.transaction(async (transaction) => {
    await assertClient(transaction, tenantId, input.legalEntityId);
    let effectiveWorkItemId = input.workItemId;
    if (input.requestId) {
      const [request] = await transaction.update(documentRequests).set({ status: "received", receivedAt: new Date(), updatedAt: new Date() }).where(and(
        eq(documentRequests.id, input.requestId), eq(documentRequests.tenantId, tenantId),
        eq(documentRequests.legalEntityId, input.legalEntityId), eq(documentRequests.status, "requested"),
      )).returning({ id: documentRequests.id, workItemId: documentRequests.workItemId });
      if (!request) throw new DocumentRepositoryError("request_closed");
      if (request.workItemId && input.workItemId && request.workItemId !== input.workItemId) throw new DocumentRepositoryError("request_mismatch");
      effectiveWorkItemId = request.workItemId ?? input.workItemId;
    }
    await assertWork(transaction, tenantId, input.legalEntityId, effectiveWorkItemId);
    const id = randomUUID();
    await transaction.insert(documents).values({ id, tenantId, uploadedByUserId: actorUserId, ...input, workItemId: effectiveWorkItemId, status: "ready" });
    await transaction.insert(auditEvents).values({ tenantId, actorUserId, resourceType: "document", resourceId: id, action: "document.uploaded", reason: input.originalName });
    if (input.requestId) {
      await transaction.insert(auditEvents).values({ tenantId, actorUserId, resourceType: "document_request", resourceId: input.requestId, action: "document_request.received", reason: input.originalName });
    }
    return id;
  });
}

export async function listDocumentWorkspace(database: DashboardDatabase, tenantId: string): Promise<DocumentWorkspaceData> {
  const [requestRows, documentRows] = await Promise.all([
    database.select({
      id: documentRequests.id, legalEntityId: documentRequests.legalEntityId, clientName: legalEntities.displayName,
      title: documentRequests.title, description: documentRequests.description, dueDate: documentRequests.dueDate,
      status: documentRequests.status, serviceKey: workItems.serviceKey, periodKey: workItems.periodKey, createdAt: documentRequests.createdAt,
    }).from(documentRequests).innerJoin(legalEntities, and(eq(legalEntities.id, documentRequests.legalEntityId), eq(legalEntities.tenantId, tenantId)))
      .leftJoin(workItems, and(eq(workItems.id, documentRequests.workItemId), eq(workItems.tenantId, tenantId)))
      .where(eq(documentRequests.tenantId, tenantId)).orderBy(asc(documentRequests.dueDate), desc(documentRequests.createdAt)),
    database.select({
      id: documents.id, legalEntityId: documents.legalEntityId, clientName: legalEntities.displayName,
      originalName: documents.originalName, mimeType: documents.mimeType, sizeBytes: documents.sizeBytes,
      requestTitle: documentRequests.title, createdAt: documents.createdAt,
    }).from(documents).innerJoin(legalEntities, and(eq(legalEntities.id, documents.legalEntityId), eq(legalEntities.tenantId, tenantId)))
      .leftJoin(documentRequests, and(eq(documentRequests.id, documents.requestId), eq(documentRequests.tenantId, tenantId)))
      .where(and(eq(documents.tenantId, tenantId), eq(documents.status, "ready"))).orderBy(desc(documents.createdAt)),
  ]);
  return {
    requests: requestRows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString(), workLabel: row.serviceKey ? `${row.serviceKey.replaceAll("_", " ").toUpperCase()} · ${row.periodKey}` : null })),
    documents: documentRows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
  };
}

export async function getDocumentMetadata(database: DashboardDatabase, tenantId: string, documentId: string) {
  const [document] = await database.select({ id: documents.id, originalName: documents.originalName, storageName: documents.storageName, mimeType: documents.mimeType, sizeBytes: documents.sizeBytes, sha256: documents.sha256 }).from(documents).where(and(
    eq(documents.id, documentId), eq(documents.tenantId, tenantId), eq(documents.status, "ready"),
  )).limit(1);
  return document ?? null;
}

/**
 * Cancels several outstanding requests together. The whole selection is
 * validated first, so a request already received or already cancelled is
 * reported with a reason instead of failing the batch.
 */
export async function applyBulkRequestCancel(
  database: DashboardDatabase,
  tenantId: string,
  actorUserId: string,
  requestIds: string[],
): Promise<BulkPlan> {
  if (!tenantId.trim() || !actorUserId.trim()) throw new Error("Tenant and actor are required.");
  if (!requestIds.length) return { apply: [], skip: [] };
  return database.transaction(async (transaction) => {
    const current = await transaction.select({ id: documentRequests.id, status: documentRequests.status })
      .from(documentRequests).where(and(
        eq(documentRequests.tenantId, tenantId),
        inArray(documentRequests.id, requestIds),
      )).for("update");

    const plan = planBulkRequestCancel(current);
    for (const item of plan.apply) {
      await transaction.update(documentRequests).set({ status: "cancelled", updatedAt: new Date() })
        .where(and(eq(documentRequests.id, item.id), eq(documentRequests.tenantId, tenantId)));
      await transaction.insert(auditEvents).values({
        tenantId,
        actorUserId,
        resourceType: "document_request",
        resourceId: item.id,
        action: "document_request.cancelled",
        reason: "Cancelled from a Documents bulk action",
      });
    }
    return plan;
  });
}
