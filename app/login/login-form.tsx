"use client";

import { useActionState } from "react";

import { loginAction, type LoginState } from "../auth-actions";

const initialState: LoginState = { error: "" };

export default function LoginForm({ returnTo }: { returnTo: string }) {
  const [state, formAction, pending] = useActionState(loginAction, initialState);

  return (
    <form action={formAction} className="login-form">
      <input name="returnTo" type="hidden" value={returnTo} />
      <label>
        <span>Firm ID</span>
        <input aria-describedby={state.error ? "login-error" : undefined} aria-invalid={state.error ? true : undefined} autoCapitalize="none" autoComplete="organization" defaultValue="sharma-kumar-ca" maxLength={80} name="tenantSlug" required spellCheck={false} />
      </label>
      <label>
        <span>Email address</span>
        <input aria-describedby={state.error ? "login-error" : undefined} aria-invalid={state.error ? true : undefined} autoCapitalize="none" autoComplete="username" maxLength={254} name="email" required spellCheck={false} type="email" />
      </label>
      <label>
        <span>Password</span>
        <input aria-describedby={state.error ? "login-error" : undefined} aria-invalid={state.error ? true : undefined} autoComplete="current-password" maxLength={128} name="password" required type="password" />
      </label>
      {state.error && <p className="login-error" id="login-error" role="alert">{state.error}</p>}
      <button className="login-submit" disabled={pending} type="submit">
        {pending ? "Signing in…" : "Sign in securely"}
      </button>
    </form>
  );
}
