# Private To-do Feature Design

## Goal

Add a complete PostgreSQL-backed personal to-do workflow for every authenticated employee without mixing private reminders into the office assignment system.

## Product boundary

- Every to-do belongs to one tenant and one user.
- Only the owner can list, read, create, edit, complete, reopen, or archive it.
- Firm administrators, partners, and managers receive no special access to another user's personal to-dos.
- Existing office Tasks remain the shared assignment system.
- This version does not include sharing, reminders, recurrence, or subtasks.

## Data model

Create `personal_todos` with UUID `id`, `tenant_id`, `owner_user_id`, title, notes, optional due date and time, priority, category, status, completion/archive timestamps, and created/updated timestamps. A composite foreign key to `tenant_memberships(tenant_id, user_id)` guarantees that the owner belongs to the tenant. Index tenant, owner, status, and due date for the workspace queries.

## Application structure

- `lib/todos/validation.ts`: normalize and validate form inputs and state transitions.
- `lib/todos/repository.ts`: tenant-and-owner-scoped persistence and metrics.
- `app/todos/actions.ts`: authenticated Server Actions for mutations.
- `app/todos/`: persistent-shell create/edit routes.
- `app/dashboard/todos-workspace.tsx`: full To-do workspace with quick add, filters, search, completion, reopening, and archiving.
- `app/dashboard/todo-widget.tsx`: compact Overview widget for overdue, today, and upcoming personal items.

## User experience

The sidebar gains a **To-do** destination. The workspace provides quick add, Today/Upcoming/Overdue/Completed/Archived views, priority and category filters, search, and inline complete/reopen/archive controls. The Overview widget shows only the current user's most urgent items and links to the full workspace. All surfaces use the existing responsive glass design and dark/light theme tokens.

## Error and security behavior

Server Actions authenticate every request. Repository reads and writes always include `tenant_id` and `owner_user_id`; a valid UUID owned by another user behaves as not found. Invalid fields return accessible field errors. Concurrent or stale state changes return a safe task-unavailable message.

## Verification

Add validation tests, schema/permission boundary tests, PostgreSQL integration coverage for cross-user isolation and lifecycle transitions, UI contract tests, TypeScript, ESLint, production build, and a local database migration/check.
