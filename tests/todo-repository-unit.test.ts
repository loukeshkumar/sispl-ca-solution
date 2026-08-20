import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("personal to-do workspace derives private deadline metrics without fake data", async () => {
  const repository = await import("../lib/todos/repository").catch(() => ({})) as Record<string, unknown>;
  assert.equal(typeof repository.buildTodoWorkspace, "function");
  const build = repository.buildTodoWorkspace as (rows: unknown[], todayKey: string) => {
    todos: Array<{ id: string }>;
    metrics: Record<string, number>;
    categories: string[];
  };
  const rows = [
    { id: "later", title: "Later", notes: "", dueDate: "2026-08-20", dueTime: null, priority: "normal", category: "Admin", status: "open", completedAt: null, archivedAt: null, createdAt: new Date("2026-08-01"), updatedAt: new Date("2026-08-01") },
    { id: "overdue", title: "Overdue", notes: "", dueDate: "2026-08-15", dueTime: "10:00", priority: "urgent", category: "Client", status: "open", completedAt: null, archivedAt: null, createdAt: new Date("2026-08-01"), updatedAt: new Date("2026-08-02") },
    { id: "today", title: "Today", notes: "", dueDate: "2026-08-16", dueTime: null, priority: "high", category: "Client", status: "open", completedAt: null, archivedAt: null, createdAt: new Date("2026-08-01"), updatedAt: new Date("2026-08-03") },
    { id: "done", title: "Done", notes: "", dueDate: "2026-08-10", dueTime: null, priority: "low", category: "", status: "completed", completedAt: new Date("2026-08-11"), archivedAt: null, createdAt: new Date("2026-08-01"), updatedAt: new Date("2026-08-11") },
  ];
  const workspace = build(rows, "2026-08-16");
  assert.deepEqual(workspace.metrics, { open: 3, overdue: 1, dueToday: 1, upcoming: 1, completed: 1 });
  assert.deepEqual(workspace.categories, ["Admin", "Client"]);
  assert.deepEqual(workspace.todos.map((item) => item.id), ["overdue", "today", "later", "done"]);
});

test("every personal to-do repository operation requires tenant and owner identity", async () => {
  const source = await readFile(new URL("../lib/todos/repository.ts", import.meta.url), "utf8").catch(() => "");
  for (const operation of ["listTodoWorkspace", "getTodo", "createTodo", "updateTodo", "completeTodo", "reopenTodo", "archiveTodo"]) {
    assert.match(source, new RegExp(`export async function ${operation}`), `missing ${operation}`);
  }
  assert.match(source, /eq\(personalTodos\.tenantId, tenantId\)/);
  assert.match(source, /eq\(personalTodos\.ownerUserId, ownerUserId\)/);
  assert.doesNotMatch(source, /canManageAll|roleKey/);
});
