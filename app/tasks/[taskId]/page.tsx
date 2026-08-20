import Link from "next/link";
import { notFound } from "next/navigation";

import { hasPermission } from "../../../lib/auth/authorization";
import { requirePermission } from "../../../lib/auth/server";
import { getDatabase } from "../../../lib/dashboard/postgres/pool";
import { getTask360 } from "../../../lib/tasks/repository";
import { taskStatusLabel } from "../../../lib/tasks/validation";
import { StatusBadge } from "../../dashboard/dashboard-ui";
import { TaskDialogButton } from "../../dashboard/task-dialog";
import { ManagerTaskActions, OwnTaskUpdate } from "./task-actions";

export const dynamic = "force-dynamic";
const formatDate = (value: string) => new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
const activeStatuses = ["todo", "in_progress", "waiting", "review"];
const statusTone = (status: string) => ({ todo: "blue", in_progress: "blue", waiting: "amber", review: "mint", completed: "mint", cancelled: "red" })[status] ?? "blue";

export default async function Task360Page({ params, searchParams }: { params: Promise<{ taskId: string }>; searchParams: Promise<{ actionError?: string }> }) {
  const { taskId } = await params;
  const session = await requirePermission("tasks:read", `/tasks/${taskId}`);
  const task = await getTask360(getDatabase(), session.tenantId, session.userId, session.roleKey, taskId);
  if (!task) notFound();
  const canAssign = hasPermission(session, "tasks:assign");
  const isAssignee = task.assigneeId === session.userId;
  const active = activeStatuses.includes(task.status);
  const actionError = (await searchParams).actionError;

  return (
    <main className="task-360-shell">
      <header className="client-360-header"><Link href="/?workspace=tasks">&larr; Back to Tasks</Link><div className="client-360-title-row"><div><p className="eyebrow">TASK 360</p><h1>{task.title}</h1><span className="task-context-line">{task.clientName ?? "General office task"}{task.workLabel ? ` · ${task.workLabel}` : ""}</span></div>{canAssign && <div className="client-360-actions">{active && <TaskDialogButton initial={task} taskId={task.id} title={`Edit ${task.title}`} variant="secondary">Edit task</TaskDialogButton>}<ManagerTaskActions active={active} taskId={task.id} /></div>}</div></header>
      {actionError && <p className="client-form-banner" role="alert">The task changed before this action completed. Refresh and try again.</p>}
      <section className="task-360-grid">
        <article className="surface-card task-360-main">
          <div className="task-360-heading"><div><StatusBadge tone={statusTone(task.status)}>{taskStatusLabel(task.status)}</StatusBadge><StatusBadge tone={task.priority === "urgent" ? "red" : task.priority === "high" ? "amber" : "blue"}>{task.priority} priority</StatusBadge></div><strong>Due {formatDate(task.dueDate)}</strong></div>
          <section className="task-description"><p className="eyebrow">EXPECTED OUTCOME</p><p>{task.description || "No additional task instructions were recorded."}</p></section>
          <div className="client-360-detail-grid task-detail-grid"><div><span>Assignee</span><strong>{task.assigneeName}</strong></div><div><span>Reviewer</span><strong>{task.reviewerName ?? "Not assigned"}</strong></div><div><span>Assigned by</span><strong>{task.assignedByName}</strong></div><div><span>Due date</span><strong>{formatDate(task.dueDate)}</strong></div><div><span>Client</span><strong>{task.clientName ?? "General office"}</strong></div><div><span>Compliance work</span><strong>{task.workLabel ?? "Not linked"}</strong></div></div>
          {task.blockerNote && <section className="task-blocker"><p className="eyebrow">BLOCKER / HANDOFF</p><p>{task.blockerNote}</p></section>}
        </article>
        <aside className="surface-card task-control-card"><p className="eyebrow">TASK CONTROL</p><h2>{isAssignee ? "Your assignment" : "Assignment controls"}</h2><p>{isAssignee ? "Keep the status current so the team can see progress and dependencies." : "The assignee owns day-to-day status. Managers control assignment and closure."}</p>{isAssignee && active ? <OwnTaskUpdate blockerNote={task.blockerNote} status={task.status} taskId={task.id} /> : <dl><div><dt>Status</dt><dd>{taskStatusLabel(task.status)}</dd></div><div><dt>Completed</dt><dd>{task.completedAt ? new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" }).format(new Date(task.completedAt)) : "Not complete"}</dd></div></dl>}</aside>
      </section>
    </main>
  );
}
