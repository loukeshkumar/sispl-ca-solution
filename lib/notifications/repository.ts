import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, isNull, lte, ne, sql } from "drizzle-orm";

import { documentRequests, invoices, legalEntities, notificationDeliveries, notifications, tenants, workDependencies, workItems } from "../../db/schema";
import type { DashboardDatabase } from "../dashboard/postgres/repository";
import { loadRegisterAlertRows } from "../registers/repository";

/**
 * Deadline types are raised by the nightly job; the rest are raised inline, at
 * the moment the thing happens. Either way the notification is visible in the
 * app immediately — only the email and WhatsApp deliveries wait for the job.
 */
export type NotificationType = "work_item_due" | "work_item_overdue" | "document_request_overdue" | "task_assigned" | "attendance_request_raised" | "attendance_request_decided" | "payslip_published" | "invoice_overdue" | "dsc_expiring" | "notice_due" | "work_dependency_cleared" | "work_dependency_overdue" | "work_item_escalated";
export type NotificationResourceType = "" | "work_item" | "document_request" | "office_task" | "leave_request" | "attendance_correction_request" | "payroll_entry" | "invoice" | "dsc_certificate" | "statutory_notice";
export type NotificationChannel = "email" | "whatsapp";

export type NotificationDraft = {
  recipientUserId: string;
  type: NotificationType;
  title: string;
  body: string;
  resourceType: NotificationResourceType;
  resourceId: string | null;
  dedupeKey: string | null;
};

export type NotificationRow = {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  resourceType: NotificationResourceType;
  resourceId: string | null;
  readAt: string | null;
  createdAt: string;
};

export type NotificationWorkspaceData = {
  notifications: NotificationRow[];
  unreadCount: number;
};

const DUE_SOON_WINDOW_DAYS = 3;

export function indiaDateKey(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function addDaysToDateKey(dateKey: string, days: number) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

function serviceLabel(serviceKey: string) {
  return serviceKey.replaceAll("_", " ").toUpperCase();
}

export type DeadlineScanWorkItem = {
  id: string;
  serviceKey: string;
  periodKey: string;
  statutoryDueDate: string;
  entityName: string;
  assigneeId: string | null;
};

export type DeadlineScanDocumentRequest = {
  id: string;
  title: string;
  dueDate: string;
  entityName: string;
  requestedByUserId: string;
};

export type DeadlineScanRegisterAlert = {
  id: string;
  label: string;
  dueDate: string;
  recipientUserId: string;
  kind: "dsc_expiring" | "notice_due" | "work_dependency_cleared" | "work_dependency_overdue" | "work_item_escalated";
};

export type DeadlineScanInvoice = {
  id: string;
  invoiceNumber: string;
  dueDate: string;
  entityName: string;
  createdByUserId: string;
};

export type DeadlineScanDependency = {
  assigneeId: string | null;
  clientName: string;
  expectedOn: string;
  id: string;
  periodKey: string;
  serviceKey: string;
  title: string;
  workItemId: string;
};

export function buildDeadlineNotificationDrafts(input: {
  dependencies?: DeadlineScanDependency[];
  workItems: DeadlineScanWorkItem[];
  documentRequests: DeadlineScanDocumentRequest[];
  invoices?: DeadlineScanInvoice[];
  registerAlerts?: DeadlineScanRegisterAlert[];
  todayKey: string;
}): NotificationDraft[] {
  const drafts: NotificationDraft[] = [];
  for (const item of input.workItems) {
    if (!item.assigneeId) continue;
    const overdue = item.statutoryDueDate < input.todayKey;
    if (!overdue && item.statutoryDueDate > addDaysToDateKey(input.todayKey, DUE_SOON_WINDOW_DAYS)) continue;
    drafts.push({
      recipientUserId: item.assigneeId,
      type: overdue ? "work_item_overdue" : "work_item_due",
      title: overdue
        ? `${serviceLabel(item.serviceKey)} for ${item.entityName} is overdue`
        : `${serviceLabel(item.serviceKey)} for ${item.entityName} is due by ${item.statutoryDueDate}`,
      body: `${serviceLabel(item.serviceKey)} · ${item.periodKey} · statutory due date ${item.statutoryDueDate}.`,
      resourceType: "work_item",
      resourceId: item.id,
      dedupeKey: `${overdue ? "work_item_overdue" : "work_item_due"}:${item.id}:${item.statutoryDueDate}`,
    });
  }
  for (const request of input.documentRequests) {
    if (request.dueDate >= input.todayKey) continue;
    drafts.push({
      recipientUserId: request.requestedByUserId,
      type: "document_request_overdue",
      title: `Documents for ${request.entityName} are past due`,
      body: `"${request.title}" was due on ${request.dueDate} and is still awaited.`,
      resourceType: "document_request",
      resourceId: request.id,
      dedupeKey: `document_request_overdue:${request.id}:${request.dueDate}`,
    });
  }
  for (const invoice of input.invoices ?? []) {
    if (invoice.dueDate >= input.todayKey) continue;
    drafts.push({
      recipientUserId: invoice.createdByUserId,
      type: "invoice_overdue",
      title: `Invoice ${invoice.invoiceNumber} for ${invoice.entityName} is overdue`,
      body: `Payment was due on ${invoice.dueDate} and has not been recorded.`,
      resourceType: "invoice",
      resourceId: invoice.id,
      dedupeKey: `invoice_overdue:${invoice.id}:${invoice.dueDate}`,
    });
  }
  // Something the firm is waiting on, past the day it was expected. The person
  // holding the work is the one who has to chase it.
  for (const dependency of input.dependencies ?? []) {
    if (!dependency.assigneeId) continue;
    drafts.push({
      recipientUserId: dependency.assigneeId,
      type: "work_dependency_overdue",
      title: `"${dependency.title}" for ${dependency.clientName} has not arrived`,
      body: `${serviceLabel(dependency.serviceKey)} · ${dependency.periodKey} is still waiting on it. Expected ${dependency.expectedOn}.`,
      resourceType: "work_item",
      resourceId: dependency.workItemId,
      dedupeKey: `work_dependency_overdue:${dependency.id}:${dependency.expectedOn}`,
    });
  }
  for (const alert of input.registerAlerts ?? []) {
    const overdue = alert.dueDate < input.todayKey;
    drafts.push({
      recipientUserId: alert.recipientUserId,
      type: alert.kind,
      title: alert.kind === "dsc_expiring"
        ? `${alert.label} ${overdue ? "has expired" : `expires on ${alert.dueDate}`}`
        : `${alert.label} ${overdue ? "response is overdue" : `must be answered by ${alert.dueDate}`}`,
      body: alert.kind === "dsc_expiring"
        ? `Renew or surrender the certificate before it is needed for signing. Validity ends ${alert.dueDate}.`
        : `The statutory response deadline is ${alert.dueDate}.`,
      resourceType: alert.kind === "dsc_expiring" ? "dsc_certificate" : "statutory_notice",
      resourceId: alert.id,
      dedupeKey: `${alert.kind}:${alert.id}:${alert.dueDate}`,
    });
  }
  return drafts;
}

function requireIdentity(tenantId: string, userId?: string) {
  if (!tenantId.trim() || (userId !== undefined && !userId.trim())) throw new Error("Tenant and recipient are required.");
}

type InsertClient = Pick<DashboardDatabase, "insert">;

export async function insertNotifications(database: InsertClient, tenantId: string, drafts: NotificationDraft[], channels: NotificationChannel[] = ["email"]) {
  requireIdentity(tenantId);
  let created = 0;
  for (const draft of drafts) {
    const id = randomUUID();
    const inserted = await database.insert(notifications).values({
      id,
      tenantId,
      recipientUserId: draft.recipientUserId,
      type: draft.type,
      title: draft.title.trim().slice(0, 200),
      body: draft.body.slice(0, 2000),
      resourceType: draft.resourceType,
      resourceId: draft.resourceId,
      dedupeKey: draft.dedupeKey,
    }).onConflictDoNothing().returning({ id: notifications.id });
    if (inserted.length === 0) continue;
    created += 1;
    if (channels.length > 0) {
      await database.insert(notificationDeliveries).values(channels.map((channel) => ({ id: randomUUID(), tenantId, notificationId: id, channel })));
    }
  }
  return created;
}

export async function generateDeadlineNotifications(database: DashboardDatabase, tenantId: string, now = new Date(), channels: NotificationChannel[] = ["email"]) {
  requireIdentity(tenantId);
  const todayKey = indiaDateKey(now);
  const [workRows, requestRows, invoiceRows, registerAlerts, dependencyRows] = await Promise.all([
    database.select({
      id: workItems.id,
      serviceKey: workItems.serviceKey,
      periodKey: workItems.periodKey,
      statutoryDueDate: workItems.statutoryDueDate,
      entityName: legalEntities.displayName,
      assigneeId: workItems.assigneeId,
    }).from(workItems)
      .innerJoin(legalEntities, and(eq(legalEntities.tenantId, workItems.tenantId), eq(legalEntities.id, workItems.legalEntityId)))
      .where(and(
        eq(workItems.tenantId, tenantId),
        ne(workItems.status, "completed"),
        lte(workItems.statutoryDueDate, addDaysToDateKey(todayKey, DUE_SOON_WINDOW_DAYS)),
      )),
    database.select({
      id: documentRequests.id,
      title: documentRequests.title,
      dueDate: documentRequests.dueDate,
      entityName: legalEntities.displayName,
      requestedByUserId: documentRequests.requestedByUserId,
    }).from(documentRequests)
      .innerJoin(legalEntities, and(eq(legalEntities.tenantId, documentRequests.tenantId), eq(legalEntities.id, documentRequests.legalEntityId)))
      .where(and(
        eq(documentRequests.tenantId, tenantId),
        eq(documentRequests.status, "requested"),
        lte(documentRequests.dueDate, addDaysToDateKey(todayKey, -1)),
      )),
    database.select({
      id: invoices.id,
      invoiceNumber: invoices.invoiceNumber,
      dueDate: sql<string>`${invoices.dueDate}`,
      entityName: legalEntities.displayName,
      createdByUserId: invoices.createdByUserId,
    }).from(invoices)
      .innerJoin(legalEntities, and(eq(legalEntities.tenantId, invoices.tenantId), eq(legalEntities.id, invoices.legalEntityId)))
      .where(and(
        eq(invoices.tenantId, tenantId),
        eq(invoices.status, "issued"),
        lte(invoices.dueDate, addDaysToDateKey(todayKey, -1)),
      )),
    loadRegisterAlertRows(database, tenantId, todayKey),
    // Inlined rather than imported from the dependencies repository: that module
    // already depends on this one, and a cycle between them would be worse than
    // a select restated in nine lines.
    database.select({
      assigneeId: workItems.assigneeId,
      clientName: legalEntities.displayName,
      expectedOn: workDependencies.expectedOn,
      id: workDependencies.id,
      periodKey: workItems.periodKey,
      serviceKey: workItems.serviceKey,
      title: workDependencies.title,
      workItemId: workDependencies.workItemId,
    }).from(workDependencies)
      .innerJoin(workItems, and(eq(workItems.tenantId, workDependencies.tenantId), eq(workItems.id, workDependencies.workItemId)))
      .innerJoin(legalEntities, and(eq(legalEntities.tenantId, workItems.tenantId), eq(legalEntities.id, workItems.legalEntityId)))
      .where(and(
        eq(workDependencies.tenantId, tenantId),
        isNull(workDependencies.clearedAt),
        ne(workItems.status, "completed"),
        lte(workDependencies.expectedOn, addDaysToDateKey(todayKey, -1)),
      )),
  ]);
  const drafts = buildDeadlineNotificationDrafts({
    dependencies: dependencyRows.map((row) => ({ ...row, assigneeId: row.assigneeId ?? null })),
    documentRequests: requestRows,
    invoices: invoiceRows,
    registerAlerts,
    todayKey,
    workItems: workRows,
  });
  return insertNotifications(database, tenantId, drafts, channels);
}

export async function listActiveTenantIds(database: DashboardDatabase) {
  const rows = await database.select({ id: tenants.id }).from(tenants).where(inArray(tenants.status, ["trial", "active"]));
  return rows.map((row) => row.id);
}

function toNotificationRow(row: {
  id: string;
  type: string;
  title: string;
  body: string;
  resourceType: string;
  resourceId: string | null;
  readAt: Date | null;
  createdAt: Date;
}): NotificationRow {
  return {
    ...row,
    type: row.type as NotificationType,
    resourceType: row.resourceType as NotificationResourceType,
    readAt: row.readAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function countUnreadNotifications(database: DashboardDatabase, tenantId: string, userId: string) {
  requireIdentity(tenantId, userId);
  const [row] = await database.select({ count: sql<number>`count(*)::int` }).from(notifications).where(and(
    eq(notifications.tenantId, tenantId),
    eq(notifications.recipientUserId, userId),
    isNull(notifications.readAt),
  ));
  return row?.count ?? 0;
}

export async function listNotificationWorkspace(database: DashboardDatabase, tenantId: string, userId: string, limit = 50): Promise<NotificationWorkspaceData> {
  requireIdentity(tenantId, userId);
  const [rows, unreadCount] = await Promise.all([
    database.select({
      id: notifications.id,
      type: notifications.type,
      title: notifications.title,
      body: notifications.body,
      resourceType: notifications.resourceType,
      resourceId: notifications.resourceId,
      readAt: notifications.readAt,
      createdAt: notifications.createdAt,
    }).from(notifications).where(and(
      eq(notifications.tenantId, tenantId),
      eq(notifications.recipientUserId, userId),
    )).orderBy(desc(notifications.createdAt)).limit(limit),
    countUnreadNotifications(database, tenantId, userId),
  ]);
  return { notifications: rows.map(toNotificationRow), unreadCount };
}

export async function markNotificationRead(database: DashboardDatabase, tenantId: string, userId: string, notificationId: string) {
  requireIdentity(tenantId, userId);
  await database.update(notifications).set({ readAt: new Date() }).where(and(
    eq(notifications.id, notificationId),
    eq(notifications.tenantId, tenantId),
    eq(notifications.recipientUserId, userId),
    isNull(notifications.readAt),
  ));
}

export async function markAllNotificationsRead(database: DashboardDatabase, tenantId: string, userId: string) {
  requireIdentity(tenantId, userId);
  await database.update(notifications).set({ readAt: new Date() }).where(and(
    eq(notifications.tenantId, tenantId),
    eq(notifications.recipientUserId, userId),
    isNull(notifications.readAt),
  ));
}
