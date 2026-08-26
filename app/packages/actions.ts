"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requirePermission } from "../../lib/auth/server";
import { getDatabase } from "../../lib/dashboard/postgres/pool";
import { databaseErrorCode } from "../../lib/packages/errors";
import {
  assignClientPackage,
  cancelClientPackage,
  createPackage,
  createService,
  getPackageForEdit,
  listClientPackageWorkspace,
  listPackageSetupWorkspace,
  PackageRepositoryError,
  updatePackage,
  updateService,
} from "../../lib/packages/repository";
import {
  type PackageActionState,
  type PackageFormFields,
  validateAssignmentFields,
  validatePackageFields,
  validateServiceFields,
} from "../../lib/packages/validation";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function serviceFields(formData: FormData): PackageFormFields {
  return Object.fromEntries(["category", "code", "description", "name", "status"].map((field) => [field, String(formData.get(field) ?? "")]));
}

function packageFields(formData: FormData): PackageFormFields {
  return {
    billingCycle: String(formData.get("billingCycle") ?? ""),
    code: String(formData.get("code") ?? ""),
    description: String(formData.get("description") ?? ""),
    name: String(formData.get("name") ?? ""),
    serviceIds: formData.getAll("serviceIds").map(String),
    standardFee: String(formData.get("standardFee") ?? ""),
    status: String(formData.get("status") ?? ""),
  };
}

function assignmentFields(formData: FormData): PackageFormFields {
  return {
    addonServiceIds: formData.getAll("addonServiceIds").map(String),
    agreedFee: String(formData.get("agreedFee") ?? ""),
    effectiveFrom: String(formData.get("effectiveFrom") ?? ""),
    effectiveTo: String(formData.get("effectiveTo") ?? ""),
    legalEntityId: String(formData.get("legalEntityId") ?? ""),
    packageId: String(formData.get("packageId") ?? ""),
    replaceExisting: String(formData.get("replaceExisting") ?? ""),
  };
}

function safeWriteError(error: unknown, duplicateField: "code" | "packageId" = "code"): PackageActionState {
  const databaseCode = databaseErrorCode(error);
  if (databaseCode === "23505") return { error: "That code or assignment already exists in this firm.", fieldErrors: { [duplicateField]: "Choose a unique value." } };
  if (error instanceof PackageRepositoryError) {
    const messages: Record<PackageRepositoryError["code"], string> = {
      invalid_package: "Select an active package from this firm.",
      invalid_service: "Select active, non-duplicate services from this firm.",
      invalid_state: "This package action is no longer available.",
      not_found: "The requested package record is unavailable.",
      overlap: "The selected package dates overlap another client agreement.",
      replace_required: "Confirm replacement of the current client package.",
    };
    return { error: messages[error.code], fieldErrors: {} };
  }
  return { error: "The package record could not be saved. Review the details and try again.", fieldErrors: {} };
}

/**
 * Dialog-driven save for the service master: a present `serviceId` makes it an
 * update. It returns clean state instead of redirecting, which is how the dialog
 * knows the save succeeded and can close.
 */
export async function saveServiceAction(_previous: PackageActionState, formData: FormData): Promise<PackageActionState> {
  const session = await requirePermission("services:manage", "/?workspace=service-management");
  const rawId = String(formData.get("serviceId") ?? "");
  const serviceId = UUID_PATTERN.test(rawId) ? rawId : null;
  const validation = validateServiceFields(serviceFields(formData));
  if (!validation.success) return { error: "Review the highlighted fields.", fieldErrors: validation.fieldErrors };
  try {
    if (serviceId) await updateService(getDatabase(), session.tenantId, session.userId, serviceId, validation.data);
    else await createService(getDatabase(), session.tenantId, session.userId, validation.data);
  } catch (error) {
    return safeWriteError(error);
  }
  revalidatePath("/");
  return { error: "", fieldErrors: {} };
}

export type PackageFormOptions = { services: Awaited<ReturnType<typeof listPackageSetupWorkspace>>["services"] };

/** Loaded when the dialog first opens rather than on every dashboard render. */
export async function loadPackageFormOptions(): Promise<PackageFormOptions> {
  const session = await requirePermission("packages:manage", "/?workspace=package-setup");
  const workspace = await listPackageSetupWorkspace(getDatabase(), session.tenantId);
  return { services: workspace.services };
}

/** Loaded when the assignment dialog first opens. */
export async function loadClientPackageWorkspace(): Promise<Awaited<ReturnType<typeof listClientPackageWorkspace>>> {
  const session = await requirePermission("client_packages:manage", "/?workspace=client-packages");
  return listClientPackageWorkspace(getDatabase(), session.tenantId);
}

/**
 * Dialog-driven save: a present `packageId` makes it a new catalogue version.
 * Returns clean state instead of redirecting, which is how the dialog knows to close.
 */
export async function savePackageAction(_previous: PackageActionState, formData: FormData): Promise<PackageActionState> {
  const session = await requirePermission("packages:manage", "/?workspace=package-setup");
  const rawId = String(formData.get("packageId") ?? "");
  const packageId = UUID_PATTERN.test(rawId) ? rawId : null;
  const validation = validatePackageFields(packageFields(formData));
  if (!validation.success) return { error: "Review the highlighted fields.", fieldErrors: validation.fieldErrors };
  try {
    if (packageId) await updatePackage(getDatabase(), session.tenantId, session.userId, packageId, validation.data);
    else await createPackage(getDatabase(), session.tenantId, session.userId, validation.data);
  } catch (error) {
    return safeWriteError(error);
  }
  revalidatePath("/");
  return { error: "", fieldErrors: {} };
}


export async function assignClientPackageAction(_previous: PackageActionState, formData: FormData): Promise<PackageActionState> {
  const session = await requirePermission("client_packages:manage", "/?workspace=client-packages");
  const fields = assignmentFields(formData);
  const packageId = String(fields.packageId ?? "");
  const legalEntityId = String(fields.legalEntityId ?? "");
  if (!UUID_PATTERN.test(packageId) || !UUID_PATTERN.test(legalEntityId)) {
    return { error: "Review the highlighted fields.", fieldErrors: { packageId: "Select an active package.", legalEntityId: "Select a client." } };
  }
  const [selectedPackage, workspace] = await Promise.all([
    getPackageForEdit(getDatabase(), session.tenantId, packageId),
    listClientPackageWorkspace(getDatabase(), session.tenantId),
  ]);
  if (!selectedPackage || selectedPackage.status !== "active") return { error: "Select an active package.", fieldErrors: { packageId: "This package is unavailable." } };
  const hasExisting = Boolean(workspace.clients.find((client) => client.id === legalEntityId)?.currentAssignmentId);
  const validation = validateAssignmentFields(fields, selectedPackage.serviceIds, hasExisting);
  if (!validation.success) return { error: "Review the highlighted fields.", fieldErrors: validation.fieldErrors };
  let assignmentId = "";
  try {
    assignmentId = await assignClientPackage(getDatabase(), session.tenantId, session.userId, validation.data);
  } catch (error) {
    return safeWriteError(error, "packageId");
  }
  revalidatePath("/");
  redirect(`/client-packages/${assignmentId}?toast=package-assigned`);
}

export async function cancelClientPackageAction(formData: FormData) {
  const assignmentId = String(formData.get("assignmentId") ?? "");
  const returnTo = UUID_PATTERN.test(assignmentId) ? `/client-packages/${assignmentId}` : "/?workspace=client-packages";
  const session = await requirePermission("client_packages:manage", returnTo);
  if (!UUID_PATTERN.test(assignmentId)) redirect("/?workspace=client-packages");
  try {
    await cancelClientPackage(getDatabase(), session.tenantId, session.userId, assignmentId, String(formData.get("reason") ?? ""));
  } catch (error) {
    const code = error instanceof PackageRepositoryError ? error.code : "failed";
    redirect(`/client-packages/${assignmentId}?cancelError=${encodeURIComponent(code)}`);
  }
  revalidatePath("/");
  revalidatePath(`/client-packages/${assignmentId}`);
  redirect(`/client-packages/${assignmentId}?toast=package-cancelled`);
}
