import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gte, inArray, lte } from "drizzle-orm";

import { auditEvents, clientGroups, filingAcknowledgements, invoiceLines, invoices, legalEntities, registrations, users, workItems } from "../../db/schema";
import type { DashboardDatabase } from "../dashboard/postgres/repository";
import type { FilingAcknowledgementInput, FilingPortalStatus } from "./validation";
import type { TallyInvoiceExport, TallyLedgerExport } from "../integrations/tally";

export class FilingRepositoryError extends Error {
  constructor(public readonly code: "not_found" | "duplicate" | "mismatch") {
    super(
      code === "not_found" ? "The client or obligation was not found."
        : code === "duplicate" ? "That acknowledgement number is already recorded."
          : "The obligation belongs to a different client.",
    );
    this.name = "FilingRepositoryError";
  }
}

export type FilingAcknowledgementRow = {
  id: string;
  portal: string;
  filingType: string;
  periodKey: string;
  acknowledgementNumber: string;
  filedOn: string;
  portalStatus: FilingPortalStatus;
  source: string;
  remarks: string;
  recordedByName: string;
};

export async function listFilingAcknowledgements(
  database: DashboardDatabase,
  tenantId: string,
  filter: { legalEntityId?: string; workItemId?: string } = {},
): Promise<FilingAcknowledgementRow[]> {
  if (!tenantId.trim()) throw new Error("Tenant is required.");
  const conditions = [eq(filingAcknowledgements.tenantId, tenantId)];
  if (filter.legalEntityId) conditions.push(eq(filingAcknowledgements.legalEntityId, filter.legalEntityId));
  if (filter.workItemId) conditions.push(eq(filingAcknowledgements.workItemId, filter.workItemId));
  const rows = await database.select({
    id: filingAcknowledgements.id,
    portal: filingAcknowledgements.portal,
    filingType: filingAcknowledgements.filingType,
    periodKey: filingAcknowledgements.periodKey,
    acknowledgementNumber: filingAcknowledgements.acknowledgementNumber,
    filedOn: filingAcknowledgements.filedOn,
    portalStatus: filingAcknowledgements.portalStatus,
    source: filingAcknowledgements.source,
    remarks: filingAcknowledgements.remarks,
    recordedByName: users.fullName,
  }).from(filingAcknowledgements)
    .innerJoin(users, eq(users.id, filingAcknowledgements.recordedByUserId))
    .where(and(...conditions))
    .orderBy(desc(filingAcknowledgements.filedOn));
  return rows.map((row) => ({ ...row, portalStatus: row.portalStatus as FilingPortalStatus }));
}

export async function recordFilingAcknowledgement(
  database: DashboardDatabase,
  tenantId: string,
  actorUserId: string,
  input: FilingAcknowledgementInput,
  source: "manual" | "api" = "manual",
) {
  if (!tenantId.trim() || !actorUserId.trim()) throw new Error("Tenant and actor are required.");
  return database.transaction(async (transaction) => {
    const [client] = await transaction.select({ id: legalEntities.id }).from(legalEntities).where(and(
      eq(legalEntities.tenantId, tenantId), eq(legalEntities.id, input.legalEntityId), eq(legalEntities.status, "active"),
    )).limit(1);
    if (!client) throw new FilingRepositoryError("not_found");
    if (input.workItemId) {
      const [item] = await transaction.select({ id: workItems.id }).from(workItems).where(and(
        eq(workItems.tenantId, tenantId), eq(workItems.id, input.workItemId), eq(workItems.legalEntityId, input.legalEntityId),
      )).limit(1);
      if (!item) throw new FilingRepositoryError("mismatch");
    }
    const id = randomUUID();
    const inserted = await transaction.insert(filingAcknowledgements).values({
      id, tenantId, ...input, source, recordedByUserId: actorUserId,
    }).onConflictDoNothing().returning({ id: filingAcknowledgements.id });
    if (inserted.length === 0) throw new FilingRepositoryError("duplicate");
    await transaction.insert(auditEvents).values({
      tenantId, actorUserId, resourceType: "filing_acknowledgement", resourceId: id,
      action: source === "manual" ? "filing.acknowledged" : "filing.acknowledged_from_portal",
      reason: `${input.filingType} ${input.periodKey} · ${input.acknowledgementNumber}`,
    });
    return id;
  });
}

export async function loadTallyLedgerExport(database: DashboardDatabase, tenantId: string): Promise<TallyLedgerExport[]> {
  if (!tenantId.trim()) throw new Error("Tenant is required.");
  const rows = await database.select({
    name: legalEntities.displayName,
    city: legalEntities.city,
    groupName: clientGroups.name,
  }).from(legalEntities)
    .innerJoin(clientGroups, and(eq(clientGroups.tenantId, legalEntities.tenantId), eq(clientGroups.id, legalEntities.clientGroupId)))
    .where(and(eq(legalEntities.tenantId, tenantId), eq(legalEntities.status, "active")))
    .orderBy(asc(legalEntities.displayName));
  const gstRows = await database.select({
    legalEntityId: registrations.legalEntityId,
    registrationKey: registrations.registrationKey,
  }).from(registrations).where(and(
    eq(registrations.tenantId, tenantId), eq(registrations.registrationType, "gst"), eq(registrations.status, "active"),
  ));
  const entityRows = await database.select({ id: legalEntities.id, name: legalEntities.displayName }).from(legalEntities)
    .where(and(eq(legalEntities.tenantId, tenantId), eq(legalEntities.status, "active")));
  const gstinByName = new Map<string, string>();
  const nameById = new Map(entityRows.map((row) => [row.id, row.name]));
  for (const row of gstRows) {
    const name = nameById.get(row.legalEntityId);
    if (name && !gstinByName.has(name)) gstinByName.set(name, row.registrationKey);
  }
  return rows.map((row) => ({
    name: row.name,
    parentGroup: "Sundry Debtors",
    gstin: gstinByName.get(row.name) ?? null,
    state: row.city,
  }));
}

export async function loadTallyInvoiceExport(
  database: DashboardDatabase,
  tenantId: string,
  range: { from: string; to: string },
): Promise<TallyInvoiceExport[]> {
  if (!tenantId.trim()) throw new Error("Tenant is required.");
  const rows = await database.select({
    id: invoices.id,
    invoiceNumber: invoices.invoiceNumber,
    issueDate: invoices.issueDate,
    periodLabel: invoices.periodLabel,
    partyLedgerName: legalEntities.displayName,
    taxPaise: invoices.taxPaise,
    totalPaise: invoices.totalPaise,
  }).from(invoices)
    .innerJoin(legalEntities, and(eq(legalEntities.tenantId, invoices.tenantId), eq(legalEntities.id, invoices.legalEntityId)))
    .where(and(
      eq(invoices.tenantId, tenantId),
      inArray(invoices.status, ["issued", "paid"]),
      gte(invoices.issueDate, range.from),
      lte(invoices.issueDate, range.to),
    ))
    .orderBy(asc(invoices.issueDate));
  if (rows.length === 0) return [];
  const lines = await database.select({
    invoiceId: invoiceLines.invoiceId,
    description: invoiceLines.description,
    amountPaise: invoiceLines.amountPaise,
    position: invoiceLines.position,
  }).from(invoiceLines).where(and(
    eq(invoiceLines.tenantId, tenantId),
    inArray(invoiceLines.invoiceId, rows.map((row) => row.id)),
  )).orderBy(asc(invoiceLines.position));
  const linesByInvoice = new Map<string, Array<{ description: string; amountPaise: number }>>();
  for (const line of lines) {
    linesByInvoice.set(line.invoiceId, [...(linesByInvoice.get(line.invoiceId) ?? []), { description: line.description, amountPaise: line.amountPaise }]);
  }
  return rows.map((row) => ({
    invoiceNumber: row.invoiceNumber,
    invoiceDate: row.issueDate!,
    partyLedgerName: row.partyLedgerName,
    narration: `${row.invoiceNumber} · ${row.periodLabel}`,
    lines: linesByInvoice.get(row.id) ?? [],
    taxPaise: row.taxPaise,
    totalPaise: row.totalPaise,
  }));
}
