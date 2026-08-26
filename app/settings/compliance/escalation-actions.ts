"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "../../../lib/auth/server";
import { getDatabase } from "../../../lib/dashboard/postgres/pool";
import {
  archiveEscalationRule,
  createEscalationRule,
  EscalationError,
} from "../../../lib/escalation/repository";

export type EscalationActionState = { error: string; notice: string };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const refresh = () => {
  revalidatePath("/settings/compliance");
  revalidatePath("/");
};

const failure = (error: unknown, fallback: string): EscalationActionState => ({
  error: error instanceof EscalationError ? error.message : fallback,
  notice: "",
});

export async function addEscalationRungAction(
  _previous: EscalationActionState,
  formData: FormData,
): Promise<EscalationActionState> {
  const session = await requirePermission("services:manage", "/settings/compliance");
  const targetKind = String(formData.get("targetKind") ?? "");
  try {
    await createEscalationRule(getDatabase(), session.tenantId, session.userId, {
      anchor: String(formData.get("anchor") ?? ""),
      label: String(formData.get("label") ?? ""),
      offsetDays: Number(String(formData.get("offsetDays") ?? "")),
      rung: Number(String(formData.get("rung") ?? "")),
      targetKind,
      targetRole: targetKind === "role" ? String(formData.get("targetRole") ?? "") : null,
    });
  } catch (error) {
    return failure(error, "That rung could not be added.");
  }
  refresh();
  return { error: "", notice: "Rung added. It fires on the nightly run once an obligation reaches its day." };
}

export async function archiveEscalationRungAction(
  _previous: EscalationActionState,
  formData: FormData,
): Promise<EscalationActionState> {
  const session = await requirePermission("services:manage", "/settings/compliance");
  const ruleId = String(formData.get("ruleId") ?? "");
  if (!UUID_PATTERN.test(ruleId)) return { error: "That rung could not be found.", notice: "" };
  try {
    await archiveEscalationRule(getDatabase(), session.tenantId, session.userId, ruleId);
  } catch (error) {
    return failure(error, "That rung could not be removed.");
  }
  refresh();
  return { error: "", notice: "Rung removed. Escalations it already fired are kept." };
}
