export const clientEntityTypes = [
  "Private Company",
  "Public Company",
  "LLP",
  "Partnership",
  "Proprietorship",
  "Trust / NPO",
  "Individual",
] as const;

export const clientRiskStatuses = ["healthy", "watch", "critical"] as const;

export type ClientInput = {
  city: string;
  displayName: string;
  entityType: string;
  gstRegistrations: number;
  healthScore: number;
  legalName: string;
  maskedPan: string;
  ownerId: string | null;
  relationshipStart: string;
  riskStatus: typeof clientRiskStatuses[number];
  services: string[];
};

export type ClientFormFields = Record<string, string | string[] | undefined>;
export type ClientFieldErrors = Partial<Record<keyof ClientInput, string>>;
export type ClientActionState = { error: string; fieldErrors: ClientFieldErrors };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UNMASKED_PAN_PATTERN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const SERVICE_CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{1,19}$/;

function text(fields: ClientFormFields, key: string) {
  const value = fields[key];
  return typeof value === "string" ? value.trim() : "";
}

function validDateKey(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

export function validateClientFields(fields: ClientFormFields):
  | { success: true; data: ClientInput }
  | { success: false; fieldErrors: ClientFieldErrors } {
  const legalName = text(fields, "legalName");
  const displayName = text(fields, "displayName");
  const entityType = text(fields, "entityType");
  const maskedPan = text(fields, "maskedPan").toUpperCase();
  const city = text(fields, "city");
  const relationshipStart = text(fields, "relationshipStart");
  const ownerId = text(fields, "ownerId");
  const riskStatus = text(fields, "riskStatus");
  const healthScore = Number(text(fields, "healthScore"));
  const gstRegistrations = Number(text(fields, "gstRegistrations"));
  const rawServices = fields.services;
  const submittedServices = (Array.isArray(rawServices) ? rawServices : rawServices ? [rawServices] : [])
    .filter((service): service is string => typeof service === "string")
    .map((service) => service.trim().toUpperCase());
  const services = [...new Set(submittedServices.filter((service) => SERVICE_CODE_PATTERN.test(service)))];
  const fieldErrors: ClientFieldErrors = {};

  if (legalName.length < 2 || legalName.length > 160) fieldErrors.legalName = "Enter a legal name between 2 and 160 characters.";
  if (displayName.length < 2 || displayName.length > 120) fieldErrors.displayName = "Enter a display name between 2 and 120 characters.";
  if (!clientEntityTypes.includes(entityType as never)) fieldErrors.entityType = "Select a supported entity type.";
  if (UNMASKED_PAN_PATTERN.test(maskedPan)) {
    fieldErrors.maskedPan = "Do not enter a complete PAN. Store only a masked value.";
  } else if (!/^[A-Z0-9•*.-]{6,20}$/.test(maskedPan) || !/[•*]{3,}/.test(maskedPan)) {
    fieldErrors.maskedPan = "Use a masked PAN such as AABCA••••F.";
  }
  if (city.length < 2 || city.length > 100) fieldErrors.city = "Enter a city between 2 and 100 characters.";
  if (!validDateKey(relationshipStart)) fieldErrors.relationshipStart = "Enter a valid relationship start date.";
  if (ownerId && !UUID_PATTERN.test(ownerId)) fieldErrors.ownerId = "Select a valid relationship owner.";
  if (!clientRiskStatuses.includes(riskStatus as never)) fieldErrors.riskStatus = "Select a valid risk status.";
  if (!Number.isInteger(healthScore) || healthScore < 0 || healthScore > 100) fieldErrors.healthScore = "Health score must be between 0 and 100.";
  if (!Number.isInteger(gstRegistrations) || gstRegistrations < 0 || gstRegistrations > 50) fieldErrors.gstRegistrations = "GST registrations must be between 0 and 50.";
  if (!services.length || submittedServices.some((service) => !SERVICE_CODE_PATTERN.test(service))) fieldErrors.services = "Select at least one valid active service.";

  if (Object.keys(fieldErrors).length) return { success: false, fieldErrors };
  return {
    success: true,
    data: {
      city,
      displayName,
      entityType,
      gstRegistrations,
      healthScore,
      legalName,
      maskedPan,
      ownerId: ownerId || null,
      relationshipStart,
      riskStatus: riskStatus as ClientInput["riskStatus"],
      services,
    },
  };
}
