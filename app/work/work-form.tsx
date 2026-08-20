"use client";

import { useActionState, useState } from "react";

import { useCloseOnSuccess } from "../dashboard/form-dialog";
import type { WorkClientOption, WorkMemberOption } from "../../lib/work/repository";
import {
  workServiceLabel,
  workStatusOptions,
  type WorkActionState,
  type WorkInput,
} from "../../lib/work/validation";

type WorkFormAction = (state: WorkActionState, formData: FormData) => Promise<WorkActionState>;
const initialState: WorkActionState = { error: "", fieldErrors: {} };

function FieldError({ field, message }: { field: string; message?: string }) {
  return message ? <small className="client-form-error" id={`${field}-error`}>{message}</small> : null;
}

export default function WorkForm({
  action,
  clients,
  initial,
  members,
  mode,
  onCancel,
  onSaved,
  workItemId,
}: {
  action: WorkFormAction;
  clients: WorkClientOption[];
  initial?: Partial<WorkInput>;
  members: WorkMemberOption[];
  mode: "create" | "edit";
  onCancel: () => void;
  onSaved: () => void;
  workItemId?: string;
}) {
  const [state, formAction, pending] = useActionState(action, initialState);
  const [clientId, setClientId] = useState(initial?.legalEntityId ?? "");
  useCloseOnSuccess(pending, state, onSaved);
  const selectedClient = clients.find((client) => client.id === clientId);
  const availableServices = [...(selectedClient?.services ?? [])];
  if (initial?.serviceKey && !availableServices.some((service) => service.key === initial.serviceKey)) availableServices.unshift({ key: initial.serviceKey, label: `${workServiceLabel(initial.serviceKey)} (existing work)` });
  const fieldA11y = (field: keyof WorkActionState["fieldErrors"]) => state.fieldErrors[field]
    ? { "aria-describedby": `${field}-error`, "aria-invalid": true as const }
    : {};

  return (
    <form action={formAction} className="client-editor-form work-editor-form is-in-dialog">
      {workItemId && <input name="workItemId" type="hidden" value={workItemId} />}
      <section className="client-form-section">
        <div><p className="eyebrow">OBLIGATION</p><h2>Client and filing</h2><span>Define the legal entity, compliance service, and filing period.</span></div>
        <div className="client-form-grid">
          <label className="client-form-wide"><span>Client</span><select {...fieldA11y("legalEntityId")} name="legalEntityId" onChange={(event) => setClientId(event.target.value)} required value={clientId}><option disabled value="">Select active client</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.displayName}</option>)}</select><FieldError field="legalEntityId" message={state.fieldErrors.legalEntityId} /></label>
          <label><span>Service / form</span><select {...fieldA11y("serviceKey")} defaultValue={initial?.serviceKey ?? availableServices[0]?.key ?? ""} key={clientId} name="serviceKey" required>{availableServices.length ? availableServices.map((service) => <option key={service.key} value={service.key}>{service.label}</option>) : <option disabled value="">No entitled services</option>}</select><FieldError field="serviceKey" message={state.fieldErrors.serviceKey} /></label>
          <label><span>Period</span><input {...fieldA11y("periodKey")} defaultValue={initial?.periodKey} maxLength={60} name="periodKey" placeholder="August 2026 or Q2 · FY 2026–27" required /><FieldError field="periodKey" message={state.fieldErrors.periodKey} /></label>
        </div>
      </section>

      <section className="client-form-section">
        <div><p className="eyebrow">DEADLINES</p><h2>Due dates</h2><span>Internal due dates must not exceed the statutory deadline.</span></div>
        <div className="client-form-grid">
          <label><span>Statutory due date</span><input {...fieldA11y("statutoryDueDate")} defaultValue={initial?.statutoryDueDate} name="statutoryDueDate" required type="date" /><FieldError field="statutoryDueDate" message={state.fieldErrors.statutoryDueDate} /></label>
          <label><span>Internal due date</span><input {...fieldA11y("internalDueDate")} defaultValue={initial?.internalDueDate ?? ""} name="internalDueDate" type="date" /><FieldError field="internalDueDate" message={state.fieldErrors.internalDueDate} /></label>
          <label><span>Assignee</span><select {...fieldA11y("assigneeId")} defaultValue={initial?.assigneeId ?? ""} name="assigneeId"><option value="">Unassigned</option>{members.map((member) => <option key={member.id} value={member.id}>{member.fullName}</option>)}</select><FieldError field="assigneeId" message={state.fieldErrors.assigneeId} /></label>
          <label><span>Reviewer</span><select {...fieldA11y("reviewerId")} defaultValue={initial?.reviewerId ?? ""} name="reviewerId"><option value="">Not assigned</option>{members.map((member) => <option key={member.id} value={member.id}>{member.fullName}</option>)}</select><FieldError field="reviewerId" message={state.fieldErrors.reviewerId} /></label>
        </div>
      </section>

      <section className="client-form-section">
        <div><p className="eyebrow">WORKFLOW</p><h2>Delivery state</h2><span>Capture progress and any client dependency blocking completion.</span></div>
        <div className="client-form-grid">
          <label><span>Status</span><select {...fieldA11y("status")} defaultValue={initial?.status ?? "at_risk"} name="status">{workStatusOptions.map((status) => <option key={status} value={status}>{status.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase())}</option>)}</select><FieldError field="status" message={state.fieldErrors.status} /></label>
          <label><span>Progress (%)</span><input {...fieldA11y("progress")} defaultValue={initial?.progress ?? 0} max={99} min={0} name="progress" required type="number" /><FieldError field="progress" message={state.fieldErrors.progress} /></label>
          <label><span>Missing items</span><input {...fieldA11y("missingItemCount")} defaultValue={initial?.missingItemCount ?? 0} max={999} min={0} name="missingItemCount" required type="number" /><FieldError field="missingItemCount" message={state.fieldErrors.missingItemCount} /></label>
          <label><span>Budget (minutes)</span><input {...fieldA11y("budgetMinutes")} defaultValue={initial?.budgetMinutes ?? ""} max={100000} min={1} name="budgetMinutes" placeholder="From service standard" type="number" /><FieldError field="budgetMinutes" message={state.fieldErrors.budgetMinutes} /></label>
          <label className="client-form-wide"><span>Blocker / dependency note</span><textarea {...fieldA11y("blockerNote")} defaultValue={initial?.blockerNote} maxLength={500} name="blockerNote" placeholder="What is needed, from whom, and by when?" /><FieldError field="blockerNote" message={state.fieldErrors.blockerNote} /></label>
        </div>
      </section>

      {state.error && <p className="client-form-banner" role="alert">{state.error}</p>}
      <div className="client-form-actions"><button className="secondary-button" onClick={onCancel} type="button">Cancel</button><button className="primary-button" disabled={pending} type="submit">{pending ? "Saving…" : mode === "create" ? "Create work item" : "Save changes"}</button></div>
    </form>
  );
}
