import assert from "node:assert/strict";
import test from "node:test";

import {
  checkGstin,
  EXPORT_NOTE,
  gstinCheckDigit,
  isStateCode,
  refuseTaxInvoice,
  REVERSE_CHARGE_NOTE,
  splitTax,
  splitTaxEven,
  STATE_NAMES,
  stateName,
  supplyTypeOf,
  SUPPLY_LABELS,
  taxInvoice,
  taxSummary,
  ZERO_SPLIT,
  type SupplyType,
} from "../lib/billing/gst";

/** The example used throughout the GST portal's own documentation. */
const KNOWN_GOOD = "27AAPFU0939F1ZV";
/** Bihar and Karnataka registrations, check digits computed by the algorithm. */
const BIHAR = "10AABCS1429B1Z9";
const KARNATAKA = "29AAGCB7383J1Z4";

test("a documented GSTIN validates, which is what says the algorithm is right", () => {
  assert.equal(checkGstin(KNOWN_GOOD), null);
  assert.equal(gstinCheckDigit(KNOWN_GOOD.slice(0, 14)), "V");
});

test("one mistyped character is caught, which the shape alone never would", () => {
  // A GSTIN with a digit wrong still looks exactly like a GSTIN. It is the
  // client's input credit that fails months later, not the firm's screen today.
  assert.equal(checkGstin("27AAPFU0939F1ZX"), "checksum");
  assert.equal(checkGstin("27AAPFU0938F1ZV"), "checksum");
  assert.equal(checkGstin(BIHAR), null);
  assert.equal(checkGstin(KARNATAKA), null);
});

test("a GSTIN that is not the right shape is refused before the checksum", () => {
  assert.equal(checkGstin("27AAPFU0939F1Z"), "shape", "fourteen characters");
  assert.equal(checkGstin(""), "shape");
  assert.equal(checkGstin("27AAPFU0939F1YV"), "shape", "the thirteenth is always Z");
});

test("a state code that is not a state is refused", () => {
  // 25 was Daman and Diu before it merged; no GSTIN is issued under it now.
  assert.equal(checkGstin("25AAPFU0939F1ZQ"), "state");
  assert.ok(isStateCode("10"));
  assert.ok(!isStateCode("25"));
  assert.equal(stateName("10"), "Bihar");
  assert.equal(stateName(null), "");
  assert.equal(stateName("88"), "State 88", "an unknown code still reads as something");
});

test("case and surrounding space do not make a GSTIN invalid", () => {
  assert.equal(checkGstin(` ${KNOWN_GOOD.toLowerCase()} `), null);
});

test("which tax applies follows from where the supply lands", () => {
  // Not a choice. Every dropdown that let somebody pick is one they picked wrong.
  assert.equal(supplyTypeOf({ placeOfSupplyCode: "10", supplierStateCode: "10" }), "intra_state");
  assert.equal(supplyTypeOf({ placeOfSupplyCode: "29", supplierStateCode: "10" }), "inter_state");
  assert.equal(supplyTypeOf({ isExport: true, placeOfSupplyCode: "10", supplierStateCode: "10" }), "export");
  assert.equal(supplyTypeOf({ exempt: true, placeOfSupplyCode: "10", supplierStateCode: "10" }), "exempt");
  for (const type of ["intra_state", "inter_state", "export", "exempt"] as const) {
    assert.ok(SUPPLY_LABELS[type].length > 0);
  }
});

test("a supply within the state is CGST and SGST, half each", () => {
  const split = splitTax({ rateBp: 1800, supplyType: "intra_state", taxablePaise: 3_490_000 });
  assert.equal(split.taxPaise, 628_200, "18% of ₹34,900");
  assert.equal(split.cgstPaise, 314_100);
  assert.equal(split.sgstPaise, 314_100);
  assert.equal(split.igstPaise, 0);
});

test("a supply across a state line is IGST, whole", () => {
  const split = splitTax({ rateBp: 1800, supplyType: "inter_state", taxablePaise: 3_490_000 });
  assert.equal(split.igstPaise, 628_200);
  assert.equal(split.cgstPaise, 0);
  assert.equal(split.sgstPaise, 0);
});

test("the halves always add back to the tax charged", () => {
  // Rounding each half separately leaves a paisa unaccounted for on odd amounts,
  // which is the kind of difference that stops a return reconciling.
  for (const taxable of [1, 333, 12_345, 999_999, 3_490_001]) {
    const split = splitTax({ rateBp: 1800, supplyType: "intra_state", taxablePaise: taxable });
    assert.equal(split.cgstPaise + split.sgstPaise, split.taxPaise, `taxable ${taxable}`);
  }
});

test("an odd intra-state tax is nudged to an even one, and says so", () => {
  // A database check demanding CGST equals SGST would refuse an odd total, and
  // the taxable amount is not ours to move.
  const odd = splitTaxEven({ rateBp: 500, supplyType: "intra_state", taxablePaise: 10_010 });
  assert.equal(odd.taxPaise % 2, 0);
  assert.equal(odd.cgstPaise, odd.sgstPaise);
  assert.equal(odd.adjustedPaise, -1);

  const even = splitTaxEven({ rateBp: 1800, supplyType: "intra_state", taxablePaise: 3_490_000 });
  assert.equal(even.adjustedPaise, 0, "an even total is left alone");
});

test("an inter-state tax is never nudged, because nothing has to halve", () => {
  const split = splitTaxEven({ rateBp: 500, supplyType: "inter_state", taxablePaise: 10_010 });
  assert.equal(split.adjustedPaise, 0);
  assert.equal(split.igstPaise, 501, "an odd IGST is left exactly as it is");
});

test("reverse charge and zero-rated supplies carry no tax", () => {
  assert.deepEqual(splitTax({ rateBp: 1800, reverseCharge: true, supplyType: "intra_state", taxablePaise: 3_490_000 }), ZERO_SPLIT);
  assert.deepEqual(splitTax({ rateBp: 1800, supplyType: "export", taxablePaise: 3_490_000 }), ZERO_SPLIT);
  assert.deepEqual(splitTax({ rateBp: 1800, supplyType: "exempt", taxablePaise: 3_490_000 }), ZERO_SPLIT);
});

const LINES = [
  { amountPaise: 2_500_000, sacCode: "998222", taxRateBp: 1800 },
  { amountPaise: 990_000, sacCode: "998222", taxRateBp: 1800 },
];

test("an invoice is taxed line by line, then totalled", () => {
  const tax = taxInvoice({ lines: LINES, supplyType: "intra_state" });
  assert.equal(tax.subtotalPaise, 3_490_000);
  assert.equal(tax.taxPaise, 450_000 + 178_200);
  assert.equal(tax.cgstPaise + tax.sgstPaise + tax.igstPaise, tax.taxPaise);
  assert.equal(tax.totalPaise, tax.subtotalPaise + tax.taxPaise);
});

test("lines at different rates are each taxed at their own", () => {
  // Rates differ by service, which is exactly why the rate lives on the line.
  const tax = taxInvoice({
    lines: [
      { amountPaise: 1_000_000, sacCode: "998222", taxRateBp: 1800 },
      { amountPaise: 1_000_000, sacCode: "999293", taxRateBp: 0 },
    ],
    supplyType: "intra_state",
  });
  assert.equal(tax.taxPaise, 180_000, "only the taxable line bears tax");
  assert.equal(tax.lines[1]!.taxPaise, 0);
});

const issue = (over: Partial<Parameters<typeof refuseTaxInvoice>[0]> = {}) => refuseTaxInvoice({
  lines: LINES,
  placeOfSupplyCode: "10",
  recipientGstin: BIHAR,
  recipientStateCode: "10",
  supplierGstin: BIHAR,
  supplyType: "intra_state" as SupplyType,
  ...over,
});

test("a tax invoice needs a supplier, a place of supply and a SAC on every line", () => {
  assert.equal(issue(), null);
  assert.equal(issue({ supplierGstin: null }), "no_supplier_gstin");
  assert.equal(issue({ placeOfSupplyCode: null }), "no_place_of_supply");
  assert.equal(issue({ placeOfSupplyCode: "25" }), "bad_place_of_supply");
  assert.equal(issue({ lines: [{ amountPaise: 100, sacCode: null, taxRateBp: 1800 }] }), "missing_sac");
});

test("an unregistered client is fine; a wrong GSTIN is not", () => {
  // Firms bill unregistered clients every day. What must not pass is a GSTIN
  // that is almost right.
  assert.equal(issue({ recipientGstin: null, recipientStateCode: "10" }), null);
  assert.equal(issue({ recipientGstin: "10AABCS1429B1ZX" }), "bad_recipient_gstin");
  assert.equal(issue({ recipientGstin: KARNATAKA, recipientStateCode: "10" }), "recipient_gstin_state_mismatch");
  assert.equal(issue({ recipientGstin: KARNATAKA, recipientStateCode: "29" }), null);
});

test("an export cannot carry a tax rate", () => {
  assert.equal(issue({ supplyType: "export" }), "export_with_tax");
  assert.equal(issue({ lines: [{ amountPaise: 100, sacCode: "998222", taxRateBp: 0 }], supplyType: "export" }), null);
});

test("the tax line reads the way a tax invoice must show it", () => {
  const intra = taxInvoice({ lines: LINES, supplyType: "intra_state" });
  assert.equal(taxSummary(intra, "intra_state", 1800), "CGST 9% ₹3,141 · SGST 9% ₹3,141");
  const inter = taxInvoice({ lines: LINES, supplyType: "inter_state" });
  assert.equal(taxSummary(inter, "inter_state", 1800), "IGST 18% ₹6,282");
  assert.match(taxSummary(taxInvoice({ lines: LINES, supplyType: "export" }), "export", 0), /Zero-rated/);
  assert.match(taxSummary(taxInvoice({ lines: LINES, supplyType: "exempt" }), "exempt", 0), /Exempt/);
});

test("the declarations a tax invoice must bear exist and say what they must", () => {
  assert.match(REVERSE_CHARGE_NOTE, /reverse charge basis/);
  assert.match(EXPORT_NOTE, /Letter of Undertaking/);
});

test("every state code names a state", () => {
  for (const [code, name] of Object.entries(STATE_NAMES)) {
    assert.match(code, /^[0-9]{2}$/);
    assert.ok(name.length > 1);
  }
  assert.equal(STATE_NAMES["10"], "Bihar");
  assert.equal(STATE_NAMES["27"], "Maharashtra");
});
