"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "../../lib/auth/server";
import { getDatabase } from "../../lib/dashboard/postgres/pool";
import { ProcedureError, setStepStatus } from "../../lib/procedures/repository";

export type StepActionState = { error: string; fieldErrors: Record<string, string> };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Ticking a step is doing the work, so it sits behind the permission to manage
 * work rather than the permission to configure it.
 */
export async function setStepStatusAction(_previous: StepActionState, formData: FormData): Promise<StepActionState> {
  const session = await requirePermission("work:write", "/?workspace=work");
  const stepId = String(formData.get("stepId") ?? "");
  if (!UUID_PATTERN.test(stepId)) return { error: "That step could not be found.", fieldErrors: {} };

  try {
    await setStepStatus(getDatabase(), session.tenantId, session.userId, stepId, {
      note: String(formData.get("note") ?? ""),
      status: String(formData.get("status") ?? ""),
    });
  } catch (error) {
    return {
      error: error instanceof ProcedureError ? error.message : "That step could not be updated. Refresh and try again.",
      fieldErrors: {},
    };
  }
  revalidatePath("/work/[workItemId]", "page");
  revalidatePath("/");
  return { error: "", fieldErrors: {} };
}
