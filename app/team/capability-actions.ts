"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "../../lib/auth/server";
import { indiaDateKey } from "../../lib/attendance/calculations";
import { getDatabase } from "../../lib/dashboard/postgres/pool";
import {
  CapabilityError,
  listCapabilityServices,
  removeEmployeeCapability,
  saveEmployeeCapability,
} from "../../lib/team/capability-repository";

export type CapabilityActionState = { error: string; fieldErrors: Record<string, string> };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/**
 * The panel lives on Employee 360, which is a dynamic route — revalidating `/`
 * alone refreshes the bench grid on the workspace and leaves the page the editor
 * is actually on showing yesterday's answer.
 */
const refreshCapability = () => {
  revalidatePath("/");
  revalidatePath("/team/[employeeId]", "page");
};

const failure = (error: unknown): CapabilityActionState => ({
  error: error instanceof CapabilityError ? error.message : "That capability could not be saved. Refresh and try again.",
  fieldErrors: {},
});

/**
 * Recording capability is an act of management, so it sits behind the same
 * permission as maintaining the employee record itself — and the repository
 * refuses self-assessment, which is the point of writing it down.
 */
export async function saveCapabilityAction(_previous: CapabilityActionState, formData: FormData): Promise<CapabilityActionState> {
  const session = await requirePermission("team:manage", "/?workspace=team");
  const employeeUserId = String(formData.get("employeeUserId") ?? "");
  const serviceCode = String(formData.get("serviceCode") ?? "").trim();
  const level = String(formData.get("level") ?? "");
  const note = String(formData.get("note") ?? "").trim();
  if (!UUID_PATTERN.test(employeeUserId)) return { error: "Choose an employee.", fieldErrors: {} };
  if (!serviceCode) return { error: "Choose a service.", fieldErrors: { serviceCode: "Choose a service." } };

  try {
    await saveEmployeeCapability(
      getDatabase(), session.tenantId, session.userId, employeeUserId,
      { level, note, serviceCode }, indiaDateKey(),
    );
  } catch (error) {
    return failure(error);
  }
  refreshCapability();
  return { error: "", fieldErrors: {} };
}

export async function removeCapabilityAction(_previous: CapabilityActionState, formData: FormData): Promise<CapabilityActionState> {
  const session = await requirePermission("team:manage", "/?workspace=team");
  const employeeUserId = String(formData.get("employeeUserId") ?? "");
  const serviceCode = String(formData.get("serviceCode") ?? "").trim();
  if (!UUID_PATTERN.test(employeeUserId) || !serviceCode) return { error: "Choose a capability to withdraw.", fieldErrors: {} };
  try {
    await removeEmployeeCapability(getDatabase(), session.tenantId, session.userId, employeeUserId, serviceCode);
  } catch (error) {
    return failure(error);
  }
  refreshCapability();
  return { error: "", fieldErrors: {} };
}

export async function loadCapabilityServices() {
  const session = await requirePermission("team:read", "/?workspace=team");
  return listCapabilityServices(getDatabase(), session.tenantId);
}
