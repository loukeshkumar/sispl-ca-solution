import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

test("the grid and every mark it makes require attendance:manage", async () => {
  const actions = await read("../app/attendance/actions.ts");
  for (const action of ["loadAttendanceMatrixAction", "markAttendanceCellAction"]) {
    const start = actions.indexOf(`export async function ${action}`);
    assert.ok(start >= 0, `${action} must exist`);
    const body = actions.slice(start, actions.indexOf("\n}\n", start));
    assert.match(body, /requirePermission\("attendance:manage"/, `${action} shows or changes every employee's month`);
    assert.match(body, /session\.tenantId/, `${action} must stay inside the caller's firm`);
  }
  // The grid is a permission-gated tab: absent entirely without manage rights.
  const workspace = await read("../app/dashboard/attendance-workspace.tsx");
  assert.match(workspace, /canManage \? \[\{ content: <AttendanceMatrixGrid/);
  assert.match(workspace, /canReview \? \[\{ badge: workspace\.approvals\.length/);
});

test("a fast click carries the same protections as the considered form", async () => {
  const actions = await read("../app/attendance/actions.ts");
  const start = actions.indexOf("export async function markAttendanceCellAction");
  const body = actions.slice(start, actions.indexOf("\n}\n", start));
  // Same validator and same audited write as the manual entry form.
  assert.match(body, /validateManualAttendanceFields/);
  assert.match(body, /recordManualAttendance\(/);
  assert.match(body, /UUID_PATTERN\.test\(input\.employeeUserId\)/);
  // The period lock, employment check and audit event live in the repository,
  // so the grid must not write to attendance_days itself.
  const matrix = await read("../lib/attendance/matrix.ts");
  assert.doesNotMatch(matrix, /\.insert\(|\.update\(|\.delete\(/, "the matrix module is read-only");
});

test("the month grid is tenant-scoped and built on UTC dates", async () => {
  const source = await read("../lib/attendance/matrix.ts");
  const queries = source.split(".from(").slice(1);
  assert.ok(queries.length >= 4, "roster, recorded days, holidays and period");
  assert.equal((source.match(/eq\((?:attendanceDays|holidayCalendar|attendancePeriods|employeeProfiles)\.tenantId, tenantId\)/g) ?? []).length, 4);
  assert.match(source, /eq\(tenantMemberships\.tenantId, tenantId\)/);

  // Local-time date maths would shift the whole grid by a column for anyone
  // west of UTC, silently misaligning every mark.
  assert.match(source, /Date\.UTC\(year, month - 1, index \+ 1\)/);
  assert.doesNotMatch(source, /new Date\(\)\.getFullYear|getMonth\(\)(?!.*UTC)/);

  // Joiners and leavers still appear for the months they were employed.
  assert.match(source, /lte\(employeeProfiles\.joiningDate, end\)/);
  assert.match(source, /employmentEndDate\} is null or/);
});

test("a locked month cannot be edited from the grid", async () => {
  const grid = await read("../app/dashboard/attendance-matrix.tsx");
  assert.match(grid, /disabled=\{locked\}/, "cells must be inert once the month is locked");
  assert.match(grid, /attendance-matrix-locked/, "and the reason must be visible");
  const matrix = await read("../lib/attendance/matrix.ts");
  assert.match(matrix, /locked: period\[0\]\?\.status === "locked"/);
});

test("a cell announces which row it is in", async () => {
  const grid = await read("../app/dashboard/attendance-matrix.tsx");
  // A column header alone leaves a screen-reader user without the employee.
  assert.match(grid, /aria-label=\{`\$\{employee\.fullName\}, \$\{day\.date\}: \$\{described\}`\}/);
  assert.match(grid, /<caption className="sr-only">/);
  assert.match(grid, /scope="row"/);
  assert.match(grid, /scope="col"/);
});

test("workspace tabs follow the tabs pattern rather than looking like it", async () => {
  const source = await read("../app/dashboard/workspace-tabs.tsx");
  assert.match(source, /role="tablist"/);
  assert.match(source, /role="tab"/);
  assert.match(source, /role="tabpanel"/);
  assert.match(source, /aria-controls=\{`panel-\$\{tab\.id\}`\}/);
  assert.match(source, /aria-labelledby=\{`tab-\$\{current\.id\}`\}/);
  assert.match(source, /aria-selected=\{tab\.id === current\.id\}/);

  // Only the selected tab is tabbable, so Tab leaves the tablist for the panel
  // instead of walking through every other tab first.
  assert.match(source, /tabIndex=\{tab\.id === current\.id \? 0 : -1\}/);
  for (const key of ["ArrowRight", "ArrowLeft", "Home", "End"]) {
    assert.ok(source.includes(`"${key}"`), `${key} must move between tabs`);
  }
});
