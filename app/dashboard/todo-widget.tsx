import Link from "next/link";
import { Check, ListTodo } from "lucide-react";

import { completeTodoAction } from "../todos/actions";
import type { TodoWorkspaceData } from "../../lib/todos/repository";
import { todoPriorityLabel } from "../../lib/todos/validation";

export function TodoWidget({ workspace }: { workspace: TodoWorkspaceData }) {
  const items = workspace.todos.filter((todo) => todo.status === "open").slice(0, 4);
  return (
    <section className="overview-todo-widget surface-card">
      <div className="panel-heading"><div><p className="eyebrow">PERSONAL TO-DO</p><h2>Your next reminders</h2><span>Private to your account</span></div><Link className="text-action" href="/?workspace=todos">Open To-do</Link></div>
      <div className="overview-todo-list">
        {items.map((todo) => <article key={todo.id}><span className={`todo-priority-marker is-${todo.priority}`} /><div><strong>{todo.title}</strong><span>{todo.dueDate === workspace.todayKey ? "Due today" : todo.dueDate ?? "No due date"} · {todoPriorityLabel(todo.priority)}</span></div><form action={completeTodoAction}><input name="todoId" type="hidden" value={todo.id} /><input name="returnTo" type="hidden" value="/" /><button aria-label={`Complete ${todo.title}`} className="todo-icon-button is-complete" title="Mark complete" type="submit"><Check aria-hidden="true" size={18} /></button></form></article>)}
        {!items.length && <div className="overview-todo-empty"><ListTodo aria-hidden="true" size={22} /><span><strong>You are clear</strong><small>Add a personal reminder when something comes up.</small></span><Link href="/?workspace=todos">Add to-do</Link></div>}
      </div>
    </section>
  );
}
