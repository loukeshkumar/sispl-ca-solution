"use client";

import Link from "next/link";
import { AlertTriangle, FileSignature, KeyRound, Scale, Search } from "lucide-react";
import { useMemo, useState } from "react";

import { buildAttentionQueue, certificateBand } from "../../lib/registers/attention";
import { registerHref, REGISTER_TABS, STATUSES_BY_TAB, type RegisterParams } from "../../lib/registers/queue-params";
import type { RegistersWorkspaceData } from "../../lib/registers/repository";
import { recordDscMovementAction, revokeUdinAction, updateNoticeStatusAction } from "../registers/actions";
import { KpiCard, PageTitle, StatusBadge } from "./dashboard-ui";
import { DscBulkBar, NoticeBulkBar } from "./register-bulk-bars";
import RegisterDialogs, { type RegisterDialogKind, type RegisterFormOptions } from "./register-dialogs";

/** The same urgency bands the delivery workspaces use, so one habit covers all. */
const NOTICE_URGENCY = [
  { key: "overdue", label: "Overdue", note: "Past the response date", test: (days: number) => days < 0 },
  { key: "today", label: "Due today", note: "Respond today", test: (days: number) => days === 0 },
  { key: "week", label: "Due this week", note: "Within seven days", test: (days: number) => days > 0 && days <= 7 },
  { key: "later", label: "Later", note: "Beyond this week", test: (days: number) => days > 7 },
] as const;

const CERTIFICATE_BANDS = [
  { key: "expired", label: "Past validity", note: "Still recorded as live" },
  { key: "imminent", label: "Expires within 7 days", note: "Renew now" },
  { key: "soon", label: "Expires within 30 days", note: "Plan the renewal" },
  { key: "later", label: "Later", note: "Beyond 30 days" },
] as const;

const dayDifference = (dateKey: string, todayKey: string) => Math.round(
  (Date.parse(`${dateKey}T00:00:00Z`) - Date.parse(`${todayKey}T00:00:00Z`)) / 86_400_000,
);

const documentTypeLabels: Record<string, string> = {
  tax_audit: "Tax audit", statutory_audit: "Statutory audit", gst_audit: "GST audit",
  certificate: "Certificate", itr_filing: "ITR filing", roc_filing: "ROC filing", other: "Other",
};
const authorityLabels: Record<string, string> = {
  income_tax: "Income tax", gst: "GST", tds: "TDS", roc: "ROC", other: "Other",
};
const dscStatusLabels: Record<string, string> = {
  in_custody: "In custody", issued_out: "Issued out", returned: "Returned", expired: "Expired", surrendered: "Surrendered",
};
const noticeStatusLabels: Record<string, string> = {
  open: "Open", in_progress: "In progress", responded: "Responded", closed: "Closed",
};

export type RegistersViewData = {
  canManage: boolean;
  data: RegistersWorkspaceData;
  options: RegisterFormOptions;
  params: RegisterParams;
  registerError?: string;
};

export function RegistersWorkspace({ canManage, data, options, params, registerError }: RegistersViewData) {
  const members = options.members;
  const [openDialog, setOpenDialog] = useState<RegisterDialogKind>(null);
  const tab = params.tab;
  const normalized = params.q.trim().toLowerCase();
  const status = params.status;

  const udins = useMemo(() => data.udins.filter((entry) => (status === "all" || entry.status === status) && (!normalized
    || `${entry.udin} ${entry.clientName} ${entry.documentDescription} ${entry.signedByName}`.toLowerCase().includes(normalized))), [data.udins, normalized, status]);
  const certificates = useMemo(() => data.certificates.filter((entry) => (status === "all" || entry.status === status) && (!normalized
    || `${entry.serialNumber} ${entry.holderName} ${entry.clientName} ${entry.issuingAuthority}`.toLowerCase().includes(normalized))), [data.certificates, normalized, status]);
  const notices = useMemo(() => data.notices.filter((entry) => (status === "all" || entry.status === status) && (!normalized
    || `${entry.noticeNumber} ${entry.subject} ${entry.clientName} ${entry.noticeSection}`.toLowerCase().includes(normalized))), [data.notices, normalized, status]);

  const attention = useMemo(
    () => buildAttentionQueue({ certificates: data.certificates, notices: data.notices, todayKey: data.todayKey }),
    [data.certificates, data.notices, data.todayKey],
  );
  const noticeGroups = NOTICE_URGENCY
    .map((group) => ({ ...group, items: notices.filter((entry) => group.test(dayDifference(entry.responseDueDate, data.todayKey))) }))
    .filter((group) => group.items.length > 0);
  const certificateGroups = CERTIFICATE_BANDS
    .map((group) => ({ ...group, items: certificates.filter((entry) => certificateBand(entry.validUntil, data.todayKey) === group.key) }))
    .filter((group) => group.items.length > 0);

  return <section className="registers-workspace">
    <PageTitle
      actions={canManage ? <div className="package-title-actions">
        <button className="secondary-button" onClick={() => setOpenDialog("dsc")} type="button"><KeyRound aria-hidden="true" />Register DSC</button>
        <button className="secondary-button" onClick={() => setOpenDialog("notice")} type="button"><Scale aria-hidden="true" />Log notice</button>
        <button className="primary-button" onClick={() => setOpenDialog("udin")} type="button"><FileSignature aria-hidden="true" />Record UDIN</button>
      </div> : undefined}
      description="UDINs generated on the ICAI portal, digital signature custody, and statutory notices, kept as an auditable firm register."
      eyebrow="STATUTORY REGISTERS"
      title="Registers"
    />

    {registerError && <p className="package-form-banner" role="alert">
      {registerError === "reason" ? "Enter a reason of at least 3 characters."
        : registerError === "dates" ? "Enter the date the response was filed."
          : "That entry has moved on since the page loaded. Review its current state below."}
    </p>}

    <section className="package-kpi-grid kpi-grid">
      <KpiCard icon="documents" label="ACTIVE UDINS" note="Recorded and not revoked" tone="blue" value={String(data.metrics.activeUdins).padStart(2, "0")} />
      <KpiCard icon="alert" label="DSC EXPIRING" note="Within 30 days" tone="amber" value={String(data.metrics.expiringCertificates).padStart(2, "0")} />
      <KpiCard icon="alert" label="DSC EXPIRED" note="Still held by the firm" tone="red" value={String(data.metrics.expiredCertificates).padStart(2, "0")} />
      <KpiCard icon="compliance" label="OPEN NOTICES" note={`${data.metrics.overdueNotices} past the deadline`} tone={data.metrics.overdueNotices > 0 ? "red" : "mint"} value={String(data.metrics.openNotices).padStart(2, "0")} />
    </section>

    <section className="client-package-register surface-card">
      <div className="package-register-toolbar">
        <nav aria-label="Choose a register" className="package-catalogue-tabs">
          {REGISTER_TABS.map((entry) => (
            <Link aria-current={tab === entry.key ? "page" : undefined} href={registerHref({ ...params, status: "all", tab: entry.key })} key={entry.key}>
              {entry.label}
              <span>{entry.key === "attention" ? attention.length : entry.key === "udin" ? data.udins.length : entry.key === "dsc" ? data.certificates.length : data.notices.length}</span>
            </Link>
          ))}
        </nav>
        <div className="package-register-controls">
          <form action="/" method="get">
            <input name="workspace" type="hidden" value="registers" />
            <input name="tab" type="hidden" value={tab} />
            <input name="status" type="hidden" value={status} />
            <label>
              <Search aria-hidden="true" />
              <input aria-label="Search this register" defaultValue={params.q} name="q" placeholder="Search this register…" type="search" />
            </label>
          </form>
        </div>
      </div>

      {Boolean(STATUSES_BY_TAB[tab].length) && (
        <nav aria-label="Filter by status" className="segment-control register-status-filter">
          <Link aria-current={status === "all" ? "page" : undefined} href={registerHref({ ...params, status: "all" })}>All</Link>
          {STATUSES_BY_TAB[tab].map((option) => (
            <Link aria-current={status === option ? "page" : undefined} href={registerHref({ ...params, status: option })} key={option}>
              {dscStatusLabels[option] ?? noticeStatusLabels[option] ?? (option === "active" ? "Active" : option === "revoked" ? "Revoked" : option)}
            </Link>
          ))}
        </nav>
      )}

      {tab === "attention" && (attention.length === 0 ? (
        <div className="package-empty-state"><AlertTriangle aria-hidden="true" /><strong>Nothing needs action</strong><p>No notice is due within seven days and no live certificate lapses within thirty.</p></div>
      ) : (
        <div className="register-attention-list">
          {attention.map((item) => (
            <article className={`register-attention-row is-${item.severity}`} key={`${item.kind}:${item.id}`}>
              <span className={`register-attention-kind is-${item.kind}`}>{item.kind === "notice" ? <Scale aria-hidden="true" /> : <KeyRound aria-hidden="true" />}</span>
              <span><strong>{item.label}</strong><small>{item.clientName}</small></span>
              <span><strong>{item.dueDate}</strong><small>{item.detail}</small></span>
              <Link href={registerHref({ ...params, status: "all", tab: item.kind === "notice" ? "notices" : "dsc" })}>Open register</Link>
            </article>
          ))}
        </div>
      ))}

      {tab === "udin" && (udins.length === 0 ? (
        <div className="package-empty-state"><FileSignature aria-hidden="true" /><strong>No UDINs recorded</strong><p>Record each UDIN generated on the ICAI portal against the signed document.</p></div>
      ) : (
        <div>
          <div className="package-register-head udin-register-head"><span>UDIN</span><span>Client · document</span><span>Signed by</span><span>Generated</span><span>Status</span></div>
          {udins.map((entry) => (
            <article className="package-register-row udin-register-row" key={entry.id}>
              <span><strong>{entry.udin}</strong><small>{documentTypeLabels[entry.documentType] ?? entry.documentType}</small></span>
              <span><strong>{entry.clientName}</strong><small>{entry.documentDescription}</small></span>
              <span><strong>{entry.signedByName}</strong><small>M. No. {entry.membershipNumber}</small></span>
              <span>{entry.generatedOn}</span>
              {entry.status === "active" && canManage ? (
                <form action={revokeUdinAction} className="register-inline-form">
                  <input name="udinId" type="hidden" value={entry.id} />
                  <input aria-label={`Revocation reason for ${entry.udin}`} maxLength={500} minLength={3} name="reason" placeholder="Revocation reason" required type="text" />
                  <button type="submit">Revoke</button>
                </form>
              ) : (
                <StatusBadge tone={entry.status === "active" ? "mint" : "red"}>{entry.status === "active" ? "Active" : "Revoked"}</StatusBadge>
              )}
            </article>
          ))}
        </div>
      ))}

      {tab === "dsc" && (certificates.length === 0 ? (
        <div className="package-empty-state"><KeyRound aria-hidden="true" /><strong>No certificates registered</strong><p>Track token custody and expiry. Never record PINs or private keys here.</p></div>
      ) : (
        <div>
          {canManage && <DscBulkBar members={members} />}
          <div className="package-register-head dsc-register-head"><span>Holder · serial</span><span>Client</span><span>Validity</span><span>Custody</span><span>Movement</span></div>
          {certificateGroups.map((group) => (
          <section aria-label={group.label} className="work-urgency-group" key={group.key}>
            <header className={`work-urgency-heading is-${group.key === "expired" ? "overdue" : group.key === "imminent" ? "today" : group.key === "soon" ? "week" : "later"}`}>
              <strong>{group.label}</strong><em>{group.items.length}</em><small>{group.note}</small>
            </header>
          {group.items.map((entry) => {
            const band = certificateBand(entry.validUntil, data.todayKey);
            const expired = band === "expired";
            const expiring = band === "imminent" || band === "soon";
            return (
              <article className="package-register-row dsc-register-row" key={entry.id}>
                {canManage && <span className="register-row-select"><input aria-label={`Select ${entry.serialNumber}`} form="dsc-bulk-form" name="dscId" type="checkbox" value={entry.id} /></span>}
                <span><strong>{entry.holderName}</strong><small>{entry.serialNumber} · {entry.certificateClass.replace("_", " ")}</small></span>
                <span><strong>{entry.clientName}</strong><small>{entry.issuingAuthority}</small></span>
                <span>
                  <strong className={expired ? "register-expired" : expiring ? "register-expiring" : undefined}>{entry.validUntil}</strong>
                  <small>{expired ? "Expired" : `from ${entry.validFrom}`}</small>
                </span>
                <span>
                  <StatusBadge tone={entry.status === "in_custody" ? "mint" : entry.status === "issued_out" ? "amber" : "neutral"}>{dscStatusLabels[entry.status] ?? entry.status}</StatusBadge>
                  {entry.custodianName && <small>{entry.custodianName}</small>}
                </span>
                {canManage && ["in_custody", "issued_out"].includes(entry.status) ? (
                  <form action={recordDscMovementAction} className="register-inline-form">
                    <input name="dscId" type="hidden" value={entry.id} />
                    <input name="eventType" type="hidden" value={entry.status === "in_custody" ? "issued_out" : "returned"} />
                    {entry.status === "in_custody" ? (
                      <input aria-label={`Issue ${entry.serialNumber} to`} maxLength={120} name="counterpartyName" placeholder="Issued to" required type="text" />
                    ) : (
                      <select aria-label={`Returning custodian for ${entry.serialNumber}`} name="custodianUserId" required>
                        <option value="">Returned to…</option>
                        {members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
                      </select>
                    )}
                    <button type="submit">{entry.status === "in_custody" ? "Issue out" : "Record return"}</button>
                  </form>
                ) : <span>{entry.storageLocation || "—"}</span>}
              </article>
            );
          })}
          </section>
          ))}
        </div>
      ))}

      {tab === "notices" && (notices.length === 0 ? (
        <div className="package-empty-state"><Scale aria-hidden="true" /><strong>No notices logged</strong><p>Log income-tax, GST, TDS, and ROC notices with their response deadlines.</p></div>
      ) : (
        <div>
          {canManage && <NoticeBulkBar members={members} />}
          <div className="package-register-head notice-register-head"><span>Notice</span><span>Client · subject</span><span>Response due</span><span>Owner</span><span>Status</span></div>
          {noticeGroups.map((group) => (
          <section aria-label={group.label} className="work-urgency-group" key={group.key}>
            <header className={`work-urgency-heading is-${group.key}`}>
              <strong>{group.label}</strong><em>{group.items.length}</em><small>{group.note}</small>
            </header>
          {group.items.map((entry) => {
            const overdue = ["open", "in_progress"].includes(entry.status) && entry.responseDueDate < data.todayKey;
            return (
              <article className="package-register-row notice-register-row" key={entry.id}>
                {canManage && <span className="register-row-select"><input aria-label={`Select ${entry.noticeNumber}`} form="notice-bulk-form" name="noticeId" type="checkbox" value={entry.id} /></span>}
                <span><strong>{entry.noticeNumber}</strong><small>{authorityLabels[entry.authority] ?? entry.authority}{entry.noticeSection ? ` · ${entry.noticeSection}` : ""}</small></span>
                <span><strong>{entry.clientName}</strong><small>{entry.subject}</small></span>
                <span><strong className={overdue ? "register-expired" : undefined}>{entry.responseDueDate}</strong><small>{overdue ? "Overdue" : `received ${entry.receivedDate}`}</small></span>
                <span>{entry.assigneeName ?? "Unassigned"}</span>
                {canManage && entry.status !== "closed" ? (
                  <form action={updateNoticeStatusAction} className="register-inline-form">
                    <input name="noticeId" type="hidden" value={entry.id} />
                    <select aria-label={`Status for ${entry.noticeNumber}`} defaultValue={entry.status} name="status">
                      {Object.entries(noticeStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                    <input aria-label={`Response date for ${entry.noticeNumber}`} defaultValue={entry.respondedOn ?? data.todayKey} name="respondedOn" type="date" />
                    <button type="submit">Save</button>
                  </form>
                ) : (
                  <StatusBadge tone={entry.status === "closed" ? "mint" : overdue ? "red" : "blue"}>{noticeStatusLabels[entry.status] ?? entry.status}</StatusBadge>
                )}
              </article>
            );
          })}
          </section>
          ))}
        </div>
      ))}
    </section>

    <RegisterDialogs onClose={() => setOpenDialog(null)} open={openDialog} options={options} todayKey={data.todayKey} />
  </section>;
}
