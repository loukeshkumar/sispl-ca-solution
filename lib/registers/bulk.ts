import { LIVE_DSC_STATUSES } from "./attention";
import type { NoticeStatus } from "./validation";

export type NoticeBulkAction =
  | { kind: "status"; status: NoticeStatus }
  | { kind: "assignee"; memberId: string | null };

export type NoticeBulkCandidate = { assigneeId?: string | null; id: string; status: string };
export type DscBulkCandidate = { id: string; status: string };

export type DscBulkMovement = {
  counterpartyName: string;
  custodianUserId?: string | null;
  eventType: "issued_out" | "returned" | "surrendered";
};

export type BulkPlan = { apply: Array<{ id: string }>; skip: Array<{ id: string; reason: string }> };
export type RegisterBulkState = { applied: number; error: string; skipped: Array<{ id: string; reason: string }> };
export const emptyRegisterBulkState: RegisterBulkState = { applied: 0, error: "", skipped: [] };

const STATUS_LABEL: Record<string, string> = {
  open: "open", in_progress: "in progress", responded: "responded", closed: "closed",
  in_custody: "in custody", issued_out: "issued out", expired: "expired", surrendered: "surrendered",
};

export function planBulkNoticeChange(items: NoticeBulkCandidate[], action: NoticeBulkAction): BulkPlan {
  const plan: BulkPlan = { apply: [], skip: [] };
  for (const item of items) {
    if (action.kind === "status" && item.status === action.status) {
      plan.skip.push({ id: item.id, reason: `This notice is already ${STATUS_LABEL[action.status] ?? action.status}.` });
      continue;
    }
    if (action.kind === "assignee" && action.memberId && item.assigneeId === action.memberId) {
      plan.skip.push({ id: item.id, reason: "That member is already assigned to this notice." });
      continue;
    }
    plan.apply.push({ id: item.id });
  }
  return plan;
}

/**
 * Custody has a strict state machine: a certificate can only be signed out from
 * custody, only returned when it is out, and never moved once expired or
 * surrendered. Pre-validating each one means a single ineligible certificate
 * reports a reason instead of aborting the batch.
 */
export function planBulkDscMovement(items: DscBulkCandidate[], movement: DscBulkMovement): BulkPlan {
  const plan: BulkPlan = { apply: [], skip: [] };
  for (const item of items) {
    if (!(LIVE_DSC_STATUSES as readonly string[]).includes(item.status)) {
      plan.skip.push({ id: item.id, reason: `This certificate is ${STATUS_LABEL[item.status] ?? item.status} and cannot move.` });
      continue;
    }
    if (movement.eventType === "issued_out" && item.status !== "in_custody") {
      plan.skip.push({ id: item.id, reason: "This certificate is already issued out." });
      continue;
    }
    if (movement.eventType === "returned") {
      if (item.status !== "issued_out") {
        plan.skip.push({ id: item.id, reason: "This certificate is not signed out, so it cannot be returned." });
        continue;
      }
      // The repository requires a custodian on return; without one the whole
      // transaction would fail rather than this row being reported.
      if (!movement.custodianUserId) {
        plan.skip.push({ id: item.id, reason: "Returning a certificate needs the custodian taking it back." });
        continue;
      }
    }
    plan.apply.push({ id: item.id });
  }
  return plan;
}
