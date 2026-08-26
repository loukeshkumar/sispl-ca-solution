"use client";

import { cancelDocumentRequestAction } from "../documents/actions";

export function CancelDocumentRequestForm({ requestId, title }: { requestId: string; title: string }) {
  return (
    <form
      action={cancelDocumentRequestAction}
      onSubmit={(event) => {
        if (!window.confirm(`Cancel the document request “${title}”? This cannot be undone.`)) {
          event.preventDefault();
        }
      }}
    >
      <input name="requestId" type="hidden" value={requestId} />
      <button type="submit">Cancel</button>
    </form>
  );
}
