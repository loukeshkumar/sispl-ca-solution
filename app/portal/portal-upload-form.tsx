"use client";

import { useActionState } from "react";

import type { DocumentActionState } from "../../lib/documents/validation";
import { portalUploadAction } from "./actions";

const initialState: DocumentActionState = { error: "", fieldErrors: {} };

export default function PortalUploadForm({ requestId, requestTitle }: { requestId: string; requestTitle: string }) {
  const [state, formAction, pending] = useActionState(portalUploadAction, initialState);
  return (
    <form action={formAction} className="portal-upload-form">
      <input name="requestId" type="hidden" value={requestId} />
      <label>
        <span className="visually-hidden">Upload a file for {requestTitle}</span>
        <input accept=".pdf,.png,.jpg,.jpeg,.csv,.xlsx,.docx" name="document" required type="file" />
      </label>
      <button className="primary-button" disabled={pending} type="submit">{pending ? "Uploading…" : "Upload"}</button>
      {(state.error || state.fieldErrors.document) && <em className="portal-field-error">{state.fieldErrors.document ?? state.error}</em>}
    </form>
  );
}
