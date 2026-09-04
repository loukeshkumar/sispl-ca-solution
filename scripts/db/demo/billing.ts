/**
 * A service package, client assignments, and invoices at three ages.
 *
 * The ages matter: receivables ageing and the overdue surface have nothing to
 * show if every invoice is the same age. One invoice is settled, one is issued
 * and already past its due date, and one is still a draft.
 */
import { and, eq, ne } from "drizzle-orm";

import { clientPackageAssignments, invoices, legalEntities, servicePackages } from "../../../db/schema";
import { createInvoice, issueInvoice, recordInvoicePayment } from "../../../lib/billing/repository";
import type { DashboardDatabase } from "../../../lib/dashboard/postgres/repository";
import { assignClientPackage, createPackage, listActiveServiceOptions } from "../../../lib/packages/repository";
import type { DemoContext } from "./context";

const PACKAGE_CODE = "DEMO-RETAINER";

/** INR is stored as integer paise throughout, so these are rupees times 100. */
const PACKAGE_FEE_PAISE = 2_500_000;

/**
 * Zero, deliberately.
 *
 * `invoices_gst_component_check` requires cgst + sgst + igst to equal taxPaise,
 * but `createInvoice` never writes those three columns, so they default to zero
 * and any invoice carrying tax is rejected by the database. Until that is
 * reconciled, an invoice the demo can actually create is one with no tax on it.
 * The seed does not work around the constraint by inserting rows behind the
 * service — that would hide a real defect rather than respect it.
 */
const TAX_PAISE = 0;

async function ensurePackage(database: DashboardDatabase, context: DemoContext) {
  const [existing] = await database.select({ id: servicePackages.id }).from(servicePackages).where(and(
    eq(servicePackages.tenantId, context.tenantId),
    eq(servicePackages.code, PACKAGE_CODE),
  )).limit(1);
  if (existing) return existing.id;

  const services = await listActiveServiceOptions(database, context.tenantId);
  return createPackage(database, context.tenantId, context.actors.administratorId, {
    billingCycle: "monthly",
    code: PACKAGE_CODE,
    description: "Monthly compliance retainer covering bookkeeping, GST and TDS.",
    name: "Monthly compliance retainer",
    serviceIds: services.slice(0, 3).map((service) => service.id),
    standardFeePaise: PACKAGE_FEE_PAISE,
    status: "active",
  });
}

function monthEnd(periodKey: string) {
  const [year, month] = periodKey.split("-").map(Number);
  return `${periodKey}-${String(new Date(Date.UTC(year, month, 0)).getUTCDate()).padStart(2, "0")}`;
}

export async function seedDemoBilling(database: DashboardDatabase, context: DemoContext) {
  const [existing] = await database.select({ id: invoices.id }).from(invoices)
    .where(eq(invoices.tenantId, context.tenantId)).limit(1);
  if (existing) return { invoices: 0, assignments: 0 };

  const packageId = await ensurePackage(database, context);
  const clients = await database.select({ id: legalEntities.id, displayName: legalEntities.displayName })
    .from(legalEntities)
    .where(and(eq(legalEntities.tenantId, context.tenantId), eq(legalEntities.status, "active")))
    .orderBy(legalEntities.displayName);
  if (!clients.length) throw new Error("No active clients found; run db:seed:local first.");

  const { closedMonth, currentMonth } = context.calendar;
  const billed = clients.slice(0, 3);
  let assignments = 0;
  for (const client of billed) {
    // A client may already be on a package — the firm's own agreement, or one an
    // earlier test left in a shared database. Assigning over an existing
    // agreement is refused for good reason, so the demo leaves it alone.
    const [assigned] = await database.select({ id: clientPackageAssignments.id }).from(clientPackageAssignments).where(and(
      eq(clientPackageAssignments.tenantId, context.tenantId),
      eq(clientPackageAssignments.legalEntityId, client.id),
      ne(clientPackageAssignments.status, "cancelled"),
    )).limit(1);
    if (assigned) continue;
    await assignClientPackage(database, context.tenantId, context.actors.administratorId, {
      addonServiceIds: [],
      agreedFeePaise: PACKAGE_FEE_PAISE,
      effectiveFrom: `${closedMonth}-01`,
      effectiveTo: null,
      legalEntityId: client.id,
      packageId,
      replaceExisting: false,
    });
    assignments += 1;
  }

  // Three ages, so the receivables view has a spread rather than a single point.
  const plan = [
    { client: billed[0], periodLabel: closedMonth, settle: true, issue: true },
    { client: billed[1], periodLabel: closedMonth, settle: false, issue: true },
    { client: billed[2], periodLabel: currentMonth, settle: false, issue: false },
  ].filter((entry) => entry.client);

  let created = 0;
  for (const entry of plan) {
    const invoiceId = await createInvoice(database, context.tenantId, context.actors.administratorId, {
      legalEntityId: entry.client.id,
      assignmentId: null,
      periodLabel: entry.periodLabel,
      notes: "Seeded demonstration invoice.",
      taxPaise: TAX_PAISE,
      lines: [{ lineType: "package_fee", description: "Monthly compliance retainer", amountPaise: PACKAGE_FEE_PAISE }],
    });
    if (entry.issue) {
      await issueInvoice(database, context.tenantId, context.actors.administratorId, invoiceId, {
        issueDate: monthEnd(entry.periodLabel),
        // Fourteen days from issue, which for the closed month is already past.
        dueDate: dueDateFrom(monthEnd(entry.periodLabel)),
      });
    }
    if (entry.settle) {
      await recordInvoicePayment(database, context.tenantId, context.actors.administratorId, invoiceId, `UTR-${entry.periodLabel.replace("-", "")}`);
    }
    created += 1;
  }

  return { invoices: created, assignments };
}

function dueDateFrom(dateKey: string) {
  const due = new Date(`${dateKey}T00:00:00Z`);
  due.setUTCDate(due.getUTCDate() + 14);
  return due.toISOString().slice(0, 10);
}
