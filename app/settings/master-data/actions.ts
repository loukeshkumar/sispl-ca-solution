"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "../../../lib/auth/server";
import { getDatabase } from "../../../lib/dashboard/postgres/pool";
import { createChecklistItem, MasterDataError, updateChecklistItem } from "../../../lib/master-data/repository";
import { validateDocumentChecklistFields, type DocumentChecklistActionState } from "../../../lib/master-data/validation";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * One action serves add and edit: a present `itemId` switches it to an update.
 * On success it revalidates and returns clean state, which is how the dialog
 * knows to close.
 */
export async function saveChecklistItemAction(_previous: DocumentChecklistActionState, formData: FormData): Promise<DocumentChecklistActionState> {
  const session = await requirePermission("services:manage", "/settings/master-data");
  const rawId = String(formData.get("itemId") ?? "");
  const itemId = UUID_PATTERN.test(rawId) ? rawId : null;
  const validation = validateDocumentChecklistFields(Object.fromEntries(
    [...formData.entries()].filter(([, value]) => typeof value === "string").map(([key, value]) => [key, String(value)]),
  ));
  if (!validation.success) return { error: "Review the highlighted fields.", fieldErrors: validation.fieldErrors };
  try {
    if (itemId) await updateChecklistItem(getDatabase(), session.tenantId, session.userId, itemId, validation.data);
    else await createChecklistItem(getDatabase(), session.tenantId, session.userId, validation.data);
  } catch (error) {
    return {
      error: error instanceof MasterDataError ? error.message : "The checklist item could not be saved.",
      fieldErrors: error instanceof MasterDataError && error.code === "duplicate_code" ? { code: error.message } : {},
    };
  }
  revalidatePath("/settings/master-data");
  return { error: "", fieldErrors: {} };
}
