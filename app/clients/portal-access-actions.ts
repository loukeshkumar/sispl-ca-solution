"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requirePermission } from "../../lib/auth/server";
import { getDatabase } from "../../lib/dashboard/postgres/pool";
import { disablePortalContact, PortalRepositoryError, provisionPortalContact } from "../../lib/portal/repository";
import { validatePortalContactFields, type PortalContactActionState } from "../../lib/portal/validation";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function field(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

export async function provisionPortalAccessAction(_previous: PortalContactActionState, formData: FormData): Promise<PortalContactActionState> {
  const legalEntityId = field(formData, "legalEntityId");
  const session = await requirePermission("clients:write", `/clients/${legalEntityId}`);
  const validation = validatePortalContactFields({
    legalEntityId,
    email: field(formData, "email"),
    fullName: field(formData, "fullName"),
  });
  if (!validation.success) return { error: "Review the highlighted fields.", fieldErrors: validation.fieldErrors };
  try {
    const { temporaryPassword } = await provisionPortalContact(getDatabase(), session.tenantId, session.userId, validation.data);
    revalidatePath(`/clients/${legalEntityId}`);
    return { error: "", fieldErrors: {}, temporaryPassword };
  } catch (error) {
    if (error instanceof PortalRepositoryError) return { error: error.message, fieldErrors: {} };
    return { error: "Portal access could not be provisioned. Try again.", fieldErrors: {} };
  }
}

export async function disablePortalAccessAction(formData: FormData) {
  const legalEntityId = field(formData, "legalEntityId");
  const portalUserId = field(formData, "portalUserId");
  const session = await requirePermission("clients:write", `/clients/${legalEntityId}`);
  if (UUID_PATTERN.test(portalUserId)) {
    try {
      await disablePortalContact(getDatabase(), session.tenantId, session.userId, portalUserId);
    } catch {
      // The Client 360 page remains the safe recovery destination.
    }
  }
  revalidatePath(`/clients/${legalEntityId}`);
  redirect(`/clients/${legalEntityId}`);
}
