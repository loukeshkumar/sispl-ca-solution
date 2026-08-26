"use client";

import { useActionState, useState } from "react";

import type { BankAccountActionState, BankAccountView } from "../../lib/payroll/bank-accounts";
import { replaceBankAccountAction } from "./bank-account-actions";

const initialState: BankAccountActionState = { error: "", fieldErrors: {} };

export default function BankAccountPanel({
  account,
  canManage,
  employeeId,
  employeeUserId,
}: {
  account: BankAccountView | null;
  canManage: boolean;
  employeeId: string;
  employeeUserId: string;
}) {
  const [state, formAction, pending] = useActionState(replaceBankAccountAction.bind(null, employeeId), initialState);
  const [editing, setEditing] = useState(false);

  return (
    <section className="client-360-services bank-account-panel">
      <div className="client-360-section-heading">
        <div><p className="eyebrow">PAYMENT INSTRUCTIONS</p><h2>Bank account</h2></div>
        {canManage && !editing && <button className="secondary-button" onClick={() => setEditing(true)} type="button">{account ? "Replace" : "Add account"}</button>}
      </div>

      {account ? (
        <dl className="bank-account-summary">
          <div><dt>Account holder</dt><dd>{account.accountHolderName}</dd></div>
          <div><dt>Account number</dt><dd>{account.maskedAccountNumber}</dd></div>
          <div><dt>IFSC</dt><dd>{account.ifscCode}</dd></div>
          <div><dt>Bank</dt><dd>{account.bankName} · {account.accountType}</dd></div>
        </dl>
      ) : (
        <p className="client-360-empty">No payment instructions on file. This employee will be excluded from disbursement files until an account is added.</p>
      )}

      {canManage && editing && (
        <form action={formAction} className="bank-account-form">
          {state.error && <p className="client-form-banner" role="alert">{state.error}</p>}
          <input name="employeeUserId" type="hidden" value={employeeUserId} />
          <label><span>Account holder name</span>
            <input autoComplete="off" defaultValue={account?.accountHolderName ?? ""} maxLength={120} name="accountHolderName" required type="text" />
            {state.fieldErrors.accountHolderName && <em className="package-field-error">{state.fieldErrors.accountHolderName}</em>}
          </label>
          <label><span>Account number</span>
            <input autoComplete="off" inputMode="numeric" maxLength={24} name="accountNumber" required type="text" />
            {state.fieldErrors.accountNumber && <em className="package-field-error">{state.fieldErrors.accountNumber}</em>}
          </label>
          <label><span>IFSC</span>
            <input autoComplete="off" defaultValue={account?.ifscCode ?? ""} maxLength={11} name="ifscCode" placeholder="SBIN0001234" required type="text" />
            {state.fieldErrors.ifscCode && <em className="package-field-error">{state.fieldErrors.ifscCode}</em>}
          </label>
          <label><span>Bank name</span>
            <input autoComplete="off" defaultValue={account?.bankName ?? ""} maxLength={120} name="bankName" required type="text" />
            {state.fieldErrors.bankName && <em className="package-field-error">{state.fieldErrors.bankName}</em>}
          </label>
          <label><span>Account type</span>
            <select defaultValue={account?.accountType ?? "savings"} name="accountType">
              <option value="savings">Savings</option>
              <option value="current">Current</option>
            </select>
          </label>
          <div className="bank-account-actions">
            <button className="primary-button" disabled={pending} type="submit">{pending ? "Saving…" : "Save instructions"}</button>
            <button className="secondary-button" onClick={() => setEditing(false)} type="button">Cancel</button>
          </div>
          <small>Replacing retires the previous account rather than editing it. The audit trail records that instructions changed and never stores the account number.</small>
        </form>
      )}
    </section>
  );
}
