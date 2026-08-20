import type { TodoPriority, TodoStatus } from "./validation";

export type TodoBulkAction =
  | { kind: "complete" }
  | { kind: "reopen" }
  | { kind: "archive" }
  | { kind: "reschedule"; shiftDays: number }
  | { kind: "priority"; priority: TodoPriority }
  | { kind: "category"; category: string };

export type TodoBulkCandidate = { dueDate: string | null; id: string; status: TodoStatus | string };
export type TodoBulkItem = { dueDate?: string; id: string };
export type TodoBulkPlan = { apply: TodoBulkItem[]; skip: Array<{ id: string; reason: string }> };

export type TodoBulkActionState = { applied: number; error: string; skipped: Array<{ id: string; reason: string }> };
export const emptyTodoBulkActionState: TodoBulkActionState = { applied: 0, error: "", skipped: [] };

const DAY_MS = 86_400_000;

function shiftDateKey(dateKey: string, days: number) {
  return new Date(Date.parse(`${dateKey}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Validates the whole selection before anything is written. Two state
 * constraints bound what a batch may do — a completed row must carry
 * completed_at, an archived row archived_at — and a violated check aborts the
 * entire transaction, so anything that would violate one is skipped with a
 * reason instead of taking the batch down with it.
 */
export function planBulkTodoChange(items: TodoBulkCandidate[], action: TodoBulkAction): TodoBulkPlan {
  const plan: TodoBulkPlan = { apply: [], skip: [] };
  for (const item of items) {
    if (action.kind === "complete" && item.status === "completed") {
      plan.skip.push({ id: item.id, reason: "This to-do is already complete." });
      continue;
    }
    if (action.kind === "reopen" && item.status === "open") {
      plan.skip.push({ id: item.id, reason: "This to-do is already open." });
      continue;
    }
    if (action.kind === "archive" && item.status === "archived") {
      plan.skip.push({ id: item.id, reason: "This to-do is already archived." });
      continue;
    }
    if (action.kind === "reschedule") {
      // Shifting nothing by three days is still nothing — an undated item needs
      // a date chosen, not derived.
      if (!item.dueDate) {
        plan.skip.push({ id: item.id, reason: "This to-do has no due date to shift." });
        continue;
      }
      plan.apply.push({ dueDate: shiftDateKey(item.dueDate, action.shiftDays), id: item.id });
      continue;
    }
    plan.apply.push({ id: item.id });
  }
  return plan;
}
