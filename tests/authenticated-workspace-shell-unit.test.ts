import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("authenticated feature routes inherit the persistent application shell", async () => {
  const [shell, clients, work, documents, tasks, employees] = await Promise.all([
    read("app/authenticated-workspace-shell.tsx"),
    read("app/clients/layout.tsx"),
    read("app/work/layout.tsx"),
    read("app/documents/layout.tsx"),
    read("app/tasks/layout.tsx"),
    // Each /team route frames itself, so the employee record carries the
    // Employees highlight rather than a parent that would claim it for all.
    read("app/team/[employeeId]/layout.tsx"),
  ]);

  assert.match(shell, /DashboardShell/);
  assert.match(shell, /workspace-route-content/);
  assert.match(shell, /router\.push/);
  assert.match(clients, /active="Clients"/);
  assert.match(work, /active="My work"/);
  assert.match(documents, /active="Documents"/);
  assert.match(tasks, /active="Tasks"/);
  assert.match(employees, /active="Employees"/);
});
