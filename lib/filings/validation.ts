export const filingPortals = ["gstn", "income_tax", "traces", "mca", "other"] as const;
export const filingPortalStatuses = ["filed", "filed_late", "processed", "defective", "rejected"] as const;

export type FilingPortalName = typeof filingPortals[number];
export type FilingPortalStatus = typeof filingPortalStatuses[number];

export type FilingAcknowledgementInput = {
  legalEntityId: string;
  workItemId: string | null;
  portal: FilingPortalName;
  filingType: string;
  periodKey: string;
  acknowledgementNumber: string;
  filedOn: string;
  portalStatus: FilingPortalStatus;
  remarks: string;
};

export type FilingFieldErrors = Partial<Record<keyof FilingAcknowledgementInput, string>>;
export type FilingActionState = { error: string; fieldErrors: FilingFieldErrors };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REFERENCE_PATTERN = /^[A-Za-z0-9/-]{6,40}$/;

function text(fields: Record<string, string | undefined>, key: string) {
  return fields[key]?.trim() ?? "";
}

export function validateFilingAcknowledgementFields(fields: Record<string, string | undefined>):
  | { success: true; data: FilingAcknowledgementInput }
  | { success: false; fieldErrors: FilingFieldErrors } {
  const legalEntityId = text(fields, "legalEntityId");
  const workItemId = text(fields, "workItemId");
  const portal = text(fields, "portal");
  const filingType = text(fields, "filingType").toUpperCase();
  const periodKey = text(fields, "periodKey");
  const acknowledgementNumber = text(fields, "acknowledgementNumber").toUpperCase();
  const filedOn = text(fields, "filedOn");
  const portalStatus = text(fields, "portalStatus");
  const remarks = text(fields, "remarks");
  const fieldErrors: FilingFieldErrors = {};

  if (!UUID_PATTERN.test(legalEntityId)) fieldErrors.legalEntityId = "Select an active client.";
  if (workItemId && !UUID_PATTERN.test(workItemId)) fieldErrors.workItemId = "Select a valid obligation.";
  if (!filingPortals.includes(portal as FilingPortalName)) fieldErrors.portal = "Select the portal that issued the acknowledgement.";
  if (filingType.length < 2 || filingType.length > 40) fieldErrors.filingType = "Enter the return or form, e.g. GSTR-3B.";
  if (periodKey.length < 2 || periodKey.length > 60) fieldErrors.periodKey = "Enter the period the filing covers.";
  if (!REFERENCE_PATTERN.test(acknowledgementNumber)) fieldErrors.acknowledgementNumber = "Enter the ARN or acknowledgement number exactly as issued.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(filedOn) || Number.isNaN(Date.parse(`${filedOn}T00:00:00Z`))) fieldErrors.filedOn = "Enter the date shown on the portal.";
  if (!filingPortalStatuses.includes(portalStatus as FilingPortalStatus)) fieldErrors.portalStatus = "Select the status shown on the portal.";
  if (remarks.length > 1000) fieldErrors.remarks = "Remarks cannot exceed 1000 characters.";

  if (Object.keys(fieldErrors).length) return { success: false, fieldErrors };
  return {
    success: true,
    data: {
      legalEntityId,
      workItemId: workItemId || null,
      portal: portal as FilingPortalName,
      filingType,
      periodKey,
      acknowledgementNumber,
      filedOn,
      portalStatus: portalStatus as FilingPortalStatus,
      remarks,
    },
  };
}
