import Link from "next/link";
import { notFound } from "next/navigation";

import { hasPermission } from "../../../lib/auth/authorization";
import { requirePermission } from "../../../lib/auth/server";
import { getDatabase } from "../../../lib/dashboard/postgres/pool";
import { getInvoiceDetail, indiaDateKey } from "../../../lib/billing/repository";
import { formatPaise } from "../../../lib/payroll/money";
import InvoiceActions from "./invoice-actions";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const statusLabels = { draft: "Draft", issued: "Issued", paid: "Paid", cancelled: "Cancelled" } as const;

const lineTypeLabels: Record<string, string> = {
  package_fee: "Package fee",
  addon: "Add-on service",
  service: "Service",
  adjustment: "Adjustment",
};

const errorMessages: Record<string, string> = {
  state: "The invoice has moved on since this page loaded. Review its current state below.",
  dates: "Enter a valid issue date and a due date on or after it.",
  reason: "Enter a cancellation reason of at least 3 characters.",
};

export default async function InvoiceDetailPage({ params, searchParams }: { params: Promise<{ invoiceId: string }>; searchParams: Promise<{ billingError?: string }> }) {
  const { invoiceId } = await params;
  const query = await searchParams;
  const session = await requirePermission("billing:read", `/billing/${invoiceId}`);
  if (!UUID_PATTERN.test(invoiceId)) notFound();
  const invoice = await getInvoiceDetail(getDatabase(), session.tenantId, invoiceId);
  if (!invoice) notFound();
  const canManage = hasPermission(session, "billing:manage");
  const todayKey = indiaDateKey();
  const errorMessage = query.billingError ? errorMessages[query.billingError] : undefined;
  return (
    <main className="client-page-shell billing-page-shell settings-stack-shell">
      <header className="client-page-header">
        <Link href="/?workspace=billing">&larr; Back to Billing</Link>
        <div>
          <p className="eyebrow">BILLING &amp; RECEIVABLES</p>
          <h1>{invoice.invoiceNumber}</h1>
          <span>{invoice.clientName} · {invoice.periodLabel} · <b className={`invoice-status invoice-status-${invoice.status}`}>{statusLabels[invoice.status]}</b></span>
        </div>
      </header>
      {errorMessage && <p className="package-form-banner" role="alert">{errorMessage}</p>}
      <section className="panel-card invoice-detail-card">
        <table className="invoice-lines-table">
          <thead>
            <tr><th>#</th><th>Description</th><th>Type</th><th className="invoice-amount">Amount</th></tr>
          </thead>
          <tbody>
            {invoice.lines.map((line) => (
              <tr key={line.id}>
                <td>{line.position}</td>
                <td>{line.description}</td>
                <td>{lineTypeLabels[line.lineType]}</td>
                <td className="invoice-amount">{formatPaise(line.amountPaise)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr><td colSpan={3}>Subtotal</td><td className="invoice-amount">{formatPaise(invoice.subtotalPaise)}</td></tr>
            <tr><td colSpan={3}>Tax (as reviewed)</td><td className="invoice-amount">{formatPaise(invoice.taxPaise)}</td></tr>
            <tr className="invoice-total-row"><td colSpan={3}>Total</td><td className="invoice-amount">{formatPaise(invoice.totalPaise)}</td></tr>
          </tfoot>
        </table>
        <dl className="invoice-meta">
          {invoice.issueDate && <div><dt>Issued</dt><dd>{invoice.issueDate}</dd></div>}
          {invoice.dueDate && <div><dt>Payment due</dt><dd>{invoice.dueDate}</dd></div>}
          {invoice.paidAt && <div><dt>Paid</dt><dd>{invoice.paidAt.slice(0, 10)}{invoice.paymentReference ? ` · ${invoice.paymentReference}` : ""}</dd></div>}
          {invoice.cancellationReason && <div><dt>Cancelled</dt><dd>{invoice.cancellationReason}</dd></div>}
          {invoice.notes && <div><dt>Notes</dt><dd>{invoice.notes}</dd></div>}
        </dl>
      </section>
      {canManage && <InvoiceActions defaultDueDate={todayKey} invoiceId={invoice.id} status={invoice.status} todayKey={todayKey} />}
    </main>
  );
}
