import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";

import {
  auditEvents,
  invoiceLines,
  invoices,
  legalEntities,
  tenants,
  timeEntries,
  users,
  workItems,
} from "../../db/schema";
import type { DashboardDatabase } from "../dashboard/postgres/repository";
import { loadRateBook } from "../rates/repository";
import { resolveCharge } from "../rates/valuation";
import { workServiceLabel } from "../work/validation";
import {
  buildDraft,
  DRAFT_REFUSAL_NOTES,
  needsWriteOffReason,
  realisationOf,
  refuseDraft,
  type BillableEntry,
  type Draft,
  type DraftRefusal,
} from "./time-billing";

/**
 * Drafting an invoice from time, and claiming the entries it consumes.
 *
 * The claim happens when the draft is raised rather than when it is issued, so
 * two drafts cannot quietly bill the same hours while somebody decides which to
 * send. Cancelling a draft gives them back.
 */

export class TimeBillingError extends Error {
  constructor(public readonly code: DraftRefusal | "not_found" | "not_draft" | "invalid_client", message?: string) {
    super(message ?? {
      invalid_client: "That client is not active in this tenant.",
      not_draft: "Only a draft invoice can be built from time.",
      not_found: "That invoice was not found.",
    }[code as "not_found" | "not_draft" | "invalid_client"] ?? "That invoice could not be drafted.");
    this.name = "TimeBillingError";
  }
}

/** Unbilled billable time for one client in a window, priced. */
export async function loadBillableTime(
  database: DashboardDatabase,
  tenantId: string,
  legalEntityId: string,
  periodFrom: string,
  periodTo: string,
): Promise<BillableEntry[]> {
  const [rows, book] = await Promise.all([
    database.select({
      employeeName: users.fullName,
      employeeUserId: timeEntries.employeeUserId,
      entryDate: timeEntries.entryDate,
      id: timeEntries.id,
      minutes: timeEntries.minutes,
      narration: timeEntries.narration,
      periodKey: workItems.periodKey,
      serviceKey: workItems.serviceKey,
      workItemId: timeEntries.workItemId,
    }).from(timeEntries)
      .innerJoin(users, eq(users.id, timeEntries.employeeUserId))
      .leftJoin(workItems, and(eq(workItems.tenantId, timeEntries.tenantId), eq(workItems.id, timeEntries.workItemId)))
      .where(and(
        eq(timeEntries.tenantId, tenantId),
        eq(timeEntries.legalEntityId, legalEntityId),
        eq(timeEntries.billable, true),
        // Unbilled, which is the whole point: an entry already on a line is not
        // offered again, on this invoice or any other.
        isNull(timeEntries.invoiceLineId),
        sql`${timeEntries.entryDate} >= ${periodFrom}::date`,
        sql`${timeEntries.entryDate} <= ${periodTo}::date`,
      ))
      .orderBy(asc(timeEntries.entryDate)),
    loadRateBook(database, tenantId),
  ]);

  return rows.map((row) => ({
    chargePaisePerHour: resolveCharge(book, row.employeeUserId, legalEntityId, row.entryDate).paisePerHour,
    employeeName: row.employeeName,
    employeeUserId: row.employeeUserId,
    entryDate: row.entryDate,
    id: row.id,
    minutes: row.minutes,
    narration: row.narration,
    workItemId: row.workItemId,
    workLabel: row.serviceKey ? `${workServiceLabel(row.serviceKey)} · ${row.periodKey}` : null,
  }));
}

export type TimeDraft = Draft & { entryCount: number; periodFrom: string; periodTo: string };

/** What an invoice built from this client's unbilled time would look like. */
export async function previewDraft(
  database: DashboardDatabase,
  tenantId: string,
  legalEntityId: string,
  periodFrom: string,
  periodTo: string,
  fallbackLabel: string,
): Promise<TimeDraft> {
  const entries = await loadBillableTime(database, tenantId, legalEntityId, periodFrom, periodTo);
  return {
    ...buildDraft({ entries, fallbackLabel }),
    entryCount: entries.length,
    periodFrom,
    periodTo,
  };
}

export type TimeInvoiceLineInput = {
  amountPaise: number;
  description: string;
  entryIds: string[];
  writeOffReason: string;
};

export type TimeInvoiceInput = {
  legalEntityId: string;
  lines: TimeInvoiceLineInput[];
  notes: string;
  periodFrom: string;
  periodLabel: string;
  periodTo: string;
};

/**
 * Raise a draft invoice from time, claiming every entry it consumes.
 *
 * The value on each line is recomputed here from the entries actually claimed
 * rather than trusted from the form: a figure the browser sent is a figure
 * somebody could have changed, and the write-down is measured against it.
 */
export async function createInvoiceFromTime(
  database: DashboardDatabase,
  tenantId: string,
  actorUserId: string,
  input: TimeInvoiceInput,
) {
  return database.transaction(async (transaction) => {
    await transaction.select({ id: tenants.id }).from(tenants).where(eq(tenants.id, tenantId)).limit(1).for("update");
    const [client] = await transaction.select({ id: legalEntities.id }).from(legalEntities).where(and(
      eq(legalEntities.tenantId, tenantId),
      eq(legalEntities.id, input.legalEntityId),
      eq(legalEntities.status, "active"),
    )).limit(1);
    if (!client) throw new TimeBillingError("invalid_client");

    const claimedIds = input.lines.flatMap((line) => line.entryIds);
    const available = await loadBillableTime(
      transaction as unknown as DashboardDatabase,
      tenantId,
      input.legalEntityId,
      input.periodFrom,
      input.periodTo,
    );
    const byId = new Map(available.map((entry) => [entry.id, entry]));

    const refusal = refuseDraft({
      entryCount: claimedIds.filter((entryId) => byId.has(entryId)).length,
      lines: input.lines.map((line) => ({ amountPaise: line.amountPaise, valuePaise: 0 })),
      periodFrom: input.periodFrom,
      periodTo: input.periodTo,
    });
    if (refusal) throw new TimeBillingError(refusal, DRAFT_REFUSAL_NOTES[refusal]);

    const [sequence] = await transaction.select({ next: sql<number>`coalesce(max(${invoices.invoiceSeq}), 0) + 1` })
      .from(invoices).where(eq(invoices.tenantId, tenantId));
    const invoiceSeq = sequence?.next ?? 1;
    const invoiceId = randomUUID();

    const prepared = input.lines.map((line) => {
      const entries = line.entryIds.map((entryId) => byId.get(entryId)).filter(Boolean) as BillableEntry[];
      const built = buildDraft({ entries, fallbackLabel: line.description });
      const valuePaise = built.totalValuePaise;
      const minutes = built.totalMinutes;
      if (needsWriteOffReason({ amountPaise: line.amountPaise, valuePaise }) && line.writeOffReason.trim().length === 0) {
        throw new TimeBillingError("reason_required", DRAFT_REFUSAL_NOTES.reason_required);
      }
      return {
        amountPaise: line.amountPaise,
        description: line.description,
        entryIds: entries.map((entry) => entry.id),
        id: randomUUID(),
        minutes,
        valuePaise,
        workItemId: entries[0]?.workItemId ?? null,
        writeOffReason: line.writeOffReason.trim().slice(0, 500),
      };
    }).filter((line) => line.minutes > 0);

    if (prepared.length === 0) throw new TimeBillingError("no_unbilled_time", DRAFT_REFUSAL_NOTES.no_unbilled_time);
    const subtotalPaise = prepared.reduce((total, line) => total + line.amountPaise, 0);

    await transaction.insert(invoices).values({
      assignmentId: null,
      createdByUserId: actorUserId,
      id: invoiceId,
      invoiceNumber: `INV-${String(invoiceSeq).padStart(5, "0")}`,
      invoiceSeq,
      legalEntityId: input.legalEntityId,
      notes: input.notes.slice(0, 2000),
      periodLabel: input.periodLabel,
      status: "draft",
      subtotalPaise,
      taxPaise: 0,
      tenantId,
      totalPaise: subtotalPaise,
    });

    for (const [index, line] of prepared.entries()) {
      await transaction.insert(invoiceLines).values({
        amountPaise: line.amountPaise,
        description: line.description.slice(0, 200),
        id: line.id,
        invoiceId,
        lineType: "time",
        minutes: line.minutes,
        position: index + 1,
        tenantId,
        valuePaise: line.valuePaise,
        workItemId: line.workItemId,
        writeOffReason: line.writeOffReason,
      });
      // Claimed now, not at issue, so a second draft cannot take the same hours.
      await transaction.update(timeEntries)
        .set({ invoiceLineId: line.id, updatedAt: new Date() })
        .where(and(
          eq(timeEntries.tenantId, tenantId),
          inArray(timeEntries.id, line.entryIds),
          isNull(timeEntries.invoiceLineId),
        ));
    }

    const realisation = realisationOf(prepared);
    await transaction.insert(auditEvents).values({
      action: "invoice.created_from_time",
      actorUserId,
      reason: `${input.periodLabel} · ${prepared.length} line(s) · ${realisation.percent ?? 100}% realised`,
      resourceId: invoiceId,
      resourceType: "invoice",
      tenantId,
    });
    return invoiceId;
  });
}

/**
 * Give the entries back.
 *
 * Called when a draft built from time is cancelled or deleted. Time held by an
 * invoice nobody sent is time the firm can never bill, which is a worse failure
 * than the double-billing the claim exists to prevent.
 */
export async function releaseEntries(
  transaction: Parameters<Parameters<DashboardDatabase["transaction"]>[0]>[0],
  tenantId: string,
  invoiceId: string,
) {
  const lines = await transaction.select({ id: invoiceLines.id }).from(invoiceLines)
    .where(and(eq(invoiceLines.tenantId, tenantId), eq(invoiceLines.invoiceId, invoiceId)));
  if (lines.length === 0) return 0;
  const released = await transaction.update(timeEntries)
    .set({ invoiceLineId: null, updatedAt: new Date() })
    .where(and(
      eq(timeEntries.tenantId, tenantId),
      inArray(timeEntries.invoiceLineId, lines.map((line) => line.id)),
    ))
    .returning({ id: timeEntries.id });
  return released.length;
}

export type LineRealisation = {
  amountPaise: number;
  description: string;
  minutes: number | null;
  valuePaise: number | null;
  writeOffReason: string;
};

/** What one invoice realised against the time behind it. */
export async function invoiceRealisation(database: DashboardDatabase, tenantId: string, invoiceId: string) {
  const lines = await database.select({
    amountPaise: invoiceLines.amountPaise,
    description: invoiceLines.description,
    minutes: invoiceLines.minutes,
    valuePaise: invoiceLines.valuePaise,
    writeOffReason: invoiceLines.writeOffReason,
  }).from(invoiceLines)
    .where(and(eq(invoiceLines.tenantId, tenantId), eq(invoiceLines.invoiceId, invoiceId)))
    .orderBy(asc(invoiceLines.position));

  return {
    lines: lines as LineRealisation[],
    minutes: lines.reduce((total, line) => total + (line.minutes ?? 0), 0),
    realisation: realisationOf(lines),
  };
}

/** Realisation across every issued invoice for one client. */
export async function clientRealisation(database: DashboardDatabase, tenantId: string, legalEntityId: string) {
  const lines = await database.select({
    amountPaise: invoiceLines.amountPaise,
    minutes: invoiceLines.minutes,
    valuePaise: invoiceLines.valuePaise,
  }).from(invoiceLines)
    .innerJoin(invoices, and(eq(invoices.tenantId, invoiceLines.tenantId), eq(invoices.id, invoiceLines.invoiceId)))
    .where(and(
      eq(invoiceLines.tenantId, tenantId),
      eq(invoices.legalEntityId, legalEntityId),
      sql`${invoices.status} <> 'cancelled'`,
    ));
  return {
    minutes: lines.reduce((total, line) => total + (line.minutes ?? 0), 0),
    realisation: realisationOf(lines),
  };
}

/** Unbilled billable time by client, for a "what is there to bill" screen. */
export async function unbilledByClient(database: DashboardDatabase, tenantId: string) {
  return database.select({
    clientName: legalEntities.displayName,
    // The joined entity rather than the entry's nullable column: the inner join
    // has already established there is one.
    legalEntityId: legalEntities.id,
    minutes: sql<number>`sum(${timeEntries.minutes})::int`,
    oldest: sql<string>`min(${timeEntries.entryDate})::text`,
  }).from(timeEntries)
    .innerJoin(legalEntities, and(
      eq(legalEntities.tenantId, timeEntries.tenantId),
      eq(legalEntities.id, timeEntries.legalEntityId),
    ))
    .where(and(
      eq(timeEntries.tenantId, tenantId),
      eq(timeEntries.billable, true),
      isNull(timeEntries.invoiceLineId),
    ))
    .groupBy(legalEntities.id, legalEntities.displayName)
    .orderBy(asc(legalEntities.displayName));
}
