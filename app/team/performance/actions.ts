"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requirePermission } from "../../../lib/auth/server";
import { indiaDateKey } from "../../../lib/attendance/calculations";
import { getDatabase } from "../../../lib/dashboard/postgres/pool";
import { DIMENSIONS } from "../../../lib/performance/review";
import {
  acknowledgeReview,
  createReview,
  PerformanceError,
  saveReviewDraft,
  shareReview,
} from "../../../lib/performance/repository";

export type PerformanceActionState = { error: string; fieldErrors: Record<string, string> };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const refresh = (reviewId?: string) => {
  revalidatePath("/team/performance");
  if (reviewId) revalidatePath("/team/performance/[reviewId]", "page");
  revalidatePath("/team/[employeeId]", "page");
};

const failure = (error: unknown): PerformanceActionState => ({
  error: error instanceof PerformanceError ? error.message : "That could not be saved. Refresh and try again.",
  fieldErrors: {},
});

export async function createReviewAction(_previous: PerformanceActionState, formData: FormData): Promise<PerformanceActionState> {
  const session = await requirePermission("performance:review", "/team/performance");
  const employeeUserId = String(formData.get("employeeUserId") ?? "");
  const reviewerUserId = String(formData.get("reviewerUserId") ?? "") || session.userId;
  if (!UUID_PATTERN.test(employeeUserId)) return { error: "Choose who is being reviewed.", fieldErrors: {} };
  if (!UUID_PATTERN.test(reviewerUserId)) return { error: "Choose a reviewer.", fieldErrors: {} };

  let reviewId: string;
  try {
    reviewId = await createReview(getDatabase(), session.tenantId, session.userId, {
      employeeUserId,
      periodFrom: String(formData.get("periodFrom") ?? ""),
      periodTo: String(formData.get("periodTo") ?? ""),
      reviewerUserId,
    });
  } catch (error) {
    return failure(error);
  }
  refresh();
  redirect(`/team/performance/${reviewId}`);
}

export async function saveReviewAction(_previous: PerformanceActionState, formData: FormData): Promise<PerformanceActionState> {
  const session = await requirePermission("performance:review", "/team/performance");
  const reviewId = String(formData.get("reviewId") ?? "");
  if (!UUID_PATTERN.test(reviewId)) return { error: "That review could not be found.", fieldErrors: {} };

  try {
    await saveReviewDraft(getDatabase(), session.tenantId, session.userId, {
      development: String(formData.get("development") ?? ""),
      overallRating: String(formData.get("overallRating") ?? ""),
      ratings: DIMENSIONS.map((dimension) => ({
        dimension,
        note: String(formData.get(`note-${dimension}`) ?? ""),
        rating: String(formData.get(`rating-${dimension}`) ?? ""),
      })).filter((entry) => entry.rating !== ""),
      reviewId,
      strengths: String(formData.get("strengths") ?? ""),
    });
  } catch (error) {
    return failure(error);
  }
  refresh(reviewId);
  return { error: "", fieldErrors: {} };
}

export async function shareReviewAction(_previous: PerformanceActionState, formData: FormData): Promise<PerformanceActionState> {
  const session = await requirePermission("performance:review", "/team/performance");
  const reviewId = String(formData.get("reviewId") ?? "");
  if (!UUID_PATTERN.test(reviewId)) return { error: "That review could not be found.", fieldErrors: {} };
  try {
    await shareReview(getDatabase(), session.tenantId, session.userId, reviewId, indiaDateKey());
  } catch (error) {
    return failure(error);
  }
  refresh(reviewId);
  return { error: "", fieldErrors: {} };
}

/** Only the person the review is about can acknowledge it. */
export async function acknowledgeReviewAction(_previous: PerformanceActionState, formData: FormData): Promise<PerformanceActionState> {
  const session = await requirePermission("dashboard:read", "/team/performance");
  const reviewId = String(formData.get("reviewId") ?? "");
  if (!UUID_PATTERN.test(reviewId)) return { error: "That review could not be found.", fieldErrors: {} };
  try {
    await acknowledgeReview(getDatabase(), session.tenantId, session.userId, reviewId);
  } catch (error) {
    return failure(error);
  }
  refresh(reviewId);
  return { error: "", fieldErrors: {} };
}
