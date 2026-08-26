export type DocumentChecklistInput = {
  code: string;
  name: string;
  category: string;
  instructions: string;
  serviceCode: string;
  defaultLeadDays: number;
  mandatory: boolean;
  status: "active" | "archived";
};

export type DocumentChecklistFieldErrors = Partial<Record<keyof DocumentChecklistInput, string>>;
export type DocumentChecklistActionState = { error: string; fieldErrors: DocumentChecklistFieldErrors };

const CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{1,29}$/;
const SERVICE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{1,19}$/;

function text(fields: Record<string, string | undefined>, key: string) {
  return fields[key]?.trim() ?? "";
}

export function validateDocumentChecklistFields(fields: Record<string, string | undefined>):
  | { success: true; data: DocumentChecklistInput }
  | { success: false; fieldErrors: DocumentChecklistFieldErrors } {
  const code = text(fields, "code").toUpperCase().replace(/\s+/g, "_");
  const name = text(fields, "name").replace(/\s+/g, " ");
  const category = text(fields, "category").replace(/\s+/g, " ") || "General";
  const instructions = text(fields, "instructions");
  const serviceCode = text(fields, "serviceCode").toUpperCase();
  const rawLeadDays = text(fields, "defaultLeadDays") || "7";
  const defaultLeadDays = /^\d{1,3}$/.test(rawLeadDays) ? Number(rawLeadDays) : Number.NaN;
  const mandatory = ["on", "true", "1"].includes(text(fields, "mandatory").toLowerCase());
  const status = text(fields, "status") || "active";
  const fieldErrors: DocumentChecklistFieldErrors = {};

  if (!CODE_PATTERN.test(code)) fieldErrors.code = "Use an uppercase code of 2 to 30 characters, e.g. BANK_STMT.";
  if (name.length < 2 || name.length > 120) fieldErrors.name = "Enter the document name, between 2 and 120 characters.";
  if (category.length < 2 || category.length > 40) fieldErrors.category = "Enter a category between 2 and 40 characters.";
  if (instructions.length > 500) fieldErrors.instructions = "Instructions cannot exceed 500 characters.";
  if (serviceCode && !SERVICE_PATTERN.test(serviceCode)) fieldErrors.serviceCode = "Select a service from the service master, or leave it unlinked.";
  if (!Number.isInteger(defaultLeadDays) || defaultLeadDays < 0 || defaultLeadDays > 180) fieldErrors.defaultLeadDays = "Lead days must be between 0 and 180.";
  if (status !== "active" && status !== "archived") fieldErrors.status = "Select a valid status.";

  if (Object.keys(fieldErrors).length) return { success: false, fieldErrors };
  return {
    success: true,
    data: { code, name, category, instructions, serviceCode, defaultLeadDays, mandatory, status: status as "active" | "archived" },
  };
}

/** The date a document should be requested by, given how far ahead the firm asks. */
export function checklistDueDate(todayKey: string, leadDays: number) {
  const [year, month, day] = todayKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + leadDays)).toISOString().slice(0, 10);
}
