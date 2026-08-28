# Dashboard Resource Scoping Design

## Goal

Make the dashboard show each person the work their role entitles them to see. Every role already declares a resource scope — own and assigned work, team and direct reports, or firm-wide business scope — and the role dialog has always described it as governing visibility, but nothing downstream reads it. The Overview dashboard reports firm-wide numbers to everybody.

## Product boundary

- Scope governs the **dashboard**: its metrics, client list, work list, deadlines, and service health.
- Scope does **not** replace permissions. A destination the viewer cannot open stays closed; scope only narrows what a permitted destination shows.
- The workspaces that already scope keep their own rules: the work and task queues scope by user, attendance and salary by role. This design does not touch them.
- The member list stays firm-wide. It supplies names and initials, not business data, and Employees is separately permission-gated.
- No firm-level toggle. Scoping applies as soon as it ships, which is what the role dialog has always claimed.

## Where the scope comes from

`tenant_memberships.role_key` already holds the role's `legacy_role_key`, so the session carries the resource scope with no new plumbing.

| Session | Scope |
| --- | --- |
| `super_admin` access class, or `firm_administrator` | firm |
| `partner` | firm |
| `manager` | team |
| `associate` | own |

```ts
type DashboardScope =
  | { kind: "firm" }
  | { kind: "team"; userIds: string[] }  // self plus direct reports
  | { kind: "own"; userId: string };
```

`dashboardScopeFor(viewer, directReports)` lives in `lib/dashboard/scope.ts` and is a pure function, so the mapping from role to scope is testable without a database.

## What each scope selects

Work is the anchor. Everything else on the dashboard is derived from the work the viewer can see, so the client list can never disagree with the work list.

- **own** — work items where the viewer is the assignee **or** the reviewer. Reviewing an item is holding it.
- **team** — the same, for the viewer and their direct reports.
- **firm** — every work item in the tenant, exactly as today.

Clients, legal entities, GST registrations and service health follow from the legal entities named by the selected work items. A firm-scoped viewer keeps the current behaviour of listing every client, including those with no open work.

## Direct reports

Direct reports come from `employee_work_profiles.manager_user_id`, one level deep, matching the label the role dialog uses. That column is nullable and, in the current database, 4 of 7 profiles have no manager.

A manager whose reports have never been configured therefore sees only their own work. That is deliberate: the alternative — widening to firm-wide when the reporting line is empty — turns "nobody configured this" into "sees everything", and does so silently. Instead the dashboard says so. When the viewer is team-scoped and has no direct reports, Overview renders a short notice explaining that reporting lines are not configured, linking to Employees. An empty dashboard then reads as configuration rather than a fault.

## Application structure

- `lib/dashboard/scope.ts` — the `DashboardScope` type, `dashboardScopeFor`, and `listDirectReports(database, tenantId, userId)`.
- `lib/dashboard/postgres/repository.ts` — `loadDashboardRecords(database, tenantId, scope)` filters the work query by scope and the client query by the resulting legal entities. `DashboardRecords` does not change shape: the mapped work record carries `ownerName` rather than ids, so filtering must happen in SQL, which is where it belongs.
- `lib/dashboard/postgres/provider.ts` — `getPostgresDashboardDataForTenant(tenantId, scope, now?)` passes the scope through. `getPostgresDashboardData(tenantSlug, ...)`, used only by the fixture path, defaults to firm scope.
- `lib/dashboard/mapper.ts` — unchanged. Every metric already derives from the records it is handed.
- `lib/dashboard/types.ts` — `DashboardData` gains `scope: { kind, hasReports }` so the workspace can render the notice without re-deriving the rule.
- `app/page.tsx` and `app/workspace-route-frame.tsx` — both already hold a session; each resolves the scope once and passes it. The sidebar's practice-health bar scopes with the page rather than contradicting it.
- `app/dashboard/overview-workspace.tsx` — the reporting-line notice, and scope-aware empty copy.

## Error and security behavior

- An absent or unrecognised `roleKey` resolves to `own`, the narrowest scope. Failing closed is the only safe default for a visibility rule.
- Scope filters are composed into the existing tenant-scoped queries, never replacing the tenant predicate. A scope can only narrow what a tenant boundary already allows.
- `listDirectReports` is tenant-scoped, so a manager cannot inherit reports from another firm.
- Nothing outside the tenant is ever loaded and then filtered in memory: an associate's request does not hold firm-wide rows at any point.

## Verification

Unit tests, no database required:

- `dashboardScopeFor` returns firm for Super Admin, `firm_administrator` and partner; team for manager; own for associate; and own for an unknown or missing role.
- A team scope with no direct reports contains only the viewer.
- The mapper produces correct metrics from a scoped record set — the counts follow the records, so scoping cannot leave a metric stale.
- `page.tsx` and `workspace-route-frame.tsx` both resolve a scope rather than calling the provider with a tenant alone.

Integration tests, against PostgreSQL, written as their own test so an unrelated pre-existing failure cannot mask them:

- An associate's records contain only work they are assigned or reviewing, and only the clients those items name.
- A manager's records contain their own work and their direct reports', and not a peer's.
- A partner's records are unchanged from the unscoped load.
- A manager with no configured reports receives their own work only, and never another member's.

## Out of scope

Per-user dashboard customisation, scoping the workspaces that already have their own rules, and any change to how permissions gate destinations.
