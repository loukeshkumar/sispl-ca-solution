"use client";

import { useActionState } from "react";

import type { TaskActionState, TaskStatus } from "../../../lib/tasks/validation";
import { cancelTaskAction, completeTaskAction, reopenTaskAction, updateOwnTaskAction } from "../actions";

const initialState: TaskActionState = { error: "", fieldErrors: {} };

export function OwnTaskUpdate({ blockerNote, status, taskId }: { blockerNote: string; status: TaskStatus; taskId: string }) {
  const action = updateOwnTaskAction.bind(null, taskId);
  const [state, formAction, pending] = useActionState(action, initialState);
  return (
    <form action={formAction} className="own-task-update">
      <label><span>Update my task status</span><select defaultValue={["completed", "cancelled"].includes(status) ? "todo" : status} name="status"><option value="todo">To do</option><option value="in_progress">In progress</option><option value="waiting">Waiting</option><option value="review">Ready for review</option></select></label>
      <label><span>Blocker / handoff note</span><textarea aria-describedby={state.fieldErrors.blockerNote ? "self-blocker-error" : undefined} aria-invalid={Boolean(state.fieldErrors.blockerNote)} defaultValue={blockerNote} maxLength={500} name="blockerNote" /></label>
      {state.fieldErrors.blockerNote && <small className="client-form-error" id="self-blocker-error">{state.fieldErrors.blockerNote}</small>}
      {state.error && <p className="client-form-banner" role="alert">{state.error}</p>}
      <button className="primary-button" disabled={pending} type="submit">{pending ? "Updating..." : "Update status"}</button>
    </form>
  );
}

export function ManagerTaskActions({ active, taskId }: { active: boolean; taskId: string }) {
  if (!active) return <form action={reopenTaskAction}><input name="taskId" type="hidden" value={taskId} /><button className="primary-button" type="submit">Reopen task</button></form>;
  return <div className="task-terminal-actions"><form action={completeTaskAction}><input name="taskId" type="hidden" value={taskId} /><button className="success-button" type="submit">Mark complete</button></form><form action={cancelTaskAction} onSubmit={(event) => { if (!window.confirm("Cancel this task?")) event.preventDefault(); }}><input name="taskId" type="hidden" value={taskId} /><button className="danger-button" type="submit">Cancel task</button></form></div>;
}
