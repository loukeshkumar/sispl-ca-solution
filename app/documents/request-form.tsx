"use client";

import { useActionState, useState } from "react";

import { createDocumentRequestAction } from "./actions";
import { useCloseOnSuccess } from "../dashboard/form-dialog";
import type { DocumentActionState } from "../../lib/documents/validation";
import { checklistDueDate } from "../../lib/master-data/validation";

const initialState: DocumentActionState = { error: "", fieldErrors: {} };
const ErrorText = ({ field, message }: { field: string; message?: string }) => message ? <small className="client-form-error" id={`${field}-error`}>{message}</small> : null;

export type ChecklistOption = {
  id: string;
  code: string;
  name: string;
  category: string;
  instructions: string;
  serviceCode: string;
  defaultLeadDays: number;
  mandatory: boolean;
};

export function DocumentRequestForm({
  checklist = [],
  clients,
  initialClientId,
  onCancel,
  onSaved,
  todayKey,
  work,
}: {
  checklist?: ChecklistOption[];
  clients: Array<{ id: string; label: string }>;
  initialClientId?: string;
  onCancel: () => void;
  onSaved: () => void;
  todayKey: string;
  work: Array<{ id: string; label: string; legalEntityId: string }>;
}) {
  const [state, action, pending] = useActionState(createDocumentRequestAction, initialState);
  const [picked, setPicked] = useState<ChecklistOption | null>(null);
  useCloseOnSuccess(pending, state, onSaved);
  const fieldA11y = (field: keyof DocumentActionState["fieldErrors"]) => state.fieldErrors[field]
    ? { "aria-describedby": `${field}-error`, "aria-invalid": true as const }
    : {};
  return (
    <form action={action} className="client-editor-form is-in-dialog">
      <section className="client-form-section">
        <div><p className="eyebrow">DOCUMENT REQUEST</p><h2>Request details</h2><span>Create a traceable request against an active client and optional work item.</span></div>
        <div className="client-form-grid">
          <label><span>Client</span><select {...fieldA11y("legalEntityId")} defaultValue={initialClientId ?? ""} name="legalEntityId" required><option value="">Choose client</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.label}</option>)}</select><ErrorText field="legalEntityId" message={state.fieldErrors.legalEntityId} /></label>
          <label><span>Related work (optional)</span><select {...fieldA11y("workItemId")} name="workItemId"><option value="">No linked work item</option>{work.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select><ErrorText field="workItemId" message={state.fieldErrors.workItemId} /></label>
          {checklist.length > 0 && (
            <label className="client-form-wide">
              <span>Pick from the document checklist</span>
              <select
                onChange={(event) => setPicked(checklist.find((item) => item.id === event.target.value) ?? null)}
                value={picked?.id ?? ""}
              >
                <option value="">Not from the checklist — type it below</option>
                {checklist.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.category} · {item.name}{item.serviceCode ? ` (${item.serviceCode})` : ""}{item.mandatory ? " · mandatory" : ""}
                  </option>
                ))}
              </select>
              <small className="client-form-hint">Maintained in Settings → Master Data, so every request reads the same.</small>
            </label>
          )}
          <label className="client-form-wide"><span>Document needed</span><input {...fieldA11y("title")} defaultValue={picked?.name ?? ""} key={`title-${picked?.id ?? "blank"}`} maxLength={120} name="title" placeholder="Signed financial statements" required /><ErrorText field="title" message={state.fieldErrors.title} /></label>
          <label><span>Needed by</span><input {...fieldA11y("dueDate")} defaultValue={picked ? checklistDueDate(todayKey, picked.defaultLeadDays) : ""} key={`due-${picked?.id ?? "blank"}`} name="dueDate" required type="date" /><ErrorText field="dueDate" message={state.fieldErrors.dueDate} /></label>
          <label className="client-form-wide"><span>Instructions</span><textarea {...fieldA11y("description")} defaultValue={picked?.instructions ?? ""} key={`desc-${picked?.id ?? "blank"}`} maxLength={500} name="description" placeholder="Describe the period, signatures, or format required." /><ErrorText field="description" message={state.fieldErrors.description} /></label>
        </div>
      </section>
      {state.error && <p className="client-form-banner" role="alert">{state.error}</p>}
      <div className="client-form-actions"><button className="secondary-button" onClick={onCancel} type="button">Cancel</button><button className="primary-button" disabled={pending} type="submit">{pending ? "Creating…" : "Create request"}</button></div>
    </form>
  );
}
