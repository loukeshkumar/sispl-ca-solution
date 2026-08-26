"use server";

import { redirect } from "next/navigation";

import { changeRequiredPassword, PasswordChangeError } from "../../../lib/auth/repository";
import { clearSessionCookie, getCurrentAuthSession } from "../../../lib/auth/server";
import { getDatabase } from "../../../lib/dashboard/postgres/pool";

export type PasswordChangeState = { error: string; fieldErrors: Partial<Record<"currentPassword" | "newPassword" | "confirmPassword", string>> };

export async function changePasswordAction(_previous: PasswordChangeState, formData: FormData): Promise<PasswordChangeState> {
  const session = await getCurrentAuthSession();
  if (!session) redirect("/login");
  if (!session.mustChangePassword) redirect("/");
  const currentPassword = String(formData.get("currentPassword") ?? "");
  const newPassword = String(formData.get("newPassword") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");
  const fieldErrors: PasswordChangeState["fieldErrors"] = {};
  if (!currentPassword) fieldErrors.currentPassword = "Enter the temporary password.";
  if (newPassword.length < 12 || newPassword.length > 128) fieldErrors.newPassword = "Use between 12 and 128 characters.";
  if (confirmPassword !== newPassword) fieldErrors.confirmPassword = "Passwords do not match.";
  if (Object.keys(fieldErrors).length) return { error: "Review the highlighted fields.", fieldErrors };
  try {
    await changeRequiredPassword(getDatabase(), session.userId, currentPassword, newPassword);
  } catch (error) {
    if (error instanceof PasswordChangeError && error.code === "invalid_current") {
      return { error: "The temporary password is incorrect.", fieldErrors: { currentPassword: "Check the temporary password and try again." } };
    }
    return { error: "The password could not be changed. Request fresh access from your administrator.", fieldErrors: {} };
  }
  await clearSessionCookie();
  redirect("/login?passwordChanged=1");
}
