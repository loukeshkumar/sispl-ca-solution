"use client";

import { useActionState } from "react";

import type { PortalPasswordActionState } from "../../../lib/portal/validation";
import { portalChangePasswordAction } from "../actions";

const initialState: PortalPasswordActionState = { error: "", fieldErrors: {} };

export default function PortalPasswordForm() {
  const [state, formAction, pending] = useActionState(portalChangePasswordAction, initialState);
  return (
    <form action={formAction} className="portal-auth-form">
      {state.error && <p className="portal-auth-error" role="alert">{state.error}</p>}
      <label>
        <span>New password</span>
        <input autoComplete="new-password" minLength={12} name="password" required type="password" />
        {state.fieldErrors.password && <em className="portal-field-error">{state.fieldErrors.password}</em>}
      </label>
      <label>
        <span>Confirm new password</span>
        <input autoComplete="new-password" minLength={12} name="confirmPassword" required type="password" />
        {state.fieldErrors.confirmPassword && <em className="portal-field-error">{state.fieldErrors.confirmPassword}</em>}
      </label>
      <button className="primary-button" disabled={pending} type="submit">{pending ? "Saving…" : "Set password"}</button>
      <small>Use at least 12 characters with a mix of letters and numbers.</small>
    </form>
  );
}
