import assert from "node:assert/strict";
import test from "node:test";

import {
  isReviewOutcome,
  OUTCOME_LABELS,
  refuseCompletion,
  refuseDecision,
  refuseSubmit,
  REVIEW_OUTCOMES,
  roundLabel,
  standingOf,
  standingSummary,
  type ReviewRound,
} from "../lib/reviews/rounds";

const PREPARER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const REVIEWER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PARTNER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const round = (over: Partial<ReviewRound> = {}): ReviewRound => ({
  decidedAt: null,
  decidedByUserId: null,
  outcome: null,
  reviewerUserId: REVIEWER,
  round: 1,
  submittedByUserId: PREPARER,
  ...over,
});

const decided = (number: number, outcome: "approved" | "returned") =>
  round({ decidedAt: "2026-08-14T09:00:00Z", decidedByUserId: REVIEWER, outcome, round: number });

test("work never submitted stands at nothing", () => {
  const standing = standingOf([]);
  assert.equal(standing.rounds, 0);
  assert.equal(standing.approved, false);
  assert.equal(standing.openRound, null);
  assert.equal(standingSummary(standing), "Not yet submitted for review");
});

test("an open round is named, and is not an approval", () => {
  const standing = standingOf([round({ round: 1 })]);
  assert.equal(standing.openRound, 1);
  assert.equal(standing.approved, false);
  assert.match(standingSummary(standing), /With the reviewer · round 1/);
});

test("approval belongs to the latest round only", () => {
  // Approved, then submitted again and returned. Reading the older approval as
  // current is exactly how a sign-off stops meaning anything.
  const standing = standingOf([decided(1, "approved"), decided(2, "returned")]);
  assert.equal(standing.approved, false);
  assert.equal(standing.returns, 1);
  assert.equal(standing.rounds, 2);
});

test("the number of returns is the number a partner asks for", () => {
  const standing = standingOf([
    decided(1, "returned"), decided(2, "returned"), decided(3, "returned"), decided(4, "approved"),
  ]);
  assert.equal(standing.approved, true);
  assert.equal(standing.returns, 3);
  assert.equal(standingSummary(standing), "Approved after 3 returns");
  assert.equal(standingSummary(standingOf([decided(1, "approved")])), "Approved first time");
});

test("rounds are read in order however they arrive", () => {
  const standing = standingOf([decided(2, "approved"), decided(1, "returned")]);
  assert.equal(standing.approved, true, "round 2 is the latest, whatever order the rows came in");
});

test("submitting needs a reviewer, and cannot be to yourself", () => {
  const clean = standingOf([]);
  assert.equal(refuseSubmit({ itemStatus: "at_risk", reviewerUserId: REVIEWER, standing: clean, submitterUserId: PREPARER }), null);
  assert.equal(refuseSubmit({ itemStatus: "at_risk", reviewerUserId: null, standing: clean, submitterUserId: PREPARER }), "no_reviewer");
  assert.equal(refuseSubmit({ itemStatus: "at_risk", reviewerUserId: REVIEWER, standing: clean, submitterUserId: REVIEWER }), "self_review");
});

test("work already with a reviewer cannot be submitted again", () => {
  const open = standingOf([round({ round: 1 })]);
  assert.equal(refuseSubmit({ itemStatus: "review", reviewerUserId: REVIEWER, standing: open, submitterUserId: PREPARER }), "already_open");
});

test("a completed obligation is not submitted for a further round", () => {
  assert.equal(
    refuseSubmit({ itemStatus: "completed", reviewerUserId: REVIEWER, standing: standingOf([]), submitterUserId: PREPARER }),
    "completed",
  );
});

test("only the reviewer the work went to can decide it", () => {
  const open = { reviewerUserId: REVIEWER, submittedByUserId: PREPARER };
  assert.equal(refuseDecision({ actorUserId: REVIEWER, decisionNote: "", openRound: open, outcome: "approved" }), null);
  // A partner who was not asked cannot sign off in the reviewer's name.
  assert.equal(refuseDecision({ actorUserId: PARTNER, decisionNote: "", openRound: open, outcome: "approved" }), "not_the_reviewer");
});

test("nobody decides a round they submitted themselves", () => {
  // This is the control. The status could always be set from a dropdown; an
  // approval needs somebody other than the person who did the work.
  const own = { reviewerUserId: REVIEWER, submittedByUserId: REVIEWER };
  assert.equal(refuseDecision({ actorUserId: REVIEWER, decisionNote: "", openRound: own, outcome: "approved" }), "self_review");
});

test("returning work requires saying why", () => {
  const open = { reviewerUserId: REVIEWER, submittedByUserId: PREPARER };
  assert.equal(refuseDecision({ actorUserId: REVIEWER, decisionNote: "", openRound: open, outcome: "returned" }), "reason_required");
  assert.equal(refuseDecision({ actorUserId: REVIEWER, decisionNote: "  ", openRound: open, outcome: "returned" }), "reason_required");
  assert.equal(refuseDecision({ actorUserId: REVIEWER, decisionNote: "Input credit does not tie to 2B", openRound: open, outcome: "returned" }), null);
  // Approving needs no essay; the approval is the statement.
  assert.equal(refuseDecision({ actorUserId: REVIEWER, decisionNote: "", openRound: open, outcome: "approved" }), null);
});

test("deciding nothing, or deciding an unknown outcome, is refused", () => {
  assert.equal(refuseDecision({ actorUserId: REVIEWER, decisionNote: "", openRound: null, outcome: "approved" }), "no_open_round");
  assert.equal(
    refuseDecision({ actorUserId: REVIEWER, decisionNote: "", openRound: { reviewerUserId: REVIEWER, submittedByUserId: PREPARER }, outcome: "maybe" }),
    "unknown_outcome",
  );
});

test("work with no reviewer completes exactly as it always did", () => {
  // Naming a reviewer is how the firm says this obligation needs one.
  assert.equal(refuseCompletion({ reviewerUserId: null, standing: standingOf([]) }), null);
  assert.equal(refuseCompletion({ reviewerUserId: null, standing: standingOf([decided(1, "returned")]) }), null);
});

test("work with a reviewer needs their approval to complete", () => {
  assert.equal(refuseCompletion({ reviewerUserId: REVIEWER, standing: standingOf([]) }), "review_outstanding");
  assert.equal(refuseCompletion({ reviewerUserId: REVIEWER, standing: standingOf([decided(1, "returned")]) }), "review_outstanding");
  assert.equal(refuseCompletion({ reviewerUserId: REVIEWER, standing: standingOf([round({ round: 1 })]) }), "review_open");
  assert.equal(refuseCompletion({ reviewerUserId: REVIEWER, standing: standingOf([decided(1, "approved")]) }), null);
});

test("an approval that has since been superseded no longer lets work complete", () => {
  const superseded = standingOf([decided(1, "approved"), round({ round: 2 })]);
  assert.equal(refuseCompletion({ reviewerUserId: REVIEWER, standing: superseded }), "review_open");
});

test("rounds and outcomes read as English", () => {
  assert.equal(roundLabel(decided(2, "approved")), "Round 2 · Approved");
  assert.equal(roundLabel(round({ round: 3 })), "Round 3 · awaiting decision");
  assert.ok(isReviewOutcome("returned"));
  assert.ok(!isReviewOutcome("rejected"));
  for (const outcome of REVIEW_OUTCOMES) assert.ok(OUTCOME_LABELS[outcome].length > 0);
});
