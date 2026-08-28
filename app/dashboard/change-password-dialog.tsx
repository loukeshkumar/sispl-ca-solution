"use client";

import { KeyRound } from "lucide-react";
import { useActionState, useState } from "react";

import { changeOwnPasswordAction, type PasswordChangeState } from "../account/change-password/actions";
import { FormDialog, FormDialogBody } from "./form-dialog";

const initialState: PasswordChangeState = { error: "", fieldErrors: {} };

/**
 * Changing your own password, from wherever you are.
 *
 * A dialog rather than a page: the forced first sign-in owns
 * `/account/change-password` and renders in the bare login shell, which is the
 * wrong frame for somebody already inside the workspace.
 */
export function ChangePasswordDialog() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button className="account-password" onClick={() => setOpen(true)} type="button">
        <KeyRound aria-hidden="true" />Change password
      </button>
      {open && <PasswordDialog onClose={() => setOpen(false)} />}
    </>
  );
}

function PasswordDialog({ onClose }: { onClose: () => void }) {
  const [state, action, pending] = useActionState(changeOwnPasswordAction, initialState);
  const a11y = (field: keyof PasswordChangeState["fieldErrors"]) => (state.fieldErrors[field]
    ? { "aria-describedby": `account-${field}-error`, "aria-invalid": true as const }
    : {});

  return (
    <FormDialog
      description="You will be signed out of every device once the new password is saved, and will sign in again with it."
      onClose={onClose}
      open
      title="Change your password"
    >
      <form action={action} className="form-dialog-form">
        <FormDialogBody columns={1}>
          {state.error && <p className="package-form-banner" role="alert">{state.error}</p>}
          <label><span>Current password</span>
            <input {...a11y("currentPassword")} autoComplete="current-password" name="currentPassword" required type="password" />
            {state.fieldErrors.currentPassword && <em className="package-field-error" id="account-currentPassword-error">{state.fieldErrors.currentPassword}</em>}
          </label>
          <label><span>New password</span>
            <input {...a11y("newPassword")} autoComplete="new-password" maxLength={128} minLength={12} name="newPassword" required type="password" />
            {state.fieldErrors.newPassword
              ? <em className="package-field-error" id="account-newPassword-error">{state.fieldErrors.newPassword}</em>
              : <small className="client-form-hint">At least 12 characters, and not the password you are replacing.</small>}
          </label>
          <label><span>Confirm new password</span>
            <input {...a11y("confirmPassword")} autoComplete="new-password" maxLength={128} minLength={12} name="confirmPassword" required type="password" />
            {state.fieldErrors.confirmPassword && <em className="package-field-error" id="account-confirmPassword-error">{state.fieldErrors.confirmPassword}</em>}
          </label>
        </FormDialogBody>
        <div className="form-dialog-actions">
          <button className="secondary-button" onClick={onClose} type="button">Cancel</button>
          <button className="primary-button" disabled={pending} type="submit">{pending ? "Saving…" : "Save password"}</button>
        </div>
      </form>
    </FormDialog>
  );
}
