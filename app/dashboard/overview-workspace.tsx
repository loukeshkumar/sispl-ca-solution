import type { DashboardData, DashboardWorkItem, WorkStatus } from "../../lib/dashboard/types";
import { DashboardIcon } from "./dashboard-icons";
import { InitialsAvatar, KpiCard, PageTitle, ProgressBar, StatusBadge } from "./dashboard-ui";

export type OverviewFilter = "All" | WorkStatus;

const filters: OverviewFilter[] = ["All", "Critical", "At risk", "Waiting", "Review"];

const displayNumber = (value: number) => value.toString().padStart(2, "0");
const statusTone = (status: WorkStatus) => ({
  "At risk": "amber",
  Critical: "red",
  Review: "mint",
  Waiting: "blue",
})[status];

function SummaryRibbon({ data, onOpenMyWork }: { data: DashboardData; onOpenMyWork: () => void }) {
  return (
    <section className="overview-summary-ribbon" aria-label="Today's operations summary">
      <div className="summary-ribbon-primary">
        <span className="summary-ribbon-icon"><DashboardIcon name="alert" /></span>
        <div>
          <strong>{data.metrics.attentionNeeded} deadlines need attention</strong>
          <p className="summary-ribbon-copy">{data.metrics.waitingOnClient} waiting on clients · {data.metrics.pendingReview} pending review</p>
        </div>
      </div>
      <div className="summary-ribbon-rate">
        <span>ON-TIME RATE</span>
        <strong>{data.metrics.onTimeRate}%</strong>
      </div>
      <button className="summary-ribbon-action" onClick={onOpenMyWork} type="button">Review priority work <DashboardIcon name="arrow" size={17} /></button>
    </section>
  );
}

function OverviewKpis({
  data,
  filter,
  onFilterChange,
}: {
  data: DashboardData;
  filter: OverviewFilter;
  onFilterChange: (filter: OverviewFilter) => void;
}) {
  return (
    <section aria-label="Practice work metrics" className="kpi-grid">
      <KpiCard icon="alert" label="OVERDUE" note="Live from work items" onClick={() => onFilterChange("Critical")} pressed={filter === "Critical"} tone="red" value={displayNumber(data.metrics.overdue)} />
      <KpiCard icon="clock" label="DUE THIS WEEK" note="Next seven days" onClick={() => onFilterChange("At risk")} pressed={filter === "At risk"} tone="amber" value={displayNumber(data.metrics.dueThisWeek)} />
      <KpiCard icon="waiting" label="WAITING ON CLIENT" note="Blocked work items" onClick={() => onFilterChange("Waiting")} pressed={filter === "Waiting"} tone="blue" value={displayNumber(data.metrics.waitingOnClient)} />
      <KpiCard icon="review" label="PENDING REVIEW" note="Review queue" onClick={() => onFilterChange("Review")} pressed={filter === "Review"} tone="mint" value={displayNumber(data.metrics.pendingReview)} />
    </section>
  );
}

function PriorityQueue({
  filter,
  items,
  onFilterChange,
}: {
  filter: OverviewFilter;
  items: DashboardWorkItem[];
  onFilterChange: (filter: OverviewFilter) => void;
}) {
  return (
    <section className="priority-queue-panel surface-card">
      <div className="panel-heading">
        <div><p className="eyebrow">PRIORITY QUEUE</p><h2>Attention needed</h2><span>Ranked by deadline and dependency</span></div>
        <button className="text-action" onClick={() => onFilterChange("All")} type="button">View all work <DashboardIcon name="arrow" size={16} /></button>
      </div>
      <div className="segment-control" aria-label="Filter priority work">
        {filters.map((item) => (
          <button aria-pressed={filter === item} key={item} onClick={() => onFilterChange(item)} type="button">
            {item}{item === "All" && <span>{items.length}</span>}
          </button>
        ))}
      </div>
      <div className="work-list-head" aria-hidden="true"><span>CLIENT & ASSIGNMENT</span><span>PROGRESS</span><span>OWNER</span><span>DUE DATE</span><span /></div>
      <div className="work-list">
        {items.map((item) => (
          <article className="work-row" key={item.id}>
            <div className="work-row-main">
              <InitialsAvatar initials={item.initials} tone={item.color} />
              <div>
                <strong className="work-client-name">{item.client}</strong>
                <p className="work-meta">{item.service} · {item.period}</p>
                <span className="work-note">{item.note}</span>
              </div>
              <StatusBadge tone={statusTone(item.status)}>{item.status}</StatusBadge>
            </div>
            <div className="work-row-progress">
              <ProgressBar label={`${item.client} progress`} value={item.progress} />
              <span>{item.progress}%</span>
            </div>
            <div className="work-row-owner"><InitialsAvatar initials={item.ownerInitials} tone="light" /><strong>{item.owner}</strong></div>
            <div className="work-row-due"><strong>{item.due}</strong><span>{item.dueDetail}</span></div>
            <button aria-label={`Open ${item.client} work item`} className="row-action icon-button" disabled type="button"><DashboardIcon name="arrow" size={17} /></button>
          </article>
        ))}
        {!items.length && <div className="empty-state">No work matches the current filters.</div>}
      </div>
    </section>
  );
}

function ComplianceHealth({ data }: { data: DashboardData }) {
  const healthy = data.metrics.legalEntities - data.metrics.attentionClients;
  const watch = data.clients.filter((client) => client.risk === "Watch").length;
  return (
    <section className="insight-card surface-card">
      <div className="insight-heading"><div><p className="eyebrow">COMPLIANCE</p><h2 className="insight-title">Health score</h2></div><span>Live</span></div>
      <div className="health-summary">
        <div className="health-ring" style={{ background: `conic-gradient(var(--violet) 0 ${data.metrics.averageHealth}%, #ebe9fb ${data.metrics.averageHealth}% 100%)` }}>
          <span><strong>{data.metrics.averageHealth}</strong><small>/100</small><em>Portfolio</em></span>
        </div>
        <div className="health-legend">
          <span><i className="legend-mint" />Healthy <b>{healthy}</b></span>
          <span><i className="legend-amber" />Watch <b>{watch}</b></span>
          <span><i className="legend-red" />Critical <b>{data.metrics.criticalClients}</b></span>
        </div>
      </div>
      <div className="service-health-list">
        {data.serviceHealth.map((service) => (
          <div key={service.name}><span>{service.name}</span><ProgressBar label={`${service.name} health`} value={service.value} /><b>{service.value}%</b></div>
        ))}
      </div>
    </section>
  );
}

function DeadlineRadar({ data }: { data: DashboardData }) {
  return (
    <section className="insight-card surface-card">
      <div className="insight-heading"><div><p className="eyebrow">UPCOMING</p><h2 className="insight-title">Deadline radar</h2></div><DashboardIcon name="calendar" size={18} /></div>
      <div className="deadline-radar-list">
        {data.deadlines.slice(0, 3).map((deadline) => (
          <article key={deadline.id}>
            <time><strong>{deadline.day}</strong><span>{deadline.month}</span></time>
            <div><strong>{deadline.label}</strong><span>{deadline.summary}</span></div>
            <StatusBadge tone={deadline.urgent ? "red" : "blue"}>{deadline.relative}</StatusBadge>
          </article>
        ))}
      </div>
    </section>
  );
}

function TeamCapacity({ data }: { data: DashboardData }) {
  const owners = Array.from(new Map(data.work.map((item) => [item.owner, item])).values());
  return (
    <section className="insight-card surface-card">
      <div className="insight-heading"><div><p className="eyebrow">TEAM</p><h2 className="insight-title">Team capacity</h2></div><span>{data.practice.activeTeamMembers} active</span></div>
      <div className="team-capacity-list">
        {owners.slice(0, 3).map((owner) => {
          const assignments = data.work.filter((item) => item.owner === owner.owner).length;
          return <div key={owner.owner}><InitialsAvatar initials={owner.ownerInitials} tone="light" /><span><strong>{owner.owner}</strong><small>{assignments} active assignment{assignments === 1 ? "" : "s"}</small></span><b>{assignments <= 1 ? "Available" : "Balanced"}</b></div>;
        })}
      </div>
    </section>
  );
}

function OverviewInsights({ data }: { data: DashboardData }) {
  return <aside className="overview-insights"><ComplianceHealth data={data} /><DeadlineRadar data={data} /><TeamCapacity data={data} /></aside>;
}

export function OverviewWorkspace({
  active,
  data,
  filter,
  items,
  onFilterChange,
  onOpenMyWork,
}: {
  active: string;
  data: DashboardData;
  filter: OverviewFilter;
  items: DashboardWorkItem[];
  onFilterChange: (filter: OverviewFilter) => void;
  onOpenMyWork: () => void;
}) {
  const title = active === "Overview" ? "Your practice, in command." : active;
  return (
    <div className="overview-workspace">
      <PageTitle
        actions={<button className="secondary-button" disabled type="button">Export report</button>}
        description={`Good day, ${data.practice.administratorName}. Here is the pulse of your firm.`}
        eyebrow={`${data.source === "postgres" ? "LOCAL DATABASE" : "DEMO"} · ${data.titleDate}`}
        title={title}
      />
      <SummaryRibbon data={data} onOpenMyWork={onOpenMyWork} />
      <OverviewKpis data={data} filter={filter} onFilterChange={onFilterChange} />
      <section className="overview-main">
        <PriorityQueue filter={filter} items={items} onFilterChange={onFilterChange} />
        <OverviewInsights data={data} />
      </section>
    </div>
  );
}
