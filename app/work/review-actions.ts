"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "../../lib/auth/server";
import { getDatabase } from "../../lib/dashboard/postgres/pool";
import { decideReview, ReviewError, submitForReview } from "../../lib/reviews/repository";

export type ReviewActionState = { error: string; fieldErrors: Record<string, string> };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const refresh = () => {
  revalidatePath("/work/[workItemId]", "page");
  revalidatePath("/");
};

const failure = (error: unknown): ReviewActionState => ({
  error: error instanceof ReviewError ? error.message : "That review could not be recorded. Refresh and try again.",
  fieldErrors: {},
});

export async function submitForReviewAction(_previous: ReviewActionState, formData: FormData): Promise<ReviewActionState> {
  const session = await requirePermission("work:write", "/?workspace=work");
  const workItemId = String(formData.get("workItemId") ?? "");
  if (!UUID_PATTERN.test(workItemId)) return { error: "That obligation could not be found.", fieldErrors: {} };
  try {
    await submitForReview(getDatabase(), session.tenantId, session.userId, workItemId, String(formData.get("submissionNote") ?? ""));
  } catch (error) {
    return failure(error);
  }
  refresh();
  return { error: "", fieldErrors: {} };
}

/**
 * Deciding is the reviewer's act, so the repository checks the actor is the
 * person the work was actually submitted to — the permission alone is not the
 * control here.
 */
export async function decideReviewAction(_previous: ReviewActionState, formData: FormData): Promise<ReviewActionState> {
  const session = await requirePermission("work:write", "/?workspace=work");
  const workItemId = String(formData.get("workItemId") ?? "");
  if (!UUID_PATTERN.test(workItemId)) return { error: "That obligation could not be found.", fieldErrors: {} };
  try {
    await decideReview(
      getDatabase(), session.tenantId, session.userId, workItemId,
      String(formData.get("outcome") ?? ""), String(formData.get("decisionNote") ?? ""),
    );
  } catch (error) {
    return failure(error);
  }
  refresh();
  return { error: "", fieldErrors: {} };
}
