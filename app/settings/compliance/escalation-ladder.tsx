"use client";

import { useActionState, useState } from "react";

import {
  ANCHOR_LABELS,
  EMPTY_LADDER_NOTE,
  ESCALATION_ROLES,
  ROLE_LABELS,
  rungSummary,
} from "../../../lib/escalation/ladder";
import type { EscalationRuleRow } from "../../../lib/escalation/repository";
import { StatusBadge } from "../../dashboard/dashboard-ui";
import {
  addEscalationRungAction,
  archiveEscalationRungAction,
  type EscalationActionState,
} from "./escalation-actions";

const initialState: EscalationActionState = { error: "", notice: "" };

/**
 * The rungs a late obligation climbs.
 *
 * Ordered by rung, because the order is the whole meaning: the ladder is read
 * downwards as "and if that does not work, then this".
 */
export function EscalationLadder({
  canManage,
  rules,
}: {
  canManage: boolean;
  rules: EscalationRuleRow[];
}) {
  const [addState, add, adding] = useActionState(addEscalationRungAction, initialState);
  const [archiveState, archive, archiving] = useActionState(archiveEscalationRungAction, initialState);
  const [targetKind, setTargetKind] = useState("role");
  const [open, setOpen] = useState(false);

  const error = addState.error || archiveState.error;
  const notice = addState.notice || archiveState.notice;
  const nextRung = rules.length === 0 ? 1 : Math.max(...rules.map((rule) => rule.rung)) + 1;


  return (
    <section className="surface-card escalation-ladder">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">ESCALATION LADDER</p>
          <h2>{rules.length === 0 ? "Nothing escalates" : `${rules.length} rung${rules.length === 1 ? "" : "s"}`}</h2>
          <span>
            {rules.length === 0
              ? EMPTY_LADDER_NOTE
              : "A rung tells its audience and writes down that it did. Nothing is reassigned — who should hold a late filing is a judgement."}
          </span>
        </div>
        {canManage && (
          <button className="secondary-button" onClick={() => setOpen(!open)} type="button">
            {open ? "Cancel" : "Add a rung"}
          </button>
        )}
      </div>

      {error && <p className="client-form-banner" role="alert">{error}</p>}
      {notice && <p className="client-form-notice">{notice}</p>}

      {rules.length > 0 && (
        <ol className="escalation-rung-list">
          {rules.map((rule) => (
            <li className={`escalation-rung is-${rule.targetKind}`} key={rule.id}>
              <div className="escalation-rung-head">
                <strong>Rung {rule.rung}</strong>
                <span>{rule.label}</span>
                <StatusBadge tone={rule.targetKind === "assignee" ? "slate" : "amber"}>
                  {rule.targetKind === "assignee" ? "The assignee" : ROLE_LABELS[rule.targetRole!]}
                </StatusBadge>
              </div>
              <small className="escalation-rung-line">{rungSummary(rule)}</small>
              {canManage && (
                <form action={archive} className="escalation-rung-remove">
                  <input name="ruleId" type="hidden" value={rule.id} />
                  <button className="secondary-button" disabled={archiving} type="submit">Remove</button>
                </form>
              )}
            </li>
          ))}
        </ol>
      )}

      {canManage && open && (
        <form action={add} className="escalation-rung-form">
          <label>
            <span>Rung</span>
            <input defaultValue={nextRung} max={20} min={1} name="rung" required type="number" />
          </label>
          <label>
            <span>Counting from</span>
            <select defaultValue="internal_due" name="anchor">
              <option value="internal_due">The {ANCHOR_LABELS.internal_due}</option>
              <option value="statutory_due">The {ANCHOR_LABELS.statutory_due}</option>
            </select>
          </label>
          <label>
            <span>Days (negative is before)</span>
            <input defaultValue={0} max={60} min={-60} name="offsetDays" required type="number" />
          </label>
          <label>
            <span>Who hears</span>
            <select name="targetKind" onChange={(event) => setTargetKind(event.target.value)} value={targetKind}>
              <option value="role">A role</option>
              <option value="assignee">Whoever holds it</option>
            </select>
          </label>
          {targetKind === "role" && (
            <label>
              <span>Which role</span>
              <select defaultValue="manager" name="targetRole" required>
                {ESCALATION_ROLES.map((role) => <option key={role} value={role}>{ROLE_LABELS[role]}</option>)}
              </select>
            </label>
          )}
          <label className="escalation-rung-form-wide">
            <span>What this rung means</span>
            <input maxLength={120} minLength={3} name="label" placeholder="Internal deadline passed" required type="text" />
          </label>
          <button className="primary-button" disabled={adding} type="submit">
            {adding ? "Adding…" : "Add rung"}
          </button>
        </form>
      )}
    </section>
  );
}
