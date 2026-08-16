# Employee and Task Management Design

## Goal

Add a tenant-isolated employee directory and general office-task workflow to the SISPL CA practice application. Employees receive authenticated access to their own tasks, while administrators and partners manage employees and managers assign and review work.

## Scope

This version includes employee profiles, account provisioning, role-controlled employee management, general task assignment, optional client/compliance links, employee self-service task updates, workload summaries, audit events, and responsive accessible interfaces.

Attendance, leave, payroll, salary, biometric tracking, email invitations, recurring task templates, file attachments, and external notifications are excluded.

## Chosen architecture

Employee identity extends the existing `users`, `user_credentials`, and `tenant_memberships` model. An `employee_profiles` table stores employment-specific attributes without duplicating authentication identity or tenant roles.

General office tasks use a new `office_tasks` table. Existing `work_items` remain dedicated to statutory compliance because their required service, filing period, and deadline semantics do not apply to general work.

## Employee model

An employee profile belongs to exactly one tenant membership and contains:

- a tenant-unique generated employee code;
- designation;
- optional mobile number;
- joining date;
- optional employment notes;
- created and updated timestamps.

Membership status remains the source of truth for active or disabled access. Membership role remains one of `firm_administrator`, `partner`, `manager`, or `associate`.

Administrators and partners may add and edit employees, change roles, enable login access, and disable accounts. Managers may read the directory and employee workload but cannot create employees, change roles, provision credentials, or disable accounts.

Disabling an employee is rejected while open office tasks remain assigned to that employee. Once outstanding tasks are reassigned or completed, disabling the membership also revokes all active sessions atomically.

## Account provisioning

New employee creation accepts name, email, role, designation, mobile number, joining date, and notes. It creates the user, membership, and profile in one transaction.

Login access is provisioned through a separate authenticated action. The server generates a high-entropy temporary password, stores only its salted scrypt hash, marks the credential as requiring a password change, and returns the plaintext exactly once on the success screen. Existing seeded members without credentials use the same action.

Authenticated sessions carry the `mustChangePassword` state. Users requiring a password change may access only the password-change and logout workflows until they successfully replace the temporary password. The new password uses the existing 12–128 character validation and clears the flag atomically.

## Task model

Each office task contains:

- tenant, task id, title, and description;
- assignee and optional reviewer;
- assigning user;
- priority: `low`, `normal`, `high`, or `urgent`;
- status: `todo`, `in_progress`, `waiting`, `review`, `completed`, or `cancelled`;
- due date and optional blocker note;
- optional legal entity and optional compliance work-item links;
- created, updated, and completed timestamps.

The assignee is required and must be an active member of the same tenant. A reviewer is optional, must be active in the tenant, and cannot equal the assignee. When a compliance work item is linked, its legal entity becomes the task client; a conflicting submitted client is rejected. Composite tenant foreign keys enforce these relationships in PostgreSQL.

Task state rules are:

- new tasks start as `todo`;
- assignees may move their tasks among `todo`, `in_progress`, `waiting`, and `review`;
- `waiting` requires a blocker note;
- only administrators, partners, and managers may assign, reassign, complete, cancel, or reopen tasks;
- completed tasks set `completedAt`; reopened tasks clear it;
- all transitions use conditional updates so concurrent requests cannot duplicate a terminal transition.

## Permissions and resource authorization

New permissions are `team:read`, `tasks:read`, `tasks:assign`, and `tasks:update:own`.

- Firm administrators and partners receive all four plus `team:manage`.
- Managers receive `team:read`, `tasks:read`, and `tasks:assign`.
- Associates receive `tasks:read` and `tasks:update:own`.

Application permissions are only the first gate. Repository queries also enforce tenant scope and task ownership. Associates can read only tasks assigned to them. Managers and above can read all tenant tasks. Assignees cannot use self-service transitions on another employee’s task.

## Interface design

The dashboard navigation adds `Tasks` for every authenticated employee and `Team` for users with `team:read`.

The Tasks workspace uses the current SISPL visual system with a modern operational hierarchy:

- KPI cards for due today, overdue, waiting, and review;
- `My tasks`, `Team tasks`, and `All` scopes where permitted;
- search plus status and priority filters;
- a readable desktop register and stacked mobile task cards;
- strong priority/status indicators that do not rely on colour alone;
- a prominent New task action for assigners;
- task detail and edit pages with client/compliance context and audited quick actions.

The Team workspace includes:

- active employees, currently available employees, overdue assignments, and unassigned-capacity KPIs;
- search plus role and status filters;
- employee rows/cards with designation, role, account state, active-task count, overdue count, and workload indicator;
- Add employee, Employee 360, edit, provision access, and disable workflows;
- an Employee 360 task section linking directly to each assignment.

All new screens retain the established 12px minimum text floor, 44px interactive target minimum, visible focus states, semantic labels, associated validation errors, keyboard navigation, and mobile layouts without horizontal scrolling.

## Audit and failure handling

Audit events are written for employee creation, profile or role changes, access provisioning, disabling, task creation, reassignment, editing, self-service status changes, completion, cancellation, and reopening.

Validation returns field-level messages without exposing database details. Duplicate employee emails or codes return safe conflicts. Cross-tenant or inaccessible resources return not found or forbidden outcomes. Account provisioning never logs or persists plaintext temporary passwords.

## Testing and acceptance criteria

Unit coverage verifies employee validation, task validation and transitions, permissions, temporary-password format, and UI structural/accessibility contracts.

PostgreSQL integration coverage verifies tenant isolation, employee creation and disabling safeguards, session revocation, credential provisioning, client/work relationship constraints, associate ownership restrictions, manager assignment, and concurrent terminal transitions.

The feature is accepted when:

1. An administrator can create an employee and provision one-time access.
2. The employee must replace the temporary password before entering the application.
3. A manager can assign a general task with optional client or compliance context.
4. The employee sees only their tasks and can submit progress through Review.
5. A manager can reassign, complete, cancel, or reopen the task.
6. An employee with open tasks cannot be disabled.
7. Every write is tenant-scoped, authorized, audited, and covered by passing tests.
8. Team and task screens are usable at desktop, tablet, and mobile sizes and pass the project’s type, lint, build, and accessibility checks.
