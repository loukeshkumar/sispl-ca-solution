"use client";

import { useActionState, useState } from "react";

import { OUTCOME_LABELS, OUTCOME_TONE, standingOf, standingSummary } from "../../lib/reviews/rounds";
import type { ReviewRoundRow } from "../../lib/reviews/repository";
import { StatusBadge } from "../dashboard/dashboard-ui";
import { decideReviewAction, submitForReviewAction, type ReviewActionState } from "./review-actions";

const initialState: ReviewActionState = { error: "", fieldErrors: {} };

const formatStamp = (value: string | null) => (value
  ? new Intl.DateTimeFormat("en-IN", {
    day: "numeric", hour: "2-digit", minute: "2-digit", month: "short", timeZone: "Asia/Kolkata",
  }).format(new Date(value))
  : "");

/**
 * Review as a decision with an author.
 *
 * The workflow status could always be set to "review" from a dropdown, which
 * recorded that work had reached somebody and nothing about what they made of
 * it. A round is opened by a submission and closed by a person who is not the
 * submitter — which is the control the status only ever gestured at.
 */
export function ReviewPanel({
  canWrite,
  completed,
  isReviewer,
  reviewerName,
  rounds,
  workItemId,
}: {
  canWrite: boolean;
  completed: boolean;
  /** The signed-in person is the reviewer this work was submitted to. */
  isReviewer: boolean;
  reviewerName: string | null;
  rounds: ReviewRoundRow[];
  workItemId: string;
}) {
  const [submitState, submit, submitting] = useActionState(submitForReviewAction, initialState);
  const [decideState, decide, deciding] = useActionState(decideReviewAction, initialState);
  const [returning, setReturning] = useState(false);

  const standing = standingOf(rounds);
  const error = submitState.error || decideState.error;

  if (!reviewerName) {
    return (
      <section className="surface-card review-round-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">REVIEW</p>
            <h2>No reviewer named</h2>
            <span>
              This obligation can be completed without a sign-off. Name a reviewer if the firm wants one — that is how
              it says this piece of work needs review.
            </span>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="surface-card review-round-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">REVIEW</p>
          <h2>Sign-off by {reviewerName}</h2>
          <span>{standingSummary(standing)}</span>
        </div>
        {standing.approved && <StatusBadge tone="mint">Approved</StatusBadge>}
      </div>

      {error && <p className="client-form-banner" role="alert">{error}</p>}

      {rounds.length > 0 && (
        <ol className="review-round-list">
          {rounds.map((round) => (
            <li className={`review-round is-${round.outcome ?? "open"}`} key={round.id}>
              <div className="review-round-head">
                <strong>Round {round.round}</strong>
                {round.outcome
                  ? <StatusBadge tone={OUTCOME_TONE[round.outcome]}>{OUTCOME_LABELS[round.outcome]}</StatusBadge>
                  : <StatusBadge tone="blue">Awaiting decision</StatusBadge>}
              </div>
              <small className="review-round-line">
                Submitted by {round.submittedByName} · {formatStamp(round.submittedAt)}
                {round.submissionNote ? ` · ${round.submissionNote}` : ""}
              </small>
              {round.outcome && (
                <small className="review-round-line is-decision">
                  {OUTCOME_LABELS[round.outcome]} by {round.decidedByName} · {formatStamp(round.decidedAt)}
                  {round.decisionNote ? ` · ${round.decisionNote}` : ""}
                </small>
              )}
            </li>
          ))}
        </ol>
      )}

      {canWrite && !completed && standing.openRound === null && (
        <form action={submit} className="review-round-form">
          <input name="workItemId" type="hidden" value={workItemId} />
          <label>
            <span>{standing.rounds === 0 ? "Submit for review" : `Resubmit as round ${standing.rounds + 1}`}</span>
            <input maxLength={2000} name="submissionNote" placeholder="What changed since the last round, if anything" type="text" />
          </label>
          <button className="secondary-button" disabled={submitting} type="submit">
            {submitting ? "Submitting…" : "Send to reviewer"}
          </button>
        </form>
      )}

      {canWrite && !completed && standing.openRound !== null && (
        isReviewer ? (
          <div className="review-decide">
            <form action={decide}>
              <input name="workItemId" type="hidden" value={workItemId} />
              <input name="outcome" type="hidden" value="approved" />
              <input name="decisionNote" type="hidden" value="" />
              <button className="primary-button" disabled={deciding} type="submit">
                {deciding ? "Recording…" : "Approve"}
              </button>
            </form>
            <button className="secondary-button" onClick={() => setReturning(!returning)} type="button">
              Return for changes
            </button>

            {returning && (
              <form action={decide} className="review-return-form">
                <input name="workItemId" type="hidden" value={workItemId} />
                <input name="outcome" type="hidden" value="returned" />
                <label>
                  <span>Why it is going back</span>
                  <input
                    maxLength={2000}
                    minLength={3}
                    name="decisionNote"
                    placeholder="A return with no reason tells the preparer nothing"
                    required
                    type="text"
                  />
                </label>
                <button className="secondary-button" disabled={deciding} type="submit">Return</button>
              </form>
            )}
          </div>
        ) : (
          <p className="review-waiting">
            With {reviewerName} since {formatStamp(rounds[0]?.submittedAt ?? null)}. Only they can decide it.
          </p>
        )
      )}
    </section>
  );
}
