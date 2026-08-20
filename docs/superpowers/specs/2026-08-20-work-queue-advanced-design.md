# Work Queue Advanced Design

**Approved:** 2026-08-20

## Goal

Turn the `?workspace=work` delivery workspace from a firm-wide read-only triage list into a personal, server-driven work queue. Authorized users can scope the queue to their own delivery and review load, act on many obligations at once, see committed effort against configured capacity, and compare logged time against a budgeted estimate.

## Approved decisions

- The workspace serves three scopes: work assigned to the viewer, work the viewer reviews, and the whole firm. The page is named "My work" and now behaves that way.
- Filter, scope, sort, and view state live in the query string. Every view is bookmarkable and shareable.
- The firm ships a fixed set of preset views as links. Users cannot save named views in this milestone.
- A work item's budgeted effort is copied from the service standard when the item is created, and is editable per item afterwards. Later edits to the service standard never rewrite an existing work item budget.
- Capacity load is measured in remaining budgeted minutes, not in job counts.
- Available capacity is derived from configured shift data. It is never a hard-coded constant.
- Bulk actions cannot mark work items completed. Completion remains a deliberate act on Work 360.
- This module measures and redistributes committed effort. It does not create invoices, calculate fees, or replace the planned billing milestone.

## Roles and permissions

- `dashboard:read`: required to open the workspace in any scope, including the firm scope.
- `work:write`: required for every bulk action.
- Every repository query and Server Action is scoped by the authenticated tenant. Scope selection is resolved server-side from the session user; the client never supplies its own viewer identity.
- The firm scope is a read breadth, not an elevated permission. A user who can read the dashboard can already read firm-wide work today.

## Domain model

### Service standard effort

`service_catalog` gains `standard_minutes`, a nullable integer constrained between 1 and 100000. It records the tenant's own estimate of how long one occurrence of that service takes. It is maintained in Settings → Service Management. Null means the firm has not estimated that service.

### Work item budget

`work_items` gains `budget_minutes`, a nullable integer constrained between 1 and 100000.

`createWorkItem` copies the current `service_catalog.standard_minutes` for the matching service code into `budget_minutes` at creation time. The copy happens in the repository, not as a database default and not as a display-time join. A work item budget is therefore a snapshot of the standard as it stood when the obligation was raised. This mirrors the existing client package assignment rule: later catalogue edits never rewrite an existing agreement.

`updateWorkItem` accepts an explicit `budget_minutes` override. Clearing the field returns the item to an unbudgeted state.

Existing rows are not backfilled. Both columns stay null until a user sets them.

### Absent budgets

A null budget is rendered as "no budget". It is never rendered, summed, or defaulted as zero. Zero would be indistinguishable from a genuinely free member in the capacity view, which is the exact misreading this feature exists to prevent.

### Indexes

- `time_entries_work_idx` on `(tenant_id, work_item_id)`. Required: `time_entries` currently indexes `(tenant_id, employee_user_id, entry_date)` and `(tenant_id, legal_entity_id, entry_date)` only, so the logged-time aggregate would otherwise scan every time entry in the tenant.
- `work_items_assignee_due_idx` on `(tenant_id, assignee_id, status, internal_due_date)`.
- `work_items_reviewer_idx` on `(tenant_id, reviewer_id, status)`.

## Query boundary

A new module `lib/work/queue.ts` owns every read this workspace performs. Each function takes `(database, tenantId, viewerId, params)` and carries `tenant_id` in its `WHERE` clause.

The shared `DashboardData` blob no longer supplies this workspace. `lib/dashboard/mapper.ts` keeps building `data.work` for the overview and client workspaces that still consume it, but the work workspace reads its own queries so its list and its counters cannot disagree.

### `listWorkQueue`

Returns the filtered, scoped, sorted job list. Parameters are parsed from the query string:

| Parameter | Values | Default |
|---|---|---|
| `scope` | `mine`, `reviewing`, `firm` | `mine` |
| `filter` | `All`, `Overdue`, `Due this week`, `Critical`, `At risk`, `Waiting`, `Review` | `All` |
| `q` | free text over client, service, owner | empty |
| `sort` | `due`, `progress`, `client` | `due` |
| `view` | `list`, `board`, `capacity` | `list` |
| `owner` | member id | unset |
| `service` | service code | unset |

`scope` maps to `assignee_id = viewerId`, `reviewer_id = viewerId`, or no owner predicate. Filtering, searching, and sorting are performed in SQL. Unknown or malformed parameter values fall back to the default rather than erroring.

`owner` applies only when `scope` is `firm`. Under `mine` or `reviewing` the owner is already fixed to the viewer, so an `owner` value is ignored rather than intersected.

The default scope is `mine` for every role, including firm administrators and partners who may hold no assigned work of their own. When the `mine` scope is empty, the empty state says so plainly and links to the same view under the firm scope. A partner opening a page titled "My work" and seeing the whole firm's queue would be a worse default than an empty first screen with an obvious next step.

Each row carries the existing display fields plus `internalDueDate`, `missingItemCount`, `budgetMinutes`, and `loggedMinutes`, the last summed from `time_entries` for that work item.

### `getCapacityLanes`

Returns one lane per active tenant member holding an employee work profile, across a four-week horizon starting with the current week.

Per lane, per week:

- Bucket key is the week containing `COALESCE(internal_due_date, statutory_due_date)`. Recurrence already sets `internal_due_date` to `statutory_due_date` minus the schedule's internal lead days, so generated work buckets by the date the firm manages to. Manually created items may have no internal date and fall back to the statutory one.
- `load` is the sum of `budget_minutes * (100 - progress) / 100` over that member's open items in the bucket. Remaining effort, not total effort: a job at 90% stops consuming a full job's capacity.
- `available` is `shift_types.full_day_minutes` multiplied by the number of working days in `shift_types.working_week_mask`. The shift comes from `employee_work_profiles.shift_type_id`, falling back to the tenant's default shift when the profile has none, consistent with the documented fallback on that column.
- `unbudgetedCount` is the number of that member's open items in the bucket with a null budget.

The four-week horizon is chosen to match data that actually exists: the recurrence job generates work with a 45-day lookahead, so all four weeks are populated.

### `getQueueTotals`

Returns the four counters shown as KPI cards, computed under the active scope and filters so the headline numbers always describe the list beneath them.

### Deliberate exclusions

- **Approved leave is not subtracted from available capacity.** A member on leave for a week still shows a full week of availability. Correcting this requires deciding how half-days and pending-versus-approved requests count, which is a separate design. `available` is computed in one function so this is a single point of change later.
- **Board columns are not drag-and-drop.** Status changes happen through bulk actions or Work 360.

## Bulk actions

Selecting one or more rows raises an action bar offering reassign, set reviewer, shift internal due date, and change status. All four require `work:write`.

### Constraint handling

Three existing database checks bound what a batch may do:

- `work_items_separation_check` — assignee and reviewer must differ. Reassigning to a member who already reviews a selected item must skip that item.
- `work_items_deadline_order_check` — internal due date must not exceed the statutory due date. A relative shift may violate this on some selected rows.
- `work_items_completed_state_check` — completion requires `progress = 100` and `missing_item_count = 0`. `Completed` is therefore excluded from the bulk status options entirely.

### Partial failure

The Server Action validates the entire selection before writing anything. It returns the count it will apply and an itemised list of what it will skip and why, in the user's terms — for example, "2 of 14 skipped: Nisha S. already reviews these items." The valid subset is then applied in a single transaction.

Nothing is skipped silently, and no batch is left half-applied.

### Audit

Every changed work item writes its own `audit_events` row, matching the per-change pattern already used by `createWorkItem`, `updateWorkItem`, and `completeWorkItem`. A bulk action does not collapse into a single opaque event, so Work 360 history stays complete and per-item.

## Interface

The workspace renders as a server component. A client island holds only row-selection state and the bulk action dialogs.

Layout, top to bottom:

1. Page title and Create work item action, unchanged.
2. Scope tabs: Assigned to me, I review, Whole firm.
3. Four KPI cards, scoped to the active tab.
4. Preset links: My overdue, Awaiting client, Ready for my review, Over budget, Unassigned. Each is a plain link to a fully specified query string. "Over budget" selects items where logged minutes exceed budgeted minutes.
5. Existing filter segment and text search.
6. View toggle — Deadline list, Status board, Capacity — and the sort control.

### Row composition

Each row gains the internal due date beside the statutory date, a missing-items chip sourced from `missing_item_count`, and a burn indicator comparing logged to budgeted time that reads as over-budget past 100% and as "no budget" when unbudgeted.

Rows are currently a single anchor wrapping all row content. A checkbox cannot be nested inside an anchor. The row therefore becomes a grid container holding a checkbox and a link scoped to the client and service block. `WorkRow` is rewritten rather than extended.

### Capacity view

One lane per member, four week columns. Each cell shows load against available capacity, an overload state past 100%, and the unbudgeted count where budgets are missing. A lane with unbudgeted work reads as unknown rather than free.

Selecting a cell navigates to the deadline list filtered to that member and that week, so the view both diagnoses the imbalance and offers the correction.

### Accessibility

Scope tabs and view toggles follow the existing `aria-pressed` segment control pattern. Every selection checkbox carries an accessible label naming its client and service. Bulk action results are announced through a live region.

## Testing

### Unit — `tests/*-unit.test.ts`, run by `npm run test:unit`

- Query string parsing: every parameter round-trips, and unknown values fall back to defaults.
- Capacity arithmetic: available minutes from `full_day_minutes` and the working week mask, remaining-load weighting by progress, and the unbudgeted count.
- Burn percentage, including null budgets and zero logged time.
- Bulk pre-validation against all three constraints, asserting the skip reasons.

### Integration — `tests/postgres-integration.test.ts`

- Tenant isolation across all three queries: a second tenant's work items appear in no scope, including the firm scope.
- Scope correctness: assignee scope and reviewer scope return disjoint, correct sets.
- Budget snapshot immutability: editing `service_catalog.standard_minutes` after creation leaves existing `work_items.budget_minutes` unchanged, while a newly created item picks up the new standard.
- Bulk reassign with a partially invalid selection applies the valid subset, skips the rest with reasons, and writes one audit event per changed item.

## Out of scope

- User-saved named views.
- Leave-adjusted capacity.
- Drag-and-drop status changes on the board.
- Bulk completion of work items.
- Any billing, invoicing, or fee calculation derived from logged time.

## Note on EXECUTION_PLAN.md

`EXECUTION_PLAN.md` lists recurrence as still planned. It is implemented, in `lib/compliance/recurrence.ts` and `scripts/jobs/recurrence.ts`, with a 45-day lookahead. That checkpoint section should be corrected separately from this work.
