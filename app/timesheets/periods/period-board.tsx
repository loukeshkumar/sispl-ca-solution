"use client";

import { useActionState, useState } from "react";

import { PERIOD_LABELS, PERIOD_TONE } from "../../../lib/timesheets/governance";
import { periodSummary } from "../../../lib/timesheets/governance";
import type { TimesheetPeriodRow } from "../../../lib/timesheets/period-repository";
import { StatusBadge } from "../../dashboard/dashboard-ui";
import {
  decidePeriodAction,
  reopenPeriodAction,
  submitPeriodAction,
  type PeriodActionState,
} from "../period-actions";

const initialState: PeriodActionState = { error: "", notice: "" };

const stamp = (value: string | null) => (value
  ? new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata", year: "numeric" }).format(new Date(value))
  : "");

/**
 * A month of time, and what has become of it.
 *
 * The board exists because governance that lives only in a repository is a
 * refusal nobody can act on: a person needs somewhere to submit, and a reviewer
 * somewhere to see whose month is waiting.
 */
export function PeriodBoard({
  canManage,
  periodKey,
  rows,
  viewerUserId,
}: {
  canManage: boolean;
  periodKey: string;
  rows: TimesheetPeriodRow[];
  viewerUserId: string;
}) {
  const [submitState, submit, submitting] = useActionState(submitPeriodAction, initialState);
  const [decideState, decide, deciding] = useActionState(decidePeriodAction, initialState);
  const [reopenState, reopen, reopening] = useActionState(reopenPeriodAction, initialState);
  const [returningFor, setReturningFor] = useState("");
  const [reopeningFor, setReopeningFor] = useState("");

  const error = submitState.error || decideState.error || reopenState.error;
  const notice = submitState.notice || decideState.notice || reopenState.notice;
  const mine = rows.find((row) => row.employeeUserId === viewerUserId);
  const waiting = rows.filter((row) => row.status === "submitted").length;

  return (
    <section className="surface-card timesheet-period-board">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">TIMESHEET · {periodKey}</p>
          <h2>{waiting === 0 ? "Nothing waiting on a reviewer" : `${waiting} waiting on a reviewer`}</h2>
          <span>
            A month is submitted by the person who recorded it and approved by somebody else. Approving freezes the
            entries — after that the month is a statement the firm has made, not a working note.
          </span>
        </div>
        {mine && mine.status === "open" && (
          <form action={submit}>
            <input name="periodKey" type="hidden" value={periodKey} />
            <button className="primary-button" disabled={submitting} type="submit">
              {submitting ? "Submitting…" : "Submit my month"}
            </button>
          </form>
        )}
      </div>

      {error && <p className="client-form-banner" role="alert">{error}</p>}
      {notice && <p className="client-form-notice">{notice}</p>}

      <ul className="timesheet-period-list">
        {rows.map((row) => {
          const isMe = row.employeeUserId === viewerUserId;
          return (
            <li className={`timesheet-period-row is-${row.status}`} key={row.employeeUserId}>
              <div className="timesheet-period-head">
                <strong>{row.employeeName}{isMe ? " (you)" : ""}</strong>
                <StatusBadge tone={PERIOD_TONE[row.status]}>{PERIOD_LABELS[row.status]}</StatusBadge>
                {row.changedSinceSubmission && <StatusBadge tone="amber">Changed since submission</StatusBadge>}
              </div>
              <small className="timesheet-period-line">{periodSummary(row)}</small>
              {row.submittedAt && <small className="timesheet-period-meta">Submitted {stamp(row.submittedAt)}</small>}
              {row.decidedByName && <small className="timesheet-period-meta">Approved by {row.decidedByName}</small>}
              {row.decisionNote && <small className="timesheet-period-meta">&ldquo;{row.decisionNote}&rdquo;</small>}
              {row.reopenedByName && (
                <small className="timesheet-period-meta">
                  Reopened by {row.reopenedByName} — {row.reopenReason}
                </small>
              )}

              {/* A reviewer decides somebody else's month. The repository refuses
                  self-approval too, so this is convenience, not the control. */}
              {canManage && !isMe && row.status === "submitted" && (
                <div className="timesheet-period-actions">
                  <form action={decide}>
                    <input name="employeeUserId" type="hidden" value={row.employeeUserId} />
                    <input name="periodKey" type="hidden" value={periodKey} />
                    <input name="outcome" type="hidden" value="approved" />
                    <input name="note" type="hidden" value="" />
                    <button className="primary-button" disabled={deciding} type="submit">Approve</button>
                  </form>
                  <button
                    className="secondary-button"
                    onClick={() => setReturningFor(returningFor === row.employeeUserId ? "" : row.employeeUserId)}
                    type="button"
                  >
                    Return
                  </button>
                  {returningFor === row.employeeUserId && (
                    <form action={decide} className="timesheet-period-form">
                      <input name="employeeUserId" type="hidden" value={row.employeeUserId} />
                      <input name="periodKey" type="hidden" value={periodKey} />
                      <input name="outcome" type="hidden" value="returned" />
                      <input maxLength={500} minLength={3} name="note" placeholder="What needs correcting" required type="text" />
                      <button className="secondary-button" disabled={deciding} type="submit">Send back</button>
                    </form>
                  )}
                </div>
              )}

              {canManage && row.status === "approved" && (
                <div className="timesheet-period-actions">
                  <button
                    className="secondary-button"
                    onClick={() => setReopeningFor(reopeningFor === row.employeeUserId ? "" : row.employeeUserId)}
                    type="button"
                  >
                    Reopen
                  </button>
                  {reopeningFor === row.employeeUserId && (
                    <form action={reopen} className="timesheet-period-form">
                      <input name="employeeUserId" type="hidden" value={row.employeeUserId} />
                      <input name="periodKey" type="hidden" value={periodKey} />
                      <input maxLength={500} minLength={3} name="reason" placeholder="Why an approved month is being reopened" required type="text" />
                      <button className="secondary-button" disabled={reopening} type="submit">Reopen</button>
                    </form>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
