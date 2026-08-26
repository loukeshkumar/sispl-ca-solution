"use client";

import { useActionState, useState } from "react";

import {
  ALERT_LABELS,
  ALERT_NOTES,
  ALERT_TONE,
  fractionLabel,
  STATUS_LABELS,
  STATUS_TONE,
  termLabel,
  type ArticleshipAlert,
  type ArticleshipPolicy,
} from "../../../lib/articleship/register";
import type { ArticleshipRow } from "../../../lib/articleship/repository";
import { EmptyState, StatusBadge } from "../../dashboard/dashboard-ui";
import {
  endRegistrationAction,
  recordIndustrialTrainingAction,
  registerArticleAction,
  saveArticleshipPolicyAction,
  type ArticleshipActionState,
} from "./actions";

const initialState: ArticleshipActionState = { error: "", fieldErrors: {} };

const formatDate = (value: string | null) => (value
  ? new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`))
  : "—");

type Subject = { fullName: string; membershipNumber: string; userId: string };

/**
 * The articleship register.
 *
 * A firm that trains articled assistants has a statutory record to keep, and it
 * was being kept somewhere other than here. Everything on this page is either
 * lodged paperwork or arithmetic over the attendance register — nothing is a
 * number somebody maintains by hand.
 */
export function ArticleshipRegisterView({
  canManage,
  policy,
  registrations,
  subjects,
  todayKey,
}: {
  canManage: boolean;
  policy: ArticleshipPolicy;
  registrations: ArticleshipRow[];
  subjects: { articles: Subject[]; principals: Subject[] };
  todayKey: string;
}) {
  const [registerState, register, registering] = useActionState(registerArticleAction, initialState);
  const [endState, end, ending] = useActionState(endRegistrationAction, initialState);
  const [trainingState, saveTraining, savingTraining] = useActionState(recordIndustrialTrainingAction, initialState);
  const [policyState, savePolicy, savingPolicy] = useActionState(saveArticleshipPolicyAction, initialState);
  const [openId, setOpenId] = useState<string | null>(null);

  const error = registerState.error || endState.error || trainingState.error || policyState.error;
  const active = registrations.filter((row) => row.status === "active");
  const needsAttention = active.filter((row) => row.alerts.length > 0);
  const unregistered = subjects.articles.filter((person) => !active.some((row) => row.articleUserId === person.userId));

  return (
    <>
      {error && <p className="package-form-banner" role="alert">{error}</p>}

      {!policy.confirmed && (
        <p className="articleship-unconfirmed" role="status">
          <strong>These figures have not been checked.</strong> The register is running on a {termLabel(policy.trainingMonths)} training
          period and leave at {fractionLabel(policy.leaveFraction)} of service. Confirm them against the current ICAI notification below
          before relying on any completion date on this page.
        </p>
      )}

      <section className="surface-card articleship-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">IN TRAINING</p>
            <h2>Articles registered with the firm</h2>
            <span>
              {active.length === 0 ? "Nobody is currently registered." : `${active.length} in training`}
              {needsAttention.length > 0 && ` · ${needsAttention.length} needing attention`}
              {unregistered.length > 0 && ` · ${unregistered.length} articled assistant${unregistered.length === 1 ? "" : "s"} not yet registered`}
            </span>
          </div>
        </div>

        {registrations.length === 0 ? (
          <EmptyState
            description="Register an articled assistant under a principal to begin the statutory record."
            icon="team"
            title="Nothing on the register yet"
          />
        ) : (
          <ul className="articleship-list">
            {registrations.map((row) => (
              <li className={`articleship-entry is-${row.status}`} key={row.id}>
                <div className="articleship-entry-head">
                  <span>
                    <strong>{row.articleName}</strong>
                    <small>
                      under {row.principalName}
                      {row.principalMembership ? ` · ICAI ${row.principalMembership}` : ""}
                      {row.registrationNumber ? ` · ${row.registrationNumber}` : ""}
                    </small>
                  </span>
                  <span className="articleship-term">
                    <strong>{formatDate(row.term.expectedCompletionOn)}</strong>
                    <small>
                      {row.status === "active"
                        ? row.term.remainingDays === 0 ? "term has run out" : `${row.term.remainingDays} days remaining`
                        : `${STATUS_LABELS[row.status]} ${formatDate(row.endedOn)}`}
                    </small>
                  </span>
                  <StatusBadge tone={STATUS_TONE[row.status]}>{STATUS_LABELS[row.status]}</StatusBadge>
                  <button
                    className="articleship-toggle"
                    onClick={() => setOpenId(openId === row.id ? null : row.id)}
                    type="button"
                  >
                    {openId === row.id ? "Hide" : "Detail"}
                  </button>
                </div>

                {row.alerts.length > 0 && (
                  <ul className="articleship-alerts">
                    {row.alerts.map((alert) => (
                      <li className={`is-${ALERT_TONE[alert as Exclude<ArticleshipAlert, "none">]}`} key={alert}>
                        <strong>{ALERT_LABELS[alert as Exclude<ArticleshipAlert, "none">]}</strong>
                        <small>{ALERT_NOTES[alert as Exclude<ArticleshipAlert, "none">]}</small>
                      </li>
                    ))}
                  </ul>
                )}

                {openId === row.id && (
                  <div className="articleship-detail">
                    <dl className="articleship-facts">
                      <div><dt>Commenced</dt><dd>{formatDate(row.commencedOn)}</dd></div>
                      <div><dt>Term</dt><dd>{termLabel(row.trainingMonths)}</dd></div>
                      <div><dt>Deed (Form 102)</dt><dd>{formatDate(row.deedDate)}</dd></div>
                      <div><dt>Registered (Form 103)</dt><dd>{formatDate(row.form103Date)}</dd></div>
                      <div><dt>Scheduled end</dt><dd>{formatDate(row.term.scheduledCompletionOn)}</dd></div>
                      <div><dt>Expected end</dt><dd>{formatDate(row.term.expectedCompletionOn)}</dd></div>
                      <div><dt>Days served</dt><dd>{row.term.servedDays}</dd></div>
                      <div><dt>Leave earned</dt><dd>{row.term.leaveEntitlementDays} days</dd></div>
                      <div><dt>Leave taken</dt><dd>{row.term.leaveTakenDays} days</dd></div>
                      <div><dt>Excess leave</dt><dd>{row.term.excessLeaveDays > 0 ? `${row.term.excessLeaveDays} days` : "—"}</dd></div>
                      {row.form109Date && <div><dt>Form 109</dt><dd>{formatDate(row.form109Date)}</dd></div>}
                      {row.form108Date && <div><dt>Form 108</dt><dd>{formatDate(row.form108Date)}</dd></div>}
                      <div className="articleship-facts-wide">
                        <dt>Industrial training</dt>
                        <dd>
                          {row.industrialTrainingFrom
                            ? `${row.industrialTrainingEmployer} · ${formatDate(row.industrialTrainingFrom)} to ${formatDate(row.industrialTrainingTo)}`
                            : "Not elected"}
                        </dd>
                      </div>
                      {row.endReason && <div className="articleship-facts-wide"><dt>Reason</dt><dd>{row.endReason}</dd></div>}
                    </dl>

                    {canManage && row.status === "active" && (
                      <div className="articleship-detail-forms">
                        <form action={saveTraining} className="articleship-form">
                          <input name="registrationId" type="hidden" value={row.id} />
                          <label><span>Industrial training employer</span><input defaultValue={row.industrialTrainingEmployer} maxLength={160} name="employer" type="text" /></label>
                          <label><span>From</span><input defaultValue={row.industrialTrainingFrom ?? ""} name="from" type="date" /></label>
                          <label><span>To</span><input defaultValue={row.industrialTrainingTo ?? ""} name="to" type="date" /></label>
                          <button className="secondary-button" disabled={savingTraining} type="submit">{savingTraining ? "Saving…" : "Record training"}</button>
                        </form>

                        <form action={end} className="articleship-form">
                          <input name="registrationId" type="hidden" value={row.id} />
                          <label>
                            <span>End the registration</span>
                            <select name="status">
                              <option value="completed">Completed (Form 108)</option>
                              <option value="transferred">Transferred out (Form 109)</option>
                              <option value="terminated">Terminated (Form 109)</option>
                            </select>
                          </label>
                          <label><span>Last day</span><input defaultValue={todayKey} name="endedOn" required type="date" /></label>
                          <label><span>Form date</span><input defaultValue={todayKey} name="formDate" type="date" /></label>
                          <label><span>Reason</span><input maxLength={300} name="reason" placeholder="Why it ended" type="text" /></label>
                          <button className="secondary-button" disabled={ending} type="submit">{ending ? "Saving…" : "End registration"}</button>
                        </form>
                      </div>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        {canManage && (
          <form action={register} className="articleship-form articleship-register-form">
            <label>
              <span>Articled assistant</span>
              <select name="articleUserId" required>
                <option value="">Choose an articled assistant</option>
                {unregistered.map((person) => <option key={person.userId} value={person.userId}>{person.fullName}</option>)}
              </select>
              {unregistered.length === 0 && <small>Everyone marked as an articled assistant is already registered.</small>}
            </label>
            <label>
              <span>Principal</span>
              <select name="principalUserId" required>
                <option value="">Choose a principal</option>
                {subjects.principals.map((person) => (
                  <option key={person.userId} value={person.userId}>{person.fullName} · {person.membershipNumber}</option>
                ))}
              </select>
              {subjects.principals.length === 0 && <small>No member has a membership number on record yet.</small>}
            </label>
            <label><span>Commenced on</span><input defaultValue={todayKey} name="commencedOn" required type="date" /></label>
            <label><span>Deed date (Form 102)</span><input name="deedDate" type="date" /></label>
            <label><span>Registered (Form 103)</span><input name="form103Date" type="date" /></label>
            <label><span>ICAI registration number</span><input maxLength={40} name="registrationNumber" placeholder="Optional" type="text" /></label>
            <button className="secondary-button" disabled={registering} type="submit">{registering ? "Registering…" : "Register article"}</button>
          </form>
        )}
      </section>

      <section className="surface-card articleship-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">FIRM POLICY</p>
            <h2>The figures this register runs on</h2>
            <span>
              ICAI revises the training period and the leave entitlement by notification. They are set here rather than
              written into the software, so the firm can correct them without waiting for a release.
            </span>
          </div>
          <StatusBadge tone={policy.confirmed ? "mint" : "amber"}>{policy.confirmed ? "Confirmed" : "Unconfirmed"}</StatusBadge>
        </div>

        {canManage && (
          <form action={savePolicy} className="articleship-form">
            <label>
              <span>Training period (months)</span>
              <input defaultValue={policy.trainingMonths} max={60} min={1} name="trainingMonths" required type="number" />
              {policyState.fieldErrors.trainingMonths && <small className="rate-field-error">{policyState.fieldErrors.trainingMonths}</small>}
            </label>
            <label>
              <span>Leave earned: numerator</span>
              <input defaultValue={policy.leaveFraction.numerator} max={100} min={1} name="leaveFractionNumerator" required type="number" />
            </label>
            <label>
              <span>…of every</span>
              <input defaultValue={policy.leaveFraction.denominator} max={100} min={1} name="leaveFractionDenominator" required type="number" />
              {policyState.fieldErrors.leaveFraction
                ? <small className="rate-field-error">{policyState.fieldErrors.leaveFraction}</small>
                : <small>Days served. Leave beyond this has to be served, extending the term.</small>}
            </label>
            <label><span>In force from</span><input defaultValue={todayKey} name="effectiveFrom" required type="date" /></label>
            <label className="articleship-form-wide">
              <span>Source</span>
              <input defaultValue={policy.confirmed ? "" : ""} maxLength={500} name="note" placeholder="Which ICAI notification these came from" type="text" />
            </label>
            <label className="master-checkbox articleship-form-wide">
              <input defaultChecked={policy.confirmed} name="confirmed" type="checkbox" />
              <span>I have checked these against the current ICAI notification</span>
            </label>
            <button className="secondary-button" disabled={savingPolicy} type="submit">{savingPolicy ? "Saving…" : "Save policy"}</button>
          </form>
        )}
      </section>
    </>
  );
}
