/**
 * The invoice as a document under GST law.
 *
 * It had a single `tax_paise` column somebody typed a number into. No GSTIN on
 * either side, no place of supply, no SAC, and no split between CGST, SGST and
 * IGST — so it was not a tax invoice, the client could not claim input credit
 * against it, and the firm could not file from it. It was a letter asking for
 * money with a tax-shaped number at the bottom.
 *
 * Everything here is derived rather than typed. Which tax applies follows from
 * where the supply lands, and the split follows from that; a person choosing
 * "IGST" from a dropdown is a person who can choose wrong.
 */

/** State and union territory codes, as they appear in the first two GSTIN digits. */
export const STATE_NAMES: Record<string, string> = {
  "01": "Jammu and Kashmir", "02": "Himachal Pradesh", "03": "Punjab", "04": "Chandigarh",
  "05": "Uttarakhand", "06": "Haryana", "07": "Delhi", "08": "Rajasthan", "09": "Uttar Pradesh",
  10: "Bihar", 11: "Sikkim", 12: "Arunachal Pradesh", 13: "Nagaland", 14: "Manipur",
  15: "Mizoram", 16: "Tripura", 17: "Meghalaya", 18: "Assam", 19: "West Bengal",
  20: "Jharkhand", 21: "Odisha", 22: "Chhattisgarh", 23: "Madhya Pradesh", 24: "Gujarat",
  26: "Dadra and Nagar Haveli and Daman and Diu", 27: "Maharashtra", 29: "Karnataka",
  30: "Goa", 31: "Lakshadweep", 32: "Kerala", 33: "Tamil Nadu", 34: "Puducherry",
  35: "Andaman and Nicobar Islands", 36: "Telangana", 37: "Andhra Pradesh", 38: "Ladakh",
  97: "Other territory", 99: "Centre",
};

export const isStateCode = (value: string) => Object.hasOwn(STATE_NAMES, value);

export const stateName = (code: string | null) => (code ? STATE_NAMES[code] ?? `State ${code}` : "");

const GSTIN_SHAPE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const CHARSET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/**
 * The check digit a GSTIN carries in its fifteenth character.
 *
 * Worth computing rather than trusting the shape: a GSTIN with one digit
 * mistyped still looks exactly like a GSTIN, and it is the client's input
 * credit that fails months later, not the firm's screen today.
 */
export function gstinCheckDigit(first14: string): string | null {
  if (first14.length !== 14) return null;
  let sum = 0;
  for (let index = 0; index < 14; index += 1) {
    const value = CHARSET.indexOf(first14[index]!);
    if (value < 0) return null;
    // Weights alternate 1, 2 from the left.
    const product = value * (index % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return CHARSET[(36 - (sum % 36)) % 36]!;
}

export type GstinProblem = "shape" | "state" | "checksum";

export const GSTIN_PROBLEM_NOTES: Record<GstinProblem, string> = {
  checksum: "That GSTIN fails its own check digit — one character is wrong.",
  shape: "A GSTIN is fifteen characters: two for the state, then the PAN, then three more.",
  state: "The first two digits of a GSTIN are a state code, and that is not one.",
};

export function checkGstin(gstin: string): GstinProblem | null {
  const value = gstin.trim().toUpperCase();
  if (!GSTIN_SHAPE.test(value)) return "shape";
  if (!isStateCode(value.slice(0, 2))) return "state";
  if (gstinCheckDigit(value.slice(0, 14)) !== value[14]) return "checksum";
  return null;
}

export type SupplyType = "intra_state" | "inter_state" | "export" | "exempt";

export const SUPPLY_LABELS: Record<SupplyType, string> = {
  exempt: "Exempt or nil-rated",
  export: "Export or SEZ supply",
  inter_state: "Inter-state supply",
  intra_state: "Intra-state supply",
};

/**
 * Which tax applies, from where the supply lands.
 *
 * Not a choice. A supply within the supplier's own state is CGST and SGST; one
 * that crosses a state line is IGST; an export under LUT is zero-rated. Every
 * dropdown that let somebody pick is a dropdown somebody picked wrong.
 */
export function supplyTypeOf(input: {
  exempt?: boolean;
  isExport?: boolean;
  placeOfSupplyCode: string;
  supplierStateCode: string;
}): SupplyType {
  if (input.isExport) return "export";
  if (input.exempt) return "exempt";
  return input.placeOfSupplyCode === input.supplierStateCode ? "intra_state" : "inter_state";
}

export type TaxSplit = { cgstPaise: number; igstPaise: number; sgstPaise: number; taxPaise: number };

export const ZERO_SPLIT: TaxSplit = { cgstPaise: 0, igstPaise: 0, sgstPaise: 0, taxPaise: 0 };

/**
 * The tax on one taxable amount, split by supply type.
 *
 * The total is rounded once and the halves are taken from it, so CGST plus SGST
 * always equals the tax charged. Rounding each half separately leaves a rupee
 * unaccounted for on odd amounts, which is the kind of difference that stops a
 * return reconciling and nobody can find.
 */
export function splitTax(input: {
  rateBp: number;
  reverseCharge?: boolean;
  supplyType: SupplyType;
  taxablePaise: number;
}): TaxSplit {
  // Under reverse charge the recipient accounts for the tax, so the invoice
  // carries none — but still states the rate that would have applied.
  if (input.reverseCharge) return ZERO_SPLIT;
  if (input.supplyType === "export" || input.supplyType === "exempt") return ZERO_SPLIT;

  const taxPaise = Math.round((input.taxablePaise * input.rateBp) / 10_000);
  if (input.supplyType === "inter_state") return { cgstPaise: 0, igstPaise: taxPaise, sgstPaise: 0, taxPaise };
  const cgstPaise = Math.floor(taxPaise / 2);
  return { cgstPaise, igstPaise: 0, sgstPaise: taxPaise - cgstPaise, taxPaise };
}

/**
 * An odd tax leaves CGST and SGST a paisa apart, which a database check that
 * demands they be equal would refuse. Nudging the taxable amount is not an
 * option, so the total is adjusted to the nearest even paisa instead — and the
 * fact that it was is returned rather than hidden.
 */
export function splitTaxEven(input: Parameters<typeof splitTax>[0]): TaxSplit & { adjustedPaise: number } {
  const split = splitTax(input);
  if (input.supplyType !== "intra_state" || split.taxPaise % 2 === 0) return { ...split, adjustedPaise: 0 };
  const taxPaise = split.taxPaise - 1;
  const half = taxPaise / 2;
  return { adjustedPaise: -1, cgstPaise: half, igstPaise: 0, sgstPaise: half, taxPaise };
}

export type TaxableLine = { amountPaise: number; sacCode: string | null; taxRateBp: number };

export type TaxedLine = TaxableLine & TaxSplit;

export type InvoiceTax = {
  lines: TaxedLine[];
  subtotalPaise: number;
  totalPaise: number;
} & TaxSplit;

/** Tax every line, then total. Line by line because rates differ by service. */
export function taxInvoice(input: {
  lines: readonly TaxableLine[];
  reverseCharge?: boolean;
  supplyType: SupplyType;
}): InvoiceTax {
  const lines = input.lines.map((line) => ({
    ...line,
    ...splitTaxEven({
      rateBp: line.taxRateBp,
      reverseCharge: input.reverseCharge,
      supplyType: input.supplyType,
      taxablePaise: line.amountPaise,
    }),
  }));
  const sum = (pick: (line: TaxedLine) => number) => lines.reduce((total, line) => total + pick(line), 0);
  const subtotalPaise = sum((line) => line.amountPaise);
  const taxPaise = sum((line) => line.taxPaise);
  return {
    cgstPaise: sum((line) => line.cgstPaise),
    igstPaise: sum((line) => line.igstPaise),
    lines,
    sgstPaise: sum((line) => line.sgstPaise),
    subtotalPaise,
    taxPaise,
    totalPaise: subtotalPaise + taxPaise,
  };
}

export type TaxInvoiceRefusal =
  | "no_supplier_gstin" | "no_place_of_supply" | "bad_place_of_supply"
  | "recipient_gstin_state_mismatch" | "bad_recipient_gstin" | "missing_sac" | "export_with_tax";

export const TAX_INVOICE_REFUSAL_NOTES: Record<TaxInvoiceRefusal, string> = {
  bad_place_of_supply: "The place of supply must be a state the firm can file against.",
  bad_recipient_gstin: "The client's GSTIN is not valid.",
  export_with_tax: "An export under LUT is zero-rated. Remove the tax rate, or record it as a taxable supply.",
  missing_sac: "Every line on a tax invoice needs the SAC it is supplied under.",
  no_place_of_supply: "Say where the supply is treated as made. It decides which tax applies.",
  no_supplier_gstin: "The firm has no GSTIN recorded, so it cannot issue a tax invoice. Record one in settings.",
  recipient_gstin_state_mismatch: "The client's GSTIN belongs to a different state from the one recorded against them.",
};

/**
 * Whether this can be issued as a tax invoice.
 *
 * Checked at issue rather than at draft: a draft is a working document and
 * demanding a SAC before somebody has chosen the services would make the screen
 * unusable. What must not happen is an incomplete document reaching a client.
 */
export function refuseTaxInvoice(input: {
  lines: readonly TaxableLine[];
  placeOfSupplyCode: string | null;
  recipientGstin: string | null;
  recipientStateCode: string | null;
  supplierGstin: string | null;
  supplyType: SupplyType;
}): TaxInvoiceRefusal | null {
  if (!input.supplierGstin) return "no_supplier_gstin";
  if (!input.placeOfSupplyCode) return "no_place_of_supply";
  if (!isStateCode(input.placeOfSupplyCode)) return "bad_place_of_supply";
  if (input.recipientGstin) {
    if (checkGstin(input.recipientGstin)) return "bad_recipient_gstin";
    if (input.recipientStateCode && input.recipientGstin.slice(0, 2) !== input.recipientStateCode) {
      return "recipient_gstin_state_mismatch";
    }
  }
  if (input.lines.some((line) => !line.sacCode)) return "missing_sac";
  if (input.supplyType === "export" && input.lines.some((line) => line.taxRateBp > 0)) return "export_with_tax";
  return null;
}

/** `CGST 9% ₹3,141 · SGST 9% ₹3,141` — the line a tax invoice must show. */
export function taxSummary(tax: InvoiceTax, supplyType: SupplyType, rateBp: number): string {
  const rupees = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
  const half = (rateBp / 200).toFixed(rateBp % 200 === 0 ? 0 : 2);
  const full = (rateBp / 100).toFixed(rateBp % 100 === 0 ? 0 : 2);
  if (supplyType === "export") return "Zero-rated: export or SEZ supply under LUT, no tax charged";
  if (supplyType === "exempt") return "Exempt supply, no tax charged";
  if (tax.taxPaise === 0) return "No tax charged";
  if (supplyType === "inter_state") return `IGST ${full}% ${rupees(tax.igstPaise)}`;
  return `CGST ${half}% ${rupees(tax.cgstPaise)} · SGST ${half}% ${rupees(tax.sgstPaise)}`;
}

/** The declaration a reverse-charge invoice must carry on its face. */
export const REVERSE_CHARGE_NOTE = "Tax payable on reverse charge basis by the recipient under section 9(3)/9(4).";

/** The declaration an export invoice must carry. */
export const EXPORT_NOTE = "Supply meant for export under bond or Letter of Undertaking without payment of integrated tax.";
