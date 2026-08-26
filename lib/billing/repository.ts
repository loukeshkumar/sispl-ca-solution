import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, lte, ne, or, gte, sql } from "drizzle-orm";

import { auditEvents, clientPackageAssignments, invoiceLines, invoices, legalEntities, tenants } from "../../db/schema";
import type { DashboardDatabase } from "../dashboard/postgres/repository";
import { releaseEntries } from "./time-billing-repository";
import { invoiceSubtotalPaise, type InvoiceInput, type InvoiceLineType, type InvoiceStatus } from "./validation";

export class BillingRepositoryError extends Error {
  constructor(public readonly code: "not_found" | "invalid_state" | "invalid_client" | "invalid_assignment") {
    super(
      code === "not_found" ? "Invoice not found or no longer available."
        : code === "invalid_state" ? "The invoice cannot move to that state."
          : code === "invalid_client" ? "Select an active client for the invoice."
            : "The package agreement does not belong to the selected client.",
    );
    this.name = "BillingRepositoryError";
  }
}

export function indiaDateKey(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export type InvoiceRow = {
  id: string;
  invoiceNumber: string;
  clientName: string;
  legalEntityId: string;
  periodLabel: string;
  status: InvoiceStatus;
  totalPaise: number;
  issueDate: string | null;
  dueDate: string | null;
  createdAt: string;
};

export type InvoiceLineRow = {
  id: string;
  lineType: InvoiceLineType;
  description: string;
  amountPaise: number;
  position: number;
};

export type InvoiceDetail = {
  id: string;
  invoiceNumber: string;
  clientName: string;
  legalEntityId: string;
  assignmentId: string | null;
  periodLabel: string;
  notes: string;
  status: InvoiceStatus;
  subtotalPaise: number;
  taxPaise: number;
  totalPaise: number;
  issueDate: string | null;
  dueDate: string | null;
  paymentReference: string;
  cancellationReason: string;
  paidAt: string | null;
  lines: InvoiceLineRow[];
};

export type BillingWorkspaceData = {
  invoices: InvoiceRow[];
  metrics: {
    draftCount: number;
    outstandingPaise: number;
    overdueCount: number;
    overduePaise: number;
    collectedThisMonthPaise: number;
  };
  todayKey: string;
};

export type InvoiceFormOptions = {
  clients: Array<{ id: string; name: string }>;
  assignments: Array<{ id: string; legalEntityId: string; packageName: string; billingCycle: string; agreedFeePaise: number }>;
};

function requireActor(tenantId: string, actorUserId: string) {
  if (!tenantId.trim() || !actorUserId.trim()) throw new Error("Tenant and actor are required.");
}

const statusRank: Record<string, number> = { issued: 0, draft: 1, paid: 2, cancelled: 3 };

export function buildBillingWorkspace(rows: Array<Omit<InvoiceRow, "createdAt" | "status"> & { status: string; createdAt: Date; paidAt: Date | null }>, todayKey: string): BillingWorkspaceData {
  const invoiceRows: Array<InvoiceRow & { paidAt: Date | null }> = rows.map((row) => ({
    ...row,
    status: row.status as InvoiceStatus,
    createdAt: row.createdAt.toISOString(),
  })).sort((left, right) => {
    const byStatus = (statusRank[left.status] ?? 9) - (statusRank[right.status] ?? 9);
    if (byStatus) return byStatus;
    return right.createdAt.localeCompare(left.createdAt);
  });
  const issued = invoiceRows.filter((invoice) => invoice.status === "issued");
  const overdue = issued.filter((invoice) => invoice.dueDate !== null && invoice.dueDate < todayKey);
  const monthPrefix = todayKey.slice(0, 7);
  const collectedThisMonthPaise = invoiceRows
    .filter((invoice) => invoice.status === "paid" && invoice.paidAt !== null && invoice.paidAt.toISOString().slice(0, 7) === monthPrefix)
    .reduce((sum, invoice) => sum + invoice.totalPaise, 0);
  return {
    invoices: invoiceRows.map((invoice) => ({
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      clientName: invoice.clientName,
      legalEntityId: invoice.legalEntityId,
      periodLabel: invoice.periodLabel,
      status: invoice.status,
      totalPaise: invoice.totalPaise,
      issueDate: invoice.issueDate,
      dueDate: invoice.dueDate,
      createdAt: invoice.createdAt,
    })),
    metrics: {
      draftCount: invoiceRows.filter((invoice) => invoice.status === "draft").length,
      outstandingPaise: issued.reduce((sum, invoice) => sum + invoice.totalPaise, 0),
      overdueCount: overdue.length,
      overduePaise: overdue.reduce((sum, invoice) => sum + invoice.totalPaise, 0),
      collectedThisMonthPaise,
    },
    todayKey,
  };
}

export async function listBillingWorkspace(database: DashboardDatabase, tenantId: string, todayKey = indiaDateKey()): Promise<BillingWorkspaceData> {
  if (!tenantId.trim()) throw new Error("Tenant is required.");
  const rows = await database.select({
    id: invoices.id,
    invoiceNumber: invoices.invoiceNumber,
    clientName: legalEntities.displayName,
    legalEntityId: invoices.legalEntityId,
    periodLabel: invoices.periodLabel,
    status: invoices.status,
    totalPaise: invoices.totalPaise,
    issueDate: invoices.issueDate,
    dueDate: invoices.dueDate,
    createdAt: invoices.createdAt,
    paidAt: invoices.paidAt,
  }).from(invoices)
    .innerJoin(legalEntities, and(eq(legalEntities.tenantId, invoices.tenantId), eq(legalEntities.id, invoices.legalEntityId)))
    .where(eq(invoices.tenantId, tenantId))
    .orderBy(desc(invoices.createdAt));
  return buildBillingWorkspace(rows, todayKey);
}

export async function getInvoiceDetail(database: DashboardDatabase, tenantId: string, invoiceId: string): Promise<InvoiceDetail | null> {
  if (!tenantId.trim()) throw new Error("Tenant is required.");
  const [row] = await database.select({
    id: invoices.id,
    invoiceNumber: invoices.invoiceNumber,
    clientName: legalEntities.displayName,
    legalEntityId: invoices.legalEntityId,
    assignmentId: invoices.assignmentId,
    periodLabel: invoices.periodLabel,
    notes: invoices.notes,
    status: invoices.status,
    subtotalPaise: invoices.subtotalPaise,
    taxPaise: invoices.taxPaise,
    totalPaise: invoices.totalPaise,
    issueDate: invoices.issueDate,
    dueDate: invoices.dueDate,
    paymentReference: invoices.paymentReference,
    cancellationReason: invoices.cancellationReason,
    paidAt: invoices.paidAt,
  }).from(invoices)
    .innerJoin(legalEntities, and(eq(legalEntities.tenantId, invoices.tenantId), eq(legalEntities.id, invoices.legalEntityId)))
    .where(and(eq(invoices.tenantId, tenantId), eq(invoices.id, invoiceId)))
    .limit(1);
  if (!row) return null;
  const lines = await database.select({
    id: invoiceLines.id,
    lineType: invoiceLines.lineType,
    description: invoiceLines.description,
    amountPaise: invoiceLines.amountPaise,
    position: invoiceLines.position,
  }).from(invoiceLines).where(and(eq(invoiceLines.tenantId, tenantId), eq(invoiceLines.invoiceId, invoiceId))).orderBy(asc(invoiceLines.position));
  return {
    ...row,
    status: row.status as InvoiceStatus,
    paidAt: row.paidAt?.toISOString() ?? null,
    lines: lines.map((line) => ({ ...line, lineType: line.lineType as InvoiceLineType })),
  };
}

export async function listInvoiceFormOptions(database: DashboardDatabase, tenantId: string, todayKey = indiaDateKey()): Promise<InvoiceFormOptions> {
  if (!tenantId.trim()) throw new Error("Tenant is required.");
  const [clients, assignments] = await Promise.all([
    database.select({ id: legalEntities.id, name: legalEntities.displayName }).from(legalEntities)
      .where(and(eq(legalEntities.tenantId, tenantId), eq(legalEntities.status, "active"))).orderBy(asc(legalEntities.displayName)),
    database.select({
      id: clientPackageAssignments.id,
      legalEntityId: clientPackageAssignments.legalEntityId,
      packageName: clientPackageAssignments.packageNameSnapshot,
      billingCycle: clientPackageAssignments.billingCycleSnapshot,
      agreedFeePaise: clientPackageAssignments.agreedFeePaiseSnapshot,
    }).from(clientPackageAssignments).where(and(
      eq(clientPackageAssignments.tenantId, tenantId),
      eq(clientPackageAssignments.status, "active"),
      lte(clientPackageAssignments.effectiveFrom, todayKey),
      or(isNull(clientPackageAssignments.effectiveTo), gte(clientPackageAssignments.effectiveTo, todayKey)),
    )),
  ]);
  return { clients, assignments };
}

export async function createInvoice(database: DashboardDatabase, tenantId: string, actorUserId: string, input: InvoiceInput) {
  requireActor(tenantId, actorUserId);
  return database.transaction(async (transaction) => {
    await transaction.select({ id: tenants.id }).from(tenants).where(eq(tenants.id, tenantId)).limit(1).for("update");
    const [client] = await transaction.select({ id: legalEntities.id }).from(legalEntities).where(and(
      eq(legalEntities.tenantId, tenantId), eq(legalEntities.id, input.legalEntityId), eq(legalEntities.status, "active"),
    )).limit(1);
    if (!client) throw new BillingRepositoryError("invalid_client");
    if (input.assignmentId) {
      const [assignment] = await transaction.select({ id: clientPackageAssignments.id }).from(clientPackageAssignments).where(and(
        eq(clientPackageAssignments.tenantId, tenantId),
        eq(clientPackageAssignments.id, input.assignmentId),
        eq(clientPackageAssignments.legalEntityId, input.legalEntityId),
        ne(clientPackageAssignments.status, "cancelled"),
      )).limit(1);
      if (!assignment) throw new BillingRepositoryError("invalid_assignment");
    }
    const [sequence] = await transaction.select({ next: sql<number>`coalesce(max(${invoices.invoiceSeq}), 0) + 1` }).from(invoices).where(eq(invoices.tenantId, tenantId));
    const invoiceSeq = sequence?.next ?? 1;
    const subtotalPaise = invoiceSubtotalPaise(input.lines);
    const id = randomUUID();
    await transaction.insert(invoices).values({
      id,
      tenantId,
      legalEntityId: input.legalEntityId,
      assignmentId: input.assignmentId,
      invoiceSeq,
      invoiceNumber: `INV-${String(invoiceSeq).padStart(5, "0")}`,
      periodLabel: input.periodLabel,
      notes: input.notes,
      status: "draft",
      subtotalPaise,
      taxPaise: input.taxPaise,
      totalPaise: subtotalPaise + input.taxPaise,
      createdByUserId: actorUserId,
    });
    await transaction.insert(invoiceLines).values(input.lines.map((line, index) => ({
      tenantId,
      invoiceId: id,
      lineType: line.lineType,
      description: line.description,
      amountPaise: line.amountPaise,
      position: index + 1,
    })));
    await transaction.insert(auditEvents).values({ tenantId, actorUserId, resourceType: "invoice", resourceId: id, action: "invoice.created", reason: input.periodLabel });
    return id;
  });
}

export async function issueInvoice(database: DashboardDatabase, tenantId: string, actorUserId: string, invoiceId: string, dates: { issueDate: string; dueDate: string }) {
  requireActor(tenantId, actorUserId);
  await database.transaction(async (transaction) => {
    const now = new Date();
    const [updated] = await transaction.update(invoices).set({
      status: "issued",
      issueDate: dates.issueDate,
      dueDate: dates.dueDate,
      issuedAt: now,
      issuedByUserId: actorUserId,
      updatedAt: now,
    }).where(and(eq(invoices.id, invoiceId), eq(invoices.tenantId, tenantId), eq(invoices.status, "draft"))).returning({ id: invoices.id });
    if (!updated) throw new BillingRepositoryError("invalid_state");
    await transaction.insert(auditEvents).values({ tenantId, actorUserId, resourceType: "invoice", resourceId: invoiceId, action: "invoice.issued", reason: `Due ${dates.dueDate}` });
  });
}

export async function recordInvoicePayment(database: DashboardDatabase, tenantId: string, actorUserId: string, invoiceId: string, paymentReference: string) {
  requireActor(tenantId, actorUserId);
  await database.transaction(async (transaction) => {
    const now = new Date();
    const [updated] = await transaction.update(invoices).set({
      status: "paid",
      paidAt: now,
      paymentRecordedByUserId: actorUserId,
      paymentReference,
      updatedAt: now,
    }).where(and(eq(invoices.id, invoiceId), eq(invoices.tenantId, tenantId), eq(invoices.status, "issued"))).returning({ id: invoices.id });
    if (!updated) throw new BillingRepositoryError("invalid_state");
    await transaction.insert(auditEvents).values({ tenantId, actorUserId, resourceType: "invoice", resourceId: invoiceId, action: "invoice.paid", reason: paymentReference || null });
  });
}

export async function cancelInvoice(database: DashboardDatabase, tenantId: string, actorUserId: string, invoiceId: string, reason: string) {
  requireActor(tenantId, actorUserId);
  await database.transaction(async (transaction) => {
    const now = new Date();
    const [updated] = await transaction.update(invoices).set({
      status: "cancelled",
      cancelledAt: now,
      cancellationReason: reason,
      updatedAt: now,
    }).where(and(eq(invoices.id, invoiceId), eq(invoices.tenantId, tenantId), inArray(invoices.status, ["draft", "issued"]))).returning({ id: invoices.id });
    if (!updated) throw new BillingRepositoryError("invalid_state");
    // Time held by an invoice nobody sent is time the firm can never bill, which
    // is a worse failure than the double-billing the claim exists to prevent.
    const released = await releaseEntries(transaction, tenantId, invoiceId);
    await transaction.insert(auditEvents).values({
      tenantId, actorUserId, resourceType: "invoice", resourceId: invoiceId, action: "invoice.cancelled",
      reason: released > 0 ? `${reason} — ${released} time entr${released === 1 ? "y" : "ies"} released` : reason,
    });
  });
}
