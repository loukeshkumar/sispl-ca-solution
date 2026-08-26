"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "../../../lib/auth/server";
import { getDatabase } from "../../../lib/dashboard/postgres/pool";
import { ComplianceScheduleError, createComplianceSchedule, updateComplianceSchedule } from "../../../lib/compliance/repository";
import { validateComplianceScheduleFields, type ComplianceScheduleActionState } from "../../../lib/compliance/validation";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** One action for add and edit; a present `scheduleId` switches it to an update. */
export async function saveComplianceScheduleAction(_previous: ComplianceScheduleActionState, formData: FormData): Promise<ComplianceScheduleActionState> {
  const session = await requirePermission("services:manage", "/settings/compliance");
  const rawId = String(formData.get("scheduleId") ?? "");
  const scheduleId = UUID_PATTERN.test(rawId) ? rawId : null;
  const validation = validateComplianceScheduleFields(Object.fromEntries(
    [...formData.entries()].filter(([, value]) => typeof value === "string").map(([key, value]) => [key, String(value)]),
  ));
  if (!validation.success) return { error: "Review the highlighted fields.", fieldErrors: validation.fieldErrors };
  try {
    if (scheduleId) await updateComplianceSchedule(getDatabase(), session.tenantId, session.userId, scheduleId, validation.data);
    else await createComplianceSchedule(getDatabase(), session.tenantId, session.userId, validation.data);
  } catch (error) {
    return {
      error: error instanceof ComplianceScheduleError ? error.message : "The schedule could not be saved.",
      fieldErrors: {},
    };
  }
  revalidatePath("/settings/compliance");
  return { error: "", fieldErrors: {} };
}
