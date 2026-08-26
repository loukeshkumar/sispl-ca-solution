import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import {
  auditEvents,
  clientAcceptanceChecks,
  clientAcceptances,
  engagementLetters,
  engagementLetterServices,
  legalEntities,
  users,
  workItems,
} from "../../db/schema";
import type { DashboardDatabase } from "../dashboard/postgres/repository";
import {
  ACCEPTANCE_LABELS,
  CHECK_REFUSAL_NOTES,
  coveringLetter,
  DECISION_REFUSAL_NOTES,
  LETTER_REFUSAL_NOTES,
  refuseCheck,
  refuseDecision,
  refuseLetter,
  standingOf,
  type AcceptanceCheck,
  type AcceptanceStanding,
  type AcceptanceStatus,
  type CheckKey,
  type CheckOutcome,
  type CheckRefusal,
  type DecisionRefusal,
  type EngagementLetter,
  type LetterRefusal,
  type LetterStatus,
} from "./acceptance";

/**
 * Client acceptance, and the letters that set out what was agreed.
 *
 * Acceptance is a gate rather than a record: a client stays `prospect` until a
 * partner decides, and `assertActiveClient` — which already guarded work,
 * packages and invoices — refuses a prospect without any change. That was the
 * whole point of making acceptance a status rather than a flag beside one.
 */

export class AcceptanceError extends Error {
  constructor(public readonly code: CheckRefusal | DecisionRefusal | LetterRefusal | "not_found", message?: string) {
    super(message ?? "That client was not found.");
    this.name = "AcceptanceError";
  }
}

const checker = alias(users, "acceptance_checker");
const decider = alias(users, "acceptance_decider");

export type AcceptanceCheckRow = AcceptanceCheck & { checkedByName: string; checkedByUserId: string };

export type AcceptanceView = AcceptanceStanding & {
  checks: AcceptanceCheckRow[];
  clientName: string;
  decidedByName: string | null;
  decisionNote: string;
  entityStatus: string;
  legalEntityId: string;
};

export async function getAcceptance(
  database: DashboardDatabase,
  tenantId: string,
  legalEntityId: string,
): Promise<AcceptanceView> {
  const [[entity], [record], checkRows] = await Promise.all([
    database.select({ displayName: legalEntities.displayName, status: legalEntities.status })
      .from(legalEntities)
      .where(and(eq(legalEntities.tenantId, tenantId), eq(legalEntities.id, legalEntityId)))
      .limit(1),
    database.select({
      decidedByName: decider.fullName,
      decisionNote: clientAcceptances.decisionNote,
      status: clientAcceptances.status,
    }).from(clientAcceptances)
      .leftJoin(decider, eq(decider.id, clientAcceptances.decidedByUserId))
      .where(and(eq(clientAcceptances.tenantId, tenantId), eq(clientAcceptances.legalEntityId, legalEntityId)))
      .limit(1),
    database.select({
      checkKey: clientAcceptanceChecks.checkKey,
      checkedByName: checker.fullName,
      checkedByUserId: clientAcceptanceChecks.checkedByUserId,
      checkedOn: clientAcceptanceChecks.checkedOn,
      note: clientAcceptanceChecks.note,
      outcome: clientAcceptanceChecks.outcome,
    }).from(clientAcceptanceChecks)
      .innerJoin(checker, eq(checker.id, clientAcceptanceChecks.checkedByUserId))
      .where(and(eq(clientAcceptanceChecks.tenantId, tenantId), eq(clientAcceptanceChecks.legalEntityId, legalEntityId)))
      .orderBy(asc(clientAcceptanceChecks.checkKey)),
  ]);
  if (!entity) throw new AcceptanceError("not_found");

  const checks = checkRows.map((row) => ({
    ...row,
    checkKey: row.checkKey as CheckKey,
    outcome: row.outcome as CheckOutcome,
  }));
  const status = (record?.status as AcceptanceStatus) ?? "in_progress";

  return {
    ...standingOf({ checks, status }),
    checks,
    clientName: entity.displayName,
    decidedByName: record?.decidedByName ?? null,
    decisionNote: record?.decisionNote ?? "",
    entityStatus: entity.status,
    legalEntityId,
  };
}

/** Ensures the acceptance row exists, so checks always have something to hang on. */
async function ensureAcceptance(
  transaction: Parameters<Parameters<DashboardDatabase["transaction"]>[0]>[0],
  tenantId: string,
  legalEntityId: string,
  actorUserId: string,
) {
  await transaction.insert(clientAcceptances)
    .values({ createdByUserId: actorUserId, legalEntityId, status: "in_progress", tenantId })
    .onConflictDoNothing();
}

export type AcceptanceCheckInput = {
  checkKey: string;
  checkedOn: string;
  note: string;
  outcome: string;
};

export async function recordCheck(
  database: DashboardDatabase,
  tenantId: string,
  actorUserId: string,
  legalEntityId: string,
  input: AcceptanceCheckInput,
) {
  return database.transaction(async (transaction) => {
    await ensureAcceptance(transaction, tenantId, legalEntityId, actorUserId);
    const [record] = await transaction.select({ status: clientAcceptances.status }).from(clientAcceptances)
      .where(and(eq(clientAcceptances.tenantId, tenantId), eq(clientAcceptances.legalEntityId, legalEntityId)))
      .limit(1).for("update");

    const refusal = refuseCheck({
      acceptanceStatus: (record?.status as AcceptanceStatus) ?? "in_progress",
      checkKey: input.checkKey,
      checkedOn: input.checkedOn,
      note: input.note,
      outcome: input.outcome,
    });
    if (refusal) throw new AcceptanceError(refusal, CHECK_REFUSAL_NOTES[refusal]);

    await transaction.insert(clientAcceptanceChecks).values({
      checkKey: input.checkKey,
      checkedByUserId: actorUserId,
      checkedOn: input.checkedOn,
      legalEntityId,
      note: input.note.trim().slice(0, 1000),
      outcome: input.outcome,
      tenantId,
    }).onConflictDoUpdate({
      set: {
        checkedByUserId: actorUserId,
        checkedOn: input.checkedOn,
        note: input.note.trim().slice(0, 1000),
        outcome: input.outcome,
        updatedAt: new Date(),
      },
      target: [clientAcceptanceChecks.tenantId, clientAcceptanceChecks.legalEntityId, clientAcceptanceChecks.checkKey],
    });

    await transaction.insert(auditEvents).values({
      action: "client_acceptance.check_recorded",
      actorUserId,
      reason: `${input.checkKey} · ${input.outcome}`,
      resourceId: legalEntityId,
      resourceType: "legal_entity",
      tenantId,
    });
  });
}

/**
 * The partner's decision, and the one thing that turns a prospect into a client.
 *
 * Accepting flips the entity to `active`, which is what every existing gate
 * already tests for. Declining leaves it `declined`, which those same gates
 * refuse just as firmly.
 */
export async function decideAcceptance(
  database: DashboardDatabase,
  tenantId: string,
  actorUserId: string,
  legalEntityId: string,
  outcome: string,
  reason: string,
) {
  return database.transaction(async (transaction) => {
    await ensureAcceptance(transaction, tenantId, legalEntityId, actorUserId);
    const view = await getAcceptance(transaction as unknown as DashboardDatabase, tenantId, legalEntityId);

    const refusal = refuseDecision({
      actorUserId,
      checkerUserIds: view.checks.map((check) => check.checkedByUserId),
      outcome,
      reason,
      standing: view,
    });
    if (refusal) throw new AcceptanceError(refusal, DECISION_REFUSAL_NOTES[refusal]);

    const now = new Date();
    await transaction.update(clientAcceptances).set({
      decidedAt: now,
      decidedByUserId: actorUserId,
      decisionNote: reason.trim().slice(0, 1000),
      status: outcome,
      updatedAt: now,
    }).where(and(eq(clientAcceptances.tenantId, tenantId), eq(clientAcceptances.legalEntityId, legalEntityId)));

    await transaction.update(legalEntities).set({
      status: outcome === "accepted" ? "active" : "declined",
      updatedAt: now,
    }).where(and(eq(legalEntities.tenantId, tenantId), eq(legalEntities.id, legalEntityId)));

    await transaction.insert(auditEvents).values({
      action: `client_acceptance.${outcome}`,
      actorUserId,
      reason: reason.trim().slice(0, 200) || ACCEPTANCE_LABELS[outcome as AcceptanceStatus],
      resourceId: legalEntityId,
      resourceType: "legal_entity",
      tenantId,
    });
  });
}

export type EngagementLetterRow = EngagementLetter & {
  createdByName: string;
  feeBasis: string;
  issuedOn: string | null;
  note: string;
};

export async function listLetters(
  database: DashboardDatabase,
  tenantId: string,
  legalEntityId: string,
): Promise<EngagementLetterRow[]> {
  const rows = await database.select({
    createdByName: users.fullName,
    feeBasis: engagementLetters.feeBasis,
    id: engagementLetters.id,
    issuedOn: engagementLetters.issuedOn,
    note: engagementLetters.note,
    periodFrom: engagementLetters.periodFrom,
    periodTo: engagementLetters.periodTo,
    signedOn: engagementLetters.signedOn,
    status: engagementLetters.status,
  }).from(engagementLetters)
    .innerJoin(users, eq(users.id, engagementLetters.createdByUserId))
    .where(and(eq(engagementLetters.tenantId, tenantId), eq(engagementLetters.legalEntityId, legalEntityId)))
    .orderBy(desc(engagementLetters.periodFrom));
  if (rows.length === 0) return [];

  const services = await database.select({
    letterId: engagementLetterServices.letterId,
    serviceCode: engagementLetterServices.serviceCode,
  }).from(engagementLetterServices)
    .where(and(
      eq(engagementLetterServices.tenantId, tenantId),
      inArray(engagementLetterServices.letterId, rows.map((row) => row.id)),
    ));

  const byLetter = new Map<string, string[]>();
  for (const row of services) {
    byLetter.set(row.letterId, [...(byLetter.get(row.letterId) ?? []), row.serviceCode]);
  }

  return rows.map((row) => ({
    ...row,
    serviceCodes: (byLetter.get(row.id) ?? []).sort(),
    status: row.status as LetterStatus,
  }));
}

export type EngagementLetterInput = {
  feeBasis: string;
  issuedOn: string | null;
  note: string;
  periodFrom: string;
  periodTo: string;
  serviceCodes: string[];
  signedOn: string | null;
  status: string;
};

export async function saveLetter(
  database: DashboardDatabase,
  tenantId: string,
  actorUserId: string,
  legalEntityId: string,
  input: EngagementLetterInput,
) {
  return database.transaction(async (transaction) => {
    const serviceCodes = [...new Set(input.serviceCodes.map((code) => code.trim().toUpperCase()).filter(Boolean))];
    const refusal = refuseLetter({ ...input, serviceCodes });
    if (refusal) throw new AcceptanceError(refusal, LETTER_REFUSAL_NOTES[refusal]);

    const [saved] = await transaction.insert(engagementLetters).values({
      createdByUserId: actorUserId,
      feeBasis: input.feeBasis,
      issuedOn: input.issuedOn,
      legalEntityId,
      note: input.note.trim().slice(0, 1000),
      periodFrom: input.periodFrom,
      periodTo: input.periodTo,
      signedOn: input.signedOn,
      status: input.status,
      tenantId,
    }).returning({ id: engagementLetters.id });

    for (const serviceCode of serviceCodes) {
      await transaction.insert(engagementLetterServices)
        .values({ letterId: saved!.id, serviceCode, tenantId })
        .onConflictDoNothing();
    }

    await transaction.insert(auditEvents).values({
      action: "engagement_letter.saved",
      actorUserId,
      reason: `${serviceCodes.join(", ")} · ${input.periodFrom} to ${input.periodTo} · ${input.status}`,
      resourceId: saved!.id,
      resourceType: "engagement_letter",
      tenantId,
    });
    return saved!.id;
  });
}

export type UnletteredWork = {
  clientName: string;
  legalEntityId: string;
  periodKey: string;
  serviceKey: string;
  statutoryDueDate: string;
  workItemId: string;
};

/**
 * Open work no signed letter covers.
 *
 * The question a peer reviewer actually asks. Measured against the statutory
 * due date rather than today, because the letter has to have covered the work
 * when it was done, not when somebody happened to run the report.
 */
export async function listUnletteredWork(
  database: DashboardDatabase,
  tenantId: string,
): Promise<UnletteredWork[]> {
  const open = await database.select({
    clientName: legalEntities.displayName,
    legalEntityId: workItems.legalEntityId,
    periodKey: workItems.periodKey,
    serviceKey: workItems.serviceKey,
    statutoryDueDate: workItems.statutoryDueDate,
    workItemId: workItems.id,
  }).from(workItems)
    .innerJoin(legalEntities, and(
      eq(legalEntities.tenantId, workItems.tenantId),
      eq(legalEntities.id, workItems.legalEntityId),
    ))
    .where(and(eq(workItems.tenantId, tenantId), sql`${workItems.status} <> 'completed'`));
  if (open.length === 0) return [];

  const entityIds = [...new Set(open.map((row) => row.legalEntityId))];
  const lettersByEntity = new Map<string, EngagementLetterRow[]>();
  for (const entityId of entityIds) {
    lettersByEntity.set(entityId, await listLetters(database, tenantId, entityId));
  }

  return open.filter((row) => !coveringLetter({
    dateKey: row.statutoryDueDate,
    letters: lettersByEntity.get(row.legalEntityId) ?? [],
    serviceCode: row.serviceKey,
  }));
}

/** Clients the firm has not yet decided about, for the acceptance queue. */
export async function listProspects(database: DashboardDatabase, tenantId: string) {
  return database.select({
    displayName: legalEntities.displayName,
    id: legalEntities.id,
    relationshipStart: legalEntities.relationshipStart,
    status: legalEntities.status,
  }).from(legalEntities)
    .where(and(eq(legalEntities.tenantId, tenantId), inArray(legalEntities.status, ["prospect", "declined"])))
    .orderBy(asc(legalEntities.displayName));
}
