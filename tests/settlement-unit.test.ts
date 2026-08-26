import assert from "node:assert/strict";
import test from "node:test";

import {
  expectedTds,
  financialYearOf,
  INSTRUMENT_LABELS,
  INSTRUMENTS,
  isInstrument,
  isTdsSection,
  refuseReceipt,
  SECTION_194J_BP,
  SECTION_LABELS,
  settlementOf,
  settlementSummary,
  TDS_SECTIONS,
  tdsCredits,
  type Receipt,
} from "../lib/billing/settlement";

/** ₹34,900 fee plus ₹6,282 GST. The invoice used throughout. */
const SUBTOTAL = 3_490_000;
const TOTAL = 4_118_200;

const receipt = (over: Partial<Receipt> = {}): Receipt => ({
  amountPaise: 2_000_000,
  receivedOn: "2027-01-12",
  tdsPaise: 0,
  ...over,
});

test("an invoice with nothing against it is issued and wholly outstanding", () => {
  const settlement = settlementOf({ receipts: [], totalPaise: TOTAL });
  assert.equal(settlement.status, "issued");
  assert.equal(settlement.outstandingPaise, TOTAL);
  assert.equal(settlement.settled, false);
  assert.match(settlementSummary(settlement), /₹0 banked · ₹41,182 outstanding/);
});

test("a part payment is part paid, not unpaid", () => {
  // The failure being fixed: ₹20,000 that arrived in January was invisible
  // until March, and the invoice read as wholly unpaid throughout.
  const settlement = settlementOf({ receipts: [receipt()], totalPaise: TOTAL });
  assert.equal(settlement.status, "part_paid");
  assert.equal(settlement.bankedPaise, 2_000_000);
  assert.equal(settlement.outstandingPaise, 2_118_200);
});

test("TDS settles the invoice alongside the cash", () => {
  // It is money the client paid on the firm's behalf. Treating it as a
  // shortfall would leave every corporate client ten per cent in arrears.
  const settlement = settlementOf({
    receipts: [
      receipt({ amountPaise: 2_000_000 }),
      receipt({ amountPaise: 1_769_200, receivedOn: "2027-02-03", tdsPaise: 349_000 }),
    ],
    totalPaise: TOTAL,
  });
  assert.equal(settlement.bankedPaise, 3_769_200);
  assert.equal(settlement.tdsPaise, 349_000);
  assert.equal(settlement.settledPaise, TOTAL);
  assert.equal(settlement.status, "paid");
  assert.equal(settlement.outstandingPaise, 0);
  assert.equal(settlementSummary(settlement), "₹37,692 banked · ₹3,490 TDS credit · settled");
});

test("a settlement beyond the invoice is surfaced, not absorbed", () => {
  const settlement = settlementOf({ receipts: [receipt({ amountPaise: TOTAL + 50_000 })], totalPaise: TOTAL });
  assert.equal(settlement.overpaid, true);
  assert.equal(settlement.overpaidPaise, 50_000);
  assert.equal(settlement.outstandingPaise, 0, "never negative");
  assert.match(settlementSummary(settlement), /₹500 over/);
});

test("TDS is withheld on the fee, not on the tax", () => {
  // Withholding on the tax-inclusive total over-deducts, which is a real and
  // common error a firm notices only when its 26AS will not tie.
  assert.equal(expectedTds({ rateBp: SECTION_194J_BP, subtotalPaise: SUBTOTAL }), 349_000);
  assert.notEqual(expectedTds({ rateBp: SECTION_194J_BP, subtotalPaise: TOTAL }), 349_000);
  assert.equal(SECTION_194J_BP, 1000, "ten per cent");
});

const record = (over: Partial<Parameters<typeof refuseReceipt>[0]> = {}) => refuseReceipt({
  amountPaise: 2_000_000,
  instrument: "neft",
  invoiceStatus: "issued",
  outstandingPaise: TOTAL,
  receivedOn: "2027-01-12",
  reference: "NEFT/2027/0112/8891",
  tdsPaise: 0,
  tdsSection: "",
  ...over,
});

test("a receipt needs a date, an instrument and something arriving", () => {
  assert.equal(record(), null);
  assert.equal(record({ receivedOn: "January" }), "invalid_date");
  assert.equal(record({ instrument: "barter" }), "unknown_instrument");
  assert.equal(record({ amountPaise: 0, tdsPaise: 0 }), "nothing_received");
  assert.equal(record({ amountPaise: -1 }), "negative");
});

test("a receipt that is only TDS is still a receipt", () => {
  // It happens: the client remits the tax and settles the rest by credit note.
  assert.equal(record({ amountPaise: 0, tdsPaise: 349_000, tdsSection: "194J" }), null);
});

test("tax withheld names its section, and a section means something was withheld", () => {
  assert.equal(record({ tdsPaise: 349_000 }), "tds_without_section");
  assert.equal(record({ tdsPaise: 349_000, tdsSection: "194Z" }), "unknown_section");
  assert.equal(record({ tdsPaise: 349_000, tdsSection: "194J" }), null);
  assert.equal(record({ tdsSection: "194J" }), "section_without_tds");
});

test("more than the balance is refused rather than quietly taken", () => {
  // A receipt larger than the balance is nearly always the wrong invoice.
  assert.equal(record({ amountPaise: TOTAL + 1 }), "exceeds_outstanding");
  assert.equal(record({ amountPaise: 3_769_200, tdsPaise: 349_000, tdsSection: "194J" }), null, "cash and TDS exactly meeting it");
  assert.equal(record({ amountPaise: 3_769_201, tdsPaise: 349_000, tdsSection: "194J" }), "exceeds_outstanding");
  assert.equal(record({ amountPaise: 100, outstandingPaise: 99 }), "exceeds_outstanding");
});

test("only an issued or part-paid invoice can be receipted", () => {
  assert.equal(record({ invoiceStatus: "draft" }), "invoice_not_issued");
  assert.equal(record({ invoiceStatus: "cancelled" }), "invoice_not_issued");
  assert.equal(record({ invoiceStatus: "paid" }), "invoice_not_issued", "already settled");
  assert.equal(record({ invoiceStatus: "part_paid" }), null);
});

test("a bank transfer needs a reference; cash cannot give one", () => {
  assert.equal(record({ reference: "" }), "reference_required");
  assert.equal(record({ reference: "   " }), "reference_required");
  assert.equal(record({ instrument: "cash", reference: "" }), null);
  assert.equal(record({ instrument: "adjustment", reference: "" }), null);
});

test("a financial year runs April to March", () => {
  assert.equal(financialYearOf("2026-04-01"), "2026-27");
  assert.equal(financialYearOf("2027-03-31"), "2026-27");
  assert.equal(financialYearOf("2027-04-01"), "2027-28");
  assert.equal(financialYearOf("2027-01-12"), "2026-27", "January belongs to the year that started last April");
});

test("TDS credits fall in the year the money was received", () => {
  // The credit belongs to the year the client deposited it, so an invoice raised
  // in March and paid in April sits in the later year.
  const credits = tdsCredits([
    receipt({ receivedOn: "2027-03-30", tdsPaise: 100_000 }),
    receipt({ receivedOn: "2027-04-02", tdsPaise: 250_000 }),
    receipt({ receivedOn: "2027-04-20", tdsPaise: 50_000 }),
    receipt({ receivedOn: "2027-05-01", tdsPaise: 0 }),
  ]);
  assert.deepEqual(credits, [
    { financialYear: "2026-27", tdsPaise: 100_000 },
    { financialYear: "2027-28", tdsPaise: 300_000 },
  ]);
});

test("receipts with no TDS produce no credits at all", () => {
  assert.deepEqual(tdsCredits([receipt(), receipt()]), []);
});

test("sections and instruments are the listed ones and each reads as English", () => {
  assert.ok(isTdsSection("194J"));
  assert.ok(!isTdsSection("194Z"));
  assert.ok(isInstrument("upi"));
  assert.ok(!isInstrument("barter"));
  for (const section of TDS_SECTIONS) assert.ok(SECTION_LABELS[section].includes(section));
  for (const instrument of INSTRUMENTS) assert.ok(INSTRUMENT_LABELS[instrument].length > 0);
});
