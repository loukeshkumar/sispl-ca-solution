"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "../../lib/auth/server";
import { getDatabase } from "../../lib/dashboard/postgres/pool";
import { BULK_TASK_STATUSES, emptyTaskBulkActionState, type TaskBulkAction, type TaskBulkActionState } from "../../lib/tasks/bulk";
import { applyBulkTaskChange } from "../../lib/tasks/repository";
import { taskPriorities } from "../../lib/tasks/validation";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function readAction(formData: FormData): TaskBulkAction | null {
  const kind = String(formData.get("kind") ?? "");
  const memberId = String(formData.get("memberId") ?? "").trim();
  if (kind === "assignee") return UUID_PATTERN.test(memberId) ? { kind, memberId } : null;
  if (kind === "reviewer") {
    if (memberId && !UUID_PATTERN.test(memberId)) return null;
    return { kind, memberId: memberId || null };
  }
  if (kind === "priority") {
    const priority = String(formData.get("priority") ?? "");
    return taskPriorities.includes(priority as never) ? { kind, priority: priority as typeof taskPriorities[number] } : null;
  }
  if (kind === "dueDate") {
    const shiftDays = Number(formData.get("shiftDays"));
    if (!Number.isInteger(shiftDays) || shiftDays === 0 || Math.abs(shiftDays) > 60) return null;
    return { kind, shiftDays };
  }
  if (kind === "status") {
    const status = String(formData.get("status") ?? "");
    // Completion and cancellation are terminal, separately audited acts.
    return BULK_TASK_STATUSES.includes(status as never) ? { kind, status: status as typeof BULK_TASK_STATUSES[number] } : null;
  }
  return null;
}

export async function applyBulkTaskAction(_previous: TaskBulkActionState, formData: FormData): Promise<TaskBulkActionState> {
  const session = await requirePermission("tasks:assign", "/?workspace=tasks");
  const action = readAction(formData);
  if (!action) return { ...emptyTaskBulkActionState, error: "Choose a valid bulk change." };
  const taskIds = formData.getAll("taskId").map(String).filter((id) => UUID_PATTERN.test(id));
  if (!taskIds.length) return { ...emptyTaskBulkActionState, error: "Select at least one task." };

  try {
    const plan = await applyBulkTaskChange(getDatabase(), session.tenantId, session.userId, taskIds, action);
    revalidatePath("/");
    for (const item of plan.apply) revalidatePath(`/tasks/${item.id}`);
    return { applied: plan.apply.length, error: "", skipped: plan.skip };
  } catch (error) {
    console.error("Bulk task change failed.", { errorType: error instanceof Error ? error.name : "UnknownError" });
    return { ...emptyTaskBulkActionState, error: "That bulk change could not be applied." };
  }
}
