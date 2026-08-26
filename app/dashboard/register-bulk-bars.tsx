"use client";

import { useActionState, useCallback, useEffect, useState } from "react";

import { emptyRegisterBulkState } from "../../lib/registers/bulk";
import { applyBulkDscAction, applyBulkNoticeAction } from "../registers/bulk-actions";

/**
 * Select-all for the rows currently on screen, plus a live count.
 *
 * Rows sit inside urgency groups and belong to the bulk form through the
 * `form` attribute rather than by nesting, so the checkboxes are found by that
 * association. Only the visible page is ever selected: a control that silently
 * reached rows the reader could not see would make a bulk change unreviewable.
 */
export function RegisterSelection({ formId, name }: { formId: string; name: string }) {
  const [selected, setSelected] = useState(0);
  const [total, setTotal] = useState(0);

  const boxes = useCallback(
    () => [...document.querySelectorAll<HTMLInputElement>(`input[type="checkbox"][form="${formId}"][name="${name}"]`)],
    [formId, name],
  );

  useEffect(() => {
    const sync = () => {
      const all = boxes();
      setTotal(all.length);
      setSelected(all.filter((box) => box.checked).length);
    };
    sync();
    document.addEventListener("change", sync);
    return () => document.removeEventListener("change", sync);
  }, [boxes]);

  const toggle = (checked: boolean) => {
    const all = boxes();
    for (const box of all) box.checked = checked;
    setSelected(checked ? all.length : 0);
  };

  if (total === 0) return null;
  return (
    <div className="register-selection-bar">
      <label>
        <input
          aria-label={`Select all ${total} rows on this page`}
          checked={selected > 0 && selected === total}
          onChange={(event) => toggle(event.target.checked)}
          // Some but not all selected reads as neither on nor off.
          ref={(node) => { if (node) node.indeterminate = selected > 0 && selected < total; }}
          type="checkbox"
        />
        <span>Select all on this page</span>
      </label>
      <span aria-live="polite">{selected === 0 ? `${total} rows` : `${selected} of ${total} selected`}</span>
    </div>
  );
}

/** Matches the shape register form options already provide. */
type Member = { id: string; name: string };

const NOTICE_STATUSES = [
  { key: "open", label: "Open" },
  { key: "in_progress", label: "In progress" },
  { key: "responded", label: "Responded" },
  { key: "closed", label: "Closed" },
] as const;

const MOVEMENTS = [
  { key: "issued_out", label: "Sign out" },
  { key: "returned", label: "Return to custody" },
  { key: "surrendered", label: "Surrender" },
] as const;

function Result({ state }: { state: typeof emptyRegisterBulkState }) {
  return (
    <p aria-live="polite" className={`work-bulk-result${state.error ? " is-error" : ""}`}>
      {state.error}
      {!state.error && state.applied > 0 && `${state.applied} updated`}
      {!state.error && state.skipped.length > 0 && `${state.applied > 0 ? " · " : ""}${state.skipped.length} skipped: ${state.skipped[0]!.reason}`}
    </p>
  );
}

export function NoticeBulkBar({ members }: { members: Member[] }) {
  const [state, action, pending] = useActionState(applyBulkNoticeAction, emptyRegisterBulkState);
  const [kind, setKind] = useState<"status" | "assignee">("status");
  return (
    <form action={action} className="work-bulk-bar" id="notice-bulk-form">
      <label>
        <span>Bulk change</span>
        <select name="kind" onChange={(event) => setKind(event.target.value as typeof kind)} value={kind}>
          <option value="status">Change status</option>
          <option value="assignee">Reassign</option>
        </select>
      </label>
      {kind === "status"
        ? <label><span>Status</span><select name="status">{NOTICE_STATUSES.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}</select></label>
        : (
          <label>
            <span>Owner</span>
            <select name="memberId"><option value="">Unassigned</option>{members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select>
          </label>
        )}
      <button className="secondary-button" disabled={pending} type="submit">{pending ? "Applying…" : "Apply to selected"}</button>
      <Result state={state} />
    </form>
  );
}

export function DscBulkBar({ members }: { members: Member[] }) {
  const [state, action, pending] = useActionState(applyBulkDscAction, emptyRegisterBulkState);
  const [eventType, setEventType] = useState<typeof MOVEMENTS[number]["key"]>("issued_out");
  return (
    <form action={action} className="work-bulk-bar" id="dsc-bulk-form">
      <label>
        <span>Custody movement</span>
        <select name="eventType" onChange={(event) => setEventType(event.target.value as typeof eventType)} value={eventType}>
          {MOVEMENTS.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
        </select>
      </label>
      {/* Returning a certificate must name who is taking it back; the register
          is a custody chain, and an unattributed link breaks it. */}
      {eventType === "returned" && (
        <label>
          <span>Custodian</span>
          <select name="custodianUserId" required>
            <option value="">Select</option>
            {members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
          </select>
        </label>
      )}
      <label><span>Counterparty</span><input maxLength={120} name="counterpartyName" placeholder="Who or where" type="text" /></label>
      <button className="secondary-button" disabled={pending} type="submit">{pending ? "Applying…" : "Apply to selected"}</button>
      <Result state={state} />
    </form>
  );
}
