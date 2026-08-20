import Link from "next/link";

import { dayDifference } from "../../lib/dashboard/filters";
import type { WorkStatus } from "../../lib/dashboard/types";
import { burnPercentage } from "../../lib/work/capacity";
import type { CapacityLane, QueueTotals, WorkQueueRow } from "../../lib/work/queue";
import { workQueueHref, WORK_QUEUE_PRESETS, type WorkQueueParams, type WorkScope, type WorkSort } from "../../lib/work/queue-params";
import type { WorkMemberOption } from "../../lib/work/repository";
import { workServiceLabel } from "../../lib/work/validation";
import { DashboardIcon } from "./dashboard-icons";
import { EmptyState, InitialsAvatar, KpiCard, PageTitle, ProgressBar, StatusBadge } from "./dashboard-ui";
import { WorkBulkBar } from "./work-bulk-bar";
import { WorkCapacityView } from "./work-capacity-view";
import { WorkDialogButton } from "./work-dialog";

export type WorkQueueViewData = {
  canWrite: boolean;
  lanes: CapacityLane[];
  members: WorkMemberOption[];
  params: WorkQueueParams;
  rows: WorkQueueRow[];
  todayKey: string;
  totals: QueueTotals;
};

const FILTERS: WorkQueueParams["filter"][] = ["All", "Overdue", "Due this week", "Critical", "At risk", "Waiting", "Review"];
const statusTone = (status: WorkStatus) => ({ Critical: "red", "At risk": "amber", Waiting: "blue", Review: "mint", Completed: "mint" })[status];

const SCOPES: Array<{ key: WorkScope; label: string }> = [
  { key: "mine", label: "Assigned to me" },
  { key: "reviewing", label: "I review" },
  { key: "firm", label: "Whole firm" },
];

const SORTS: Array<{ key: WorkSort; label: string }> = [
  { key: "due", label: "Deadline" },
  { key: "progress", label: "Progress" },
  { key: "client", label: "Client" },
];

const VIEWS: Array<{ key: WorkQueueParams["view"]; label: string }> = [
  { key: "list", label: "Deadline list" },
  { key: "board", label: "Status board" },
  { key: "capacity", label: "Capacity" },
];

/**
 * How a practice actually triages: what has slipped, what is due now, what is
 * due this week, everything else. Sorting alone buries the first group inside a
 * long list; grouping puts a count on it before anything is read.
 */
const URGENCY = [
  { key: "overdue", label: "Overdue", note: "Past the managed date", test: (days: number) => days < 0 },
  { key: "today", label: "Due today", note: "Close these first", test: (days: number) => days === 0 },
  { key: "week", label: "Due this week", note: "Within seven days", test: (days: number) => days > 0 && days <= 7 },
  { key: "later", label: "Later", note: "Beyond this week", test: (days: number) => days > 7 },
] as const;

const BOARD_COLUMNS: WorkStatus[] = ["Critical", "At risk", "Waiting", "Review"];

/** The countdown, phrased the way someone says it out loud. */
function dueChip(days: number) {
  if (days < 0) return { label: `${Math.abs(days)}d overdue`, tone: "overdue" };
  if (days === 0) return { label: "Due today", tone: "today" };
  if (days === 1) return { label: "Due tomorrow", tone: "soon" };
  if (days <= 7) return { label: `${days}d left`, tone: "soon" };
  return { label: `${days}d left`, tone: "later" };
}

const formatMinutes = (minutes: number) => (minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h${minutes % 60 ? ` ${minutes % 60}m` : ""}`);
const formatDateKey = (value: string) => new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
/** The date the firm manages to, which is the internal one whenever it exists. */
const effectiveDue = (item: WorkQueueRow) => item.internalDueDate ?? item.statutoryDueDate;

function BurnCell({ item }: { item: WorkQueueRow }) {
  const burn = burnPercentage(item.loggedMinutes, item.budgetMinutes);
  if (burn === null) return <span className="work-workspace-burn"><small className="work-burn-none">No budget</small></span>;
  return (
    <span className="work-workspace-burn">
      <small className={`work-burn${burn > 100 ? " is-over" : ""}`}>{formatMinutes(item.loggedMinutes)} / {formatMinutes(item.budgetMinutes!)}</small>
      <small className="work-burn-percent">{burn}%</small>
    </span>
  );
}

function WorkRow({ canWrite, item, todayKey }: { canWrite: boolean; item: WorkQueueRow; todayKey: string }) {
  const due = effectiveDue(item);
  const chip = dueChip(dayDifference(due, todayKey));
  return (
    <div className="work-workspace-row">
      {canWrite && (
        <span className="work-row-select">
          <input aria-label={`Select ${item.client}, ${workServiceLabel(item.serviceKey)} ${item.periodKey}`} form="work-bulk-form" name="workItemId" type="checkbox" value={item.id} />
        </span>
      )}
      <Link className="work-row-main" href={`/work/${item.id}`}>
        <InitialsAvatar initials={item.clientInitials} tone="violet" />
        <span><strong>{item.client}</strong><small>{workServiceLabel(item.serviceKey)} · {item.periodKey}</small><em>{item.blockerNote || "No blocker recorded"}</em></span>
      </Link>
      <span className="work-workspace-progress">
        <ProgressBar label={`${item.client} progress`} value={item.progress} />
        <small>{item.progress}%</small>
        {item.missingItemCount > 0 && <small className="work-missing-chip">{item.missingItemCount} missing</small>}
      </span>
      <BurnCell item={item} />
      <span className="work-workspace-owner"><InitialsAvatar initials={item.ownerInitials} tone="light" /><strong>{item.owner}</strong></span>
      <span className="work-workspace-due">
        <strong>{formatDateKey(due)}</strong>
        <small className={`work-due-chip is-${chip.tone}`}>{chip.label}</small>
        {item.internalDueDate && item.internalDueDate !== item.statutoryDueDate && <small className="work-statutory-note">Statutory {formatDateKey(item.statutoryDueDate)}</small>}
      </span>
      <StatusBadge tone={statusTone(item.status)}>{item.status}</StatusBadge>
      <DashboardIcon name="arrow" size={17} />
    </div>
  );
}

function BoardCard({ item, todayKey }: { item: WorkQueueRow; todayKey: string }) {
  const chip = dueChip(dayDifference(effectiveDue(item), todayKey));
  return (
    <Link className="work-board-card" href={`/work/${item.id}`}>
      <span className="work-board-card-head">
        <InitialsAvatar initials={item.clientInitials} tone="violet" />
        <span><strong>{item.client}</strong><small>{workServiceLabel(item.serviceKey)} · {item.periodKey}</small></span>
      </span>
      <ProgressBar label={`${item.client} progress`} value={item.progress} />
      <span className="work-board-card-foot">
        <small className={`work-due-chip is-${chip.tone}`}>{chip.label}</small>
        <span className="work-board-owner"><InitialsAvatar initials={item.ownerInitials} tone="light" />{item.owner}</span>
      </span>
    </Link>
  );
}

function emptyDescription(scope: WorkScope) {
  if (scope === "mine") return "Nothing is assigned to you under these filters.";
  if (scope === "reviewing") return "Nothing is waiting on your review.";
  return "Clear the filters to include completed and upcoming obligations.";
}

export function WorkWorkspace({ canWrite, lanes, members, params, rows, todayKey, totals }: WorkQueueViewData) {
  const groups = URGENCY.map((group) => ({
    ...group,
    items: rows.filter((item) => group.test(dayDifference(effectiveDue(item), todayKey))),
  })).filter((group) => group.items.length > 0);

  const columns = BOARD_COLUMNS.map((status) => ({ items: rows.filter((item) => item.status === status), status }))
    .filter((column) => column.items.length > 0);

  return (
    <div className="work-workspace">
      <PageTitle
        actions={canWrite ? <WorkDialogButton><DashboardIcon name="plus" size={17} />Create work item</WorkDialogButton> : undefined}
        description="Manage active assignments, client dependencies, review queues, and statutory deadlines."
        eyebrow="DELIVERY WORKSPACE"
        title="My work"
      />

      <nav aria-label="Work scope" className="segment-control work-scope-tabs">
        {SCOPES.map((scope) => (
          <Link aria-current={params.scope === scope.key ? "page" : undefined} href={workQueueHref({ ...params, owner: null, scope: scope.key })} key={scope.key}>{scope.label}</Link>
        ))}
      </nav>

      <section className="kpi-grid">
        <KpiCard icon="work" label="ACTIVE WORK" note="Open obligations" tone="blue" value={String(totals.active).padStart(2, "0")} />
        <KpiCard icon="alert" label="OVERDUE" note="Past the managed date" tone="red" value={String(totals.overdue).padStart(2, "0")} />
        <KpiCard icon="waiting" label="WAITING" note="Client dependencies" tone="amber" value={String(totals.waiting).padStart(2, "0")} />
        <KpiCard icon="review" label="REVIEW" note="Ready for reviewer" tone="mint" value={String(totals.review).padStart(2, "0")} />
      </section>

      <nav aria-label="Preset views" className="work-presets">
        <span>Presets</span>
        {WORK_QUEUE_PRESETS.map((preset) => <Link href={workQueueHref(preset.params)} key={preset.key}>{preset.label}</Link>)}
      </nav>

      <section className="work-workspace-panel surface-card">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">ASSIGNMENT REGISTER</p>
            <h2>Active delivery</h2>
            <span>{rows.length} matching {rows.length === 1 ? "item" : "items"}{totals.overdue > 0 ? ` · ${totals.overdue} overdue in this scope` : ""}</span>
          </div>
        </div>

        <form action="/" className="workspace-toolbar" method="get">
          <input name="workspace" type="hidden" value="work" />
          <input name="scope" type="hidden" value={params.scope} />
          <input name="view" type="hidden" value={params.view} />
          <input name="sort" type="hidden" value={params.sort} />
          <div className="segment-control work-workspace-filters" aria-label="Filter active work">
            {FILTERS.map((item) => (
              <Link aria-current={params.filter === item ? "page" : undefined} href={workQueueHref({ ...params, filter: item })} key={item}>{item}</Link>
            ))}
          </div>
          <label className="client-search">
            <DashboardIcon name="search" size={17} />
            <input aria-label="Filter this list by client, service, or owner" defaultValue={params.q} name="q" placeholder="Filter this list..." type="search" />
          </label>
        </form>

        <div className="workspace-toolbar work-view-toolbar">
          <div className="segment-control" aria-label="Choose a view">
            {VIEWS.map((view) => (
              <Link aria-current={params.view === view.key ? "page" : undefined} href={workQueueHref({ ...params, view: view.key })} key={view.key}>{view.label}</Link>
            ))}
          </div>
          {params.view !== "capacity" && (
            <div className="segment-control work-sort" aria-label="Sort by">
              {SORTS.map((option) => (
                <Link aria-current={params.sort === option.key ? "page" : undefined} href={workQueueHref({ ...params, sort: option.key })} key={option.key}>{option.label}</Link>
              ))}
            </div>
          )}
        </div>

        {params.view === "capacity" && <WorkCapacityView lanes={lanes} params={params} />}

        {params.view !== "capacity" && !rows.length && (
          <EmptyState
            action={params.scope !== "firm" ? <Link className="secondary-button" href={workQueueHref({ ...params, scope: "firm" })}>View the whole firm&apos;s queue</Link> : undefined}
            description={emptyDescription(params.scope)}
            icon="work"
            title="No active work here"
          />
        )}

        {params.view !== "capacity" && Boolean(rows.length) && canWrite && <WorkBulkBar members={members} />}

        {params.view === "list" && Boolean(rows.length) && (
          <div className="work-workspace-list">
            {groups.map((group) => (
              <section aria-label={group.label} className="work-urgency-group" key={group.key}>
                <header className={`work-urgency-heading is-${group.key}`}>
                  <strong>{group.label}</strong>
                  <em>{group.items.length}</em>
                  <small>{group.note}</small>
                </header>
                {group.items.map((item) => <WorkRow canWrite={canWrite} item={item} key={item.id} todayKey={todayKey} />)}
              </section>
            ))}
          </div>
        )}

        {params.view === "board" && Boolean(rows.length) && (
          <div className="work-board">
            {columns.map((column) => (
              <section aria-label={column.status} className="work-board-column" key={column.status}>
                <header className="work-board-heading">
                  <StatusBadge tone={statusTone(column.status)}>{column.status}</StatusBadge>
                  <em>{column.items.length}</em>
                </header>
                <div className="work-board-cards">
                  {column.items.map((item) => <BoardCard item={item} key={item.id} todayKey={todayKey} />)}
                </div>
              </section>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
