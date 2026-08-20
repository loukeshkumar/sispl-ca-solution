"use client";

import { useActionState, useState } from "react";

import { emptyTaskBulkActionState } from "../../lib/tasks/bulk";
import type { TaskMemberOption } from "./tasks-workspace";
import { applyBulkTaskAction } from "../tasks/bulk-actions";

const KINDS = [
  { key: "assignee", label: "Reassign" },
  { key: "reviewer", label: "Set reviewer" },
  { key: "priority", label: "Change priority" },
  { key: "dueDate", label: "Shift due date" },
  { key: "status", label: "Change status" },
] as const;

const PRIORITIES = [
  { key: "urgent", label: "Urgent" },
  { key: "high", label: "High" },
  { key: "normal", label: "Normal" },
  { key: "low", label: "Low" },
] as const;

// 'completed' and 'cancelled' are absent by design: both are terminal decisions
// with their own audited controls, and completion also has to stamp completed_at.
const STATUSES = [
  { key: "todo", label: "To do" },
  { key: "in_progress", label: "In progress" },
  { key: "waiting", label: "Waiting" },
  { key: "review", label: "Review" },
] as const;

/**
 * Rendered outside the list, with row checkboxes pointing at it through
 * `form="task-bulk-form"`. Nesting the list inside a form would put row anchors
 * and a submit control in the same tree.
 */
export function TaskBulkBar({ members }: { members: TaskMemberOption[] }) {
  const [state, action, pending] = useActionState(applyBulkTaskAction, emptyTaskBulkActionState);
  const [kind, setKind] = useState<typeof KINDS[number]["key"]>("assignee");

  return (
    <form action={action} className="work-bulk-bar" id="task-bulk-form">
      <label>
        <span>Bulk change</span>
        <select name="kind" onChange={(event) => setKind(event.target.value as typeof kind)} value={kind}>
          {KINDS.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
        </select>
      </label>

      {(kind === "assignee" || kind === "reviewer") && (
        <label>
          <span>Member</span>
          <select name="memberId">
            {kind === "reviewer" && <option value="">No reviewer</option>}
            {members.map((member) => <option key={member.id} value={member.id}>{member.fullName}</option>)}
          </select>
        </label>
      )}
      {kind === "priority" && (
        <label><span>Priority</span><select name="priority">{PRIORITIES.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}</select></label>
      )}
      {kind === "dueDate" && (
        <label><span>Shift by days</span><input defaultValue={3} max={60} min={-60} name="shiftDays" type="number" /></label>
      )}
      {kind === "status" && (
        <label><span>Status</span><select name="status">{STATUSES.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}</select></label>
      )}

      <button className="secondary-button" disabled={pending} type="submit">{pending ? "Applying…" : "Apply to selected"}</button>

      <p aria-live="polite" className={`work-bulk-result${state.error ? " is-error" : ""}`}>
        {state.error}
        {!state.error && state.applied > 0 && `${state.applied} updated`}
        {!state.error && state.skipped.length > 0 && `${state.applied > 0 ? " · " : ""}${state.skipped.length} skipped: ${state.skipped[0]!.reason}`}
      </p>
    </form>
  );
}
