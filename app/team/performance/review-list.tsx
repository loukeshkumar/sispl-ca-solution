"use client";

import Link from "next/link";
import { useActionState } from "react";

import {
  periodLabel,
  RATING_LABELS,
  RATING_TONE,
  STATUS_LABELS,
  STATUS_TONE,
} from "../../../lib/performance/review";
import type { ReviewRow } from "../../../lib/performance/repository";
import { EmptyState, StatusBadge } from "../../dashboard/dashboard-ui";
import { createReviewAction, type PerformanceActionState } from "./actions";

const initialState: PerformanceActionState = { error: "", fieldErrors: {} };

export function ReviewList({
  canReview,
  defaults,
  reviews,
  subjects,
  viewerUserId,
}: {
  canReview: boolean;
  defaults: { periodFrom: string; periodTo: string };
  reviews: ReviewRow[];
  subjects: Array<{ fullName: string; roleKey: string; userId: string }>;
  viewerUserId: string;
}) {
  const [state, create, creating] = useActionState(createReviewAction, initialState);

  return (
    <>
      {state.error && <p className="package-form-banner" role="alert">{state.error}</p>}

      <section className="surface-card review-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">REVIEWS</p>
            <h2>{canReview ? "Across the firm" : "About you"}</h2>
            <span>{reviews.length === 0 ? "Nothing yet." : `${reviews.length} review${reviews.length === 1 ? "" : "s"}`}</span>
          </div>
        </div>

        {reviews.length === 0 ? (
          <EmptyState
            description={canReview ? "Open a review for somebody to gather their evidence for the period." : "Reviews about you appear here once they have been shared."}
            icon="team"
            title="No reviews yet"
          />
        ) : (
          <>
            <div className="package-register-head review-list-head">
              <span>Employee</span><span>Period</span><span>Reviewer</span><span>Overall</span><span>Status</span><span aria-hidden="true" />
            </div>
            {reviews.map((review) => (
              <article className="package-register-row review-list-row" key={review.id}>
                <span>
                  <strong>{review.employeeName}</strong>
                  {review.employeeUserId === viewerUserId && <small>About you</small>}
                </span>
                <span>{periodLabel(review.periodFrom, review.periodTo)}</span>
                <span>{review.reviewerName}</span>
                <span>
                  {review.overallRating
                    ? <StatusBadge tone={RATING_TONE[review.overallRating]}>{RATING_LABELS[review.overallRating]}</StatusBadge>
                    : "—"}
                </span>
                <StatusBadge tone={STATUS_TONE[review.status]}>{STATUS_LABELS[review.status]}</StatusBadge>
                <Link className="review-open" href={`/team/performance/${review.id}`}>Open</Link>
              </article>
            ))}
          </>
        )}

        {canReview && (
          <form action={create} className="review-create-form">
            <label>
              <span>Who is being reviewed</span>
              <select name="employeeUserId" required>
                <option value="">Choose a person</option>
                {subjects.filter((person) => person.userId !== viewerUserId).map((person) => (
                  <option key={person.userId} value={person.userId}>{person.fullName}</option>
                ))}
              </select>
            </label>
            <label>
              <span>Reviewer</span>
              <select defaultValue={viewerUserId} name="reviewerUserId" required>
                {subjects.map((person) => <option key={person.userId} value={person.userId}>{person.fullName}</option>)}
              </select>
              <small>Nobody reviews themselves.</small>
            </label>
            <label><span>Period from</span><input defaultValue={defaults.periodFrom} name="periodFrom" required type="date" /></label>
            <label><span>Period to</span><input defaultValue={defaults.periodTo} name="periodTo" required type="date" /></label>
            <button className="secondary-button" disabled={creating} type="submit">
              {creating ? "Opening…" : "Open a review"}
            </button>
          </form>
        )}
      </section>
    </>
  );
}
