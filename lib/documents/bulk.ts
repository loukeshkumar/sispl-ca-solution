export type RequestBulkCandidate = { id: string; status: string };
export type BulkPlan = { apply: Array<{ id: string }>; skip: Array<{ id: string; reason: string }> };

export type DocumentBulkState = { applied: number; error: string; skipped: Array<{ id: string; reason: string }> };
export const emptyDocumentBulkState: DocumentBulkState = { applied: 0, error: "", skipped: [] };

/**
 * Only an outstanding request can be cancelled — the repository moves a row out
 * of `requested` and nothing else, so anything already settled is reported
 * rather than allowed to fail the whole transaction.
 *
 * There is deliberately no bulk "mark received": receiving means a file
 * arrived, and flipping status without one would record a request as satisfied
 * with nothing behind it.
 */
export function planBulkRequestCancel(items: RequestBulkCandidate[]): BulkPlan {
  const plan: BulkPlan = { apply: [], skip: [] };
  for (const item of items) {
    if (item.status === "received") {
      plan.skip.push({ id: item.id, reason: "This request was already received." });
      continue;
    }
    if (item.status === "cancelled") {
      plan.skip.push({ id: item.id, reason: "This request is already cancelled." });
      continue;
    }
    plan.apply.push({ id: item.id });
  }
  return plan;
}
