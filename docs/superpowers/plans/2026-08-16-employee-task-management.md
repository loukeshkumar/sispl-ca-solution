# Employee and Task Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This repository's `AGENTS.md` requires inline execution, so execute each task in the current session without subagent review loops.

**Goal:** Build tenant-isolated employee management and general office-task assignment with employee login, self-service task updates, management controls, audit history, and responsive modern UI.

**Architecture:** Extend existing users and tenant memberships with one employee profile per tenant member, then add a separate office-task aggregate with optional client and compliance-work context. Server actions enforce coarse RBAC, repositories enforce tenant and resource access, and PostgreSQL composite keys preserve tenant integrity.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5.9, PostgreSQL, Drizzle ORM, Node test runner, CSS design tokens.

## Global Constraints

- Preserve the current dirty working tree and do not stage unrelated changes.
- Use existing authentication, password hashing, session, audit, form, and dashboard patterns.
- Keep attendance, leave, payroll, salary, biometrics, email invitations, attachments, recurrence, and external notifications out of scope.
- Maintain a 12px minimum font size, 44px minimum interactive targets, keyboard focus visibility, associated field errors, and responsive layouts without horizontal scrolling.
- Write each behavioral test before its production implementation and observe the expected failure.
- Keep every tenant-owned read and write explicitly tenant-scoped and backed by composite database relationships.

---

### Task 1: Employee and office-task database foundation

**Files:**
- Modify: `db/schema.ts`
- Create: next generated `drizzle/0008_*.sql`
- Create: next generated `drizzle/meta/0008_snapshot.json`
- Modify: `drizzle/meta/_journal.json`
- Modify: `scripts/db/check.ts`
- Test: `tests/schema-unit.test.ts`

**Interfaces:**
- Produces: `employeeProfiles`, `officeTasks`, and `userCredentials.mustChangePassword` Drizzle exports.
- Consumes: existing `tenants`, `users`, `tenantMemberships`, `legalEntities`, `workItems`, and composite tenant keys.

- [ ] **Step 1: Write the failing schema contract test**

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { getTableName } from "drizzle-orm";
import { employeeProfiles, officeTasks } from "../db/schema";

test("employee profiles and office tasks have dedicated database tables", () => {
  assert.equal(getTableName(employeeProfiles), "employee_profiles");
  assert.equal(getTableName(officeTasks), "office_tasks");
});
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `npx tsx --test tests/schema-unit.test.ts`

Expected: compilation fails because `employeeProfiles` and `officeTasks` are not exported.

- [ ] **Step 3: Add the schema**

Add `boolean` to the Drizzle imports, add `mustChangePassword: boolean("must_change_password").notNull().default(false)` to `userCredentials`, and define:

```ts
export const employeeProfiles = pgTable("employee_profiles", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  userId: uuid("user_id").notNull().references(() => users.id),
  employeeCode: text("employee_code").notNull(),
  designation: text("designation").notNull(),
  mobileNumber: text("mobile_number").notNull().default(""),
  joiningDate: date("joining_date", { mode: "string" }).notNull(),
  notes: text("notes").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("employee_profiles_tenant_user_unique").on(table.tenantId, table.userId),
  unique("employee_profiles_tenant_code_unique").on(table.tenantId, table.employeeCode),
  foreignKey({ name: "employee_profiles_membership_fk", columns: [table.tenantId, table.userId], foreignColumns: [tenantMemberships.tenantId, tenantMemberships.userId] }),
  index("employee_profiles_tenant_idx").on(table.tenantId),
]);
```

Define `officeTasks` with required tenant/title/description/assignee/assignedBy/priority/status/dueDate fields, optional reviewer/blocker/client/work/completed fields, timestamps, composite tenant foreign keys, an assignee-reviewer separation check, a waiting-note check, a completed timestamp check, and indexes `(tenant_id, assignee_id, status, due_date)` and `(tenant_id, status, due_date)`.

- [ ] **Step 4: Generate and inspect the migration**

Run: `npm run db:generate`

Expected: one migration adds the credential flag and both new tables without dropping existing data. Existing credentials must receive `false`; new credentials use the schema default and provisioning explicitly sets `true`.

- [ ] **Step 5: Verify GREEN and database setup**

Run: `npx tsx --test tests/schema-unit.test.ts && npm run db:migrate:local && npm run db:check:local`

Expected: schema test passes, migration applies, and the required-table check includes 16/16 tables.

---

### Task 2: Permissions and validation contracts

**Files:**
- Modify: `lib/auth/authorization.ts`
- Create: `lib/team/validation.ts`
- Create: `lib/tasks/validation.ts`
- Modify: `tests/auth-unit.test.ts`
- Create: `tests/team-validation-unit.test.ts`
- Create: `tests/task-validation-unit.test.ts`

**Interfaces:**
- Produces: `EmployeeInput`, `parseEmployeeForm`, `OfficeTaskInput`, `TaskSelfUpdateInput`, `parseOfficeTaskForm`, `parseTaskSelfUpdate`, and task/employee option constants.
- Produces permissions: `team:read`, `tasks:read`, `tasks:assign`, `tasks:update:own`.

- [ ] **Step 1: Write failing permission tests**

```ts
assert.equal(hasPermission("partner", "team:manage"), true);
assert.equal(hasPermission("manager", "team:read"), true);
assert.equal(hasPermission("manager", "tasks:assign"), true);
assert.equal(hasPermission("associate", "tasks:update:own"), true);
assert.equal(hasPermission("associate", "team:read"), false);
assert.equal(hasPermission("associate", "tasks:assign"), false);
```

- [ ] **Step 2: Run the auth test and confirm RED**

Run: `npx tsx --test tests/auth-unit.test.ts`

Expected: TypeScript rejects the new permission names.

- [ ] **Step 3: Add permission mappings**

Grant administrators and partners all new permissions, managers `team:read`, `tasks:read`, and `tasks:assign`, and associates `tasks:read` plus `tasks:update:own`.

- [ ] **Step 4: Write failing employee and task validation tests**

Cover normalized names/emails/mobile numbers, valid roles, joining dates, title/description lengths, priority/status allowlists, waiting-note requirement, UUID fields, reviewer separation, and work/client conflict inputs.

- [ ] **Step 5: Run validation tests and confirm RED**

Run: `npx tsx --test tests/team-validation-unit.test.ts tests/task-validation-unit.test.ts`

Expected: module-not-found failures for the new validation modules.

- [ ] **Step 6: Implement minimal validation modules**

Use the existing `{ value, fieldErrors }` pattern. Employee fields are `fullName`, `email`, `roleKey`, `designation`, `mobileNumber`, `joiningDate`, and `notes`. Task fields are `title`, `description`, `assigneeId`, `reviewerId`, `priority`, `status`, `dueDate`, `blockerNote`, `legalEntityId`, and `workItemId`.

- [ ] **Step 7: Verify GREEN**

Run: `npx tsx --test tests/auth-unit.test.ts tests/team-validation-unit.test.ts tests/task-validation-unit.test.ts && npx tsc --noEmit`

Expected: all focused tests and TypeScript pass.

---

### Task 3: Employee repository and account lifecycle

**Files:**
- Create: `lib/team/repository.ts`
- Create: `lib/auth/temporary-password.ts`
- Modify: `lib/auth/repository.ts`
- Modify: `lib/auth/server.ts`
- Modify: `tests/auth-unit.test.ts`
- Modify: `tests/postgres-integration.test.ts`

**Interfaces:**
- Produces: `listEmployees`, `getEmployee360`, `createEmployee`, `updateEmployee`, `provisionEmployeeAccess`, and `disableEmployee`.
- Produces: `createTemporaryPassword(): string`, `changeRequiredPassword`, and session field `mustChangePassword`.

- [ ] **Step 1: Write failing temporary-password and integration tests**

The unit test asserts 20-character random temporary passwords containing upper, lower, numeric, and symbol characters. The integration test creates an employee, verifies tenant-scoped visibility and an audit event, rejects disabling with an open task, provisions access with `mustChangePassword=true`, revokes sessions on disable, and cleans every temporary row.

- [ ] **Step 2: Run focused tests and confirm RED**

Run: `npx tsx --test tests/auth-unit.test.ts` and `npm run test:integration`

Expected: missing temporary-password and team repository exports.

- [ ] **Step 3: Implement employee reads and writes**

Use transactions for creation, profile/role changes, provisioning, and disabling. Generate employee codes as `EMP-` plus a zero-padded tenant sequence selected under a tenant-scoped advisory transaction lock. Reject duplicate email safely. Provisioning writes a scrypt hash and `mustChangePassword=true`; disabling requires no non-terminal assigned office tasks and updates membership status plus every live session in one transaction.

- [ ] **Step 4: Extend session loading**

Join credentials in session lookup and return `mustChangePassword`. Add `changeRequiredPassword(database, userId, currentTemporaryPassword, newPassword)` that verifies the current hash, validates the new password, updates the hash, clears the flag, and revokes other sessions.

- [ ] **Step 5: Verify GREEN**

Run: `npx tsx --test tests/auth-unit.test.ts && npm run test:integration && npx tsc --noEmit`

Expected: account and employee lifecycle tests pass without modifying the development database during integration tests.

---

### Task 4: Office-task repository and state machine

**Files:**
- Create: `lib/tasks/repository.ts`
- Modify: `tests/postgres-integration.test.ts`

**Interfaces:**
- Produces: `listTaskWorkspace`, `getTask360`, `createOfficeTask`, `updateOfficeTask`, `updateOwnTaskStatus`, `completeOfficeTask`, `cancelOfficeTask`, and `reopenOfficeTask`.
- Consumes: task validation types and existing `DashboardDatabase`.

- [ ] **Step 1: Write failing repository integration tests**

Create temporary manager and associate employees, then assert manager assignment, associate own-task visibility, foreign employee denial, cross-tenant denial, waiting-note enforcement, work-item/client derivation, reassignment audit, and exactly one successful concurrent completion.

- [ ] **Step 2: Run integration tests and confirm RED**

Run: `npm run test:integration`

Expected: missing task repository exports.

- [ ] **Step 3: Implement tenant and resource-scoped repository methods**

Managers and above query all tenant tasks; associates query `assignee_id = viewer.userId`. Validate active assignee/reviewer memberships. When `workItemId` is set, lock and read the tenant work item and use its `legalEntityId`. Insert one audit row for every state or assignment mutation.

- [ ] **Step 4: Implement atomic transitions**

Use conditional `UPDATE ... WHERE status IN (...) RETURNING` operations. Self-service allows only `todo`, `in_progress`, `waiting`, and `review`; management terminal actions control `completed`, `cancelled`, and reopening. Set or clear `completedAt` consistently with the schema checks.

- [ ] **Step 5: Verify GREEN**

Run: `npm run test:integration && npx tsc --noEmit`

Expected: all tenant, ownership, relationship, audit, and concurrency tests pass.

---

### Task 5: Server actions and employee/account pages

**Files:**
- Create: `app/team/actions.ts`
- Create: `app/team/new/page.tsx`
- Create: `app/team/employee-form.tsx`
- Create: `app/team/[employeeId]/page.tsx`
- Create: `app/team/[employeeId]/edit/page.tsx`
- Create: `app/team/[employeeId]/employee-actions.tsx`
- Create: `app/account/change-password/page.tsx`
- Create: `app/account/change-password/change-password-form.tsx`
- Modify: `app/auth-actions.ts`
- Modify: `app/page.tsx`
- Test: `tests/team-ui-unit.test.ts`

**Interfaces:**
- Server actions consume parsed form data and call repository methods only after `requirePermission`.
- Employee pages consume `getEmployee360` and expose no raw credential hashes.

- [ ] **Step 1: Write failing UI boundary tests**

Assert team actions require `team:manage`, manager-facing pages require `team:read`, password-change pages exist, validation controls have associated error ids, and temporary-password success copy states that it is shown once.

- [ ] **Step 2: Run the focused UI test and confirm RED**

Run: `npx tsx --test tests/team-ui-unit.test.ts`

Expected: missing team and account files.

- [ ] **Step 3: Implement actions and forms**

Follow existing client/work action-state forms. Use `aria-invalid`, `aria-describedby`, 44px buttons, pending labels, safe redirects, and confirmation before disabling. The provisioning success page displays the temporary password once with a copy control and never places it in a URL.

- [ ] **Step 4: Enforce required password change**

At authenticated page boundaries, redirect sessions with `mustChangePassword` to `/account/change-password`; allow that route and logout to avoid redirect loops. After a successful change, revoke the current temporary session and redirect to `/login` for a fresh login.

- [ ] **Step 5: Verify GREEN**

Run: `npx tsx --test tests/team-ui-unit.test.ts && npx tsc --noEmit`

Expected: team/account boundary tests and TypeScript pass.

---

### Task 6: Task pages and modern dashboard workspaces

**Files:**
- Create: `app/tasks/actions.ts`
- Create: `app/tasks/new/page.tsx`
- Create: `app/tasks/task-form.tsx`
- Create: `app/tasks/[taskId]/page.tsx`
- Create: `app/tasks/[taskId]/edit/page.tsx`
- Create: `app/tasks/[taskId]/task-actions.tsx`
- Create: `app/dashboard/tasks-workspace.tsx`
- Create: `app/dashboard/team-workspace.tsx`
- Modify: `app/dashboard/dashboard-shell.tsx`
- Modify: `app/dashboard-client.tsx`
- Modify: `app/page.tsx`
- Modify: `app/dashboard/dashboard-icons.tsx`
- Modify: `app/globals.css`
- Test: `tests/dashboard-layout-unit.test.ts`
- Test: `tests/team-ui-unit.test.ts`
- Create: `tests/task-ui-unit.test.ts`

**Interfaces:**
- `DashboardClient` receives serializable `taskWorkspace` and `teamWorkspace` data loaded by the server page according to permissions.
- `TasksWorkspace` receives viewer scope, filters, and create/update capabilities.
- `TeamWorkspace` receives employee workload summaries and management capabilities.

- [ ] **Step 1: Write failing workspace structure tests**

Assert Tasks and Team navigation visibility follows permissions; task KPIs use actual due/status filters; Team rows expose designation, role, access state, active tasks, and overdue counts; mobile CSS switches registers to cards; and no font size is below 12px or interactive control below 44px.

- [ ] **Step 2: Run UI tests and confirm RED**

Run: `npx tsx --test tests/dashboard-layout-unit.test.ts tests/team-ui-unit.test.ts tests/task-ui-unit.test.ts`

Expected: missing workspaces and navigation labels.

- [ ] **Step 3: Implement Tasks workspace and routes**

Build KPI cards for due today, overdue, waiting, and review; scope controls for My/Team/All where permitted; search; status and priority chips; semantic desktop rows; mobile cards; empty states; and New task, detail, edit, self-update, complete, cancel, and reopen actions.

- [ ] **Step 4: Implement Team workspace and routes**

Build active employee, available capacity, overdue assignment, and balanced-workload KPIs; search and role/status filters; workload meters with text labels; Employee 360; add/edit actions; access provisioning; and guarded disabling.

- [ ] **Step 5: Integrate dashboard navigation and URL state**

Add `/?workspace=tasks` and `/?workspace=team`, hide Team without `team:read`, show Tasks for authenticated viewers with `tasks:read`, preserve mobile drawer focus behavior, and load only authorized datasets in `app/page.tsx`.

- [ ] **Step 6: Verify GREEN**

Run: `npx tsx --test tests/dashboard-layout-unit.test.ts tests/team-ui-unit.test.ts tests/task-ui-unit.test.ts && npx tsc --noEmit`

Expected: UI contract tests and TypeScript pass.

---

### Task 7: Seed, documentation, and consolidated verification

**Files:**
- Modify: `scripts/db/seed.ts`
- Modify: `LOCAL_SETUP.md`
- Modify: `README.md`
- Modify: `EXECUTION_PLAN.md`
- Modify: `tests/postgres-integration.test.ts`

**Interfaces:**
- Seed creates idempotent employee profiles for existing fictitious members without silently enabling credentials.
- Documentation distinguishes employee/task delivery from excluded HR/payroll scope.

- [ ] **Step 1: Add failing seed assertions**

Extend integration seed counts to require five employee profiles and verify repeated seeding does not duplicate them.

- [ ] **Step 2: Run integration tests and confirm RED**

Run: `npm run test:integration`

Expected: employee profile count is zero before seed support.

- [ ] **Step 3: Extend the idempotent seed and documentation**

Seed profile codes `EMP-0001` through `EMP-0005`, designations matching the fictitious roles, blank mobile numbers, and stable joining dates. Document employee provisioning, task permissions, migration/setup commands, temporary-password behavior, and excluded attendance/payroll scope.

- [ ] **Step 4: Run the consolidated gate**

Run in order:

```bash
npm run test:unit
npm run test:integration
npx tsc --noEmit
npm run lint
npm run build
npm run db:check:local
npm audit --omit=dev
git diff --check
```

Expected: every command exits 0; unit and integration output contains no failures; the production build lists Team, Tasks, Employee 360, task detail, and password-change routes; database check reports 16/16 required tables; audit reports zero production vulnerabilities.

- [ ] **Step 5: Review the working-tree boundary**

Run: `git status --short`

Expected: only intended feature files plus the pre-existing user-owned changes remain. Do not commit or stage the mixed implementation tree without explicit user authorization.
