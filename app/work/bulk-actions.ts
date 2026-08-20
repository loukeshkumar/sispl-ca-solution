"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "../../lib/auth/server";
import { getDatabase } from "../../lib/dashboard/postgres/pool";
import { BULK_STATUSES, type BulkAction } from "../../lib/work/bulk";
import { applyBulkWorkChange } from "../../lib/work/repository";

export type BulkActionState = { applied: number; error: string; skipped: Array<{ id: string; reason: string }> };
export const emptyBulkActionState: BulkActionState = { applied: 0, error: "", skipped: [] };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function readAction(formData: FormData): BulkAction | null {
  const kind = String(formData.get("kind") ?? "");
  const memberId = String(formData.get("memberId") ?? "").trim() || null;
  if (kind === "assignee" || kind === "reviewer") {
    if (memberId && !UUID_PATTERN.test(memberId)) return null;
    return { kind, memberId };
  }
  if (kind === "internalDue") {
    const shiftDays = Number(formData.get("shiftDays"));
    if (!Number.isInteger(shiftDays) || shiftDays === 0 || Math.abs(shiftDays) > 60) return null;
    return { kind, shiftDays };
  }
  if (kind === "status") {
    const status = String(formData.get("status") ?? "");
    // 'completed' is absent by design: completion requires progress 100 and no
    // missing items, and closing statutory obligations from a checkbox list is
    // the wrong affordance regardless.
    if (!BULK_STATUSES.includes(status as never)) return null;
    return { kind, status: status as typeof BULK_STATUSES[number] };
  }
  return null;
}

export async function applyBulkWorkAction(_previous: BulkActionState, formData: FormData): Promise<BulkActionState> {
  const session = await requirePermission("work:write", "/?workspace=work");
  const action = readAction(formData);
  if (!action) return { ...emptyBulkActionState, error: "Choose a valid bulk change." };
  const workItemIds = formData.getAll("workItemId").map(String).filter((id) => UUID_PATTERN.test(id));
  if (!workItemIds.length) return { ...emptyBulkActionState, error: "Select at least one work item." };

  try {
    const plan = await applyBulkWorkChange(getDatabase(), session.tenantId, session.userId, workItemIds, action);
    revalidatePath("/");
    for (const item of plan.apply) revalidatePath(`/work/${item.id}`);
    return { applied: plan.apply.length, error: "", skipped: plan.skip };
  } catch (error) {
    console.error("Bulk work change failed.", { errorType: error instanceof Error ? error.name : "UnknownError" });
    return { ...emptyBulkActionState, error: "That bulk change could not be applied." };
  }
}
