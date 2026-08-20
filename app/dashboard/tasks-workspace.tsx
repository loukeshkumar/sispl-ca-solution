import Link from "next/link";
import type { CSSProperties } from "react";

import { burnPercentage } from "../../lib/scheduling/capacity";
import type { TaskCapacityLane, TaskQueueRow, TaskQueueTotals } from "../../lib/tasks/queue";
import {
  availableTaskScopes,
  taskQueueHref,
  TASK_QUEUE_PRESETS,
  type TaskQueueParams,
  type TaskSort,
} from "../../lib/tasks/queue-params";
import { taskStatusLabel } from "../../lib/tasks/validation";
import { DashboardIcon } from "./dashboard-icons";
import { EmptyState, InitialsAvatar, KpiCard, PageTitle, StatusBadge } from "./dashboard-ui";
import { TaskBulkBar } from "./task-bulk-bar";
import { TaskDialogButton } from "./task-dialog";

export type TaskMemberOption = { fullName: string; id: string };

export type TaskQueueViewData = {
  canAssign: boolean;
  canManageAll: boolean;
  lanes: TaskCapacityLane[];
  members: TaskMemberOption[];
  params: TaskQueueParams;
  rows: TaskQueueRow[];
  todayKey: string;
  totals: TaskQueueTotals;
};

const STATUSES: TaskQueueParams["status"][] = ["Active", "Waiting", "Review", "Completed", "Cancelled"];
const PRIORITIES: Array<{ key: TaskQueueParams["priority"]; label: string }> = [
  { key: "all", label: "All priorities" },
  { key: "urgent", label: "Urgent" },
  { key: "high", label: "High" },
  { key: "normal", label: "Normal" },
  { key: "low", label: "Low" },
];
const SORTS: Array<{ key: TaskSort; label: string }> = [
  { key: "due", label: "Deadline" },
  { key: "priority", label: "Priority" },
  { key: "assignee", label: "Assignee" },
];
const VIEWS: Array<{ key: TaskQueueParams["view"]; label: string }> = [
  { key: "list", label: "Deadline list" },
  { key: "board", label: "Status board" },
  { key: "capacity", label: "Capacity" },
];
const BOARD_COLUMNS = ["todo", "in_progress", "waiting", "review"];

const statusTone = (status: string) => ({ todo: "blue", in_progress: "blue", waiting: "amber", review: "mint", completed: "mint", cancelled: "red" })[status] ?? "blue";
const priorityTone = (priority: string) => ({ urgent: "red", high: "amber", normal: "blue", low: "neutral" })[priority] ?? "blue";

const dayDifference = (dateKey: string, todayKey: string) => (
  (Date.parse(`${dateKey}T00:00:00Z`) - Date.parse(`${todayKey}T00:00:00Z`)) / 86_400_000
);

/** The same partition the work queue uses: a gap hides a task, an overlap doubles it. */
const URGENCY = [
  { key: "overdue", label: "Overdue", note: "Past the due date", test: (days: number) => days < 0 },
  { key: "today", label: "Due today", note: "Close these first", test: (days: number) => days === 0 },
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

const formatMinutes = (minutes: number) => (minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h${minutes % 60 ? ` ${minutes % 60}m` : ""}`);
const formatDate = (value: string) => new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));

function BurnCell({ task }: { task: TaskQueueRow }) {
  const burn = burnPercentage(task.loggedMinutes, task.estimateMinutes);
  if (burn === null) return <span className="work-workspace-burn"><small className="work-burn-none">No estimate</small></span>;
  return (
    <span className="work-workspace-burn">
      <small className={`work-burn${burn > 100 ? " is-over" : ""}`}>{formatMinutes(task.loggedMinutes)} / {formatMinutes(task.estimateMinutes!)}</small>
      <small className="work-burn-percent">{burn}%</small>
    </span>
  );
}

function TaskRow({ canAssign, task, todayKey }: { canAssign: boolean; task: TaskQueueRow; todayKey: string }) {
  const chip = dueChip(dayDifference(task.dueDate, todayKey));
  return (
    <div className="task-register-row">
      {canAssign && (
        <span className="work-row-select">
          <input aria-label={`Select ${task.title}`} form="task-bulk-form" name="taskId" type="checkbox" value={task.id} />
        </span>
      )}
      <Link className="task-row-main" href={`/tasks/${task.id}`}>
        <span>
          <strong>{task.title}</strong>
          <small>{task.clientName ?? "General office task"}{task.workLabel ? ` · ${task.workLabel}` : ""}</small>
          {task.blockerNote && <em className="task-row-blocker">{task.blockerNote}</em>}
        </span>
      </Link>
      <span className="task-assignee">
        <InitialsAvatar initials={task.assigneeInitials} tone="light" />
        <span>
          <strong>{task.assigneeName}</strong>
          <small>by {task.assignedByName}{task.reviewerName ? ` · review ${task.reviewerName}` : ""}</small>
        </span>
      </span>
      <StatusBadge tone={priorityTone(task.priority)}>{task.priority}</StatusBadge>
      <BurnCell task={task} />
      <StatusBadge tone={statusTone(task.status)}>{taskStatusLabel(task.status)}</StatusBadge>
      <span className="task-due">
        <strong>{formatDate(task.dueDate)}</strong>
        <small className={`work-due-chip is-${chip.tone}`}>{chip.label}</small>
      </span>
      <DashboardIcon name="arrow" size={17} />
    </div>
  );
}

/** Narrow screens hide the register grid entirely, so this is the only task
 *  list below 720px — not a decorative extra. */
function TaskCard({ task, todayKey }: { task: TaskQueueRow; todayKey: string }) {
  const chip = dueChip(dayDifference(task.dueDate, todayKey));
  const burn = burnPercentage(task.loggedMinutes, task.estimateMinutes);
  return (
    <Link className="task-mobile-card" href={`/tasks/${task.id}`}>
      <span className="task-mobile-card-top">
        <StatusBadge tone={statusTone(task.status)}>{taskStatusLabel(task.status)}</StatusBadge>
        <StatusBadge tone={priorityTone(task.priority)}>{task.priority}</StatusBadge>
        <strong className={`work-due-chip is-${chip.tone}`}>{chip.label}</strong>
      </span>
      <h3>{task.title}</h3>
      <p>{task.clientName ?? "General office task"}{task.workLabel ? ` · ${task.workLabel}` : ""}</p>
      <span className="task-mobile-owner">
        <InitialsAvatar initials={task.assigneeInitials} tone="light" />
        <span><small>ASSIGNEE</small><strong>{task.assigneeName}</strong></span>
        {burn !== null && <small className={`work-burn${burn > 100 ? " is-over" : ""}`}>{burn}%</small>}
      </span>
    </Link>
  );
}

function TaskCapacity({ lanes, params }: { lanes: TaskCapacityLane[]; params: TaskQueueParams }) {
  if (!lanes.length) return <EmptyState description="Capacity needs employees with an attendance work profile." icon="team" title="No capacity to show" />;
  const weeks = lanes[0]!.weeks.map((week) => week.weekStart);
  const label = (weekStart: string) => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${weekStart}T00:00:00Z`));
  return (
    <div className="work-capacity-scroll">
      <div className="work-capacity">
        <div className="work-capacity-head"><span>Team member</span>{weeks.map((week) => <span key={week}>w/c {label(week)}</span>)}</div>
        {lanes.map((lane) => (
          <div className="work-capacity-lane" key={lane.memberId}>
            <span className="work-capacity-name">{lane.memberName}</span>
            {lane.weeks.map((cell) => {
              const percentage = cell.availableMinutes > 0 ? Math.round((cell.loadMinutes / cell.availableMinutes) * 100) : 0;
              return (
                <Link
                  aria-label={`${lane.memberName}, week starting ${cell.weekStart}: ${percentage}% committed${cell.unestimatedCount ? `, ${cell.unestimatedCount} unestimated` : ""}`}
                  className={`work-capacity-cell${percentage > 100 ? " is-over" : percentage >= 80 ? " is-tight" : ""}`}
                  href={taskQueueHref({ ...params, owner: lane.memberId, scope: "firm", view: "list" })}
                  key={cell.weekStart}
                >
                  <span className="work-capacity-bar" style={{ "--fill": `${Math.min(percentage, 100)}%` } as CSSProperties} />
                  <strong>{percentage}%</strong>
                  {/* An unestimated task adds no minutes, so say so rather than
                      letting an empty-looking lane read as free. */}
                  {cell.unestimatedCount > 0 && <em>+{cell.unestimatedCount} unestimated</em>}
                </Link>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

export function TasksWorkspace({ canAssign, canManageAll, lanes, members, params, rows, todayKey, totals }: TaskQueueViewData) {
  const scopes = availableTaskScopes(canManageAll);
  const groups = URGENCY.map((group) => ({
    ...group,
    items: rows.filter((task) => group.test(dayDifference(task.dueDate, todayKey))),
  })).filter((group) => group.items.length > 0);
  const columns = BOARD_COLUMNS
    .map((status) => ({ items: rows.filter((task) => task.status === status), status }))
    .filter((column) => column.items.length > 0);

  return (
    <div className="tasks-workspace">
      <PageTitle
        actions={canAssign ? <TaskDialogButton><DashboardIcon name="plus" size={17} />Assign task</TaskDialogButton> : undefined}
        description="Run office assignments with visible ownership, deadlines, handoffs, and review controls."
        eyebrow="OFFICE DELIVERY"
        title="Tasks"
      />

      {scopes.length > 1 && (
        <nav aria-label="Task scope" className="segment-control work-scope-tabs">
          {scopes.map((scope) => (
            <Link aria-current={params.scope === scope.key ? "page" : undefined} href={taskQueueHref({ ...params, owner: null, scope: scope.key })} key={scope.key}>{scope.label}</Link>
          ))}
        </nav>
      )}

      <section aria-label="Task delivery metrics" className="kpi-grid">
        <KpiCard icon="clock" label="DUE TODAY" note="Active assignments" tone="blue" value={String(totals.dueToday).padStart(2, "0")} />
        <KpiCard icon="alert" label="OVERDUE" note="Past due and still active" tone="red" value={String(totals.overdue).padStart(2, "0")} />
        <KpiCard icon="waiting" label="WAITING" note="Blocked or dependent" tone="amber" value={String(totals.waiting).padStart(2, "0")} />
        <KpiCard icon="review" label="IN REVIEW" note="Ready for checking" tone="mint" value={String(totals.review).padStart(2, "0")} />
      </section>

      {canManageAll && (
        <nav aria-label="Preset views" className="work-presets">
          <span>Presets</span>
          {TASK_QUEUE_PRESETS.map((preset) => <Link href={taskQueueHref(preset.params)} key={preset.key}>{preset.label}</Link>)}
        </nav>
      )}

      <section className="surface-card task-register-panel">
        <div className="panel-heading task-register-heading">
          <div>
            <p className="eyebrow">TASK REGISTER</p>
            <h2>Assignments</h2>
            <span>{rows.length} matching {rows.length === 1 ? "task" : "tasks"}{totals.overdue > 0 ? ` · ${totals.overdue} overdue in this scope` : ""}</span>
          </div>
          <form action="/" className="client-search" method="get">
            <input name="workspace" type="hidden" value="tasks" />
            <input name="scope" type="hidden" value={params.scope} />
            <input name="status" type="hidden" value={params.status} />
            <input name="view" type="hidden" value={params.view} />
            <DashboardIcon name="search" size={17} />
            <input aria-label="Search tasks" defaultValue={params.q} name="q" placeholder="Search task, employee or client..." type="search" />
          </form>
        </div>

        <div className="task-filter-bar">
          <div aria-label="Task status" className="segment-control">
            {STATUSES.map((item) => (
              <Link aria-current={params.status === item ? "page" : undefined} href={taskQueueHref({ ...params, status: item })} key={item}>{item}</Link>
            ))}
          </div>
          <div className="task-filter-secondary">
            <div aria-label="Task priority" className="segment-control">
              {PRIORITIES.map((item) => (
                <Link aria-current={params.priority === item.key ? "page" : undefined} href={taskQueueHref({ ...params, priority: item.key })} key={item.key}>{item.label}</Link>
              ))}
            </div>
          </div>
        </div>

        <div className="workspace-toolbar work-view-toolbar">
          <div aria-label="Choose a view" className="segment-control">
            {VIEWS.map((view) => (
              <Link aria-current={params.view === view.key ? "page" : undefined} href={taskQueueHref({ ...params, view: view.key })} key={view.key}>{view.label}</Link>
            ))}
          </div>
          {params.view !== "capacity" && (
            <div aria-label="Sort by" className="segment-control work-sort">
              {SORTS.map((option) => (
                <Link aria-current={params.sort === option.key ? "page" : undefined} href={taskQueueHref({ ...params, sort: option.key })} key={option.key}>{option.label}</Link>
              ))}
            </div>
          )}
        </div>

        {params.view === "capacity" && <TaskCapacity lanes={lanes} params={params} />}

        {params.view !== "capacity" && !rows.length && (
          <EmptyState
            action={canManageAll && params.scope !== "firm" ? <Link className="secondary-button" href={taskQueueHref({ ...params, scope: "firm" })}>View the whole firm&apos;s tasks</Link> : undefined}
            description={params.scope === "mine" ? "Nothing is assigned to you under these filters." : params.scope === "reviewing" ? "Nothing is waiting on your review." : "Change the status or priority filter to see more assignments."}
            icon="work"
            title="No tasks match this view"
          />
        )}

        {params.view !== "capacity" && Boolean(rows.length) && canAssign && <TaskBulkBar members={members} />}

        {params.view === "list" && Boolean(rows.length) && (
          <div className="task-register-list">
            {groups.map((group) => (
              <section aria-label={group.label} className="work-urgency-group" key={group.key}>
                <header className={`work-urgency-heading is-${group.key}`}>
                  <strong>{group.label}</strong>
                  <em>{group.items.length}</em>
                  <small>{group.note}</small>
                </header>
                {group.items.map((task) => <TaskRow canAssign={canAssign} key={task.id} task={task} todayKey={todayKey} />)}
              </section>
            ))}
          </div>
        )}

        {params.view !== "capacity" && (
          <div className="task-mobile-list">
            {rows.map((task) => <TaskCard key={task.id} task={task} todayKey={todayKey} />)}
            {!rows.length && <EmptyState description="Change the status or priority filter to see more assignments." icon="work" title="No tasks match this view" />}
          </div>
        )}

        {params.view === "board" && Boolean(rows.length) && (
          <div className="work-board">
            {columns.map((column) => (
              <section aria-label={taskStatusLabel(column.status)} className="work-board-column" key={column.status}>
                <header className="work-board-heading">
                  <StatusBadge tone={statusTone(column.status)}>{taskStatusLabel(column.status)}</StatusBadge>
                  <em>{column.items.length}</em>
                </header>
                <div className="work-board-cards">
                  {column.items.map((task) => (
                    <Link className="work-board-card" href={`/tasks/${task.id}`} key={task.id}>
                      <span className="work-board-card-head">
                        <InitialsAvatar initials={task.assigneeInitials} tone="light" />
                        <span><strong>{task.title}</strong><small>{task.clientName ?? "General office task"}</small></span>
                      </span>
                      <span className="work-board-card-foot">
                        <StatusBadge tone={priorityTone(task.priority)}>{task.priority}</StatusBadge>
                        <small className={`work-due-chip is-${dueChip(dayDifference(task.dueDate, todayKey)).tone}`}>{dueChip(dayDifference(task.dueDate, todayKey)).label}</small>
                      </span>
                    </Link>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
