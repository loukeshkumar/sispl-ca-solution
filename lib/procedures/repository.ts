import { and, asc, desc, eq, inArray, max, sql } from "drizzle-orm";

import {
  auditEvents,
  procedureSteps,
  procedureVersions,
  serviceCatalog,
  users,
  workItems,
  workItemSteps,
} from "../../db/schema";
import type { DashboardDatabase } from "../dashboard/postgres/repository";
import {
  completionBlockers,
  deriveProgress,
  refusePublish,
  refuseTransition,
  sequence,
  type DraftStep,
  type ProcedureStatus,
  type StepProgress,
  type StepStatus,
} from "./steps";

/**
 * Authoring procedures, instantiating them onto work, and recording what was
 * actually done.
 *
 * Instantiation is a copy, never a reference. The procedure a firm follows will
 * change; what it followed in a given month must not.
 */

export class ProcedureError extends Error {
  constructor(public readonly code:
    | "not_found" | "unknown_service" | "already_published" | "no_steps"
    | "invalid_step" | "reason_required" | "locked") {
    super({
      not_found: "That procedure or step was not found.",
      unknown_service: "Choose a service from the firm's service master.",
      already_published: "A published version cannot be changed. Draft a new version instead.",
      no_steps: "A procedure with no steps would instantiate nothing. Add at least one.",
      invalid_step: "Choose whether the step is done, not done, or not applicable.",
      reason_required: "Say why the step does not apply.",
      locked: "This work item is complete and its procedure record is closed.",
    }[code]);
    this.name = "ProcedureError";
  }
}

export type ProcedureVersionRow = {
  effectiveFrom: string;
  id: string;
  note: string;
  publishedAt: string | null;
  publishedByName: string | null;
  serviceCode: string;
  serviceName: string | null;
  status: ProcedureStatus;
  stepCount: number;
  version: number;
};

export async function listProcedures(database: DashboardDatabase, tenantId: string): Promise<ProcedureVersionRow[]> {
  const rows = await database.select({
    effectiveFrom: procedureVersions.effectiveFrom,
    id: procedureVersions.id,
    note: procedureVersions.note,
    publishedAt: procedureVersions.publishedAt,
    publishedByName: users.fullName,
    serviceCode: procedureVersions.serviceCode,
    serviceName: serviceCatalog.name,
    status: procedureVersions.status,
    stepCount: sql<number>`(select count(*) from ${procedureSteps} where ${procedureSteps.procedureVersionId} = ${procedureVersions.id})::int`,
    version: procedureVersions.version,
  }).from(procedureVersions)
    .leftJoin(users, eq(users.id, procedureVersions.publishedByUserId))
    .leftJoin(serviceCatalog, and(
      eq(serviceCatalog.tenantId, procedureVersions.tenantId),
      sql`upper(${serviceCatalog.code}) = upper(${procedureVersions.serviceCode})`,
    ))
    .where(eq(procedureVersions.tenantId, tenantId))
    .orderBy(asc(procedureVersions.serviceCode), desc(procedureVersions.version));

  return rows.map((row) => ({
    ...row,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    status: row.status as ProcedureStatus,
  }));
}

export type ProcedureStepRow = { id: string; instruction: string; mandatory: boolean; position: number; title: string };

export async function listProcedureSteps(
  database: DashboardDatabase,
  tenantId: string,
  procedureVersionId: string,
): Promise<ProcedureStepRow[]> {
  return database.select({
    id: procedureSteps.id,
    instruction: procedureSteps.instruction,
    mandatory: procedureSteps.mandatory,
    position: procedureSteps.position,
    title: procedureSteps.title,
  }).from(procedureSteps)
    .where(and(eq(procedureSteps.tenantId, tenantId), eq(procedureSteps.procedureVersionId, procedureVersionId)))
    .orderBy(asc(procedureSteps.position));
}

/**
 * The published procedure in force for a service on a date.
 *
 * Effective-dated, so a procedure written today can be scheduled to take effect
 * at the start of next quarter. Two versions may legitimately share an effective
 * date — a firm correcting a procedure it published this morning — and the later
 * version supersedes. Without that tie-break the answer depends on the order the
 * database happens to return rows in, which is no answer at all.
 */
export async function procedureInForce(
  database: DashboardDatabase,
  tenantId: string,
  serviceCode: string,
  dateKey: string,
) {
  const rows = await database.select({
    effectiveFrom: procedureVersions.effectiveFrom,
    id: procedureVersions.id,
    version: procedureVersions.version,
  }).from(procedureVersions).where(and(
    eq(procedureVersions.tenantId, tenantId),
    sql`upper(${procedureVersions.serviceCode}) = ${serviceCode.toUpperCase()}`,
    eq(procedureVersions.status, "published"),
  ));

  const started = rows.filter((row) => row.effectiveFrom <= dateKey);
  if (started.length === 0) return null;
  return started.reduce((chosen, row) => {
    if (row.effectiveFrom !== chosen.effectiveFrom) return row.effectiveFrom > chosen.effectiveFrom ? row : chosen;
    return row.version > chosen.version ? row : chosen;
  });
}

/**
 * Copy the procedure onto a work item.
 *
 * Called once, when the obligation is raised. Silently does nothing when the
 * service has no published procedure — that work keeps the hand-typed progress
 * it has always had, rather than being blocked on a procedure nobody wrote.
 */
export async function instantiateProcedure(
  database: DashboardDatabase,
  tenantId: string,
  workItemId: string,
  serviceCode: string,
  dateKey: string,
): Promise<string | null> {
  const version = await procedureInForce(database, tenantId, serviceCode, dateKey);
  if (!version) return null;

  const steps = await listProcedureSteps(database, tenantId, version.id);
  if (steps.length === 0) return null;

  await database.insert(workItemSteps).values(steps.map((step) => ({
    tenantId,
    workItemId,
    procedureVersionId: version.id,
    position: step.position,
    title: step.title,
    instruction: step.instruction,
    mandatory: step.mandatory,
    status: "pending" as const,
  }))).onConflictDoNothing();

  await database.update(workItems).set({ procedureVersionId: version.id })
    .where(and(eq(workItems.tenantId, tenantId), eq(workItems.id, workItemId)));
  return version.id;
}

export type WorkStepRow = {
  completedAt: string | null;
  completedByName: string | null;
  id: string;
  instruction: string;
  mandatory: boolean;
  note: string;
  position: number;
  status: StepStatus;
  title: string;
};

export async function listWorkItemSteps(
  database: DashboardDatabase,
  tenantId: string,
  workItemId: string,
): Promise<WorkStepRow[]> {
  const rows = await database.select({
    completedAt: workItemSteps.completedAt,
    completedByName: users.fullName,
    id: workItemSteps.id,
    instruction: workItemSteps.instruction,
    mandatory: workItemSteps.mandatory,
    note: workItemSteps.note,
    position: workItemSteps.position,
    status: workItemSteps.status,
    title: workItemSteps.title,
  }).from(workItemSteps)
    .leftJoin(users, eq(users.id, workItemSteps.completedByUserId))
    .where(and(eq(workItemSteps.tenantId, tenantId), eq(workItemSteps.workItemId, workItemId)))
    .orderBy(asc(workItemSteps.position));

  return rows.map((row) => ({
    ...row,
    completedAt: row.completedAt?.toISOString() ?? null,
    status: row.status as StepStatus,
  }));
}

/** Progress counted from the steps, for one item. Null percent means no procedure. */
export async function progressFor(
  database: DashboardDatabase,
  tenantId: string,
  workItemId: string,
): Promise<StepProgress> {
  const rows = await database.select({
    mandatory: workItemSteps.mandatory,
    position: workItemSteps.position,
    status: workItemSteps.status,
  }).from(workItemSteps)
    .where(and(eq(workItemSteps.tenantId, tenantId), eq(workItemSteps.workItemId, workItemId)));
  return deriveProgress(rows.map((row) => ({ ...row, status: row.status as StepStatus })));
}

/** Mandatory steps still outstanding, which is what refuses a completion. */
export async function blockersFor(database: DashboardDatabase, tenantId: string, workItemId: string) {
  const rows = await database.select({
    mandatory: workItemSteps.mandatory,
    position: workItemSteps.position,
    status: workItemSteps.status,
    title: workItemSteps.title,
  }).from(workItemSteps)
    .where(and(eq(workItemSteps.tenantId, tenantId), eq(workItemSteps.workItemId, workItemId)));
  return completionBlockers(rows.map((row) => ({ ...row, status: row.status as StepStatus })));
}

/**
 * Record what happened to one step, and recount the item's progress.
 *
 * Progress is written back onto the work item rather than derived on every read,
 * because the queue, the capacity board and the dashboard all sort and band by
 * it — and a figure three screens disagree about is worse than a stale one.
 */
export async function setStepStatus(
  database: DashboardDatabase,
  tenantId: string,
  actorUserId: string,
  stepId: string,
  transition: { note: string; status: string },
) {
  const refusal = refuseTransition({ note: transition.note, status: transition.status as StepStatus });
  if (refusal === "unknown_status") throw new ProcedureError("invalid_step");
  if (refusal === "reason_required") throw new ProcedureError("reason_required");
  const status = transition.status as StepStatus;

  return database.transaction(async (nested) => {
    const [step] = await nested.select({
      title: workItemSteps.title,
      workItemId: workItemSteps.workItemId,
    }).from(workItemSteps)
      .where(and(eq(workItemSteps.tenantId, tenantId), eq(workItemSteps.id, stepId)))
      .limit(1).for("update");
    if (!step) throw new ProcedureError("not_found");

    const [item] = await nested.select({ status: workItems.status }).from(workItems)
      .where(and(eq(workItems.tenantId, tenantId), eq(workItems.id, step.workItemId))).limit(1);
    // A completed obligation is a closed record; reopening it is the way to
    // change what it says happened.
    if (item?.status === "completed") throw new ProcedureError("locked");

    const now = new Date();
    await nested.update(workItemSteps).set({
      status,
      note: transition.note.trim().slice(0, 1000),
      completedByUserId: status === "pending" ? null : actorUserId,
      completedAt: status === "pending" ? null : now,
      updatedAt: now,
    }).where(and(eq(workItemSteps.tenantId, tenantId), eq(workItemSteps.id, stepId)));

    const progress = await progressFor(nested, tenantId, step.workItemId);
    if (progress.percent !== null) {
      await nested.update(workItems).set({ progress: progress.percent, updatedAt: now })
        .where(and(eq(workItems.tenantId, tenantId), eq(workItems.id, step.workItemId)));
    }

    await nested.insert(auditEvents).values({
      tenantId, actorUserId, resourceType: "work_item", resourceId: step.workItemId,
      action: `work.step_${status}`,
      reason: `${step.title}${transition.note.trim() ? ` — ${transition.note.trim()}` : ""}`,
    });
    return progress;
  });
}

export type ProcedureDraftInput = {
  effectiveFrom: string;
  note: string;
  serviceCode: string;
  steps: DraftStep[];
};

/**
 * Start a new draft version of a service's procedure.
 *
 * Numbered from the highest version the service has ever had, so a version
 * number is never reused even after an archive.
 */
export async function draftProcedure(
  database: DashboardDatabase,
  tenantId: string,
  actorUserId: string,
  input: ProcedureDraftInput,
) {
  const serviceCode = input.serviceCode.trim().toUpperCase();
  return database.transaction(async (nested) => {
    const [service] = await nested.select({ code: serviceCatalog.code }).from(serviceCatalog).where(and(
      eq(serviceCatalog.tenantId, tenantId),
      eq(serviceCatalog.status, "active"),
      sql`upper(${serviceCatalog.code}) = ${serviceCode}`,
    )).limit(1);
    if (!service) throw new ProcedureError("unknown_service");

    const [highest] = await nested.select({ value: max(procedureVersions.version) }).from(procedureVersions)
      .where(and(eq(procedureVersions.tenantId, tenantId), sql`upper(${procedureVersions.serviceCode}) = ${serviceCode}`));

    const [saved] = await nested.insert(procedureVersions).values({
      tenantId,
      serviceCode,
      version: (highest?.value ?? 0) + 1,
      status: "draft",
      effectiveFrom: input.effectiveFrom,
      note: input.note.slice(0, 500),
      createdByUserId: actorUserId,
    }).returning({ id: procedureVersions.id, version: procedureVersions.version });

    const ordered = sequence(input.steps);
    if (ordered.length > 0) {
      await nested.insert(procedureSteps).values(ordered.map((step) => ({
        tenantId, procedureVersionId: saved!.id, ...step,
      })));
    }

    await nested.insert(auditEvents).values({
      tenantId, actorUserId, resourceType: "procedure_version", resourceId: saved!.id,
      action: "procedure.drafted", reason: `${serviceCode} v${saved!.version} · ${ordered.length} steps`,
    });
    return saved!.id;
  });
}

/** Replace a draft's steps wholesale. Published versions are sealed. */
export async function replaceDraftSteps(
  database: DashboardDatabase,
  tenantId: string,
  actorUserId: string,
  procedureVersionId: string,
  steps: DraftStep[],
) {
  await database.transaction(async (nested) => {
    const [version] = await nested.select({ status: procedureVersions.status }).from(procedureVersions)
      .where(and(eq(procedureVersions.tenantId, tenantId), eq(procedureVersions.id, procedureVersionId)))
      .limit(1).for("update");
    if (!version) throw new ProcedureError("not_found");
    if (version.status !== "draft") throw new ProcedureError("already_published");

    await nested.delete(procedureSteps).where(and(
      eq(procedureSteps.tenantId, tenantId),
      eq(procedureSteps.procedureVersionId, procedureVersionId),
    ));
    const ordered = sequence(steps);
    if (ordered.length > 0) {
      await nested.insert(procedureSteps).values(ordered.map((step) => ({
        tenantId, procedureVersionId, ...step,
      })));
    }

    await nested.insert(auditEvents).values({
      tenantId, actorUserId, resourceType: "procedure_version", resourceId: procedureVersionId,
      action: "procedure.steps_revised", reason: `${ordered.length} steps`,
    });
  });
}

/**
 * Publish a draft.
 *
 * From here it is sealed, and every obligation raised for the service after its
 * effective date carries a copy of it.
 */
export async function publishProcedure(
  database: DashboardDatabase,
  tenantId: string,
  actorUserId: string,
  procedureVersionId: string,
) {
  await database.transaction(async (nested) => {
    const [version] = await nested.select({
      serviceCode: procedureVersions.serviceCode,
      status: procedureVersions.status,
      version: procedureVersions.version,
    }).from(procedureVersions)
      .where(and(eq(procedureVersions.tenantId, tenantId), eq(procedureVersions.id, procedureVersionId)))
      .limit(1).for("update");
    if (!version) throw new ProcedureError("not_found");

    const [count] = await nested.select({ value: sql<number>`count(*)::int` }).from(procedureSteps)
      .where(and(eq(procedureSteps.tenantId, tenantId), eq(procedureSteps.procedureVersionId, procedureVersionId)));

    const refusal = refusePublish({ status: version.status as ProcedureStatus, stepCount: count?.value ?? 0 });
    if (refusal === "already_published") throw new ProcedureError("already_published");
    if (refusal === "no_steps") throw new ProcedureError("no_steps");

    const now = new Date();
    await nested.update(procedureVersions).set({
      status: "published", publishedAt: now, publishedByUserId: actorUserId, updatedAt: now,
    }).where(and(eq(procedureVersions.tenantId, tenantId), eq(procedureVersions.id, procedureVersionId)));

    await nested.insert(auditEvents).values({
      tenantId, actorUserId, resourceType: "procedure_version", resourceId: procedureVersionId,
      action: "procedure.published", reason: `${version.serviceCode} v${version.version}`,
    });
  });
}

export async function archiveProcedure(
  database: DashboardDatabase,
  tenantId: string,
  actorUserId: string,
  procedureVersionId: string,
) {
  await database.transaction(async (nested) => {
    const [archived] = await nested.update(procedureVersions).set({ status: "archived", updatedAt: new Date() })
      .where(and(
        eq(procedureVersions.tenantId, tenantId),
        eq(procedureVersions.id, procedureVersionId),
        eq(procedureVersions.status, "published"),
      )).returning({ id: procedureVersions.id });
    if (!archived) throw new ProcedureError("not_found");
    await nested.insert(auditEvents).values({
      tenantId, actorUserId, resourceType: "procedure_version", resourceId: procedureVersionId,
      action: "procedure.archived", reason: "Withdrawn from new work",
    });
  });
}

/** Services with no published procedure, so the gap is visible rather than assumed. */
export async function servicesWithoutProcedure(database: DashboardDatabase, tenantId: string) {
  const [services, published] = await Promise.all([
    database.select({ code: serviceCatalog.code, name: serviceCatalog.name }).from(serviceCatalog)
      .where(and(eq(serviceCatalog.tenantId, tenantId), eq(serviceCatalog.status, "active")))
      .orderBy(asc(serviceCatalog.name)),
    database.select({ serviceCode: procedureVersions.serviceCode }).from(procedureVersions)
      .where(and(eq(procedureVersions.tenantId, tenantId), eq(procedureVersions.status, "published"))),
  ]);
  const covered = new Set(published.map((row) => row.serviceCode.toUpperCase()));
  return services.filter((service) => !covered.has(service.code.toUpperCase()));
}

export const stepsForItems = async (database: DashboardDatabase, tenantId: string, workItemIds: readonly string[]) =>
  workItemIds.length === 0 ? [] : database.select({
    mandatory: workItemSteps.mandatory,
    status: workItemSteps.status,
    workItemId: workItemSteps.workItemId,
  }).from(workItemSteps).where(and(
    eq(workItemSteps.tenantId, tenantId),
    inArray(workItemSteps.workItemId, [...workItemIds]),
  ));
