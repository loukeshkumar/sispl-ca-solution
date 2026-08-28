import Link from "next/link";

import type { DashboardData, DashboardWorkItem, WorkStatus } from "../../lib/dashboard/types";
import type { WorkFilter } from "../../lib/dashboard/filters";
import { DashboardIcon } from "./dashboard-icons";
import { EmptyState, InitialsAvatar, KpiCard, PageTitle, ProgressBar, StatusBadge } from "./dashboard-ui";
import { OverviewAnalytics } from "./overview-analytics";
import { TodoWidget } from "./todo-widget";
import type { TodoWorkspaceData } from "../../lib/todos/repository";

export type OverviewFilter = WorkFilter;

const filters: OverviewFilter[] = ["All", "Overdue", "Due this week", "Critical", "At risk", "Waiting", "Review"];
const displayNumber = (value: number) => value.toString().padStart(2, "0");
const statusTone = (status: WorkStatus) => ({
  "At risk": "amber",
  Critical: "red",
  Review: "mint",
  Waiting: "blue",
  Completed: "mint",
})[status];

function activeOwnerWorkloads(data: DashboardData) {
  const workloads = new Map<string, number>();
  for (const item of data.work) {
    if (item.status === "Completed") continue;
    workloads.set(item.owner, (workloads.get(item.owner) ?? 0) + 1);
  }
  return Array.from(workloads.values());
}

function OverviewKpis({
  data,
  filter,
  onFilterChange,
  onOpenMyWork,
}: {
  data: DashboardData;
  filter: OverviewFilter;
  onFilterChange: (filter: OverviewFilter) => void;
  onOpenMyWork: () => void;
}) {
  return (
    <section aria-label="Practice work metrics" className="overview-kpi-grid kpi-grid">
      <KpiCard icon="alert" label="ATTENTION NEEDED" note={`${data.metrics.overdue} overdue · ${data.metrics.waitingOnClient} waiting`} onClick={onOpenMyWork} sparkValues={[data.metrics.overdue, data.metrics.waitingOnClient, data.metrics.pendingReview, data.metrics.criticalClients]} tone="red" value={displayNumber(data.metrics.attentionNeeded)} />
      <KpiCard icon="review" label="ON-TIME RATE" note={`${data.metrics.completed} recorded completions`} sparkValues={[data.metrics.completed, data.metrics.attentionNeeded]} tone="mint" value={`${data.metrics.onTimeRate}%`} />
      <KpiCard icon="insights" label="PORTFOLIO HEALTH" note={`${data.metrics.criticalClients} critical clients`} sparkValues={data.serviceHealth.map((service) => service.value)} tone="blue" value={`${data.metrics.averageHealth}%`} />
      <KpiCard icon="clock" label="DUE THIS WEEK" note="Next seven days" onClick={() => onFilterChange("Due this week")} pressed={filter === "Due this week"} sparkValues={[data.metrics.overdue, data.metrics.dueThisWeek, data.metrics.pendingReview]} tone="amber" value={displayNumber(data.metrics.dueThisWeek)} />
      <KpiCard icon="team" label="ACTIVE EMPLOYEES" note="Enabled firm members" sparkValues={activeOwnerWorkloads(data)} tone="mint" value={displayNumber(data.practice.activeTeamMembers)} />
    </section>
  );
}

function PriorityQueue({
  filter,
  items,
  onFilterChange,
  onOpenMyWork,
  onQueryChange,
  query,
}: {
  filter: OverviewFilter;
  items: DashboardWorkItem[];
  onFilterChange: (filter: OverviewFilter) => void;
  onOpenMyWork: () => void;
  onQueryChange: (value: string) => void;
  query: string;
}) {
  return (
    <section className="priority-queue-panel surface-card">
      <div className="panel-heading">
        <div><p className="eyebrow">PRIORITY QUEUE</p><h2>Attention needed</h2><span>Ranked by deadline and dependency</span></div>
        <button className="text-action" onClick={onOpenMyWork} type="button">View all work <DashboardIcon name="arrow" size={16} /></button>
      </div>
      <div className="workspace-toolbar">
        <div className="segment-control" aria-label="Filter priority work">
        {filters.map((item) => (
          <button aria-pressed={filter === item} key={item} onClick={() => onFilterChange(item)} type="button">
            {item}{item === "All" && <span>{items.length}</span>}
          </button>
        ))}
        </div>
        <label className="client-search"><DashboardIcon name="search" size={17} /><input aria-label="Filter this queue by client, service, or owner" onChange={(event) => onQueryChange(event.target.value)} placeholder="Filter this queue..." type="search" value={query} /></label>
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
            <Link aria-label={`Open ${item.client} work item`} className="row-action icon-button" href={`/work/${item.id}`}><DashboardIcon name="arrow" size={17} /></Link>
          </article>
        ))}
        {!items.length && <EmptyState description="Clear the filter or search to see the full delivery queue." icon="work" title="No work matches these filters" />}
      </div>
    </section>
  );
}

export function OverviewWorkspace({
  active,
  data,
  filter,
  items,
  onFilterChange,
  onOpenMyWork,
  onQueryChange,
  query,
  todos,
}: {
  active: string;
  data: DashboardData;
  filter: OverviewFilter;
  items: DashboardWorkItem[];
  onFilterChange: (filter: OverviewFilter) => void;
  onOpenMyWork: () => void;
  onQueryChange: (value: string) => void;
  query: string;
  todos: TodoWorkspaceData;
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
      {data.scope?.kind === "team" && !data.scope.hasReports && (
        <p className="scope-notice" role="status">
          This dashboard covers you and your direct reports, and nobody reports to you yet.
          {" "}
          <Link href="/?workspace=team">Set reporting lines in Employees</Link> to see your team&rsquo;s work here.
        </p>
      )}
      <OverviewKpis data={data} filter={filter} onFilterChange={onFilterChange} onOpenMyWork={onOpenMyWork} />
      <OverviewAnalytics data={data} />
      <TodoWidget workspace={todos} />
      <PriorityQueue filter={filter} items={items} onFilterChange={onFilterChange} onOpenMyWork={onOpenMyWork} onQueryChange={onQueryChange} query={query} />
    </div>
  );
}
