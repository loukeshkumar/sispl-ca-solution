import { parseMoneyToPaise } from "../payroll/money";

export const invoiceLineTypes = ["package_fee", "addon", "service", "adjustment"] as const;
export type InvoiceLineType = typeof invoiceLineTypes[number];
export type InvoiceStatus = "draft" | "issued" | "paid" | "cancelled";

export type InvoiceLineInput = {
  lineType: InvoiceLineType;
  description: string;
  amountPaise: number;
};

export type InvoiceInput = {
  legalEntityId: string;
  assignmentId: string | null;
  periodLabel: string;
  notes: string;
  taxPaise: number;
  lines: InvoiceLineInput[];
};

export type InvoiceFormFields = Record<string, string | undefined>;
export type InvoiceFieldErrors = Partial<Record<"legalEntityId" | "assignmentId" | "periodLabel" | "notes" | "tax" | "lines", string>>;
export type InvoiceActionState = { error: string; fieldErrors: InvoiceFieldErrors };

export const MAX_INVOICE_LINES = 10;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function text(fields: InvoiceFormFields, key: string) {
  return fields[key]?.trim() ?? "";
}

export function validateInvoiceFields(fields: InvoiceFormFields):
  | { success: true; data: InvoiceInput }
  | { success: false; fieldErrors: InvoiceFieldErrors } {
  const legalEntityId = text(fields, "legalEntityId");
  const assignmentId = text(fields, "assignmentId");
  const periodLabel = text(fields, "periodLabel");
  const notes = text(fields, "notes");
  const taxRaw = text(fields, "tax");
  const fieldErrors: InvoiceFieldErrors = {};

  if (!UUID_PATTERN.test(legalEntityId)) fieldErrors.legalEntityId = "Select an active client.";
  if (assignmentId && !UUID_PATTERN.test(assignmentId)) fieldErrors.assignmentId = "The package agreement reference is invalid.";
  if (periodLabel.length < 2 || periodLabel.length > 60) fieldErrors.periodLabel = "Enter a billing period between 2 and 60 characters.";
  if (notes.length > 2000) fieldErrors.notes = "Notes cannot exceed 2000 characters.";
  const taxPaise = taxRaw === "" ? 0 : parseMoneyToPaise(taxRaw);
  if (taxPaise === null) fieldErrors.tax = "Enter the tax amount in rupees, e.g. 4500.00.";

  const lines: InvoiceLineInput[] = [];
  for (let index = 1; index <= MAX_INVOICE_LINES; index += 1) {
    const description = text(fields, `lineDescription${index}`);
    const amountRaw = text(fields, `lineAmount${index}`);
    const lineType = text(fields, `lineType${index}`) || "service";
    if (!description && !amountRaw) continue;
    if (!description || description.length > 200) {
      fieldErrors.lines = `Line ${index}: enter a description up to 200 characters.`;
      break;
    }
    if (!invoiceLineTypes.includes(lineType as InvoiceLineType)) {
      fieldErrors.lines = `Line ${index}: select a valid line type.`;
      break;
    }
    const amountPaise = parseMoneyToPaise(amountRaw);
    if (amountPaise === null) {
      fieldErrors.lines = `Line ${index}: enter the amount in rupees, e.g. 12500.00.`;
      break;
    }
    lines.push({ lineType: lineType as InvoiceLineType, description, amountPaise });
  }
  if (!fieldErrors.lines && lines.length === 0) fieldErrors.lines = "Add at least one invoice line.";

  if (Object.keys(fieldErrors).length) return { success: false, fieldErrors };
  return {
    success: true,
    data: {
      legalEntityId,
      assignmentId: assignmentId || null,
      periodLabel,
      notes,
      taxPaise: taxPaise ?? 0,
      lines,
    },
  };
}

export function invoiceSubtotalPaise(lines: InvoiceLineInput[]) {
  return lines.reduce((sum, line) => sum + line.amountPaise, 0);
}
