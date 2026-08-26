/**
 * Review as a decision rather than a status.
 *
 * `review` was one of four values in a dropdown. It recorded that work had
 * reached a reviewer and nothing about whether they looked at it, what they
 * concluded, or why — so the questions a peer review or a negligence claim
 * actually asks, who signed this off and on what basis, had no answer anywhere.
 *
 * A round is opened by a submission and closed by a decision. Returned work
 * reopens and the next submission is the next round, which is what makes "how
 * many times did this come back" answerable.
 */

export type ReviewOutcome = "approved" | "returned";

export const REVIEW_OUTCOMES: readonly ReviewOutcome[] = ["approved", "returned"];

export const OUTCOME_LABELS: Record<ReviewOutcome, string> = {
  approved: "Approved",
  returned: "Returned",
};

export const OUTCOME_TONE: Record<ReviewOutcome, "mint" | "amber"> = {
  approved: "mint",
  returned: "amber",
};

export const isReviewOutcome = (value: string): value is ReviewOutcome =>
  (REVIEW_OUTCOMES as readonly string[]).includes(value);

export type ReviewRound = {
  decidedAt: string | null;
  decidedByUserId: string | null;
  outcome: ReviewOutcome | null;
  reviewerUserId: string;
  round: number;
  submittedByUserId: string;
};

export type ReviewStanding = {
  /** True when the named reviewer has approved the most recent round. */
  approved: boolean;
  /** The round awaiting a decision, if any. */
  openRound: number | null;
  /** How many times the work has come back. The number a partner asks for. */
  returns: number;
  rounds: number;
};

/**
 * Where the obligation stands with its reviewer.
 *
 * Approval belongs to the latest round only. Work approved, then returned after
 * a further submission, is not approved work — and reading an older approval as
 * current is exactly how a sign-off stops meaning anything.
 */
export function standingOf(rounds: readonly ReviewRound[]): ReviewStanding {
  if (rounds.length === 0) return { approved: false, openRound: null, returns: 0, rounds: 0 };
  const ordered = [...rounds].sort((left, right) => left.round - right.round);
  const latest = ordered[ordered.length - 1]!;
  return {
    approved: latest.outcome === "approved",
    openRound: latest.outcome === null ? latest.round : null,
    returns: ordered.filter((round) => round.outcome === "returned").length,
    rounds: ordered.length,
  };
}

export type SubmitRefusal = "no_reviewer" | "already_open" | "self_review" | "completed";

export const SUBMIT_REFUSAL_NOTES: Record<SubmitRefusal, string> = {
  no_reviewer: "Name a reviewer before submitting this for review.",
  already_open: "This obligation is already with its reviewer.",
  self_review: "You cannot submit work to yourself for review.",
  completed: "This obligation is complete. Reopen it before submitting a further round.",
};

export function refuseSubmit(input: {
  itemStatus: string;
  reviewerUserId: string | null;
  standing: ReviewStanding;
  submitterUserId: string;
}): SubmitRefusal | null {
  if (input.itemStatus === "completed") return "completed";
  if (!input.reviewerUserId) return "no_reviewer";
  if (input.standing.openRound !== null) return "already_open";
  // The database refuses this too; catching it here makes the message a sentence
  // rather than a constraint name.
  if (input.reviewerUserId === input.submitterUserId) return "self_review";
  return null;
}

export type DecideRefusal = "no_open_round" | "not_the_reviewer" | "self_review" | "reason_required" | "unknown_outcome";

export const DECIDE_REFUSAL_NOTES: Record<DecideRefusal, string> = {
  no_open_round: "This obligation is not currently with a reviewer.",
  not_the_reviewer: "Only the reviewer this work was submitted to can decide it.",
  self_review: "You cannot decide a round you submitted yourself.",
  reason_required: "Say why the work is being returned. A return with no reason tells the preparer nothing.",
  unknown_outcome: "Choose whether the work is approved or returned.",
};

export function refuseDecision(input: {
  actorUserId: string;
  decisionNote: string;
  openRound: { reviewerUserId: string; submittedByUserId: string } | null;
  outcome: string;
}): DecideRefusal | null {
  if (!input.openRound) return "no_open_round";
  if (!isReviewOutcome(input.outcome)) return "unknown_outcome";
  if (input.openRound.reviewerUserId !== input.actorUserId) return "not_the_reviewer";
  if (input.openRound.submittedByUserId === input.actorUserId) return "self_review";
  if (input.outcome === "returned" && input.decisionNote.trim().length < 3) return "reason_required";
  return null;
}

export type CompletionRefusal = "review_outstanding" | "review_open";

export const COMPLETION_REFUSAL_NOTES: Record<CompletionRefusal, string> = {
  review_open: "This obligation is with its reviewer. It cannot be completed until they decide.",
  review_outstanding: "The named reviewer has not approved this obligation. Submit it for review first.",
};

/**
 * Whether the review stands in the way of completing.
 *
 * Only where a reviewer is named. An obligation the firm did not think needed
 * review completes exactly as it always did — naming a reviewer is how the firm
 * says this one does.
 */
export function refuseCompletion(input: {
  reviewerUserId: string | null;
  standing: ReviewStanding;
}): CompletionRefusal | null {
  if (!input.reviewerUserId) return null;
  if (input.standing.openRound !== null) return "review_open";
  if (!input.standing.approved) return "review_outstanding";
  return null;
}

/** `Round 2 · approved` — how somebody would say it out loud. */
export const roundLabel = (round: ReviewRound) =>
  `Round ${round.round}${round.outcome ? ` · ${OUTCOME_LABELS[round.outcome]}` : " · awaiting decision"}`;

/**
 * How the history reads at a glance. A first-time approval and one that took
 * four attempts are different facts about the same finished obligation.
 */
export function standingSummary(standing: ReviewStanding): string {
  if (standing.rounds === 0) return "Not yet submitted for review";
  if (standing.openRound !== null) return `With the reviewer · round ${standing.openRound}`;
  if (standing.approved) {
    return standing.returns === 0
      ? "Approved first time"
      : `Approved after ${standing.returns} return${standing.returns === 1 ? "" : "s"}`;
  }
  return `Returned · ${standing.returns} time${standing.returns === 1 ? "" : "s"}`;
}
