import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, isNotNull, isNull, lte, or, gte, sql } from "drizzle-orm";

import { auditEvents, clientComplianceSchedules, clientPackageAssignmentServices, clientPackageAssignments, complianceExtensions, complianceSchedules, filingAcknowledgements, legalEntities, serviceCatalog, workItems } from "../../db/schema";
import type { DashboardDatabase } from "../dashboard/postgres/repository";
import { diffCoverage, isEntitledAt, type EntitlementWindow, type ExpectedObligation } from "./coverage";
import type { ClientScheduleOverride, ComplianceExtension, ScheduleMode } from "./client-schedules";
import { addDaysToDateKey, buildRecurringWorkDrafts, type ComplianceFrequency, type ComplianceScheduleRule, type EntitledService } from "./recurrence";
import type { ComplianceScheduleInput } from "./validation";

export function indiaDateKey(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function requireTenant(tenantId: string) {
  if (!tenantId.trim()) throw new Error("Tenant is required.");
}

export class ComplianceScheduleError extends Error {
  constructor(public readonly code: "not_found" | "duplicate" | "unknown_service") {
    super(
      code === "not_found" ? "The schedule was not found."
        : code === "duplicate" ? "A rule for that service already takes effect on that date."
          : "That service code is not in the firm's service master.",
    );
    this.name = "ComplianceScheduleError";
  }
}

export type ComplianceScheduleRow = {
  id: string;
  serviceCode: string;
  serviceName: string | null;
  frequency: ComplianceFrequency;
  dueMonthOffset: number;
  dueDay: number;
  internalLeadDays: number;
  effectiveFrom: string;
  status: string;
  superseded: boolean;
};

export type ComplianceScheduleWorkspace = {
  schedules: ComplianceScheduleRow[];
  services: Array<{ code: string; name: string }>;
  todayKey: string;
};

export async function listComplianceScheduleWorkspace(database: DashboardDatabase, tenantId: string, todayKey = indiaDateKey()): Promise<ComplianceScheduleWorkspace> {
  requireTenant(tenantId);
  const [rows, services] = await Promise.all([
    database.select({
      id: complianceSchedules.id,
      serviceCode: complianceSchedules.serviceCode,
      serviceName: serviceCatalog.name,
      frequency: complianceSchedules.frequency,
      dueMonthOffset: complianceSchedules.dueMonthOffset,
      dueDay: complianceSchedules.dueDay,
      internalLeadDays: complianceSchedules.internalLeadDays,
      effectiveFrom: complianceSchedules.effectiveFrom,
      status: complianceSchedules.status,
    }).from(complianceSchedules)
      .leftJoin(serviceCatalog, and(
        eq(serviceCatalog.tenantId, complianceSchedules.tenantId),
        eq(sql`lower(${serviceCatalog.code})`, sql`lower(${complianceSchedules.serviceCode})`),
      ))
      .where(eq(complianceSchedules.tenantId, tenantId))
      .orderBy(asc(complianceSchedules.serviceCode), desc(complianceSchedules.effectiveFrom)),
    database.select({ code: serviceCatalog.code, name: serviceCatalog.name }).from(serviceCatalog)
      .where(and(eq(serviceCatalog.tenantId, tenantId), eq(serviceCatalog.status, "active")))
      .orderBy(asc(serviceCatalog.code)),
  ]);
  const seenEffective = new Set<string>();
  const schedules = rows.map((row) => {
    const code = row.serviceCode.toUpperCase();
    const isCurrent = row.status === "active" && row.effectiveFrom <= todayKey && !seenEffective.has(code);
    if (isCurrent) seenEffective.add(code);
    return {
      ...row,
      frequency: row.frequency as ComplianceFrequency,
      superseded: row.status === "active" && row.effectiveFrom <= todayKey && !isCurrent,
    };
  });
  return { schedules, services, todayKey };
}

export async function getComplianceSchedule(database: DashboardDatabase, tenantId: string, scheduleId: string) {
  requireTenant(tenantId);
  const [row] = await database.select().from(complianceSchedules).where(and(
    eq(complianceSchedules.tenantId, tenantId), eq(complianceSchedules.id, scheduleId),
  )).limit(1);
  return row ?? null;
}

async function assertKnownService(database: DashboardDatabase, tenantId: string, serviceCode: string) {
  const [service] = await database.select({ code: serviceCatalog.code }).from(serviceCatalog).where(and(
    eq(serviceCatalog.tenantId, tenantId),
    eq(sql`lower(${serviceCatalog.code})`, serviceCode.toLowerCase()),
  )).limit(1);
  if (!service) throw new ComplianceScheduleError("unknown_service");
}

export async function createComplianceSchedule(database: DashboardDatabase, tenantId: string, actorUserId: string, input: ComplianceScheduleInput) {
  requireTenant(tenantId);
  await assertKnownService(database, tenantId, input.serviceCode);
  const id = randomUUID();
  const inserted = await database.insert(complianceSchedules).values({ id, tenantId, ...input }).onConflictDoNothing().returning({ id: complianceSchedules.id });
  if (inserted.length === 0) throw new ComplianceScheduleError("duplicate");
  await database.insert(auditEvents).values({
    tenantId, actorUserId, resourceType: "compliance_schedule", resourceId: id,
    action: "compliance_schedule.created", reason: `${input.serviceCode} from ${input.effectiveFrom}`,
  });
  return id;
}

export async function updateComplianceSchedule(database: DashboardDatabase, tenantId: string, actorUserId: string, scheduleId: string, input: ComplianceScheduleInput) {
  requireTenant(tenantId);
  await assertKnownService(database, tenantId, input.serviceCode);
  const [updated] = await database.update(complianceSchedules).set({ ...input, updatedAt: new Date() }).where(and(
    eq(complianceSchedules.tenantId, tenantId), eq(complianceSchedules.id, scheduleId),
  )).returning({ id: complianceSchedules.id });
  if (!updated) throw new ComplianceScheduleError("not_found");
  await database.insert(auditEvents).values({
    tenantId, actorUserId, resourceType: "compliance_schedule", resourceId: scheduleId,
    action: "compliance_schedule.updated", reason: `${input.serviceCode} from ${input.effectiveFrom}`,
  });
}

export async function listActiveScheduleRules(database: DashboardDatabase, tenantId: string, todayKey: string): Promise<ComplianceScheduleRule[]> {
  requireTenant(tenantId);
  const rows = await database.select({
    serviceCode: complianceSchedules.serviceCode,
    frequency: complianceSchedules.frequency,
    dueMonthOffset: complianceSchedules.dueMonthOffset,
    dueDay: complianceSchedules.dueDay,
    internalLeadDays: complianceSchedules.internalLeadDays,
    effectiveFrom: complianceSchedules.effectiveFrom,
  }).from(complianceSchedules).where(and(
    eq(complianceSchedules.tenantId, tenantId),
    eq(complianceSchedules.status, "active"),
    lte(complianceSchedules.effectiveFrom, todayKey),
  ));
  const latestByCode = new Map<string, typeof rows[number]>();
  for (const row of rows) {
    const code = row.serviceCode.toUpperCase();
    const current = latestByCode.get(code);
    if (!current || row.effectiveFrom > current.effectiveFrom) latestByCode.set(code, row);
  }
  return [...latestByCode.values()].map((row) => ({
    serviceCode: row.serviceCode.toUpperCase(),
    frequency: row.frequency as ComplianceFrequency,
    dueMonthOffset: row.dueMonthOffset,
    dueDay: row.dueDay,
    internalLeadDays: row.internalLeadDays,
  }));
}

/**
 * Standing departures from the firm calendar, read on every generation run.
 *
 * Lives here rather than beside the admin functions because the generator needs
 * it and the admin module already depends on this one; the other direction
 * would make the two circular.
 */
export async function listClientScheduleOverrides(
  database: DashboardDatabase,
  tenantId: string,
): Promise<ClientScheduleOverride[]> {
  const rows = await database.select({
    dueDay: clientComplianceSchedules.dueDay,
    dueMonthOffset: clientComplianceSchedules.dueMonthOffset,
    effectiveFrom: clientComplianceSchedules.effectiveFrom,
    frequency: clientComplianceSchedules.frequency,
    internalLeadDays: clientComplianceSchedules.internalLeadDays,
    legalEntityId: clientComplianceSchedules.legalEntityId,
    mode: clientComplianceSchedules.mode,
    serviceCode: clientComplianceSchedules.serviceCode,
  }).from(clientComplianceSchedules)
    .where(eq(clientComplianceSchedules.tenantId, tenantId));

  return rows.map((row) => ({
    effectiveFrom: row.effectiveFrom,
    legalEntityId: row.legalEntityId,
    mode: row.mode as ScheduleMode,
    rule: row.mode === "override"
      ? {
        dueDay: row.dueDay!,
        dueMonthOffset: row.dueMonthOffset!,
        frequency: row.frequency as ComplianceFrequency,
        internalLeadDays: row.internalLeadDays!,
        serviceCode: row.serviceCode.toUpperCase(),
      }
      : null,
    serviceCode: row.serviceCode.toUpperCase(),
  }));
}

export async function listComplianceExtensions(
  database: DashboardDatabase,
  tenantId: string,
): Promise<ComplianceExtension[]> {
  const rows = await database.select({
    extendedDueDate: complianceExtensions.extendedDueDate,
    legalEntityId: complianceExtensions.legalEntityId,
    periodKey: complianceExtensions.periodKey,
    serviceCode: complianceExtensions.serviceCode,
  }).from(complianceExtensions)
    .where(eq(complianceExtensions.tenantId, tenantId));
  return rows.map((row) => ({ ...row, serviceCode: row.serviceCode.toUpperCase() }));
}

export async function listEntitledServices(database: DashboardDatabase, tenantId: string, todayKey: string): Promise<EntitledService[]> {
  requireTenant(tenantId);
  const rows = await database.select({
    legalEntityId: clientPackageAssignments.legalEntityId,
    serviceCode: clientPackageAssignmentServices.serviceCodeSnapshot,
  }).from(clientPackageAssignmentServices)
    .innerJoin(clientPackageAssignments, and(
      eq(clientPackageAssignments.tenantId, clientPackageAssignmentServices.tenantId),
      eq(clientPackageAssignments.id, clientPackageAssignmentServices.assignmentId),
    ))
    .innerJoin(legalEntities, and(
      eq(legalEntities.tenantId, clientPackageAssignments.tenantId),
      eq(legalEntities.id, clientPackageAssignments.legalEntityId),
    ))
    .where(and(
      eq(clientPackageAssignmentServices.tenantId, tenantId),
      eq(clientPackageAssignments.status, "active"),
      lte(clientPackageAssignments.effectiveFrom, todayKey),
      or(isNull(clientPackageAssignments.effectiveTo), gte(clientPackageAssignments.effectiveTo, todayKey)),
      eq(legalEntities.status, "active"),
    ));
  return rows.map((row) => ({ legalEntityId: row.legalEntityId, serviceCode: row.serviceCode.toUpperCase() }));
}

export async function generateRecurringWorkItems(database: DashboardDatabase, tenantId: string, now = new Date()) {
  requireTenant(tenantId);
  const todayKey = indiaDateKey(now);
  const [schedules, entitlements, overrides, extensions] = await Promise.all([
    listActiveScheduleRules(database, tenantId, todayKey),
    listEntitledServices(database, tenantId, todayKey),
    listClientScheduleOverrides(database, tenantId),
    listComplianceExtensions(database, tenantId),
  ]);
  const drafts = buildRecurringWorkDrafts({ entitlements, extensions, overrides, schedules, todayKey });
  let created = 0;
  for (const draft of drafts) {
    const id = randomUUID();
    const inserted = await database.insert(workItems).values({
      id,
      tenantId,
      legalEntityId: draft.legalEntityId,
      serviceKey: draft.serviceKey,
      periodKey: draft.periodKey,
      status: draft.status,
      statutoryDueDate: draft.statutoryDueDate,
      originalStatutoryDueDate: draft.originalStatutoryDueDate,
      internalDueDate: draft.internalDueDate,
      assigneeId: null,
      reviewerId: null,
      blockerNote: draft.blockerNote,
      progress: 0,
      missingItemCount: 0,
    }).onConflictDoNothing().returning({ id: workItems.id });
    if (inserted.length === 0) continue;
    created += 1;
    await database.insert(auditEvents).values({
      tenantId,
      actorUserId: null,
      resourceType: "work_item",
      resourceId: id,
      action: "work_item.auto_generated",
      reason: `${draft.serviceKey} · ${draft.periodKey}`,
    });
  }
  return created;
}

/**
 * Entitlement date ranges rather than a snapshot at one date. Coverage needs to
 * know what a client was engaged for when each period fell due, not what they
 * are engaged for today.
 */
export async function listEntitlementWindows(database: DashboardDatabase, tenantId: string): Promise<EntitlementWindow[]> {
  requireTenant(tenantId);
  const rows = await database.select({
    effectiveFrom: clientPackageAssignments.effectiveFrom,
    effectiveTo: clientPackageAssignments.effectiveTo,
    legalEntityId: clientPackageAssignments.legalEntityId,
    serviceCode: clientPackageAssignmentServices.serviceCodeSnapshot,
  }).from(clientPackageAssignmentServices)
    .innerJoin(clientPackageAssignments, and(
      eq(clientPackageAssignments.tenantId, clientPackageAssignmentServices.tenantId),
      eq(clientPackageAssignments.id, clientPackageAssignmentServices.assignmentId),
    ))
    .innerJoin(legalEntities, and(
      eq(legalEntities.tenantId, clientPackageAssignments.tenantId),
      eq(legalEntities.id, clientPackageAssignments.legalEntityId),
    ))
    .where(and(
      eq(clientPackageAssignmentServices.tenantId, tenantId),
      eq(clientPackageAssignments.status, "active"),
      eq(legalEntities.status, "active"),
    ));
  return rows.map((row) => ({
    effectiveFrom: row.effectiveFrom,
    effectiveTo: row.effectiveTo,
    legalEntityId: row.legalEntityId,
    serviceCode: row.serviceCode.toUpperCase(),
  }));
}

export type CoverageGap = ExpectedObligation & { clientName: string; daysLate: number };

const DEFAULT_LOOKBACK_DAYS = 120;

/**
 * Obligations that should exist for the window but were never raised.
 *
 * Entitlement is evaluated at each period's statutory due date, so a client
 * engaged last month is never reported as having missed filings from before
 * they were a client.
 */
export async function listCoverageGaps(
  database: DashboardDatabase,
  tenantId: string,
  todayKey = indiaDateKey(),
  lookbackDays = DEFAULT_LOOKBACK_DAYS,
): Promise<CoverageGap[]> {
  requireTenant(tenantId);
  const fromKey = addDaysToDateKey(todayKey, -Math.abs(lookbackDays));
  const [schedules, windows, clients, raised, overrides, extensions] = await Promise.all([
    listActiveScheduleRules(database, tenantId, todayKey),
    listEntitlementWindows(database, tenantId),
    database.select({ id: legalEntities.id, displayName: legalEntities.displayName }).from(legalEntities).where(and(
      eq(legalEntities.tenantId, tenantId), eq(legalEntities.status, "active"),
    )),
    database.select({
      legalEntityId: workItems.legalEntityId,
      periodKey: workItems.periodKey,
      serviceKey: workItems.serviceKey,
    }).from(workItems).where(eq(workItems.tenantId, tenantId)),
    listClientScheduleOverrides(database, tenantId),
    listComplianceExtensions(database, tenantId),
  ]);

  // Every entity that has ever been entitled to the service, so the period
  // arithmetic runs once; entitlement is then checked per period below.
  const everEntitled = windows.map((row) => ({ legalEntityId: row.legalEntityId, serviceCode: row.serviceCode }));
  // The same per-client resolution the generator uses, so coverage can never
  // report a gap for a client who is exempt, nor miss one for a client whose
  // own cadence raises periods the firm calendar would not.
  const candidates = buildRecurringWorkDrafts({ entitlements: everEntitled, extensions, fromKey, overrides, schedules, todayKey });
  const entitledOn = (legalEntityId: string, serviceCode: string, dateKey: string) => windows.some((row) => (
    row.legalEntityId === legalEntityId && row.serviceCode === serviceCode.toUpperCase() && isEntitledAt(row, dateKey)
  ));

  const expected = candidates
    .filter((draft) => entitledOn(draft.legalEntityId, draft.serviceKey, draft.statutoryDueDate))
    .map((draft) => ({
      internalDueDate: draft.internalDueDate,
      legalEntityId: draft.legalEntityId,
      periodKey: draft.periodKey,
      serviceKey: draft.serviceKey,
      statutoryDueDate: draft.statutoryDueDate,
    }));

  const nameById = new Map(clients.map((client) => [client.id, client.displayName]));
  return diffCoverage(expected, raised)
    .map((gap) => ({
      ...gap,
      clientName: nameById.get(gap.legalEntityId) ?? "Unknown client",
      daysLate: Math.round((Date.parse(`${todayKey}T00:00:00Z`) - Date.parse(`${gap.statutoryDueDate}T00:00:00Z`)) / 86_400_000),
    }))
    .sort((left, right) => right.daysLate - left.daysLate || left.clientName.localeCompare(right.clientName));
}

/**
 * Raises one previously-unraised obligation. Inserts through the same unique
 * constraint the generator relies on, so a double click, or the daily job
 * running mid-click, cannot create a duplicate.
 */
export async function raiseCoverageGap(
  database: DashboardDatabase,
  tenantId: string,
  actorUserId: string,
  gap: ExpectedObligation,
) {
  requireTenant(tenantId);
  if (!actorUserId.trim()) throw new Error("actorUserId is required.");
  const id = randomUUID();
  const inserted = await database.insert(workItems).values({
    id,
    tenantId,
    legalEntityId: gap.legalEntityId,
    serviceKey: gap.serviceKey,
    periodKey: gap.periodKey,
    // Newly raised work that nobody has started is not work that is waiting.
    status: "at_risk",
    statutoryDueDate: gap.statutoryDueDate,
    internalDueDate: gap.internalDueDate,
    assigneeId: null,
    reviewerId: null,
    blockerNote: "Raised from a compliance coverage gap.",
    progress: 0,
    missingItemCount: 0,
  }).onConflictDoNothing().returning({ id: workItems.id });
  if (!inserted.length) return null;
  await database.insert(auditEvents).values({
    tenantId,
    actorUserId,
    resourceType: "work_item",
    resourceId: id,
    action: "work_item.raised_from_gap",
    reason: `${gap.serviceKey} · ${gap.periodKey}`,
  });
  return id;
}

/**
 * Work items that have at least one filing acknowledgement recorded. A
 * completed obligation missing from this set was filed without evidence, which
 * is precisely the state a compliance review needs to see.
 */
export async function listEvidencedWorkItemIds(database: DashboardDatabase, tenantId: string): Promise<Set<string>> {
  requireTenant(tenantId);
  const rows = await database.selectDistinct({ workItemId: filingAcknowledgements.workItemId })
    .from(filingAcknowledgements)
    .where(and(eq(filingAcknowledgements.tenantId, tenantId), isNotNull(filingAcknowledgements.workItemId)));
  return new Set(rows.map((row) => row.workItemId).filter((id): id is string => Boolean(id)));
}
