# Employee Attendance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a tenant-scoped attendance ledger, employee self-service, manager approval queue, and locked monthly summaries for payroll.

**Architecture:** Drizzle/PostgreSQL tables hold policy versions, work profiles, immutable events, derived days, requests, periods, and summaries. Server Actions derive identity and permissions from the session; repositories enforce tenant, owner, and reportee scope. Dashboard components render employee and manager modes inside the existing persistent shell.

**Tech Stack:** Next.js 16.3 App Router, React 19, TypeScript 5.9, Drizzle ORM, PostgreSQL, Lucide React, CSS design tokens.

## Global Constraints

- Jurisdiction defaults to Bihar, India; time zone is `Asia/Kolkata`.
- Attendance events are append-only; corrections never overwrite history silently.
- Managers access reportees only; administrators/partners can access the tenant.
- Locked periods cannot change without an audited reopen and payroll dependency check.
- Use TDD: each production behavior follows an observed failing focused test.
- Do not commit intermediate work in the existing dirty workspace.

---

### Task 1: Authorization and attendance validation

**Files:**
- Modify: `lib/auth/authorization.ts`
- Create: `lib/attendance/validation.ts`
- Test: `tests/attendance-validation-unit.test.ts`
- Modify: `tests/auth-unit.test.ts`

**Interfaces:**
- Produces permissions `attendance:use`, `attendance:review`, and `attendance:manage`.
- Produces validated policy, work-profile, manual-day, leave-request, correction-request, and period inputs.

- [ ] Write failing tests for role permissions, valid inputs, invalid dates/times/statuses, self-manager assignment, excessive notes, reversed ranges, and month format.
- [ ] Run `npx tsx --test tests/auth-unit.test.ts tests/attendance-validation-unit.test.ts` and confirm missing permissions/functions fail.
- [ ] Implement discriminated validation results with normalized strings and exact unions.
- [ ] Re-run focused tests and `npx tsc --noEmit`.

### Task 2: Attendance schema and migration

**Files:**
- Modify: `db/schema.ts`
- Create: next generated `drizzle/*.sql` and snapshot
- Modify: `tests/schema-unit.test.ts`

**Interfaces:**
- Produces `attendancePolicies`, `employeeWorkProfiles`, `attendanceDays`, `attendanceEvents`, `leaveRequests`, `attendanceCorrectionRequests`, `attendancePeriods`, and `attendancePeriodSummaries`.

- [ ] Write failing schema tests for table names, composite tenant relationships, state checks, period uniqueness, non-negative minute/unit checks, and append-only event shape.
- [ ] Run the schema test and confirm missing exports fail.
- [ ] Add tables and constraints using integer minutes/half-day units and time-zone timestamps.
- [ ] Generate the migration with `npm run db:generate`; inspect SQL and prohibit destructive changes.
- [ ] Re-run schema tests and TypeScript.

### Task 3: Attendance repository and calculations

**Files:**
- Create: `lib/attendance/calculations.ts`
- Create: `lib/attendance/repository.ts`
- Test: `tests/attendance-calculations-unit.test.ts`
- Test: `tests/attendance-repository-unit.test.ts`
- Modify: `tests/postgres-integration.test.ts`

**Interfaces:**
- Produces `getAttendanceWorkspace`, `checkIn`, `checkOut`, `recordManualAttendance`, `createLeaveRequest`, `createCorrectionRequest`, `decideAttendanceRequest`, `moveAttendancePeriodToReview`, `lockAttendancePeriod`, and `reopenAttendancePeriod`.
- Produces deterministic `buildAttendanceSummary` and `indiaAttendanceDateKey`.

- [ ] Write failing calculation tests for late minutes, worked minutes, paid/LOP half-day units, weekly-off handling, and totals.
- [ ] Write failing source-boundary tests requiring tenant predicates, owner/reportee scoping, conditional transitions, and no client-provided actor.
- [ ] Implement pure calculations and transactional repository functions.
- [ ] Add integration tests proving own/reportee/tenant isolation, duplicate check-in rejection, request self-approval rejection, stale correction rejection, lock blocking on pending exceptions, and immutable summary creation.
- [ ] Run focused unit and isolated PostgreSQL integration tests.

### Task 4: Authenticated actions and routes

**Files:**
- Create: `app/attendance/actions.ts`
- Create: `app/attendance/layout.tsx`
- Create: `app/attendance/requests/new/page.tsx`
- Create: `app/attendance/corrections/new/page.tsx`
- Create: `app/attendance/request-form.tsx`
- Test: `tests/attendance-ui-unit.test.ts`

**Interfaces:**
- Server Actions consume the validation and repository functions from Tasks 1 and 3.
- Routes render within `WorkspaceRouteFrame active="Attendance"`.

- [ ] Write failing UI/action contract tests for server-side permissions, session identity, accessible errors, and persistent-shell routes.
- [ ] Run the focused UI test and confirm missing files fail.
- [ ] Implement check-in/out, request, decision, manual marking, review, lock, and reopen actions with fixed safe return paths.
- [ ] Implement accessible leave/correction forms and route guards.
- [ ] Re-run UI tests and TypeScript.

### Task 5: Attendance workspace integration

**Files:**
- Create: `app/dashboard/attendance-workspace.tsx`
- Modify: `app/dashboard/dashboard-icons.tsx`
- Modify: `app/dashboard/dashboard-shell.tsx`
- Modify: `app/authenticated-workspace-shell.tsx`
- Modify: `app/dashboard-client.tsx`
- Modify: `app/page.tsx`
- Modify: `app/globals.css`

**Interfaces:**
- `DashboardClient` consumes `AttendanceWorkspaceData`.
- Sidebar navigation maps `Attendance` to `/?workspace=attendance`.

- [ ] Extend the failing UI contract with navigation, employee KPIs, clock control, monthly register, request queue, manager filters, lock control, and mobile card selectors.
- [ ] Implement data loading and role-sensitive navigation without importing PostgreSQL into client modules.
- [ ] Implement responsive light/dark glass surfaces with 44px controls and text-labelled statuses.
- [ ] Run focused tests, TypeScript, and ESLint.

### Task 6: Attendance completion gate

**Files:**
- Modify: `scripts/db/check.ts` if required-table enumeration is explicit.
- Modify: `scripts/db/seed.ts` only to create deterministic policy/work-profile defaults, never attendance history.

- [ ] Apply the migration to the isolated test database and run integration tests.
- [ ] Apply migration and safe defaults to the local database.
- [ ] Run `npm run test:unit`, `npm run test:integration`, `npm run lint`, and `npm run build`.
- [ ] Confirm `/` and `/?workspace=attendance` start without server errors.
