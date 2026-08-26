"use client";

import { useActionState, useState } from "react";

import {
  CAPABILITY_DESCRIPTIONS,
  CAPABILITY_LABELS,
  CAPABILITY_LEVELS,
  type CapabilityLevel,
} from "../../lib/team/capability";
import type { CapabilityView, ServiceOption } from "../../lib/team/capability-repository";
import { removeCapabilityAction, saveCapabilityAction, type CapabilityActionState } from "./capability-actions";

const initialState: CapabilityActionState = { error: "", fieldErrors: {} };

const formatDate = (value: string) => new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "UTC" })
  .format(new Date(`${value}T00:00:00Z`));

/**
 * What one person is trusted to do, and the means to change it.
 *
 * Every row says who judged it and when, because a capability with no author is
 * a rumour — and the reviewer gate on work assignment leans on these rows, so
 * they need to be answerable.
 */
export function CapabilityPanel({
  canManage,
  capabilities,
  employeeUserId,
  evidence,
  isSelf,
  services,
}: {
  canManage: boolean;
  capabilities: CapabilityView[];
  employeeUserId: string;
  /**
   * Training logged against each service. Shown beside the rating as what it is
   * — evidence somebody considered — and never as a substitute for the
   * judgement, which is what a rating is.
   */
  evidence: Record<string, Array<{ completedOn: string; minutes: number; title: string }>>;
  /** Nobody assesses themselves, so the editor is hidden rather than teasing. */
  isSelf: boolean;
  services: ServiceOption[];
}) {
  const [saveState, save, saving] = useActionState(saveCapabilityAction, initialState);
  const [removeState, remove, removing] = useActionState(removeCapabilityAction, initialState);
  const [serviceCode, setServiceCode] = useState("");
  const [level, setLevel] = useState<CapabilityLevel>("prepare");

  const recorded = new Set(capabilities.map((entry) => entry.serviceCode));
  const unrecorded = services.filter((service) => !recorded.has(service.code));
  const error = saveState.error || removeState.error;

  return (
    <section className="surface-card capability-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">CAPABILITY</p>
          <h2>Trusted to do</h2>
          <span>Recorded against the firm&apos;s service master. A reviewer must be rated to review the service they sign off.</span>
        </div>
      </div>

      {error && <p className="client-form-banner" role="alert">{error}</p>}

      {capabilities.length === 0 ? (
        // On your own record the self-assessment note below already explains the
        // emptiness; two messages saying overlapping things reads as a glitch.
        isSelf ? null : <p className="capability-empty">Nothing recorded yet. Until a service has a rated reviewer, work on it accepts any reviewer.</p>
      ) : (
        <ul className="capability-list">
          {capabilities.map((entry) => (
            <li className={`capability-row is-${entry.level}`} key={entry.serviceCode}>
              <span>
                <strong>{entry.serviceName}</strong>
                <small>{entry.serviceCode}{entry.note ? ` · ${entry.note}` : ""}</small>
                {(evidence[entry.serviceCode] ?? []).slice(0, 2).map((session) => (
                  <small className="capability-evidence" key={`${session.title}-${session.completedOn}`}>
                    {session.title} · {(session.minutes / 60).toFixed(1)}h · {formatDate(session.completedOn)}
                  </small>
                ))}
              </span>
              <span className="capability-level">
                <strong>{CAPABILITY_LABELS[entry.level]}</strong>
                <small>{entry.assessedByName} · {formatDate(entry.assessedOn)}</small>
              </span>
              {canManage && !isSelf && (
                <form action={remove}>
                  <input name="employeeUserId" type="hidden" value={employeeUserId} />
                  <input name="serviceCode" type="hidden" value={entry.serviceCode} />
                  <button className="capability-withdraw" disabled={removing} type="submit">Withdraw</button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}

      {canManage && !isSelf && (
        <form action={save} className="capability-form">
          <input name="employeeUserId" type="hidden" value={employeeUserId} />
          <label>
            <span>Service</span>
            <select name="serviceCode" onChange={(event) => setServiceCode(event.target.value)} required value={serviceCode}>
              <option value="">Choose a service</option>
              {unrecorded.length > 0 && (
                <optgroup label="Not yet recorded">
                  {unrecorded.map((service) => <option key={service.code} value={service.code}>{service.name}</option>)}
                </optgroup>
              )}
              {recorded.size > 0 && (
                <optgroup label="Revise an existing rating">
                  {services.filter((service) => recorded.has(service.code))
                    .map((service) => <option key={service.code} value={service.code}>{service.name}</option>)}
                </optgroup>
              )}
            </select>
          </label>
          <label>
            <span>Level</span>
            <select name="level" onChange={(event) => setLevel(event.target.value as CapabilityLevel)} value={level}>
              {CAPABILITY_LEVELS.map((value) => <option key={value} value={value}>{CAPABILITY_LABELS[value]}</option>)}
            </select>
            <small>{CAPABILITY_DESCRIPTIONS[level]}</small>
          </label>
          <label className="capability-note">
            <span>Note (optional)</span>
            <input maxLength={500} name="note" placeholder="What this judgement is based on" type="text" />
          </label>
          <button className="secondary-button" disabled={saving || !serviceCode} type="submit">
            {saving ? "Recording…" : "Record capability"}
          </button>
        </form>
      )}

      {canManage && isSelf && (
        <p className="capability-empty">You cannot assess your own capability. Another partner or manager records this.</p>
      )}
    </section>
  );
}
