"use client";

import { useActionState } from "react";

import { changePasswordAction, type PasswordChangeState } from "./actions";

const initialState: PasswordChangeState = { error: "", fieldErrors: {} };

export function ChangePasswordForm() {
  const [state, action, pending] = useActionState(changePasswordAction, initialState);
  const a11y = (field: keyof PasswordChangeState["fieldErrors"]) => state.fieldErrors[field]
    ? { "aria-describedby": `${field}-error`, "aria-invalid": true as const }
    : {};
  return (
    <form action={action} className="login-form password-change-form">
      <label><span>Temporary password</span><input {...a11y("currentPassword")} autoComplete="current-password" name="currentPassword" required type="password" />{state.fieldErrors.currentPassword && <small className="client-form-error" id="currentPassword-error">{state.fieldErrors.currentPassword}</small>}</label>
      <label><span>New password</span><input {...a11y("newPassword")} autoComplete="new-password" minLength={12} name="newPassword" required type="password" />{state.fieldErrors.newPassword && <small className="client-form-error" id="newPassword-error">{state.fieldErrors.newPassword}</small>}</label>
      <label><span>Confirm new password</span><input {...a11y("confirmPassword")} autoComplete="new-password" minLength={12} name="confirmPassword" required type="password" />{state.fieldErrors.confirmPassword && <small className="client-form-error" id="confirmPassword-error">{state.fieldErrors.confirmPassword}</small>}</label>
      {state.error && <p className="login-error" role="alert">{state.error}</p>}
      <button className="login-submit" disabled={pending} type="submit">{pending ? "Securing account…" : "Save permanent password"}</button>
    </form>
  );
}
