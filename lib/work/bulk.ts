import type { WorkQueueRow } from "./queue";

export const BULK_STATUSES = ["critical", "at_risk", "waiting", "review"] as const;

export type BulkAction =
  | { kind: "assignee"; memberId: string | null }
  | { kind: "reviewer"; memberId: string | null }
  | { kind: "internalDue"; shiftDays: number }
  | { kind: "status"; status: typeof BULK_STATUSES[number] };

export type BulkPlanCandidate = Pick<WorkQueueRow, "assigneeId" | "blockerNote" | "id" | "internalDueDate" | "reviewerId" | "statutoryDueDate">;
export type BulkPlanItem = { id: string; internalDueDate?: string | null };
export type BulkPlan = { apply: BulkPlanItem[]; skip: Array<{ id: string; reason: string }> };

const DAY_MS = 86_400_000;

function shiftDateKey(dateKey: string, days: number) {
  return new Date(Date.parse(`${dateKey}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Validates the whole selection before anything is written. Three database
 * checks bound what a batch may do — separation of duties, deadline order, and
 * the completed-state rule — and a violated check aborts the entire
 * transaction. An item that would violate one is skipped with a reason a user
 * can act on, never silently dropped.
 */
export function planBulkChange(items: BulkPlanCandidate[], action: BulkAction): BulkPlan {
  if (action.kind === "status" && !BULK_STATUSES.includes(action.status)) {
    throw new Error("Work items cannot be marked completed from a bulk action.");
  }
  const plan: BulkPlan = { apply: [], skip: [] };
  for (const item of items) {
    if (action.kind === "assignee" && action.memberId && item.reviewerId === action.memberId) {
      plan.skip.push({ id: item.id, reason: "That member already reviews this item." });
      continue;
    }
    if (action.kind === "reviewer" && action.memberId && item.assigneeId === action.memberId) {
      plan.skip.push({ id: item.id, reason: "That member is already the assignee on this item." });
      continue;
    }
    if (action.kind === "internalDue") {
      const internalDueDate = shiftDateKey(item.internalDueDate ?? item.statutoryDueDate, action.shiftDays);
      if (internalDueDate > item.statutoryDueDate) {
        plan.skip.push({ id: item.id, reason: "The shifted internal date would fall after the statutory date." });
        continue;
      }
      plan.apply.push({ id: item.id, internalDueDate });
      continue;
    }
    if (action.kind === "status" && action.status === "waiting" && item.blockerNote.trim().length < 3) {
      plan.skip.push({ id: item.id, reason: "Waiting needs a recorded dependency on the item." });
      continue;
    }
    plan.apply.push({ id: item.id });
  }
  return plan;
}
