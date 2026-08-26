"use client";

import { useActionState, useState } from "react";

import {
  ACCEPTANCE_LABELS,
  acceptanceSummary,
  CHECK_KEYS,
  CHECK_LABELS,
  CHECK_NOTES,
  LETTER_LABELS,
  letterSummary,
  MANDATORY_CHECKS,
  OUTCOME_LABELS,
  type CheckKey,
} from "../../lib/clients/acceptance";
import type { AcceptanceView, EngagementLetterRow } from "../../lib/clients/acceptance-repository";
import { StatusBadge } from "../dashboard/dashboard-ui";
import {
  decideAcceptanceAction,
  recordCheckAction,
  saveLetterAction,
  type AcceptanceActionState,
} from "./acceptance-actions";

const initialState: AcceptanceActionState = { error: "", notice: "" };

const formatDate = (key: string) => new Intl.DateTimeFormat("en-IN", {
  day: "numeric", month: "short", timeZone: "Asia/Kolkata", year: "numeric",
}).format(new Date(`${key}T00:00:00+05:30`));

/**
 * Whether the firm took this client on, and on what terms.
 *
 * Two panels rather than one: acceptance is a decision taken once, and the
 * letters are a running record. Showing them together as a single checklist
 * would suggest a signed letter is one more box, which is how a firm ends up
 * doing work nothing covers.
 */
export function AcceptancePanel({
  acceptance,
  canWrite,
  letters,
  services,
  todayKey,
}: {
  acceptance: AcceptanceView;
  canWrite: boolean;
  letters: EngagementLetterRow[];
  services: string[];
  todayKey: string;
}) {
  const [checkState, check, checking] = useActionState(recordCheckAction, initialState);
  const [decideState, decide, deciding] = useActionState(decideAcceptanceAction, initialState);
  const [letterState, saveLetter, savingLetter] = useActionState(saveLetterAction, initialState);
  const [recordingFor, setRecordingFor] = useState<CheckKey | "">("");
  const [declining, setDeclining] = useState(false);
  const [addingLetter, setAddingLetter] = useState(false);
  const [letterStatus, setLetterStatus] = useState("signed");

  const error = checkState.error || decideState.error || letterState.error;
  const notice = checkState.notice || decideState.notice || letterState.notice;
  const byKey = new Map(acceptance.checks.map((entry) => [entry.checkKey, entry]));
  const decided = acceptance.status !== "in_progress";

  return (
    <>
      <section className="surface-card acceptance-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">ACCEPTANCE</p>
            <h2>{acceptanceSummary(acceptance)}</h2>
            <span>
              {decided
                ? "Recorded once, before the firm took the client on."
                : acceptance.entityStatus === "prospect"
                  ? "Until this is decided, no work, package or invoice can be raised for this client."
                  // A client already active predates this record. Completing it
                  // is worth doing, but claiming it gates anything would be a lie.
                  : "This client was taken on before the firm kept an acceptance record. Completing it fills the gap a reviewer would ask about."}
            </span>
          </div>
          <StatusBadge tone={acceptance.status === "accepted" ? "mint" : acceptance.status === "declined" ? "red" : "amber"}>
            {ACCEPTANCE_LABELS[acceptance.status]}
          </StatusBadge>
        </div>

        {error && <p className="client-form-banner" role="alert">{error}</p>}
        {notice && <p className="client-form-notice">{notice}</p>}

        <ul className="acceptance-check-list">
          {CHECK_KEYS.map((key) => {
            const entry = byKey.get(key);
            const mandatory = MANDATORY_CHECKS.includes(key);
            return (
              <li className={`acceptance-check is-${entry?.outcome ?? "outstanding"}`} key={key}>
                <div className="acceptance-check-head">
                  <strong>{CHECK_LABELS[key]}</strong>
                  {entry
                    ? <StatusBadge tone={entry.outcome === "cleared" ? "mint" : entry.outcome === "concern" ? "amber" : "slate"}>{OUTCOME_LABELS[entry.outcome]}</StatusBadge>
                    : <StatusBadge tone={mandatory ? "amber" : "slate"}>{mandatory ? "Outstanding" : "Not recorded"}</StatusBadge>}
                </div>
                {/* Spelled out because a checklist item nobody can explain gets
                    ticked, and a ticked checklist looks like assurance. */}
                <small className="acceptance-check-note">{CHECK_NOTES[key]}</small>
                {entry && (
                  <small className="acceptance-check-meta">
                    {entry.checkedByName} · {formatDate(entry.checkedOn)}{entry.note ? ` · ${entry.note}` : ""}
                  </small>
                )}
                {canWrite && !decided && (
                  recordingFor === key ? (
                    <form action={check} className="acceptance-check-form">
                      <input name="legalEntityId" type="hidden" value={acceptance.legalEntityId} />
                      <input name="checkKey" type="hidden" value={key} />
                      <select defaultValue="cleared" name="outcome">
                        <option value="cleared">Cleared</option>
                        <option value="concern">Concern raised</option>
                        <option value="not_applicable">Not applicable</option>
                      </select>
                      <input defaultValue={todayKey} name="checkedOn" required type="date" />
                      <input maxLength={1000} name="note" placeholder="What was found, if anything" type="text" />
                      <button className="secondary-button" disabled={checking} type="submit">Record</button>
                    </form>
                  ) : (
                    <button className="secondary-button" onClick={() => setRecordingFor(key)} type="button">
                      {entry ? "Re-record" : "Record"}
                    </button>
                  )
                )}
              </li>
            );
          })}
        </ul>

        {canWrite && !decided && acceptance.entityStatus === "prospect" && (
          <div className="acceptance-decision">
            <form action={decide}>
              <input name="legalEntityId" type="hidden" value={acceptance.legalEntityId} />
              <input name="outcome" type="hidden" value="accepted" />
              <input name="reason" type="hidden" value="" />
              <button className="primary-button" disabled={deciding} type="submit">Accept this client</button>
            </form>
            <button className="secondary-button" onClick={() => setDeclining(!declining)} type="button">Decline</button>
            {declining && (
              <form action={decide} className="acceptance-decline-form">
                <input name="legalEntityId" type="hidden" value={acceptance.legalEntityId} />
                <input name="outcome" type="hidden" value="declined" />
                <input maxLength={1000} minLength={3} name="reason" placeholder="Why the firm is declining" required type="text" />
                <button className="secondary-button" disabled={deciding} type="submit">Decline</button>
              </form>
            )}
          </div>
        )}

        {decided && acceptance.decidedByName && (
          <small className="acceptance-check-meta">
            {ACCEPTANCE_LABELS[acceptance.status]} by {acceptance.decidedByName}
            {acceptance.decisionNote ? ` — ${acceptance.decisionNote}` : ""}
          </small>
        )}
      </section>

      <section className="surface-card acceptance-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">ENGAGEMENT LETTERS</p>
            <h2>{letters.length === 0 ? "No letter on record" : `${letters.length} letter${letters.length === 1 ? "" : "s"}`}</h2>
            <span>
              A letter names the services it covers and the period it runs for. Work outside every signed letter is
              flagged, which is the question a peer reviewer actually asks.
            </span>
          </div>
          {canWrite && (
            <button className="secondary-button" onClick={() => setAddingLetter(!addingLetter)} type="button">
              {addingLetter ? "Cancel" : "Record a letter"}
            </button>
          )}
        </div>

        {letters.length > 0 && (
          <ul className="acceptance-check-list">
            {letters.map((letter) => (
              <li className={`acceptance-check is-${letter.status}`} key={letter.id}>
                <div className="acceptance-check-head">
                  <strong>{letter.serviceCodes.join(", ") || "No services named"}</strong>
                  <StatusBadge tone={letter.status === "signed" ? "mint" : letter.status === "issued" ? "amber" : "slate"}>
                    {LETTER_LABELS[letter.status]}
                  </StatusBadge>
                </div>
                <small className="acceptance-check-note">{letterSummary(letter, formatDate)}</small>
                <small className="acceptance-check-meta">
                  {letter.issuedOn ? `Issued ${formatDate(letter.issuedOn)}` : "Not yet issued"}
                  {letter.signedOn ? ` · signed ${formatDate(letter.signedOn)}` : ""}
                  {letter.note ? ` · ${letter.note}` : ""} · recorded by {letter.createdByName}
                </small>
              </li>
            ))}
          </ul>
        )}

        {canWrite && addingLetter && (
          <form action={saveLetter} className="acceptance-letter-form">
            <input name="legalEntityId" type="hidden" value={acceptance.legalEntityId} />
            <label>
              <span>Covers from</span>
              <input name="periodFrom" required type="date" />
            </label>
            <label>
              <span>Until</span>
              <input name="periodTo" required type="date" />
            </label>
            <label>
              <span>Fee basis</span>
              <select defaultValue="fixed_retainer" name="feeBasis">
                <option value="fixed_retainer">Fixed retainer</option>
                <option value="per_service">Per service</option>
                <option value="hourly">Hourly</option>
                <option value="other">Other</option>
              </select>
            </label>
            <label>
              <span>State</span>
              <select name="status" onChange={(event) => setLetterStatus(event.target.value)} value={letterStatus}>
                <option value="draft">Draft</option>
                <option value="issued">Issued, not signed</option>
                <option value="signed">Signed</option>
              </select>
            </label>
            {letterStatus !== "draft" && (
              <label>
                <span>Issued on</span>
                <input name="issuedOn" required type="date" />
              </label>
            )}
            {letterStatus === "signed" && (
              <label>
                <span>Signed on</span>
                <input name="signedOn" required type="date" />
              </label>
            )}
            <fieldset className="acceptance-letter-services">
              <legend>Services this letter covers</legend>
              {services.map((code) => (
                <label key={code}>
                  <input name="serviceCodes" type="checkbox" value={code} />
                  <span>{code}</span>
                </label>
              ))}
              {services.length === 0 && <small>This client has no services recorded yet.</small>}
            </fieldset>
            <label className="acceptance-letter-wide">
              <span>Note</span>
              <input maxLength={1000} name="note" type="text" />
            </label>
            <button className="primary-button" disabled={savingLetter} type="submit">
              {savingLetter ? "Saving…" : "Record letter"}
            </button>
          </form>
        )}
      </section>
    </>
  );
}
