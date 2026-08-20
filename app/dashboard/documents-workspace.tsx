"use client";

import Link from "next/link";
import { useMemo } from "react";

import { dayDifference } from "../../lib/dashboard/filters";
import { ageLabel, groupRequestsByClient } from "../../lib/documents/chase";
import { canViewInline } from "../../lib/documents/library";
import { documentsHref, type DocumentParams, type DocumentScope } from "../../lib/documents/queue-params";
import type { DocumentWorkspaceData } from "../../lib/documents/repository";
import { CancelDocumentRequestForm } from "./cancel-document-request-form";
import { DashboardIcon } from "./dashboard-icons";
import { DocumentBulkBar } from "./document-bulk-bar";
import { DocumentRequestDialogButton } from "./document-request-dialog";
import { EmptyState, KpiCard, PageTitle, StatusBadge } from "./dashboard-ui";
import { UploadDocumentDialogButton } from "./upload-document-dialog";

const dateFormatter = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "UTC" });
const formatDate = (value: string) => dateFormatter.format(new Date(`${value.slice(0, 10)}T00:00:00Z`));
const statusTone = (status: string) => status === "received" ? "mint" : status === "cancelled" ? "blue" : "amber";

/**
 * Chasing is the job on this page, so the default view is what is actually
 * late. Everything else is one click away rather than mixed into the same list.
 */
const SCOPES: Array<{ key: DocumentScope; label: string }> = [
  { key: "chase", label: "Needs chasing" },
  { key: "open", label: "Open" },
  { key: "received", label: "Received" },
  { key: "cancelled", label: "Cancelled" },
  { key: "all", label: "All" },
];

/** The same urgency bands as the delivery workspace, so one habit covers both. */
const URGENCY = [
  { key: "overdue", label: "Overdue", note: "Chase these today", test: (days: number) => days < 0 },
  { key: "today", label: "Due today", note: "Last day to receive", test: (days: number) => days === 0 },
  { key: "week", label: "Due this week", note: "Within seven days", test: (days: number) => days > 0 && days <= 7 },
  { key: "later", label: "Later", note: "Beyond this week", test: (days: number) => days > 7 },
] as const;

function dueChip(days: number) {
  if (days < 0) return { label: `${Math.abs(days)}d overdue`, tone: "overdue" };
  if (days === 0) return { label: "Due today", tone: "today" };
  if (days === 1) return { label: "Due tomorrow", tone: "soon" };
  if (days <= 7) return { label: `${days}d left`, tone: "soon" };
  return { label: `${days}d left`, tone: "later" };
}

export type DocumentsViewData = {
  canWrite: boolean;
  params: DocumentParams;
  todayKey: string;
  workspace: DocumentWorkspaceData;
};

export function DocumentsWorkspace({ canWrite, params, todayKey, workspace }: DocumentsViewData) {
  const scope = params.scope;
  const query = params.q;

  const counts = useMemo(() => {
    const open = workspace.requests.filter((request) => request.status === "requested");
    return {
      all: workspace.requests.length,
      cancelled: workspace.requests.filter((request) => request.status === "cancelled").length,
      chase: open.filter((request) => request.dueDate < todayKey).length,
      open: open.length,
      received: workspace.requests.filter((request) => request.status === "received").length,
    };
  }, [todayKey, workspace.requests]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return workspace.requests.filter((request) => {
      const matchesScope = scope === "all"
        || (scope === "chase" && request.status === "requested" && request.dueDate < todayKey)
        || (scope === "open" && request.status === "requested")
        || (scope === "received" && request.status === "received")
        || (scope === "cancelled" && request.status === "cancelled");
      if (!matchesScope) return false;
      return !needle || `${request.title} ${request.clientName} ${request.workLabel ?? ""}`.toLowerCase().includes(needle);
    });
  }, [query, scope, todayKey, workspace.requests]);

  /*
   * Only outstanding requests get urgency bands — a received or cancelled one
   * has no deadline left to be measured against, and banding it as "overdue"
   * would be wrong.
   */
  const banded = scope === "received" || scope === "cancelled" || scope === "all";
  const groups = useMemo(() => {
    if (banded) return [{ items: visible, key: "all", label: "", note: "" }];
    return URGENCY
      .map((group) => ({ ...group, items: visible.filter((request) => group.test(dayDifference(request.dueDate, todayKey))) }))
      .filter((group) => group.items.length > 0);
  }, [banded, todayKey, visible]);

  const clientGroups = useMemo(() => groupRequestsByClient(visible, todayKey), [todayKey, visible]);

  return (
    <div className="documents-workspace">
      <PageTitle
        actions={canWrite ? <><DocumentRequestDialogButton variant="secondary"><DashboardIcon name="plus" size={17} />New request</DocumentRequestDialogButton><UploadDocumentDialogButton>Upload document</UploadDocumentDialogButton></> : undefined}
        description="Chase the documents a client still owes, and receive them straight onto the request they answer."
        eyebrow="DOCUMENT CONTROL"
        title="Documents"
      />

      <section className="kpi-grid">
        <KpiCard icon="alert" label="NEEDS CHASING" note="Past the date you asked for" tone="red" value={String(counts.chase).padStart(2, "0")} />
        <KpiCard icon="waiting" label="OPEN REQUESTS" note="Awaiting client documents" tone="amber" value={String(counts.open).padStart(2, "0")} />
        <KpiCard icon="review" label="RECEIVED" note="Fulfilled requests" tone="mint" value={String(counts.received).padStart(2, "0")} />
        <KpiCard icon="documents" label="FILES" note="Securely stored" tone="blue" value={String(workspace.documents.length).padStart(2, "0")} />
      </section>

      <section className="documents-grid">
        <article className="document-panel surface-card">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">REQUEST REGISTER</p>
              <h2>Client dependencies</h2>
              <span>{visible.length} of {workspace.requests.length} requests</span>
            </div>
          </div>

          <div className="workspace-toolbar">
            <nav className="segment-control" aria-label="Filter document requests">
              {SCOPES.map((option) => (
                <Link aria-current={scope === option.key ? "page" : undefined} href={documentsHref({ ...params, scope: option.key })} key={option.key}>
                  {option.label}<span>{counts[option.key]}</span>
                </Link>
              ))}
            </nav>
            <form action="/" className="client-search" method="get">
              <input name="workspace" type="hidden" value="documents" />
              <input name="scope" type="hidden" value={scope} />
              <input name="layout" type="hidden" value={params.layout} />
              <DashboardIcon name="search" size={17} />
              <input aria-label="Search requests by title, client, or work item" defaultValue={query} name="q" placeholder="Search title, client, or work..." type="search" />
            </form>
          </div>

          <div className="workspace-toolbar">
            <nav aria-label="Choose a layout" className="segment-control">
              <Link aria-current={params.layout === "list" ? "page" : undefined} href={documentsHref({ ...params, layout: "list" })}>By request</Link>
              <Link aria-current={params.layout === "client" ? "page" : undefined} href={documentsHref({ ...params, layout: "client" })}>By client</Link>
            </nav>
          </div>

          {canWrite && Boolean(visible.length) && <DocumentBulkBar />}

          {params.layout === "client" && (
            <div className="document-client-groups">
              {clientGroups.map((group) => (
                <section aria-label={group.clientName} className="document-client-group" key={group.legalEntityId}>
                  <header>
                    <strong>{group.clientName}</strong>
                    <em>{group.items.length} outstanding</em>
                    {/* Escalation is driven by the longest wait, not the average. */}
                    <small>oldest {group.oldestLabel}</small>
                  </header>
                  {group.items.map((item) => (
                    <div className="document-client-item" key={item.id}>
                      {canWrite && <input aria-label={`Select ${item.title}`} form="document-bulk-form" name="requestId" type="checkbox" value={item.id} />}
                      <span><strong>{item.title}</strong><small>{ageLabel(item.createdAt, todayKey)}</small></span>
                      <small className={`work-due-chip is-${dueChip(dayDifference(item.dueDate, todayKey)).tone}`}>{dueChip(dayDifference(item.dueDate, todayKey)).label}</small>
                    </div>
                  ))}
                </section>
              ))}
              {!clientGroups.length && <EmptyState description="Change the filter to see more requests." icon="documents" title="Nothing outstanding here" />}
            </div>
          )}

          {params.layout === "list" && <div className="document-list">
            {!visible.length && (
              <EmptyState
                description={counts.all ? "Nothing in this view. Try another filter or clear the search." : "Raise a request to turn a client dependency into something you can chase."}
                icon="documents"
                title={counts.all ? "Nothing here" : "No document requests yet"}
              />
            )}

            {groups.map((group) => (
              <section aria-label={group.label || "Requests"} className="work-urgency-group" key={group.key}>
                {group.label && (
                  <header className={`work-urgency-heading is-${group.key}`}>
                    <strong>{group.label}</strong>
                    <em>{group.items.length}</em>
                    <small>{group.note}</small>
                  </header>
                )}
                {group.items.map((request) => {
                  const days = dayDifference(request.dueDate, todayKey);
                  const chip = dueChip(days);
                  const age = Math.max(0, Math.round(dayDifference(todayKey, request.createdAt.slice(0, 10))));
                  const outstanding = request.status === "requested";
                  return (
                    <article className="document-request-row" key={request.id}>
                      {canWrite && (
                        <span className="document-row-select">
                          <input aria-label={`Select ${request.title}`} form="document-bulk-form" name="requestId" type="checkbox" value={request.id} />
                        </span>
                      )}
                      <span>
                        <strong>{request.title}</strong>
                        <small>{request.clientName}{request.workLabel ? ` · ${request.workLabel}` : ""}</small>
                        {request.description && <em>{request.description}</em>}
                      </span>
                      <span className="document-request-timing">
                        <strong>{formatDate(request.dueDate)}</strong>
                        {outstanding
                          ? <small className={`work-due-chip is-${chip.tone}`}>{chip.label}</small>
                          : <small>Required by</small>}
                        {/* How long it has been outstanding is what decides who to call first. */}
                        {outstanding && <small className="document-request-age">Asked {age === 0 ? "today" : `${age}d ago`}</small>}
                      </span>
                      <StatusBadge tone={statusTone(request.status)}>{request.status.replace(/^./, (letter) => letter.toUpperCase())}</StatusBadge>
                      {outstanding && canWrite
                        ? <span className="document-row-actions">
                          <UploadDocumentDialogButton initialClientId={request.legalEntityId} initialRequestId={request.id} variant="link">Receive</UploadDocumentDialogButton>
                          <CancelDocumentRequestForm requestId={request.id} title={request.title} />
                        </span>
                        : <span />}
                    </article>
                  );
                })}
              </section>
            ))}
          </div>}
        </article>

        <aside className="document-panel surface-card">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">FILE REGISTER</p>
              <h2>Recent uploads</h2>
              <span>Newest first · authenticated downloads only</span>
            </div>
          </div>
          <div className="uploaded-document-list">
            {workspace.documents.slice(0, 12).map((document) => (
              /*
                Two named actions rather than one row that silently downloads.
                Opening a file and saving a copy are different intentions, and
                the reader picks; a whole-row link made that choice for them.
              */
              <article key={document.id}>
                <span className="uploaded-file-icon"><DashboardIcon name="documents" size={18} /></span>
                <span>
                  <strong>{document.originalName}</strong>
                  <small>{document.clientName} · {(document.sizeBytes / 1024).toFixed(document.sizeBytes < 10240 ? 1 : 0)} KB</small>
                  {document.requestTitle && <em>Fulfils: {document.requestTitle}</em>}
                </span>
                <span className="client-document-actions">
                  {/* Preview only for types that cannot execute in this origin. */}
                  {canViewInline(document.mimeType)
                    ? <a aria-label={`View ${document.originalName}`} className="secondary-button" href={`/documents/${document.id}/view`} rel="noopener noreferrer" target="_blank">View</a>
                    : <span className="client-document-noview" title="This file type cannot be previewed safely">No preview</span>}
                  <a aria-label={`Download ${document.originalName}`} className="secondary-button" href={`/documents/${document.id}/download`}>Download</a>
                </span>
              </article>
            ))}
            {!workspace.documents.length && <EmptyState description="Received files appear here and in the client library." icon="documents" title="No documents uploaded" />}
          </div>
          <p className="document-panel-footnote">
            Every file, grouped by client, is in <Link href="/?workspace=client-documents">Client documents</Link>.
          </p>
        </aside>
      </section>
    </div>
  );
}
