"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "../../../lib/auth/server";
import { getDatabase } from "../../../lib/dashboard/postgres/pool";
import {
  archiveProcedure,
  draftProcedure,
  ProcedureError,
  publishProcedure,
  replaceDraftSteps,
} from "../../../lib/procedures/repository";
import type { DraftStep } from "../../../lib/procedures/steps";

export type ProcedureActionState = { error: string; fieldErrors: Record<string, string> };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_STEPS = 40;

const refresh = () => {
  revalidatePath("/settings/procedures");
  revalidatePath("/");
};

const failure = (error: unknown): ProcedureActionState => ({
  error: error instanceof ProcedureError ? error.message : "That procedure could not be saved. Refresh and try again.",
  fieldErrors: {},
});

/** One textarea, one step per line: the fastest way to write a real procedure. */
function parseSteps(raw: string): DraftStep[] {
  return raw.split("\n").map((line) => line.trim()).filter(Boolean).slice(0, MAX_STEPS).map((line) => {
    // A trailing "(optional)" marks a step that will not block completion.
    const optional = /\(optional\)\s*$/i.test(line);
    const withoutFlag = line.replace(/\(optional\)\s*$/i, "").trim();
    const [title, ...rest] = withoutFlag.split(" — ");
    return { instruction: rest.join(" — "), mandatory: !optional, title: title ?? withoutFlag };
  });
}

export async function draftProcedureAction(_previous: ProcedureActionState, formData: FormData): Promise<ProcedureActionState> {
  const session = await requirePermission("services:manage", "/settings/procedures");
  const serviceCode = String(formData.get("serviceCode") ?? "").trim();
  if (!serviceCode) return { error: "Choose a service.", fieldErrors: {} };
  const steps = parseSteps(String(formData.get("steps") ?? ""));
  if (steps.length === 0) {
    return { error: "Review the highlighted fields.", fieldErrors: { steps: "Write at least one step, one per line." } };
  }

  try {
    await draftProcedure(getDatabase(), session.tenantId, session.userId, {
      effectiveFrom: String(formData.get("effectiveFrom") ?? ""),
      note: String(formData.get("note") ?? ""),
      serviceCode,
      steps,
    });
  } catch (error) {
    return failure(error);
  }
  refresh();
  return { error: "", fieldErrors: {} };
}

export async function reviseDraftAction(_previous: ProcedureActionState, formData: FormData): Promise<ProcedureActionState> {
  const session = await requirePermission("services:manage", "/settings/procedures");
  const procedureVersionId = String(formData.get("procedureVersionId") ?? "");
  if (!UUID_PATTERN.test(procedureVersionId)) return { error: "Choose a draft.", fieldErrors: {} };
  try {
    await replaceDraftSteps(
      getDatabase(), session.tenantId, session.userId, procedureVersionId,
      parseSteps(String(formData.get("steps") ?? "")),
    );
  } catch (error) {
    return failure(error);
  }
  refresh();
  return { error: "", fieldErrors: {} };
}

export async function publishProcedureAction(_previous: ProcedureActionState, formData: FormData): Promise<ProcedureActionState> {
  const session = await requirePermission("services:manage", "/settings/procedures");
  const procedureVersionId = String(formData.get("procedureVersionId") ?? "");
  if (!UUID_PATTERN.test(procedureVersionId)) return { error: "Choose a draft.", fieldErrors: {} };
  try {
    await publishProcedure(getDatabase(), session.tenantId, session.userId, procedureVersionId);
  } catch (error) {
    return failure(error);
  }
  refresh();
  return { error: "", fieldErrors: {} };
}

export async function archiveProcedureAction(_previous: ProcedureActionState, formData: FormData): Promise<ProcedureActionState> {
  const session = await requirePermission("services:manage", "/settings/procedures");
  const procedureVersionId = String(formData.get("procedureVersionId") ?? "");
  if (!UUID_PATTERN.test(procedureVersionId)) return { error: "Choose a version.", fieldErrors: {} };
  try {
    await archiveProcedure(getDatabase(), session.tenantId, session.userId, procedureVersionId);
  } catch (error) {
    return failure(error);
  }
  refresh();
  return { error: "", fieldErrors: {} };
}
