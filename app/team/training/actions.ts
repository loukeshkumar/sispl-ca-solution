"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "../../../lib/auth/server";
import { indiaDateKey } from "../../../lib/attendance/calculations";
import { getDatabase } from "../../../lib/dashboard/postgres/pool";
import { parseHours } from "../../../lib/training/cpe";
import { recordTraining, removeTraining, saveCpePolicy, TrainingError } from "../../../lib/training/repository";

export type TrainingActionState = { error: string; fieldErrors: Record<string, string> };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const refresh = () => {
  revalidatePath("/team/training");
  revalidatePath("/team/[employeeId]", "page");
  revalidatePath("/");
};

const failure = (error: unknown): TrainingActionState => ({
  error: error instanceof TrainingError ? error.message : "That could not be saved. Refresh and try again.",
  fieldErrors: {},
});

export async function recordTrainingAction(_previous: TrainingActionState, formData: FormData): Promise<TrainingActionState> {
  const session = await requirePermission("team:manage", "/team/training");
  const employeeUserId = String(formData.get("employeeUserId") ?? "");
  if (!UUID_PATTERN.test(employeeUserId)) return { error: "Choose who attended.", fieldErrors: {} };
  const minutes = parseHours(String(formData.get("hours") ?? ""));
  if (minutes === null) {
    return { error: "Review the highlighted fields.", fieldErrors: { hours: "Enter the duration in hours, for example 6 or 6.5." } };
  }

  try {
    await recordTraining(getDatabase(), session.tenantId, session.userId, {
      certificateReference: String(formData.get("certificateReference") ?? ""),
      completedOn: String(formData.get("completedOn") ?? ""),
      employeeUserId,
      learningType: String(formData.get("learningType") ?? ""),
      minutes,
      note: String(formData.get("note") ?? ""),
      provider: String(formData.get("provider") ?? ""),
      serviceCode: String(formData.get("serviceCode") ?? ""),
      title: String(formData.get("title") ?? ""),
    });
  } catch (error) {
    return failure(error);
  }
  refresh();
  return { error: "", fieldErrors: {} };
}

export async function removeTrainingAction(_previous: TrainingActionState, formData: FormData): Promise<TrainingActionState> {
  const session = await requirePermission("team:manage", "/team/training");
  const recordId = String(formData.get("recordId") ?? "");
  if (!UUID_PATTERN.test(recordId)) return { error: "Choose a record to remove.", fieldErrors: {} };
  try {
    await removeTraining(getDatabase(), session.tenantId, session.userId, recordId);
  } catch (error) {
    return failure(error);
  }
  refresh();
  return { error: "", fieldErrors: {} };
}

export async function saveCpePolicyAction(_previous: TrainingActionState, formData: FormData): Promise<TrainingActionState> {
  const session = await requirePermission("team:manage", "/team/training");
  const fields = ["yearlyStructured", "yearlyTotal", "blockStructured", "blockTotal"] as const;
  const parsed: Record<string, number> = {};
  for (const field of fields) {
    const minutes = parseHours(String(formData.get(field) ?? "0"));
    // Zero is a legitimate requirement, and parseHours refuses it as a duration.
    const raw = String(formData.get(field) ?? "").trim();
    parsed[field] = raw === "" || raw === "0" ? 0 : minutes ?? -1;
    if (parsed[field] === -1) {
      return { error: "Review the highlighted fields.", fieldErrors: { [field]: "Enter hours, for example 20 or 0." } };
    }
  }
  const blockYears = Number(String(formData.get("blockYears") ?? "3"));
  if (!Number.isInteger(blockYears) || blockYears < 1 || blockYears > 10) {
    return { error: "Review the highlighted fields.", fieldErrors: { blockYears: "Enter a block length between 1 and 10 years." } };
  }

  try {
    await saveCpePolicy(getDatabase(), session.tenantId, session.userId, {
      blockStructuredMinutes: parsed.blockStructured!,
      blockTotalMinutes: parsed.blockTotal!,
      blockYears,
      category: String(formData.get("category") ?? ""),
      confirmed: String(formData.get("confirmed") ?? "") === "on",
      effectiveFrom: String(formData.get("effectiveFrom") ?? "") || indiaDateKey(),
      note: String(formData.get("note") ?? ""),
      yearlyStructuredMinutes: parsed.yearlyStructured!,
      yearlyTotalMinutes: parsed.yearlyTotal!,
    });
  } catch (error) {
    return failure(error);
  }
  refresh();
  return { error: "", fieldErrors: {} };
}
