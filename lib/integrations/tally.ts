/**
 * Tally XML export. Tally imports masters and vouchers through an XML envelope;
 * these builders are pure so the shape can be verified without a Tally instance.
 * Amounts arrive as integer paise and are emitted as rupees with two decimals.
 */

export type TallyLedgerExport = {
  name: string;
  parentGroup: string;
  gstin: string | null;
  state: string;
};

export type TallyVoucherLine = { description: string; amountPaise: number };

export type TallyInvoiceExport = {
  invoiceNumber: string;
  invoiceDate: string;
  partyLedgerName: string;
  narration: string;
  lines: TallyVoucherLine[];
  taxPaise: number;
  totalPaise: number;
};

const SALES_LEDGER = "Sales Accounts";
const TAX_LEDGER = "Duties & Taxes";

export function escapeTallyText(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function paiseToRupeeString(paise: number) {
  if (!Number.isSafeInteger(paise)) throw new Error("Money must be stored as integer paise.");
  const negative = paise < 0;
  const absolute = Math.abs(paise);
  return `${negative ? "-" : ""}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, "0")}`;
}

/** Tally dates are `YYYYMMDD` with no separators. */
export function toTallyDate(dateKey: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) throw new Error("Tally dates require an ISO date key.");
  return dateKey.replaceAll("-", "");
}

function envelope(reportName: string, body: string) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
<HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
<BODY>
<IMPORTDATA>
<REQUESTDESC><REPORTNAME>${reportName}</REPORTNAME></REQUESTDESC>
<REQUESTDATA>
${body}
</REQUESTDATA>
</IMPORTDATA>
</BODY>
</ENVELOPE>`;
}

export function buildTallyLedgerXml(ledgers: TallyLedgerExport[]) {
  const body = ledgers.map((ledger) => {
    const name = escapeTallyText(ledger.name);
    return `<TALLYMESSAGE xmlns:UDF="TallyUDF">
<LEDGER NAME="${name}" ACTION="Create">
<NAME>${name}</NAME>
<PARENT>${escapeTallyText(ledger.parentGroup)}</PARENT>
<ISBILLWISEON>Yes</ISBILLWISEON>
<LEDSTATENAME>${escapeTallyText(ledger.state)}</LEDSTATENAME>
${ledger.gstin ? `<PARTYGSTIN>${escapeTallyText(ledger.gstin)}</PARTYGSTIN>` : "<PARTYGSTIN/>"}
</LEDGER>
</TALLYMESSAGE>`;
  }).join("\n");
  return envelope("All Masters", body);
}

export function buildTallySalesVoucherXml(invoices: TallyInvoiceExport[]) {
  const body = invoices.map((invoice) => {
    const party = escapeTallyText(invoice.partyLedgerName);
    const date = toTallyDate(invoice.invoiceDate);
    const creditLines = invoice.lines.map((line) => `<ALLLEDGERENTRIES.LIST>
<LEDGERNAME>${escapeTallyText(SALES_LEDGER)}</LEDGERNAME>
<ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
<AMOUNT>${paiseToRupeeString(line.amountPaise)}</AMOUNT>
<NARRATION>${escapeTallyText(line.description)}</NARRATION>
</ALLLEDGERENTRIES.LIST>`).join("\n");
    const taxLine = invoice.taxPaise > 0 ? `<ALLLEDGERENTRIES.LIST>
<LEDGERNAME>${escapeTallyText(TAX_LEDGER)}</LEDGERNAME>
<ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
<AMOUNT>${paiseToRupeeString(invoice.taxPaise)}</AMOUNT>
</ALLLEDGERENTRIES.LIST>` : "";
    return `<TALLYMESSAGE xmlns:UDF="TallyUDF">
<VOUCHER VCHTYPE="Sales" ACTION="Create" OBJVIEW="Invoice Voucher View">
<DATE>${date}</DATE>
<EFFECTIVEDATE>${date}</EFFECTIVEDATE>
<VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>
<VOUCHERNUMBER>${escapeTallyText(invoice.invoiceNumber)}</VOUCHERNUMBER>
<PARTYLEDGERNAME>${party}</PARTYLEDGERNAME>
<NARRATION>${escapeTallyText(invoice.narration)}</NARRATION>
<ALLLEDGERENTRIES.LIST>
<LEDGERNAME>${party}</LEDGERNAME>
<ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
<AMOUNT>-${paiseToRupeeString(invoice.totalPaise)}</AMOUNT>
</ALLLEDGERENTRIES.LIST>
${creditLines}${taxLine ? `\n${taxLine}` : ""}
</VOUCHER>
</TALLYMESSAGE>`;
  }).join("\n");
  return envelope("Vouchers", body);
}

/** A voucher only balances when the party debit equals the sum of the credits. */
export function voucherBalances(invoice: TallyInvoiceExport) {
  const credits = invoice.lines.reduce((sum, line) => sum + line.amountPaise, 0) + invoice.taxPaise;
  return credits === invoice.totalPaise;
}
