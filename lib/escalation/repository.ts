import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";

import {
  auditEvents,
  escalationRules,
  legalEntities,
  tenantMemberships,
  users,
  workEscalations,
  workItems,
} from "../../db/schema";
import { alias } from "drizzle-orm/pg-core";

import type { DashboardDatabase } from "../dashboard/postgres/repository";
import { indiaDateKey, insertNotifications, type NotificationDraft } from "../notifications/repository";
import {
  dueRungs,
  escalationNotice,
  overtakenBy,
  refuseRule,
  RULE_REFUSAL_NOTES,
  type EscalationAnchor,
  type EscalationRole,
  type EscalationRule,
  type RuleRefusal,
  type TargetKind,
} from "./ladder";

/**
 * The ladder the firm keeps, and the record of obligations climbing it.
 *
 * `climbLadder` is the part that matters. Everything else here is the form
 * around it: without a nightly pass that actually fires the rungs, a ladder is
 * a settings page nobody looks at.
 */

export class EscalationError extends Error {
  constructor(public readonly code: RuleRefusal | "not_found", message?: string) {
    super(message ?? "That rung was not found.");
    this.name = "EscalationError";
  }
}

export type EscalationRuleRow = EscalationRule & { createdByName: string };

export async function listEscalationRules(
  database: DashboardDatabase,
  tenantId: string,
): Promise<EscalationRuleRow[]> {
  const rows = await database.select({
    anchor: escalationRules.anchor,
    createdByName: users.fullName,
    id: escalationRules.id,
    label: escalationRules.label,
    offsetDays: escalationRules.offsetDays,
    rung: escalationRules.rung,
    targetKind: escalationRules.targetKind,
    targetRole: escalationRules.targetRole,
  }).from(escalationRules)
    .innerJoin(users, eq(users.id, escalationRules.createdByUserId))
    .where(and(eq(escalationRules.tenantId, tenantId), eq(escalationRules.status, "active")))
    .orderBy(asc(escalationRules.rung));

  return rows.map((row) => ({
    ...row,
    anchor: row.anchor as EscalationAnchor,
    targetKind: row.targetKind as TargetKind,
    targetRole: row.targetRole as EscalationRole | null,
  }));
}

export type EscalationRuleInput = {
  anchor: string;
  label: string;
  offsetDays: number;
  rung: number;
  targetKind: string;
  targetRole: string | null;
};

export async function createEscalationRule(
  database: DashboardDatabase,
  tenantId: string,
  actorUserId: string,
  input: EscalationRuleInput,
) {
  return database.transaction(async (transaction) => {
    const existing = await transaction.select({
      anchor: escalationRules.anchor,
      offsetDays: escalationRules.offsetDays,
      rung: escalationRules.rung,
    }).from(escalationRules)
      .where(and(eq(escalationRules.tenantId, tenantId), eq(escalationRules.status, "active")))
      .orderBy(asc(escalationRules.rung));

    const below = existing.filter((row) => row.rung < input.rung);
    const previous = below[below.length - 1] ?? null;

    const refusal = refuseRule({
      anchor: input.anchor,
      existingRungs: existing.map((row) => row.rung),
      label: input.label,
      offsetDays: input.offsetDays,
      previous: previous ? { anchor: previous.anchor as EscalationAnchor, offsetDays: previous.offsetDays } : null,
      rung: input.rung,
      targetKind: input.targetKind,
      targetRole: input.targetRole,
    });
    if (refusal) throw new EscalationError(refusal, RULE_REFUSAL_NOTES[refusal]);

    const [saved] = await transaction.insert(escalationRules).values({
      anchor: input.anchor,
      createdByUserId: actorUserId,
      label: input.label.trim().slice(0, 120),
      offsetDays: input.offsetDays,
      rung: input.rung,
      targetKind: input.targetKind,
      targetRole: input.targetKind === "role" ? input.targetRole : null,
      tenantId,
    }).returning({ id: escalationRules.id });

    await transaction.insert(auditEvents).values({
      action: "escalation_rule.added",
      actorUserId,
      reason: `Rung ${input.rung} · ${input.label.trim().slice(0, 100)}`,
      resourceId: saved!.id,
      resourceType: "escalation_rule",
      tenantId,
    });
    return saved!.id;
  });
}

/**
 * Archived rather than deleted.
 *
 * Escalations already recorded point at the rule that fired them, and a firm
 * asking why a partner was told in December deserves the rung as it read then.
 */
export async function archiveEscalationRule(
  database: DashboardDatabase,
  tenantId: string,
  actorUserId: string,
  ruleId: string,
) {
  return database.transaction(async (transaction) => {
    const [archived] = await transaction.update(escalationRules)
      .set({ status: "archived", updatedAt: new Date() })
      .where(and(
        eq(escalationRules.tenantId, tenantId),
        eq(escalationRules.id, ruleId),
        eq(escalationRules.status, "active"),
      ))
      .returning({ label: escalationRules.label, rung: escalationRules.rung });
    if (!archived) throw new EscalationError("not_found");

    await transaction.insert(auditEvents).values({
      action: "escalation_rule.archived",
      actorUserId,
      reason: `Rung ${archived.rung} · ${archived.label}`,
      resourceId: ruleId,
      resourceType: "escalation_rule",
      tenantId,
    });
  });
}

export type WorkEscalationRow = {
  firedOn: string;
  id: string;
  notifiedCount: number;
  reason: string;
  recipientSummary: string;
  rung: number;
};

export async function listWorkEscalations(
  database: DashboardDatabase,
  tenantId: string,
  workItemId: string,
): Promise<WorkEscalationRow[]> {
  return database.select({
    firedOn: workEscalations.firedOn,
    id: workEscalations.id,
    notifiedCount: workEscalations.notifiedCount,
    reason: workEscalations.reason,
    recipientSummary: workEscalations.recipientSummary,
    rung: workEscalations.rung,
  }).from(workEscalations)
    .where(and(eq(workEscalations.tenantId, tenantId), eq(workEscalations.workItemId, workItemId)))
    .orderBy(desc(workEscalations.rung));
}

/** How far each of these obligations has climbed, for a queue column. */
export const highestRungs = async (
  database: DashboardDatabase,
  tenantId: string,
  workItemIds: readonly string[],
) => (workItemIds.length === 0 ? [] : database.select({
  rung: sql<number>`max(${workEscalations.rung})::int`,
  workItemId: workEscalations.workItemId,
}).from(workEscalations)
  .where(and(
    eq(workEscalations.tenantId, tenantId),
    inArray(workEscalations.workItemId, [...workItemIds]),
  ))
  .groupBy(workEscalations.workItemId));

const assignee = alias(users, "escalation_assignee");

type Recipient = { fullName: string; userId: string };

/** Everyone active who carries a role, for the rungs that name one. */
async function membersByRole(database: DashboardDatabase, tenantId: string) {
  const rows = await database.select({
    fullName: users.fullName,
    roleKey: tenantMemberships.roleKey,
    userId: tenantMemberships.userId,
  }).from(tenantMemberships)
    .innerJoin(users, eq(users.id, tenantMemberships.userId))
    .where(and(eq(tenantMemberships.tenantId, tenantId), eq(tenantMemberships.status, "active")))
    .orderBy(asc(users.fullName));

  const byRole = new Map<string, Recipient[]>();
  for (const row of rows) {
    byRole.set(row.roleKey, [...(byRole.get(row.roleKey) ?? []), { fullName: row.fullName, userId: row.userId }]);
  }
  return byRole;
}

export type ClimbSummary = { fired: number; notified: number; overtaken: number };

/**
 * Walk every open obligation up the ladder as far as today puts it.
 *
 * Runs in the nightly job beside the deadline notifications. Every rung that
 * has come due is written down; only the highest tells anybody, because three
 * notifications about one filing teaches people to ignore all three.
 *
 * Nothing here changes an assignee. Who should hold a late filing is a
 * judgement, and the ladder's job is to make sure a person makes it.
 */
export async function climbLadder(
  database: DashboardDatabase,
  tenantId: string,
  now = new Date(),
  channels: Parameters<typeof insertNotifications>[3] = ["email"],
): Promise<ClimbSummary> {
  const todayKey = indiaDateKey(now);
  const rules = await listEscalationRules(database, tenantId);
  if (rules.length === 0) return { fired: 0, notified: 0, overtaken: 0 };

  const [open, byRole] = await Promise.all([
    database.select({
      assigneeId: workItems.assigneeId,
      assigneeName: assignee.fullName,
      clientName: legalEntities.displayName,
      id: workItems.id,
      internalDueDate: workItems.internalDueDate,
      periodKey: workItems.periodKey,
      serviceKey: workItems.serviceKey,
      statutoryDueDate: workItems.statutoryDueDate,
    }).from(workItems)
      .innerJoin(legalEntities, and(
        eq(legalEntities.tenantId, workItems.tenantId),
        eq(legalEntities.id, workItems.legalEntityId),
      ))
      .leftJoin(assignee, eq(assignee.id, workItems.assigneeId))
      .where(and(eq(workItems.tenantId, tenantId), ne(workItems.status, "completed"))),
    membersByRole(database, tenantId),
  ]);
  if (open.length === 0) return { fired: 0, notified: 0, overtaken: 0 };

  const firedRows = await database.select({
    rung: workEscalations.rung,
    workItemId: workEscalations.workItemId,
  }).from(workEscalations)
    .where(and(
      eq(workEscalations.tenantId, tenantId),
      inArray(workEscalations.workItemId, open.map((item) => item.id)),
    ));
  const firedByItem = new Map<string, number[]>();
  for (const row of firedRows) {
    firedByItem.set(row.workItemId, [...(firedByItem.get(row.workItemId) ?? []), row.rung]);
  }

  const summary: ClimbSummary = { fired: 0, notified: 0, overtaken: 0 };

  for (const item of open) {
    const rungs = dueRungs({
      alreadyFired: firedByItem.get(item.id) ?? [],
      item,
      rules,
      todayKey,
    });
    if (rungs.length === 0) continue;
    const highest = rungs[rungs.length - 1]!;

    for (const entry of rungs) {
      const recipients: Recipient[] = entry.overtaken
        ? []
        : entry.rule.targetKind === "assignee"
          ? (item.assigneeId
            ? [{ fullName: item.assigneeName ?? "The assignee", userId: item.assigneeId }]
            : [])
          : (byRole.get(entry.rule.targetRole!) ?? []);

      const drafts: NotificationDraft[] = recipients.map((recipient) => {
        const notice = escalationNotice({
          clientName: item.clientName,
          label: entry.rule.label,
          periodKey: item.periodKey,
          rung: entry.rule.rung,
          serviceKey: item.serviceKey,
          statutoryDueDate: item.statutoryDueDate,
          todayKey,
        });
        return {
          body: notice.body,
          // A rung fires once per obligation, so the rung itself is the key.
          dedupeKey: `work_item_escalated:${item.id}:${entry.rule.rung}:${recipient.userId}`,
          recipientUserId: recipient.userId,
          resourceId: item.id,
          resourceType: "work_item",
          title: notice.title,
          type: "work_item_escalated",
        };
      });

      const notified = drafts.length > 0 ? await insertNotifications(database, tenantId, drafts, channels) : 0;

      await database.insert(workEscalations).values({
        firedOn: todayKey,
        notifiedCount: notified,
        reason: entry.rule.label.slice(0, 120),
        recipientSummary: entry.overtaken
          ? overtakenBy(highest.rule.rung)
          : recipients.length === 0
            ? (entry.rule.targetKind === "assignee"
              ? "This obligation is unassigned, so the rung told nobody."
              : "Nobody active carries that role, so the rung told nobody.")
            : recipients.map((recipient) => recipient.fullName).join(", ").slice(0, 500),
        ruleId: entry.rule.id,
        rung: entry.rule.rung,
        tenantId,
        workItemId: item.id,
      }).onConflictDoNothing();

      summary.fired += 1;
      summary.notified += notified;
      if (entry.overtaken) summary.overtaken += 1;
    }
  }

  return summary;
}
