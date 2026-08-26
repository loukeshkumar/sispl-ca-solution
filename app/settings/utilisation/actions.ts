"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "../../../lib/auth/server";
import { indiaDateKey } from "../../../lib/attendance/calculations";
import { getDatabase } from "../../../lib/dashboard/postgres/pool";
import {
  removeUtilisationTarget,
  saveUtilisationTarget,
  UtilisationError,
} from "../../../lib/rates/utilisation-repository";

export type TargetActionState = { error: string; fieldErrors: Record<string, string> };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ROLE_KEYS = ["firm_administrator", "partner", "manager", "associate"];

const refresh = () => {
  revalidatePath("/settings/utilisation");
  revalidatePath("/");
};

const failure = (error: unknown): TargetActionState => ({
  error: error instanceof UtilisationError ? error.message : "That target could not be saved. Refresh and try again.",
  fieldErrors: {},
});

/**
 * Percent on the form, basis points in the database. A target people are
 * measured against must not drift, so it never becomes a float.
 */
function percentToBasisPoints(raw: string): number | null {
  const cleaned = raw.replace(/[%\s]/g, "");
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(cleaned)) return null;
  const value = Math.round(Number(cleaned) * 100);
  return value >= 0 && value <= 10_000 ? value : null;
}

export async function saveTargetAction(_previous: TargetActionState, formData: FormData): Promise<TargetActionState> {
  const session = await requirePermission("team:manage", "/settings/utilisation");
  const scope = String(formData.get("scope") ?? "");
  const roleKey = String(formData.get("roleKey") ?? "");
  const employeeUserId = String(formData.get("employeeUserId") ?? "");
  const effectiveFrom = String(formData.get("effectiveFrom") ?? "") || indiaDateKey();
  const targetBasisPoints = percentToBasisPoints(String(formData.get("targetPercent") ?? ""));

  if (scope !== "role" && scope !== "employee") return { error: "Choose a role or an employee.", fieldErrors: {} };
  if (scope === "role" && !ROLE_KEYS.includes(roleKey)) return { error: "Choose a role.", fieldErrors: {} };
  if (scope === "employee" && !UUID_PATTERN.test(employeeUserId)) return { error: "Choose an employee.", fieldErrors: {} };
  if (targetBasisPoints === null) {
    return { error: "Review the highlighted fields.", fieldErrors: { targetPercent: "Enter a target between 0 and 100, for example 75 or 72.5." } };
  }

  try {
    await saveUtilisationTarget(getDatabase(), session.tenantId, session.userId, {
      effectiveFrom,
      employeeUserId: scope === "employee" ? employeeUserId : null,
      note: String(formData.get("note") ?? ""),
      roleKey: scope === "role" ? roleKey : null,
      scope,
      targetBasisPoints,
    });
  } catch (error) {
    return failure(error);
  }
  refresh();
  return { error: "", fieldErrors: {} };
}

export async function removeTargetAction(_previous: TargetActionState, formData: FormData): Promise<TargetActionState> {
  const session = await requirePermission("team:manage", "/settings/utilisation");
  const targetId = String(formData.get("targetId") ?? "");
  if (!UUID_PATTERN.test(targetId)) return { error: "Choose a target to withdraw.", fieldErrors: {} };
  try {
    await removeUtilisationTarget(getDatabase(), session.tenantId, session.userId, targetId);
  } catch (error) {
    return failure(error);
  }
  refresh();
  return { error: "", fieldErrors: {} };
}
