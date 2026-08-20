"use client";

import { useActionState, useState } from "react";

import { emptyTodoBulkActionState } from "../../lib/todos/bulk";
import { applyBulkTodoAction } from "../todos/bulk-actions";

// No reassign: a personal to-do has one owner and there is nobody to hand it to.
const KINDS = [
  { key: "complete", label: "Mark complete" },
  { key: "reopen", label: "Reopen" },
  { key: "archive", label: "Archive" },
  { key: "reschedule", label: "Reschedule" },
  { key: "priority", label: "Change priority" },
  { key: "category", label: "Set category" },
] as const;

const PRIORITIES = [
  { key: "urgent", label: "Urgent" },
  { key: "high", label: "High" },
  { key: "normal", label: "Normal" },
  { key: "low", label: "Low" },
] as const;

/**
 * Rendered outside the list, with row checkboxes pointing at it through
 * `form="todo-bulk-form"` — the rows already contain their own action forms, and
 * forms cannot nest.
 */
export function TodoBulkBar({ categories }: { categories: string[] }) {
  const [state, action, pending] = useActionState(applyBulkTodoAction, emptyTodoBulkActionState);
  const [kind, setKind] = useState<typeof KINDS[number]["key"]>("complete");

  return (
    <form action={action} className="work-bulk-bar" id="todo-bulk-form">
      <label>
        <span>Bulk change</span>
        <select name="kind" onChange={(event) => setKind(event.target.value as typeof kind)} value={kind}>
          {KINDS.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
        </select>
      </label>

      {kind === "reschedule" && (
        <label><span>Shift by days</span><input defaultValue={7} max={365} min={-365} name="shiftDays" type="number" /></label>
      )}
      {kind === "priority" && (
        <label><span>Priority</span><select name="priority">{PRIORITIES.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}</select></label>
      )}
      {kind === "category" && (
        <label>
          <span>Category</span>
          <input defaultValue="" list="todo-bulk-categories" maxLength={40} name="category" placeholder="Leave blank to clear" type="text" />
          <datalist id="todo-bulk-categories">{categories.map((item) => <option key={item} value={item} />)}</datalist>
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
