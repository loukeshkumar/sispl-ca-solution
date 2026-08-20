import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = async (path: string) => {
  try { return await readFile(new URL(`../${path}`, import.meta.url), "utf8"); } catch { return ""; }
};

test("attendance Server Actions authenticate every self-service and management mutation", async () => {
  const [actions, form, requestDialog] = await Promise.all([
    read("app/attendance/actions.ts"), read("app/attendance/request-form.tsx"), read("app/dashboard/attendance-request-dialog.tsx"),
  ]);
  assert.match(actions, /requirePermission\("attendance:use"/);
  assert.match(actions, /requirePermission\("attendance:review"/);
  assert.match(actions, /requirePermission\("attendance:manage"/);
  assert.match(actions, /session\.tenantId, session\.userId/);
  assert.match(actions, /validateLeaveRequestFields/);
  assert.match(actions, /validateCorrectionRequestFields/);
  assert.match(actions, /validateAttendancePolicyFields/);
  assert.match(actions, /validateEmployeeWorkProfileFields/);
  assert.match(form, /aria-describedby/);
  assert.match(form, /Leave request/);
  assert.match(form, /Attendance correction/);
  // Raising a request is a dialog on the attendance workspace, not a separate route.
  assert.match(requestDialog, /FormDialog/);
  assert.match(requestDialog, /Request attendance change/);
  assert.match(requestDialog, /AttendanceRequestForm/);
  assert.match(requestDialog, /key=\{mode\}/, "switching mode must clear the previous form's fields and errors");
});

test("Attendance workspace exposes employee clocking, approvals, periods, and responsive navigation", async () => {
  const [workspace, shell, client, page, routeShell, css] = await Promise.all([
    read("app/dashboard/attendance-workspace.tsx"), read("app/dashboard/dashboard-shell.tsx"),
    read("app/dashboard-client.tsx"), read("app/page.tsx"), read("app/authenticated-workspace-shell.tsx"), read("app/globals.css"),
  ]);
  for (const token of ["CHECK IN", "CHECK OUT", "PRESENT", "LATE", "ON LEAVE", "MISSING PUNCH", "Approval queue", "Your register", "Prepare month", "Lock attendance"]) assert.match(workspace, new RegExp(token));
  // Recording attendance happens in one place — the month grid. A second inline
  // form was the main reason this page read as two applications at once.
  assert.match(workspace, /AttendanceMatrixGrid/);
  assert.doesNotMatch(workspace, /recordManualAttendanceAction/, "one way to record, not two");

  // One view per audience, so no one scrolls through another role's panels.
  assert.match(workspace, /WorkspaceTabs/);
  for (const label of ["Today", "Month register", "My attendance", "Approvals", "Setup"]) {
    assert.ok(workspace.includes(`label: "${label}"`), `${label} view must exist`);
  }
  assert.match(workspace, /createAttendancePolicyAction/);
  assert.match(workspace, /updateEmployeeWorkProfileAction/);
  assert.match(workspace, /decideAttendanceRequestAction/);
  assert.match(shell, /label: "Attendance"/);
  assert.match(client, /active === "Attendance"/);
  assert.match(client, /Attendance: "attendance"/);
  assert.match(page, /getAttendanceWorkspace/);
  assert.match(page, /attendancePeriod/);
  assert.match(workspace, /attendance-month-nav/);
  assert.match(routeShell, /Attendance: "\/\?workspace=attendance"/);
  assert.match(css, /attendance-workspace/);
  assert.match(css, /attendance-mobile-card/);
  assert.match(css, /@media\s*\(max-width:\s*767px\)/);
});
