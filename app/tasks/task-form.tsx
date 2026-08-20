"use client";

import { useActionState, useMemo, useState } from "react";

import { useCloseOnSuccess } from "../dashboard/form-dialog";

import type { OfficeTaskInput, TaskActionState } from "../../lib/tasks/validation";

type TaskFormAction = (state: TaskActionState, formData: FormData) => Promise<TaskActionState>;
type TaskOptions = Awaited<ReturnType<typeof import("../../lib/tasks/repository").listTaskFormOptions>>;
const initialState: TaskActionState = { error: "", fieldErrors: {} };

export default function TaskForm({ action, initial, mode, onCancel, onSaved, options, taskId }: { action: TaskFormAction; initial?: Partial<OfficeTaskInput>; mode: "create" | "edit"; onCancel: () => void; onSaved: () => void; options: TaskOptions; taskId?: string }) {
  const [state, formAction, pending] = useActionState(action, initialState);
  useCloseOnSuccess(pending, state, onSaved);
  const [clientId, setClientId] = useState(initial?.legalEntityId ?? "");
  const [workItemId, setWorkItemId] = useState(initial?.workItemId ?? "");
  const availableWork = useMemo(() => clientId ? options.work.filter((item) => item.legalEntityId === clientId) : options.work, [clientId, options.work]);
  const fieldA11y = (field: keyof TaskActionState["fieldErrors"]) => state.fieldErrors[field] ? { "aria-describedby": `${field}-error`, "aria-invalid": true as const } : {};
  const error = (field: keyof TaskActionState["fieldErrors"]) => state.fieldErrors[field] ? <small className="client-form-error" id={`${field}-error`}>{state.fieldErrors[field]}</small> : null;

  return (
    <form action={formAction} className="client-editor-form task-editor-form is-in-dialog">
      {taskId && <input name="taskId" type="hidden" value={taskId} />}
      <section className="client-form-section">
        <div><p className="eyebrow">TASK DEFINITION</p><h2>Assignment and outcome</h2><span>Give the assignee a clear outcome, due date, reviewer, and business context.</span></div>
        <div className="client-form-grid">
          <label className="client-form-wide"><span>Task title</span><input {...fieldA11y("title")} defaultValue={initial?.title} maxLength={160} name="title" placeholder="Prepare GST reconciliation exceptions" required />{error("title")}</label>
          <label className="client-form-wide"><span>Description</span><textarea {...fieldA11y("description")} defaultValue={initial?.description} maxLength={1500} name="description" placeholder="Expected outcome, supporting details, and completion criteria." />{error("description")}</label>
          <label><span>Assignee</span><select {...fieldA11y("assigneeId")} defaultValue={initial?.assigneeId ?? ""} name="assigneeId" required><option disabled value="">Select employee</option>{options.members.map((member) => <option key={member.id} value={member.id}>{member.fullName}</option>)}</select>{error("assigneeId")}</label>
          <label><span>Reviewer</span><select {...fieldA11y("reviewerId")} defaultValue={initial?.reviewerId ?? ""} name="reviewerId"><option value="">No reviewer</option>{options.members.map((member) => <option key={member.id} value={member.id}>{member.fullName}</option>)}</select>{error("reviewerId")}</label>
          <label><span>Priority</span><select {...fieldA11y("priority")} defaultValue={initial?.priority ?? "normal"} name="priority"><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></select>{error("priority")}</label>
          <label><span>Due date</span><input {...fieldA11y("dueDate")} defaultValue={initial?.dueDate} name="dueDate" required type="date" />{error("dueDate")}</label>
          <label><span>Estimate (minutes)</span><input {...fieldA11y("estimateMinutes")} defaultValue={initial?.estimateMinutes ?? ""} max={100000} min={1} name="estimateMinutes" placeholder="Not estimated" type="number" />{error("estimateMinutes")}</label>
          <label><span>Client context</span><select {...fieldA11y("legalEntityId")} name="legalEntityId" onChange={(event) => { setClientId(event.target.value); setWorkItemId(""); }} value={clientId}><option value="">General office task</option>{options.clients.map((client) => <option key={client.id} value={client.id}>{client.label}</option>)}</select>{error("legalEntityId")}</label>
          <label><span>Compliance work</span><select {...fieldA11y("workItemId")} name="workItemId" onChange={(event) => { const next = event.target.value; setWorkItemId(next); const work = options.work.find((item) => item.id === next); if (work) setClientId(work.legalEntityId); }} value={workItemId}><option value="">No linked compliance work</option>{availableWork.map((work) => <option key={work.id} value={work.id}>{work.label}</option>)}</select>{error("workItemId")}</label>
          <input name="status" type="hidden" value={mode === "edit" ? initial?.status ?? "todo" : "todo"} />
          <input name="blockerNote" type="hidden" value={mode === "edit" ? initial?.blockerNote ?? "" : ""} />
        </div>
      </section>
      {state.error && <p className="client-form-banner" role="alert">{state.error}</p>}
      <div className="client-form-actions"><button className="secondary-button" onClick={onCancel} type="button">Cancel</button><button className="primary-button" disabled={pending} type="submit">{pending ? "Saving..." : mode === "create" ? "Assign task" : "Save task"}</button></div>
    </form>
  );
}
