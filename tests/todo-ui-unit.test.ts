import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = async (path: string) => {
  try {
    return await readFile(new URL(`../${path}`, import.meta.url), "utf8");
  } catch {
    return "";
  }
};

test("personal to-do actions always use the authenticated employee identity", async () => {
  // Add and edit moved from dedicated pages into the workspace dialog.
  const [actions, workspace] = await Promise.all([
    read("app/todos/actions.ts"),
    read("app/dashboard/todos-workspace.tsx"),
  ]);

  assert.match(actions, /requirePermission\("dashboard:read"/);
  assert.match(actions, /session\.tenantId, session\.userId/);
  assert.match(actions, /validateTodoFields/);
  assert.match(actions, /completeTodo/);
  assert.match(actions, /reopenTodo/);
  assert.match(actions, /archiveTodo/);
  // One save action covers both paths, scoped to the signed-in owner.
  assert.match(actions, /export async function saveTodoAction/);
  assert.match(actions, /updateTodo\(getDatabase\(\), session\.tenantId, session\.userId/);
  assert.match(workspace, /FormDialog/, "to-do editing must use the shared modal primitive");
  assert.match(workspace, /name="todoId"/, "editing must post the id so the save becomes an update");
  assert.match(workspace, /aria-describedby/);
  assert.match(workspace, /name="dueTime"/);
  assert.match(workspace, /name="category"/);
});

test("the dashboard exposes a complete responsive personal to-do workspace", async () => {
  const [workspace, widget, shell, client, page, css] = await Promise.all([
    read("app/dashboard/todos-workspace.tsx"),
    read("app/dashboard/todo-widget.tsx"),
    read("app/dashboard/dashboard-shell.tsx"),
    read("app/dashboard-client.tsx"),
    read("app/page.tsx"),
    read("app/globals.css"),
  ]);

  for (const label of ["TODAY", "OVERDUE", "UPCOMING", "COMPLETED", "Archived", "Priority", "Category"]) {
    assert.match(workspace, new RegExp(label));
  }
  assert.match(workspace, /createTodoAction/);
  assert.match(workspace, /completeTodoAction/);
  assert.match(workspace, /reopenTodoAction/);
  assert.match(workspace, /archiveTodoAction/);
  assert.match(widget, /PERSONAL TO-DO/);
  assert.match(widget, /completeTodoAction/);
  assert.match(shell, /label: "To-do"/);
  assert.match(client, /active === "To-do"/);
  assert.match(page, /listTodoWorkspace/);
  assert.match(css, /todos-workspace/);
  assert.match(css, /todo-mobile-card/);
  assert.match(css, /@media\s*\(max-width:\s*767px\)/);
});
