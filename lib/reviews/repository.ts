import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { auditEvents, tenantMemberships, users, workItems, workReviewRounds } from "../../db/schema";
import type { DashboardDatabase } from "../dashboard/postgres/repository";
import {
  DECIDE_REFUSAL_NOTES,
  refuseDecision,
  refuseSubmit,
  standingOf,
  SUBMIT_REFUSAL_NOTES,
  type DecideRefusal,
  type SubmitRefusal,
  type ReviewOutcome,
  type ReviewRound,
  type ReviewStanding,
} from "./rounds";

/**
 * Opening and closing rounds of review.
 *
 * The database refuses self-approval and a second open round on its own; these
 * functions refuse the same things earlier so the message a person reads is a
 * sentence rather than a constraint name.
 */

export class ReviewError extends Error {
  constructor(
    public readonly code: "not_found" | SubmitRefusal | DecideRefusal,
    message?: string,
  ) {
    // `self_review` means two different sentences depending on which end of the
    // round it happened at, so the caller passes the wording that fits.
    super(message ?? "That obligation was not found.");
    this.name = "ReviewError";
  }
}

const submitter = alias(users, "review_submitter");
const decider = alias(users, "review_decider");
const reviewer = alias(users, "review_reviewer");

export type ReviewRoundRow = ReviewRound & {
  decidedByName: string | null;
  decisionNote: string;
  id: string;
  reviewerName: string;
  submissionNote: string;
  submittedAt: string;
  submittedByName: string;
};

export async function listReviewRounds(
  database: DashboardDatabase,
  tenantId: string,
  workItemId: string,
): Promise<ReviewRoundRow[]> {
  const rows = await database.select({
    decidedAt: workReviewRounds.decidedAt,
    decidedByName: decider.fullName,
    decidedByUserId: workReviewRounds.decidedByUserId,
    decisionNote: workReviewRounds.decisionNote,
    id: workReviewRounds.id,
    outcome: workReviewRounds.outcome,
    reviewerName: reviewer.fullName,
    reviewerUserId: workReviewRounds.reviewerUserId,
    round: workReviewRounds.round,
    submissionNote: workReviewRounds.submissionNote,
    submittedAt: workReviewRounds.submittedAt,
    submittedByName: submitter.fullName,
    submittedByUserId: workReviewRounds.submittedByUserId,
  }).from(workReviewRounds)
    .innerJoin(submitter, eq(submitter.id, workReviewRounds.submittedByUserId))
    .innerJoin(reviewer, eq(reviewer.id, workReviewRounds.reviewerUserId))
    .leftJoin(decider, eq(decider.id, workReviewRounds.decidedByUserId))
    .where(and(eq(workReviewRounds.tenantId, tenantId), eq(workReviewRounds.workItemId, workItemId)))
    .orderBy(desc(workReviewRounds.round));

  return rows.map((row) => ({
    ...row,
    decidedAt: row.decidedAt?.toISOString() ?? null,
    outcome: row.outcome as ReviewOutcome | null,
    submittedAt: row.submittedAt.toISOString(),
  }));
}

/** Where one obligation stands with its reviewer, without loading the prose. */
export async function reviewStanding(
  database: DashboardDatabase,
  tenantId: string,
  workItemId: string,
): Promise<ReviewStanding> {
  const rows = await database.select({
    decidedAt: workReviewRounds.decidedAt,
    decidedByUserId: workReviewRounds.decidedByUserId,
    outcome: workReviewRounds.outcome,
    reviewerUserId: workReviewRounds.reviewerUserId,
    round: workReviewRounds.round,
    submittedByUserId: workReviewRounds.submittedByUserId,
  }).from(workReviewRounds)
    .where(and(eq(workReviewRounds.tenantId, tenantId), eq(workReviewRounds.workItemId, workItemId)));

  return standingOf(rows.map((row) => ({
    ...row,
    decidedAt: row.decidedAt?.toISOString() ?? null,
    outcome: row.outcome as ReviewOutcome | null,
  })));
}

/**
 * Send the obligation to its reviewer, opening a round.
 *
 * The reviewer is snapshotted onto the round: changing the field afterwards must
 * not silently transfer a decision somebody else was asked to make.
 */
export async function submitForReview(
  database: DashboardDatabase,
  tenantId: string,
  actorUserId: string,
  workItemId: string,
  submissionNote: string,
) {
  return database.transaction(async (transaction) => {
    const [item] = await transaction.select({
      reviewerUserId: workItems.reviewerId,
      status: workItems.status,
    }).from(workItems)
      .where(and(eq(workItems.tenantId, tenantId), eq(workItems.id, workItemId)))
      .limit(1).for("update");
    if (!item) throw new ReviewError("not_found");

    const standing = await reviewStanding(transaction, tenantId, workItemId);
    const refusal = refuseSubmit({
      itemStatus: item.status,
      reviewerUserId: item.reviewerUserId,
      standing,
      submitterUserId: actorUserId,
    });
    if (refusal) throw new ReviewError(refusal, SUBMIT_REFUSAL_NOTES[refusal]);

    const round = standing.rounds + 1;
    const [saved] = await transaction.insert(workReviewRounds).values({
      tenantId,
      workItemId,
      round,
      reviewerUserId: item.reviewerUserId!,
      submittedByUserId: actorUserId,
      submissionNote: submissionNote.slice(0, 2000),
      // Kept so a return puts the obligation back where it was, rather than
      // quietly downgrading something that was critical before review.
      statusBeforeReview: item.status,
    }).returning({ id: workReviewRounds.id });

    await transaction.update(workItems).set({ status: "review", updatedAt: new Date() })
      .where(and(eq(workItems.tenantId, tenantId), eq(workItems.id, workItemId)));

    await transaction.insert(auditEvents).values({
      tenantId, actorUserId, resourceType: "work_item", resourceId: workItemId,
      action: "work.review_submitted",
      reason: `Round ${round}${submissionNote.trim() ? ` — ${submissionNote.trim().slice(0, 200)}` : ""}`,
    });
    return saved!.id;
  });
}

/**
 * Close the open round.
 *
 * Approving leaves the obligation in review, ready to be completed. Returning
 * puts it back into the state it was in before, so the preparer picks it up
 * where they left it rather than in a workflow state nobody chose.
 */
export async function decideReview(
  database: DashboardDatabase,
  tenantId: string,
  actorUserId: string,
  workItemId: string,
  outcome: string,
  decisionNote: string,
) {
  return database.transaction(async (transaction) => {
    const [open] = await transaction.select({
      id: workReviewRounds.id,
      reviewerUserId: workReviewRounds.reviewerUserId,
      round: workReviewRounds.round,
      statusBeforeReview: workReviewRounds.statusBeforeReview,
      submittedByUserId: workReviewRounds.submittedByUserId,
    }).from(workReviewRounds)
      .where(and(
        eq(workReviewRounds.tenantId, tenantId),
        eq(workReviewRounds.workItemId, workItemId),
        isNull(workReviewRounds.outcome),
      )).limit(1).for("update");

    const refusal = refuseDecision({
      actorUserId,
      decisionNote,
      openRound: open ? { reviewerUserId: open.reviewerUserId, submittedByUserId: open.submittedByUserId } : null,
      outcome,
    });
    if (refusal) throw new ReviewError(refusal, DECIDE_REFUSAL_NOTES[refusal]);

    const now = new Date();
    await transaction.update(workReviewRounds).set({
      outcome: outcome as ReviewOutcome,
      decidedByUserId: actorUserId,
      decidedAt: now,
      decisionNote: decisionNote.slice(0, 2000),
      updatedAt: now,
    }).where(and(eq(workReviewRounds.tenantId, tenantId), eq(workReviewRounds.id, open!.id)));

    if (outcome === "returned") {
      const restored = open!.statusBeforeReview === "review" ? "at_risk" : open!.statusBeforeReview;
      await transaction.update(workItems).set({ status: restored, updatedAt: now })
        .where(and(eq(workItems.tenantId, tenantId), eq(workItems.id, workItemId)));
    }

    await transaction.insert(auditEvents).values({
      tenantId, actorUserId, resourceType: "work_item", resourceId: workItemId,
      action: `work.review_${outcome}`,
      reason: `Round ${open!.round}${decisionNote.trim() ? ` — ${decisionNote.trim().slice(0, 200)}` : ""}`,
    });
  });
}

/** Rounds awaiting a decision from one reviewer, for their queue. */
export async function openRoundsFor(database: DashboardDatabase, tenantId: string, reviewerUserId: string) {
  return database.select({
    round: workReviewRounds.round,
    submittedAt: workReviewRounds.submittedAt,
    submittedByName: submitter.fullName,
    workItemId: workReviewRounds.workItemId,
  }).from(workReviewRounds)
    .innerJoin(submitter, eq(submitter.id, workReviewRounds.submittedByUserId))
    .where(and(
      eq(workReviewRounds.tenantId, tenantId),
      eq(workReviewRounds.reviewerUserId, reviewerUserId),
      isNull(workReviewRounds.outcome),
    ))
    .orderBy(asc(workReviewRounds.submittedAt));
}

/** How many times each of these obligations has come back, for a queue column. */
export const returnCounts = async (database: DashboardDatabase, tenantId: string, workItemIds: readonly string[]) =>
  workItemIds.length === 0 ? [] : database.select({
    returns: sql<number>`count(*) filter (where ${workReviewRounds.outcome} = 'returned')::int`,
    workItemId: workReviewRounds.workItemId,
  }).from(workReviewRounds)
    .where(and(
      eq(workReviewRounds.tenantId, tenantId),
      inArray(workReviewRounds.workItemId, [...workItemIds]),
    ))
    .groupBy(workReviewRounds.workItemId);

export const activeReviewers = async (database: DashboardDatabase, tenantId: string) =>
  database.select({ fullName: users.fullName, userId: tenantMemberships.userId }).from(tenantMemberships)
    .innerJoin(users, eq(users.id, tenantMemberships.userId))
    .where(and(eq(tenantMemberships.tenantId, tenantId), eq(tenantMemberships.status, "active")));
