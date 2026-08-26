"use client";

import { useActionState } from "react";

import {
  DIMENSION_LABELS,
  DIMENSION_PROMPTS,
  DIMENSIONS,
  periodLabel,
  RATING_LABELS,
  RATINGS,
  SHARE_BLOCKER_NOTES,
  shareBlockers,
  STATUS_LABELS,
  STATUS_TONE,
  type Dimension,
} from "../../../lib/performance/review";
import type { ReviewDetail } from "../../../lib/performance/repository";
import { StatusBadge } from "../../dashboard/dashboard-ui";
import {
  acknowledgeReviewAction,
  saveReviewAction,
  shareReviewAction,
  type PerformanceActionState,
} from "./actions";

const initialState: PerformanceActionState = { error: "", fieldErrors: {} };

const EVIDENCE_TONE = { good: "mint", neutral: "blue", concern: "amber" } as const;

/**
 * One review: the evidence, the judgement, and who made it.
 *
 * The evidence is gathered from the modules that own each figure rather than
 * typed, and every item says where its number came from — so a disagreement is
 * about the work rather than about whether the number is real.
 */
export function ReviewEditor({
  canReview,
  isSubject,
  review,
}: {
  canReview: boolean;
  /** The person the review is about, who alone can acknowledge it. */
  isSubject: boolean;
  review: ReviewDetail;
}) {
  const [saveState, save, saving] = useActionState(saveReviewAction, initialState);
  const [shareState, share, sharing] = useActionState(shareReviewAction, initialState);
  const [ackState, acknowledge, acking] = useActionState(acknowledgeReviewAction, initialState);

  const error = saveState.error || shareState.error || ackState.error;
  const editable = canReview && review.status === "draft";
  const ratingFor = (dimension: Dimension) => review.ratings.find((entry) => entry.dimension === dimension);
  const blockers = shareBlockers({
    development: review.development,
    entries: review.ratings,
    overallRating: review.overallRating,
    strengths: review.strengths,
  });

  return (
    <>
      {error && <p className="package-form-banner" role="alert">{error}</p>}

      <section className="surface-card review-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">EVIDENCE</p>
            <h2>What the period actually shows</h2>
            <span>
              {review.evidenceIsSnapshot
                ? "Frozen when this review was shared. These are the figures the conversation was had against."
                : "Gathered live from the firm's own records. Frozen when the review is shared."}
            </span>
          </div>
          <StatusBadge tone={STATUS_TONE[review.status]}>{STATUS_LABELS[review.status]}</StatusBadge>
        </div>

        <ul className="review-evidence">
          {review.evidence.map((item) => (
            <li className={`review-evidence-item is-${item.tone}`} key={item.id}>
              <span>
                <strong>{item.label}</strong>
                <small>{item.detail}</small>
              </span>
              <span className="review-evidence-value">
                <StatusBadge tone={EVIDENCE_TONE[item.tone]}>{item.value}</StatusBadge>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <form action={save}>
        <input name="reviewId" type="hidden" value={review.id} />

        <section className="surface-card review-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">JUDGEMENT</p>
              <h2>Rated by dimension</h2>
              <span>Each carries its own note, so &ldquo;below&rdquo; always says below at what.</span>
            </div>
          </div>

          <div className="review-dimensions">
            {DIMENSIONS.map((dimension) => {
              const current = ratingFor(dimension);
              return (
                <div className="review-dimension" key={dimension}>
                  <div>
                    <strong>{DIMENSION_LABELS[dimension]}</strong>
                    <small>{DIMENSION_PROMPTS[dimension]}</small>
                  </div>
                  {editable ? (
                    <>
                      <select defaultValue={current?.rating ?? ""} name={`rating-${dimension}`}>
                        <option value="">Not rated</option>
                        {RATINGS.map((rating) => <option key={rating} value={rating}>{RATING_LABELS[rating]}</option>)}
                      </select>
                      <input
                        aria-label={`Note for ${DIMENSION_LABELS[dimension]}`}
                        defaultValue={current?.note ?? ""}
                        maxLength={2000}
                        name={`note-${dimension}`}
                        placeholder="What this rests on"
                        type="text"
                      />
                    </>
                  ) : (
                    <>
                      <span>{current ? RATING_LABELS[current.rating] : "Not rated"}</span>
                      <span className="review-dimension-note">{current?.note || "—"}</span>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        <section className="surface-card review-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">OVERALL</p>
              <h2>The period in summary</h2>
              <span>{periodLabel(review.periodFrom, review.periodTo)} · reviewed by {review.reviewerName}</span>
            </div>
          </div>

          {editable ? (
            <div className="review-overall">
              <label>
                <span>Overall rating</span>
                <select defaultValue={review.overallRating ?? ""} name="overallRating">
                  <option value="">Not rated</option>
                  {RATINGS.map((rating) => <option key={rating} value={rating}>{RATING_LABELS[rating]}</option>)}
                </select>
              </label>
              <label className="review-overall-wide">
                <span>Strengths</span>
                <textarea defaultValue={review.strengths} maxLength={4000} name="strengths" rows={4} />
              </label>
              <label className="review-overall-wide">
                <span>Development areas</span>
                <textarea defaultValue={review.development} maxLength={4000} name="development" rows={4} />
              </label>
              <button className="secondary-button" disabled={saving} type="submit">
                {saving ? "Saving…" : "Save draft"}
              </button>
            </div>
          ) : (
            <div className="review-overall is-readonly">
              <p><strong>{review.overallRating ? RATING_LABELS[review.overallRating] : "Not rated"}</strong></p>
              <div><h3>Strengths</h3><p>{review.strengths || "—"}</p></div>
              <div><h3>Development areas</h3><p>{review.development || "—"}</p></div>
            </div>
          )}
        </section>
      </form>

      {editable && (
        <section className="surface-card review-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">SHARE</p>
              <h2>Show it to {review.employeeName}</h2>
              <span>Sharing freezes the evidence and seals the review. It cannot be edited afterwards.</span>
            </div>
          </div>
          {blockers.length > 0 ? (
            <ul className="review-blockers">
              {blockers.map((blocker) => <li key={blocker}>{SHARE_BLOCKER_NOTES[blocker]}</li>)}
            </ul>
          ) : (
            <p className="review-ready">Complete. Sharing will record the evidence as it stands today.</p>
          )}
          <form action={share}>
            <input name="reviewId" type="hidden" value={review.id} />
            <button className="primary-button" disabled={sharing || blockers.length > 0} type="submit">
              {sharing ? "Sharing…" : "Share with employee"}
            </button>
          </form>
        </section>
      )}

      {isSubject && review.status === "shared" && (
        <section className="surface-card review-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">ACKNOWLEDGE</p>
              <h2>Confirm you have seen this</h2>
              <span>Acknowledging records that you have read it. It does not record agreement.</span>
            </div>
          </div>
          <form action={acknowledge}>
            <input name="reviewId" type="hidden" value={review.id} />
            <button className="secondary-button" disabled={acking} type="submit">
              {acking ? "Recording…" : "I have read this review"}
            </button>
          </form>
        </section>
      )}
    </>
  );
}
