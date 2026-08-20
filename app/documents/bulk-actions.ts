"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "../../lib/auth/server";
import { getDatabase } from "../../lib/dashboard/postgres/pool";
import { emptyDocumentBulkState, type DocumentBulkState } from "../../lib/documents/bulk";
import { applyBulkRequestCancel } from "../../lib/documents/repository";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function applyBulkRequestCancelAction(_previous: DocumentBulkState, formData: FormData): Promise<DocumentBulkState> {
  const session = await requirePermission("documents:write", "/?workspace=documents");
  const requestIds = formData.getAll("requestId").map(String).filter((id) => UUID_PATTERN.test(id));
  if (!requestIds.length) return { ...emptyDocumentBulkState, error: "Select at least one request." };

  try {
    const plan = await applyBulkRequestCancel(getDatabase(), session.tenantId, session.userId, requestIds);
    revalidatePath("/");
    return { applied: plan.apply.length, error: "", skipped: plan.skip };
  } catch (error) {
    console.error("Bulk request cancel failed.", { errorType: error instanceof Error ? error.name : "UnknownError" });
    return { ...emptyDocumentBulkState, error: "Those requests could not be cancelled." };
  }
}
