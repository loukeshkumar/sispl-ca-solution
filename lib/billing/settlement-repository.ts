import { and, asc, desc, eq, sql } from "drizzle-orm";

import {
  auditEvents,
  invoiceLines,
  invoiceReceipts,
  invoices,
  legalEntities,
  serviceCatalog,
  tenants,
  users,
  workItems,
} from "../../db/schema";
import type { DashboardDatabase } from "../dashboard/postgres/repository";
import {
  refuseTaxInvoice,
  supplyTypeOf,
  TAX_INVOICE_REFUSAL_NOTES,
  taxInvoice,
  type SupplyType,
  type TaxInvoiceRefusal,
} from "./gst";
import {
  RECEIPT_REFUSAL_NOTES,
  refuseReceipt,
  settlementOf,
  tdsCredits,
  type ReceiptRefusal,
  type Settlement,
} from "./settlement";

/**
 * Issuing a tax invoice, and recording what comes back against it.
 *
 * The tax is computed here at issue and written down, never read live: a rate
 * that changes in April must not silently restate what a client was charged in
 * March, and an invoice is a statement about the day it was issued.
 */

export class SettlementError extends Error {
  constructor(public readonly code: TaxInvoiceRefusal | ReceiptRefusal | "not_found" | "not_draft", message?: string) {
    super(message ?? {
      not_draft: "Only a draft invoice can be issued.",
      not_found: "That invoice was not found.",
    }[code as "not_found" | "not_draft"] ?? "That invoice could not be issued.");
    this.name = "SettlementError";
  }
}

export type TaxIdentity = {
  placeOfSupplyCode: string | null;
  recipientGstin: string | null;
  recipientStateCode: string | null;
  supplierGstin: string | null;
  supplierStateCode: string | null;
  supplyType: SupplyType;
};

/** Who is supplying whom, and where the supply lands. */
export async function taxIdentityFor(
  database: DashboardDatabase,
  tenantId: string,
  legalEntityId: string,
  overridePlaceOfSupply?: string | null,
): Promise<TaxIdentity> {
  const [[firm], [client]] = await Promise.all([
    database.select({ gstin: tenants.gstin, stateCode: tenants.stateCode })
      .from(tenants).where(eq(tenants.id, tenantId)).limit(1),
    database.select({ gstin: legalEntities.gstin, stateCode: legalEntities.stateCode })
      .from(legalEntities)
      .where(and(eq(legalEntities.tenantId, tenantId), eq(legalEntities.id, legalEntityId)))
      .limit(1),
  ]);

  // Defaults to the client's own state, which is where a service is treated as
  // supplied to a registered person unless the firm says otherwise.
  const placeOfSupplyCode = overridePlaceOfSupply ?? client?.stateCode ?? firm?.stateCode ?? null;
  return {
    placeOfSupplyCode,
    recipientGstin: client?.gstin ?? null,
    recipientStateCode: client?.stateCode ?? null,
    supplierGstin: firm?.gstin ?? null,
    supplierStateCode: firm?.stateCode ?? null,
    supplyType: supplyTypeOf({
      placeOfSupplyCode: placeOfSupplyCode ?? "",
      supplierStateCode: firm?.stateCode ?? "",
    }),
  };
}

export type IssueInput = {
  dueDate: string;
  isExport?: boolean;
  issueDate: string;
  placeOfSupplyCode?: string | null;
  reverseCharge?: boolean;
  /** Rate per line, keyed by line id. Absent lines fall back to the default. */
  rateByLineId?: Record<string, number>;
  defaultRateBp?: number;
  /**
   * SAC per line, keyed by line id. Needed for a line with no obligation behind
   * it — a package fee or an adjustment has no service to inherit one from — and
   * as an override where the catalogue's code is not the right one for this
   * supply.
   */
  sacByLineId?: Record<string, string>;
  /** Falls back to accounting and auditing services where nothing else says. */
  defaultSacCode?: string;
};

/**
 * Issue a draft as a tax invoice: compute the tax, stamp the parties, seal it.
 *
 * Everything the document must bear is checked first. A tax invoice that
 * reaches a client without a place of supply or a SAC is one the client cannot
 * claim against and the firm cannot file from, and by then it has been sent.
 */
export async function issueTaxInvoice(
  database: DashboardDatabase,
  tenantId: string,
  actorUserId: string,
  invoiceId: string,
  input: IssueInput,
) {
  return database.transaction(async (transaction) => {
    const [invoice] = await transaction.select({
      legalEntityId: invoices.legalEntityId,
      status: invoices.status,
    }).from(invoices)
      .where(and(eq(invoices.tenantId, tenantId), eq(invoices.id, invoiceId)))
      .limit(1).for("update");
    if (!invoice) throw new SettlementError("not_found");
    if (invoice.status !== "draft") throw new SettlementError("not_draft");

    const identity = await taxIdentityFor(
      transaction as unknown as DashboardDatabase,
      tenantId,
      invoice.legalEntityId,
      input.placeOfSupplyCode,
    );
    const supplyType: SupplyType = input.isExport ? "export" : identity.supplyType;

    const lineRows = await transaction.select({
      amountPaise: invoiceLines.amountPaise,
      id: invoiceLines.id,
      lineSac: invoiceLines.sacCode,
      position: invoiceLines.position,
      serviceSac: serviceCatalog.sacCode,
      workItemId: invoiceLines.workItemId,
    }).from(invoiceLines)
      // The SAC a line is supplied under comes from the service behind it, via
      // the obligation the line was raised for. A line typed by hand carries its
      // own, and a line with neither is refused at issue rather than guessed at.
      .leftJoin(workItems, and(eq(workItems.tenantId, invoiceLines.tenantId), eq(workItems.id, invoiceLines.workItemId)))
      .leftJoin(serviceCatalog, and(
        eq(serviceCatalog.tenantId, invoiceLines.tenantId),
        sql`upper(${serviceCatalog.code}) = upper(${workItems.serviceKey})`,
      ))
      .where(and(eq(invoiceLines.tenantId, tenantId), eq(invoiceLines.invoiceId, invoiceId)))
      .orderBy(asc(invoiceLines.position));

    const defaultRateBp = input.defaultRateBp ?? 1800;
    const taxable = lineRows.map((row) => ({
      amountPaise: row.amountPaise,
      id: row.id,
      sacCode: input.sacByLineId?.[row.id] ?? row.lineSac ?? row.serviceSac ?? input.defaultSacCode ?? null,
      taxRateBp: supplyType === "export" ? 0 : input.rateByLineId?.[row.id] ?? defaultRateBp,
    }));

    const refusal = refuseTaxInvoice({
      lines: taxable,
      placeOfSupplyCode: identity.placeOfSupplyCode,
      recipientGstin: identity.recipientGstin,
      recipientStateCode: identity.recipientStateCode,
      supplierGstin: identity.supplierGstin,
      supplyType,
    });
    if (refusal) throw new SettlementError(refusal, TAX_INVOICE_REFUSAL_NOTES[refusal]);

    const tax = taxInvoice({ lines: taxable, reverseCharge: input.reverseCharge, supplyType });

    for (const [index, line] of tax.lines.entries()) {
      await transaction.update(invoiceLines).set({
        cgstPaise: line.cgstPaise,
        igstPaise: line.igstPaise,
        sacCode: line.sacCode,
        sgstPaise: line.sgstPaise,
        taxRateBp: line.taxRateBp,
      }).where(and(eq(invoiceLines.tenantId, tenantId), eq(invoiceLines.id, taxable[index]!.id)));
    }

    const now = new Date();
    await transaction.update(invoices).set({
      cgstPaise: tax.cgstPaise,
      dueDate: input.dueDate,
      igstPaise: tax.igstPaise,
      issueDate: input.issueDate,
      issuedAt: now,
      issuedByUserId: actorUserId,
      placeOfSupplyCode: identity.placeOfSupplyCode,
      recipientGstin: identity.recipientGstin,
      recipientStateCode: identity.recipientStateCode,
      reverseCharge: input.reverseCharge ?? false,
      sgstPaise: tax.sgstPaise,
      status: "issued",
      subtotalPaise: tax.subtotalPaise,
      supplierGstin: identity.supplierGstin,
      supplierStateCode: identity.supplierStateCode,
      supplyType,
      taxPaise: tax.taxPaise,
      totalPaise: tax.totalPaise,
      updatedAt: now,
    }).where(and(eq(invoices.tenantId, tenantId), eq(invoices.id, invoiceId)));

    await transaction.insert(auditEvents).values({
      action: "invoice.issued",
      actorUserId,
      reason: `${supplyType} · tax ₹${(tax.taxPaise / 100).toFixed(2)} · total ₹${(tax.totalPaise / 100).toFixed(2)}`,
      resourceId: invoiceId,
      resourceType: "invoice",
      tenantId,
    });
    return { supplyType, taxPaise: tax.taxPaise, totalPaise: tax.totalPaise };
  });
}

export type ReceiptRow = {
  amountPaise: number;
  id: string;
  instrument: string;
  note: string;
  receivedOn: string;
  recordedByName: string;
  reference: string;
  tdsPaise: number;
  tdsRateBp: number;
  tdsSection: string;
};

export async function listReceipts(
  database: DashboardDatabase,
  tenantId: string,
  invoiceId: string,
): Promise<ReceiptRow[]> {
  return database.select({
    amountPaise: invoiceReceipts.amountPaise,
    id: invoiceReceipts.id,
    instrument: invoiceReceipts.instrument,
    note: invoiceReceipts.note,
    receivedOn: invoiceReceipts.receivedOn,
    recordedByName: users.fullName,
    reference: invoiceReceipts.reference,
    tdsPaise: invoiceReceipts.tdsPaise,
    tdsRateBp: invoiceReceipts.tdsRateBp,
    tdsSection: invoiceReceipts.tdsSection,
  }).from(invoiceReceipts)
    .innerJoin(users, eq(users.id, invoiceReceipts.recordedByUserId))
    .where(and(eq(invoiceReceipts.tenantId, tenantId), eq(invoiceReceipts.invoiceId, invoiceId)))
    .orderBy(asc(invoiceReceipts.receivedOn));
}

/** Where one invoice stands after everything received against it. */
export async function invoiceSettlement(
  database: DashboardDatabase,
  tenantId: string,
  invoiceId: string,
): Promise<Settlement & { receipts: ReceiptRow[]; totalPaise: number }> {
  const [[invoice], receipts] = await Promise.all([
    database.select({ totalPaise: invoices.totalPaise }).from(invoices)
      .where(and(eq(invoices.tenantId, tenantId), eq(invoices.id, invoiceId))).limit(1),
    listReceipts(database, tenantId, invoiceId),
  ]);
  if (!invoice) throw new SettlementError("not_found");
  return { ...settlementOf({ receipts, totalPaise: invoice.totalPaise }), receipts, totalPaise: invoice.totalPaise };
}

export type ReceiptInput = {
  amountPaise: number;
  instrument: string;
  note: string;
  receivedOn: string;
  reference: string;
  tdsPaise: number;
  tdsRateBp: number;
  tdsSection: string;
};

/**
 * Record money received, and move the invoice to where the arithmetic puts it.
 *
 * The status is derived from the receipts rather than chosen: `part_paid` and
 * `paid` are conclusions about what has arrived, and letting somebody set them
 * directly is what made "paid" mean whatever the last person to click thought.
 */
export async function recordReceipt(
  database: DashboardDatabase,
  tenantId: string,
  actorUserId: string,
  invoiceId: string,
  input: ReceiptInput,
) {
  return database.transaction(async (transaction) => {
    const [invoice] = await transaction.select({
      status: invoices.status,
      totalPaise: invoices.totalPaise,
    }).from(invoices)
      .where(and(eq(invoices.tenantId, tenantId), eq(invoices.id, invoiceId)))
      .limit(1).for("update");
    if (!invoice) throw new SettlementError("not_found");

    const existing = await listReceipts(transaction as unknown as DashboardDatabase, tenantId, invoiceId);
    const before = settlementOf({ receipts: existing, totalPaise: invoice.totalPaise });

    const refusal = refuseReceipt({
      amountPaise: input.amountPaise,
      instrument: input.instrument,
      invoiceStatus: invoice.status,
      outstandingPaise: before.outstandingPaise,
      receivedOn: input.receivedOn,
      reference: input.reference,
      tdsPaise: input.tdsPaise,
      tdsSection: input.tdsSection,
    });
    if (refusal) throw new SettlementError(refusal, RECEIPT_REFUSAL_NOTES[refusal]);

    await transaction.insert(invoiceReceipts).values({
      amountPaise: input.amountPaise,
      instrument: input.instrument,
      invoiceId,
      note: input.note.trim().slice(0, 500),
      receivedOn: input.receivedOn,
      recordedByUserId: actorUserId,
      reference: input.reference.trim().slice(0, 120),
      tdsPaise: input.tdsPaise,
      tdsRateBp: input.tdsPaise > 0 ? input.tdsRateBp : 0,
      tdsSection: input.tdsPaise > 0 ? input.tdsSection : "",
      tenantId,
    });

    const after = settlementOf({
      receipts: [...existing, { amountPaise: input.amountPaise, receivedOn: input.receivedOn, tdsPaise: input.tdsPaise }],
      totalPaise: invoice.totalPaise,
    });
    const now = new Date();
    await transaction.update(invoices).set({
      // `paid` still carries who recorded it and when, as the old flag did.
      paidAt: after.settled ? now : null,
      paymentRecordedByUserId: after.settled ? actorUserId : null,
      status: after.status,
      updatedAt: now,
    }).where(and(eq(invoices.tenantId, tenantId), eq(invoices.id, invoiceId)));

    await transaction.insert(auditEvents).values({
      action: "invoice.receipt_recorded",
      actorUserId,
      reason: `₹${(input.amountPaise / 100).toFixed(2)}${input.tdsPaise > 0 ? ` + ₹${(input.tdsPaise / 100).toFixed(2)} TDS ${input.tdsSection}` : ""} · ${after.status}`,
      resourceId: invoiceId,
      resourceType: "invoice",
      tenantId,
    });
    return after;
  });
}

/** TDS withheld by clients, by financial year, for reconciling against 26AS. */
export async function firmTdsCredits(database: DashboardDatabase, tenantId: string) {
  const receipts = await database.select({
    amountPaise: invoiceReceipts.amountPaise,
    receivedOn: invoiceReceipts.receivedOn,
    tdsPaise: invoiceReceipts.tdsPaise,
  }).from(invoiceReceipts)
    .innerJoin(invoices, and(eq(invoices.tenantId, invoiceReceipts.tenantId), eq(invoices.id, invoiceReceipts.invoiceId)))
    .where(and(eq(invoiceReceipts.tenantId, tenantId), sql`${invoices.status} <> 'cancelled'`))
    .orderBy(desc(invoiceReceipts.receivedOn));
  return tdsCredits(receipts);
}
