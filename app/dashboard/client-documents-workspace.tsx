"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { canViewInline, type ClientDocumentLibrary } from "../../lib/documents/library";
import { DashboardIcon } from "./dashboard-icons";
import { EmptyState, InitialsAvatar, KpiCard, PageTitle } from "./dashboard-ui";
import UploadDocumentDialog, { UploadDocumentDialogButton } from "./upload-document-dialog";

/** Sizes read as a person would say them, not as raw bytes. */
function fileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const KIND_LABELS: Record<string, string> = {
  "application/pdf": "PDF",
  "image/gif": "GIF",
  "image/jpeg": "JPG",
  "image/png": "PNG",
  "image/webp": "WEBP",
};

const kindLabel = (mimeType: string) => KIND_LABELS[mimeType.toLowerCase()] ?? mimeType.split("/").pop()?.slice(0, 6).toUpperCase() ?? "FILE";

const initials = (name: string) => name.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("");

export function ClientDocumentsWorkspace({ canWrite, library }: { canWrite: boolean; library: ClientDocumentLibrary }) {
  const [client, setClient] = useState("all");
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  // Which client the upload dialog is filing against, if it is open.
  const [uploadFor, setUploadFor] = useState<string | null>(null);

  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return library.groups
      .filter((group) => client === "all" || group.legalEntityId === client)
      .map((group) => ({
        ...group,
        documents: needle
          ? group.documents.filter((document) => `${document.originalName} ${document.context} ${document.uploadedBy}`.toLowerCase().includes(needle))
          : group.documents,
      }))
      // A search is a search of files, so a client with no match drops out of it.
      .filter((group) => (needle ? group.documents.length > 0 : true));
  }, [client, library.groups, query]);

  const shown = groups.reduce((total, group) => total + group.documents.length, 0);

  return (
    <div className="client-documents-workspace">
      <PageTitle
        actions={canWrite ? <UploadDocumentDialogButton><DashboardIcon name="plus" size={17} />Upload document</UploadDocumentDialogButton> : undefined}
        description="Every file held for a client, filed against the service it belongs to, behind authenticated tenant-scoped access."
        eyebrow="CLIENT RECORDS"
        title="Client documents"
      />

      <section className="kpi-grid">
        <KpiCard icon="documents" label="DOCUMENTS" note="Stored across all clients" tone="blue" value={String(library.totalDocuments).padStart(2, "0")} />
        <KpiCard icon="clients" label="CLIENTS" note="On the document library" tone="mint" value={String(library.groups.length).padStart(2, "0")} />
        <KpiCard icon="packageSetup" label="STORED" note="Total size on record" tone="amber" value={fileSize(library.totalBytes)} />
        <KpiCard icon="review" label="SHOWING" note="Matching the current filter" tone="blue" value={String(shown).padStart(2, "0")} />
      </section>

      <section className="surface-card client-documents-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">DOCUMENT LIBRARY</p>
            <h2>Files by client</h2>
            <span>{canWrite ? "Choose a client to upload against, or open a row to see its files." : "Open a client to see the files held for them."}</span>
          </div>
        </div>

        <div className="workspace-toolbar">
          <label className="work-sort">
            <span>Client</span>
            <select onChange={(event) => setClient(event.target.value)} value={client}>
              <option value="all">All clients</option>
              {library.clients.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
            </select>
          </label>
          <label className="client-search">
            <DashboardIcon name="search" size={17} />
            <input aria-label="Search documents by name, service, or uploader" onChange={(event) => setQuery(event.target.value)} placeholder="Search file name, service, or uploader..." type="search" value={query} />
          </label>
        </div>

        {!groups.length && (
          <EmptyState
            description={library.groups.length ? "No file matches this search. Clear it to see every client again." : "Add a client first, and their document library will appear here."}
            icon="documents"
            title={library.groups.length ? "No documents match" : "No clients yet"}
          />
        )}

        <ul className="client-documents-clients">
          {groups.map((group) => {
            const open = expanded === group.legalEntityId;
            return (
              <li key={group.legalEntityId}>
                <div className="client-documents-row">
                  {/*
                    The row is the upload control: picking the client is the first
                    thing an upload needs, so choosing one here skips that step.
                  */}
                  <button
                    className="client-documents-pick"
                    disabled={!canWrite}
                    onClick={() => setUploadFor(group.legalEntityId)}
                    type="button"
                  >
                    <InitialsAvatar initials={initials(group.name)} />
                    <span>
                      <strong>{group.name}</strong>
                      <small>{group.legalName}</small>
                    </span>
                    {canWrite && <span className="client-documents-upload-hint"><DashboardIcon name="plus" size={15} />Upload</span>}
                  </button>

                  {/* Separate control, because expanding is not uploading. */}
                  <button
                    aria-controls={`documents-${group.legalEntityId}`}
                    aria-expanded={open}
                    className={`client-documents-toggle ${open ? "is-open" : ""}`}
                    disabled={!group.documents.length}
                    onClick={() => setExpanded(open ? null : group.legalEntityId)}
                    type="button"
                  >
                    <strong>{group.documents.length}</strong>
                    <small>{group.documents.length === 1 ? "file" : "files"}</small>
                    {Boolean(group.documents.length) && <>
                      <em>{fileSize(group.totalBytes)}</em>
                      <DashboardIcon name="chevron" size={16} />
                    </>}
                  </button>
                </div>

                <div className="client-documents-files" hidden={!open} id={`documents-${group.legalEntityId}`}>
                  <ul className="client-documents-list">
                    {group.documents.map((document) => (
                      <li key={document.id}>
                        <span className={`client-document-kind is-${kindLabel(document.mimeType).toLowerCase()}`}>{kindLabel(document.mimeType)}</span>
                        <span className="client-document-identity">
                          <strong>{document.originalName}</strong>
                          <small>{document.context} · {fileSize(document.sizeBytes)} · {document.uploadedBy}</small>
                        </span>
                        <time dateTime={document.uploadedAt}>
                          {new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", timeZone: "Asia/Kolkata", year: "numeric" }).format(new Date(document.uploadedAt))}
                        </time>
                        <span className="client-document-actions">
                          {/*
                            Only inert types get a preview. Everything else is
                            download only, because serving it inline would run it
                            in this origin.
                          */}
                          {canViewInline(document.mimeType)
                            ? <a className="secondary-button" href={`/documents/${document.id}/view`} rel="noopener noreferrer" target="_blank">View</a>
                            : <span className="client-document-noview" title="This file type cannot be previewed safely">No preview</span>}
                          <a className="secondary-button" href={`/documents/${document.id}/download`}>Download</a>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <p className="client-documents-footnote">
        Files are served only to signed-in members of this firm and are re-checked against their recorded hash before download. Manage requests in <Link href="/?workspace=documents">Documents</Link>.
      </p>

      {/* One dialog, retargeted at whichever client was picked. */}
      <UploadDocumentDialog
        initialClientId={uploadFor ?? undefined}
        key={uploadFor ?? "none"}
        onClose={() => setUploadFor(null)}
        open={Boolean(uploadFor)}
      />
    </div>
  );
}
