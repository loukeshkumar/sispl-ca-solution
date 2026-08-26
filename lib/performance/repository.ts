import { and, asc, desc, eq, gte, inArray, lte, ne, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import {
  attendanceDays,
  auditEvents,
  employeeCapabilities,
  employeeProfiles,
  performanceReviewRatings,
  performanceReviews,
  tenantMemberships,
  trainingRecords,
  users,
  workItems,
} from "../../db/schema";
import type { DashboardDatabase } from "../dashboard/postgres/repository";
import { listFirmUtilisation } from "../rates/utilisation-repository";
import { listTrainingWorkspace } from "../training/repository";
import { BAND_LABELS as CPE_BAND_LABELS } from "../training/cpe";
import {
  buildEvidence,
  isDimension,
  isRating,
  monthsInPeriod,
  shareBlockers,
  type Dimension,
  type EvidenceItem,
  type Rating,
  type RatingEntry,
  type ReviewStatus,
} from "./review";

/**
 * Reading and writing performance reviews.
 *
 * The evidence pack is assembled from the modules that already own each figure
 * rather than recomputed here, so a review cannot disagree with the workspace a
 * manager was looking at ten minutes earlier.
 */

export class PerformanceError extends Error {
  constructor(public readonly code:
    | "not_found" | "self_review" | "invalid_period" | "invalid_rating"
    | "already_shared" | "not_shared" | "incomplete" | "duplicate") {
    super({
      not_found: "That review was not found.",
      self_review: "You cannot review yourself.",
      invalid_period: "Check the period: it cannot end before it begins.",
      invalid_rating: "Choose a rating for each dimension.",
      already_shared: "This review has been shared and can no longer be edited.",
      not_shared: "This review has not been shared yet.",
      incomplete: "Rate every dimension, give an overall rating, and write both notes before sharing.",
      duplicate: "A review already exists for this person and period.",
    }[code]);
    this.name = "PerformanceError";
  }
}

const employee = alias(users, "review_employee");
const reviewer = alias(users, "review_reviewer");

export type ReviewRow = {
  acknowledgedAt: string | null;
  development: string;
  employeeName: string;
  employeeUserId: string;
  id: string;
  overallRating: Rating | null;
  periodFrom: string;
  periodTo: string;
  reviewerName: string;
  reviewerUserId: string;
  sharedAt: string | null;
  status: ReviewStatus;
  strengths: string;
};

const reviewSelection = {
  acknowledgedAt: performanceReviews.acknowledgedAt,
  development: performanceReviews.development,
  employeeName: employee.fullName,
  employeeUserId: performanceReviews.employeeUserId,
  id: performanceReviews.id,
  overallRating: performanceReviews.overallRating,
  periodFrom: performanceReviews.periodFrom,
  periodTo: performanceReviews.periodTo,
  reviewerName: reviewer.fullName,
  reviewerUserId: performanceReviews.reviewerUserId,
  sharedAt: performanceReviews.sharedAt,
  status: performanceReviews.status,
  strengths: performanceReviews.strengths,
};

const toRow = (row: {
  acknowledgedAt: Date | null; development: string; employeeName: string; employeeUserId: string; id: string;
  overallRating: string | null; periodFrom: string; periodTo: string; reviewerName: string; reviewerUserId: string;
  sharedAt: Date | null; status: string; strengths: string;
}): ReviewRow => ({
  ...row,
  acknowledgedAt: row.acknowledgedAt?.toISOString() ?? null,
  overallRating: row.overallRating && isRating(row.overallRating) ? row.overallRating : null,
  sharedAt: row.sharedAt?.toISOString() ?? null,
  status: row.status as ReviewStatus,
});

export async function listReviews(
  database: DashboardDatabase,
  tenantId: string,
  options: { employeeUserId?: string } = {},
): Promise<ReviewRow[]> {
  const filters = [eq(performanceReviews.tenantId, tenantId)];
  if (options.employeeUserId) filters.push(eq(performanceReviews.employeeUserId, options.employeeUserId));
  const rows = await database.select(reviewSelection).from(performanceReviews)
    .innerJoin(employee, eq(employee.id, performanceReviews.employeeUserId))
    .innerJoin(reviewer, eq(reviewer.id, performanceReviews.reviewerUserId))
    .where(and(...filters))
    .orderBy(desc(performanceReviews.periodTo), asc(employee.fullName));
  return rows.map(toRow);
}

export type ReviewDetail = ReviewRow & {
  /** Live while the review is a draft; frozen once it has been shared. */
  evidence: EvidenceItem[];
  evidenceIsSnapshot: boolean;
  ratings: RatingEntry[];
};

export async function getReview(
  database: DashboardDatabase,
  tenantId: string,
  reviewId: string,
  todayKey: string,
): Promise<ReviewDetail | null> {
  const [row] = await database.select({ ...reviewSelection, evidenceSnapshot: performanceReviews.evidenceSnapshot })
    .from(performanceReviews)
    .innerJoin(employee, eq(employee.id, performanceReviews.employeeUserId))
    .innerJoin(reviewer, eq(reviewer.id, performanceReviews.reviewerUserId))
    .where(and(eq(performanceReviews.tenantId, tenantId), eq(performanceReviews.id, reviewId)))
    .limit(1);
  if (!row) return null;

  const ratingRows = await database.select({
    dimension: performanceReviewRatings.dimension,
    note: performanceReviewRatings.note,
    rating: performanceReviewRatings.rating,
  }).from(performanceReviewRatings)
    .where(and(eq(performanceReviewRatings.tenantId, tenantId), eq(performanceReviewRatings.reviewId, reviewId)));

  const base = toRow(row);
  // A shared review shows the figures it was shared on. Recomputing them would
  // let the ground move under a conversation that has already happened.
  const snapshot = row.evidenceSnapshot ? safeParse(row.evidenceSnapshot) : null;
  const evidence = snapshot ?? await gatherEvidence(database, tenantId, base.employeeUserId, base.periodFrom, base.periodTo, todayKey);

  return {
    ...base,
    evidence,
    evidenceIsSnapshot: snapshot !== null,
    ratings: ratingRows
      .filter((entry) => isDimension(entry.dimension) && isRating(entry.rating))
      .map((entry) => ({ dimension: entry.dimension as Dimension, note: entry.note, rating: entry.rating as Rating })),
  };
}

function safeParse(value: string): EvidenceItem[] | null {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as EvidenceItem[]) : null;
  } catch {
    return null;
  }
}

/**
 * Assemble the pack for one person over one period.
 *
 * Every figure comes from the module that owns it, so nothing here is a second
 * implementation of a number the firm can already see elsewhere.
 */
export async function gatherEvidence(
  database: DashboardDatabase,
  tenantId: string,
  employeeUserId: string,
  periodFrom: string,
  periodTo: string,
  todayKey: string,
): Promise<EvidenceItem[]> {
  const months = monthsInPeriod(periodFrom, periodTo);

  const [utilisationMonths, completed, overdue, reviewed, capabilities, attendance, training] = await Promise.all([
    Promise.all(months.map((month) => listFirmUtilisation(database, tenantId, month).catch(() => null))),
    database.select({ value: sql<number>`count(*)::int` }).from(workItems).where(and(
      eq(workItems.tenantId, tenantId), eq(workItems.assigneeId, employeeUserId), eq(workItems.status, "completed"),
      gte(workItems.updatedAt, new Date(`${periodFrom}T00:00:00Z`)),
      lte(workItems.updatedAt, new Date(`${periodTo}T23:59:59Z`)),
    )),
    database.select({ value: sql<number>`count(*)::int` }).from(workItems).where(and(
      eq(workItems.tenantId, tenantId), eq(workItems.assigneeId, employeeUserId),
      ne(workItems.status, "completed"), sql`${workItems.statutoryDueDate} < ${todayKey}`,
    )),
    database.select({ value: sql<number>`count(*)::int` }).from(workItems).where(and(
      eq(workItems.tenantId, tenantId), eq(workItems.reviewerId, employeeUserId), eq(workItems.status, "completed"),
      gte(workItems.updatedAt, new Date(`${periodFrom}T00:00:00Z`)),
      lte(workItems.updatedAt, new Date(`${periodTo}T23:59:59Z`)),
    )),
    database.select({ level: employeeCapabilities.level }).from(employeeCapabilities).where(and(
      eq(employeeCapabilities.tenantId, tenantId), eq(employeeCapabilities.employeeUserId, employeeUserId),
    )),
    database.select({
      lateCount: sql<number>`count(*) filter (where ${attendanceDays.status} = 'late')::int`,
      exceptions: sql<number>`count(*) filter (where ${attendanceDays.status} in ('absent', 'missing_punch'))::int`,
    }).from(attendanceDays).where(and(
      eq(attendanceDays.tenantId, tenantId), eq(attendanceDays.employeeUserId, employeeUserId),
      gte(attendanceDays.attendanceDate, periodFrom), lte(attendanceDays.attendanceDate, periodTo),
    )),
    database.select({ minutes: sql<number>`coalesce(sum(${trainingRecords.minutes}), 0)::int` })
      .from(trainingRecords).where(and(
        eq(trainingRecords.tenantId, tenantId), eq(trainingRecords.employeeUserId, employeeUserId),
        gte(trainingRecords.completedOn, periodFrom), lte(trainingRecords.completedOn, periodTo),
      )),
  ]);

  const mine = utilisationMonths
    .flatMap((month) => month?.people ?? [])
    .filter((person) => person.employeeUserId === employeeUserId);
  const availableMinutes = mine.reduce((total, person) => total + person.availableMinutes, 0);
  const chargeableMinutes = mine.reduce((total, person) => total + person.chargeableMinutes, 0);
  const recordedMinutes = mine.reduce((total, person) => total + person.recordedMinutes, 0);
  // Targets are effective-dated; the one in force at the end of the period is
  // the one the person was being managed to when it closed.
  const targetBasisPoints = mine.at(-1)?.targetBasisPoints ?? null;

  const counts = { learning: 0, prepare: 0, review: 0, sign: 0 };
  for (const row of capabilities) {
    if (row.level in counts) counts[row.level as keyof typeof counts] += 1;
  }

  const cpe = await listTrainingWorkspace(database, tenantId, todayKey).catch(() => null);
  const standing = cpe?.members.find((member) => member.employeeUserId === employeeUserId);

  return buildEvidence({
    attendanceExceptions: attendance[0]?.exceptions ?? 0,
    availableMinutes,
    capabilityCounts: counts,
    chargeableMinutes,
    cpeBand: standing?.standing ? CPE_BAND_LABELS[standing.band] : null,
    lateCount: attendance[0]?.lateCount ?? 0,
    overdueNow: overdue[0]?.value ?? 0,
    recordedMinutes,
    reviewsPerformed: reviewed[0]?.value ?? 0,
    targetBasisPoints,
    trainingMinutes: training[0]?.minutes ?? 0,
    workCompleted: completed[0]?.value ?? 0,
  });
}

export type CreateReviewInput = {
  employeeUserId: string;
  periodFrom: string;
  periodTo: string;
  reviewerUserId: string;
};

export async function createReview(
  database: DashboardDatabase,
  tenantId: string,
  actorUserId: string,
  input: CreateReviewInput,
) {
  if (input.employeeUserId === input.reviewerUserId) throw new PerformanceError("self_review");
  if (input.periodTo < input.periodFrom) throw new PerformanceError("invalid_period");

  return database.transaction(async (transaction) => {
    const [existing] = await transaction.select({ id: performanceReviews.id }).from(performanceReviews).where(and(
      eq(performanceReviews.tenantId, tenantId),
      eq(performanceReviews.employeeUserId, input.employeeUserId),
      eq(performanceReviews.periodFrom, input.periodFrom),
      eq(performanceReviews.periodTo, input.periodTo),
    )).limit(1);
    if (existing) throw new PerformanceError("duplicate");

    const [saved] = await transaction.insert(performanceReviews).values({
      tenantId,
      employeeUserId: input.employeeUserId,
      reviewerUserId: input.reviewerUserId,
      periodFrom: input.periodFrom,
      periodTo: input.periodTo,
      status: "draft",
      createdByUserId: actorUserId,
    }).returning({ id: performanceReviews.id });

    await transaction.insert(auditEvents).values({
      tenantId, actorUserId, resourceType: "performance_review", resourceId: saved!.id,
      action: "performance.opened", reason: `${input.periodFrom} to ${input.periodTo}`,
    });
    return saved!.id;
  });
}

export type SaveReviewInput = {
  development: string;
  overallRating: string;
  ratings: Array<{ dimension: string; note: string; rating: string }>;
  reviewId: string;
  strengths: string;
};

/** Saves a draft. A shared review is a record of a conversation, so it is sealed. */
export async function saveReviewDraft(
  database: DashboardDatabase,
  tenantId: string,
  actorUserId: string,
  input: SaveReviewInput,
) {
  await database.transaction(async (transaction) => {
    const [current] = await transaction.select({ status: performanceReviews.status }).from(performanceReviews)
      .where(and(eq(performanceReviews.tenantId, tenantId), eq(performanceReviews.id, input.reviewId)))
      .limit(1).for("update");
    if (!current) throw new PerformanceError("not_found");
    if (current.status !== "draft") throw new PerformanceError("already_shared");

    await transaction.update(performanceReviews).set({
      development: input.development.slice(0, 4000),
      overallRating: isRating(input.overallRating) ? input.overallRating : null,
      strengths: input.strengths.slice(0, 4000),
      updatedAt: new Date(),
    }).where(and(eq(performanceReviews.tenantId, tenantId), eq(performanceReviews.id, input.reviewId)));

    for (const entry of input.ratings) {
      if (!isDimension(entry.dimension) || !isRating(entry.rating)) continue;
      await transaction.insert(performanceReviewRatings).values({
        tenantId, reviewId: input.reviewId, dimension: entry.dimension,
        rating: entry.rating, note: entry.note.slice(0, 2000),
      }).onConflictDoUpdate({
        target: [performanceReviewRatings.tenantId, performanceReviewRatings.reviewId, performanceReviewRatings.dimension],
        set: { rating: entry.rating, note: entry.note.slice(0, 2000), updatedAt: new Date() },
      });
    }
  });
}

/**
 * Share the review with the person it is about.
 *
 * The evidence is frozen at this moment. From here the figures on the page are
 * the figures the conversation was had against, whatever the live numbers do.
 */
export async function shareReview(
  database: DashboardDatabase,
  tenantId: string,
  actorUserId: string,
  reviewId: string,
  todayKey: string,
) {
  await database.transaction(async (transaction) => {
    const [current] = await transaction.select({
      development: performanceReviews.development,
      employeeUserId: performanceReviews.employeeUserId,
      overallRating: performanceReviews.overallRating,
      periodFrom: performanceReviews.periodFrom,
      periodTo: performanceReviews.periodTo,
      status: performanceReviews.status,
      strengths: performanceReviews.strengths,
    }).from(performanceReviews)
      .where(and(eq(performanceReviews.tenantId, tenantId), eq(performanceReviews.id, reviewId)))
      .limit(1).for("update");
    if (!current) throw new PerformanceError("not_found");
    if (current.status !== "draft") throw new PerformanceError("already_shared");

    const ratingRows = await transaction.select({
      dimension: performanceReviewRatings.dimension,
      note: performanceReviewRatings.note,
      rating: performanceReviewRatings.rating,
    }).from(performanceReviewRatings)
      .where(and(eq(performanceReviewRatings.tenantId, tenantId), eq(performanceReviewRatings.reviewId, reviewId)));

    const blockers = shareBlockers({
      development: current.development,
      entries: ratingRows.filter((entry) => isDimension(entry.dimension) && isRating(entry.rating))
        .map((entry) => ({ dimension: entry.dimension as Dimension, note: entry.note, rating: entry.rating as Rating })),
      overallRating: current.overallRating,
      strengths: current.strengths,
    });
    if (blockers.length > 0) throw new PerformanceError("incomplete");

    const evidence = await gatherEvidence(
      transaction, tenantId, current.employeeUserId, current.periodFrom, current.periodTo, todayKey,
    );

    await transaction.update(performanceReviews).set({
      status: "shared",
      sharedAt: new Date(),
      evidenceSnapshot: JSON.stringify(evidence),
      updatedAt: new Date(),
    }).where(and(eq(performanceReviews.tenantId, tenantId), eq(performanceReviews.id, reviewId)));

    await transaction.insert(auditEvents).values({
      tenantId, actorUserId, resourceType: "performance_review", resourceId: reviewId,
      action: "performance.shared", reason: `Overall: ${current.overallRating}`,
    });
  });
}

/** The employee confirming they have seen it. Only they can do this. */
export async function acknowledgeReview(
  database: DashboardDatabase,
  tenantId: string,
  actorUserId: string,
  reviewId: string,
) {
  await database.transaction(async (transaction) => {
    const [updated] = await transaction.update(performanceReviews).set({
      status: "acknowledged", acknowledgedAt: new Date(), updatedAt: new Date(),
    }).where(and(
      eq(performanceReviews.tenantId, tenantId),
      eq(performanceReviews.id, reviewId),
      eq(performanceReviews.employeeUserId, actorUserId),
      eq(performanceReviews.status, "shared"),
    )).returning({ id: performanceReviews.id });
    if (!updated) throw new PerformanceError("not_shared");

    await transaction.insert(auditEvents).values({
      tenantId, actorUserId, resourceType: "performance_review", resourceId: reviewId,
      action: "performance.acknowledged", reason: "Seen by the employee",
    });
  });
}

/** Who can be reviewed, and who can review them. */
export async function listReviewSubjects(database: DashboardDatabase, tenantId: string) {
  const rows = await database.select({
    fullName: users.fullName,
    roleKey: tenantMemberships.roleKey,
    userId: employeeProfiles.userId,
  }).from(employeeProfiles)
    .innerJoin(users, eq(users.id, employeeProfiles.userId))
    .innerJoin(tenantMemberships, and(
      eq(tenantMemberships.tenantId, employeeProfiles.tenantId),
      eq(tenantMemberships.userId, employeeProfiles.userId),
    ))
    .where(and(eq(employeeProfiles.tenantId, tenantId), eq(tenantMemberships.status, "active")))
    .orderBy(asc(users.fullName));
  return rows;
}

export const reviewsForEmployees = async (database: DashboardDatabase, tenantId: string, userIds: readonly string[]) =>
  userIds.length === 0 ? [] : database.select({ id: performanceReviews.id }).from(performanceReviews)
    .where(and(eq(performanceReviews.tenantId, tenantId), inArray(performanceReviews.employeeUserId, [...userIds])));
