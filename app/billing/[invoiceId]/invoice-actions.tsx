"use client";

import type { InvoiceStatus } from "../../../lib/billing/validation";
import { cancelInvoiceAction, issueInvoiceAction, recordInvoicePaymentAction } from "../actions";

export default function InvoiceActions({ invoiceId, status, todayKey, defaultDueDate }: { invoiceId: string; status: InvoiceStatus; todayKey: string; defaultDueDate: string }) {
  if (status === "paid" || status === "cancelled") return null;
  return (
    <div className="invoice-actions">
      {status === "draft" && (
        <form action={issueInvoiceAction} className="invoice-action-card">
          <h2>Issue invoice</h2>
          <span>Issuing locks the amounts and starts the receivable.</span>
          <input name="invoiceId" type="hidden" value={invoiceId} />
          <label><span>Issue date</span><input defaultValue={todayKey} name="issueDate" required type="date" /></label>
          <label><span>Payment due date</span><input defaultValue={defaultDueDate} name="dueDate" required type="date" /></label>
          <button className="primary-button" type="submit">Issue invoice</button>
        </form>
      )}
      {status === "issued" && (
        <form action={recordInvoicePaymentAction} className="invoice-action-card">
          <h2>Record payment</h2>
          <span>Record the receipt once the full amount has been collected.</span>
          <input name="invoiceId" type="hidden" value={invoiceId} />
          <label><span>Payment reference (optional)</span><input maxLength={200} name="paymentReference" placeholder="UTR / cheque number" type="text" /></label>
          <button className="primary-button" type="submit">Mark as paid</button>
        </form>
      )}
      <form
        action={cancelInvoiceAction}
        className="invoice-action-card invoice-cancel-card"
        onSubmit={(event) => {
          if (!window.confirm("Cancel this invoice? The action is recorded in the audit trail.")) event.preventDefault();
        }}
      >
        <h2>Cancel invoice</h2>
        <span>Cancellation keeps the record with an audited reason.</span>
        <input name="invoiceId" type="hidden" value={invoiceId} />
        <label><span>Reason</span><input maxLength={500} minLength={3} name="reason" required type="text" /></label>
        <button className="danger-button" type="submit">Cancel invoice</button>
      </form>
    </div>
  );
}
