"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requirePermission, requireSuperAdmin } from "../../../lib/auth/server";
import { getDatabase } from "../../../lib/dashboard/postgres/pool";
import { archiveRoleDefinition, createRoleDefinition, RoleRepositoryError, updateRoleDefinition } from "../../../lib/roles/repository";
import { expireEmployeePassword, provisionEmployeeAccess, TeamRepositoryError } from "../../../lib/team/repository";
import { validateRoleDefinitionForm, type MemberAccessState, type RoleDefinitionActionState } from "../../../lib/roles/validation";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function actionError(error: unknown): RoleDefinitionActionState {
  if (error instanceof RoleRepositoryError) return { error: error.message, fieldErrors: {} };
  return { error: "The role could not be saved. Review the details and try again.", fieldErrors: {} };
}

/**
 * Dialog-driven save. A present `roleId` makes it an update. It returns clean
 * state rather than redirecting, which is how the dialog knows to close.
 */
export async function saveRoleDefinitionAction(_previous: RoleDefinitionActionState, formData: FormData): Promise<RoleDefinitionActionState> {
  const session = await requireSuperAdmin("/?workspace=user-roles");
  const rawId = String(formData.get("roleId") ?? "");
  const roleId = UUID_PATTERN.test(rawId) ? rawId : null;
  const validation = validateRoleDefinitionForm(formData);
  if (!validation.success) return { error: "Review the highlighted role settings.", fieldErrors: validation.fieldErrors };
  try {
    if (roleId) await updateRoleDefinition(getDatabase(), session.tenantId, session.userId, roleId, validation.data);
    else await createRoleDefinition(getDatabase(), session.tenantId, session.userId, validation.data);
  } catch (error) {
    return actionError(error);
  }
  revalidatePath("/");
  return { error: "", fieldErrors: {} };
}

export async function archiveRoleDefinitionAction(formData: FormData) {
  const roleId = String(formData.get("roleId") ?? "");
  const session = await requireSuperAdmin("/?workspace=user-roles");
  if (!UUID_PATTERN.test(roleId)) redirect("/?workspace=user-roles");
  try {
    await archiveRoleDefinition(getDatabase(), session.tenantId, session.userId, roleId);
  } catch (error) {
    const reason = error instanceof RoleRepositoryError ? error.code : "failed";
    redirect(`/?workspace=user-roles&archiveError=${encodeURIComponent(reason)}`);
  }
  revalidatePath("/");
  redirect("/?workspace=user-roles&saved=archived");
}

/**
 * Credential actions for the people register.
 *
 * They require `team:manage` rather than the Super Admin gate above, because
 * they are the same acts the employee page already offers and go through the
 * same repository guards — a Super Admin target is refused, and an Admin target
 * is refused to anyone who is not a Super Admin.
 */
export async function resetMemberPasswordAction(employeeId: string, _previous: MemberAccessState): Promise<MemberAccessState> {
  void _previous;
  const session = await requirePermission("team:manage", "/?workspace=user-roles");
  if (!UUID_PATTERN.test(employeeId)) return { error: "The employee reference is invalid." };
  try {
    const temporaryPassword = await provisionEmployeeAccess(getDatabase(), session.tenantId, session.userId, employeeId);
    revalidatePath("/");
    return { error: "", employeeId, temporaryPassword };
  } catch (error) {
    return { error: error instanceof TeamRepositoryError ? error.message : "The password could not be reset." };
  }
}

export async function expireMemberPasswordAction(employeeId: string, _previous: MemberAccessState): Promise<MemberAccessState> {
  void _previous;
  const session = await requirePermission("team:manage", "/?workspace=user-roles");
  if (!UUID_PATTERN.test(employeeId)) return { error: "The employee reference is invalid." };
  try {
    await expireEmployeePassword(getDatabase(), session.tenantId, session.userId, employeeId);
    revalidatePath("/");
    return { error: "", employeeId, expired: true };
  } catch (error) {
    return { error: error instanceof TeamRepositoryError ? error.message : "The password could not be expired." };
  }
}
