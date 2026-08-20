import { formatPaise, parseMoneyToPaise } from "../payroll/money";

export const packageBillingCycles = ["monthly", "quarterly", "annual", "one_time"] as const;
export const packageStatuses = ["active", "archived"] as const;
export const serviceStatuses = ["active", "archived"] as const;

export type PackageBillingCycle = typeof packageBillingCycles[number];
export type CatalogueStatus = typeof packageStatuses[number];
export type PackageFormFields = Record<string, string | string[] | undefined>;

export type ServiceInput = {
  category: string;
  code: string;
  description: string;
  name: string;
  /** The firm's estimate of one occurrence. Null means the service is unestimated. */
  standardMinutes: number | null;
  status: CatalogueStatus;
};

export type PackageInput = {
  billingCycle: PackageBillingCycle;
  code: string;
  description: string;
  name: string;
  serviceIds: string[];
  standardFeePaise: number;
  status: CatalogueStatus;
};

export type ClientPackageAssignmentInput = {
  addonServiceIds: string[];
  agreedFeePaise: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  legalEntityId: string;
  packageId: string;
  replaceExisting: boolean;
};

export type ServiceField = keyof ServiceInput;
export type PackageField = "billingCycle" | "code" | "description" | "name" | "serviceIds" | "standardFee" | "status";
export type AssignmentField = "addonServiceIds" | "agreedFee" | "effectiveFrom" | "effectiveTo" | "legalEntityId" | "packageId" | "replaceExisting";
export type FieldErrors<K extends string> = Partial<Record<K, string>>;
export type ValidationResult<T, K extends string> =
  | { success: true; data: T }
  | { success: false; fieldErrors: FieldErrors<K> };
export type PackageActionState<K extends string = string> = { error: string; fieldErrors: FieldErrors<K> };
export const emptyPackageActionState: PackageActionState = { error: "", fieldErrors: {} };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SERVICE_CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{1,19}$/;
const PACKAGE_CODE_PATTERN = /^[A-Z][A-Z0-9_-]{1,19}$/;

function text(fields: PackageFormFields, key: string) {
  const value = fields[key];
  return typeof value === "string" ? value.trim() : "";
}

function rawStrings(fields: PackageFormFields, key: string) {
  const value = fields[key];
  return Array.isArray(value) ? value : typeof value === "string" && value ? [value] : [];
}

function strings(fields: PackageFormFields, key: string) {
  return [...new Set(rawStrings(fields, key).filter((item) => UUID_PATTERN.test(item)))].sort();
}

function validDateKey(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

export function formatPackageFee(paise: number) {
  return formatPaise(paise);
}

export function validateServiceFields(fields: PackageFormFields): ValidationResult<ServiceInput, ServiceField> {
  const code = text(fields, "code").toUpperCase();
  const name = text(fields, "name");
  const category = text(fields, "category");
  const description = text(fields, "description");
  const status = text(fields, "status");
  const fieldErrors: FieldErrors<ServiceField> = {};

  if (!SERVICE_CODE_PATTERN.test(code)) fieldErrors.code = "Use 2–20 uppercase letters, numbers, underscores, or hyphens.";
  if (name.length < 2 || name.length > 100) fieldErrors.name = "Enter a service name between 2 and 100 characters.";
  if (category.length < 2 || category.length > 60) fieldErrors.category = "Enter a category between 2 and 60 characters.";
  if (description.length > 500) fieldErrors.description = "Keep the description within 500 characters.";
  if (!serviceStatuses.includes(status as CatalogueStatus)) fieldErrors.status = "Select active or archived.";

  const standardMinutesRaw = text(fields, "standardMinutes");
  let standardMinutes: number | null = null;
  if (standardMinutesRaw) {
    const parsed = Number(standardMinutesRaw);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100000) {
      fieldErrors.standardMinutes = "Standard effort must be a whole number of minutes between 1 and 100000.";
    } else {
      standardMinutes = parsed;
    }
  }

  if (Object.keys(fieldErrors).length) return { success: false, fieldErrors };
  return { success: true, data: { category, code, description, name, standardMinutes, status: status as CatalogueStatus } };
}

export function validatePackageFields(fields: PackageFormFields): ValidationResult<PackageInput, PackageField> {
  const code = text(fields, "code").toUpperCase();
  const name = text(fields, "name");
  const description = text(fields, "description");
  const billingCycle = text(fields, "billingCycle");
  const status = text(fields, "status");
  const standardFeePaise = parseMoneyToPaise(text(fields, "standardFee"));
  const rawServiceIds = rawStrings(fields, "serviceIds");
  const serviceIds = strings(fields, "serviceIds");
  const fieldErrors: FieldErrors<PackageField> = {};

  if (!PACKAGE_CODE_PATTERN.test(code)) fieldErrors.code = "Start with a letter and use 2–20 uppercase letters, numbers, underscores, or hyphens.";
  if (name.length < 2 || name.length > 100) fieldErrors.name = "Enter a package name between 2 and 100 characters.";
  if (description.length > 800) fieldErrors.description = "Keep the description within 800 characters.";
  if (!packageBillingCycles.includes(billingCycle as PackageBillingCycle)) fieldErrors.billingCycle = "Select a supported billing cycle.";
  if (standardFeePaise === null) fieldErrors.standardFee = "Enter a non-negative INR amount with at most two decimal places.";
  if (!packageStatuses.includes(status as CatalogueStatus)) fieldErrors.status = "Select active or archived.";
  if (!serviceIds.length || rawServiceIds.some((serviceId) => !UUID_PATTERN.test(serviceId))) fieldErrors.serviceIds = "Select at least one valid included service.";

  if (Object.keys(fieldErrors).length || standardFeePaise === null) return { success: false, fieldErrors };
  return { success: true, data: { billingCycle: billingCycle as PackageBillingCycle, code, description, name, serviceIds, standardFeePaise, status: status as CatalogueStatus } };
}

export function validateAssignmentFields(
  fields: PackageFormFields,
  includedServiceIds: readonly string[] = [],
  hasExistingAssignment = false,
): ValidationResult<ClientPackageAssignmentInput, AssignmentField> {
  const legalEntityId = text(fields, "legalEntityId");
  const packageId = text(fields, "packageId");
  const effectiveFrom = text(fields, "effectiveFrom");
  const rawEffectiveTo = text(fields, "effectiveTo");
  const agreedFeePaise = parseMoneyToPaise(text(fields, "agreedFee"));
  const rawAddonServiceIds = rawStrings(fields, "addonServiceIds");
  const addonServiceIds = strings(fields, "addonServiceIds");
  const replaceExisting = text(fields, "replaceExisting") === "on";
  const included = new Set(includedServiceIds);
  const fieldErrors: FieldErrors<AssignmentField> = {};

  if (!UUID_PATTERN.test(legalEntityId)) fieldErrors.legalEntityId = "Select a valid client legal entity.";
  if (!UUID_PATTERN.test(packageId)) fieldErrors.packageId = "Select an active package.";
  if (!validDateKey(effectiveFrom)) fieldErrors.effectiveFrom = "Enter a valid effective date.";
  if (rawEffectiveTo && !validDateKey(rawEffectiveTo)) fieldErrors.effectiveTo = "Enter a valid end date.";
  else if (rawEffectiveTo && validDateKey(effectiveFrom) && rawEffectiveTo < effectiveFrom) fieldErrors.effectiveTo = "The end date cannot be before the start date.";
  if (agreedFeePaise === null) fieldErrors.agreedFee = "Enter a non-negative INR amount with at most two decimal places.";
  if (rawAddonServiceIds.some((serviceId) => !UUID_PATTERN.test(serviceId))) fieldErrors.addonServiceIds = "Select valid add-on services.";
  if (addonServiceIds.some((serviceId) => included.has(serviceId))) fieldErrors.addonServiceIds = "An included package service cannot also be an add-on.";
  if (hasExistingAssignment && !replaceExisting) fieldErrors.replaceExisting = "Confirm replacement of the current package.";

  if (Object.keys(fieldErrors).length || agreedFeePaise === null) return { success: false, fieldErrors };
  return {
    success: true,
    data: {
      addonServiceIds,
      agreedFeePaise,
      effectiveFrom,
      effectiveTo: rawEffectiveTo || null,
      legalEntityId,
      packageId,
      replaceExisting,
    },
  };
}
