import { and, eq, gte, inArray, ne } from "drizzle-orm";

import { dscCertificates, invoices, legalEntities, statutoryNotices, timeEntries, users, workItems, clientGroups } from "../../db/schema";
import type { DashboardDatabase } from "../dashboard/postgres/repository";
import { listFirmUtilisation } from "../rates/utilisation-repository";
import { buildPracticeSignals, type PracticeSignal, type SignalInputs } from "./signals";

export function indiaDateKey(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export type InsightsWorkspaceData = {
  signals: PracticeSignal[];
  counts: { critical: number; warning: number; info: number };
  todayKey: string;
};

export async function listInsightsWorkspace(database: DashboardDatabase, tenantId: string, todayKey = indiaDateKey()): Promise<InsightsWorkspaceData> {
  if (!tenantId.trim()) throw new Error("Tenant is required.");
  const monthStart = `${todayKey.slice(0, 7)}-01`;
  const [workRows, invoiceRows, clientRows, timeRows, certificateRows, noticeRows, utilisation] = await Promise.all([
    database.select({
      id: workItems.id,
      clientName: legalEntities.displayName,
      serviceKey: workItems.serviceKey,
      periodKey: workItems.periodKey,
      statutoryDueDate: workItems.statutoryDueDate,
      status: workItems.status,
      assigneeName: users.fullName,
    }).from(workItems)
      .innerJoin(legalEntities, and(eq(legalEntities.tenantId, workItems.tenantId), eq(legalEntities.id, workItems.legalEntityId)))
      .leftJoin(users, eq(users.id, workItems.assigneeId))
      .where(and(eq(workItems.tenantId, tenantId), ne(workItems.status, "completed"))),
    database.select({
      id: invoices.id,
      invoiceNumber: invoices.invoiceNumber,
      clientName: legalEntities.displayName,
      totalPaise: invoices.totalPaise,
      dueDate: invoices.dueDate,
      status: invoices.status,
    }).from(invoices)
      .innerJoin(legalEntities, and(eq(legalEntities.tenantId, invoices.tenantId), eq(legalEntities.id, invoices.legalEntityId)))
      .where(and(eq(invoices.tenantId, tenantId), eq(invoices.status, "issued"))),
    database.select({
      id: legalEntities.id,
      name: legalEntities.displayName,
      healthScore: clientGroups.healthScore,
      riskStatus: clientGroups.riskStatus,
    }).from(legalEntities)
      .innerJoin(clientGroups, and(eq(clientGroups.tenantId, legalEntities.tenantId), eq(clientGroups.id, legalEntities.clientGroupId)))
      .where(and(eq(legalEntities.tenantId, tenantId), eq(legalEntities.status, "active"))),
    database.select({
      employeeUserId: timeEntries.employeeUserId,
      employeeName: users.fullName,
      minutes: timeEntries.minutes,
      billable: timeEntries.billable,
    }).from(timeEntries)
      .innerJoin(users, eq(users.id, timeEntries.employeeUserId))
      .where(and(eq(timeEntries.tenantId, tenantId), gte(timeEntries.entryDate, monthStart))),
    database.select({
      id: dscCertificates.id,
      holderName: dscCertificates.holderName,
      serialNumber: dscCertificates.serialNumber,
      validUntil: dscCertificates.validUntil,
      status: dscCertificates.status,
    }).from(dscCertificates).where(and(
      eq(dscCertificates.tenantId, tenantId),
      inArray(dscCertificates.status, ["in_custody", "issued_out"]),
    )),
    database.select({
      id: statutoryNotices.id,
      noticeNumber: statutoryNotices.noticeNumber,
      clientName: legalEntities.displayName,
      responseDueDate: statutoryNotices.responseDueDate,
      status: statutoryNotices.status,
    }).from(statutoryNotices)
      .innerJoin(legalEntities, and(eq(legalEntities.tenantId, statutoryNotices.tenantId), eq(legalEntities.id, statutoryNotices.legalEntityId)))
      .where(and(eq(statutoryNotices.tenantId, tenantId), inArray(statutoryNotices.status, ["open", "in_progress"]))),
    // Measured for the month being read, so the utilisation signals compare
    // against the firm's own target rather than against each other.
    listFirmUtilisation(database, tenantId, todayKey.slice(0, 7)).catch(() => null),
  ]);

  const openByClient = new Map<string, number>();
  for (const item of workRows) openByClient.set(item.clientName, (openByClient.get(item.clientName) ?? 0) + 1);

  const inputs: SignalInputs = {
    workItems: workRows,
    invoices: invoiceRows,
    clients: clientRows.map((client) => ({ ...client, openObligations: openByClient.get(client.name) ?? 0 })),
    timeEntries: timeRows,
    certificates: certificateRows,
    notices: noticeRows,
    utilisation,
    todayKey,
  };
  const signals = buildPracticeSignals(inputs);
  return {
    signals,
    counts: {
      critical: signals.filter((signal) => signal.severity === "critical").length,
      warning: signals.filter((signal) => signal.severity === "warning").length,
      info: signals.filter((signal) => signal.severity === "info").length,
    },
    todayKey,
  };
}
