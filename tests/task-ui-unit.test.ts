import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("task routes separate assignment permissions from employee self-service", async () => {
  const [actions, form, detail] = await Promise.all([
    read("app/tasks/actions.ts"),
    read("app/tasks/task-form.tsx"),
    read("app/tasks/[taskId]/page.tsx"),
  ]);
  assert.match(actions, /requirePermission\("tasks:assign"/);
  assert.match(actions, /requirePermission\("tasks:update:own"/);
  assert.match(form, /aria-describedby/);
  assert.match(detail, /TASK 360/);
});

test("Tasks workspace provides operational KPIs, scopes, employee navigation, and mobile cards", async () => {
  const [workspace, shell, dashboardClient, css] = await Promise.all([
    read("app/dashboard/tasks-workspace.tsx"),
    read("app/dashboard/dashboard-shell.tsx"),
    read("app/dashboard-client.tsx"),
    read("app/globals.css"),
  ]);
  const scopeParams = await read("lib/tasks/queue-params.ts");
  for (const label of ["Assigned to me", "I review", "Assigned by me", "Whole firm"]) {
    assert.ok(scopeParams.includes(label), `${label} must be an offered scope`);
  }
  assert.match(workspace, /DUE TODAY/);
  assert.match(workspace, /OVERDUE/);
  assert.match(workspace, /WAITING/);
  assert.match(workspace, /IN REVIEW/);
  // Scope labels live with the parser that decides which are offered.
  assert.match(workspace, /availableTaskScopes/);
  // Below 720px the register grid is hidden, so the component must render the
  // mobile list or the page shows nothing at all on a phone.
  assert.match(workspace, /task-mobile-list/);
  assert.match(workspace, /task-mobile-card/);
  assert.match(shell, /label: "Tasks"/);
  assert.match(shell, /label: "Employees"/);
  assert.match(dashboardClient, /Employees: "team"/);
  assert.match(dashboardClient, /active === "Employees"/);
  assert.match(css, /task-mobile-card/);
  assert.match(css, /@media\s*\(max-width:\s*720px\)/);
});
