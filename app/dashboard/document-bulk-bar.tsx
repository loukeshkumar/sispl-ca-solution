"use client";

import { useActionState } from "react";

import { emptyDocumentBulkState } from "../../lib/documents/bulk";
import { applyBulkRequestCancelAction } from "../documents/bulk-actions";

/**
 * Cancel only. Receiving a document means a file arrives, so a bulk button that
 * flipped status without one would mark requests satisfied with nothing behind
 * them.
 */
export function DocumentBulkBar() {
  const [state, action, pending] = useActionState(applyBulkRequestCancelAction, emptyDocumentBulkState);
  return (
    <form action={action} className="work-bulk-bar" id="document-bulk-form">
      <span className="document-bulk-label">Selected requests</span>
      <button className="secondary-button" disabled={pending} type="submit">{pending ? "Cancelling…" : "Cancel selected"}</button>
      <p aria-live="polite" className={`work-bulk-result${state.error ? " is-error" : ""}`}>
        {state.error}
        {!state.error && state.applied > 0 && `${state.applied} cancelled`}
        {!state.error && state.skipped.length > 0 && `${state.applied > 0 ? " · " : ""}${state.skipped.length} skipped: ${state.skipped[0]!.reason}`}
      </p>
    </form>
  );
}
