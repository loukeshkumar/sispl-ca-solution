"use client";

import { useActionState } from "react";

import { formatPaise } from "../../lib/payroll/money";
import type { InvoiceFormOptions } from "../../lib/billing/repository";
import { invoiceLineTypes, MAX_INVOICE_LINES, type InvoiceActionState } from "../../lib/billing/validation";
import { createInvoiceAction } from "./actions";
import { useCloseOnSuccess } from "../dashboard/form-dialog";

const initialState: InvoiceActionState = { error: "", fieldErrors: {} };

const lineTypeLabels: Record<string, string> = {
  package_fee: "Package fee",
  addon: "Add-on service",
  service: "Service",
  adjustment: "Adjustment",
};

export default function InvoiceForm({ onCancel, onSaved, options, prefillEntityId }: { onCancel: () => void; onSaved: () => void; options: InvoiceFormOptions; prefillEntityId?: string }) {
  const [state, formAction, pending] = useActionState(createInvoiceAction, initialState);
  useCloseOnSuccess(pending, state, onSaved);
  return (
    <form action={formAction} className="package-editor-card panel-card is-in-dialog">
      {state.error && <p className="package-form-banner" role="alert">{state.error}</p>}
      <div className="package-form-grid">
        <label>
          <span>Client (legal entity)</span>
          <select defaultValue={prefillEntityId ?? ""} name="legalEntityId" required>
            <option disabled value="">Select a client</option>
            {options.clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
          </select>
          {state.fieldErrors.legalEntityId && <em className="package-field-error">{state.fieldErrors.legalEntityId}</em>}
        </label>
        <label>
          <span>Package agreement (optional)</span>
          <select defaultValue="" name="assignmentId">
            <option value="">No linked agreement</option>
            {options.assignments.map((assignment) => (
              <option key={assignment.id} value={assignment.id}>
                {assignment.packageName} · {assignment.billingCycle} · {formatPaise(assignment.agreedFeePaise)}
              </option>
            ))}
          </select>
          {state.fieldErrors.assignmentId && <em className="package-field-error">{state.fieldErrors.assignmentId}</em>}
        </label>
        <label>
          <span>Billing period</span>
          <input maxLength={60} name="periodLabel" placeholder="e.g. August 2026" required type="text" />
          {state.fieldErrors.periodLabel && <em className="package-field-error">{state.fieldErrors.periodLabel}</em>}
        </label>
        <label>
          <span>Tax amount (INR, entered as reviewed)</span>
          <input inputMode="decimal" name="tax" placeholder="0.00" type="text" />
          {state.fieldErrors.tax && <em className="package-field-error">{state.fieldErrors.tax}</em>}
        </label>
        <label className="package-form-wide">
          <span>Notes</span>
          <textarea maxLength={2000} name="notes" rows={2} />
          {state.fieldErrors.notes && <em className="package-field-error">{state.fieldErrors.notes}</em>}
        </label>
      </div>
      <fieldset className="invoice-lines-fieldset">
        <legend>Invoice lines</legend>
        <p>Add up to {MAX_INVOICE_LINES} lines. Amounts are in rupees; empty rows are ignored.</p>
        {state.fieldErrors.lines && <em className="package-field-error">{state.fieldErrors.lines}</em>}
        {Array.from({ length: 4 }, (_, index) => index + 1).map((row) => (
          <div className="invoice-line-row" key={row}>
            <label>
              <span>Description</span>
              <input maxLength={200} name={`lineDescription${row}`} type="text" />
            </label>
            <label>
              <span>Type</span>
              <select defaultValue="service" name={`lineType${row}`}>
                {invoiceLineTypes.map((type) => <option key={type} value={type}>{lineTypeLabels[type]}</option>)}
              </select>
            </label>
            <label>
              <span>Amount (INR)</span>
              <input inputMode="decimal" name={`lineAmount${row}`} placeholder="0.00" type="text" />
            </label>
          </div>
        ))}
      </fieldset>
      <div className="package-form-actions">
        <button className="secondary-button" onClick={onCancel} type="button">Cancel</button>
        <button className="primary-button" disabled={pending} type="submit">{pending ? "Saving…" : "Create draft invoice"}</button>
      </div>
    </form>
  );
}
