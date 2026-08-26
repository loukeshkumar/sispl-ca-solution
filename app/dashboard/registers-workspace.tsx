"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, Download, FileSignature, KeyRound, Scale, Search, UserX } from "lucide-react";
import { useMemo, useState } from "react";

import { certificateBand, RISK_LABELS, summariseAttention } from "../../lib/registers/attention";
import { buildPeek, PEEK_DEFINITIONS, type PeekKind } from "../../lib/registers/kpi-peek";
import {
  dayDifference,
  dueChip,
  filterCertificates,
  filterNotices,
  filterUdins,
  groupByClient,
  noticeBand,
  paginate,
  sortRows,
} from "../../lib/registers/lens";
import {
  AUTHORITY_FILTERS,
  BANDS_BY_TAB,
  CLIENT_LENS_TABS,
  hasActiveRegisterFilters,
  registerFilterHref,
  registerHref,
  REGISTER_TABS,
  SORTABLE_TABS,
  STATUSES_BY_TAB,
  type RegisterParams,
  type RegisterTab,
} from "../../lib/registers/queue-params";
import type { RegisterDetail, RegistersWorkspaceData } from "../../lib/registers/repository";
import { recordDscMovementAction, revokeUdinAction, updateNoticeStatusAction } from "../registers/actions";
import { EmptyState, KpiCard, PageTitle, StatusBadge } from "./dashboard-ui";
import { DscBulkBar, NoticeBulkBar, RegisterSelection } from "./register-bulk-bars";
import { RegisterDetailDrawer } from "./register-detail-drawer";
import { RegisterKpiPeek } from "./register-kpi-peek";
import RegisterDialogs, { type RegisterDialogKind, type RegisterFormOptions } from "./register-dialogs";
import { RegisterInsightsPanel } from "./register-insights";

const dateFormatter = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "UTC" });
const formatDate = (value: string) => dateFormatter.format(new Date(`${value.slice(0, 10)}T00:00:00Z`));

/** The same urgency bands the delivery workspaces use, so one habit covers all. */
const NOTICE_GROUPS = [
  { key: "overdue", label: "Overdue", note: "Past the response date" },
  { key: "today", label: "Due today", note: "Respond today" },
  { key: "week", label: "Due this week", note: "Within seven days" },
  { key: "later", label: "Later", note: "Beyond this week" },
] as const;

const CERTIFICATE_GROUPS = [
  { heading: "overdue", key: "expired", label: "Past validity", note: "Still recorded as live" },
  { heading: "today", key: "imminent", label: "Expires within 7 days", note: "Renew now" },
  { heading: "week", key: "soon", label: "Expires within 30 days", note: "Plan the renewal" },
  { heading: "later", key: "later", label: "Later", note: "Beyond 30 days" },
] as const;

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
const statusLabel = (option: string) => dscStatusLabels[option] ?? noticeStatusLabels[option]
  ?? (option === "active" ? "Active" : option === "revoked" ? "Revoked" : option);

export type RegistersViewData = {
  canManage: boolean;
  data: RegistersWorkspaceData;
  detail?: RegisterDetail | null;
  options: RegisterFormOptions;
  params: RegisterParams;
  registerError?: string;
};

export function RegistersWorkspace({ canManage, data, detail, options, params, registerError }: RegistersViewData) {
  const router = useRouter();
  const members = options.members;
  const [openDialog, setOpenDialog] = useState<RegisterDialogKind>(null);
  const [peek, setPeek] = useState<PeekKind | null>(null);
  const { tab, todayKey } = { tab: params.tab, todayKey: data.todayKey };
  const bands = BANDS_BY_TAB[tab];
  const statuses = STATUSES_BY_TAB[tab];
  const filtered = hasActiveRegisterFilters(params);
  const go = (change: Partial<RegisterParams>) => router.push(registerFilterHref(params, change));

  const notices = useMemo(
    () => sortRows(filterNotices(data.notices, params, todayKey), params.sort, (row) => row.responseDueDate),
    [data.notices, params, todayKey],
  );
  const certificates = useMemo(
    () => sortRows(filterCertificates(data.certificates, params, todayKey), params.sort, (row) => row.validUntil),
    [data.certificates, params, todayKey],
  );
  const udins = useMemo(
    () => sortRows(filterUdins(data.udins, params), params.sort === "due" ? "recent" : params.sort, (row) => row.generatedOn),
    [data.udins, params],
  );

  const attention = data.attention;
  const summary = useMemo(() => summariseAttention(attention), [attention]);
  const visibleTotal = tab === "notices" ? notices.length : tab === "dsc" ? certificates.length : tab === "udin" ? udins.length : attention.length;
  const registerTotal = tab === "notices" ? data.counts.notices : tab === "dsc" ? data.counts.dsc : tab === "udin" ? data.counts.udin : attention.length;

  const noticePage = paginate(notices, params.page);
  const certificatePage = paginate(certificates, params.page);
  const udinPage = paginate(udins, params.page);
  const active = tab === "notices" ? noticePage : tab === "dsc" ? certificatePage : udinPage;

  const noticeClients = useMemo(() => groupByClient(notices, todayKey, (row) => row.responseDueDate), [notices, todayKey]);
  const certificateClients = useMemo(() => groupByClient(certificates, todayKey, (row) => row.validUntil), [certificates, todayKey]);
  const clientLens = CLIENT_LENS_TABS.includes(tab) && params.layout === "client";

  /**
   * A page load carries the action queue in full and exactly one register, so a
   * figure for that register opens instantly and the other two are fetched. A
   * truncated register is a prefix, not the list, so it is fetched as well —
   * a panel whose count disagreed with the figure above it would be worse than
   * one that took a moment to appear.
   */
  const peekRows = useMemo(() => {
    if (!peek) return null;
    const source = PEEK_DEFINITIONS[peek].source;
    if (source === "attention") return buildPeek(peek, { attention }, todayKey);
    const loaded = data.loadedTab === "insights" ? ["notices", "dsc", "udin"] : [data.loadedTab];
    const tabForSource = source === "certificates" ? "dsc" : source === "udins" ? "udin" : "notices";
    if (data.truncated || !loaded.includes(tabForSource)) return null;
    return buildPeek(peek, { certificates: data.certificates, notices: data.notices, udins: data.udins }, todayKey);
  }, [attention, data, peek, todayKey]);

  const tabCount = (key: RegisterTab) => key === "attention" ? attention.length
    : key === "udin" ? data.counts.udin
      : key === "dsc" ? data.counts.dsc
        : key === "notices" ? data.counts.notices : null;

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

    {/* Each figure is a starting point, so every card opens the rows behind it
        without taking the reader off the register they are already reading. */}
    <section className="package-kpi-grid kpi-grid">
      <KpiCard icon="alert" label="NEEDS ACTION" note={`${summary.overdue} overdue · ${summary.today} due today`} onClick={() => setPeek("attention")} pressed={peek === "attention"} tone={summary.overdue > 0 ? "red" : "mint"} value={String(summary.total).padStart(2, "0")} />
      <KpiCard icon="compliance" label="OPEN NOTICES" note={`${data.metrics.overdueNotices} past the deadline`} onClick={() => setPeek("notices")} pressed={peek === "notices"} tone={data.metrics.overdueNotices > 0 ? "red" : "mint"} value={String(data.metrics.openNotices).padStart(2, "0")} />
      <KpiCard icon="alert" label="DSC EXPIRING" note={`Within 30 days · ${data.metrics.expiredCertificates} already lapsed`} onClick={() => setPeek("dsc")} pressed={peek === "dsc"} tone={data.metrics.expiringCertificates > 0 ? "amber" : "mint"} value={String(data.metrics.expiringCertificates).padStart(2, "0")} />
      <KpiCard icon="documents" label="ACTIVE UDINS" note="Recorded and not revoked" onClick={() => setPeek("udin")} pressed={peek === "udin"} tone="blue" value={String(data.metrics.activeUdins).padStart(2, "0")} />
    </section>

    <RegisterKpiPeek
      fullHref={peek ? registerFilterHref(params, PEEK_DEFINITIONS[peek].filters) : "#"}
      kind={peek}
      onClose={() => setPeek(null)}
      rows={peekRows}
    />

    <section className="client-package-register surface-card">
      <div className="package-register-toolbar">
        <nav aria-label="Choose a register" className="package-catalogue-tabs">
          {REGISTER_TABS.map((entry) => (
            <Link aria-current={tab === entry.key ? "page" : undefined} href={registerHref({ tab: entry.key })} key={entry.key}>
              {entry.label}
              {tabCount(entry.key) !== null && <span>{tabCount(entry.key)}</span>}
            </Link>
          ))}
        </nav>
        <div className="package-register-controls">
          <form action="/" method="get">
            <input name="workspace" type="hidden" value="registers" />
            <input name="tab" type="hidden" value={tab} />
            <input name="status" type="hidden" value={params.status} />
            <input name="band" type="hidden" value={params.band} />
            <input name="client" type="hidden" value={params.client} />
            <input name="owner" type="hidden" value={params.owner} />
            <label>
              <Search aria-hidden="true" />
              <input aria-label="Search this register" defaultValue={params.q} name="q" placeholder="Search this register…" type="search" />
            </label>
          </form>
          {tab !== "attention" && tab !== "insights" && (
            /* A register you cannot hand to a reviewer is only half a register. */
            <a className="secondary-button register-export-link" href={`/registers/export?tab=${tab}`}>
              <Download aria-hidden="true" />Export CSV
            </a>
          )}
        </div>
      </div>

      {Boolean(statuses.length) && (
        <nav aria-label="Filter by status" className="segment-control register-status-filter">
          <Link aria-current={params.status === "all" ? "page" : undefined} href={registerFilterHref(params, { status: "all" })}>All</Link>
          {statuses.map((option) => (
            <Link aria-current={params.status === option ? "page" : undefined} href={registerFilterHref(params, { status: option })} key={option}>
              {statusLabel(option)}
            </Link>
          ))}
        </nav>
      )}

      {tab !== "attention" && tab !== "insights" && (
        <div className="register-filter-bar">
          {Boolean(bands.length) && (
            <nav aria-label="Filter by urgency" className="segment-control">
              <Link aria-current={params.band === "all" ? "page" : undefined} href={registerFilterHref(params, { band: "all" })}>Any date</Link>
              {bands.map((band) => (
                <Link aria-current={params.band === band.key ? "page" : undefined} href={registerFilterHref(params, { band: band.key })} key={band.key}>{band.label}</Link>
              ))}
            </nav>
          )}

          <label>
            <span>Client</span>
            <select onChange={(event) => go({ client: event.target.value })} value={params.client}>
              <option value="all">All clients</option>
              {options.clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
            </select>
          </label>

          {(tab === "notices" || tab === "dsc") && (
            <label>
              <span>{tab === "notices" ? "Owner" : "Custodian"}</span>
              <select onChange={(event) => go({ owner: event.target.value })} value={params.owner}>
                <option value="all">Anyone</option>
                <option value="unassigned">{tab === "notices" ? "Unassigned" : "No custodian"}</option>
                {members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
              </select>
            </label>
          )}

          {tab === "notices" && (
            <label>
              <span>Authority</span>
              <select onChange={(event) => go({ authority: event.target.value })} value={params.authority}>
                <option value="all">All authorities</option>
                {AUTHORITY_FILTERS.map((authority) => <option key={authority} value={authority}>{authorityLabels[authority]}</option>)}
              </select>
            </label>
          )}

          {SORTABLE_TABS.includes(tab) && (
            <label>
              <span>Sort</span>
              <select onChange={(event) => go({ sort: event.target.value as RegisterParams["sort"] })} value={params.sort}>
                <option value="due">{tab === "udin" ? "Oldest first" : "Soonest first"}</option>
                <option value="recent">{tab === "udin" ? "Newest first" : "Latest first"}</option>
                <option value="client">By client</option>
              </select>
            </label>
          )}

          {CLIENT_LENS_TABS.includes(tab) && (
            <nav aria-label="Choose a layout" className="segment-control">
              <Link aria-current={params.layout === "list" ? "page" : undefined} href={registerFilterHref(params, { layout: "list" })}>By entry</Link>
              <Link aria-current={params.layout === "client" ? "page" : undefined} href={registerFilterHref(params, { layout: "client" })}>By client</Link>
            </nav>
          )}

          <p className="register-filter-summary">
            {visibleTotal === registerTotal
              ? `${registerTotal} ${registerTotal === 1 ? "entry" : "entries"}`
              : `${visibleTotal} of ${registerTotal}`}
            {data.truncated && <em> · first {data.certificates.length || data.notices.length || data.udins.length} loaded</em>}
          </p>
          {filtered && <Link className="register-clear-filters" href={registerHref({ tab })}>Clear filters</Link>}
        </div>
      )}

      {tab === "attention" && (attention.length === 0 ? (
        <div className="package-empty-state"><AlertTriangle aria-hidden="true" /><strong>Nothing needs action</strong><p>No notice is due within seven days, every notice has an owner, no live certificate lapses within thirty days, and no token is out unaccounted for.</p></div>
      ) : (
        <>
          <div className="register-attention-summary">
            <span className="is-overdue"><strong>{summary.overdue}</strong><small>Overdue</small></span>
            <span className="is-today"><strong>{summary.today}</strong><small>Due today</small></span>
            <span className="is-unowned"><strong>{summary.unowned}</strong><small>Unassigned</small></span>
            <span className="is-custody"><strong>{summary.custody}</strong><small>Not returned</small></span>
          </div>
          <div className="register-attention-list">
            {attention.map((item) => (
              <article className={`register-attention-row is-${item.severity} risk-${item.risk}`} key={`${item.kind}:${item.risk}:${item.id}`}>
                <span className={`register-attention-kind is-${item.kind}`}>
                  {item.risk === "unowned" ? <UserX aria-hidden="true" /> : item.kind === "notice" ? <Scale aria-hidden="true" /> : <KeyRound aria-hidden="true" />}
                </span>
                <span><strong>{item.label}</strong><small>{item.clientName}</small></span>
                <span><strong>{formatDate(item.dueDate)}</strong><small>{item.detail}</small></span>
                <span className={`register-risk-chip is-${item.risk}`}>{RISK_LABELS[item.risk]}</span>
                {/* Straight at the entry, not merely at the register holding it. */}
                <Link href={item.href}>Open entry</Link>
              </article>
            ))}
          </div>
        </>
      ))}

      {tab === "insights" && (data.insights
        ? <RegisterInsightsPanel insights={data.insights} params={params} todayKey={todayKey} />
        : <div className="package-empty-state"><AlertTriangle aria-hidden="true" /><strong>Insights unavailable</strong><p>Reload the page to rebuild the register analytics.</p></div>)}

      {tab === "udin" && (udins.length === 0 ? (
        <EmptyState
          description={data.counts.udin ? "Nothing matches this view. Clear the filters or search again." : "Record each UDIN generated on the ICAI portal against the signed document."}
          icon="documents"
          title={data.counts.udin ? "Nothing here" : "No UDINs recorded"}
        />
      ) : (
        <div>
          <div className="package-register-head udin-register-head"><span>UDIN</span><span>Client · document</span><span>Signed by</span><span>Generated</span><span>Status</span></div>
          {udinPage.items.map((entry) => (
            <article className="package-register-row udin-register-row" key={entry.id}>
              <span>
                <Link className="register-row-open" href={registerHref({ ...params, focus: entry.id })}><strong>{entry.udin}</strong></Link>
                <small>{documentTypeLabels[entry.documentType] ?? entry.documentType}</small>
              </span>
              <span><strong>{entry.clientName}</strong><small>{entry.documentDescription}</small></span>
              <span><strong>{entry.signedByName}</strong><small>M. No. {entry.membershipNumber}</small></span>
              <span>{formatDate(entry.generatedOn)}</span>
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
        <EmptyState
          description={data.counts.dsc ? "Nothing matches this view. Clear the filters or search again." : "Track token custody and expiry. Never record PINs or private keys here."}
          icon="alert"
          title={data.counts.dsc ? "Nothing here" : "No certificates registered"}
        />
      ) : clientLens ? (
        <div className="register-client-groups">
          {certificateClients.map((group) => (
            <section aria-label={group.clientName} className="register-client-group" key={group.legalEntityId}>
              <header>
                <strong>{group.clientName}</strong>
                <em>{group.items.length} {group.items.length === 1 ? "certificate" : "certificates"}</em>
                {/* Escalation is driven by the nearest lapse, not the average. */}
                <small>{group.overdue ? `${group.overdue} past validity` : `next lapses in ${group.leadDays}d`}</small>
              </header>
              {group.items.map((entry) => (
                <div className="register-client-item" key={entry.id}>
                  <Link href={registerHref({ ...params, focus: entry.id })}><strong>{entry.serialNumber}</strong></Link>
                  <small>{entry.holderName}</small>
                  <small className={`work-due-chip is-${dueChip(dayDifference(entry.validUntil, todayKey)).tone}`}>{dueChip(dayDifference(entry.validUntil, todayKey)).label}</small>
                </div>
              ))}
            </section>
          ))}
        </div>
      ) : (
        <div>
          {canManage && <>
            <DscBulkBar members={members} />
            <RegisterSelection formId="dsc-bulk-form" name="dscId" />
          </>}
          <div className="package-register-head dsc-register-head"><span>Holder · serial</span><span>Client</span><span>Validity</span><span>Custody</span><span>Movement</span></div>
          {CERTIFICATE_GROUPS.map((group) => {
            const items = certificatePage.items.filter((entry) => certificateBand(entry.validUntil, todayKey) === group.key);
            if (!items.length) return null;
            return (
              <section aria-label={group.label} className="work-urgency-group" key={group.key}>
                <header className={`work-urgency-heading is-${group.heading}`}>
                  <strong>{group.label}</strong><em>{items.length}</em><small>{group.note}</small>
                </header>
                {items.map((entry) => {
                  const band = certificateBand(entry.validUntil, todayKey);
                  const expired = band === "expired";
                  const outDays = entry.issuedOutSince ? Math.abs(dayDifference(entry.issuedOutSince.slice(0, 10), todayKey)) : null;
                  return (
                    <article className="package-register-row dsc-register-row" key={entry.id}>
                      {canManage && <span className="register-row-select"><input aria-label={`Select ${entry.serialNumber}`} form="dsc-bulk-form" name="dscId" type="checkbox" value={entry.id} /></span>}
                      <span>
                        <Link className="register-row-open" href={registerHref({ ...params, focus: entry.id })}><strong>{entry.holderName}</strong></Link>
                        <small>{entry.serialNumber} · {entry.certificateClass.replace("_", " ")}</small>
                      </span>
                      <span><strong>{entry.clientName}</strong><small>{entry.issuingAuthority}</small></span>
                      <span>
                        <strong className={expired ? "register-expired" : band === "imminent" || band === "soon" ? "register-expiring" : undefined}>{formatDate(entry.validUntil)}</strong>
                        <small>{expired ? "Expired" : `from ${formatDate(entry.validFrom)}`}</small>
                      </span>
                      <span>
                        <StatusBadge tone={entry.status === "in_custody" ? "mint" : entry.status === "issued_out" ? "amber" : "neutral"}>{dscStatusLabels[entry.status] ?? entry.status}</StatusBadge>
                        {/* How long it has been out is what decides who to ring first. */}
                        {outDays !== null && <small className={outDays >= 14 ? "register-expired" : undefined}>out {outDays}d</small>}
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
                          {/* The action always accepted remarks; the row never sent any,
                              so every movement landed in the trail unexplained. */}
                          <input aria-label={`Remarks for ${entry.serialNumber}`} maxLength={500} name="remarks" placeholder="Why (optional)" type="text" />
                          <button type="submit">{entry.status === "in_custody" ? "Issue out" : "Record return"}</button>
                        </form>
                      ) : <span>{entry.storageLocation || "—"}</span>}
                    </article>
                  );
                })}
              </section>
            );
          })}
        </div>
      ))}

      {tab === "notices" && (notices.length === 0 ? (
        <EmptyState
          description={data.counts.notices ? "Nothing matches this view. Clear the filters or search again." : "Log income-tax, GST, TDS, and ROC notices with their response deadlines."}
          icon="compliance"
          title={data.counts.notices ? "Nothing here" : "No notices logged"}
        />
      ) : clientLens ? (
        <div className="register-client-groups">
          {noticeClients.map((group) => (
            <section aria-label={group.clientName} className="register-client-group" key={group.legalEntityId}>
              <header>
                <strong>{group.clientName}</strong>
                <em>{group.items.length} {group.items.length === 1 ? "notice" : "notices"}</em>
                <small>{group.overdue ? `${group.overdue} overdue` : `next due in ${group.leadDays}d`}</small>
              </header>
              {group.items.map((entry) => (
                <div className="register-client-item" key={entry.id}>
                  <Link href={registerHref({ ...params, focus: entry.id })}><strong>{entry.noticeNumber}</strong></Link>
                  <small>{entry.subject}</small>
                  <small className={`work-due-chip is-${dueChip(dayDifference(entry.responseDueDate, todayKey)).tone}`}>{dueChip(dayDifference(entry.responseDueDate, todayKey)).label}</small>
                </div>
              ))}
            </section>
          ))}
        </div>
      ) : (
        <div>
          {canManage && <>
            <NoticeBulkBar members={members} />
            <RegisterSelection formId="notice-bulk-form" name="noticeId" />
          </>}
          <div className="package-register-head notice-register-head"><span>Notice</span><span>Client · subject</span><span>Response due</span><span>Owner</span><span>Status</span></div>
          {NOTICE_GROUPS.map((group) => {
            const items = noticePage.items.filter((entry) => noticeBand(entry.responseDueDate, todayKey) === group.key);
            if (!items.length) return null;
            return (
              <section aria-label={group.label} className="work-urgency-group" key={group.key}>
                <header className={`work-urgency-heading is-${group.key}`}>
                  <strong>{group.label}</strong><em>{items.length}</em><small>{group.note}</small>
                </header>
                {items.map((entry) => {
                  const overdue = ["open", "in_progress"].includes(entry.status) && entry.responseDueDate < todayKey;
                  return (
                    <article className="package-register-row notice-register-row" key={entry.id}>
                      {canManage && <span className="register-row-select"><input aria-label={`Select ${entry.noticeNumber}`} form="notice-bulk-form" name="noticeId" type="checkbox" value={entry.id} /></span>}
                      <span>
                        <Link className="register-row-open" href={registerHref({ ...params, focus: entry.id })}><strong>{entry.noticeNumber}</strong></Link>
                        <small>{authorityLabels[entry.authority] ?? entry.authority}{entry.noticeSection ? ` · ${entry.noticeSection}` : ""}</small>
                      </span>
                      <span><strong>{entry.clientName}</strong><small>{entry.subject}</small></span>
                      <span>
                        <strong className={overdue ? "register-expired" : undefined}>{formatDate(entry.responseDueDate)}</strong>
                        <small>{overdue ? `${Math.abs(dayDifference(entry.responseDueDate, todayKey))}d overdue` : `received ${formatDate(entry.receivedDate)}`}</small>
                      </span>
                      <span className={entry.assigneeName ? undefined : "register-unowned"}>{entry.assigneeName ?? "Unassigned"}</span>
                      {canManage && entry.status !== "closed" ? (
                        <form action={updateNoticeStatusAction} className="register-inline-form">
                          <input name="noticeId" type="hidden" value={entry.id} />
                          <select aria-label={`Status for ${entry.noticeNumber}`} defaultValue={entry.status} name="status">
                            {Object.entries(noticeStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                          </select>
                          <input aria-label={`Response date for ${entry.noticeNumber}`} defaultValue={entry.respondedOn ?? todayKey} name="respondedOn" type="date" />
                          {/* Captured by the action all along, and never asked for. */}
                          <input aria-label={`Response summary for ${entry.noticeNumber}`} defaultValue={entry.responseSummary} maxLength={2000} name="responseSummary" placeholder="What was filed" type="text" />
                          <button type="submit">Save</button>
                        </form>
                      ) : (
                        <StatusBadge tone={entry.status === "closed" ? "mint" : overdue ? "red" : "blue"}>{noticeStatusLabels[entry.status] ?? entry.status}</StatusBadge>
                      )}
                    </article>
                  );
                })}
              </section>
            );
          })}
        </div>
      ))}

      {!clientLens && tab !== "attention" && tab !== "insights" && active.pages > 1 && (
        <nav aria-label="Pages" className="register-pagination">
          <Link
            aria-disabled={active.page === 1}
            className={active.page === 1 ? "is-disabled" : undefined}
            href={registerHref({ ...params, focus: "", page: Math.max(1, active.page - 1) })}
          >Previous</Link>
          <span>{active.from}–{active.to} of {active.total}</span>
          <Link
            aria-disabled={active.page === active.pages}
            className={active.page === active.pages ? "is-disabled" : undefined}
            href={registerHref({ ...params, focus: "", page: Math.min(active.pages, active.page + 1) })}
          >Next</Link>
        </nav>
      )}
    </section>

    {detail && <RegisterDetailDrawer closeHref={registerHref({ ...params, focus: "" })} detail={detail} />}

    <RegisterDialogs onClose={() => setOpenDialog(null)} open={openDialog} options={options} todayKey={todayKey} />
  </section>;
}
