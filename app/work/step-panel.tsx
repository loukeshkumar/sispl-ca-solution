"use client";

import { useActionState, useState } from "react";

import { deriveProgress, progressLabel, STEP_LABELS, type StepStatus } from "../../lib/procedures/steps";
import type { WorkStepRow } from "../../lib/procedures/repository";
import { StatusBadge } from "../dashboard/dashboard-ui";
import { setStepStatusAction, type StepActionState } from "./step-actions";

const initialState: StepActionState = { error: "", fieldErrors: {} };

const formatStamp = (value: string | null) => (value
  ? new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" }).format(new Date(value))
  : "");

const STATUS_TONE: Record<StepStatus, "mint" | "neutral" | "blue"> = {
  done: "mint",
  pending: "neutral",
  not_applicable: "blue",
};

/**
 * The procedure as performed on one obligation.
 *
 * Progress used to be a number somebody typed, which could say 60% on a job
 * nobody had started. It is now the count of these rows, and each one records
 * who settled it and when.
 */
export function StepPanel({ canWrite, locked, steps }: { canWrite: boolean; locked: boolean; steps: WorkStepRow[] }) {
  const [state, act, pending] = useActionState(setStepStatusAction, initialState);
  const [skipping, setSkipping] = useState<string | null>(null);

  if (steps.length === 0) {
    return (
      <section className="surface-card step-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">PROCEDURE</p>
            <h2>No procedure for this service</h2>
            <span>
              Progress on this obligation is typed by hand. Publish a procedure for the service and work raised from
              then on will carry it.
            </span>
          </div>
        </div>
      </section>
    );
  }

  const progress = deriveProgress(steps);

  return (
    <section className="surface-card step-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">PROCEDURE</p>
          <h2>Steps performed</h2>
          <span>
            {progressLabel(progress)} · {progress.percent}% counted
            {progress.outstandingMandatory > 0 && ` · ${progress.outstandingMandatory} mandatory outstanding`}
          </span>
        </div>
      </div>

      {state.error && <p className="client-form-banner" role="alert">{state.error}</p>}
      {locked && <p className="step-locked">This obligation is complete, so its procedure record is closed.</p>}

      <ol className="step-list">
        {steps.map((step) => (
          <li className={`step-row is-${step.status}`} key={step.id}>
            <span className="step-position">{step.position}</span>
            <span className="step-body">
              <strong>{step.title}{!step.mandatory && <em className="step-optional"> · optional</em>}</strong>
              {step.instruction && <small>{step.instruction}</small>}
              {step.status !== "pending" && (
                <small className="step-signature">
                  {STEP_LABELS[step.status]} · {step.completedByName ?? "—"} · {formatStamp(step.completedAt)}
                  {step.note ? ` · ${step.note}` : ""}
                </small>
              )}
            </span>

            {canWrite && !locked ? (
              <span className="step-actions">
                {step.status === "pending" ? (
                  <>
                    <form action={act}>
                      <input name="stepId" type="hidden" value={step.id} />
                      <input name="status" type="hidden" value="done" />
                      <input name="note" type="hidden" value="" />
                      <button className="step-tick" disabled={pending} type="submit">Mark done</button>
                    </form>
                    <button className="step-skip" onClick={() => setSkipping(skipping === step.id ? null : step.id)} type="button">
                      Not applicable
                    </button>
                  </>
                ) : (
                  <form action={act}>
                    <input name="stepId" type="hidden" value={step.id} />
                    <input name="status" type="hidden" value="pending" />
                    <input name="note" type="hidden" value="" />
                    <button className="step-undo" disabled={pending} type="submit">Undo</button>
                  </form>
                )}
              </span>
            ) : (
              <StatusBadge tone={STATUS_TONE[step.status]}>{STEP_LABELS[step.status]}</StatusBadge>
            )}

            {skipping === step.id && canWrite && !locked && (
              <form action={act} className="step-skip-form">
                <input name="stepId" type="hidden" value={step.id} />
                <input name="status" type="hidden" value="not_applicable" />
                <label>
                  <span>Why this step does not apply</span>
                  <input
                    maxLength={1000}
                    minLength={3}
                    name="note"
                    placeholder="A step skipped without a reason cannot be told from one forgotten"
                    required
                    type="text"
                  />
                </label>
                <button className="secondary-button" disabled={pending} type="submit">Record</button>
              </form>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
