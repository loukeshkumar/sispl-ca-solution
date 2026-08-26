"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "../../lib/auth/server";
import { getDatabase } from "../../lib/dashboard/postgres/pool";
import { FilingRepositoryError, recordFilingAcknowledgement } from "../../lib/filings/repository";
import { validateFilingAcknowledgementFields, type FilingActionState } from "../../lib/filings/validation";

export async function recordFilingAcknowledgementAction(_previous: FilingActionState, formData: FormData): Promise<FilingActionState> {
  const workItemId = String(formData.get("workItemId") ?? "");
  const session = await requirePermission("work:write", `/work/${workItemId}`);
  const validation = validateFilingAcknowledgementFields(Object.fromEntries(
    [...formData.entries()].filter(([, value]) => typeof value === "string").map(([key, value]) => [key, String(value)]),
  ));
  if (!validation.success) return { error: "Review the highlighted fields.", fieldErrors: validation.fieldErrors };
  try {
    await recordFilingAcknowledgement(getDatabase(), session.tenantId, session.userId, validation.data);
  } catch (error) {
    return {
      error: error instanceof FilingRepositoryError ? error.message : "The acknowledgement could not be recorded.",
      fieldErrors: {},
    };
  }
  revalidatePath("/");
  revalidatePath(`/work/${workItemId}`);
  return { error: "", fieldErrors: {} };
}
