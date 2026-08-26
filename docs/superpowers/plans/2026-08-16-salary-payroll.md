# Salary and Payroll Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver confidential effective-dated salary structures, attendance-linked monthly payroll, controlled approval/publication/payment, and employee-only payslips.

**Architecture:** Normalized salary structure versions feed immutable per-run payroll snapshots. Payroll creation consumes locked attendance summaries. Transactional conditional transitions enforce the workflow, while repository authorization separates own published payslips from tenant-wide salary administration.

**Tech Stack:** Next.js 16.3 App Router, React 19, TypeScript 5.9, Drizzle ORM, PostgreSQL, Lucide React, CSV/print HTML output, CSS design tokens.

## Global Constraints

- Store INR values as integer paise; never use floating-point money.
- Statutory amounts are administrator-entered in this release and are not advertised as automatic compliance calculations.
- Managers cannot read salary amounts.
- Historical salary and payroll snapshots are immutable.
- `draft -> submitted -> approved_locked -> payslips_published -> paid` is enforced transactionally.
- Use TDD and do not create intermediate commits in the dirty workspace.

---

### Task 1: Salary authorization, money, and validation

**Files:**
- Modify: `lib/auth/authorization.ts`
- Create: `lib/payroll/money.ts`
- Create: `lib/payroll/validation.ts`
- Test: `tests/payroll-validation-unit.test.ts`
- Modify: `tests/auth-unit.test.ts`

**Interfaces:**
- Produces `salary:read:own`, `salary:manage`, and `salary:approve` permissions.
- Produces decimal-string-to-paise conversion, paise formatting, salary structure input, adjustment/statutory input, run-transition input, and payment input.

- [ ] Write failing tests for least privilege, exact paise conversion/formatting, negative/oversized values, duplicate component codes, invalid effective dates, invalid month/payment dates, and mandatory override reasons.
- [ ] Run focused tests and confirm the missing behavior fails.
- [ ] Implement pure money and validation functions without floats in persisted calculations.
- [ ] Re-run focused tests and TypeScript.

### Task 2: Salary and payroll schema

**Files:**
- Modify: `db/schema.ts`
- Create: next generated `drizzle/*.sql` and snapshot
- Modify: `tests/schema-unit.test.ts`

**Interfaces:**
- Produces `salaryStructures`, `salaryStructureLines`, `payrollRuns`, `payrollEntries`, and `payrollEntryLines` linked to attendance periods/summaries.

- [ ] Write failing tests for table exports, tenant relationships, unique run month, unique employee snapshot, money checks, valid kinds/sources/statuses, and lifecycle timestamps.
- [ ] Add the normalized schema and constraints.
- [ ] Generate and inspect a non-destructive migration.
- [ ] Re-run schema tests and TypeScript.

### Task 3: Payroll calculations and repository

**Files:**
- Create: `lib/payroll/calculations.ts`
- Create: `lib/payroll/repository.ts`
- Test: `tests/payroll-calculations-unit.test.ts`
- Test: `tests/payroll-repository-unit.test.ts`
- Modify: `tests/postgres-integration.test.ts`

**Interfaces:**
- Produces `calculatePayrollEntry`, `listSalaryWorkspace`, `getOwnPublishedPayslips`, `createSalaryStructure`, `createPayrollRun`, `updatePayrollEntryInputs`, `submitPayrollRun`, `approvePayrollRun`, `rejectPayrollRun`, `reopenPayrollRun`, `publishPayslips`, and `markPayrollPaid`.

- [ ] Write failing tests for half-day proration, deterministic rounding, line totals, net pay, negative-net blocking, and prior-month variance.
- [ ] Write failing source tests for tenant/employee scoping and conditional workflow updates.
- [ ] Implement effective-dated salary resolution and immutable run snapshots.
- [ ] Add PostgreSQL tests for cross-tenant/manager/employee privacy, overlapping-version rejection, attendance dependency, duplicate run prevention, workflow concurrency, override reason, publication gating, and own-payslip access.
- [ ] Run focused unit and integration tests.

### Task 4: Salary actions, editors, and payslips

**Files:**
- Create: `app/salary/actions.ts`
- Create: `app/salary/layout.tsx`
- Create: `app/salary/structures/[employeeId]/page.tsx`
- Create: `app/salary/salary-structure-form.tsx`
- Create: `app/salary/runs/[runId]/page.tsx`
- Create: `app/salary/payslips/[entryId]/page.tsx`
- Create: `app/salary/runs/[runId]/export/route.ts`
- Test: `tests/payroll-ui-unit.test.ts`

**Interfaces:**
- Routes and actions use repository functions from Task 3 and render inside the persistent Salary shell.
- CSV export authorizes `salary:manage`; payslip page authorizes own published access or salary administration.

- [ ] Write failing route/action tests for explicit salary permissions, safe UUIDs, session-derived employee identity, publication checks, CSV headers, accessible editor errors, and print-ready payslip markup.
- [ ] Implement salary structure, run creation/editing, transition, payslip, and export actions/routes.
- [ ] Re-run UI tests and TypeScript.

### Task 5: Salary workspace integration

**Files:**
- Create: `app/dashboard/salary-workspace.tsx`
- Modify: `app/dashboard/dashboard-icons.tsx`
- Modify: `app/dashboard/dashboard-shell.tsx`
- Modify: `app/authenticated-workspace-shell.tsx`
- Modify: `app/dashboard-client.tsx`
- Modify: `app/page.tsx`
- Modify: `app/globals.css`
- Modify: `app/team/[employeeId]/page.tsx`

**Interfaces:**
- `DashboardClient` consumes role-shaped `SalaryWorkspaceData` that omits tenant payroll amounts for unauthorized roles.
- Sidebar maps `Salary` to `/?workspace=salary`.

- [ ] Extend failing UI tests with role-sensitive Salary navigation, payroll workflow/KPIs/register, own-payslip history, salary-structure entry points, and mobile selectors.
- [ ] Implement manager-safe server loading and role-specific workspace rendering.
- [ ] Add Attendance and Salary sections to Employee 360 only when the viewer has the corresponding permission.
- [ ] Add responsive light/dark styles, readable money columns, workflow states, exception badges, and print styles.
- [ ] Run focused tests, TypeScript, and ESLint.

### Task 6: Payroll completion gate

**Files:**
- Modify: `scripts/db/check.ts` if required-table enumeration is explicit.
- Modify: `scripts/db/seed.ts` only for deterministic draft salary examples when safe; never publish or mark a payroll paid during seed.

- [ ] Run schema migration and PostgreSQL integration tests against the isolated test database.
- [ ] Apply both module migrations to local PostgreSQL.
- [ ] Run `npm run test:unit`, `npm run test:integration`, `npm run lint`, and `npm run build`.
- [ ] Restart the local development server and smoke-check Attendance, Salary, employee payslip denial, and privileged payroll access.
