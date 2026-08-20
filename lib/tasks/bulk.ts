import type { TaskPriority, TaskStatus } from "./validation";

/** Terminal states are excluded: completion and cancellation are deliberate,
 *  separately audited acts with their own repository functions. */
export const BULK_TASK_STATUSES = ["todo", "in_progress", "waiting", "review"] as const;
const CLOSED_STATUSES: readonly string[] = ["completed", "cancelled"];

export type TaskBulkAction =
  | { kind: "assignee"; memberId: string }
  | { kind: "reviewer"; memberId: string | null }
  | { kind: "priority"; priority: TaskPriority }
  | { kind: "dueDate"; shiftDays: number }
  | { kind: "status"; status: typeof BULK_TASK_STATUSES[number] };

export type TaskBulkCandidate = {
  assigneeId: string;
  blockerNote: string;
  dueDate: string;
  id: string;
  reviewerId: string | null;
  status: TaskStatus | string;
};

export type TaskBulkItem = { dueDate?: string; id: string };
export type TaskBulkPlan = { apply: TaskBulkItem[]; skip: Array<{ id: string; reason: string }> };

export type TaskBulkActionState = { applied: number; error: string; skipped: Array<{ id: string; reason: string }> };
export const emptyTaskBulkActionState: TaskBulkActionState = { applied: 0, error: "", skipped: [] };

const DAY_MS = 86_400_000;

function shiftDateKey(dateKey: string, days: number) {
  return new Date(Date.parse(`${dateKey}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Validates the whole selection before anything is written. Four database
 * checks bound what a batch may do, and a violated check aborts the entire
 * transaction — so an item that would violate one is skipped with a reason a
 * user can act on, never silently dropped.
 */
export function planBulkTaskChange(items: TaskBulkCandidate[], action: TaskBulkAction): TaskBulkPlan {
  if (action.kind === "status" && !BULK_TASK_STATUSES.includes(action.status)) {
    throw new Error("Tasks cannot be marked completed or cancelled from a bulk action.");
  }
  const plan: TaskBulkPlan = { apply: [], skip: [] };
  for (const item of items) {
    if (CLOSED_STATUSES.includes(item.status)) {
      plan.skip.push({ id: item.id, reason: "This task is already closed." });
      continue;
    }
    if (action.kind === "assignee" && item.reviewerId === action.memberId) {
      plan.skip.push({ id: item.id, reason: "That member already reviews this task." });
      continue;
    }
    if (action.kind === "reviewer" && action.memberId && item.assigneeId === action.memberId) {
      plan.skip.push({ id: item.id, reason: "That member is already the assignee on this task." });
      continue;
    }
    if (action.kind === "dueDate") {
      plan.apply.push({ dueDate: shiftDateKey(item.dueDate, action.shiftDays), id: item.id });
      continue;
    }
    // office_tasks_waiting_note_check: waiting demands a recorded dependency.
    if (action.kind === "status" && action.status === "waiting" && !item.blockerNote.trim()) {
      plan.skip.push({ id: item.id, reason: "Waiting needs a recorded dependency on the task." });
      continue;
    }
    plan.apply.push({ id: item.id });
  }
  return plan;
}
