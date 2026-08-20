# Task Queue Advanced Design

**Approved:** 2026-08-21

## Goal

Turn the Tasks workspace from a client-filtered list into a server-driven, priority-aware task queue with real ownership scopes, shareable views, bulk triage, and estimate-versus-actual effort.

## Approved decisions

- Scopes are Assigned to me, I review, Assigned by me, and Whole firm. The ambiguous "Team tasks" scope, which meant "everyone except me", is removed.
- Filter, scope, priority, sort, and view state live in the query string. Every view is bookmarkable and shareable.
- Priority ranks within an urgency group: an urgent overdue task outranks a low overdue task.
- A task's estimate is typed per task. Office tasks are not catalogue-driven, so there is no service standard to snapshot and nothing to go stale.
- Bulk actions cannot complete or cancel a task. Both are terminal decisions with their own audited repository actions.
- Time arithmetic shared with the work queue moves to `lib/scheduling/capacity.ts`. Task-specific parameters, queries, and bulk rules stay in `lib/tasks/`.
- **The existing access floor is preserved unchanged.** Managers, partners, and firm administrators see every task; everyone else sees only tasks assigned to them. Widening the floor to include tasks the viewer reviews was proposed and deliberately not taken; it remains an open decision.

## Roles and permissions

- `tasks:read`: required to open the workspace.
- `tasks:assign`: required for every bulk action.
- Scope is resolved server-side from the session user. The client never supplies its own viewer identity.
- The `firm` scope is clamped to viewers satisfying `canManageAllTasks`. A hand-edited query string cannot widen access.
- Because the access floor is unchanged, the `reviewing` and `assigned` scopes can only return rows for viewers who already see firm-wide tasks. The workspace therefore hides those tabs from other viewers rather than showing a permanently empty tab.

## Domain model

### Task estimate

`office_tasks` gains `estimate_minutes`, a nullable integer constrained between 1 and 100000. It is entered on the assign/edit task form. Existing rows are not backfilled.

A null estimate renders as "no estimate". It is never rendered, summed, or defaulted as zero, because zero is indistinguishable from a genuinely free member in the capacity view.

### Indexes

- `time_entries_task_idx` on `(tenant_id, office_task_id)`. Required: `time_entries` indexes `work_item_id` but not `office_task_id`, so the logged-time aggregate would scan every time entry in the tenant.
- `office_tasks_reviewer_idx` on `(tenant_id, reviewer_id, status)`.
- `office_tasks_assigner_idx` on `(tenant_id, assigned_by_user_id, status)`.

### Shared time arithmetic

`lib/work/capacity.ts` moves to `lib/scheduling/capacity.ts` unchanged. `weekStartKey`, `weeklyAvailableMinutes`, `remainingBudgetMinutes`, `capacityHorizonWeeks`, and `burnPercentage` are domain-agnostic. Work-queue importers and tests are updated; the existing tests prove the move was clean.

## Query boundary

`lib/tasks/queue.ts` owns every read the workspace performs, taking `(database, tenantId, viewerId, viewerRoleKey, params, todayKey)`. Every query carries `tenant_id` in its `WHERE` clause and applies the access floor before any scope predicate.

### Parameters

| Parameter | Values | Default |
|---|---|---|
| `scope` | `mine`, `reviewing`, `assigned`, `firm` | `mine` |
| `status` | `Active`, `Waiting`, `Review`, `Completed`, `Cancelled` | `Active` |
| `priority` | `all`, `urgent`, `high`, `normal`, `low` | `all` |
| `q` | free text over title, assignee, client, work label | empty |
| `sort` | `due`, `priority`, `assignee` | `due` |
| `view` | `list`, `board`, `capacity` | `list` |
| `owner` | member id | unset |
| `estimate` | `over` | unset |

Unknown or malformed values fall back to the default rather than erroring. `owner` applies only under the `firm` scope; under the other scopes the owner is already fixed, so an owner value is ignored rather than intersected.

### Ordering

`sort=due` orders by due date, then by priority rank, so ties inside a day resolve by urgency. `sort=priority` orders by priority rank first. Priority rank is `urgent` 0, `high` 1, `normal` 2, `low` 3.

### Capacity

One lane per active member holding an employee work profile, over a four-week horizon from the current week. Load is the sum of `estimate_minutes` for that member's active tasks bucketed by due week; availability is `shift_types.full_day_minutes` multiplied by the working days in `working_week_mask`, with the tenant default shift as fallback.

Office tasks carry no progress percentage, so load is not discounted part-way: a task counts fully until it leaves the active statuses. Each lane also reports `unestimatedCount`, so a lane with unestimated work reads as unknown rather than free.

## Bulk actions

Selecting rows offers reassign, set reviewer, change priority, shift due date, and change status. All require `tasks:assign`.

### Constraint handling

Four database checks bound what a batch may do:

- `office_tasks_reviewer_separation_check` — reviewer must differ from assignee.
- `office_tasks_waiting_note_check` — a task in `waiting` must carry a non-empty blocker note. Bulk status to `waiting` skips tasks with no recorded note.
- `office_tasks_completed_state_check` — `completed` requires `completed_at`, and any other status requires it to be null. `completed` is therefore excluded from bulk status.
- `cancelled` is excluded too: cancellation is a deliberate, separately audited act.

### Partial failure

The Server Action validates the whole selection before writing anything, returns the count it will apply and an itemised list of what it will skip and why, then applies the valid subset in one transaction. Nothing is skipped silently, and no batch is left half-applied.

### Audit

Every changed task writes its own `audit_events` row, matching the per-change pattern already used by `createOfficeTask` and `updateOfficeTask`. A bulk action never collapses into one opaque event.

## Interface

The workspace renders as a server component with a client island holding row-selection state and the bulk action dialogs.

1. Page title and Assign task action.
2. Scope tabs, hiding `reviewing` / `assigned` / `firm` from viewers who cannot manage all tasks.
3. Four KPI cards scoped to the active tab.
4. Preset links: My overdue, Urgent and overdue, Awaiting me, Ready for my review, Over estimate.
5. Status segment, priority select, and search.
6. View toggle — Deadline list, Status board, Capacity — and the sort control.

### Rows

Each row gains the blocker note, the reviewer, who assigned it, and a burn indicator comparing logged to estimated time that reads as over-estimate past 100% and as "no estimate" when unestimated.

Rows are currently a single anchor. A checkbox cannot nest inside an anchor, so the row becomes a grid container holding a checkbox and a link scoped to the title block.

### Urgency grouping

Overdue, Due today, Due this week, Later — the same partition the work queue uses, with priority ranking inside each group.

## Testing

### Unit

- Query-string parsing: every parameter round-trips; unknown values fall back to defaults; `owner` is ignored outside the firm scope.
- Priority rank ordering, including ties.
- Burn percentage with null estimates.
- Bulk pre-validation against reviewer separation, the waiting-note rule, and the completed/cancelled exclusions.
- The scope tabs available to a viewer match what the access floor can actually return.

### Integration

- Tenant isolation across every scope, including `firm`.
- The access floor holds: a non-managing viewer cannot widen scope through the query string.
- Bulk reassign with a partially invalid selection applies the valid subset, skips the rest with reasons, and writes one audit event per changed task.
- Capacity lanes derive availability from the configured shift and count unestimated work.

## Out of scope

- Widening the access floor to tasks the viewer reviews. Open decision.
- Task dependencies, recurrence, and drag-and-drop status changes.
- Bulk completion or cancellation.
- Any billing derived from logged task time.
