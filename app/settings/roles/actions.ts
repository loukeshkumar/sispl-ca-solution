"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireSuperAdmin } from "../../../lib/auth/server";
import { getDatabase } from "../../../lib/dashboard/postgres/pool";
import { archiveRoleDefinition, createRoleDefinition, RoleRepositoryError, updateRoleDefinition } from "../../../lib/roles/repository";
import { validateRoleDefinitionForm, type RoleDefinitionActionState } from "../../../lib/roles/validation";

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
