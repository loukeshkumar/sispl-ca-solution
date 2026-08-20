"use client";

import { useActionState, useState } from "react";

import type { WorkMemberOption } from "../../lib/work/repository";
import { applyBulkWorkAction, emptyBulkActionState } from "../work/bulk-actions";

const KINDS = [
  { key: "assignee", label: "Reassign" },
  { key: "reviewer", label: "Set reviewer" },
  { key: "internalDue", label: "Shift internal date" },
  { key: "status", label: "Change status" },
] as const;

// 'completed' is absent by design: completion requires progress 100 and no
// missing items, and closing statutory obligations from a checkbox list is the
// wrong affordance regardless of the constraint.
const STATUSES = [
  { key: "critical", label: "Critical" },
  { key: "at_risk", label: "At risk" },
  { key: "waiting", label: "Waiting" },
  { key: "review", label: "Review" },
] as const;

/**
 * Rendered outside the list, with the row checkboxes pointing at it through
 * `form="work-bulk-form"`. Nesting the list inside a form would put anchors and
 * a submit control in the same tree, which breaks row navigation.
 */
export function WorkBulkBar({ members }: { members: WorkMemberOption[] }) {
  const [state, action, pending] = useActionState(applyBulkWorkAction, emptyBulkActionState);
  const [kind, setKind] = useState<typeof KINDS[number]["key"]>("assignee");

  return (
    <form action={action} className="work-bulk-bar" id="work-bulk-form">
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
            <option value="">Unassigned</option>
            {members.map((member) => <option key={member.id} value={member.id}>{member.fullName}</option>)}
          </select>
        </label>
      )}
      {kind === "internalDue" && (
        <label><span>Shift by days</span><input defaultValue={-3} max={60} min={-60} name="shiftDays" type="number" /></label>
      )}
      {kind === "status" && (
        <label>
          <span>Status</span>
          <select name="status">{STATUSES.map((status) => <option key={status.key} value={status.key}>{status.label}</option>)}</select>
        </label>
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
