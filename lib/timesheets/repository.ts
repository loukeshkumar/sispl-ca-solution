import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gte, lte, ne } from "drizzle-orm";

import { legalEntities, officeTasks, tenantMemberships, timeEntries, users, workItems } from "../../db/schema";
import type { DashboardDatabase } from "../dashboard/postgres/repository";
import { guardEntry, guardExistingEntry } from "./period-repository";
import { buildPayrollCostLookup, loadRateBook } from "../rates/repository";
import { listFirmUtilisation } from "../rates/utilisation-repository";
import type { FirmUtilisation } from "../rates/utilisation";
import { marginBasisPoints, valueEntry, type ChargeBasis } from "../rates/valuation";
import type { TimeEntryInput } from "./validation";

export class TimesheetRepositoryError extends Error {
  constructor(public readonly code: "not_found" | "invalid_scope" | "billed") {
    super({
      billed: "This entry is on an invoice. Cancel the invoice if it needs to change.",
      invalid_scope: "Select a client, work item, and task that belong to this firm.",
      not_found: "The time entry was not found.",
    }[code]);
    this.name = "TimesheetRepositoryError";
  }
}

export function indiaDateKey(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function monthBounds(periodKey: string) {
  const [year, month] = periodKey.split("-").map(Number);
  const start = `${periodKey}-01`;
  const end = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  return { start, end };
}

export type TimeEntryRow = {
  id: string;
  entryDate: string;
  minutes: number;
  employeeName: string;
  employeeUserId: string;
  legalEntityId: string | null;
  clientName: string | null;
  workLabel: string | null;
  taskTitle: string | null;
  billable: boolean;
  narration: string;
  /** Null when nobody has set a rate for this person — never zero, which would lie. */
  chargePaise: number | null;
  chargeBasis: ChargeBasis;
  costPaise: number | null;
};

export type EngagementEffortRow = {
  legalEntityId: string;
  clientName: string;
  billableMinutes: number;
  nonBillableMinutes: number;
  chargePaise: number;
  costPaise: number;
  /**
   * Null when there is nothing to divide by, and null when any of the cost is
   * unknown — a missing cost counted as zero would report the shortfall as
   * profit, which is the most flattering possible way to be wrong.
   */
  marginBps: number | null;
  /** Effort the firm could not value, so a total never quietly understates. */
  unratedChargeMinutes: number;
  unratedCostMinutes: number;
};

export type TimesheetWorkspaceData = {
  canManage: boolean;
  /** Cost is derived from salary, so seeing it is seeing pay. Gated separately. */
  canSeeCost: boolean;
  periodKey: string;
  entries: TimeEntryRow[];
  engagements: EngagementEffortRow[];
  /** Measured only for people who can see the firm's numbers, not their own. */
  utilisation: FirmUtilisation | null;
  metrics: {
    ownMinutes: number; ownBillableMinutes: number; firmMinutes: number; firmBillableMinutes: number; entryCount: number;
    ownChargePaise: number; firmChargePaise: number; firmCostPaise: number;
    unratedChargeMinutes: number; unratedCostMinutes: number;
  };
  todayKey: string;
};

export function summariseEntries(entries: TimeEntryRow[], viewerUserId: string) {
  const own = entries.filter((entry) => entry.employeeUserId === viewerUserId);
  const sum = (rows: TimeEntryRow[], billableOnly = false) => rows
    .filter((row) => !billableOnly || row.billable)
    .reduce((total, row) => total + row.minutes, 0);
  const money = (rows: TimeEntryRow[], field: "chargePaise" | "costPaise") => rows
    .reduce((total, row) => total + (row[field] ?? 0), 0);
  return {
    ownMinutes: sum(own),
    ownBillableMinutes: sum(own, true),
    firmMinutes: sum(entries),
    firmBillableMinutes: sum(entries, true),
    entryCount: entries.length,
    ownChargePaise: money(own, "chargePaise"),
    firmChargePaise: money(entries, "chargePaise"),
    firmCostPaise: money(entries, "costPaise"),
    // Billable effort with no rate behind it. Reported rather than absorbed,
    // because a total that silently omits it reads as the whole picture.
    unratedChargeMinutes: entries
      .filter((entry) => entry.billable && entry.chargePaise === null)
      .reduce((total, entry) => total + entry.minutes, 0),
    // Cost that is missing *or* withheld. Both look the same downstream, and
    // both make a margin figure a guess rather than an answer.
    unratedCostMinutes: entries
      .filter((entry) => entry.costPaise === null)
      .reduce((total, entry) => total + entry.minutes, 0),
  };
}

export function buildEngagementEffort(entries: TimeEntryRow[]): EngagementEffortRow[] {
  const byClient = new Map<string, EngagementEffortRow>();
  for (const entry of entries) {
    // Grouped by the client's own id, not their display name: two clients may
    // share a name, and an override is looked up by id.
    if (!entry.legalEntityId || !entry.clientName) continue;
    const current = byClient.get(entry.legalEntityId) ?? {
      legalEntityId: entry.legalEntityId, clientName: entry.clientName,
      billableMinutes: 0, nonBillableMinutes: 0, chargePaise: 0, costPaise: 0,
      marginBps: null, unratedChargeMinutes: 0, unratedCostMinutes: 0,
    };
    if (entry.billable) current.billableMinutes += entry.minutes;
    else current.nonBillableMinutes += entry.minutes;
    current.chargePaise += entry.chargePaise ?? 0;
    current.costPaise += entry.costPaise ?? 0;
    if (entry.billable && entry.chargePaise === null) current.unratedChargeMinutes += entry.minutes;
    if (entry.costPaise === null) current.unratedCostMinutes += entry.minutes;
    byClient.set(entry.legalEntityId, current);
  }
  return [...byClient.values()]
    .map((row) => ({
      ...row,
      marginBps: row.unratedCostMinutes > 0 ? null : marginBasisPoints(row.chargePaise, row.costPaise),
    }))
    .sort((left, right) => right.chargePaise - left.chargePaise
      || (right.billableMinutes + right.nonBillableMinutes) - (left.billableMinutes + left.nonBillableMinutes));
}

export async function listTimesheetWorkspace(
  database: DashboardDatabase,
  tenantId: string,
  viewerUserId: string,
  canManage: boolean,
  periodKey = indiaDateKey().slice(0, 7),
  canSeeCost = false,
): Promise<TimesheetWorkspaceData> {
  if (!tenantId.trim() || !viewerUserId.trim()) throw new Error("Tenant and viewer are required.");
  const { start, end } = monthBounds(periodKey);
  const scope = canManage
    ? and(eq(timeEntries.tenantId, tenantId), gte(timeEntries.entryDate, start), lte(timeEntries.entryDate, end))
    : and(eq(timeEntries.tenantId, tenantId), eq(timeEntries.employeeUserId, viewerUserId), gte(timeEntries.entryDate, start), lte(timeEntries.entryDate, end));
  const rows = await database.select({
    id: timeEntries.id,
    entryDate: timeEntries.entryDate,
    minutes: timeEntries.minutes,
    employeeName: users.fullName,
    employeeUserId: timeEntries.employeeUserId,
    legalEntityId: timeEntries.legalEntityId,
    clientName: legalEntities.displayName,
    serviceKey: workItems.serviceKey,
    periodLabel: workItems.periodKey,
    taskTitle: officeTasks.title,
    billable: timeEntries.billable,
    narration: timeEntries.narration,
  }).from(timeEntries)
    .innerJoin(users, eq(users.id, timeEntries.employeeUserId))
    .leftJoin(legalEntities, and(eq(legalEntities.tenantId, timeEntries.tenantId), eq(legalEntities.id, timeEntries.legalEntityId)))
    .leftJoin(workItems, and(eq(workItems.tenantId, timeEntries.tenantId), eq(workItems.id, timeEntries.workItemId)))
    .leftJoin(officeTasks, and(eq(officeTasks.tenantId, timeEntries.tenantId), eq(officeTasks.id, timeEntries.officeTaskId)))
    .where(scope)
    .orderBy(desc(timeEntries.entryDate), desc(timeEntries.createdAt));
  // The rate book is a few dozen rows, so it is read once and applied here
  // rather than joined per entry — which keeps the resolution rules in one
  // pure, tested place instead of spread across correlated subqueries.
  const [book, payrollCost, utilisation] = await Promise.all([
    loadRateBook(database, tenantId),
    buildPayrollCostLookup(database, tenantId, [periodKey]),
    canManage ? listFirmUtilisation(database, tenantId, periodKey).catch(() => null) : Promise.resolve(null),
  ]);

  const entries: TimeEntryRow[] = rows.map((row) => {
    const valued = valueEntry({
      billable: row.billable,
      employeeUserId: row.employeeUserId,
      entryDate: row.entryDate,
      legalEntityId: row.legalEntityId,
      minutes: row.minutes,
    }, book, payrollCost);
    return {
      id: row.id,
      entryDate: row.entryDate,
      minutes: row.minutes,
      employeeName: row.employeeName,
      employeeUserId: row.employeeUserId,
      legalEntityId: row.legalEntityId,
      clientName: row.clientName,
      workLabel: row.serviceKey ? `${row.serviceKey.replaceAll("_", " ").toUpperCase()} · ${row.periodLabel}` : null,
      taskTitle: row.taskTitle,
      billable: row.billable,
      narration: row.narration,
      chargeBasis: valued.chargeBasis,
      chargePaise: valued.chargePaise,
      // Cost is derived from salary, so showing it is showing pay. Withheld at
      // the source rather than hidden in the UI, where a network tab defeats it.
      costPaise: canSeeCost ? valued.costPaise : null,
    };
  });
  return {
    canManage,
    canSeeCost,
    periodKey,
    entries,
    engagements: canManage ? buildEngagementEffort(entries) : [],
    utilisation,
    metrics: summariseEntries(entries, viewerUserId),
    todayKey: indiaDateKey(),
  };
}

export async function listTimesheetFormOptions(database: DashboardDatabase, tenantId: string) {
  const [clients, work, tasks] = await Promise.all([
    database.select({ id: legalEntities.id, name: legalEntities.displayName }).from(legalEntities)
      .where(and(eq(legalEntities.tenantId, tenantId), eq(legalEntities.status, "active"))).orderBy(asc(legalEntities.displayName)),
    database.select({ id: workItems.id, legalEntityId: workItems.legalEntityId, serviceKey: workItems.serviceKey, periodKey: workItems.periodKey })
      .from(workItems).where(and(eq(workItems.tenantId, tenantId), ne(workItems.status, "completed"))).orderBy(asc(workItems.statutoryDueDate)),
    database.select({ id: officeTasks.id, title: officeTasks.title, legalEntityId: officeTasks.legalEntityId })
      .from(officeTasks).where(and(eq(officeTasks.tenantId, tenantId), ne(officeTasks.status, "cancelled"))).orderBy(asc(officeTasks.title)),
  ]);
  return {
    clients,
    work: work.map((item) => ({ id: item.id, legalEntityId: item.legalEntityId, label: `${item.serviceKey.replaceAll("_", " ").toUpperCase()} · ${item.periodKey}` })),
    tasks,
  };
}

async function assertScope(database: Pick<DashboardDatabase, "select">, tenantId: string, input: TimeEntryInput) {
  if (input.legalEntityId) {
    const [client] = await database.select({ id: legalEntities.id }).from(legalEntities).where(and(
      eq(legalEntities.tenantId, tenantId), eq(legalEntities.id, input.legalEntityId), eq(legalEntities.status, "active"),
    )).limit(1);
    if (!client) throw new TimesheetRepositoryError("invalid_scope");
  }
  if (input.workItemId) {
    const [item] = await database.select({ id: workItems.id }).from(workItems).where(and(
      eq(workItems.tenantId, tenantId), eq(workItems.id, input.workItemId),
      ...(input.legalEntityId ? [eq(workItems.legalEntityId, input.legalEntityId)] : []),
    )).limit(1);
    if (!item) throw new TimesheetRepositoryError("invalid_scope");
  }
  if (input.officeTaskId) {
    const [task] = await database.select({ id: officeTasks.id }).from(officeTasks).where(and(
      eq(officeTasks.tenantId, tenantId), eq(officeTasks.id, input.officeTaskId),
    )).limit(1);
    if (!task) throw new TimesheetRepositoryError("invalid_scope");
  }
}

/**
 * `actorUserId` is who is typing and `employeeUserId` is whose time it is. They
 * differ only where a manager records an entry outside the back-dating window,
 * which is the one way such an entry can exist.
 */
export async function createTimeEntry(
  database: DashboardDatabase,
  tenantId: string,
  employeeUserId: string,
  input: TimeEntryInput,
  options: { actorUserId?: string; backdateReason?: string } = {},
) {
  if (!tenantId.trim() || !employeeUserId.trim()) throw new Error("Tenant and employee are required.");
  const actorUserId = options.actorUserId ?? employeeUserId;
  const backdateReason = options.backdateReason ?? "";
  return database.transaction(async (transaction) => {
    const [member] = await transaction.select({ userId: tenantMemberships.userId }).from(tenantMemberships).where(and(
      eq(tenantMemberships.tenantId, tenantId), eq(tenantMemberships.userId, employeeUserId), eq(tenantMemberships.status, "active"),
    )).limit(1);
    if (!member) throw new TimesheetRepositoryError("invalid_scope");
    await assertScope(transaction, tenantId, input);

    // The gate. Every path that writes an entry goes through it, which is the
    // whole point: nothing used to stand between an entry and the table.
    await guardEntry(transaction, tenantId, {
      actorUserId,
      backdateReason,
      employeeUserId,
      entryDate: input.entryDate,
    });

    const id = randomUUID();
    await transaction.insert(timeEntries).values({
      id, tenantId, employeeUserId, ...input,
      backdateReason: backdateReason.trim().slice(0, 500),
      recordedByUserId: actorUserId,
    });
    return id;
  });
}

/**
 * An entry inside an approved month was part of a number the firm has stood
 * behind; removing it quietly is exactly what freezing exists to prevent. The
 * back-dating window does not apply — see `guardExistingEntry`.
 */
export async function deleteOwnTimeEntry(database: DashboardDatabase, tenantId: string, employeeUserId: string, entryId: string) {
  return database.transaction(async (transaction) => {
    const [entry] = await transaction.select({
      entryDate: timeEntries.entryDate,
      invoiceLineId: timeEntries.invoiceLineId,
    }).from(timeEntries).where(and(
      eq(timeEntries.id, entryId), eq(timeEntries.tenantId, tenantId), eq(timeEntries.employeeUserId, employeeUserId),
    )).limit(1);
    if (!entry) throw new TimesheetRepositoryError("not_found");
    // An entry already on an invoice line is part of what a client was charged.
    // Removing it would leave the line's value describing time that no longer
    // exists, and the write-down against it meaningless.
    if (entry.invoiceLineId) throw new TimesheetRepositoryError("billed");

    await guardExistingEntry(transaction, tenantId, { employeeUserId, entryDate: entry.entryDate });

    await transaction.delete(timeEntries).where(and(
      eq(timeEntries.id, entryId), eq(timeEntries.tenantId, tenantId), eq(timeEntries.employeeUserId, employeeUserId),
    ));
  });
}

/**
 * Unbilled effort on one client, in money.
 *
 * This function was named for paise and returned minutes, because there was no
 * rate to turn one into the other. There is now.
 */
export async function getEngagementEffortPaise(database: DashboardDatabase, tenantId: string, legalEntityId: string) {
  const rows = await database.select({
    billable: timeEntries.billable,
    employeeUserId: timeEntries.employeeUserId,
    entryDate: timeEntries.entryDate,
    minutes: timeEntries.minutes,
  }).from(timeEntries).where(and(eq(timeEntries.tenantId, tenantId), eq(timeEntries.legalEntityId, legalEntityId)));
  if (rows.length === 0) return { billableMinutes: 0, chargePaise: 0, costPaise: 0, marginBps: null, totalMinutes: 0, unratedChargeMinutes: 0 };

  const [book, payrollCost] = await Promise.all([
    loadRateBook(database, tenantId),
    buildPayrollCostLookup(database, tenantId, rows.map((row) => row.entryDate.slice(0, 7))),
  ]);
  const totals = rows.reduce((accumulated, row) => {
    const valued = valueEntry({ ...row, legalEntityId }, book, payrollCost);
    return {
      billableMinutes: accumulated.billableMinutes + (row.billable ? row.minutes : 0),
      chargePaise: accumulated.chargePaise + (valued.chargePaise ?? 0),
      costPaise: accumulated.costPaise + (valued.costPaise ?? 0),
      totalMinutes: accumulated.totalMinutes + row.minutes,
      unratedChargeMinutes: accumulated.unratedChargeMinutes + (row.billable && valued.chargePaise === null ? row.minutes : 0),
    };
  }, { billableMinutes: 0, chargePaise: 0, costPaise: 0, totalMinutes: 0, unratedChargeMinutes: 0 });
  return { ...totals, marginBps: marginBasisPoints(totals.chargePaise, totals.costPaise) };
}
