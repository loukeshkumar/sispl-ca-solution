"use server";

import { redirect } from "next/navigation";

import { changePassword, PasswordChangeError } from "../../../lib/auth/repository";
import { clearSessionCookie, getCurrentAuthSession } from "../../../lib/auth/server";
import { getDatabase } from "../../../lib/dashboard/postgres/pool";

export type PasswordChangeState = { error: string; fieldErrors: Partial<Record<"currentPassword" | "newPassword" | "confirmPassword", string>> };

type SubmittedPassword = { currentPassword: string; newPassword: string; fieldErrors: PasswordChangeState["fieldErrors"] };

/** Shared by the forced first sign-in and the voluntary change. */
function readSubmission(formData: FormData, currentLabel: string): SubmittedPassword {
  const currentPassword = String(formData.get("currentPassword") ?? "");
  const newPassword = String(formData.get("newPassword") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");
  const fieldErrors: PasswordChangeState["fieldErrors"] = {};
  if (!currentPassword) fieldErrors.currentPassword = `Enter the ${currentLabel}.`;
  if (newPassword.length < 12 || newPassword.length > 128) fieldErrors.newPassword = "Use between 12 and 128 characters.";
  if (confirmPassword !== newPassword) fieldErrors.confirmPassword = "Passwords do not match.";
  return { currentPassword, newPassword, fieldErrors };
}

export async function changePasswordAction(_previous: PasswordChangeState, formData: FormData): Promise<PasswordChangeState> {
  const session = await getCurrentAuthSession();
  if (!session) redirect("/login");
  if (!session.mustChangePassword) redirect("/");
  const { currentPassword, newPassword, fieldErrors } = readSubmission(formData, "temporary password");
  if (Object.keys(fieldErrors).length) return { error: "Review the highlighted fields.", fieldErrors };
  try {
    await changePassword(getDatabase(), session.userId, currentPassword, newPassword);
  } catch (error) {
    if (error instanceof PasswordChangeError && error.code === "invalid_current") {
      return { error: "The temporary password is incorrect.", fieldErrors: { currentPassword: "Check the temporary password and try again." } };
    }
    return { error: "The password could not be changed. Request fresh access from your administrator.", fieldErrors: {} };
  }
  await clearSessionCookie();
  redirect("/login?passwordChanged=1");
}

/**
 * A change nobody demanded.
 *
 * It ends the same way as the forced one — every session revoked and back to
 * the sign-in screen — because a password change that left the old sessions
 * alive would not actually lock anybody out.
 */
export async function changeOwnPasswordAction(_previous: PasswordChangeState, formData: FormData): Promise<PasswordChangeState> {
  const session = await getCurrentAuthSession();
  if (!session) redirect("/login");
  const { currentPassword, newPassword, fieldErrors } = readSubmission(formData, "current password");
  if (Object.keys(fieldErrors).length) return { error: "Review the highlighted fields.", fieldErrors };
  try {
    await changePassword(getDatabase(), session.userId, currentPassword, newPassword);
  } catch (error) {
    if (error instanceof PasswordChangeError && error.code === "invalid_current") {
      return { error: "The current password is incorrect.", fieldErrors: { currentPassword: "Check the current password and try again." } };
    }
    if (error instanceof PasswordChangeError && error.code === "invalid_new") {
      return { error: "Choose a password you have not used here before.", fieldErrors: { newPassword: "Use a different password of 12 to 128 characters." } };
    }
    return { error: "The password could not be changed. Try again.", fieldErrors: {} };
  }
  await clearSessionCookie();
  redirect("/login?passwordChanged=1");
}
