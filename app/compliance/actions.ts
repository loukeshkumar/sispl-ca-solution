"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "../../lib/auth/server";
import { getDatabase } from "../../lib/dashboard/postgres/pool";
import { raiseCoverageGap } from "../../lib/compliance/repository";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Raises one obligation the coverage report found unraised. Idempotent through
 * the same unique constraint the daily generator uses, so a double submit — or
 * the job running mid-click — cannot create a duplicate.
 */
export async function raiseCoverageGapAction(formData: FormData) {
  const session = await requirePermission("work:write", "/?workspace=compliance");
  const legalEntityId = String(formData.get("legalEntityId") ?? "");
  const serviceKey = String(formData.get("serviceKey") ?? "");
  const periodKey = String(formData.get("periodKey") ?? "");
  const statutoryDueDate = String(formData.get("statutoryDueDate") ?? "");
  const internalDueDate = String(formData.get("internalDueDate") ?? "");
  if (!UUID_PATTERN.test(legalEntityId) || !serviceKey || !periodKey) return;
  if (!DATE_PATTERN.test(statutoryDueDate) || !DATE_PATTERN.test(internalDueDate)) return;

  try {
    await raiseCoverageGap(getDatabase(), session.tenantId, session.userId, {
      internalDueDate, legalEntityId, periodKey, serviceKey, statutoryDueDate,
    });
  } catch (error) {
    console.error("Raising a coverage gap failed.", { errorType: error instanceof Error ? error.name : "UnknownError" });
  }
  revalidatePath("/");
}
