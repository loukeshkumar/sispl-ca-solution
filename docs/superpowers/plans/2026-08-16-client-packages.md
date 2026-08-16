# Client Packages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a tenant-isolated service/package catalogue and immutable client-package assignment workflow with two responsive workspace menus.

**Architecture:** Normalized PostgreSQL catalogue tables feed immutable assignment snapshots. Tenant-scoped repositories own all reads and transactional assignment rules, Server Actions enforce role permissions, and two dashboard workspaces plus persistent-shell detail routes provide the UI. Existing `client_services` remains the active entitlement projection for dashboard compatibility while assignment snapshots remain the commercial system of record.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5.9, Drizzle ORM 0.45, PostgreSQL, Tailwind/PostCSS global design tokens, Lucide React, Node test runner.

## Global Constraints

- Expose exactly two menus: `Package Setup` and `Client Packages`.
- One active base package per legal entity; optional non-duplicate add-ons are allowed.
- Billing cycles are `monthly`, `quarterly`, `annual`, and `one_time`.
- Assignment package, price, billing cycle, and service values are immutable snapshots.
- Persist INR money as integer paise and never as decimal floats.
- Firm administrators and partners manage the catalogue; administrators, partners, and managers manage client assignments; associates have no access.
- Every query and mutation is tenant-scoped and protected server-side.
- Preserve the persistent application shell on every feature route.
- Meet the existing light/dark premium glass contract, 12px text floor, WCAG AA contrast, 44px targets, reduced-motion support, and responsive widths from 375px through 1440px.
- Do not implement invoicing, payment collection, tax calculation, proration, discounts, client checkout, or automatic work generation.

---

## File structure

- `db/schema.ts`: table definitions and same-tenant constraints.
- `drizzle/0014_*.sql` and `drizzle/meta/*`: generated migration artifacts.
- `scripts/db/seed.ts`: idempotent default service catalogue seed.
- `lib/packages/validation.ts`: pure service, package, and assignment input validation.
- `lib/packages/repository.ts`: tenant-scoped reads, catalogue writes, transactional assignments, and entitlement synchronization.
- `app/packages/actions.ts`: catalogue and assignment Server Actions.
- `app/dashboard/package-setup-workspace.tsx`: services/packages catalogue workspace.
- `app/dashboard/client-packages-workspace.tsx`: client assignment register and KPIs.
- `app/packages/**`, `app/client-packages/**`: persistent-shell create/edit/detail routes and forms.
- `app/dashboard/dashboard-shell.tsx`, `app/dashboard-client.tsx`, `app/page.tsx`: navigation and conditional data loading.
- `app/globals.css`: feature layout, themes, interactions, and responsive rules.
- `lib/work/repository.ts`, `lib/work/validation.ts`, `app/work/**`: entitlement-aware work creation.
- `tests/packages-*-unit.test.ts`, `tests/postgres-integration.test.ts`: red/green domain, authorization, UI, and lifecycle coverage.

### Task 1: Schema and migration

**Files:**
- Modify: `db/schema.ts`
- Modify: `scripts/db/check.ts`
- Modify: `scripts/db/seed.ts`
- Create: generated `drizzle/0014_*.sql`
- Modify: generated `drizzle/meta/_journal.json`
- Create: generated `drizzle/meta/0014_snapshot.json`
- Test: `tests/schema-unit.test.ts`

**Interfaces:**
- Produces: `serviceCatalog`, `servicePackages`, `servicePackageItems`, `clientPackageAssignments`, and `clientPackageAssignmentServices` Drizzle tables.
- Preserves: `clientServices` as the active entitlement projection.

- [ ] **Step 1: Write failing schema assertions**

Add a test that loads `db/schema.ts` and requires all five table exports, status and billing-cycle checks, integer-paise checks, assignment date ordering, add-on source checks, unique assignment-service membership, and composite tenant foreign keys. Also assert `scripts/db/check.ts` includes every new table.

- [ ] **Step 2: Verify the schema test fails**

Run: `node --import tsx --test tests/schema-unit.test.ts`

Expected: FAIL because `serviceCatalog` and the remaining package tables do not exist.

- [ ] **Step 3: Add normalized tenant-owned tables**

Implement these stable field contracts:

```ts
serviceCatalog: { id, tenantId, code, name, category, description, status, createdAt, updatedAt }
servicePackages: { id, tenantId, code, name, description, billingCycle, standardFeePaise, status, createdAt, updatedAt }
servicePackageItems: { id, tenantId, packageId, serviceId, createdAt }
clientPackageAssignments: {
  id, tenantId, legalEntityId, packageId, effectiveFrom, effectiveTo,
  status, packageCodeSnapshot, packageNameSnapshot, billingCycleSnapshot,
  standardFeePaiseSnapshot, agreedFeePaiseSnapshot, createdByUserId,
  cancelledAt, cancellationReason, createdAt, updatedAt
}
clientPackageAssignmentServices: {
  id, tenantId, assignmentId, serviceId, serviceCodeSnapshot,
  serviceNameSnapshot, serviceCategorySnapshot, source, createdAt
}
```

Use unique `(tenant_id,id)` keys for composite references; case-insensitive tenant-local code uniqueness; same-tenant foreign keys to packages, services, legal entities, and memberships; non-negative paise checks; date ordering; and status enumerations from the approved spec.

- [ ] **Step 4: Generate and inspect the migration**

Run: `npm run db:generate`

Expected: a new migration containing only the five new tables, their indexes, checks, and foreign keys. Inspect it for accidental drops before continuing.

- [ ] **Step 5: Seed the default service catalogue idempotently**

Seed codes and names for `BOOKS`, `GST`, `TDS`, `ITR`, `AUDIT`, `ROC`, `LUT`, and `10B` with suitable categories. Use tenant-and-code conflict handling so repeated local setup remains safe.

- [ ] **Step 6: Verify Task 1**

Run: `node --import tsx --test tests/schema-unit.test.ts`

Expected: PASS.

Run: `npx tsc --noEmit`

Expected: exit 0.

### Task 2: Validation and exact money conversion

**Files:**
- Create: `lib/packages/validation.ts`
- Create: `tests/packages-validation-unit.test.ts`

**Interfaces:**
- Produces: `validateServiceFields`, `validatePackageFields`, `validateAssignmentFields`, `formatPackageFee`, and input/action-state types.
- Consumes: string and string-array form field records only; no database dependency.

- [ ] **Step 1: Write failing service validation tests**

Cover trimmed uppercase codes, normalized names/categories/descriptions, allowed statuses, duplicate service selection removal, code/name limits, and invalid empty inputs.

- [ ] **Step 2: Verify RED for service validation**

Run: `node --import tsx --test tests/packages-validation-unit.test.ts`

Expected: FAIL with missing `lib/packages/validation.ts` exports.

- [ ] **Step 3: Implement service validation minimally**

Accept codes matching `^[A-Z][A-Z0-9_-]{1,19}$`, names from 2–100 characters, categories from 2–60 characters, descriptions up to 500 characters, and statuses `active|archived`.

- [ ] **Step 4: Write failing package and assignment tests**

Cover all four billing cycles, exact conversion of `12500.50` to `1_250_050` paise, rejection of exponent/negative/overprecision values, at least one included service, UUID validation, date ordering, add-on deduplication, package/add-on overlap, fee override, and replacement confirmation.

- [ ] **Step 5: Verify RED for the new cases**

Run: `node --import tsx --test tests/packages-validation-unit.test.ts`

Expected: FAIL on missing package and assignment behavior.

- [ ] **Step 6: Implement package and assignment validation**

Return discriminated results:

```ts
type ValidationResult<T, K extends string> =
  | { success: true; data: T }
  | { success: false; fieldErrors: Partial<Record<K, string>> };
```

Parse INR with a string-based paise converter, never `Number(value) * 100`. Preserve sorted, unique service IDs and reject an add-on already included in the selected package when the package service set is supplied.

- [ ] **Step 7: Verify Task 2**

Run: `node --import tsx --test tests/packages-validation-unit.test.ts`

Expected: all package validation tests PASS.

Run: `npx tsc --noEmit`

Expected: exit 0.

### Task 3: Tenant-scoped repository and immutable assignment transaction

**Files:**
- Create: `lib/packages/repository.ts`
- Create: `tests/packages-repository-unit.test.ts`
- Modify: `tests/postgres-integration.test.ts`

**Interfaces:**
- Produces: `PackageSetupWorkspaceData`, `ClientPackageWorkspaceData`, `listPackageSetupWorkspace`, `listClientPackageWorkspace`, `getServiceForEdit`, `getPackageForEdit`, `getAssignmentDetail`, `createService`, `updateService`, `createPackage`, `updatePackage`, `assignClientPackage`, and `cancelClientPackage`.
- Consumes: validated inputs from `lib/packages/validation.ts` and a Drizzle database instance.

- [ ] **Step 1: Write failing repository boundary tests**

Statically and behaviorally require tenant identity on every operation, require the complete read/write API, ensure list view models contain no unsnapshotted commercial fields for historical assignments, and assert transactions are used for package-item replacement and client assignment.

- [ ] **Step 2: Verify repository RED**

Run: `node --import tsx --test tests/packages-repository-unit.test.ts`

Expected: FAIL because the repository is missing.

- [ ] **Step 3: Implement catalogue reads and writes**

List services and packages with included-service counts and names. Validate referenced rows belong to the same tenant and are active for new package membership. Replace package items inside one transaction. Archive rather than delete used rows.

- [ ] **Step 4: Write failing assignment integration tests**

Within the isolated test tenant, create a package, assign it to a legal entity with an add-on, edit the source package, and assert the assignment snapshots remain unchanged. Assert another tenant cannot read or mutate it, overlapping dates are rejected, duplicate add-ons are rejected, cancellation preserves history, and `client_services` reflects the currently effective snapshot.

- [ ] **Step 5: Verify integration RED**

Run: `npm run test:integration`

Expected: the new package lifecycle tests FAIL while existing integration setup remains healthy.

- [ ] **Step 6: Implement the assignment transaction**

Lock assignments for the tenant/legal entity, validate the selected active package and services inside the transaction, reject any overlapping non-cancelled date interval, create commercial and service snapshots, and synchronize `client_services` for an assignment effective today. A future assignment remains scheduled; entitlement resolution selects the date-effective non-cancelled assignment and falls back to legacy `client_services` only when the legal entity has never received a package.

- [ ] **Step 7: Implement cancellation and view models**

Cancellation requires a reason, preserves snapshot rows, sets cancellation metadata, and recalculates current entitlement. List metrics report active assignments, renewals ending within 30 days, clients with no current assignment, and normalized monthly recurring value (monthly fee; quarterly divided by 3; annual divided by 12; one-time excluded).

- [ ] **Step 8: Verify Task 3**

Run: `node --import tsx --test tests/packages-repository-unit.test.ts`

Expected: PASS.

Run: `npm run test:integration`

Expected: PASS against the isolated test database.

Run: `npx tsc --noEmit`

Expected: exit 0.

### Task 4: Permissions and Server Actions

**Files:**
- Modify: `lib/auth/authorization.ts`
- Create: `app/packages/actions.ts`
- Modify: `tests/auth-unit.test.ts`
- Create: `tests/packages-actions-unit.test.ts`

**Interfaces:**
- Produces: `packages:read`, `packages:manage`, and `client_packages:manage` permissions plus catalogue and assignment form actions.
- Consumes: repository mutations and validation results from Tasks 2–3.

- [ ] **Step 1: Write failing permission tests**

Assert administrators and partners have all three permissions, managers have `packages:read` and `client_packages:manage` only, and associates have none.

- [ ] **Step 2: Verify permission RED**

Run: `node --import tsx --test tests/auth-unit.test.ts`

Expected: FAIL because the package permissions are unknown.

- [ ] **Step 3: Add the permission matrix**

Extend the `Permission` union and role sets exactly as approved.

- [ ] **Step 4: Write failing action authorization tests**

Require every action to call `requirePermission` with the correct permission, validate form data before a repository call, map PostgreSQL conflicts to safe field errors, revalidate affected paths, and redirect only after a successful mutation.

- [ ] **Step 5: Verify action RED**

Run: `node --import tsx --test tests/packages-actions-unit.test.ts`

Expected: FAIL because `app/packages/actions.ts` is missing.

- [ ] **Step 6: Implement Server Actions**

Add create/update service, create/update package, assign package, and cancel assignment actions. Log only `{ errorType }`; never return database messages or tenant identifiers to the browser.

- [ ] **Step 7: Verify Task 4**

Run: `node --import tsx --test tests/auth-unit.test.ts tests/packages-actions-unit.test.ts`

Expected: PASS.

Run: `npx tsc --noEmit`

Expected: exit 0.

### Task 5: Persistent navigation and dashboard data wiring

**Files:**
- Modify: `app/dashboard/dashboard-icons.tsx`
- Modify: `app/dashboard/dashboard-shell.tsx`
- Modify: `app/dashboard-client.tsx`
- Modify: `app/page.tsx`
- Modify: `app/authenticated-workspace-shell.tsx`
- Create: `tests/packages-ui-unit.test.ts`

**Interfaces:**
- Produces: dashboard workspace names `Package Setup` and `Client Packages` and conditionally loaded workspace props.
- Consumes: workspace data from Task 3 and permissions from Task 4.

- [ ] **Step 1: Write failing navigation tests**

Assert both menu labels exist with Lucide-backed icons, are permission-filtered, map to `?workspace=package-setup` and `?workspace=client-packages`, and remain available in the shared shell used by dedicated routes.

- [ ] **Step 2: Verify navigation RED**

Run: `node --import tsx --test tests/packages-ui-unit.test.ts`

Expected: FAIL because package workspaces are absent.

- [ ] **Step 3: Add workspace navigation and routing**

Extend the navigation discriminants, URL mapping, active workspace resolution, and dashboard-client render branches. Do not overload an existing `billing` destination.

- [ ] **Step 4: Add conditional server data loading**

In PostgreSQL mode, reject unauthorized package workspace requests before querying. Load package setup data only for `Package Setup`, client assignment data only for `Client Packages`, and pass truthful empty view models in demo mode.

- [ ] **Step 5: Verify Task 5**

Run: `node --import tsx --test tests/packages-ui-unit.test.ts tests/authenticated-workspace-shell-unit.test.ts tests/dashboard-layout-unit.test.ts`

Expected: PASS.

Run: `npx tsc --noEmit`

Expected: exit 0.

### Task 6: Catalogue and client-package UI

**Files:**
- Create: `app/dashboard/package-setup-workspace.tsx`
- Create: `app/dashboard/client-packages-workspace.tsx`
- Create: `app/packages/layout.tsx`
- Create: `app/packages/services/new/page.tsx`
- Create: `app/packages/services/[serviceId]/edit/page.tsx`
- Create: `app/packages/service-form.tsx`
- Create: `app/packages/new/page.tsx`
- Create: `app/packages/[packageId]/edit/page.tsx`
- Create: `app/packages/package-form.tsx`
- Create: `app/client-packages/layout.tsx`
- Create: `app/client-packages/new/page.tsx`
- Create: `app/client-packages/[assignmentId]/page.tsx`
- Create: `app/client-packages/assignment-form.tsx`
- Create: `app/client-packages/cancel-assignment-form.tsx`
- Modify: `app/globals.css`
- Modify: `tests/packages-ui-unit.test.ts`

**Interfaces:**
- Produces: complete package catalogue and client assignment workflows.
- Consumes: action-state types, workspace data, edit/detail models, and Server Actions from Tasks 2–5.

- [ ] **Step 1: Write failing workspace contract tests**

Require four client-package KPIs, Services and Packages catalogue tabs, search/filter controls with accessible labels, desktop registers plus mobile cards, empty states, formatted INR/billing-cycle text, add-on preview, explicit replacement confirmation, pending states, inline errors, and shell-preserving route layouts.

- [ ] **Step 2: Verify UI RED**

Run: `node --import tsx --test tests/packages-ui-unit.test.ts`

Expected: FAIL on missing components and CSS contracts.

- [ ] **Step 3: Implement Package Setup workspace and forms**

Use `surface-card`, shared buttons, `StatusBadge`, and Lucide icons. Services and packages are separately searchable within one workspace; package rows show fee, cycle, included services, and active/archive state. Forms use real labels, field-level `aria-describedby`, disabled pending buttons, and no client-only database import.

- [ ] **Step 4: Implement Client Packages workspace and forms**

Show active, renewal, unassigned, and recurring-value KPIs. Provide status/cycle/package filters, assignment history, and a create action. The assignment form updates the included-service preview when the selected package changes, excludes included services from add-ons, and requires an explicit replacement checkbox when an effective assignment exists.

- [ ] **Step 5: Implement assignment detail and cancellation**

Render snapshot values—not current catalogue values—with package/add-on source badges and timeline dates. Cancellation uses a required reason and a destructive confirmation style without hard deletion.

- [ ] **Step 6: Add responsive premium-glass CSS**

Use minmax-constrained grids, `min-width: 0` on every nested form/control, 44px actions, visible focus rings, theme tokens instead of hard-coded foregrounds, 150–300 ms transitions, and `prefers-reduced-motion`. At `max-width: 760px`, replace registers with cards and stack forms without document-level horizontal overflow.

- [ ] **Step 7: Verify Task 6**

Run: `node --import tsx --test tests/packages-ui-unit.test.ts tests/premium-theme-css-unit.test.ts tests/typography-unit.test.ts`

Expected: PASS.

Run: `npx tsc --noEmit`

Expected: exit 0.

### Task 7: Enforce package service entitlement in client work

**Files:**
- Modify: `lib/work/repository.ts`
- Modify: `lib/work/validation.ts`
- Modify: `app/work/new/page.tsx`
- Modify: `app/work/work-form.tsx`
- Modify: `app/work/actions.ts`
- Modify: `lib/clients/repository.ts`
- Modify: `app/clients/client-form.tsx`
- Modify: `tests/work-validation-unit.test.ts`
- Modify: `tests/postgres-integration.test.ts`

**Interfaces:**
- Produces: per-client entitled service options for work creation.
- Consumes: date-effective assignment snapshots with legacy `client_services` fallback from Task 3.

- [ ] **Step 1: Write failing entitlement tests**

Assert work creation rejects a service outside the client's current package/add-ons, accepts included and add-on services, supports legacy client services only before the first package assignment, and never reads another tenant's assignment.

- [ ] **Step 2: Verify entitlement RED**

Run: `node --import tsx --test tests/work-validation-unit.test.ts`

Expected: FAIL because work service validation still trusts a global static list.

- [ ] **Step 3: Implement repository-backed service options**

Load legal entities with their current entitled services for the work form. Revalidate the selected legal entity/service pair inside the work creation and update transaction so crafted form data cannot bypass the UI.

- [ ] **Step 4: Align legacy client editing**

For a client with a package history, replace direct service checkboxes with a read-only entitlement summary and link to `Client Packages`. Keep catalogue-backed manual service selection only for clients that have never received a package.

- [ ] **Step 5: Verify Task 7**

Run: `node --import tsx --test tests/work-validation-unit.test.ts tests/client-validation-unit.test.ts`

Expected: PASS.

Run: `npm run test:integration`

Expected: PASS with entitlement enforcement covered.

Run: `npx tsc --noEmit`

Expected: exit 0.

### Task 8: Full verification and documentation

**Files:**
- Modify: `README.md`
- Modify: `LOCAL_SETUP.md`
- Modify: `EXECUTION_PLAN.md`

**Interfaces:**
- Documents: migration/setup commands, permissions, package workflow, snapshot semantics, and scope exclusions.

- [ ] **Step 1: Update operator documentation**

Document `npm run db:setup:local`, the two menus, role access, package assignment/replacement/cancellation behavior, immutable snapshots, integer-paise storage, and the fact that this is not an invoicing engine.

- [ ] **Step 2: Run the complete automated verification**

Run: `npm run test:unit`

Expected: all tests PASS with zero failures.

Run: `npm run test:integration`

Expected: all isolated PostgreSQL integration tests PASS when the configured test database is available.

Run: `npm run lint`

Expected: exit 0.

Run: `npx tsc --noEmit`

Expected: exit 0.

Run: `npm run build`

Expected: optimized production build succeeds.

Run: `git diff --check`

Expected: no whitespace errors.

- [ ] **Step 3: Perform visual verification**

Verify Package Setup, Client Packages, each create/edit/detail route, both themes, keyboard focus order, and viewport widths 375, 768, 1024, and 1440. Confirm the fixed sidebar and command bar remain present and no document-level horizontal scrolling occurs.

- [ ] **Step 4: Review the final diff**

Confirm no tracked environment secrets, unrelated user edits, Cloudflare/Vite tooling, hard-coded tenant IDs, unsnapshotted historical commercial reads, or invented demo commercial data were added.
