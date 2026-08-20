import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("employee management routes enforce team permissions and accessible forms", async () => {
  const [actions, form, employeePage, passwordPage, downloadRoute] = await Promise.all([
    read("app/team/actions.ts"),
    read("app/team/employee-form.tsx"),
    read("app/team/[employeeId]/page.tsx"),
    read("app/account/change-password/page.tsx"),
    read("app/documents/[documentId]/download/route.ts"),
  ]);
  assert.match(actions, /requirePermission\("team:manage"/);
  assert.match(form, /aria-describedby/);
  assert.match(form, /aria-invalid/);
  assert.match(employeePage, /Employee 360/);
  assert.match(employeePage, /Provision login access/);
  assert.match(employeePage, /hasPermission\(session, "attendance:review"\)/);
  assert.match(employeePage, /hasPermission\(session, "salary:manage"\)/);
  assert.match(form, /name="roleDefinitionId"/);
  assert.match(employeePage, /Attendance overview/);
  assert.match(employeePage, /Salary structure/);
  assert.match(passwordPage, /Create your permanent password/);
  assert.match(passwordPage, /logoutAction/);
  assert.match(downloadRoute, /authorizeRoutePermission\("documents:read"\)/);
  assert.match(downloadRoute, /password_change_required/);
});

test("Team workspace exposes workload and account state without tiny text", async () => {
  const [workspace, css] = await Promise.all([
    read("app/dashboard/team-workspace.tsx"),
    read("app/globals.css"),
  ]);
  assert.match(workspace, /ACTIVE EMPLOYEES/);
  assert.match(workspace, /AVAILABLE CAPACITY/);
  assert.match(workspace, /OVERDUE ASSIGNMENTS/);
  assert.match(workspace, /Access/);
  assert.match(css, /team-workspace/);
  assert.doesNotMatch(css, /font-size:\s*(?:[0-9]|1[01])px/);
});
