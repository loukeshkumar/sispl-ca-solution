"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "../../lib/auth/server";
import { getDatabase } from "../../lib/dashboard/postgres/pool";
import { emptyTodoBulkActionState, type TodoBulkAction, type TodoBulkActionState } from "../../lib/todos/bulk";
import { applyBulkTodoChange, renameTodoCategory } from "../../lib/todos/repository";
import { todoPriorities } from "../../lib/todos/validation";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function readAction(formData: FormData): TodoBulkAction | null {
  const kind = String(formData.get("kind") ?? "");
  if (kind === "complete" || kind === "reopen" || kind === "archive") return { kind };
  if (kind === "reschedule") {
    const shiftDays = Number(formData.get("shiftDays"));
    if (!Number.isInteger(shiftDays) || shiftDays === 0 || Math.abs(shiftDays) > 365) return null;
    return { kind, shiftDays };
  }
  if (kind === "priority") {
    const priority = String(formData.get("priority") ?? "");
    return todoPriorities.includes(priority as never) ? { kind, priority: priority as typeof todoPriorities[number] } : null;
  }
  if (kind === "category") {
    const category = String(formData.get("category") ?? "").trim().slice(0, 40);
    return { kind, category };
  }
  return null;
}

export async function applyBulkTodoAction(_previous: TodoBulkActionState, formData: FormData): Promise<TodoBulkActionState> {
  // To-dos are private to their owner, so the session user is both the
  // authorization and the scope. There is no elevated view of someone else's.
  const session = await requirePermission("dashboard:read", "/?workspace=todos");
  const action = readAction(formData);
  if (!action) return { ...emptyTodoBulkActionState, error: "Choose a valid bulk change." };
  const todoIds = formData.getAll("todoId").map(String).filter((id) => UUID_PATTERN.test(id));
  if (!todoIds.length) return { ...emptyTodoBulkActionState, error: "Select at least one to-do." };

  try {
    const plan = await applyBulkTodoChange(getDatabase(), session.tenantId, session.userId, todoIds, action);
    revalidatePath("/");
    return { applied: plan.apply.length, error: "", skipped: plan.skip };
  } catch (error) {
    console.error("Bulk to-do change failed.", { errorType: error instanceof Error ? error.name : "UnknownError" });
    return { ...emptyTodoBulkActionState, error: "That bulk change could not be applied." };
  }
}

export async function renameTodoCategoryAction(_previous: TodoBulkActionState, formData: FormData): Promise<TodoBulkActionState> {
  const session = await requirePermission("dashboard:read", "/?workspace=todos");
  const from = String(formData.get("from") ?? "").trim();
  const to = String(formData.get("to") ?? "").trim();
  if (!from || !to) return { ...emptyTodoBulkActionState, error: "Choose a category and a new name." };
  try {
    const applied = await renameTodoCategory(getDatabase(), session.tenantId, session.userId, from, to);
    revalidatePath("/");
    // Renaming onto an existing name is how a merge is expressed.
    return { applied, error: "", skipped: [] };
  } catch (error) {
    console.error("Category rename failed.", { errorType: error instanceof Error ? error.name : "UnknownError" });
    return { ...emptyTodoBulkActionState, error: "That category could not be renamed." };
  }
}
