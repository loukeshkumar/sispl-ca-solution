# Local PostgreSQL Dashboard Integration Design

## Objective

Use the user-provided PostgreSQL database on the local PC as the authoritative data source for the SISPL Clients and Work dashboard views, while preserving the existing Cloudflare Sites path as a demonstration mode.

The initial integration is intentionally read-only from the application UI. Schema creation, migrations, and deterministic development seeding are included; client/work creation and editing workflows are not.

## Current state

- The application has one client-rendered dashboard route.
- Client, work, KPI, deadline, and account values are hard-coded in `app/page.tsx`.
- The active Drizzle schema is empty and configured for SQLite/D1.
- A PostgreSQL foundation SQL file exists but is not wired to application code.
- Optional ChatGPT identity helpers exist but are unused.
- The Sites manifest has no D1 or R2 bindings.
- The checkout has no Git metadata, so changes cannot be committed in this workspace.

## Selected approach

Use one source tree with two explicit data modes:

- `postgres`: local Next.js/Node runtime reads PostgreSQL.
- `demo`: the existing Sites runtime renders deterministic demonstration data without trying to reach the local PC.

`SISPL_DATA_SOURCE` selects the mode. Local `.env.local` selects `postgres` and supplies `DATABASE_URL`. The hosted Sites environment defaults to `demo` until a reachable production PostgreSQL service and Cloudflare Hyperdrive binding are deliberately configured.

If `SISPL_DATA_SOURCE=postgres`, a missing or unreachable database is an error. The application must not silently fall back to demonstration data.

## Alternatives considered

### Replace Sites with a Node-only deployment

This makes PostgreSQL integration straightforward, but discards the existing Sites lifecycle and hosting configuration. It is not selected because local database adoption does not require removing that path.

### Add a separate local API service

This keeps the Worker front end isolated from PostgreSQL, but introduces a second server, CORS, additional startup steps, and duplicated configuration. It is unnecessary for the current read-only dashboard milestone.

## Runtime and package scripts

Preserve the current Sites scripts. Add explicit local scripts:

- `dev:local`: run the standard Next.js development server on Node.
- `build:local`: build the standard Next.js application.
- `start:local`: serve the local production build.
- `db:generate`: generate PostgreSQL Drizzle migrations.
- `db:migrate:local`: load `.env.local` and apply migrations.
- `db:seed:local`: load `.env.local` and run the deterministic development seed.
- `db:check:local`: verify connection, database name, and required tables without printing credentials.
- `db:setup:local`: migrate, seed, and check in sequence.

The project requires Node 22.13 or newer, so Node's environment-file support can load `.env.local` without another secrets package.

## Configuration and connection handling

`.env.local` remains ignored by Git and contains:

- `SISPL_DATA_SOURCE=postgres`
- `DATABASE_URL`, set to the user-provided local connection URL.

No committed example contains the supplied username or password. `.env.example` documents only placeholders and the required variable names.

A server-only PostgreSQL connection module will:

1. Validate that `DATABASE_URL` exists in PostgreSQL mode.
2. Parse the URL.
3. Remove the nonstandard `connection_limit` and `pool_timeout` query parameters before passing the URL to `pg`.
4. Apply them as `pg.Pool` options: maximum 30 connections and a 30-second connection timeout for the supplied settings.
5. Reuse a single pool during local development to avoid creating pools during hot reload.
6. Avoid logging the connection string or password.

Drizzle uses the `node-postgres` adapter. PostgreSQL imports stay in server-only modules and are loaded only by the PostgreSQL provider.

## Application structure

### Server boundary

`app/page.tsx` becomes an asynchronous server component. It resolves the selected data provider and loads one `DashboardData` object. The page is dynamic in PostgreSQL mode.

### Client boundary

The existing interactive JSX moves to a client component receiving `DashboardData` as serializable props. Existing local interactions remain client-side:

- navigation selection;
- work status filtering;
- work search;
- client risk filtering;
- client search;
- selected-client detail panel;
- mobile menu behavior.

The hard-coded arrays and hard-coded aggregate figures are removed from the UI component.

### Provider boundary

A small provider interface exposes `getDashboardData(tenantId)`.

- The PostgreSQL provider issues tenant-scoped Drizzle queries.
- The demonstration provider returns deterministic fixture data.
- Both providers pass through the same mapping and validation boundary so the UI receives one stable shape.

The active development tenant is selected by an explicit seeded tenant slug, not by accepting an arbitrary tenant identifier from the browser.

## PostgreSQL schema

Drizzle becomes the canonical schema definition with PostgreSQL dialect and reviewed generated migrations.

### `tenants`

- identity, legal/display names, slug, status, timestamps;
- unique tenant slug.

### `users`

- identity, email, full name, status, created timestamp;
- unique normalized email.

### `tenant_memberships`

- tenant, user, role, membership status, created timestamp;
- unique tenant/user membership.

### `client_groups`

- tenant, name, relationship owner, risk status, health score, timestamps;
- health score constrained to 0-100;
- unique tenant/name.

### `legal_entities`

- tenant, client group, legal name, entity type, masked PAN display value, city, relationship start date, status, timestamps;
- unique legal name within a tenant/client group.

Only fictitious masked PAN values are seeded. Storing or encrypting real statutory identifiers is outside this milestone.

### `client_services`

- tenant, legal entity, service key, status;
- unique tenant/entity/service.

### `registrations`

- tenant, legal entity, registration type, status;
- used for GST registration counts without seeding real GST identifiers.

### `work_items`

- tenant, legal entity, service key, period key, status, statutory/internal due dates, assignee, reviewer, blocker note, progress, timestamps;
- progress constrained to 0-100;
- unique tenant/entity/service/period;
- indexed by tenant, status, and statutory due date.

### `audit_events`

- tenant, actor, resource type/id, action, reason, correlation id, occurrence timestamp;
- retained as the foundation for later mutations and auditability.

All tenant-owned tables carry `tenant_id`; every application query includes tenant scope.

## Seed behavior

The seed creates one development firm, its team, five fictitious client entities, their services and registration counts, and four work items corresponding to the current UI examples.

The seed uses stable identifiers and unique constraints inside a transaction. Running it multiple times produces the same row counts and updates safe display fields without duplicating entities.

Dashboard KPIs are computed from seeded records rather than preserving unrelated hard-coded totals. This ensures cards, filters, tables, and detail panels describe the same database state.

## Data mapping

The PostgreSQL repository returns normalized records. A mapper creates the existing UI concepts:

- client initials, owner initials, and masked identity display;
- service chips and GST registration counts;
- health/risk labels;
- next obligation and missing-item summary;
- work status, progress, owner, due date, and blocker note;
- KPI totals and deadline radar rows.

Dates remain real PostgreSQL dates. Human-readable labels such as `Today`, `Tomorrow`, and `2 days overdue` are derived in the mapping layer using the application timezone, not stored as labels.

## Error handling

- Configuration errors identify the missing variable without displaying secrets.
- Connection/query errors are logged server-side in redacted form.
- The user sees a concise database-unavailable state with a retry action and local setup guidance.
- PostgreSQL mode never substitutes demo data after a connection or query failure.
- The connection check reports only host, port, database name, server version, and required-table status.

## Security boundaries

- The supplied credential exists only in ignored `.env.local`.
- Queries use Drizzle/parameterized SQL.
- Every repository method requires an explicit tenant id.
- Only fictitious masked PAN values are seeded.
- No PAN, GSTIN, Aadhaar, portal password, OTP, DSC key, or banking secret is logged or committed.
- This local read-only milestone does not claim production authentication or authorization. Database-backed write actions remain disabled/unimplemented until tenant membership and RBAC enforcement are added.

## Testing strategy

Implementation follows test-first development.

### Unit tests

- connection URL parsing removes pool-only parameters and maps their values correctly;
- invalid or missing configuration fails with redacted messages;
- dashboard mapping derives initials, risk labels, due labels, and KPI totals;
- provider selection never silently falls back in PostgreSQL mode;
- query-building/repository boundaries require tenant scope.

### Integration tests

- connect to the configured local database and execute `select 1`;
- apply the generated migration;
- run the seed twice and confirm idempotent row counts;
- load the seeded tenant dashboard and verify both clients and work items are present;
- confirm a different tenant id cannot read the seeded tenant's records.

### Existing application validation

- TypeScript check passes, including Cloudflare Worker types;
- focused ESLint check passes;
- local Next.js production build passes;
- Sites/Vinext build remains valid in demonstration mode;
- the existing rendered metadata test is retained or updated only if metadata behavior intentionally changes.

Browser visual QA is outside this task unless requested.

## Compatibility and deployment

Local development runs standard Next.js on Node and can reach `localhost:5432`.

The existing Sites build remains demonstration-only without PostgreSQL secrets. A hosted PostgreSQL rollout is a separate milestone because Cloudflare Workers cannot reach a database bound to a developer PC. That rollout requires a reachable PostgreSQL host, Cloudflare Hyperdrive, hosted secrets, and production authentication/tenant authorization.

## Acceptance criteria

1. The local database connection succeeds without printing the credential.
2. A migration creates the required schema in the configured database.
3. Repeated seeding does not duplicate data.
4. The Clients view renders records from PostgreSQL.
5. The Work dashboard renders records and KPIs derived from PostgreSQL.
6. Filters, searches, client selection, and responsive menu behavior continue working.
7. PostgreSQL failures produce a safe visible error and never switch to demo data.
8. Tenant-scoping integration tests pass.
9. Type checking, focused linting, local build, Sites demonstration build, and application tests pass or any environment-specific blocker is reported with evidence.
10. No secret or real statutory identifier is added to tracked source files.

## Non-goals

- Client or work-item create/update/delete UI.
- Production authentication, invitations, or RBAC enforcement.
- Real statutory identifiers or documents.
- Billing, filing, reminder, calendar, or portal workflows.
- Production PostgreSQL hosting or Hyperdrive provisioning.
