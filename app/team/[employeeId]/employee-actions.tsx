"use client";

import { useActionState, useState } from "react";

import type { EmployeeActionState } from "../../../lib/team/validation";
import { provisionEmployeeAccessAction } from "../actions";

const initialState: EmployeeActionState = { error: "", fieldErrors: {} };

export function ProvisionAccess({ employeeId }: { employeeId: string }) {
  const action = provisionEmployeeAccessAction.bind(null, employeeId);
  const [state, formAction, pending] = useActionState(action, initialState);
  const [copied, setCopied] = useState(false);

  const copyPassword = async () => {
    if (!state.temporaryPassword) return;
    await navigator.clipboard.writeText(state.temporaryPassword);
    setCopied(true);
  };

  return (
    <div className="employee-access-action">
      <form action={formAction}>
        <button className="primary-button" disabled={pending} type="submit">
          {pending ? "Provisioning..." : "Generate temporary password"}
        </button>
      </form>
      {state.error && <p className="client-form-banner" role="alert">{state.error}</p>}
      {state.temporaryPassword && (
        <div aria-live="polite" className="temporary-password-panel">
          <span>One-time temporary password</span>
          <code>{state.temporaryPassword}</code>
          <button className="secondary-button" onClick={copyPassword} type="button">{copied ? "Copied" : "Copy password"}</button>
          <small>Share it securely. It will not be shown again, and the employee must replace it at first login.</small>
        </div>
      )}
    </div>
  );
}


