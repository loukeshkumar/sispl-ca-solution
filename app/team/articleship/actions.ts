"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "../../../lib/auth/server";
import { indiaDateKey } from "../../../lib/attendance/calculations";
import { getDatabase } from "../../../lib/dashboard/postgres/pool";
import {
  ArticleshipError,
  endRegistration,
  recordIndustrialTraining,
  registerArticle,
  saveArticleshipPolicy,
} from "../../../lib/articleship/repository";
import type { ArticleshipStatus } from "../../../lib/articleship/register";

export type ArticleshipActionState = { error: string; fieldErrors: Record<string, string> };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const refresh = () => {
  revalidatePath("/team/articleship");
  revalidatePath("/team/[employeeId]", "page");
  revalidatePath("/");
};

const failure = (error: unknown): ArticleshipActionState => ({
  error: error instanceof ArticleshipError ? error.message : "That could not be saved. Refresh and try again.",
  fieldErrors: {},
});

const optionalDate = (formData: FormData, name: string) => {
  const value = String(formData.get(name) ?? "").trim();
  return value === "" ? null : value;
};

export async function registerArticleAction(_previous: ArticleshipActionState, formData: FormData): Promise<ArticleshipActionState> {
  const session = await requirePermission("team:manage", "/team/articleship");
  const articleUserId = String(formData.get("articleUserId") ?? "");
  const principalUserId = String(formData.get("principalUserId") ?? "");
  if (!UUID_PATTERN.test(articleUserId)) return { error: "Choose an articled assistant.", fieldErrors: {} };
  if (!UUID_PATTERN.test(principalUserId)) return { error: "Choose a principal.", fieldErrors: {} };

  try {
    await registerArticle(getDatabase(), session.tenantId, session.userId, {
      articleUserId,
      commencedOn: String(formData.get("commencedOn") ?? ""),
      deedDate: optionalDate(formData, "deedDate"),
      form103Date: optionalDate(formData, "form103Date"),
      note: String(formData.get("note") ?? ""),
      principalUserId,
      registrationNumber: String(formData.get("registrationNumber") ?? ""),
    });
  } catch (error) {
    return failure(error);
  }
  refresh();
  return { error: "", fieldErrors: {} };
}

export async function endRegistrationAction(_previous: ArticleshipActionState, formData: FormData): Promise<ArticleshipActionState> {
  const session = await requirePermission("team:manage", "/team/articleship");
  const registrationId = String(formData.get("registrationId") ?? "");
  if (!UUID_PATTERN.test(registrationId)) return { error: "Choose a registration.", fieldErrors: {} };

  try {
    await endRegistration(getDatabase(), session.tenantId, session.userId, {
      endedOn: String(formData.get("endedOn") ?? ""),
      formDate: optionalDate(formData, "formDate"),
      reason: String(formData.get("reason") ?? ""),
      registrationId,
      status: String(formData.get("status") ?? "") as Exclude<ArticleshipStatus, "active">,
    });
  } catch (error) {
    return failure(error);
  }
  refresh();
  return { error: "", fieldErrors: {} };
}

export async function recordIndustrialTrainingAction(_previous: ArticleshipActionState, formData: FormData): Promise<ArticleshipActionState> {
  const session = await requirePermission("team:manage", "/team/articleship");
  const registrationId = String(formData.get("registrationId") ?? "");
  if (!UUID_PATTERN.test(registrationId)) return { error: "Choose a registration.", fieldErrors: {} };

  try {
    await recordIndustrialTraining(getDatabase(), session.tenantId, session.userId, {
      employer: String(formData.get("employer") ?? ""),
      from: optionalDate(formData, "from"),
      registrationId,
      to: optionalDate(formData, "to"),
    });
  } catch (error) {
    return failure(error);
  }
  refresh();
  return { error: "", fieldErrors: {} };
}

export async function saveArticleshipPolicyAction(_previous: ArticleshipActionState, formData: FormData): Promise<ArticleshipActionState> {
  const session = await requirePermission("team:manage", "/team/articleship");
  const months = Number(String(formData.get("trainingMonths") ?? ""));
  const numerator = Number(String(formData.get("leaveFractionNumerator") ?? ""));
  const denominator = Number(String(formData.get("leaveFractionDenominator") ?? ""));

  if (!Number.isInteger(months) || months < 1 || months > 60) {
    return { error: "Review the highlighted fields.", fieldErrors: { trainingMonths: "Enter the training period in months, between 1 and 60." } };
  }
  if (!Number.isInteger(numerator) || !Number.isInteger(denominator) || numerator < 1 || denominator < 1 || numerator > denominator) {
    return { error: "Review the highlighted fields.", fieldErrors: { leaveFraction: "Enter a fraction such as 1 in 6." } };
  }

  try {
    await saveArticleshipPolicy(getDatabase(), session.tenantId, session.userId, {
      confirmed: String(formData.get("confirmed") ?? "") === "on",
      effectiveFrom: String(formData.get("effectiveFrom") ?? "") || indiaDateKey(),
      leaveFractionDenominator: denominator,
      leaveFractionNumerator: numerator,
      note: String(formData.get("note") ?? ""),
      trainingMonths: months,
    });
  } catch (error) {
    return failure(error);
  }
  refresh();
  return { error: "", fieldErrors: {} };
}
