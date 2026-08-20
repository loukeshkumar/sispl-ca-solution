"use client";

import { useActionState, useMemo, useState } from "react";

import { useCloseOnSuccess } from "../dashboard/form-dialog";
import type { WorkClientOption, WorkMemberOption } from "../../lib/work/repository";
import {
  bufferState,
  minutesLabel,
  periodPresets,
  servicePlaceholder,
  workStatusTone,
} from "../../lib/work/form-helpers";
import {
  workServiceLabel,
  workStatusOptions,
  type WorkActionState,
  type WorkInput,
} from "../../lib/work/validation";

type WorkFormAction = (state: WorkActionState, formData: FormData) => Promise<WorkActionState>;
const initialState: WorkActionState = { error: "", fieldErrors: {} };

const STATUS_LABEL = (status: string) => status.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const initialsOf = (value: string) => value.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]!.toUpperCase()).join("");

function FieldError({ field, message }: { field: string; message?: string }) {
  return message ? <small className="client-form-error" id={`${field}-error`}>{message}</small> : null;
}

/** The person currently chosen, rendered beside the label. A native select
 *  cannot draw an avatar inside its own options, so it sits alongside. */
function MemberChip({ member }: { member?: WorkMemberOption }) {
  if (!member) return null;
  return <span className="work-member-chip"><span aria-hidden="true">{initialsOf(member.fullName)}</span>{member.fullName}</span>;
}

export default function WorkForm({
  action,
  clients,
  initial,
  members,
  mode,
  onCancel,
  onSaved,
  todayKey,
  workItemId,
}: {
  action: WorkFormAction;
  clients: WorkClientOption[];
  initial?: Partial<WorkInput>;
  members: WorkMemberOption[];
  mode: "create" | "edit";
  onCancel: () => void;
  onSaved: () => void;
  todayKey: string;
  workItemId?: string;
}) {
  const [state, formAction, pending] = useActionState(action, initialState);
  const [clientId, setClientId] = useState(initial?.legalEntityId ?? "");
  const [period, setPeriod] = useState(initial?.periodKey ?? "");
  const [statutoryDueDate, setStatutoryDueDate] = useState(initial?.statutoryDueDate ?? "");
  const [internalDueDate, setInternalDueDate] = useState(initial?.internalDueDate ?? "");
  const [status, setStatus] = useState<string>(initial?.status ?? "at_risk");
  const [progress, setProgress] = useState(String(initial?.progress ?? 0));
  const [budget, setBudget] = useState(initial?.budgetMinutes ? String(initial.budgetMinutes) : "");
  const [assigneeId, setAssigneeId] = useState(initial?.assigneeId ?? "");
  const [reviewerId, setReviewerId] = useState(initial?.reviewerId ?? "");
  useCloseOnSuccess(pending, state, onSaved);

  const selectedClient = clients.find((client) => client.id === clientId);
  const availableServices = [...(selectedClient?.services ?? [])];
  if (initial?.serviceKey && !availableServices.some((service) => service.key === initial.serviceKey)) {
    availableServices.unshift({ key: initial.serviceKey, label: `${workServiceLabel(initial.serviceKey)} (existing work)` });
  }
  const emptyServiceMessage = servicePlaceholder(Boolean(clientId), availableServices.length);
  const buffer = bufferState(statutoryDueDate, internalDueDate);
  const presets = useMemo(() => periodPresets(todayKey), [todayKey]);
  const budgetReadout = minutesLabel(Number(budget) || null);
  const progressValue = Math.min(99, Math.max(0, Number(progress) || 0));
  const assignee = members.find((member) => member.id === assigneeId);
  const reviewer = members.find((member) => member.id === reviewerId);

  const fieldA11y = (field: keyof WorkActionState["fieldErrors"]) => state.fieldErrors[field]
    ? { "aria-describedby": `${field}-error`, "aria-invalid": true as const }
    : {};

  const summary = [
    availableServices.find((service) => service.key === (initial?.serviceKey ?? availableServices[0]?.key))?.label,
    selectedClient?.displayName,
    period,
  ].filter(Boolean).join(" · ");

  return (
    <form action={formAction} className="client-editor-form work-editor-form is-in-dialog">
      {workItemId && <input name="workItemId" type="hidden" value={workItemId} />}

      <section className="client-form-section work-form-section is-obligation">
        <div>
          <p className="eyebrow">OBLIGATION</p>
          <h2>Client and filing</h2>
          <span>Define the legal entity, compliance service, and filing period.</span>
        </div>
        <div className="client-form-grid">
          <label className="client-form-wide">
            <span>Client</span>
            <select {...fieldA11y("legalEntityId")} name="legalEntityId" onChange={(event) => setClientId(event.target.value)} required value={clientId}>
              <option disabled value="">Select active client</option>
              {clients.map((client) => <option key={client.id} value={client.id}>{client.displayName}</option>)}
            </select>
            <FieldError field="legalEntityId" message={state.fieldErrors.legalEntityId} />
          </label>

          <label>
            <span>Service / form</span>
            <select
              {...fieldA11y("serviceKey")}
              defaultValue={initial?.serviceKey ?? availableServices[0]?.key ?? ""}
              key={clientId}
              name="serviceKey"
              required
            >
              {availableServices.length
                ? availableServices.map((service) => <option key={service.key} value={service.key}>{service.label}</option>)
                : <option disabled value="">{emptyServiceMessage}</option>}
            </select>
            {/* Two causes, two different fixes — so they must not share a message. */}
            {emptyServiceMessage && <small className="work-form-hint">{emptyServiceMessage}</small>}
            <FieldError field="serviceKey" message={state.fieldErrors.serviceKey} />
          </label>

          <label>
            <span>Period</span>
            <input
              {...fieldA11y("periodKey")}
              maxLength={60}
              name="periodKey"
              onChange={(event) => setPeriod(event.target.value)}
              placeholder="August 2026 or Q2 - FY 2026-27"
              required
              value={period}
            />
            <span className="work-period-presets">
              {presets.map((preset) => (
                <button key={preset.key} onClick={() => setPeriod(preset.value)} type="button">{preset.label}</button>
              ))}
            </span>
            <FieldError field="periodKey" message={state.fieldErrors.periodKey} />
          </label>
        </div>
      </section>

      <section className="client-form-section work-form-section is-deadlines">
        <div>
          <p className="eyebrow">DEADLINES</p>
          <h2>Due dates</h2>
          <span>Internal due dates must not exceed the statutory deadline.</span>
        </div>
        <div className="client-form-grid">
          <label>
            <span>Statutory due date</span>
            <input {...fieldA11y("statutoryDueDate")} name="statutoryDueDate" onChange={(event) => setStatutoryDueDate(event.target.value)} required type="date" value={statutoryDueDate} />
            <FieldError field="statutoryDueDate" message={state.fieldErrors.statutoryDueDate} />
          </label>
          <label>
            <span>Internal due date</span>
            <input {...fieldA11y("internalDueDate")} name="internalDueDate" onChange={(event) => setInternalDueDate(event.target.value)} type="date" value={internalDueDate} />
            <FieldError field="internalDueDate" message={state.fieldErrors.internalDueDate} />
          </label>

          {/* The database enforces the ordering too, but a check constraint only
              speaks after a round trip. */}
          <p aria-live="polite" className={`work-buffer-pill is-${buffer.tone} client-form-wide`}>
            {buffer.tone !== "none" && buffer.label}
          </p>

          <label>
            <span>Assignee <MemberChip member={assignee} /></span>
            <select {...fieldA11y("assigneeId")} name="assigneeId" onChange={(event) => setAssigneeId(event.target.value)} value={assigneeId}>
              <option value="">Unassigned</option>
              {members.map((member) => <option key={member.id} value={member.id}>{member.fullName}</option>)}
            </select>
            <FieldError field="assigneeId" message={state.fieldErrors.assigneeId} />
          </label>
          <label>
            <span>Reviewer <MemberChip member={reviewer} /></span>
            <select {...fieldA11y("reviewerId")} name="reviewerId" onChange={(event) => setReviewerId(event.target.value)} value={reviewerId}>
              <option value="">Not assigned</option>
              {members.map((member) => <option key={member.id} value={member.id}>{member.fullName}</option>)}
            </select>
            <FieldError field="reviewerId" message={state.fieldErrors.reviewerId} />
          </label>
        </div>
      </section>

      <section className="client-form-section work-form-section is-workflow">
        <div>
          <p className="eyebrow">WORKFLOW</p>
          <h2>Delivery state</h2>
          <span>Capture progress and any client dependency blocking completion.</span>
        </div>
        <div className="client-form-grid">
          <label>
            <span>Status</span>
            {/* Tinted to the badge this will produce, so the outcome is visible
                before it is committed. */}
            <select
              {...fieldA11y("status")}
              className={`work-status-select is-${workStatusTone(status)}`}
              name="status"
              onChange={(event) => setStatus(event.target.value)}
              value={status}
            >
              {workStatusOptions.map((option) => <option key={option} value={option}>{STATUS_LABEL(option)}</option>)}
            </select>
            <FieldError field="status" message={state.fieldErrors.status} />
          </label>

          <label>
            <span>Progress (%)</span>
            <input {...fieldA11y("progress")} max={99} min={0} name="progress" onChange={(event) => setProgress(event.target.value)} required type="number" value={progress} />
            {/* Capped at 99: open work cannot claim completion from this form. */}
            <span className="work-progress-meter"><i style={{ width: `${progressValue}%` }} /></span>
            <FieldError field="progress" message={state.fieldErrors.progress} />
          </label>

          <label>
            <span>Missing items</span>
            <input {...fieldA11y("missingItemCount")} defaultValue={initial?.missingItemCount ?? 0} max={999} min={0} name="missingItemCount" required type="number" />
            <FieldError field="missingItemCount" message={state.fieldErrors.missingItemCount} />
          </label>

          <label>
            <span>Budget (minutes)</span>
            <input {...fieldA11y("budgetMinutes")} max={100000} min={1} name="budgetMinutes" onChange={(event) => setBudget(event.target.value)} placeholder="From service standard" type="number" value={budget} />
            <small aria-live="polite" className="work-form-hint">{budgetReadout || "Defaults to the service standard"}</small>
            <FieldError field="budgetMinutes" message={state.fieldErrors.budgetMinutes} />
          </label>

          <label className="client-form-wide">
            <span>Blocker / dependency note</span>
            <textarea {...fieldA11y("blockerNote")} defaultValue={initial?.blockerNote} maxLength={500} name="blockerNote" placeholder="What is needed, from whom, and by when?" />
            <FieldError field="blockerNote" message={state.fieldErrors.blockerNote} />
          </label>
        </div>
      </section>

      {state.error && <p className="client-form-banner" role="alert">{state.error}</p>}

      <p aria-live="polite" className="work-form-summary">
        {summary
          ? <>
            <strong>{summary}</strong>
            {buffer.tone !== "none" && <em className={`is-${buffer.tone}`}>{buffer.label}</em>}
            {assignee && <em>{assignee.fullName}</em>}
          </>
          : <span>Choose a client and period to preview this obligation.</span>}
      </p>

      <div className="client-form-actions">
        <button className="secondary-button" onClick={onCancel} type="button">Cancel</button>
        <button className="primary-button work-form-submit" disabled={pending} type="submit">
          {pending ? "Saving…" : mode === "create" ? "Create work item" : "Save changes"}
        </button>
      </div>
    </form>
  );
}
