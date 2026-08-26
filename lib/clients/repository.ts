import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, ne } from "drizzle-orm";

import {
  auditEvents,
  clientGroups,
  clientPackageAssignments,
  clientServices,
  documentRequests,
  legalEntities,
  registrations,
  serviceCatalog,
  tenantMemberships,
  users,
  workItems,
} from "../../db/schema";
import type { DashboardDatabase } from "../dashboard/postgres/repository";
import type { ClientInput } from "./validation";

export class ClientRepositoryError extends Error {
  constructor(public readonly code: "not_found" | "invalid_owner" | "invalid_service" | "active_obligations") {
    super({
      not_found: "Client not found.",
      invalid_owner: "The selected owner is not an active tenant member.",
      invalid_service: "Select active services from this firm's service master.",
      active_obligations: "Complete or cancel every open work item and document request before archiving this client.",
    }[code]);
    this.name = "ClientRepositoryError";
  }
}

async function assertActiveServices(database: Pick<DashboardDatabase, "select">, tenantId: string, serviceCodes: string[]) {
  if (!serviceCodes.length) throw new ClientRepositoryError("invalid_service");
  const rows = await database.select({ code: serviceCatalog.code }).from(serviceCatalog).where(and(
    eq(serviceCatalog.tenantId, tenantId),
    eq(serviceCatalog.status, "active"),
    inArray(serviceCatalog.code, serviceCodes),
  ));
  if (rows.length !== serviceCodes.length) throw new ClientRepositoryError("invalid_service");
}

export type ClientMemberOption = { id: string; fullName: string; roleKey: string };

export type ClientEditorData = ClientInput & {
  clientGroupId: string;
  id: string;
  ownerName: string | null;
  status: "active" | "archived";
  hasPackageHistory: boolean;
};

export type Client360Data = ClientEditorData & {
  work: Array<{
    id: string;
    serviceKey: string;
    periodKey: string;
    status: string;
    dueDate: string;
    progress: number;
    missingItems: number;
    blockerNote: string;
    assigneeName: string | null;
  }>;
};

async function assertActiveOwner(
  database: Pick<DashboardDatabase, "select">,
  tenantId: string,
  ownerId: string | null,
) {
  if (!ownerId) return;
  const [owner] = await database
    .select({ id: users.id })
    .from(tenantMemberships)
    .innerJoin(users, eq(users.id, tenantMemberships.userId))
    .where(and(
      eq(tenantMemberships.tenantId, tenantId),
      eq(tenantMemberships.userId, ownerId),
      eq(tenantMemberships.status, "active"),
      eq(users.status, "active"),
    ))
    .limit(1);
  if (!owner) throw new ClientRepositoryError("invalid_owner");
}

export async function listActiveClientOwners(database: DashboardDatabase, tenantId: string) {
  if (!tenantId.trim()) throw new Error("tenantId is required.");
  return database
    .select({ id: users.id, fullName: users.fullName, roleKey: tenantMemberships.roleKey })
    .from(tenantMemberships)
    .innerJoin(users, eq(users.id, tenantMemberships.userId))
    .where(and(
      eq(tenantMemberships.tenantId, tenantId),
      eq(tenantMemberships.status, "active"),
      eq(users.status, "active"),
    ))
    .orderBy(asc(users.fullName));
}

export async function createClient(
  database: DashboardDatabase,
  tenantId: string,
  actorUserId: string,
  input: ClientInput,
) {
  if (!tenantId.trim() || !actorUserId.trim()) throw new Error("Tenant and actor are required.");

  return database.transaction(async (transaction) => {
    await assertActiveOwner(transaction, tenantId, input.ownerId);
    await assertActiveServices(transaction, tenantId, input.services);
    const clientGroupId = randomUUID();
    const legalEntityId = randomUUID();

    await transaction.insert(clientGroups).values({
      id: clientGroupId,
      tenantId,
      name: input.legalName,
      relationshipOwnerId: input.ownerId,
      riskStatus: input.riskStatus,
      healthScore: input.healthScore,
    });
    await transaction.insert(legalEntities).values({
      id: legalEntityId,
      tenantId,
      clientGroupId,
      legalName: input.legalName,
      displayName: input.displayName,
      entityType: input.entityType,
      maskedPan: input.maskedPan,
      city: input.city,
      relationshipStart: input.relationshipStart,
      // A new client is a prospect until a partner accepts them. Every gate that
      // already tested for an active client — work, packages, invoices — refuses
      // a prospect without any change, which is why acceptance is a status here
      // rather than a flag beside one.
      status: "prospect",
    });
    await transaction.insert(clientServices).values(input.services.map((serviceKey) => ({
      tenantId,
      legalEntityId,
      serviceKey,
      status: "active",
    })));
    if (input.gstRegistrations) {
      await transaction.insert(registrations).values(Array.from({ length: input.gstRegistrations }, (_, index) => ({
        tenantId,
        legalEntityId,
        registrationType: "gst",
        registrationKey: `gst-${index + 1}`,
        status: "active",
      })));
    }
    await transaction.insert(auditEvents).values({
      tenantId,
      actorUserId,
      resourceType: "legal_entity",
      resourceId: legalEntityId,
      action: "client.created",
      reason: "Created from the client workspace",
    });
    return legalEntityId;
  });
}

export async function updateClient(
  database: DashboardDatabase,
  tenantId: string,
  actorUserId: string,
  clientId: string,
  input: ClientInput,
) {
  if (!tenantId.trim() || !actorUserId.trim() || !clientId.trim()) throw new Error("Tenant, actor, and client are required.");

  await database.transaction(async (transaction) => {
    const [existing] = await transaction
      .select({ clientGroupId: legalEntities.clientGroupId })
      .from(legalEntities)
      .where(and(
        eq(legalEntities.id, clientId),
        eq(legalEntities.tenantId, tenantId),
        eq(legalEntities.status, "active"),
      ))
      .limit(1);
    if (!existing) throw new ClientRepositoryError("not_found");
    await assertActiveOwner(transaction, tenantId, input.ownerId);
    const [packageHistory] = await transaction.select({ id: clientPackageAssignments.id }).from(clientPackageAssignments).where(and(
      eq(clientPackageAssignments.tenantId, tenantId), eq(clientPackageAssignments.legalEntityId, clientId),
    )).limit(1);

    await transaction.update(clientGroups).set({
      name: input.legalName,
      relationshipOwnerId: input.ownerId,
      riskStatus: input.riskStatus,
      healthScore: input.healthScore,
      updatedAt: new Date(),
    }).where(and(eq(clientGroups.id, existing.clientGroupId), eq(clientGroups.tenantId, tenantId)));

    await transaction.update(legalEntities).set({
      legalName: input.legalName,
      displayName: input.displayName,
      entityType: input.entityType,
      maskedPan: input.maskedPan,
      city: input.city,
      relationshipStart: input.relationshipStart,
      updatedAt: new Date(),
    }).where(and(eq(legalEntities.id, clientId), eq(legalEntities.tenantId, tenantId)));

    if (!packageHistory) {
      await assertActiveServices(transaction, tenantId, input.services);
      await transaction.delete(clientServices).where(and(
        eq(clientServices.tenantId, tenantId),
        eq(clientServices.legalEntityId, clientId),
      ));
      await transaction.insert(clientServices).values(input.services.map((serviceKey) => ({
        tenantId,
        legalEntityId: clientId,
        serviceKey,
        status: "active",
      })));
    }

    await transaction.delete(registrations).where(and(
      eq(registrations.tenantId, tenantId),
      eq(registrations.legalEntityId, clientId),
      eq(registrations.registrationType, "gst"),
    ));
    if (input.gstRegistrations) {
      await transaction.insert(registrations).values(Array.from({ length: input.gstRegistrations }, (_, index) => ({
        tenantId,
        legalEntityId: clientId,
        registrationType: "gst",
        registrationKey: `gst-${index + 1}`,
        status: "active",
      })));
    }
    await transaction.insert(auditEvents).values({
      tenantId,
      actorUserId,
      resourceType: "legal_entity",
      resourceId: clientId,
      action: "client.updated",
      reason: "Updated from Client 360",
    });
  });
}

export async function archiveClient(
  database: DashboardDatabase,
  tenantId: string,
  actorUserId: string,
  clientId: string,
) {
  if (!tenantId.trim() || !actorUserId.trim() || !clientId.trim()) throw new Error("Tenant, actor, and client are required.");
  await database.transaction(async (transaction) => {
    const [client] = await transaction.select({ id: legalEntities.id }).from(legalEntities).where(and(
      eq(legalEntities.id, clientId),
      eq(legalEntities.tenantId, tenantId),
      eq(legalEntities.status, "active"),
    )).limit(1).for("update");
    if (!client) throw new ClientRepositoryError("not_found");

    const [openWorkRows, openRequestRows] = await Promise.all([
      transaction.select({ id: workItems.id }).from(workItems).where(and(
        eq(workItems.tenantId, tenantId),
        eq(workItems.legalEntityId, clientId),
        ne(workItems.status, "completed"),
      )).limit(1),
      transaction.select({ id: documentRequests.id }).from(documentRequests).where(and(
        eq(documentRequests.tenantId, tenantId),
        eq(documentRequests.legalEntityId, clientId),
        eq(documentRequests.status, "requested"),
      )).limit(1),
    ]);
    if (openWorkRows.length > 0 || openRequestRows.length > 0) {
      throw new ClientRepositoryError("active_obligations");
    }

    const [archived] = await transaction.update(legalEntities).set({
      status: "archived",
      updatedAt: new Date(),
    }).where(and(
      eq(legalEntities.id, clientId),
      eq(legalEntities.tenantId, tenantId),
      eq(legalEntities.status, "active"),
    )).returning({ id: legalEntities.id });
    if (!archived) throw new ClientRepositoryError("not_found");
    await transaction.insert(auditEvents).values({
      tenantId,
      actorUserId,
      resourceType: "legal_entity",
      resourceId: clientId,
      action: "client.archived",
      reason: "Archived from Client 360",
    });
  });
}

export async function getClientEditorData(
  database: DashboardDatabase,
  tenantId: string,
  clientId: string,
  includeArchived = false,
): Promise<ClientEditorData | null> {
  if (!tenantId.trim() || !clientId.trim()) return null;
  const [client] = await database.select({
    id: legalEntities.id,
    clientGroupId: legalEntities.clientGroupId,
    legalName: legalEntities.legalName,
    displayName: legalEntities.displayName,
    entityType: legalEntities.entityType,
    maskedPan: legalEntities.maskedPan,
    city: legalEntities.city,
    relationshipStart: legalEntities.relationshipStart,
    status: legalEntities.status,
    ownerId: clientGroups.relationshipOwnerId,
    ownerName: users.fullName,
    riskStatus: clientGroups.riskStatus,
    healthScore: clientGroups.healthScore,
  }).from(legalEntities)
    .innerJoin(clientGroups, and(eq(clientGroups.id, legalEntities.clientGroupId), eq(clientGroups.tenantId, tenantId)))
    .leftJoin(users, eq(users.id, clientGroups.relationshipOwnerId))
    .where(and(
      eq(legalEntities.id, clientId),
      eq(legalEntities.tenantId, tenantId),
      includeArchived ? undefined : eq(legalEntities.status, "active"),
    ))
    .limit(1);
  if (!client) return null;

  const [serviceRows, registrationRows, packageHistoryRows] = await Promise.all([
    database.select({ serviceKey: clientServices.serviceKey }).from(clientServices).where(and(
      eq(clientServices.tenantId, tenantId),
      eq(clientServices.legalEntityId, clientId),
      eq(clientServices.status, "active"),
    )).orderBy(asc(clientServices.serviceKey)),
    database.select({ id: registrations.id }).from(registrations).where(and(
      eq(registrations.tenantId, tenantId),
      eq(registrations.legalEntityId, clientId),
      eq(registrations.registrationType, "gst"),
      eq(registrations.status, "active"),
    )),
    database.select({ id: clientPackageAssignments.id }).from(clientPackageAssignments).where(and(
      eq(clientPackageAssignments.tenantId, tenantId), eq(clientPackageAssignments.legalEntityId, clientId),
    )).limit(1),
  ]);

  return {
    ...client,
    ownerId: client.ownerId ?? null,
    ownerName: client.ownerName ?? null,
    riskStatus: client.riskStatus as ClientInput["riskStatus"],
    status: client.status as ClientEditorData["status"],
    services: serviceRows.map((row) => row.serviceKey),
    gstRegistrations: registrationRows.length,
    hasPackageHistory: packageHistoryRows.length > 0,
  };
}

export async function getClient360Data(database: DashboardDatabase, tenantId: string, clientId: string) {
  const client = await getClientEditorData(database, tenantId, clientId, true);
  if (!client) return null;
  const work = await database.select({
    id: workItems.id,
    serviceKey: workItems.serviceKey,
    periodKey: workItems.periodKey,
    status: workItems.status,
    dueDate: workItems.statutoryDueDate,
    progress: workItems.progress,
    missingItems: workItems.missingItemCount,
    blockerNote: workItems.blockerNote,
    assigneeName: users.fullName,
  }).from(workItems)
    .leftJoin(users, eq(users.id, workItems.assigneeId))
    .where(and(eq(workItems.tenantId, tenantId), eq(workItems.legalEntityId, clientId)))
    .orderBy(asc(workItems.statutoryDueDate));
  return { ...client, work } satisfies Client360Data;
}
