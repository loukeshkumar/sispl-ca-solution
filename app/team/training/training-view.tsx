"use client";

import { useActionState, useState } from "react";

import {
  BAND_LABELS,
  BAND_NOTES,
  BAND_TONE,
  CATEGORY_LABELS,
  CPE_CATEGORIES,
  formatHours,
  LEARNING_LABELS,
  LEARNING_NOTES,
  LEARNING_TYPES,
  type CpeCategory,
  type LearningType,
} from "../../../lib/training/cpe";
import type { TrainingWorkspace } from "../../../lib/training/repository";
import { EmptyState, StatusBadge } from "../../dashboard/dashboard-ui";
import {
  recordTrainingAction,
  removeTrainingAction,
  saveCpePolicyAction,
  type TrainingActionState,
} from "./actions";

const initialState: TrainingActionState = { error: "", fieldErrors: {} };

const formatDate = (value: string) => new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "UTC" })
  .format(new Date(`${value}T00:00:00Z`));

/** A requirement of nothing is not a requirement; show a dash rather than 0.0h. */
const requirement = (minutes: number) => (minutes === 0 ? "—" : formatHours(minutes));

/**
 * Continuing education and the firm's training log.
 *
 * One log for everybody. Members are additionally measured against the hours
 * they owe — twice over, because a year and a rolling block fail independently
 * and reporting only the year calls somebody compliant who is not.
 */
export function TrainingView({
  canManage,
  services,
  workspace,
}: {
  canManage: boolean;
  services: Array<{ code: string; name: string }>;
  workspace: TrainingWorkspace;
}) {
  const [recordState, record, recording] = useActionState(recordTrainingAction, initialState);
  const [removeState, remove, removing] = useActionState(removeTrainingAction, initialState);
  const [policyState, savePolicy, savingPolicy] = useActionState(saveCpePolicyAction, initialState);
  const [learningType, setLearningType] = useState<LearningType>("structured");
  const [category, setCategory] = useState<CpeCategory>("in_practice");

  const error = recordState.error || removeState.error || policyState.error;
  const obliged = workspace.members.filter((member) => member.standing);
  const short = obliged.filter((member) => !member.standing!.compliant);
  const policy = workspace.policies[category];

  return (
    <>
      {error && <p className="package-form-banner" role="alert">{error}</p>}

      {!workspace.policiesConfirmed && obliged.length > 0 && (
        <p className="articleship-unconfirmed" role="status">
          <strong>These hour requirements have not been checked.</strong> Every standing below is measured against
          figures nobody has confirmed against the current ICAI announcement. Confirm them before relying on any
          shortfall on this page.
        </p>
      )}

      <section className="surface-card training-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">CPE STANDING</p>
            <h2>Members against their obligation</h2>
            <span>
              {obliged.length === 0
                ? "No member carries a CPE obligation yet."
                : short.length === 0
                  ? `All ${obliged.length} members are met for ${workspace.year} and the block.`
                  : `${short.length} of ${obliged.length} members are short`}
            </span>
          </div>
        </div>

        <div className="package-register-head training-standing-head">
          <span>Member</span><span>This year</span><span>Structured</span><span>Block</span><span>Standing</span>
        </div>
        {workspace.members.map((member) => (
          <article className={`package-register-row training-standing-row is-${member.band}`} key={member.employeeUserId}>
            <span>
              <strong>{member.fullName}</strong>
              <small>{member.standing ? CATEGORY_LABELS[member.category] : "No CPE obligation"}</small>
            </span>
            {member.standing ? (
              <>
                <span>
                  <strong>{formatHours(member.standing.yearly.totalMinutes)}</strong>
                  <small>of {requirement(member.standing.yearly.totalRequiredMinutes)}</small>
                </span>
                <span>
                  <strong>{formatHours(member.standing.yearly.structuredMinutes)}</strong>
                  <small>of {requirement(member.standing.yearly.structuredRequiredMinutes)}</small>
                </span>
                <span>
                  <strong>{formatHours(member.standing.block.totalMinutes)}</strong>
                  <small>of {requirement(member.standing.block.totalRequiredMinutes)} · {member.standing.blockLabel}</small>
                </span>
              </>
            ) : (
              <>
                <span><strong>{formatHours(member.totalLoggedMinutes)}</strong><small>logged this year</small></span>
                <span>—</span>
                <span>—</span>
              </>
            )}
            <span className="training-standing">
              <StatusBadge tone={BAND_TONE[member.band]}>{BAND_LABELS[member.band]}</StatusBadge>
              <small>{BAND_NOTES[member.band]}</small>
            </span>
          </article>
        ))}
      </section>

      <section className="surface-card training-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">TRAINING LOG</p>
            <h2>What everybody has attended</h2>
            <span>{workspace.records.length} records from {workspace.year - 2} onward. Articles and staff are logged here too.</span>
          </div>
        </div>

        {workspace.records.length === 0 ? (
          <EmptyState description="Record a seminar, a course, or an in-house session to begin the log." icon="team" title="Nothing logged yet" />
        ) : (
          <>
            <div className="package-register-head training-log-head">
              <span>Session</span><span>Who</span><span>Type</span><span>Hours</span><span>Completed</span><span aria-hidden="true" />
            </div>
            {workspace.records.map((row) => (
              <article className="package-register-row training-log-row" key={row.id}>
                <span>
                  <strong>{row.title}</strong>
                  <small>
                    {row.provider || "In-house"}
                    {row.serviceName ? ` · ${row.serviceName}` : ""}
                    {row.certificateReference ? ` · ${row.certificateReference}` : ""}
                  </small>
                </span>
                <span>{row.employeeName}</span>
                <span className={`training-type is-${row.learningType}`}>{LEARNING_LABELS[row.learningType]}</span>
                <span><strong>{formatHours(row.minutes)}</strong></span>
                <span>{formatDate(row.completedOn)}</span>
                {canManage ? (
                  <form action={remove}>
                    <input name="recordId" type="hidden" value={row.id} />
                    <button className="rate-withdraw" disabled={removing} type="submit">Remove</button>
                  </form>
                ) : <span />}
              </article>
            ))}
          </>
        )}

        {canManage && (
          <form action={record} className="training-form">
            <label>
              <span>Who attended</span>
              <select name="employeeUserId" required>
                <option value="">Choose a person</option>
                {workspace.members.map((member) => (
                  <option key={member.employeeUserId} value={member.employeeUserId}>{member.fullName}</option>
                ))}
              </select>
            </label>
            <label className="training-form-wide">
              <span>Session</span>
              <input maxLength={200} name="title" placeholder="GST annual return update" required type="text" />
            </label>
            <label>
              <span>Provider</span>
              <input maxLength={160} name="provider" placeholder="Branch, ICAI, or in-house" type="text" />
            </label>
            <label>
              <span>Type</span>
              <select name="learningType" onChange={(event) => setLearningType(event.target.value as LearningType)} value={learningType}>
                {LEARNING_TYPES.map((type) => <option key={type} value={type}>{LEARNING_LABELS[type]}</option>)}
              </select>
              <small>{LEARNING_NOTES[learningType]}</small>
            </label>
            <label>
              <span>Hours</span>
              <input inputMode="decimal" name="hours" placeholder="6" required type="text" />
              {recordState.fieldErrors.hours && <small className="rate-field-error">{recordState.fieldErrors.hours}</small>}
            </label>
            <label>
              <span>Completed on</span>
              <input name="completedOn" required type="date" />
            </label>
            <label>
              <span>Service (optional)</span>
              <select name="serviceCode">
                <option value="">Not service-specific</option>
                {services.map((service) => <option key={service.code} value={service.code}>{service.name}</option>)}
              </select>
              <small>Shown as evidence beside a capability rating. It never grants one.</small>
            </label>
            <label>
              <span>Certificate reference</span>
              <input maxLength={80} name="certificateReference" placeholder="Optional" type="text" />
            </label>
            <button className="secondary-button" disabled={recording} type="submit">
              {recording ? "Recording…" : "Record training"}
            </button>
          </form>
        )}
      </section>

      <section className="surface-card training-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">FIRM POLICY</p>
            <h2>The hours a member owes</h2>
            <span>
              ICAI sets these and revises them, and they differ by whether a member is in practice. They are held here
              rather than written into the software, so the firm can correct them without waiting for a release.
            </span>
          </div>
          <StatusBadge tone={policy.confirmed ? "mint" : "amber"}>{policy.confirmed ? "Confirmed" : "Unconfirmed"}</StatusBadge>
        </div>

        {canManage && (
          <form action={savePolicy} className="training-form">
            <label>
              <span>Category</span>
              <select name="category" onChange={(event) => setCategory(event.target.value as CpeCategory)} value={category}>
                {CPE_CATEGORIES.map((value) => <option key={value} value={value}>{CATEGORY_LABELS[value]}</option>)}
              </select>
            </label>
            <label>
              <span>Structured hours a year</span>
              <input defaultValue={policy.yearlyStructuredMinutes / 60} inputMode="decimal" name="yearlyStructured" required type="text" />
            </label>
            <label>
              <span>Total hours a year</span>
              <input defaultValue={policy.yearlyTotalMinutes / 60} inputMode="decimal" name="yearlyTotal" required type="text" />
            </label>
            <label>
              <span>Block length (years)</span>
              <input defaultValue={policy.blockYears} max={10} min={1} name="blockYears" required type="number" />
            </label>
            <label>
              <span>Structured hours a block</span>
              <input defaultValue={policy.blockStructuredMinutes / 60} inputMode="decimal" name="blockStructured" required type="text" />
            </label>
            <label>
              <span>Total hours a block</span>
              <input defaultValue={policy.blockTotalMinutes / 60} inputMode="decimal" name="blockTotal" required type="text" />
            </label>
            <label>
              <span>In force from</span>
              <input name="effectiveFrom" required type="date" />
            </label>
            <label className="training-form-wide">
              <span>Source</span>
              <input maxLength={500} name="note" placeholder="Which ICAI announcement these came from" type="text" />
            </label>
            <label className="master-checkbox training-form-wide">
              <input defaultChecked={policy.confirmed} name="confirmed" type="checkbox" />
              <span>I have checked these against the current ICAI announcement</span>
            </label>
            <button className="secondary-button" disabled={savingPolicy} type="submit">
              {savingPolicy ? "Saving…" : "Save requirement"}
            </button>
          </form>
        )}
      </section>
    </>
  );
}
