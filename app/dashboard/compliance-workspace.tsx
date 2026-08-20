import Link from "next/link";

import { raiseCoverageGapAction } from "../compliance/actions";
import type { CoverageGap } from "../../lib/compliance/repository";
import { buildComplianceMatrix } from "../../lib/compliance/matrix";
import { complianceHref, COMPLIANCE_PRESETS, type ComplianceParams } from "../../lib/compliance/queue-params";
import type { DashboardData, WorkStatus } from "../../lib/dashboard/types";
import type { WorkQueueRow } from "../../lib/work/queue";
import { workServiceLabel } from "../../lib/work/validation";
import { DashboardIcon } from "./dashboard-icons";
import { EmptyState, KpiCard, PageTitle, ProgressBar, StatusBadge } from "./dashboard-ui";
import { WorkDialogButton } from "./work-dialog";

export type ComplianceViewData = {
  canWrite: boolean;
  data: DashboardData;
  evidenced: string[];
  gaps: CoverageGap[];
  params: ComplianceParams;
  rows: WorkQueueRow[];
  services: string[];
  todayKey: string;
};

const STATUSES: ComplianceParams["status"][] = ["All", "Overdue", "Due this week", "Critical", "At risk", "Waiting", "Review"];
const VIEWS: Array<{ key: ComplianceParams["view"]; label: string }> = [
  { key: "register", label: "Obligation register" },
  { key: "matrix", label: "Client × period" },
  { key: "gaps", label: "Not raised" },
];

const statusTone = (status: WorkStatus) => ({ Critical: "red", "At risk": "amber", Waiting: "blue", Review: "mint", Completed: "mint" })[status];
const cellTone = (status: string | null) => (status === null ? "none" : { critical: "red", at_risk: "amber", waiting: "blue", review: "mint", completed: "mint" }[status] ?? "blue");
const formatDate = (value: string) => new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));

/** Negative lateness is an obligation still ahead of its deadline, not "-30 late". */
function lateness(daysLate: number) {
  if (daysLate > 0) return { label: `${daysLate}d past due`, tone: "overdue" };
  if (daysLate === 0) return { label: "Due today", tone: "today" };
  return { label: `Due in ${Math.abs(daysLate)}d`, tone: "later" };
}

function GapRow({ canWrite, gap }: { canWrite: boolean; gap: CoverageGap }) {
  const late = lateness(gap.daysLate);
  return (
    <div className="compliance-gap-row">
      <span><strong>{gap.clientName}</strong><small>{workServiceLabel(gap.serviceKey)} · {gap.periodKey}</small></span>
      <span><strong>{formatDate(gap.statutoryDueDate)}</strong><small className={`work-due-chip is-${late.tone}`}>{late.label}</small></span>
      {canWrite
        ? (
          <form action={raiseCoverageGapAction}>
            <input name="legalEntityId" type="hidden" value={gap.legalEntityId} />
            <input name="serviceKey" type="hidden" value={gap.serviceKey} />
            <input name="periodKey" type="hidden" value={gap.periodKey} />
            <input name="statutoryDueDate" type="hidden" value={gap.statutoryDueDate} />
            <input name="internalDueDate" type="hidden" value={gap.internalDueDate} />
            <button className="secondary-button" type="submit">Raise obligation</button>
          </form>
        )
        : <span className="compliance-gap-readonly">Not raised</span>}
    </div>
  );
}

export function ComplianceWorkspace({ canWrite, data, evidenced, gaps, params, rows, services, todayKey }: ComplianceViewData) {
  const evidencedIds = new Set(evidenced);
  const visible = params.evidence === "missing"
    ? rows.filter((row) => row.status === "Completed" && !evidencedIds.has(row.id))
    : rows;
  const matrix = buildComplianceMatrix(visible.map((row) => ({
    clientName: row.client, id: row.id, legalEntityId: row.legalEntityId,
    periodKey: row.periodKey, status: row.status.toLowerCase().replace(" ", "_"),
  })));

  return (
    <div className="compliance-workspace">
      <PageTitle
        actions={canWrite ? <WorkDialogButton title="Add obligation"><DashboardIcon name="plus" size={17} />Add obligation</WorkDialogButton> : undefined}
        description="Monitor statutory obligations, filing readiness, evidence, and obligations that were never raised."
        eyebrow="COMPLIANCE CONTROL"
        title="Compliance"
      />

      <section className="kpi-grid">
        <KpiCard icon="calendar" label="DUE THIS WEEK" note="Next seven days" tone="amber" value={String(data.metrics.dueThisWeek).padStart(2, "0")} />
        <KpiCard icon="alert" label="OVERDUE" note="Requires escalation" tone="red" value={String(data.metrics.overdue).padStart(2, "0")} />
        <KpiCard icon="review" label="READY FOR REVIEW" note="Reviewer queue" tone="mint" value={String(data.metrics.pendingReview).padStart(2, "0")} />
        {/* Obligations that should exist and do not. Nothing else on this page
            can show them, because there is no row to show. */}
        <KpiCard icon="compliance" label="NOT RAISED" note="Expected but never created" tone={gaps.length ? "red" : "blue"} value={String(gaps.length).padStart(2, "0")} />
      </section>

      <nav aria-label="Preset views" className="work-presets">
        <span>Presets</span>
        {COMPLIANCE_PRESETS.map((preset) => <Link href={complianceHref(preset.params)} key={preset.key}>{preset.label}</Link>)}
      </nav>

      <div className="workspace-toolbar work-view-toolbar">
        <div aria-label="Choose a view" className="segment-control">
          {VIEWS.map((view) => (
            <Link aria-current={params.view === view.key ? "page" : undefined} href={complianceHref({ ...params, view: view.key })} key={view.key}>
              {view.label}{view.key === "gaps" && gaps.length ? ` (${gaps.length})` : ""}
            </Link>
          ))}
        </div>
        {params.view !== "gaps" && (
          <div aria-label="Filter by status" className="segment-control">
            {STATUSES.map((status) => (
              <Link aria-current={params.status === status ? "page" : undefined} href={complianceHref({ ...params, status })} key={status}>{status}</Link>
            ))}
          </div>
        )}
      </div>

      {Boolean(services.length) && params.view !== "gaps" && (
        <nav aria-label="Filter by service" className="segment-control compliance-service-filter">
          <Link aria-current={params.service === null ? "page" : undefined} href={complianceHref({ ...params, service: null })}>All services</Link>
          {services.map((service) => (
            <Link aria-current={params.service === service ? "page" : undefined} href={complianceHref({ ...params, service })} key={service}>{workServiceLabel(service)}</Link>
          ))}
        </nav>
      )}

      {params.view === "gaps" && (
        <section className="surface-card compliance-gaps">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">COVERAGE</p>
              <h2>Obligations not raised</h2>
              {/* A gap is not automatically a failure, and saying so keeps the
                  report trustworthy enough to act on. */}
              <span>Expected from each client&apos;s package and the firm&apos;s schedules, with no work item created. A gap can be legitimate — raise the ones that are not.</span>
            </div>
          </div>
          {gaps.length
            ? <div className="compliance-gap-list">{gaps.map((gap) => <GapRow canWrite={canWrite} gap={gap} key={`${gap.legalEntityId}:${gap.serviceKey}:${gap.periodKey}`} />)}</div>
            : <EmptyState description="Every obligation expected from active packages and schedules has a work item." icon="compliance" title="No coverage gaps" />}
        </section>
      )}

      {params.view === "matrix" && (
        <section className="surface-card compliance-matrix-panel">
          <div className="panel-heading"><div><p className="eyebrow">PORTFOLIO</p><h2>Client × period</h2><span>{params.service ? workServiceLabel(params.service) : "Choose a service for a single-statute view"}</span></div></div>
          {matrix.rows.length
            ? (
              <div className="work-capacity-scroll">
                <div className="compliance-matrix" style={{ "--periods": matrix.periods.length } as React.CSSProperties}>
                  <div className="compliance-matrix-head"><span>Client</span>{matrix.periods.map((period) => <span key={period}>{period}</span>)}</div>
                  {matrix.rows.map((row) => (
                    <div className="compliance-matrix-row" key={row.legalEntityId}>
                      <span className="compliance-matrix-name">{row.clientName}</span>
                      {row.cells.map((cell) => (cell.id
                        ? <Link aria-label={`${row.clientName}, ${cell.periodKey}: ${cell.status}`} className={`compliance-matrix-cell is-${cellTone(cell.status)}`} href={`/work/${cell.id}`} key={cell.periodKey}>{cell.status?.replace("_", " ")}</Link>
                        : <span aria-label={`${row.clientName}, ${cell.periodKey}: not raised`} className="compliance-matrix-cell is-none" key={cell.periodKey}>—</span>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            )
            : <EmptyState description="No obligations match this service and status." icon="compliance" title="Nothing to plot" />}
        </section>
      )}

      {params.view === "register" && (
        <section className="compliance-grid">
          <article className="compliance-register surface-card">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">OBLIGATION REGISTER</p>
                <h2>Active compliance</h2>
                <span>{visible.length} matching {visible.length === 1 ? "obligation" : "obligations"}{params.evidence === "missing" ? " filed without evidence" : ""}</span>
              </div>
            </div>
            <div className="compliance-register-list">
              {visible.map((item) => {
                const due = item.internalDueDate ?? item.statutoryDueDate;
                return (
                  <Link href={`/work/${item.id}`} key={item.id}>
                    <span><strong>{workServiceLabel(item.serviceKey)}</strong><small>{item.client} · {item.periodKey}</small></span>
                    <span>
                      <strong>{formatDate(due)}</strong>
                      <small>{item.internalDueDate && item.internalDueDate !== item.statutoryDueDate ? `Statutory ${formatDate(item.statutoryDueDate)}` : "Statutory date"}</small>
                    </span>
                    <span><ProgressBar label={`${item.client} filing readiness`} value={item.progress} /><small>{item.progress}% ready</small></span>
                    <span className="compliance-evidence">
                      {evidencedIds.has(item.id)
                        ? <small className="is-evidenced">Evidence recorded</small>
                        : <small className={item.status === "Completed" ? "is-missing" : "is-pending"}>{item.status === "Completed" ? "No evidence" : "Not filed"}</small>}
                    </span>
                    <StatusBadge tone={statusTone(item.status)}>{item.status}</StatusBadge>
                    <DashboardIcon name="arrow" size={17} />
                  </Link>
                );
              })}
              {!visible.length && <EmptyState description="Change the status, service, or evidence filter to see more obligations." icon="compliance" title="No obligations match" />}
            </div>
          </article>

          <aside className="compliance-side">
            <section className="surface-card compliance-health-card">
              <p className="eyebrow">SERVICE READINESS</p>
              <h2>Portfolio health</h2>
              {data.serviceHealth.map((service) => (
                <Link href={complianceHref({ ...params, service: service.name.toUpperCase(), view: "matrix" })} key={service.name}>
                  <span>{service.name}</span>
                  <ProgressBar label={`${service.name} readiness`} value={service.value} />
                  <strong>{service.value}%</strong>
                </Link>
              ))}
            </section>
            <section className="surface-card compliance-deadline-card">
              <p className="eyebrow">DEADLINE RADAR</p>
              <h2>Upcoming controls</h2>
              {/* Previously capped at four with no way to reach the rest. */}
              {data.deadlines.map((deadline) => (
                <div key={deadline.id}>
                  <time><strong>{deadline.day}</strong><small>{deadline.month}</small></time>
                  <span><strong>{deadline.label}</strong><small>{deadline.summary}</small></span>
                  <StatusBadge tone={deadline.urgent ? "red" : "blue"}>{deadline.relative}</StatusBadge>
                </div>
              ))}
              {!data.deadlines.length && <EmptyState description="No statutory dates fall inside the current horizon." icon="calendar" title="Nothing upcoming" />}
            </section>
          </aside>
        </section>
      )}
      <p className="compliance-today sr-only">Reference date {todayKey}</p>
    </div>
  );
}
