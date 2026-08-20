"use client";

import Link from "next/link";
import { useActionState, useState, type CSSProperties } from "react";
import { Archive, CalendarClock, Check, CircleDot, Pencil, Repeat, RotateCcw, Search } from "lucide-react";

import { archiveTodoAction, completeTodoAction, createTodoAction, reopenTodoAction, saveTodoAction } from "../todos/actions";
import type { LoadStripDay } from "../../lib/todos/recurrence";
import type { TodoRow, TodoWorkspaceData } from "../../lib/todos/repository";
import { todoQueueHref, todoUrgencyKey, todoViews, TODO_URGENCY, type TodoQueueParams } from "../../lib/todos/queue-params";
import { todoPriorityLabel, type TodoActionState, type TodoPriority } from "../../lib/todos/validation";
import { TodoBulkBar } from "./todo-bulk-bar";
import { KpiCard, PageTitle } from "./dashboard-ui";
import { dialogRecord, FormDialog, FormDialogActions, FormDialogBody, useCloseOnSuccess, type DialogState } from "./form-dialog";
import { useToast } from "./toast";

const priorities: Array<"all" | TodoPriority> = ["all", "urgent", "high", "normal", "low"];
const repeatLabel = (rule: string | null, interval: number | null) => {
  if (!rule || !interval) return null;
  const unit = interval === 1 ? rule : `${interval} ${rule}s`;
  return `Every ${unit}`;
};
const initialState: TodoActionState = { error: "", fieldErrors: {} };

const dateLabel = (date: string | null) => date
  ? new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" }).format(new Date(`${date}T12:00:00`))
  : "No due date";

function QuickAdd() {
  const [state, action, pending] = useActionState(createTodoAction, initialState);
  return (
    <form action={action} className="todo-quick-add surface-card">
      <div className="todo-quick-heading"><span className="todo-icon-tile"><CircleDot aria-hidden="true" size={20} /></span><div><strong>Quick add</strong><span>Capture it now, refine it later.</span></div></div>
      <label className="sr-only" htmlFor="quick-todo-title">To-do title</label>
      <input aria-describedby={state.fieldErrors.title ? "quick-todo-title-error" : undefined} aria-invalid={Boolean(state.fieldErrors.title)} id="quick-todo-title" maxLength={160} name="title" placeholder="What do you need to remember?" required />
      <label className="sr-only" htmlFor="quick-todo-date">Due date</label>
      <input aria-label="Due date" id="quick-todo-date" name="dueDate" type="date" />
      <label className="sr-only" htmlFor="quick-todo-priority">Priority</label>
      <select aria-label="Priority" defaultValue="normal" id="quick-todo-priority" name="priority"><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></select>
      <input name="notes" type="hidden" value="" /><input name="dueTime" type="hidden" value="" /><input name="category" type="hidden" value="" />
      <button className="primary-button" disabled={pending} type="submit">{pending ? "Adding..." : "Add to-do"}</button>
      {(state.error || state.fieldErrors.title) && <p className="todo-quick-error" id="quick-todo-title-error" role="alert">{state.fieldErrors.title ?? state.error}</p>}
    </form>
  );
}

function TodoActions({ onEdit, todo }: { onEdit: (todo: TodoRow) => void; todo: TodoRow }) {
  return (
    <div className="todo-row-actions">
      {todo.status !== "archived" && <button aria-label={`Edit ${todo.title}`} className="todo-icon-button" onClick={() => onEdit(todo)} title="Edit" type="button"><Pencil aria-hidden="true" size={17} /></button>}
      {todo.status === "open" && <form action={completeTodoAction}><input name="todoId" type="hidden" value={todo.id} /><input name="returnTo" type="hidden" value="/?workspace=todos" /><button aria-label={`Complete ${todo.title}`} className="todo-icon-button is-complete" title="Mark complete" type="submit"><Check aria-hidden="true" size={18} /></button></form>}
      {todo.status === "completed" && <form action={reopenTodoAction}><input name="todoId" type="hidden" value={todo.id} /><input name="returnTo" type="hidden" value="/?workspace=todos" /><button aria-label={`Reopen ${todo.title}`} className="todo-icon-button" title="Reopen" type="submit"><RotateCcw aria-hidden="true" size={17} /></button></form>}
      {todo.status !== "archived" && <form action={archiveTodoAction}><input name="todoId" type="hidden" value={todo.id} /><input name="returnTo" type="hidden" value="/?workspace=todos" /><button aria-label={`Archive ${todo.title}`} className="todo-icon-button" title="Archive" type="submit"><Archive aria-hidden="true" size={17} /></button></form>}
    </div>
  );
}

function TodoListItem({ onEdit, todayKey, todo }: { onEdit: (todo: TodoRow) => void; todayKey: string; todo: TodoRow }) {
  const timing = todo.dueDate && todo.dueDate < todayKey && todo.status === "open" ? "Overdue" : todo.dueDate === todayKey && todo.status === "open" ? "Due today" : dateLabel(todo.dueDate);
  const repeat = repeatLabel(todo.recurrenceRule, todo.recurrenceInterval);
  return (
    <article className={`todo-row todo-mobile-card is-${todo.status}`}>
      <span aria-hidden="true" className={`todo-priority-marker is-${todo.priority}`} />
      <span className="todo-row-select">
        <input aria-label={`Select ${todo.title}`} form="todo-bulk-form" name="todoId" type="checkbox" value={todo.id} />
      </span>
      <div className="todo-row-copy">
        <div className="todo-row-title"><strong>{todo.title}</strong><span className={`todo-priority is-${todo.priority}`}>{todoPriorityLabel(todo.priority)}</span>{todo.category && <span className="todo-category">{todo.category}</span>}{repeat && <span className="todo-repeat"><Repeat aria-hidden="true" size={12} />{repeat}</span>}</div>
        {todo.notes && <p>{todo.notes}</p>}
      </div>
      <div className={`todo-due ${timing === "Overdue" ? "is-overdue" : timing === "Due today" ? "is-today" : ""}`}><CalendarClock aria-hidden="true" size={17} /><span><strong>{timing}</strong>{todo.dueTime && <small>{todo.dueTime}</small>}</span></div>
      <TodoActions onEdit={onEdit} todo={todo} />
    </article>
  );
}

export type TodoQueueViewData = {
  loadStrip: LoadStripDay[];
  params: TodoQueueParams;
  todos: TodoRow[];
  workspace: TodoWorkspaceData;
};

export function TodosWorkspace({ loadStrip, params, todos, workspace }: TodoQueueViewData) {
  const [dialog, setDialog] = useState<DialogState<TodoRow>>(null);
  const [saveState, saveAction, savePending] = useActionState(saveTodoAction, initialState);
  const toast = useToast();
  useCloseOnSuccess(savePending, saveState, () => { toast.success(dialogRecord(dialog) ? "To-do updated." : "To-do added."); setDialog(null); });
  const record = dialogRecord(dialog);
  const visible = todos;
  // Grouped so an undated to-do lands in its own bucket instead of sorting to
  // the bottom under a synthetic far-future date and dropping out of view.
  const groups = TODO_URGENCY
    .map((group) => ({ ...group, items: visible.filter((todo) => todoUrgencyKey(todo.dueDate, workspace.todayKey) === group.key) }))
    .filter((group) => group.items.length > 0);
  const peak = Math.max(1, ...loadStrip.map((day) => day.count));

  return (
    <div className="todos-workspace">
      <PageTitle actions={<button className="primary-button" onClick={() => setDialog("add")} type="button">Add detailed to-do</button>} description="Your private place for follow-ups, small commitments, and personal deadlines." eyebrow="PERSONAL PRODUCTIVITY" title="To-do" />
      <section aria-label="Personal to-do metrics" className="todo-kpi-grid kpi-grid">
        <KpiCard icon="work" label="OPEN" note="Active personal reminders" sparkValues={[workspace.metrics.open, workspace.metrics.dueToday, workspace.metrics.upcoming]} tone="blue" value={String(workspace.metrics.open).padStart(2, "0")} />
        <KpiCard icon="alert" label="OVERDUE" note="Needs your attention" sparkValues={[workspace.metrics.overdue, workspace.metrics.open]} tone="red" value={String(workspace.metrics.overdue).padStart(2, "0")} />
        <KpiCard icon="clock" label="TODAY" note="Due before day end" sparkValues={[workspace.metrics.dueToday, workspace.metrics.open]} tone="amber" value={String(workspace.metrics.dueToday).padStart(2, "0")} />
        <KpiCard icon="review" label="UPCOMING" note="Scheduled ahead" sparkValues={[workspace.metrics.upcoming, workspace.metrics.open]} tone="mint" value={String(workspace.metrics.upcoming).padStart(2, "0")} />
        <KpiCard icon="review" label="COMPLETED" note="Ready to archive" sparkValues={[workspace.metrics.completed, workspace.metrics.open]} tone="mint" value={String(workspace.metrics.completed).padStart(2, "0")} />
      </section>
      <QuickAdd />
      <section className="todo-register surface-card">
        <div className="todo-register-header">
          <div><p className="eyebrow">PRIVATE REGISTER</p><h2>Your reminders</h2><span>{visible.length} matching {visible.length === 1 ? "item" : "items"}</span></div>
          <form action="/" className="todo-search" method="get">
            <input name="workspace" type="hidden" value="todos" />
            <input name="view" type="hidden" value={params.view} />
            <input name="priority" type="hidden" value={params.priority} />
            <input name="category" type="hidden" value={params.category} />
            <Search aria-hidden="true" size={18} />
            <input aria-label="Search personal to-dos" defaultValue={params.q} name="q" placeholder="Search title, notes, or category..." type="search" />
          </form>
        </div>

        <nav aria-label="Choose to-do view" className="segment-control todo-view-tabs">
          {todoViews.map((item) => (
            <Link aria-current={params.view === item ? "page" : undefined} href={todoQueueHref({ ...params, view: item })} key={item}>{item}</Link>
          ))}
        </nav>

        <div className="todo-filter-row">
          <div aria-label="Priority" className="segment-control">
            {priorities.map((item) => (
              <Link aria-current={params.priority === item ? "page" : undefined} href={todoQueueHref({ ...params, priority: item })} key={item}>{item === "all" ? "All priorities" : todoPriorityLabel(item)}</Link>
            ))}
          </div>
          {Boolean(workspace.categories.length) && (
            <div aria-label="Category" className="segment-control todo-category-filter">
              <Link aria-current={params.category === "all" ? "page" : undefined} href={todoQueueHref({ ...params, category: "all" })}>All categories</Link>
              {workspace.categories.map((item) => (
                <Link aria-current={params.category === item ? "page" : undefined} href={todoQueueHref({ ...params, category: item })} key={item}>{item}</Link>
              ))}
            </div>
          )}
          <div aria-label="Layout" className="segment-control">
            <Link aria-current={params.layout === "list" ? "page" : undefined} href={todoQueueHref({ ...params, layout: "list" })}>List</Link>
            <Link aria-current={params.layout === "load" ? "page" : undefined} href={todoQueueHref({ ...params, layout: "load" })}>Next 4 weeks</Link>
          </div>
        </div>

        {params.layout === "load" && (
          <div className="todo-load-strip">
            {/* Only this owner's own open to-dos. No other person's data is read. */}
            {loadStrip.map((day) => (
              <span
                className={`todo-load-day${day.count ? " has-items" : ""}`}
                key={day.dateKey}
                style={{ "--intensity": `${Math.round((day.count / peak) * 100)}%` } as CSSProperties}
                title={`${day.dateKey}: ${day.count} ${day.count === 1 ? "to-do" : "to-dos"}`}
              >
                <em>{day.dateKey.slice(8)}</em>
                <strong>{day.count || ""}</strong>
              </span>
            ))}
          </div>
        )}

        {params.layout === "list" && Boolean(visible.length) && <TodoBulkBar categories={workspace.categories} />}

        {params.layout === "list" && (
          <div className="todo-list">
            {groups.map((group) => (
              <section aria-label={group.label} className="work-urgency-group" key={group.key}>
                <header className={`work-urgency-heading is-${group.key}`}>
                  <strong>{group.label}</strong>
                  <em>{group.items.length}</em>
                  <small>{group.note}</small>
                </header>
                {group.items.map((todo) => <TodoListItem key={todo.id} onEdit={setDialog} todayKey={workspace.todayKey} todo={todo} />)}
              </section>
            ))}
            {!visible.length && <div className="todo-empty-state"><span className="todo-icon-tile"><Check aria-hidden="true" size={21} /></span><strong>Nothing here right now</strong><p>Change the filters or add a personal to-do when something needs your attention.</p></div>}
          </div>
        )}
      </section>

      <FormDialog
        description="Personal to-dos are private to you and never shown to anyone else in the firm."
        onClose={() => setDialog(null)}
        open={dialog !== null}
        title={record ? `Edit ${record.title}` : "Add a to-do"}
      >
        <form action={saveAction} className="form-dialog-form" key={record?.id ?? "new-todo"}>
          <FormDialogBody>
            {saveState.error && <p className="package-form-banner" role="alert">{saveState.error}</p>}
            {record && <input name="todoId" type="hidden" value={record.id} />}
            <label className="form-dialog-wide"><span>Title</span>
              <input defaultValue={record?.title ?? ""} maxLength={160} name="title" placeholder="What do you need to remember?" required type="text" />
              {saveState.fieldErrors.title && <em className="package-field-error">{saveState.fieldErrors.title}</em>}
            </label>
            <label><span>Due date</span>
              <input defaultValue={record?.dueDate ?? ""} name="dueDate" type="date" />
              {saveState.fieldErrors.dueDate && <em className="package-field-error">{saveState.fieldErrors.dueDate}</em>}
            </label>
            <label><span>Due time</span>
              <input defaultValue={record?.dueTime ?? ""} name="dueTime" type="time" />
              {saveState.fieldErrors.dueTime && <em className="package-field-error">{saveState.fieldErrors.dueTime}</em>}
            </label>
            <label><span>Priority</span>
              <select defaultValue={record?.priority ?? "normal"} name="priority">
                <option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option>
              </select>
            </label>
            <label><span>Category</span>
              <input defaultValue={record?.category ?? ""} list="todo-categories" maxLength={40} name="category" placeholder="Optional" type="text" />
              <datalist id="todo-categories">{workspace.categories.map((item) => <option key={item} value={item} />)}</datalist>
              {saveState.fieldErrors.category && <em className="package-field-error">{saveState.fieldErrors.category}</em>}
            </label>
            <label><span>Repeat</span>
              <select defaultValue={record?.recurrenceRule ?? ""} name="recurrenceRule">
                <option value="">Does not repeat</option>
                <option value="day">Every day</option>
                <option value="week">Every week</option>
                <option value="month">Every month</option>
              </select>
              {saveState.fieldErrors.recurrenceRule && <em className="package-field-error">{saveState.fieldErrors.recurrenceRule}</em>}
            </label>
            <label><span>Repeat every</span>
              <input defaultValue={record?.recurrenceInterval ?? 1} max={365} min={1} name="recurrenceInterval" type="number" />
              <small className="field-hint">Completing a repeating to-do schedules the next one.</small>
              {saveState.fieldErrors.recurrenceInterval && <em className="package-field-error">{saveState.fieldErrors.recurrenceInterval}</em>}
            </label>
            <label className="form-dialog-wide"><span>Notes</span>
              <textarea defaultValue={record?.notes ?? ""} maxLength={2000} name="notes" rows={3} />
              {saveState.fieldErrors.notes && <em className="package-field-error">{saveState.fieldErrors.notes}</em>}
            </label>
          </FormDialogBody>
          <FormDialogActions onCancel={() => setDialog(null)} pending={savePending} submitLabel={record ? "Save changes" : "Add to-do"} />
        </form>
      </FormDialog>
    </div>
  );
}
