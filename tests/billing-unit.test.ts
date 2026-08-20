import assert from "node:assert/strict";
import test from "node:test";

import { buildBillingWorkspace } from "../lib/billing/repository";
import { invoiceSubtotalPaise, validateInvoiceFields } from "../lib/billing/validation";

const TODAY = "2026-08-17";
const ENTITY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const validFields = {
  legalEntityId: ENTITY,
  periodLabel: "August 2026",
  notes: "",
  tax: "4500.00",
  lineDescription1: "GST compliance retainer",
  lineType1: "package_fee",
  lineAmount1: "25000",
  lineDescription2: "Reconciliation assistance",
  lineType2: "service",
  lineAmount2: "5,000.50",
};

test("invoice validation converts rupee inputs to paise and keeps only completed lines", () => {
  const result = validateInvoiceFields(validFields);
  assert.ok(result.success);
  assert.equal(result.data.taxPaise, 450000);
  assert.equal(result.data.lines.length, 2);
  assert.equal(result.data.lines[0].amountPaise, 2500000);
  assert.equal(result.data.lines[1].amountPaise, 500050);
  assert.equal(invoiceSubtotalPaise(result.data.lines), 3000050);
  assert.equal(result.data.assignmentId, null);
});

test("invoice validation rejects malformed amounts, empty line sets, and bad references", () => {
  const noLines = validateInvoiceFields({ legalEntityId: ENTITY, periodLabel: "August 2026", tax: "" });
  assert.ok(!noLines.success);
  assert.ok(noLines.fieldErrors.lines);

  const badAmount = validateInvoiceFields({ ...validFields, lineAmount1: "twelve" });
  assert.ok(!badAmount.success);
  assert.match(badAmount.fieldErrors.lines ?? "", /Line 1/);

  const badEntity = validateInvoiceFields({ ...validFields, legalEntityId: "not-a-uuid" });
  assert.ok(!badEntity.success);
  assert.ok(badEntity.fieldErrors.legalEntityId);

  const badTax = validateInvoiceFields({ ...validFields, tax: "-5" });
  assert.ok(!badTax.success);
  assert.ok(badTax.fieldErrors.tax);
});

test("billing workspace metrics separate outstanding, overdue, drafts, and monthly collections", () => {
  const base = { clientName: "Aurora Textiles", legalEntityId: ENTITY, periodLabel: "August 2026", issueDate: "2026-08-01" };
  const workspace = buildBillingWorkspace([
    { ...base, id: "1", invoiceNumber: "INV-00001", status: "issued", totalPaise: 100000, dueDate: "2026-08-10", createdAt: new Date("2026-08-01T00:00:00Z"), paidAt: null },
    { ...base, id: "2", invoiceNumber: "INV-00002", status: "issued", totalPaise: 200000, dueDate: "2026-08-30", createdAt: new Date("2026-08-02T00:00:00Z"), paidAt: null },
    { ...base, id: "3", invoiceNumber: "INV-00003", status: "paid", totalPaise: 300000, dueDate: "2026-08-05", createdAt: new Date("2026-08-03T00:00:00Z"), paidAt: new Date("2026-08-12T00:00:00Z") },
    { ...base, id: "4", invoiceNumber: "INV-00004", status: "paid", totalPaise: 50000, dueDate: "2026-07-05", createdAt: new Date("2026-07-01T00:00:00Z"), paidAt: new Date("2026-07-10T00:00:00Z") },
    { ...base, id: "5", invoiceNumber: "INV-00005", status: "draft", totalPaise: 400000, dueDate: null, issueDate: null, createdAt: new Date("2026-08-04T00:00:00Z"), paidAt: null },
    { ...base, id: "6", invoiceNumber: "INV-00006", status: "cancelled", totalPaise: 999999, dueDate: null, issueDate: null, createdAt: new Date("2026-08-05T00:00:00Z"), paidAt: null },
  ], TODAY);
  assert.equal(workspace.metrics.outstandingPaise, 300000);
  assert.equal(workspace.metrics.overdueCount, 1);
  assert.equal(workspace.metrics.overduePaise, 100000);
  assert.equal(workspace.metrics.collectedThisMonthPaise, 300000);
  assert.equal(workspace.metrics.draftCount, 1);
  assert.equal(workspace.invoices[0].status, "issued");
  assert.ok(!("paidAt" in workspace.invoices[0]));
});
