"use client";

import { useActionState } from "react";

import { portalLoginAction, type PortalLoginState } from "../actions";

const initialState: PortalLoginState = { error: "" };

export default function PortalLoginForm() {
  const [state, formAction, pending] = useActionState(portalLoginAction, initialState);
  return (
    <form action={formAction} className="portal-auth-form">
      {state.error && <p className="portal-auth-error" role="alert">{state.error}</p>}
      <label>
        <span>Firm ID</span>
        <input autoComplete="organization" defaultValue="sharma-kumar-ca" name="tenantSlug" required type="text" />
      </label>
      <label>
        <span>Email</span>
        <input autoComplete="email" name="email" required type="email" />
      </label>
      <label>
        <span>Password</span>
        <input autoComplete="current-password" name="password" required type="password" />
      </label>
      <button className="primary-button" disabled={pending} type="submit">{pending ? "Signing in…" : "Sign in"}</button>
      <small>Access is provided by your chartered accountant. Contact the firm if you need a new password.</small>
    </form>
  );
}
