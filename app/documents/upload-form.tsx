"use client";

import { useActionState, useRef, useState } from "react";

import { useCloseOnSuccess } from "../dashboard/form-dialog";

import { uploadDocumentAction } from "./actions";
import { reconcileDocumentUploadRelations, type DocumentActionState } from "../../lib/documents/validation";

type ClientOption = { id: string; label: string };
type WorkOption = { id: string; label: string; legalEntityId: string };
type RequestOption = { id: string; legalEntityId: string; clientName: string; title: string };

const initialState: DocumentActionState = { error: "", fieldErrors: {} };
const FILE_ACCEPT = ".pdf,.jpg,.jpeg,.png,.csv,.xlsx";
const ErrorText = ({ field, message }: { field: string; message?: string }) => message ? <small className="client-form-error" id={`${field}-error`}>{message}</small> : null;

export function DocumentUploadForm({ clients, work, requests, initialClientId, initialRequestId, onCancel, onSaved }: { clients: ClientOption[]; work: WorkOption[]; requests: RequestOption[]; initialClientId?: string; initialRequestId?: string; onCancel: () => void; onSaved: () => void }) {
  const [state, action, pending] = useActionState(uploadDocumentAction, initialState);
  useCloseOnSuccess(pending, state, onSaved);
  const fieldA11y = (field: keyof DocumentActionState["fieldErrors"]) => state.fieldErrors[field]
    ? { "aria-describedby": `${field}-error`, "aria-invalid": true as const }
    : {};
  const initialRequest = requests.find((request) => request.id === initialRequestId);
  const startingClientId = clients.some((client) => client.id === initialClientId)
    ? initialClientId ?? ""
    : initialRequest?.legalEntityId ?? "";
  const [selectedClientId, setSelectedClientId] = useState(startingClientId);
  const [selectedWorkItemId, setSelectedWorkItemId] = useState("");
  const [selectedRequestId, setSelectedRequestId] = useState(
    initialRequest?.legalEntityId === startingClientId ? initialRequest.id : "",
  );
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");

  /*
   * Capture reuses the one file input rather than adding a second one: two
   * inputs sharing a name would both post, and the empty one would win.
   * `capture` opens the camera on a phone and is ignored on a desktop, where
   * the picker opens instead — so the control degrades rather than dead-ends.
   */
  const takePhoto = () => {
    const input = fileRef.current;
    if (!input) return;
    input.setAttribute("accept", "image/*");
    input.setAttribute("capture", "environment");
    input.click();
  };

  const restorePicker = () => {
    const input = fileRef.current;
    if (!input) return;
    input.setAttribute("accept", FILE_ACCEPT);
    input.removeAttribute("capture");
  };
  const available = reconcileDocumentUploadRelations({
    legalEntityId: selectedClientId,
    workItemId: selectedWorkItemId,
    requestId: selectedRequestId,
    work,
    requests,
  });

  const selectClient = (legalEntityId: string) => {
    const reconciled = reconcileDocumentUploadRelations({
      legalEntityId,
      workItemId: selectedWorkItemId,
      requestId: selectedRequestId,
      work,
      requests,
    });
    setSelectedClientId(legalEntityId);
    setSelectedWorkItemId(reconciled.workItemId);
    setSelectedRequestId(reconciled.requestId);
  };
  return (
    <form action={action} className="client-editor-form is-in-dialog">
      <section className="client-form-section">
        <div><p className="eyebrow">SECURE UPLOAD</p><h2>Document details</h2><span>Files are stored outside the public application directory and require an authenticated download.</span></div>
        <div className="client-form-grid">
          <label><span>Client</span><select {...fieldA11y("legalEntityId")} name="legalEntityId" onChange={(event) => selectClient(event.target.value)} required value={selectedClientId}><option value="">Choose client</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.label}</option>)}</select><ErrorText field="legalEntityId" message={state.fieldErrors.legalEntityId} /></label>
          <label><span>Fulfil request (optional)</span><select {...fieldA11y("requestId")} disabled={!selectedClientId} name="requestId" onChange={(event) => setSelectedRequestId(event.target.value)} value={selectedRequestId}><option value="">{selectedClientId ? "General client document" : "Choose a client first"}</option>{available.requests.map((request) => <option key={request.id} value={request.id}>{request.clientName} · {request.title}</option>)}</select><ErrorText field="requestId" message={state.fieldErrors.requestId} /></label>
          <label><span>Related work (optional)</span><select {...fieldA11y("workItemId")} disabled={!selectedClientId} name="workItemId" onChange={(event) => setSelectedWorkItemId(event.target.value)} value={selectedWorkItemId}><option value="">{selectedClientId ? "No linked work item" : "Choose a client first"}</option>{available.work.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select><ErrorText field="workItemId" message={state.fieldErrors.workItemId} /></label>
          <label className="client-form-wide document-file-field">
            <span>File</span>
            <input
              {...fieldA11y("document")}
              accept={FILE_ACCEPT}
              name="document"
              onChange={(event) => { setFileName(event.target.files?.[0]?.name ?? ""); restorePicker(); }}
              ref={fileRef}
              required
              type="file"
            />
            <div className="document-file-tools">
              <button className="secondary-button" onClick={takePhoto} type="button">Take photo</button>
              {fileName && <small className="document-file-chosen">{fileName}</small>}
            </div>
            <small>PDF, JPG, PNG, CSV, or XLSX · maximum 10 MB · photograph a paper document on a phone</small>
            <ErrorText field="document" message={state.fieldErrors.document} />
          </label>
        </div>
      </section>
      {state.error && <p className="client-form-banner" role="alert">{state.error}</p>}
      <div className="client-form-actions"><button className="secondary-button" onClick={onCancel} type="button">Cancel</button><button className="primary-button" disabled={pending} type="submit">{pending ? "Uploading…" : "Upload document"}</button></div>
    </form>
  );
}
