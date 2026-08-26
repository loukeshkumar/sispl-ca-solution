export const workStatusOptions = ["critical", "at_risk", "waiting", "review"] as const;

const legacyWorkServiceOptions = [
  { entitlementCode: "GST", key: "gstr_3b", label: "GSTR-3B" },
  { entitlementCode: "TDS", key: "tds_26q", label: "TDS 26Q" },
  { entitlementCode: "BOOKS", key: "monthly_close", label: "Monthly close" },
  { entitlementCode: "10B", key: "form_10b", label: "Form 10B" },
  { entitlementCode: "ITR", key: "itr", label: "Income-tax return" },
  { entitlementCode: "AUDIT", key: "audit", label: "Statutory audit" },
  { entitlementCode: "ROC", key: "roc", label: "ROC filing" },
  { entitlementCode: "BOOKS", key: "books", label: "Books and accounts" },
] as const;

export type WorkInput = {
  assigneeId: string | null;
  blockerNote: string;
  /** Snapshot of the service standard. Null means this obligation is unbudgeted. */
  budgetMinutes: number | null;
  internalDueDate: string | null;
  legalEntityId: string;
  periodKey: string;
  progress: number;
  reviewerId: string | null;
  serviceKey: string;
  statutoryDueDate: string;
  status: typeof workStatusOptions[number];
};

export type WorkFormFields = Record<string, string | undefined>;
export type WorkFieldErrors = Partial<Record<keyof WorkInput, string>>;
export type WorkActionState = { error: string; fieldErrors: WorkFieldErrors };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SERVICE_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{1,59}$/;

function text(fields: WorkFormFields, key: string) {
  return fields[key]?.trim() ?? "";
}

function validDateKey(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

export function validateWorkFields(fields: WorkFormFields, allowedServiceKeys?: readonly string[]):
  | { success: true; data: WorkInput }
  | { success: false; fieldErrors: WorkFieldErrors } {
  const legalEntityId = text(fields, "legalEntityId");
  const serviceKey = text(fields, "serviceKey");
  const periodKey = text(fields, "periodKey");
  const status = text(fields, "status");
  const statutoryDueDate = text(fields, "statutoryDueDate");
  const internalDueDate = text(fields, "internalDueDate");
  const assigneeId = text(fields, "assigneeId");
  const reviewerId = text(fields, "reviewerId");
  const blockerNote = text(fields, "blockerNote");
  const progress = Number(text(fields, "progress"));
  const fieldErrors: WorkFieldErrors = {};

  if (!UUID_PATTERN.test(legalEntityId)) fieldErrors.legalEntityId = "Select an active client.";
  if (!SERVICE_KEY_PATTERN.test(serviceKey)) fieldErrors.serviceKey = "Select a valid service from the firm's service master.";
  else if (allowedServiceKeys && !allowedServiceKeys.some((allowed) => allowed.toUpperCase() === serviceKey.toUpperCase())) fieldErrors.serviceKey = "Select a service included in the client's active package or add-ons.";
  if (periodKey.length < 2 || periodKey.length > 60) fieldErrors.periodKey = "Enter a period between 2 and 60 characters.";
  if (!workStatusOptions.includes(status as never)) fieldErrors.status = "Select a valid workflow status.";
  if (!validDateKey(statutoryDueDate)) fieldErrors.statutoryDueDate = "Enter a valid statutory due date.";
  if (internalDueDate && !validDateKey(internalDueDate)) fieldErrors.internalDueDate = "Enter a valid internal due date.";
  if (validDateKey(statutoryDueDate) && internalDueDate && validDateKey(internalDueDate) && internalDueDate > statutoryDueDate) {
    fieldErrors.internalDueDate = "Internal due date cannot be after the statutory due date.";
  }
  if (assigneeId && !UUID_PATTERN.test(assigneeId)) fieldErrors.assigneeId = "Select a valid assignee.";
  if (reviewerId && !UUID_PATTERN.test(reviewerId)) fieldErrors.reviewerId = "Select a valid reviewer.";
  if (assigneeId && reviewerId && assigneeId === reviewerId) fieldErrors.reviewerId = "Reviewer must be different from the assignee.";
  if (blockerNote.length > 500) fieldErrors.blockerNote = "Blocker note cannot exceed 500 characters.";
  // No rule here about `waiting` needing a note. What the work waits on is a
  // record now, not a sentence, and the repository refuses the status when
  // nothing is outstanding — which a form cannot know.
  if (!Number.isInteger(progress) || progress < 0 || progress > 99) fieldErrors.progress = "Open work progress must be between 0 and 99.";

  const budgetMinutesRaw = text(fields, "budgetMinutes");
  let budgetMinutes: number | null = null;
  if (budgetMinutesRaw) {
    const parsed = Number(budgetMinutesRaw);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100000) {
      fieldErrors.budgetMinutes = "Budget must be a whole number of minutes between 1 and 100000.";
    } else {
      budgetMinutes = parsed;
    }
  }

  if (Object.keys(fieldErrors).length) return { success: false, fieldErrors };
  return {
    success: true,
    data: {
      assigneeId: assigneeId || null,
      blockerNote,
      budgetMinutes,
      internalDueDate: internalDueDate || null,
      legalEntityId,
      periodKey,
      progress,
      reviewerId: reviewerId || null,
      serviceKey,
      statutoryDueDate,
      status: status as WorkInput["status"],
    },
  };
}

export function workServiceLabel(serviceKey: string) {
  return legacyWorkServiceOptions.find((service) => service.key === serviceKey)?.label ?? serviceKey.replaceAll("_", " ");
}

export function workServiceEntitlementCode(serviceKey: string) {
  return legacyWorkServiceOptions.find((service) => service.key === serviceKey)?.entitlementCode ?? serviceKey.toUpperCase();
}
