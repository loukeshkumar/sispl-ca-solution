"use client";

import { useActionState, useState } from "react";

import { PROCEDURE_LABELS, PROCEDURE_TONE } from "../../../lib/procedures/steps";
import type { ProcedureStepRow, ProcedureVersionRow } from "../../../lib/procedures/repository";
import { EmptyState, StatusBadge } from "../../dashboard/dashboard-ui";
import {
  archiveProcedureAction,
  draftProcedureAction,
  publishProcedureAction,
  reviseDraftAction,
  type ProcedureActionState,
} from "./actions";

const initialState: ProcedureActionState = { error: "", fieldErrors: {} };

const formatDate = (value: string) => new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "UTC" })
  .format(new Date(`${value}T00:00:00Z`));

/** Steps back into the one-per-line shape they were written in. */
const asLines = (steps: ProcedureStepRow[]) => steps
  .map((step) => `${step.title}${step.instruction ? ` — ${step.instruction}` : ""}${step.mandatory ? "" : " (optional)"}`)
  .join("\n");

/**
 * Authoring the procedures the firm follows.
 *
 * Versioned rather than editable: a published procedure is what some month's
 * work was measured against, so changing it means drafting a new version. Work
 * already raised keeps the copy it was given.
 */
export function ProcedureEditor({
  canManage,
  procedures,
  services,
  stepsByVersion,
  todayKey,
  uncovered,
}: {
  canManage: boolean;
  procedures: ProcedureVersionRow[];
  services: Array<{ code: string; name: string }>;
  stepsByVersion: Record<string, ProcedureStepRow[]>;
  todayKey: string;
  uncovered: Array<{ code: string; name: string }>;
}) {
  const [draftState, draft, drafting] = useActionState(draftProcedureAction, initialState);
  const [reviseState, revise, revising] = useActionState(reviseDraftAction, initialState);
  const [publishState, publish, publishing] = useActionState(publishProcedureAction, initialState);
  const [archiveState, archive, archiving] = useActionState(archiveProcedureAction, initialState);
  const [openId, setOpenId] = useState<string | null>(null);

  const error = draftState.error || reviseState.error || publishState.error || archiveState.error;

  return (
    <>
      {error && <p className="package-form-banner" role="alert">{error}</p>}

      {/*
        * Coverage is a ratio, so it is drawn as one. The uncovered services are
        * named as chips rather than a comma list: a firm with a dozen of them
        * had a sentence nobody could scan.
        */}
      {services.length > 0 && (
        <section className={`procedure-coverage${uncovered.length === 0 ? " is-complete" : ""}`} role="status">
          <div className="procedure-coverage-head">
            <strong>{services.length - uncovered.length} of {services.length} services have a published procedure</strong>
            <b>{Math.round(((services.length - uncovered.length) / services.length) * 100)}%</b>
          </div>
          <span className="procedure-coverage-bar">
            <i style={{ width: `${((services.length - uncovered.length) / services.length) * 100}%` }} />
          </span>
          {uncovered.length > 0 ? (
            <p>
              <span>Still typed by hand:</span>
              {uncovered.map((service) => <b key={service.code}>{service.name}</b>)}
            </p>
          ) : (
            <p><span>Every service records what was actually done rather than a typed figure.</span></p>
          )}
        </section>
      )}

      <section className="surface-card procedure-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">PROCEDURES</p>
            <h2>What the firm does, service by service</h2>
            <span>{procedures.length === 0 ? "Nothing written yet." : `${procedures.length} version${procedures.length === 1 ? "" : "s"} across ${new Set(procedures.map((row) => row.serviceCode)).size} services`}</span>
          </div>
        </div>

        {procedures.length === 0 ? (
          <EmptyState
            description="Write the steps for a service below. Work raised from then on carries a copy of them."
            icon="compliance"
            title="No procedures yet"
          />
        ) : (
          <ul className="procedure-list">
            {procedures.map((row) => {
              const steps = stepsByVersion[row.id] ?? [];
              return (
                <li className={`procedure-entry is-${row.status}`} key={row.id}>
                  <div className="procedure-entry-head">
                    <span>
                      <strong>{row.serviceName ?? row.serviceCode} · v{row.version}</strong>
                      <small>
                        {steps.length} step{steps.length === 1 ? "" : "s"} · in force from {formatDate(row.effectiveFrom)}
                        {row.publishedByName ? ` · published by ${row.publishedByName}` : ""}
                      </small>
                    </span>
                    <StatusBadge tone={PROCEDURE_TONE[row.status]}>{PROCEDURE_LABELS[row.status]}</StatusBadge>
                    <button className="procedure-toggle" onClick={() => setOpenId(openId === row.id ? null : row.id)} type="button">
                      {openId === row.id ? "Hide" : "Steps"}
                    </button>
                  </div>

                  {openId === row.id && (
                    <div className="procedure-detail">
                      <ol className="procedure-steps">
                        {steps.map((step) => (
                          <li key={step.id}>
                            <strong>{step.title}{!step.mandatory && <em> · optional</em>}</strong>
                            {step.instruction && <small>{step.instruction}</small>}
                          </li>
                        ))}
                      </ol>

                      {canManage && row.status === "draft" && (
                        <>
                          <form action={revise} className="procedure-form">
                            <input name="procedureVersionId" type="hidden" value={row.id} />
                            <label className="procedure-form-wide">
                              <span>Steps, one per line</span>
                              <textarea defaultValue={asLines(steps)} name="steps" rows={8} />
                            </label>
                            <button className="secondary-button" disabled={revising} type="submit">
                              {revising ? "Saving…" : "Save steps"}
                            </button>
                          </form>
                          <form action={publish}>
                            <input name="procedureVersionId" type="hidden" value={row.id} />
                            <button className="primary-button" disabled={publishing || steps.length === 0} type="submit">
                              {publishing ? "Publishing…" : "Publish this version"}
                            </button>
                          </form>
                        </>
                      )}

                      {canManage && row.status === "published" && (
                        <form action={archive}>
                          <input name="procedureVersionId" type="hidden" value={row.id} />
                          <button className="rate-withdraw" disabled={archiving} type="submit">Withdraw from new work</button>
                        </form>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {canManage && (
        <section className="surface-card procedure-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">NEW VERSION</p>
              <h2>Draft a procedure</h2>
              <span>
                One step per line. Add <code>— instruction</code> after a step to explain it, and{" "}
                <code>(optional)</code> at the end of a step that should not block completion.
              </span>
            </div>
          </div>

          <form action={draft} className="procedure-form">
            <label>
              <span>Service</span>
              <select name="serviceCode" required>
                <option value="">Choose a service</option>
                {services.map((service) => <option key={service.code} value={service.code}>{service.name}</option>)}
              </select>
            </label>
            <label>
              <span>In force from</span>
              <input defaultValue={todayKey} name="effectiveFrom" required type="date" />
              <small>Work raised before this date keeps whatever procedure it was given.</small>
            </label>
            <label className="procedure-form-wide">
              <span>Steps</span>
              <textarea
                name="steps"
                placeholder={"Reconcile the sales register — against the books for the period\nReconcile the purchase register\nMatch input credit to GSTR-2B\nCompute the liability\nPartner review of the workings\nFile on the portal\nSave the acknowledgement"}
                required
                rows={9}
              />
              {draftState.fieldErrors.steps && <small className="rate-field-error">{draftState.fieldErrors.steps}</small>}
            </label>
            <label className="procedure-form-wide">
              <span>Note</span>
              <input maxLength={500} name="note" placeholder="What changed, and why" type="text" />
            </label>
            <button className="secondary-button" disabled={drafting} type="submit">
              {drafting ? "Drafting…" : "Create draft"}
            </button>
          </form>
        </section>
      )}
    </>
  );
}
