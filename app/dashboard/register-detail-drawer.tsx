"use client";

import Link from "next/link";
import { FileSignature, KeyRound, Scale, X } from "lucide-react";

import type { RegisterDetail } from "../../lib/registers/repository";

const stampFormatter = new Intl.DateTimeFormat("en-IN", {
  day: "numeric", hour: "2-digit", minute: "2-digit", month: "short", timeZone: "Asia/Kolkata", year: "numeric",
});
const formatStamp = (value: string) => stampFormatter.format(new Date(value));

const CUSTODY_LABELS: Record<string, string> = {
  received: "Received into custody",
  issued_out: "Signed out",
  returned: "Returned to custody",
  surrendered: "Surrendered",
  expired: "Validity lapsed",
};

/** Audit actions read as machine keys; a reviewer needs the sentence. */
const AUDIT_LABELS: Record<string, string> = {
  "udin.recorded": "UDIN recorded",
  "udin.revoked": "UDIN revoked",
  "dsc.registered": "Certificate registered",
  "dsc.issued_out": "Signed out",
  "dsc.returned": "Returned to custody",
  "dsc.surrendered": "Surrendered",
  "dsc.expired": "Marked expired",
  "notice.recorded": "Notice recorded",
  "notice.status_updated": "Status changed",
  "notice.bulk.status": "Status changed in bulk",
  "notice.bulk.assignee": "Reassigned in bulk",
};

const KIND_ICON = {
  dsc: KeyRound,
  notice: Scale,
  udin: FileSignature,
} as const;

/**
 * Everything the firm has recorded about one register entry, in one panel.
 *
 * The custody chain and the audit trail were already being written on every
 * action and read by nobody — a control that exists only in the database is not
 * a control a reviewer can rely on. Both are rendered newest first, which is
 * the order the question "what happened to this?" is actually asked in.
 */
export function RegisterDetailDrawer({ closeHref, detail }: { closeHref: string; detail: RegisterDetail }) {
  const Icon = KIND_ICON[detail.kind];
  return (
    <>
      {/* A real link, so Escape-less browsers and no-JS sessions can still leave. */}
      <Link aria-label="Close detail" className="register-drawer-scrim" href={closeHref} />
      <aside aria-label={`${detail.title} detail`} className="register-drawer surface-card">
        <header className="register-drawer-head">
          <span className={`register-attention-kind is-${detail.kind === "notice" ? "notice" : "certificate"}`}>
            <Icon aria-hidden="true" />
          </span>
          <div>
            <p className="eyebrow">{detail.kind === "dsc" ? "DSC CUSTODY" : detail.kind === "notice" ? "STATUTORY NOTICE" : "UDIN"}</p>
            <h2>{detail.title}</h2>
            <span>{detail.subtitle}</span>
          </div>
          <Link aria-label="Close detail" className="register-drawer-close" href={closeHref}><X aria-hidden="true" /></Link>
        </header>

        <div className="register-drawer-body">
          <section aria-label="Recorded details">
            <h3>Recorded details</h3>
            <dl className="register-fact-grid">
              {detail.facts.map((fact) => (
                <div key={fact.label}>
                  <dt>{fact.label}</dt>
                  <dd>{fact.value}</dd>
                </div>
              ))}
            </dl>
          </section>

          {detail.kind === "dsc" && (
            <section aria-label="Chain of custody">
              <h3>Chain of custody</h3>
              {detail.custody.length === 0 ? (
                <p className="register-drawer-empty">No custody movement has been recorded yet.</p>
              ) : (
                <ol className="register-timeline">
                  {detail.custody.map((event) => (
                    <li className={`register-timeline-item is-${event.eventType}`} key={event.id}>
                      <strong>{CUSTODY_LABELS[event.eventType] ?? event.eventType}</strong>
                      <small>{formatStamp(event.occurredAt)}</small>
                      <span>
                        {event.custodianName ? `Custodian: ${event.custodianName}` : null}
                        {event.custodianName && event.counterpartyName ? " · " : null}
                        {event.counterpartyName ? `With: ${event.counterpartyName}` : null}
                      </span>
                      {event.remarks && <em>{event.remarks}</em>}
                    </li>
                  ))}
                </ol>
              )}
            </section>
          )}

          <section aria-label="Audit trail">
            <h3>Audit trail</h3>
            {detail.audit.length === 0 ? (
              <p className="register-drawer-empty">Nothing has been recorded against this entry yet.</p>
            ) : (
              <ol className="register-timeline">
                {detail.audit.map((event) => (
                  <li className="register-timeline-item is-audit" key={event.id}>
                    <strong>{AUDIT_LABELS[event.action] ?? event.action}</strong>
                    <small>{formatStamp(event.occurredAt)}</small>
                    <span>{event.actorName ?? "Scheduled job"}</span>
                    {event.reason && <em>{event.reason}</em>}
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      </aside>
    </>
  );
}
