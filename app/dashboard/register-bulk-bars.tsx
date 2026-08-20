"use client";

import { useActionState, useState } from "react";

import { emptyRegisterBulkState } from "../../lib/registers/bulk";
import { applyBulkDscAction, applyBulkNoticeAction } from "../registers/bulk-actions";

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
