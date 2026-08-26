"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requirePermission } from "../../lib/auth/server";
import { listAssignableRoles } from "../../lib/roles/repository";
import { getDatabase } from "../../lib/dashboard/postgres/pool";
import { createEmployee, disableEmployee, provisionEmployeeAccess, setEmploymentStage, TeamRepositoryError, updateEmployee } from "../../lib/team/repository";
import { validateEmployeeFields, type EmployeeActionState, type EmployeeFormFields } from "../../lib/team/validation";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fieldNames = ["designation", "email", "fullName", "joiningDate", "mobileNumber", "notes", "roleDefinitionId"];

const employeeFields = (formData: FormData): EmployeeFormFields => Object.fromEntries(
  fieldNames.map((field) => [field, typeof formData.get(field) === "string" ? String(formData.get(field)) : ""]),
);

function employeeError(error: unknown): EmployeeActionState {
  if (error instanceof TeamRepositoryError && error.code === "duplicate_email") {
    return { error: error.message, fieldErrors: { email: "Use an email address that is not already registered." } };
  }
  if (error instanceof TeamRepositoryError && error.code === "shared_identity") return { error: error.message, fieldErrors: {} };
  if (error instanceof TeamRepositoryError && ["invalid_role", "role_forbidden", "protected_super_admin", "self_role_change"].includes(error.code)) return { error: error.message, fieldErrors: { roleDefinitionId: error.message } };
  return { error: "The employee could not be saved. Review the details and try again.", fieldErrors: {} };
}

export type EmployeeFormOptions = { roles: Awaited<ReturnType<typeof listAssignableRoles>> };

/**
 * Loaded when the dialog first opens rather than on every dashboard render.
 * The assignable set is narrowed by the caller's own access class, so an admin
 * can never grant a role above their own.
 */
export async function loadEmployeeFormOptions(): Promise<EmployeeFormOptions> {
  const session = await requirePermission("team:manage", "/?workspace=team");
  return { roles: await listAssignableRoles(getDatabase(), session.tenantId, session.accessClass) };
}

/**
 * Dialog-driven save: a present `employeeId` makes it an update. Returns clean
 * state instead of redirecting, which is how the dialog knows to close.
 */
export async function saveEmployeeAction(_previous: EmployeeActionState, formData: FormData): Promise<EmployeeActionState> {
  const session = await requirePermission("team:manage", "/?workspace=team");
  const rawId = String(formData.get("employeeId") ?? "");
  const employeeId = UUID_PATTERN.test(rawId) ? rawId : null;
  const validation = validateEmployeeFields(employeeFields(formData));
  if (!validation.success) return { error: "Review the highlighted fields.", fieldErrors: validation.fieldErrors };
  try {
    if (employeeId) await updateEmployee(getDatabase(), session.tenantId, session.userId, employeeId, validation.data);
    else await createEmployee(getDatabase(), session.tenantId, session.userId, validation.data);
  } catch (error) {
    return employeeError(error);
  }
  revalidatePath("/");
  if (employeeId) revalidatePath(`/team/${employeeId}`);
  return { error: "", fieldErrors: {} };
}


export async function provisionEmployeeAccessAction(employeeId: string, _previous: EmployeeActionState): Promise<EmployeeActionState> {
  void _previous;
  const session = await requirePermission("team:manage", `/team/${employeeId}`);
  if (!UUID_PATTERN.test(employeeId)) return { error: "The employee reference is invalid.", fieldErrors: {} };
  try {
    const temporaryPassword = await provisionEmployeeAccess(getDatabase(), session.tenantId, session.userId, employeeId);
    revalidatePath(`/team/${employeeId}`);
    return { error: "", fieldErrors: {}, temporaryPassword };
  } catch (error) {
    return { error: error instanceof TeamRepositoryError ? error.message : "Login access could not be provisioned.", fieldErrors: {} };
  }
}

/**
 * Now a form action with state, because the exit can be refused for reasons the
 * person disabling needs to read — a redirect with a query flag could only ever
 * say "failed".
 */
export async function disableEmployeeAction(_previous: EmployeeActionState, formData: FormData): Promise<EmployeeActionState> {
  const employeeId = String(formData.get("employeeId") ?? "");
  const session = await requirePermission("team:manage", UUID_PATTERN.test(employeeId) ? `/team/${employeeId}` : "/?workspace=team");
  if (!UUID_PATTERN.test(employeeId)) return { error: "That employee could not be found.", fieldErrors: {} };
  try {
    await disableEmployee(getDatabase(), session.tenantId, session.userId, employeeId, new Date(), String(formData.get("clearanceNote") ?? ""));
  } catch (error) {
    return {
      error: error instanceof TeamRepositoryError ? error.message : "That employee could not be disabled. Refresh and try again.",
      fieldErrors: {},
    };
  }
  revalidatePath("/");
  revalidatePath("/team/[employeeId]", "page");
  redirect("/?workspace=team&toast=employee-disabled");
}

export async function setEmploymentStageAction(_previous: EmployeeActionState, formData: FormData): Promise<EmployeeActionState> {
  const employeeId = String(formData.get("employeeId") ?? "");
  const session = await requirePermission("team:manage", UUID_PATTERN.test(employeeId) ? `/team/${employeeId}` : "/?workspace=team");
  if (!UUID_PATTERN.test(employeeId)) return { error: "That employee could not be found.", fieldErrors: {} };
  const rawProbationEnd = String(formData.get("probationEndDate") ?? "").trim();
  try {
    await setEmploymentStage(getDatabase(), session.tenantId, session.userId, employeeId, {
      effectiveOn: String(formData.get("effectiveOn") ?? ""),
      probationEndDate: rawProbationEnd === "" ? null : rawProbationEnd,
      reason: String(formData.get("reason") ?? ""),
      stage: String(formData.get("stage") ?? ""),
    });
  } catch (error) {
    return {
      error: error instanceof TeamRepositoryError ? error.message : "That stage could not be saved. Refresh and try again.",
      fieldErrors: {},
    };
  }
  revalidatePath("/");
  revalidatePath("/team/[employeeId]", "page");
  return { error: "", fieldErrors: {} };
}
