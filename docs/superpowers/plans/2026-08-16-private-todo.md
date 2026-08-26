# Private To-do Feature Implementation Plan

**Goal:** Deliver a fully working, private, PostgreSQL-backed to-do workspace and Overview widget for each authenticated employee.

**Architecture:** Keep personal to-dos separate from shared office tasks. Server Actions derive tenant and owner identity from the authenticated session, while repository operations require both identifiers for every read and mutation.

**Tech Stack:** Next.js App Router, React, TypeScript, Drizzle ORM, PostgreSQL, existing CSS design tokens and Lucide icons.

## Global Constraints

- To-dos are private to their owner; management roles have no override.
- Store office-local due date and optional time separately.
- Support title, notes, priority, category, complete, reopen, and archive.
- Add a sidebar workspace and Overview widget.
- Do not add sharing, reminders, recurrence, or subtasks.
- Preserve unrelated worktree changes and do not create commits.

---

### Task 1: Schema and migration

**Files:** `db/schema.ts`, generated `drizzle/0009_*.sql`, `drizzle/meta/*`, `tests/schema-unit.test.ts`

**Produces:** `personalTodos` Drizzle table with owner membership FK, status/priority checks, completion/archive consistency checks, and owner/status/due indexes.

- [ ] Add a failing schema test asserting the table and privacy constraints.
- [ ] Run `npx tsx --test tests/schema-unit.test.ts` and confirm the new assertion fails.
- [ ] Add the table to `db/schema.ts` and generate the migration with `npm run db:generate`.
- [ ] Re-run the schema test and `npx tsc --noEmit`.

### Task 2: Validation and private repository

**Files:** `lib/todos/validation.ts`, `lib/todos/repository.ts`, `tests/todo-validation-unit.test.ts`, `tests/postgres-integration.test.ts`

**Produces:** `validateTodoFields`, `listTodoWorkspace`, `createTodo`, `updateTodo`, `completeTodo`, `reopenTodo`, and `archiveTodo`.

- [ ] Write failing tests for normalization, optional due values, length limits, priorities, and legal state transitions.
- [ ] Write a failing PostgreSQL test proving user A cannot list or mutate user B's to-do.
- [ ] Implement validation and owner-scoped repository functions.
- [ ] Run focused unit tests, the isolated integration suite, and TypeScript.

### Task 3: Server Actions and editor routes

**Files:** `app/todos/actions.ts`, `app/todos/layout.tsx`, `app/todos/new/page.tsx`, `app/todos/[todoId]/edit/page.tsx`, `app/todos/todo-form.tsx`, `tests/todo-ui-unit.test.ts`

**Consumes:** Repository functions from Task 2.

- [ ] Write failing route/action contract tests for authentication, field errors, and persistent shell usage.
- [ ] Implement create/edit forms using `useActionState` and authenticated Server Actions.
- [ ] Implement complete, reopen, and archive actions with UUID validation and safe stale-state handling.
- [ ] Run focused tests, TypeScript, and ESLint.

### Task 4: Workspace, navigation, and Overview widget

**Files:** `app/dashboard/todos-workspace.tsx`, `app/dashboard/todo-widget.tsx`, `app/dashboard/dashboard-shell.tsx`, `app/dashboard/dashboard-icons.tsx`, `app/dashboard/overview-workspace.tsx`, `app/dashboard-client.tsx`, `app/authenticated-workspace-shell.tsx`, `app/page.tsx`, `tests/todo-ui-unit.test.ts`

**Consumes:** `TodoWorkspaceData` from Task 2.

- [ ] Write failing UI contract tests for the To-do navigation, workspace filters, quick add, and Overview widget.
- [ ] Load only the viewer's to-dos in `app/page.tsx` and pass them into the dashboard client.
- [ ] Add the To-do sidebar destination, workspace routing, responsive register/cards, and inline lifecycle controls.
- [ ] Add the Overview widget with overdue, today, and upcoming items.
- [ ] Run focused tests, TypeScript, and ESLint.

### Task 5: Styling and verification

**Files:** `app/globals.css`, relevant UI tests and local setup documentation if migration commands change.

- [ ] Write a failing CSS contract test for responsive to-do layouts, 44px controls, focus states, and dark/light tokens.
- [ ] Add glass workspace, widget, form, empty-state, and mobile styles using existing semantic tokens.
- [ ] Run `npm run db:migrate:local`, `npm run db:check:local`, `npm test`, `npx tsc --noEmit`, `npm run lint`, `npm run build`, `npm audit --omit=dev`, and `git diff --check`.
- [ ] Start the local development server and smoke-check `/login`, `/?workspace=todos`, and the create/edit routes.
