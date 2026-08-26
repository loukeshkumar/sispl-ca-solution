/**
 * What is actually owed after everything that has arrived.
 *
 * An invoice was paid or it was not. A client who paid half in January and the
 * rest in March could not be recorded honestly until the last rupee landed, and
 * showed as wholly unpaid throughout.
 *
 * And a company paying a firm for professional services deducts tax at source
 * under section 194J: on a ₹41,182 invoice it remits ₹37,692 and pays ₹3,490 to
 * the government against the firm's PAN. The firm has been paid in full. There
 * was nowhere to say that, so such an invoice was either short by the TDS for
 * ever, or marked paid for an amount that never reached the bank.
 */

export type TdsSection = "194J" | "194C" | "194H" | "194Q" | "206C";

export const TDS_SECTIONS: readonly TdsSection[] = ["194J", "194C", "194H", "194Q", "206C"];

export const SECTION_LABELS: Record<TdsSection, string> = {
  "194C": "194C — contract",
  "194H": "194H — commission or brokerage",
  "194J": "194J — professional or technical fees",
  "194Q": "194Q — purchase of goods",
  "206C": "206C — tax collected at source",
};

/** The ordinary rate for professional fees. Firms meet it on nearly every bill. */
export const SECTION_194J_BP = 1000;

export const isTdsSection = (value: string): value is TdsSection =>
  (TDS_SECTIONS as readonly string[]).includes(value);

export type Instrument = "neft" | "rtgs" | "imps" | "upi" | "cheque" | "cash" | "adjustment";

export const INSTRUMENTS: readonly Instrument[] = ["neft", "rtgs", "imps", "upi", "cheque", "cash", "adjustment"];

export const INSTRUMENT_LABELS: Record<Instrument, string> = {
  adjustment: "Adjustment or credit note",
  cash: "Cash",
  cheque: "Cheque",
  imps: "IMPS",
  neft: "NEFT",
  rtgs: "RTGS",
  upi: "UPI",
};

export const isInstrument = (value: string): value is Instrument =>
  (INSTRUMENTS as readonly string[]).includes(value);

export type Receipt = {
  amountPaise: number;
  receivedOn: string;
  tdsPaise: number;
};

export type Settlement = {
  /** Cash that reached the bank. */
  bankedPaise: number;
  /** Tax withheld by clients, which the firm claims rather than loses. */
  tdsPaise: number;
  /** Banked plus TDS: what the invoice has actually been settled by. */
  settledPaise: number;
  outstandingPaise: number;
  /** How much more than the invoice has been settled. Zero in the normal case. */
  overpaidPaise: number;
  /** True where the settled amount exceeds the invoice. Worth surfacing. */
  overpaid: boolean;
  settled: boolean;
  status: "issued" | "part_paid" | "paid";
};

/**
 * Where an invoice stands after everything received against it.
 *
 * TDS settles the invoice alongside the cash, because it is money the client
 * paid on the firm's behalf. Treating it as a shortfall would leave every
 * corporate client permanently in arrears by ten per cent, and chasing them for
 * it would be embarrassing.
 */
export function settlementOf(input: {
  receipts: readonly Receipt[];
  totalPaise: number;
}): Settlement {
  const bankedPaise = input.receipts.reduce((total, receipt) => total + receipt.amountPaise, 0);
  const tdsPaise = input.receipts.reduce((total, receipt) => total + receipt.tdsPaise, 0);
  const settledPaise = bankedPaise + tdsPaise;
  const outstandingPaise = input.totalPaise - settledPaise;
  return {
    bankedPaise,
    outstandingPaise: Math.max(0, outstandingPaise),
    overpaid: settledPaise > input.totalPaise,
    overpaidPaise: Math.max(0, -outstandingPaise),
    settled: settledPaise >= input.totalPaise,
    settledPaise,
    status: settledPaise >= input.totalPaise ? "paid" : settledPaise > 0 ? "part_paid" : "issued",
    tdsPaise,
  };
}

/**
 * What a client should withhold on this invoice.
 *
 * On the fee, not on the GST. Section 194J bites on the professional charge;
 * withholding on the tax-inclusive total over-deducts, which is a real and
 * common error and one a firm notices only when its 26AS will not tie.
 */
export function expectedTds(input: { rateBp: number; subtotalPaise: number }): number {
  return Math.round((input.subtotalPaise * input.rateBp) / 10_000);
}

export type ReceiptRefusal =
  | "invalid_date" | "nothing_received" | "negative" | "exceeds_outstanding"
  | "unknown_section" | "unknown_instrument" | "tds_without_section" | "section_without_tds"
  | "invoice_not_issued" | "reference_required";

export const RECEIPT_REFUSAL_NOTES: Record<ReceiptRefusal, string> = {
  exceeds_outstanding: "That is more than the invoice still has outstanding.",
  invalid_date: "Enter the date the money was received.",
  invoice_not_issued: "Only an issued invoice can be receipted.",
  negative: "An amount cannot be less than nothing.",
  nothing_received: "A receipt has to bring in something — cash, tax withheld, or both.",
  reference_required: "Record the reference, so the receipt can be found in the bank statement.",
  section_without_tds: "A section was named but nothing was withheld under it.",
  tds_without_section: "Say which section the tax was withheld under.",
  unknown_instrument: "Choose how the money arrived.",
  unknown_section: "That is not a section this firm records tax under.",
};

/**
 * Whether a receipt can be recorded.
 *
 * Overpayment is refused rather than absorbed: a receipt larger than the balance
 * is nearly always the wrong invoice, and quietly accepting it puts the error
 * somewhere nobody will look until the client asks for their money back.
 */
export function refuseReceipt(input: {
  amountPaise: number;
  instrument: string;
  invoiceStatus: string;
  outstandingPaise: number;
  receivedOn: string;
  reference: string;
  tdsPaise: number;
  tdsSection: string;
}): ReceiptRefusal | null {
  if (!["issued", "part_paid"].includes(input.invoiceStatus)) return "invoice_not_issued";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.receivedOn)) return "invalid_date";
  if (!isInstrument(input.instrument)) return "unknown_instrument";
  if (input.amountPaise < 0 || input.tdsPaise < 0) return "negative";
  if (input.amountPaise + input.tdsPaise === 0) return "nothing_received";
  if (input.tdsPaise > 0 && !isTdsSection(input.tdsSection)) {
    return input.tdsSection.trim() === "" ? "tds_without_section" : "unknown_section";
  }
  if (input.tdsPaise === 0 && input.tdsSection.trim() !== "") return "section_without_tds";
  if (input.amountPaise + input.tdsPaise > input.outstandingPaise) return "exceeds_outstanding";
  // Cash has no reference to give; everything else does, and a receipt nobody
  // can find in the bank statement is a receipt nobody can prove.
  if (input.instrument !== "cash" && input.instrument !== "adjustment" && input.reference.trim().length === 0) {
    return "reference_required";
  }
  return null;
}

const rupees = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

/** `₹37,692 banked · ₹3,490 TDS credit · settled`. */
export function settlementSummary(settlement: Settlement): string {
  const parts = [`${rupees(settlement.bankedPaise)} banked`];
  if (settlement.tdsPaise > 0) parts.push(`${rupees(settlement.tdsPaise)} TDS credit`);
  parts.push(settlement.overpaid
    ? `settled, ${rupees(settlement.overpaidPaise)} over`
    : settlement.settled
      ? "settled"
      : `${rupees(settlement.outstandingPaise)} outstanding`);
  return parts.join(" · ");
}

export type TdsCredit = { financialYear: string; tdsPaise: number };

/** `2026-04-01` → `2026-27`. The year a TDS credit is claimed in. */
export function financialYearOf(dateKey: string): string {
  const [year, month] = dateKey.split("-").map(Number);
  const start = month! >= 4 ? year! : year! - 1;
  return `${start}-${String(start + 1).slice(2)}`;
}

/**
 * TDS by financial year, which is how it is claimed and how 26AS presents it.
 *
 * Grouped on the date the money was received rather than the invoice date: the
 * credit belongs to the year the client deposited it, and an invoice raised in
 * March and paid in April sits in the later year.
 */
export function tdsCredits(receipts: readonly Receipt[]): TdsCredit[] {
  const byYear = new Map<string, number>();
  for (const receipt of receipts) {
    if (receipt.tdsPaise <= 0) continue;
    const year = financialYearOf(receipt.receivedOn);
    byYear.set(year, (byYear.get(year) ?? 0) + receipt.tdsPaise);
  }
  return [...byYear.entries()]
    .map(([financialYear, tdsPaise]) => ({ financialYear, tdsPaise }))
    .sort((left, right) => left.financialYear.localeCompare(right.financialYear));
}
