# Local PostgreSQL Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make PostgreSQL the authoritative read-only dashboard source during local Node development while retaining deterministic demonstration data for Cloudflare Sites.

**Architecture:** An async server page selects either a demo provider or a lazily loaded PostgreSQL provider and passes one serializable `DashboardData` contract to the existing interactive client dashboard. PostgreSQL access stays in server-only modules, uses Drizzle's node-postgres adapter, and requires an explicit seeded tenant id at every repository boundary.

**Tech Stack:** Next.js 16, React 19, TypeScript 5.9, PostgreSQL, `pg`, Drizzle ORM/Kit, Node test runner through `tsx`, Cloudflare Sites/Vinext.

## Global Constraints

- `SISPL_DATA_SOURCE=postgres` must never silently fall back to demo data.
- PostgreSQL credentials remain only in ignored `.env.local`; committed examples contain placeholders.
- All tenant-owned database queries require and apply `tenant_id`.
- Seed data uses only fictitious masked PAN display values and stable identifiers.
- Local database integration is read-only in the application UI.
- Existing Sites scripts, hosting manifest, Worker-compatible ESM output, UI interactions, and demonstration mode remain valid.
- Node.js 22.13.0 or newer is required.
- No production authentication, mutations, real statutory identifiers, D1, R2, or Hyperdrive are added in this milestone.

---

### Task 1: Data contract, mapper, configuration, and provider selection

**Files:**
- Create: `lib/dashboard/types.ts`
- Create: `lib/dashboard/fixtures.ts`
- Create: `lib/dashboard/mapper.ts`
- Create: `lib/dashboard/config.ts`
- Create: `lib/dashboard/provider.ts`
- Create: `tests/dashboard-unit.test.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Produces: `DashboardData`, `DashboardRecords`, `mapDashboardRecords(records, now)`, `readPostgresConfig(env)`, and `getDashboardDataForConfiguredSource(env)`.
- The provider selector imports `./postgres/provider` only when the selected source is `postgres`; omitted/`demo` returns mapped fixtures.

- [ ] **Step 1: Add the test runner and write failing contract tests**

  Add `tsx` as a development dependency and a `test:unit` script using `tsx --test tests/*-unit.test.ts`. Write tests asserting that pool-only URL parameters are removed and converted to pool options, missing PostgreSQL configuration throws a redacted error, due labels/initials/KPIs are derived by the mapper, and demo/provider selection never catches PostgreSQL failures.

- [ ] **Step 2: Run the focused tests and confirm RED**

  Run `npm run test:unit`. Expected: failure because `lib/dashboard/config.ts`, `mapper.ts`, and `provider.ts` do not exist.

- [ ] **Step 3: Implement the shared contract and minimal pure behavior**

  Define serializable client, work item, KPI, deadline, practice, and dashboard types. Move representative raw records into fixtures, implement timezone-stable mapping with an injectable `Date`, parse `SISPL_DATA_SOURCE`, strip `connection_limit`/`pool_timeout`, map them to numeric pool settings, and choose the provider without a catch-based fallback.

- [ ] **Step 4: Run tests and typecheck for GREEN**

  Run `npm run test:unit` and `npx tsc --noEmit`. Expected: all Task 1 tests pass and TypeScript reports no errors.

### Task 2: PostgreSQL schema, connection pool, and tenant-scoped repository

**Files:**
- Replace: `db/schema.ts`
- Replace: `db/index.ts`
- Modify: `drizzle.config.ts`
- Create: `lib/dashboard/postgres/pool.ts`
- Create: `lib/dashboard/postgres/repository.ts`
- Create: `lib/dashboard/postgres/provider.ts`
- Create: `tests/postgres-boundaries-unit.test.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Consumes: `DashboardRecords`, `PostgresConfig`, `mapDashboardRecords`.
- Produces: `getPostgresPool()`, `loadDashboardRecords(db, tenantId)`, and PostgreSQL `getDashboardData(tenantId)`.

- [ ] **Step 1: Install PostgreSQL dependencies and write failing repository-boundary tests**

  Add `pg` and `@types/pg`. Test that `loadDashboardRecords` rejects an empty tenant id before issuing a query and that the PostgreSQL provider passes the explicit seeded tenant id into the repository.

- [ ] **Step 2: Run tests and confirm RED**

  Run `npm run test:unit`. Expected: failure because the pool/repository/provider modules do not exist.

- [ ] **Step 3: Implement the schema and server-only PostgreSQL boundary**

  Define `tenants`, `users`, `tenantMemberships`, `clientGroups`, `legalEntities`, `clientServices`, `registrations`, `workItems`, and `auditEvents` with PostgreSQL UUID/date/timestamp columns, unique constraints, health/progress checks, tenant/status/due indexes, and foreign keys. Configure Drizzle Kit for PostgreSQL, create a development-reused `pg.Pool`, and query all dashboard rows with a required `tenantId` predicate.

- [ ] **Step 4: Implement normalized repository mapping and provider**

  Join entities to owners, services, registrations, and current work, return normalized records, and map them through the shared mapper. Keep imports under `lib/dashboard/postgres/` server-only and load the provider dynamically.

- [ ] **Step 5: Run tests and typecheck for GREEN**

  Run `npm run test:unit` and `npx tsc --noEmit`. Expected: all unit tests pass and TypeScript reports no errors.

### Task 3: Migration, idempotent seed, connection check, and database integration tests

**Files:**
- Create: generated SQL under `drizzle/`
- Create: `scripts/db/seed.ts`
- Create: `scripts/db/check.ts`
- Create: `scripts/db/test-integration.ts`
- Create: `.env.example`
- Modify: `package.json`
- Modify: `LOCAL_SETUP.md`

**Interfaces:**
- Consumes: PostgreSQL schema, config parser, connection pool, seeded tenant id, and repository.
- Produces: `db:migrate:local`, `db:seed:local`, `db:check:local`, `db:setup:local`, and `test:integration` commands.

- [ ] **Step 1: Write the integration assertions before database setup code**

  The integration runner must execute `select 1`, load the seeded tenant twice without changed row counts, assert five clients/four work items, and assert a different tenant id returns no rows. It exits with a clear configuration error when explicitly invoked without `DATABASE_URL`.

- [ ] **Step 2: Run the integration test and confirm RED**

  Run `npm run test:integration`. Expected: failure because the database scripts and/or local database configuration do not yet exist.

- [ ] **Step 3: Generate and inspect the PostgreSQL migration**

  Run `npm run db:generate`; inspect that the SQL creates all nine tables, constraints, foreign keys, and indexes and contains no secrets or real identifiers.

- [ ] **Step 4: Implement deterministic transactional seeding**

  Upsert one firm, four team members, five client groups/entities, services, GST registration rows, and four current work items using stable UUIDs and unique conflict targets. Running the seed repeatedly must update safe display fields without duplicating rows.

- [ ] **Step 5: Implement a redacted connection/table check**

  Parse `.env.local` through Node's `--env-file`, report only host, port, database name, server version, and required-table presence, and never print the URL, user password, PAN beyond its already masked display value, or other secrets.

- [ ] **Step 6: Verify against PostgreSQL when configuration exists**

  Run `npm run db:setup:local` followed by `npm run test:integration`. Expected: migration succeeds, seed remains idempotent, the selected tenant sees five clients/four work items, and a foreign tenant sees none. If `.env.local` is absent, record this as the sole external validation blocker and continue with non-database checks.

### Task 4: Server/client page split and safe database failure UI

**Files:**
- Replace: `app/page.tsx`
- Create: `app/dashboard-client.tsx`
- Create: `app/dashboard-error.tsx`
- Modify: `app/globals.css`
- Create: `tests/page-boundary-unit.test.ts`

**Interfaces:**
- Consumes: `getDashboardDataForConfiguredSource(process.env)` and `DashboardData`.
- Produces: async server page, serializable client dashboard props, and a retryable safe database-unavailable state.

- [ ] **Step 1: Write failing page-boundary tests**

  Assert the client module contains no hard-coded client/work fixture arrays or PostgreSQL imports, the server page loads the configured provider, and error serialization exposes setup guidance without a connection URL or password.

- [ ] **Step 2: Run the focused test and confirm RED**

  Run `npm run test:unit`. Expected: failure because the page is still a client-only hard-coded dashboard.

- [ ] **Step 3: Move interactivity behind a serializable prop boundary**

  Move existing navigation, search, risk/status filters, client selection, and mobile-menu state into `dashboard-client.tsx`; replace all displayed arrays, counts, practice/team values, work queue values, and client metrics with `DashboardData` props.

- [ ] **Step 4: Add the async server loader and safe error state**

  Make `app/page.tsx` async and dynamic, load the selected provider, and render a retry action plus local setup guidance on PostgreSQL configuration/connection/query errors. Do not catch demo rendering errors as database failures and do not substitute fixtures in PostgreSQL mode.

- [ ] **Step 5: Run tests and both type/build checks**

  Run `npm run test:unit`, `npx tsc --noEmit`, and `npm run build:local`. Expected: tests and typecheck pass and the local Next production build completes without requiring a database during build.

### Task 5: Documentation, Sites compatibility, and final verification

**Files:**
- Modify: `README.md`
- Modify: `LOCAL_SETUP.md`
- Modify: `tests/rendered-html.test.mjs`
- Modify: `app/layout.tsx`

**Interfaces:**
- Consumes: completed dual-mode implementation.
- Produces: documented local setup, current metadata test, and validated Sites demonstration artifact.

- [ ] **Step 1: Update documentation and metadata expectations**

  Document `SISPL_DATA_SOURCE`, ignored `.env.local`, `db:setup:local`, `dev:local`, strict PostgreSQL errors, and demo-mode hosting limitations. Replace starter/development-preview metadata with product metadata and update the rendered HTML test to assert the SISPL title/description instead of `codex-preview`.

- [ ] **Step 2: Run the full verification suite**

  Run `npm run test:unit`, `npx tsc --noEmit`, `npm run lint`, `npm run build:local`, `npm run build`, and `npm test`. Expected: all non-database checks pass in demo mode. Run `npm run test:integration` when `.env.local` is present.

- [ ] **Step 3: Scan for secret leakage and tenant-scope omissions**

  Search tracked project text excluding build/dependency artifacts for `DATABASE_URL`, supplied credentials, unmasked statutory identifiers, query methods without tenant arguments, and fallback catches. Expected: only placeholder/config variable names appear; no secret values or silent fallback code exists.

- [ ] **Step 4: Publish the validated Sites demonstration build**

  Use the required Sites hosting workflow. Expected: hosted URL continues to render deterministic demonstration data; local PostgreSQL remains intentionally unreachable from the Worker deployment.

## Self-review

- Spec coverage: configuration, dual providers, schema, migration, seed, strict failure semantics, tenancy, UI boundary, tests, security, documentation, and hosted demo compatibility each map to a task.
- Placeholder scan: no implementation placeholders or deferred production behaviors are included; production hosting/authentication remain explicit non-goals.
- Type consistency: `DashboardRecords` is the repository/fixture contract, `DashboardData` is the serialized UI contract, and both providers converge through `mapDashboardRecords`.
