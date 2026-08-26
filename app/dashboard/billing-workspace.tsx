"use client";

import { ReceiptText, Search } from "lucide-react";
import Link from "next/link";

import { InvoiceDialogButton } from "./invoice-dialog";
import { useMemo, useState } from "react";

import { formatPaise } from "../../lib/payroll/money";
import type { BillingWorkspaceData } from "../../lib/billing/repository";
import { KpiCard, PageTitle, StatusBadge } from "./dashboard-ui";

const statusFilters = ["All", "Draft", "Issued", "Overdue", "Paid", "Cancelled"] as const;
type StatusFilter = typeof statusFilters[number];

const statusLabels: Record<string, string> = { draft: "Draft", issued: "Issued", paid: "Paid", cancelled: "Cancelled" };
const statusTones: Record<string, string> = { draft: "neutral", issued: "blue", overdue: "red", paid: "mint", cancelled: "neutral" };

export function BillingWorkspace({ canManage, data }: { canManage: boolean; data: BillingWorkspaceData }) {
  const [filter, setFilter] = useState<StatusFilter>("All");
  const [query, setQuery] = useState("");

  const visible = useMemo(() => data.invoices.filter((invoice) => {
    const overdue = invoice.status === "issued" && invoice.dueDate !== null && invoice.dueDate < data.todayKey;
    const matchesFilter = filter === "All"
      || (filter === "Overdue" ? overdue : invoice.status === filter.toLowerCase());
    return matchesFilter && (!query || `${invoice.invoiceNumber} ${invoice.clientName} ${invoice.periodLabel}`.toLowerCase().includes(query.toLowerCase()));
  }), [data.invoices, data.todayKey, filter, query]);

  const issuedCount = data.invoices.filter((invoice) => invoice.status === "issued").length;

  return <section className="billing-workspace">
    <PageTitle
      actions={<div className="package-title-actions">
        <a className="secondary-button" href={`/integrations/tally/export?dataset=invoices&from=${data.todayKey.slice(0, 8)}01&to=${data.todayKey}`}>Export to Tally</a>
        {canManage && <InvoiceDialogButton><ReceiptText aria-hidden="true" />New invoice</InvoiceDialogButton>}
      </div>}
      description="Fee notes, outstanding collections, and settled invoices. Amounts snapshot at issue; every transition is audited."
      eyebrow="BILLING & RECEIVABLES"
      title="Billing"
    />
    <section className="package-kpi-grid kpi-grid">
      <KpiCard icon="billing" label="OUTSTANDING" note={`${issuedCount} issued invoices`} tone="blue" value={formatPaise(data.metrics.outstandingPaise)} />
      <KpiCard icon="alert" label="OVERDUE" note={`${data.metrics.overdueCount} past the due date`} tone="red" value={formatPaise(data.metrics.overduePaise)} />
      <KpiCard icon="insights" label="COLLECTED THIS MONTH" note="Recorded receipts" tone="mint" value={formatPaise(data.metrics.collectedThisMonthPaise)} />
      <KpiCard icon="documents" label="DRAFTS" note="Awaiting review and issue" tone="amber" value={String(data.metrics.draftCount).padStart(2, "0")} />
    </section>
    <section aria-label="Invoice register" className="client-package-register surface-card">
      <div className="package-register-toolbar">
        <ReceiptText aria-hidden="true" />
        <div className="package-register-controls">
          <div aria-label="Invoice status filter" className="service-status-filter" role="group">
            {statusFilters.map((status) => (
              <button aria-pressed={filter === status} key={status} onClick={() => setFilter(status)} type="button">{status}</button>
            ))}
          </div>
          <label>
            <Search aria-hidden="true" />
            <input aria-label="Search invoices by number, client, or period" onChange={(event) => setQuery(event.target.value)} placeholder="Search invoices…" type="search" value={query} />
          </label>
        </div>
      </div>
      {visible.length === 0 ? (
        <div className="package-empty-state">
          <ReceiptText aria-hidden="true" />
          <strong>No invoices in this view</strong>
          <p>{canManage ? "Create a draft invoice to start a receivable." : "Invoices will appear here once billing begins."}</p>
        </div>
      ) : (
        <div>
          <div className="package-register-head billing-register-head">
            <span>Invoice</span><span>Client · period</span><span>Due</span><span>Amount</span><span>Status</span><span aria-hidden="true" />
          </div>
          {visible.map((invoice) => {
            const overdue = invoice.status === "issued" && invoice.dueDate !== null && invoice.dueDate < data.todayKey;
            const statusKey = overdue ? "overdue" : invoice.status;
            return (
              <article className="package-register-row billing-register-row" key={invoice.id}>
                <span><strong>{invoice.invoiceNumber}</strong><small>{invoice.issueDate ? `Issued ${invoice.issueDate}` : "Not issued"}</small></span>
                <span><strong>{invoice.clientName}</strong><small>{invoice.periodLabel}</small></span>
                <span>{invoice.dueDate ?? "—"}</span>
                <span><strong>{formatPaise(invoice.totalPaise)}</strong></span>
                <StatusBadge tone={statusTones[statusKey] ?? "neutral"}>{overdue ? "Overdue" : statusLabels[invoice.status]}</StatusBadge>
                <Link aria-label={`Open ${invoice.invoiceNumber}`} className="row-action-link" href={`/billing/${invoice.id}`}>Open</Link>
              </article>
            );
          })}
        </div>
      )}
    </section>
  </section>;
}
