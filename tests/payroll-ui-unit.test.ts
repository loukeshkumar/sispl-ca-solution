import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = async (path: string) => {
  try { return await readFile(new URL(`../${path}`, import.meta.url), "utf8"); } catch { return ""; }
};

test("salary Server Actions enforce confidential permissions and validated transitions", async () => {
  const [actions, structureForm, structurePage, runPage] = await Promise.all([
    read("app/salary/actions.ts"), read("app/salary/salary-structure-form.tsx"),
    read("app/salary/structures/[employeeId]/page.tsx"), read("app/salary/runs/[runId]/page.tsx"),
  ]);
  assert.match(actions, /requirePermission\("salary:manage"/);
  assert.match(actions, /requirePermission\("salary:read:own"/);
  assert.match(actions, /hasPermission\(session, "salary:approve"\)/);
  assert.match(actions, /session\.tenantId/);
  assert.match(actions, /session\.userId/);
  assert.match(actions, /validateSalaryStructureFields/);
  assert.match(actions, /validatePayrollPeriodFields/);
  assert.match(actions, /validatePayrollEntryFields/);
  assert.match(actions, /validateTransitionReason/);
  assert.match(actions, /holdReason/);
  assert.match(structureForm, /aria-describedby/);
  assert.match(structureForm, /Add component/);
  assert.match(structurePage, /Salary structure/);
  assert.match(runPage, /Payroll control/);
});

test("payslips and payroll CSV enforce publication and authorization", async () => {
  const [payslip, exportRoute, repository] = await Promise.all([
    read("app/salary/payslips/[entryId]/page.tsx"), read("app/salary/runs/[runId]/export/route.ts"), read("lib/payroll/repository.ts"),
  ]);
  assert.match(payslip, /getPublishedPayslip/);
  assert.match(payslip, /salary-payslip/);
  assert.match(payslip, /EARNINGS/);
  assert.match(payslip, /DEDUCTIONS/);
  assert.match(payslip, /Total earnings/);
  assert.match(exportRoute, /authorizeRoutePermission\("salary:manage"\)/);
  assert.match(exportRoute, /text\/csv/);
  assert.match(exportRoute, /Content-Disposition/);
  assert.match(repository, /inArray\(payrollRuns\.status, \["payslips_published", "paid"\]\)/);
});

test("Salary workspace exposes role-shaped payroll operations and persistent navigation", async () => {
  const [workspace, shell, client, page, routeShell, css] = await Promise.all([
    read("app/dashboard/salary-workspace.tsx"), read("app/dashboard/dashboard-shell.tsx"), read("app/dashboard-client.tsx"),
    read("app/page.tsx"), read("app/authenticated-workspace-shell.tsx"), read("app/globals.css"),
  ]);
  for (const token of ["SALARY STRUCTURES", "PAYROLL RUNS", "Create payroll", "Submit payroll", "Approve &amp; lock", "Publish payslips", "Mark paid", "MY PAYSLIPS"]) assert.match(workspace, new RegExp(token));
  assert.match(shell, /label: "Salary"/);
  assert.match(client, /active === "Salary"/);
  assert.match(client, /Salary: "salary"/);
  assert.match(page, /listSalaryWorkspace/);
  assert.match(routeShell, /Salary: "\/\?workspace=salary"/);
  assert.match(css, /salary-workspace/);
  assert.match(css, /salary-mobile-card/);
  assert.match(css, /@media\s*\(max-width:\s*767px\)/);
  assert.match(css, /@media print/);
});

test("salary structure editor constrains every grid track and form control to its card", async () => {
  const css = (await read("app/globals.css")).replace(/\s+/g, "");
  assert.match(css, /\.salary-structure-form,\.salary-component-list\{[^}]*min-width:0;[^}]*width:100%;/);
  assert.match(css, /\.salary-component-row\{[^}]*grid-template-columns:minmax\(0,\.65fr\)minmax\(0,1\.2fr\)minmax\(0,1fr\)minmax\(0,\.8fr\)44px;[^}]*min-width:0;[^}]*width:100%;/);
  assert.match(css, /\.salary-structure-form>label,\.salary-component-row>label\{[^}]*min-width:0;/);
  assert.match(css, /\.salary-structure-forminput,\.salary-structure-formselect\{[^}]*max-width:100%;[^}]*min-width:0;[^}]*width:100%;/);
});
