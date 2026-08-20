import assert from "node:assert/strict";
import test from "node:test";

import {
  buildTallyLedgerXml,
  buildTallySalesVoucherXml,
  escapeTallyText,
  paiseToRupeeString,
  toTallyDate,
  voucherBalances,
  type TallyInvoiceExport,
} from "../lib/integrations/tally";
import {
  configureFilingStatusProviders,
  fetchFilingStatus,
  isFilingStatusAutomated,
  resetFilingStatusProviders,
} from "../lib/integrations/filing-status";
import { validateFilingAcknowledgementFields } from "../lib/filings/validation";

const invoice: TallyInvoiceExport = {
  invoiceNumber: "INV-00007",
  invoiceDate: "2026-08-17",
  partyLedgerName: "Aurora Textiles & Sons",
  narration: "INV-00007 · August 2026",
  lines: [
    { description: "GST compliance retainer", amountPaise: 2500000 },
    { description: "Reconciliation support", amountPaise: 500050 },
  ],
  taxPaise: 540009,
  totalPaise: 3540059,
};

test("paise convert to Tally rupee strings without floating point drift", () => {
  assert.equal(paiseToRupeeString(2500000), "25000.00");
  assert.equal(paiseToRupeeString(500050), "5000.50");
  assert.equal(paiseToRupeeString(5), "0.05");
  assert.equal(paiseToRupeeString(0), "0.00");
  assert.equal(paiseToRupeeString(-12345), "-123.45");
  assert.throws(() => paiseToRupeeString(1.5), /integer paise/);
});

test("Tally dates drop separators and reject non-ISO input", () => {
  assert.equal(toTallyDate("2026-08-17"), "20260817");
  assert.throws(() => toTallyDate("17/08/2026"), /ISO date key/);
});

test("XML special characters in client names are escaped", () => {
  assert.equal(escapeTallyText(`Ram & Co <"Partners">`), "Ram &amp; Co &lt;&quot;Partners&quot;&gt;");
  const xml = buildTallyLedgerXml([{ name: "Ram & Co", parentGroup: "Sundry Debtors", gstin: null, state: "Patna" }]);
  assert.ok(xml.includes("Ram &amp; Co"));
  assert.ok(!xml.includes("Ram & Co<"), "raw ampersands must never reach the XML body");
});

test("ledger export carries the party group, state, and GSTIN when present", () => {
  const xml = buildTallyLedgerXml([
    { name: "Aurora Textiles", parentGroup: "Sundry Debtors", gstin: "10AABCU9603R1ZX", state: "Patna" },
    { name: "Koshi Infra", parentGroup: "Sundry Debtors", gstin: null, state: "Purnea" },
  ]);
  assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
  assert.ok(xml.includes("<REPORTNAME>All Masters</REPORTNAME>"));
  assert.ok(xml.includes("<PARTYGSTIN>10AABCU9603R1ZX</PARTYGSTIN>"));
  assert.ok(xml.includes("<PARTYGSTIN/>"), "a client without GST registration still exports");
  assert.equal(xml.match(/<LEDGER /g)?.length, 2);
});

test("a sales voucher debits the party for the full total and credits each line plus tax", () => {
  assert.ok(voucherBalances(invoice));
  const xml = buildTallySalesVoucherXml([invoice]);
  assert.ok(xml.includes("<VOUCHERNUMBER>INV-00007</VOUCHERNUMBER>"));
  assert.ok(xml.includes("<DATE>20260817</DATE>"));
  assert.ok(xml.includes("<AMOUNT>-35400.59</AMOUNT>"), "the party leg is a negative (debit) entry for the total");
  assert.ok(xml.includes("<AMOUNT>25000.00</AMOUNT>"));
  assert.ok(xml.includes("<AMOUNT>5000.50</AMOUNT>"));
  assert.ok(xml.includes("<AMOUNT>5400.09</AMOUNT>"));
  assert.ok(xml.includes("Duties &amp; Taxes"));
});

test("a zero-tax invoice omits the tax ledger line and still balances", () => {
  const noTax: TallyInvoiceExport = { ...invoice, taxPaise: 0, totalPaise: 3000050 };
  assert.ok(voucherBalances(noTax));
  const xml = buildTallySalesVoucherXml([noTax]);
  assert.ok(!xml.includes("Duties &amp; Taxes"));
});

test("an unbalanced voucher is detectable before export", () => {
  assert.ok(!voucherBalances({ ...invoice, totalPaise: 999 }));
});

test("filing status reports unavailable until a portal provider is configured", async () => {
  resetFilingStatusProviders();
  assert.equal(isFilingStatusAutomated("gstn"), false);
  const result = await fetchFilingStatus({ portal: "gstn", registrationKey: "10AABCU9603R1ZX", filingType: "GSTR-3B", periodKey: "2026-07" });
  assert.deepEqual(result, { ok: false, reason: "unavailable" });
});

test("a configured provider is used, and a throwing provider degrades instead of inventing a status", async () => {
  configureFilingStatusProviders({
    providers: [
      { portal: "gstn", fetchStatus: async () => ({ ok: true, acknowledgementNumber: "AA100126000000X", filedOn: "2026-08-19", portalStatus: "filed" }) },
      { portal: "income_tax", fetchStatus: async () => { throw new Error("gateway down"); } },
    ],
  });
  try {
    assert.equal(isFilingStatusAutomated("gstn"), true);
    const filed = await fetchFilingStatus({ portal: "gstn", registrationKey: "10AABCU9603R1ZX", filingType: "GSTR-3B", periodKey: "2026-07" });
    assert.ok(filed.ok);
    assert.equal(filed.acknowledgementNumber, "AA100126000000X");

    const failed = await fetchFilingStatus({ portal: "income_tax", registrationKey: "AAAPA1111A", filingType: "ITR-6", periodKey: "AY 2026-27" });
    assert.deepEqual(failed, { ok: false, reason: "provider_error" });
  } finally {
    resetFilingStatusProviders();
  }
});

test("acknowledgement validation normalises references and rejects malformed ones", () => {
  const base = {
    legalEntityId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    portal: "gstn", filingType: "gstr-3b", periodKey: "July 2026",
    acknowledgementNumber: "aa100126000000x", filedOn: "2026-08-19", portalStatus: "filed", remarks: "",
  };
  const result = validateFilingAcknowledgementFields(base);
  assert.ok(result.success);
  assert.equal(result.data.acknowledgementNumber, "AA100126000000X");
  assert.equal(result.data.filingType, "GSTR-3B");
  assert.equal(result.data.workItemId, null);

  assert.ok(!validateFilingAcknowledgementFields({ ...base, acknowledgementNumber: "short" }).success);
  assert.ok(!validateFilingAcknowledgementFields({ ...base, acknowledgementNumber: "has spaces here" }).success);
  assert.ok(!validateFilingAcknowledgementFields({ ...base, portalStatus: "maybe" }).success);
  assert.ok(!validateFilingAcknowledgementFields({ ...base, filedOn: "19-08-2026" }).success);
});
