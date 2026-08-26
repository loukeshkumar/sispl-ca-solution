import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gt, inArray, isNull, ne, sql } from "drizzle-orm";

import {
  auditEvents,
  clientPortalCredentials,
  clientPortalSessions,
  clientPortalUsers,
  documentRequests,
  documents,
  invoices,
  legalEntities,
  serviceCatalog,
  tenants,
  workItems,
} from "../../db/schema";
import type { DashboardDatabase } from "../dashboard/postgres/repository";
import { hashPassword } from "../auth/password";
import { createTemporaryPassword } from "../auth/temporary-password";

export class PortalRepositoryError extends Error {
  constructor(public readonly code: "not_found" | "duplicate_email" | "invalid_state") {
    super(
      code === "not_found" ? "The portal contact was not found."
        : code === "duplicate_email" ? "That email already has portal access for this firm."
          : "The portal contact cannot move to that state.",
    );
    this.name = "PortalRepositoryError";
  }
}

export type PortalLoginIdentity = {
  portalUserId: string;
  tenantId: string;
  legalEntityId: string;
  email: string;
  fullName: string;
  passwordHash: string;
  lockedUntil: Date | null;
};

export type PortalSession = {
  sessionId: string;
  portalUserId: string;
  tenantId: string;
  tenantName: string;
  legalEntityId: string;
  clientName: string;
  email: string;
  fullName: string;
  mustChangePassword: boolean;
};

export type PortalObligation = {
  id: string;
  serviceLabel: string;
  periodKey: string;
  statutoryDueDate: string;
  status: string;
};

export type PortalDocumentRequest = {
  id: string;
  title: string;
  description: string;
  dueDate: string;
  status: string;
  fulfilled: boolean;
};

export type PortalInvoice = {
  id: string;
  invoiceNumber: string;
  periodLabel: string;
  status: string;
  totalPaise: number;
  issueDate: string | null;
  dueDate: string | null;
};

export type PortalOverview = {
  obligations: PortalObligation[];
  requests: PortalDocumentRequest[];
  invoices: PortalInvoice[];
  metrics: { openRequests: number; overdueRequests: number; upcomingObligations: number; outstandingPaise: number };
  todayKey: string;
};

export function indiaDateKey(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function requireScope(tenantId: string, legalEntityId: string) {
  if (!tenantId.trim() || !legalEntityId.trim()) throw new Error("Tenant and client scope are required.");
}

export async function findPortalLoginIdentity(database: DashboardDatabase, email: string, tenantSlug: string): Promise<PortalLoginIdentity | null> {
  const normalizedEmail = email.trim().toLowerCase();
  const normalizedSlug = tenantSlug.trim().toLowerCase();
  if (!normalizedEmail || !normalizedSlug) return null;
  const [identity] = await database.select({
    portalUserId: clientPortalUsers.id,
    tenantId: clientPortalUsers.tenantId,
    legalEntityId: clientPortalUsers.legalEntityId,
    email: clientPortalUsers.email,
    fullName: clientPortalUsers.fullName,
    passwordHash: clientPortalCredentials.passwordHash,
    lockedUntil: clientPortalCredentials.lockedUntil,
  }).from(clientPortalUsers)
    .innerJoin(clientPortalCredentials, eq(clientPortalCredentials.portalUserId, clientPortalUsers.id))
    .innerJoin(tenants, eq(tenants.id, clientPortalUsers.tenantId))
    .innerJoin(legalEntities, and(eq(legalEntities.tenantId, clientPortalUsers.tenantId), eq(legalEntities.id, clientPortalUsers.legalEntityId)))
    .where(and(
      eq(sql`lower(${clientPortalUsers.email})`, normalizedEmail),
      eq(sql`lower(${tenants.slug})`, normalizedSlug),
      ne(clientPortalUsers.status, "disabled"),
      eq(tenants.status, "active"),
      eq(legalEntities.status, "active"),
    )).limit(1);
  return identity ?? null;
}

export async function recordFailedPortalLogin(database: DashboardDatabase, portalUserId: string, now = new Date()) {
  await database.update(clientPortalCredentials).set({
    failedLoginAttempts: sql`case when ${clientPortalCredentials.failedLoginAttempts} >= 4 then 0 else ${clientPortalCredentials.failedLoginAttempts} + 1 end`,
    lockedUntil: sql`case when ${clientPortalCredentials.failedLoginAttempts} >= 4 then ${new Date(now.getTime() + 15 * 60_000)}::timestamptz else null end`,
  }).where(eq(clientPortalCredentials.portalUserId, portalUserId));
}

export async function clearFailedPortalLogins(database: DashboardDatabase, portalUserId: string) {
  await database.update(clientPortalCredentials).set({ failedLoginAttempts: 0, lockedUntil: null })
    .where(eq(clientPortalCredentials.portalUserId, portalUserId));
}

export async function createPortalSessionRecord(database: DashboardDatabase, input: { tenantId: string; portalUserId: string; tokenHash: string; expiresAt: Date }) {
  const [session] = await database.insert(clientPortalSessions).values(input).returning({ id: clientPortalSessions.id });
  if (!session) throw new Error("The portal session could not be created.");
  await database.update(clientPortalUsers).set({ status: "active", updatedAt: new Date() }).where(and(
    eq(clientPortalUsers.id, input.portalUserId), eq(clientPortalUsers.status, "invited"),
  ));
  return session.id;
}

export async function findPortalSessionByTokenHash(database: DashboardDatabase, tokenHash: string, now = new Date()): Promise<PortalSession | null> {
  if (!tokenHash) return null;
  const [session] = await database.select({
    sessionId: clientPortalSessions.id,
    portalUserId: clientPortalUsers.id,
    tenantId: clientPortalUsers.tenantId,
    tenantName: tenants.displayName,
    legalEntityId: clientPortalUsers.legalEntityId,
    clientName: legalEntities.displayName,
    email: clientPortalUsers.email,
    fullName: clientPortalUsers.fullName,
    mustChangePassword: clientPortalCredentials.mustChangePassword,
  }).from(clientPortalSessions)
    .innerJoin(clientPortalUsers, and(eq(clientPortalUsers.tenantId, clientPortalSessions.tenantId), eq(clientPortalUsers.id, clientPortalSessions.portalUserId)))
    .innerJoin(clientPortalCredentials, eq(clientPortalCredentials.portalUserId, clientPortalUsers.id))
    .innerJoin(tenants, eq(tenants.id, clientPortalUsers.tenantId))
    .innerJoin(legalEntities, and(eq(legalEntities.tenantId, clientPortalUsers.tenantId), eq(legalEntities.id, clientPortalUsers.legalEntityId)))
    .where(and(
      eq(clientPortalSessions.tokenHash, tokenHash),
      gt(clientPortalSessions.expiresAt, now),
      isNull(clientPortalSessions.revokedAt),
      eq(clientPortalUsers.status, "active"),
      eq(tenants.status, "active"),
      eq(legalEntities.status, "active"),
    )).limit(1);
  return session ?? null;
}

export async function revokePortalSessionByTokenHash(database: DashboardDatabase, tokenHash: string) {
  await database.update(clientPortalSessions).set({ revokedAt: new Date() }).where(and(
    eq(clientPortalSessions.tokenHash, tokenHash), isNull(clientPortalSessions.revokedAt),
  ));
}

export async function changePortalPassword(database: DashboardDatabase, tenantId: string, portalUserId: string, passwordHash: string) {
  await database.transaction(async (transaction) => {
    const [updated] = await transaction.update(clientPortalCredentials).set({
      passwordHash, mustChangePassword: false, passwordChangedAt: new Date(), failedLoginAttempts: 0, lockedUntil: null,
    }).where(and(eq(clientPortalCredentials.portalUserId, portalUserId), eq(clientPortalCredentials.tenantId, tenantId)))
      .returning({ portalUserId: clientPortalCredentials.portalUserId });
    if (!updated) throw new PortalRepositoryError("not_found");
    await transaction.update(clientPortalSessions).set({ revokedAt: new Date() }).where(and(
      eq(clientPortalSessions.tenantId, tenantId), eq(clientPortalSessions.portalUserId, portalUserId), isNull(clientPortalSessions.revokedAt),
    ));
  });
}

export type PortalContactView = { id: string; email: string; fullName: string; status: string; createdAt: string };

export async function listPortalContacts(database: DashboardDatabase, tenantId: string, legalEntityId: string): Promise<PortalContactView[]> {
  requireScope(tenantId, legalEntityId);
  const rows = await database.select({
    id: clientPortalUsers.id,
    email: clientPortalUsers.email,
    fullName: clientPortalUsers.fullName,
    status: clientPortalUsers.status,
    createdAt: clientPortalUsers.createdAt,
  }).from(clientPortalUsers).where(and(
    eq(clientPortalUsers.tenantId, tenantId), eq(clientPortalUsers.legalEntityId, legalEntityId),
  )).orderBy(asc(clientPortalUsers.fullName));
  return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
}

export async function provisionPortalContact(
  database: DashboardDatabase,
  tenantId: string,
  actorUserId: string,
  input: { legalEntityId: string; email: string; fullName: string },
) {
  if (!tenantId.trim() || !actorUserId.trim()) throw new Error("Tenant and actor are required.");
  const temporaryPassword = createTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);
  const portalUserId = await database.transaction(async (transaction) => {
    const [client] = await transaction.select({ id: legalEntities.id }).from(legalEntities).where(and(
      eq(legalEntities.tenantId, tenantId), eq(legalEntities.id, input.legalEntityId), eq(legalEntities.status, "active"),
    )).limit(1);
    if (!client) throw new PortalRepositoryError("not_found");
    const [existing] = await transaction.select({ id: clientPortalUsers.id, legalEntityId: clientPortalUsers.legalEntityId })
      .from(clientPortalUsers).where(and(
        eq(clientPortalUsers.tenantId, tenantId),
        eq(sql`lower(${clientPortalUsers.email})`, input.email.toLowerCase()),
      )).limit(1).for("update");
    if (existing && existing.legalEntityId !== input.legalEntityId) throw new PortalRepositoryError("duplicate_email");
    const id = existing?.id ?? randomUUID();
    if (existing) {
      await transaction.update(clientPortalUsers).set({ fullName: input.fullName, status: "invited", updatedAt: new Date() })
        .where(and(eq(clientPortalUsers.tenantId, tenantId), eq(clientPortalUsers.id, id)));
      await transaction.update(clientPortalCredentials).set({ passwordHash, mustChangePassword: true, passwordChangedAt: new Date(), failedLoginAttempts: 0, lockedUntil: null })
        .where(eq(clientPortalCredentials.portalUserId, id));
      await transaction.update(clientPortalSessions).set({ revokedAt: new Date() }).where(and(
        eq(clientPortalSessions.tenantId, tenantId), eq(clientPortalSessions.portalUserId, id), isNull(clientPortalSessions.revokedAt),
      ));
    } else {
      await transaction.insert(clientPortalUsers).values({
        id, tenantId, legalEntityId: input.legalEntityId, email: input.email, fullName: input.fullName,
        status: "invited", createdByUserId: actorUserId,
      });
      await transaction.insert(clientPortalCredentials).values({ portalUserId: id, tenantId, passwordHash, mustChangePassword: true });
    }
    await transaction.insert(auditEvents).values({
      tenantId, actorUserId, resourceType: "client_portal_user", resourceId: id,
      action: existing ? "client_portal.reprovisioned" : "client_portal.provisioned", reason: input.email,
    });
    return id;
  });
  return { portalUserId, temporaryPassword };
}

export async function disablePortalContact(database: DashboardDatabase, tenantId: string, actorUserId: string, portalUserId: string) {
  if (!tenantId.trim() || !actorUserId.trim()) throw new Error("Tenant and actor are required.");
  await database.transaction(async (transaction) => {
    const [updated] = await transaction.update(clientPortalUsers).set({ status: "disabled", updatedAt: new Date() }).where(and(
      eq(clientPortalUsers.tenantId, tenantId), eq(clientPortalUsers.id, portalUserId), ne(clientPortalUsers.status, "disabled"),
    )).returning({ id: clientPortalUsers.id });
    if (!updated) throw new PortalRepositoryError("invalid_state");
    await transaction.update(clientPortalSessions).set({ revokedAt: new Date() }).where(and(
      eq(clientPortalSessions.tenantId, tenantId), eq(clientPortalSessions.portalUserId, portalUserId), isNull(clientPortalSessions.revokedAt),
    ));
    await transaction.insert(auditEvents).values({
      tenantId, actorUserId, resourceType: "client_portal_user", resourceId: portalUserId, action: "client_portal.disabled",
    });
  });
}

export async function getPortalOverview(database: DashboardDatabase, tenantId: string, legalEntityId: string, todayKey = indiaDateKey()): Promise<PortalOverview> {
  requireScope(tenantId, legalEntityId);
  const [obligationRows, requestRows, invoiceRows] = await Promise.all([
    database.select({
      id: workItems.id,
      serviceKey: workItems.serviceKey,
      serviceName: serviceCatalog.name,
      periodKey: workItems.periodKey,
      statutoryDueDate: workItems.statutoryDueDate,
      status: workItems.status,
    }).from(workItems)
      .leftJoin(serviceCatalog, and(eq(serviceCatalog.tenantId, workItems.tenantId), eq(sql`lower(${serviceCatalog.code})`, sql`lower(${workItems.serviceKey})`)))
      .where(and(eq(workItems.tenantId, tenantId), eq(workItems.legalEntityId, legalEntityId)))
      .orderBy(asc(workItems.statutoryDueDate)),
    database.select({
      id: documentRequests.id,
      title: documentRequests.title,
      description: documentRequests.description,
      dueDate: documentRequests.dueDate,
      status: documentRequests.status,
      documentId: documents.id,
    }).from(documentRequests)
      .leftJoin(documents, and(eq(documents.tenantId, documentRequests.tenantId), eq(documents.requestId, documentRequests.id), eq(documents.status, "ready")))
      .where(and(
        eq(documentRequests.tenantId, tenantId),
        eq(documentRequests.legalEntityId, legalEntityId),
        ne(documentRequests.status, "cancelled"),
      )).orderBy(asc(documentRequests.dueDate)),
    database.select({
      id: invoices.id,
      invoiceNumber: invoices.invoiceNumber,
      periodLabel: invoices.periodLabel,
      status: invoices.status,
      totalPaise: invoices.totalPaise,
      issueDate: invoices.issueDate,
      dueDate: invoices.dueDate,
    }).from(invoices).where(and(
      eq(invoices.tenantId, tenantId),
      eq(invoices.legalEntityId, legalEntityId),
      inArray(invoices.status, ["issued", "paid"]),
    )).orderBy(desc(invoices.issueDate)),
  ]);

  const obligations = obligationRows.map((row) => ({
    id: row.id,
    serviceLabel: row.serviceName ?? row.serviceKey.replaceAll("_", " ").toUpperCase(),
    periodKey: row.periodKey,
    statutoryDueDate: row.statutoryDueDate,
    status: row.status,
  }));
  const requests = requestRows.map((row) => ({
    id: row.id,
    title: row.title,
    description: row.description,
    dueDate: row.dueDate,
    status: row.status,
    fulfilled: row.documentId !== null,
  }));
  const openRequests = requests.filter((request) => request.status === "requested");
  return {
    obligations,
    requests,
    invoices: invoiceRows,
    metrics: {
      openRequests: openRequests.length,
      overdueRequests: openRequests.filter((request) => request.dueDate < todayKey).length,
      upcomingObligations: obligations.filter((obligation) => obligation.status !== "completed").length,
      outstandingPaise: invoiceRows.filter((invoice) => invoice.status === "issued").reduce((sum, invoice) => sum + invoice.totalPaise, 0),
    },
    todayKey,
  };
}

export async function getPortalDocumentRequest(database: DashboardDatabase, tenantId: string, legalEntityId: string, requestId: string) {
  requireScope(tenantId, legalEntityId);
  const [row] = await database.select({
    id: documentRequests.id,
    title: documentRequests.title,
    description: documentRequests.description,
    dueDate: documentRequests.dueDate,
    workItemId: documentRequests.workItemId,
    requestedByUserId: documentRequests.requestedByUserId,
  }).from(documentRequests).where(and(
    eq(documentRequests.tenantId, tenantId),
    eq(documentRequests.legalEntityId, legalEntityId),
    eq(documentRequests.id, requestId),
    eq(documentRequests.status, "requested"),
  )).limit(1);
  return row ?? null;
}
