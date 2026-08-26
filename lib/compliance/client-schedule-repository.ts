import { and, asc, desc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";

import {
  auditEvents,
  clientComplianceSchedules,
  complianceExtensions,
  legalEntities,
  serviceCatalog,
  users,
  workItems,
} from "../../db/schema";
import type { DashboardDatabase } from "../dashboard/postgres/repository";
import {
  EXTENSION_REFUSAL_NOTES,
  OVERRIDE_REFUSAL_NOTES,
  refuseExtension,
  refuseOverride,
  type ExtensionRefusal,
  type OverrideRefusal,
  type ScheduleMode,
} from "./client-schedules";
import { indiaDateKey, listActiveScheduleRules, listEntitledServices } from "./repository";
import type { ComplianceFrequency, ComplianceScheduleRule } from "./recurrence";

/**
 * Per-client calendars, and dates moved by the authority that set them.
 *
 * The overrides are read on every generation run; the extensions are read there
 * too, and applied once at the moment they are recorded so that work already
 * raised moves with everything else rather than waiting for the next run.
 */

export class ClientScheduleError extends Error {
  constructor(public readonly code: OverrideRefusal | ExtensionRefusal | "not_found", message?: string) {
    super(message ?? "That schedule was not found.");
    this.name = "ClientScheduleError";
  }
}

export type ClientScheduleRow = {
  clientName: string;
  createdByName: string;
  effectiveFrom: string;
  id: string;
  legalEntityId: string;
  mode: ScheduleMode;
  note: string;
  rule: ComplianceScheduleRule | null;
  serviceCode: string;
};

export async function listClientSchedules(
  database: DashboardDatabase,
  tenantId: string,
  legalEntityId?: string,
): Promise<ClientScheduleRow[]> {
  const rows = await database.select({
    clientName: legalEntities.displayName,
    createdByName: users.fullName,
    dueDay: clientComplianceSchedules.dueDay,
    dueMonthOffset: clientComplianceSchedules.dueMonthOffset,
    effectiveFrom: clientComplianceSchedules.effectiveFrom,
    frequency: clientComplianceSchedules.frequency,
    id: clientComplianceSchedules.id,
    internalLeadDays: clientComplianceSchedules.internalLeadDays,
    legalEntityId: clientComplianceSchedules.legalEntityId,
    mode: clientComplianceSchedules.mode,
    note: clientComplianceSchedules.note,
    serviceCode: clientComplianceSchedules.serviceCode,
  }).from(clientComplianceSchedules)
    .innerJoin(legalEntities, and(
      eq(legalEntities.tenantId, clientComplianceSchedules.tenantId),
      eq(legalEntities.id, clientComplianceSchedules.legalEntityId),
    ))
    .innerJoin(users, eq(users.id, clientComplianceSchedules.createdByUserId))
    .where(legalEntityId
      ? and(eq(clientComplianceSchedules.tenantId, tenantId), eq(clientComplianceSchedules.legalEntityId, legalEntityId))
      : eq(clientComplianceSchedules.tenantId, tenantId))
    .orderBy(asc(legalEntities.displayName), asc(clientComplianceSchedules.serviceCode), desc(clientComplianceSchedules.effectiveFrom));

  return rows.map((row) => ({
    clientName: row.clientName,
    createdByName: row.createdByName,
    effectiveFrom: row.effectiveFrom,
    id: row.id,
    legalEntityId: row.legalEntityId,
    mode: row.mode as ScheduleMode,
    note: row.note,
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

export type ClientScheduleInput = {
  dueDay: number | null;
  dueMonthOffset: number | null;
  effectiveFrom: string;
  frequency: string | null;
  internalLeadDays: number | null;
  legalEntityId: string;
  mode: string;
  note: string;
  serviceCode: string;
};

export async function createClientSchedule(
  database: DashboardDatabase,
  tenantId: string,
  actorUserId: string,
  input: ClientScheduleInput,
) {
  return database.transaction(async (transaction) => {
    const serviceCode = input.serviceCode.toUpperCase();
    const todayKey = indiaDateKey();

    // Entitlement is checked as of today rather than the effective date: a
    // schedule recorded for next quarter is for a client the firm is engaged
    // with now, and an engagement that has not started yet has no calendar.
    const entitlements = await listEntitledServices(transaction as unknown as DashboardDatabase, tenantId, todayKey);
    const entitled = entitlements.some((entry) => entry.legalEntityId === input.legalEntityId
      && entry.serviceCode === serviceCode);

    const existing = await transaction.select({ effectiveFrom: clientComplianceSchedules.effectiveFrom })
      .from(clientComplianceSchedules)
      .where(and(
        eq(clientComplianceSchedules.tenantId, tenantId),
        eq(clientComplianceSchedules.legalEntityId, input.legalEntityId),
        sql`lower(${clientComplianceSchedules.serviceCode}) = lower(${serviceCode})`,
      ));

    const firmRules = await listActiveScheduleRules(transaction as unknown as DashboardDatabase, tenantId, todayKey);
    const rule = input.mode === "override"
      ? {
        dueDay: input.dueDay ?? undefined,
        dueMonthOffset: input.dueMonthOffset ?? undefined,
        frequency: input.frequency ?? undefined,
        internalLeadDays: input.internalLeadDays ?? undefined,
        serviceCode,
      } as Partial<ComplianceScheduleRule>
      : null;

    const refusal = refuseOverride({
      effectiveFrom: input.effectiveFrom,
      entitled,
      existingDates: existing.map((row) => row.effectiveFrom),
      firmRule: firmRules.find((entry) => entry.serviceCode === serviceCode) ?? null,
      mode: input.mode,
      rule,
    });
    if (refusal) throw new ClientScheduleError(refusal, OVERRIDE_REFUSAL_NOTES[refusal]);

    const [saved] = await transaction.insert(clientComplianceSchedules).values({
      createdByUserId: actorUserId,
      dueDay: input.mode === "override" ? input.dueDay : null,
      dueMonthOffset: input.mode === "override" ? input.dueMonthOffset : null,
      effectiveFrom: input.effectiveFrom,
      frequency: input.mode === "override" ? input.frequency : null,
      internalLeadDays: input.mode === "override" ? input.internalLeadDays : null,
      legalEntityId: input.legalEntityId,
      mode: input.mode,
      note: input.note.trim().slice(0, 500),
      serviceCode,
      tenantId,
    }).returning({ id: clientComplianceSchedules.id });

    await transaction.insert(auditEvents).values({
      action: "client_schedule.recorded",
      actorUserId,
      reason: `${serviceCode} · ${input.mode} from ${input.effectiveFrom}`,
      resourceId: input.legalEntityId,
      resourceType: "legal_entity",
      tenantId,
    });
    return saved!.id;
  });
}

/**
 * Removing a schedule returns the client to the firm calendar.
 *
 * Work already raised under it is left alone: it was correctly due on the date
 * that applied when it was raised, and rewriting that would misstate history.
 */
export async function deleteClientSchedule(
  database: DashboardDatabase,
  tenantId: string,
  actorUserId: string,
  scheduleId: string,
) {
  return database.transaction(async (transaction) => {
    const [removed] = await transaction.delete(clientComplianceSchedules).where(and(
      eq(clientComplianceSchedules.tenantId, tenantId),
      eq(clientComplianceSchedules.id, scheduleId),
    )).returning({
      effectiveFrom: clientComplianceSchedules.effectiveFrom,
      legalEntityId: clientComplianceSchedules.legalEntityId,
      serviceCode: clientComplianceSchedules.serviceCode,
    });
    if (!removed) throw new ClientScheduleError("not_found");

    await transaction.insert(auditEvents).values({
      action: "client_schedule.removed",
      actorUserId,
      reason: `${removed.serviceCode} from ${removed.effectiveFrom}`,
      resourceId: removed.legalEntityId,
      resourceType: "legal_entity",
      tenantId,
    });
  });
}

export type ExtensionRow = {
  appliedAt: string | null;
  appliedCount: number;
  authority: string;
  clientName: string | null;
  createdByName: string;
  extendedDueDate: string;
  id: string;
  legalEntityId: string | null;
  note: string;
  originalDueDate: string;
  periodKey: string;
  serviceCode: string;
};

export async function listExtensions(database: DashboardDatabase, tenantId: string): Promise<ExtensionRow[]> {
  const rows = await database.select({
    appliedAt: complianceExtensions.appliedAt,
    appliedCount: complianceExtensions.appliedCount,
    authority: complianceExtensions.authority,
    clientName: legalEntities.displayName,
    createdByName: users.fullName,
    extendedDueDate: complianceExtensions.extendedDueDate,
    id: complianceExtensions.id,
    legalEntityId: complianceExtensions.legalEntityId,
    note: complianceExtensions.note,
    originalDueDate: complianceExtensions.originalDueDate,
    periodKey: complianceExtensions.periodKey,
    serviceCode: complianceExtensions.serviceCode,
  }).from(complianceExtensions)
    .leftJoin(legalEntities, and(
      eq(legalEntities.tenantId, complianceExtensions.tenantId),
      eq(legalEntities.id, complianceExtensions.legalEntityId),
    ))
    .innerJoin(users, eq(users.id, complianceExtensions.createdByUserId))
    .where(eq(complianceExtensions.tenantId, tenantId))
    .orderBy(desc(complianceExtensions.extendedDueDate));

  return rows.map((row) => ({
    ...row,
    appliedAt: row.appliedAt?.toISOString() ?? null,
    serviceCode: row.serviceCode.toUpperCase(),
  }));
}

export type ExtensionInput = {
  authority: string;
  extendedDueDate: string;
  /** Null for the ordinary case: everybody filing this service for this period. */
  legalEntityId: string | null;
  note: string;
  originalDueDate: string;
  periodKey: string;
  serviceCode: string;
};

/**
 * Record an extension and apply it in the same breath.
 *
 * Applying is the half that matters. An extension recorded but not applied is
 * exactly the state the firm was already in — the notification is known, and
 * some clients are still sitting on the old date because nobody got to them.
 *
 * Filings already completed are left as they were: they were filed against the
 * date that stood, and moving it afterwards would rewrite whether they were on
 * time.
 */
export async function createExtension(
  database: DashboardDatabase,
  tenantId: string,
  actorUserId: string,
  input: ExtensionInput,
) {
  return database.transaction(async (transaction) => {
    const serviceCode = input.serviceCode.toUpperCase();

    const [known] = await transaction.select({ code: serviceCatalog.code }).from(serviceCatalog)
      .where(and(
        eq(serviceCatalog.tenantId, tenantId),
        sql`upper(${serviceCatalog.code}) = ${serviceCode}`,
      )).limit(1);

    const duplicates = await transaction.select({ id: complianceExtensions.id }).from(complianceExtensions)
      .where(and(
        eq(complianceExtensions.tenantId, tenantId),
        sql`lower(${complianceExtensions.serviceCode}) = lower(${serviceCode})`,
        eq(complianceExtensions.periodKey, input.periodKey.trim()),
        input.legalEntityId
          ? eq(complianceExtensions.legalEntityId, input.legalEntityId)
          : isNull(complianceExtensions.legalEntityId),
      )).limit(1);

    const refusal = refuseExtension({
      authority: input.authority,
      duplicate: duplicates.length > 0,
      extendedDueDate: input.extendedDueDate,
      knownService: Boolean(known),
      originalDueDate: input.originalDueDate,
      periodKey: input.periodKey,
    });
    if (refusal) throw new ClientScheduleError(refusal, EXTENSION_REFUSAL_NOTES[refusal]);

    // Open obligations for this service and period, narrowed to one client where
    // the extension names one. Completed filings are excluded by the status test.
    const moved = await transaction.update(workItems).set({
      // Only stamped where nothing has been stamped before, so a second
      // extension on the same period still points at the date the firm
      // originally had, not at the first extension's date.
      originalStatutoryDueDate: sql`coalesce(${workItems.originalStatutoryDueDate}, ${workItems.statutoryDueDate})`,
      statutoryDueDate: input.extendedDueDate,
      updatedAt: new Date(),
    }).where(and(
      eq(workItems.tenantId, tenantId),
      sql`upper(${workItems.serviceKey}) = ${serviceCode}`,
      eq(workItems.periodKey, input.periodKey.trim()),
      ne(workItems.status, "completed"),
      input.legalEntityId ? eq(workItems.legalEntityId, input.legalEntityId) : sql`true`,
    )).returning({ id: workItems.id, legalEntityId: workItems.legalEntityId });

    const [saved] = await transaction.insert(complianceExtensions).values({
      appliedAt: new Date(),
      appliedCount: moved.length,
      authority: input.authority.trim().slice(0, 200),
      createdByUserId: actorUserId,
      extendedDueDate: input.extendedDueDate,
      legalEntityId: input.legalEntityId,
      note: input.note.trim().slice(0, 500),
      originalDueDate: input.originalDueDate,
      periodKey: input.periodKey.trim(),
      serviceCode,
      tenantId,
    }).returning({ id: complianceExtensions.id });

    for (const item of moved) {
      await transaction.insert(auditEvents).values({
        action: "work_item.due_date_extended",
        actorUserId,
        reason: `${input.originalDueDate} → ${input.extendedDueDate} · ${input.authority.trim().slice(0, 150)}`,
        resourceId: item.id,
        resourceType: "work_item",
        tenantId,
      });
    }

    return { id: saved!.id, moved: moved.length };
  });
}

/** The extension that moved one obligation's date, for the work-item page. */
export async function extensionFor(
  database: DashboardDatabase,
  tenantId: string,
  legalEntityId: string,
  serviceKey: string,
  periodKey: string,
) {
  const rows = await database.select({
    authority: complianceExtensions.authority,
    extendedDueDate: complianceExtensions.extendedDueDate,
    legalEntityId: complianceExtensions.legalEntityId,
    note: complianceExtensions.note,
    originalDueDate: complianceExtensions.originalDueDate,
  }).from(complianceExtensions)
    .where(and(
      eq(complianceExtensions.tenantId, tenantId),
      sql`upper(${complianceExtensions.serviceCode}) = upper(${serviceKey})`,
      eq(complianceExtensions.periodKey, periodKey),
      or(isNull(complianceExtensions.legalEntityId), eq(complianceExtensions.legalEntityId, legalEntityId)),
    ));
  // The particular beats the general, matching how the due date itself resolves.
  return rows.find((row) => row.legalEntityId !== null) ?? rows[0] ?? null;
}

/** Clients engaged for a service, for the override form's client list. */
export async function clientsEntitledTo(database: DashboardDatabase, tenantId: string, todayKey = indiaDateKey()) {
  const entitlements = await listEntitledServices(database, tenantId, todayKey);
  const ids = [...new Set(entitlements.map((entry) => entry.legalEntityId))];
  if (ids.length === 0) return [];
  const names = await database.select({ displayName: legalEntities.displayName, id: legalEntities.id })
    .from(legalEntities)
    .where(and(eq(legalEntities.tenantId, tenantId), inArray(legalEntities.id, ids)));
  const nameById = new Map(names.map((row) => [row.id, row.displayName]));
  return entitlements
    .map((entry) => ({
      clientName: nameById.get(entry.legalEntityId) ?? "Unknown client",
      legalEntityId: entry.legalEntityId,
      serviceCode: entry.serviceCode,
    }))
    .sort((left, right) => left.clientName.localeCompare(right.clientName) || left.serviceCode.localeCompare(right.serviceCode));
}

/** Firm schedules in force today, for showing what an override departs from. */
export async function firmRulesToday(database: DashboardDatabase, tenantId: string, todayKey = indiaDateKey()) {
  return listActiveScheduleRules(database, tenantId, todayKey);
}
