# Dashboard Resource Scoping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Overview dashboard show each person only the work their role's resource scope entitles them to see.

**Architecture:** Scope is resolved once from the session and passed into `loadDashboardRecords`, which filters the work query and derives the client query from it. The mapper is untouched — every dashboard metric already derives from the records it is handed, so filtering at the loader scopes the whole dashboard.

**Tech Stack:** Next.js 16 (App Router, server components), TypeScript, Drizzle ORM over PostgreSQL, `node:test` via `tsx`.

**Spec:** `docs/superpowers/specs/2026-08-28-dashboard-resource-scoping-design.md`

## Global Constraints

- Repository files are **LF**. Never rewrite a file with a Python script in text mode — it converts the file to CRLF and breaks tests that match source text with `\n`. Use the editor, or binary mode.
- Unit tests are `tests/*-unit.test.ts`, run with `npm run test:unit`. They must not touch a database.
- Integration tests live in `tests/postgres-integration.test.ts`, run with `npm run test:integration`. **Roughly seven tests in that file already fail at HEAD on this machine** because of local database drift, so confirm new integration tests individually with `--test-name-pattern`.
- An unrecognised or missing `roleKey` must resolve to the **narrowest** scope (`own`). A visibility rule fails closed.
- Scope predicates are always composed with the existing tenant predicate, never in place of it.
- No firm-level toggle. Scoping applies to everyone as soon as it ships.
- Every commit message uses the repo's `type: subject` form (`feat:`, `test:`, `refactor:`).

---

### Task 1: The scope type and its resolution rule

Pure functions only, so the role-to-scope mapping is testable with no database.

**Files:**
- Create: `lib/dashboard/scope.ts`
- Create: `tests/dashboard-scope-unit.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type DashboardScope = { kind: "firm" } | { kind: "team"; userIds: string[] } | { kind: "own"; userId: string }`
  - `const FIRM_SCOPE: DashboardScope`
  - `function dashboardScopeFor(viewer: ScopeViewer, directReports: string[]): DashboardScope`
  - `type ScopeViewer = { accessClass?: string; roleKey: string; userId: string }`
  - `function scopedUserIds(scope: DashboardScope): string[] | null` — `null` means "no filter".

- [ ] **Step 1: Write the failing test**

Create `tests/dashboard-scope-unit.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";

import { dashboardScopeFor, scopedUserIds, FIRM_SCOPE } from "../lib/dashboard/scope";

const viewer = (roleKey: string, accessClass?: string) => ({ accessClass, roleKey, userId: "me" });

test("firm-wide roles see the whole firm", () => {
  assert.deepEqual(dashboardScopeFor(viewer("partner"), []), { kind: "firm" });
  assert.deepEqual(dashboardScopeFor(viewer("firm_administrator"), []), { kind: "firm" });
  // A Super Admin's legacy role key is irrelevant: the access class decides.
  assert.deepEqual(dashboardScopeFor(viewer("associate", "super_admin"), []), { kind: "firm" });
});

test("a manager sees themselves and their direct reports", () => {
  assert.deepEqual(dashboardScopeFor(viewer("manager"), ["a", "b"]), { kind: "team", userIds: ["me", "a", "b"] });
});

test("a manager with no configured reports sees only their own work", () => {
  assert.deepEqual(dashboardScopeFor(viewer("manager"), []), { kind: "team", userIds: ["me"] });
});

test("an associate, and anything unrecognised, sees only their own work", () => {
  assert.deepEqual(dashboardScopeFor(viewer("associate"), ["a"]), { kind: "own", userId: "me" });
  assert.deepEqual(dashboardScopeFor(viewer(""), ["a"]), { kind: "own", userId: "me" });
  assert.deepEqual(dashboardScopeFor(viewer("something-new"), []), { kind: "own", userId: "me" });
});

test("scopedUserIds reports the users a query should filter on", () => {
  assert.equal(scopedUserIds(FIRM_SCOPE), null);
  assert.deepEqual(scopedUserIds({ kind: "own", userId: "me" }), ["me"]);
  assert.deepEqual(scopedUserIds({ kind: "team", userIds: ["me", "a"] }), ["me", "a"]);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx tsx --test tests/dashboard-scope-unit.test.ts`
Expected: FAIL — `Cannot find module '../lib/dashboard/scope'`.

- [ ] **Step 3: Write the implementation**

Create `lib/dashboard/scope.ts`:

```ts
/**
 * How much of the firm a viewer's dashboard shows.
 *
 * Every role already declares this as its resource scope, and the membership
 * carries it as `roleKey`, so nothing new has to be stored to honour it.
 */
export type DashboardScope =
  | { kind: "firm" }
  | { kind: "team"; userIds: string[] }
  | { kind: "own"; userId: string };

export type ScopeViewer = { accessClass?: string; roleKey: string; userId: string };

export const FIRM_SCOPE: DashboardScope = { kind: "firm" };

/**
 * An unrecognised role resolves to the narrowest scope rather than the widest:
 * a visibility rule that fails open is not a visibility rule.
 */
export function dashboardScopeFor(viewer: ScopeViewer, directReports: string[]): DashboardScope {
  if (viewer.accessClass === "super_admin") return FIRM_SCOPE;
  if (viewer.roleKey === "firm_administrator" || viewer.roleKey === "partner") return FIRM_SCOPE;
  if (viewer.roleKey === "manager") return { kind: "team", userIds: [viewer.userId, ...directReports] };
  return { kind: "own", userId: viewer.userId };
}

/** The users a scoped query filters on, or `null` when it should not filter. */
export function scopedUserIds(scope: DashboardScope): string[] | null {
  if (scope.kind === "firm") return null;
  return scope.kind === "own" ? [scope.userId] : scope.userIds;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx tsx --test tests/dashboard-scope-unit.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/dashboard/scope.ts tests/dashboard-scope-unit.test.ts
git commit -m "feat: resolve a dashboard scope from the viewer's role"
```

---

### Task 2: Reading the reporting line

`listDirectReports` needs a database, so it is separated from the pure rule in Task 1 and verified by integration test.

**Files:**
- Modify: `lib/dashboard/scope.ts`
- Modify: `tests/postgres-integration.test.ts`

**Interfaces:**
- Consumes: `DashboardScope` from Task 1.
- Produces: `function listDirectReports(database: DashboardDatabase, tenantId: string, managerUserId: string): Promise<string[]>`

- [ ] **Step 1: Write the failing test**

Add to `tests/postgres-integration.test.ts`, immediately before the line `test("employee disabling and task assignment serialize on the membership boundary", async () => {`:

```ts
test("direct reports are read from the reporting line and stay inside the firm", async () => {
  const database = getDatabase();
  const identity = await findLoginIdentity(database, "loukesh@example.invalid", "sharma-kumar-ca");
  assert.ok(identity);

  const reports = await listDirectReports(database, identity.tenantId, identity.userId);
  assert.ok(Array.isArray(reports));
  // Every id returned must belong to a profile in this tenant naming this manager.
  for (const userId of reports) {
    const [profile] = await database.select({ managerUserId: employeeWorkProfiles.managerUserId })
      .from(employeeWorkProfiles)
      .where(and(eq(employeeWorkProfiles.tenantId, identity.tenantId), eq(employeeWorkProfiles.employeeUserId, userId)));
    assert.equal(profile?.managerUserId, identity.userId);
  }

  // A manager id from no firm has no reports anywhere.
  assert.deepEqual(await listDirectReports(database, identity.tenantId, randomUUID()), []);
});
```

Add `listDirectReports` to the existing import from `../lib/dashboard/scope` (create the import line if this is the first use):

```ts
import { listDirectReports } from "../lib/dashboard/scope";
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --env-file=.env.local --import tsx --import ./scripts/db/test-environment.ts --test --test-name-pattern "direct reports are read" tests/postgres-integration.test.ts`
Expected: FAIL — `listDirectReports` is not exported.

- [ ] **Step 3: Write the implementation**

Append to `lib/dashboard/scope.ts`, and add the imports at the top of the file:

```ts
import { and, eq } from "drizzle-orm";

import { employeeWorkProfiles } from "../../db/schema";
import type { DashboardDatabase } from "./postgres/repository";
```

```ts
/**
 * One level of the reporting line. The column is nullable and often unset, so
 * an empty result is ordinary rather than exceptional — the caller narrows to
 * the manager alone and the dashboard says why.
 */
export async function listDirectReports(
  database: DashboardDatabase,
  tenantId: string,
  managerUserId: string,
): Promise<string[]> {
  const rows = await database.select({ userId: employeeWorkProfiles.employeeUserId })
    .from(employeeWorkProfiles)
    .where(and(
      eq(employeeWorkProfiles.tenantId, tenantId),
      eq(employeeWorkProfiles.managerUserId, managerUserId),
    ));
  return rows.map((row) => row.userId);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --env-file=.env.local --import tsx --import ./scripts/db/test-environment.ts --test --test-name-pattern "direct reports are read" tests/postgres-integration.test.ts`
Expected: PASS, 1 test.

- [ ] **Step 5: Commit**

```bash
git add lib/dashboard/scope.ts tests/postgres-integration.test.ts
git commit -m "feat: read a manager's direct reports from the reporting line"
```

---

### Task 3: Filtering the record loader

The one behavioural change. The work query filters by scope; the client query filters by the entities that scoped work names, as a subquery so both still run in parallel.

**Files:**
- Modify: `lib/dashboard/postgres/repository.ts:30-140`
- Modify: `tests/postgres-integration.test.ts`

**Interfaces:**
- Consumes: `DashboardScope`, `scopedUserIds`, `FIRM_SCOPE` from Task 1.
- Produces: `loadDashboardRecords(database: DashboardDatabase, tenantId: string, scope?: DashboardScope): Promise<DashboardRecords>` — the scope parameter is optional and defaults to `FIRM_SCOPE`, so the fixture path and existing dependency stubs keep working unchanged.

- [ ] **Step 1: Write the failing test**

Add to `tests/postgres-integration.test.ts`, immediately after the `direct reports` test from Task 2:

```ts
test("dashboard records narrow to the scope they are loaded with", async () => {
  const database = getDatabase();
  const identity = await findLoginIdentity(database, "loukesh@example.invalid", "sharma-kumar-ca");
  assert.ok(identity);

  const firm = await loadDashboardRecords(database, identity.tenantId, FIRM_SCOPE);
  assert.ok(firm.workItems.length > 0, "the seeded firm has work to scope");

  // Nobody's own scope may exceed the firm's, and every item it returns must be
  // one the firm load also returned.
  const assignees = await database.select({ assigneeId: workItems.assigneeId })
    .from(workItems).where(eq(workItems.tenantId, identity.tenantId));
  const someAssignee = assignees.map((row) => row.assigneeId).find((id): id is string => Boolean(id));
  assert.ok(someAssignee, "the seeded firm has an assigned work item");

  const own = await loadDashboardRecords(database, identity.tenantId, { kind: "own", userId: someAssignee });
  assert.ok(own.workItems.length > 0);
  assert.ok(own.workItems.length <= firm.workItems.length);
  const firmIds = new Set(firm.workItems.map((item) => item.id));
  for (const item of own.workItems) assert.ok(firmIds.has(item.id));

  // The client list follows the work, so it can never name an entity the
  // viewer has no work against.
  const ownEntityIds = new Set(own.workItems.map((item) => item.legalEntityId));
  for (const client of own.clients) assert.ok(ownEntityIds.has(client.id));

  // A scope naming nobody returns no work at all, and never falls back to the firm.
  const stranger = await loadDashboardRecords(database, identity.tenantId, { kind: "own", userId: randomUUID() });
  assert.equal(stranger.workItems.length, 0);
  assert.equal(stranger.clients.length, 0);

  // A team scope is the union of its members, so it contains the own scope.
  const team = await loadDashboardRecords(database, identity.tenantId, { kind: "team", userIds: [someAssignee] });
  assert.equal(team.workItems.length, own.workItems.length);

  // The members list is not scoped: it supplies names, not business data.
  assert.equal(own.members.length, firm.members.length);
});
```

Add these imports to `tests/postgres-integration.test.ts` (extend the existing schema import with `workItems` if it is not already there):

```ts
import { FIRM_SCOPE } from "../lib/dashboard/scope";
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --env-file=.env.local --import tsx --import ./scripts/db/test-environment.ts --test --test-name-pattern "dashboard records narrow" tests/postgres-integration.test.ts`
Expected: FAIL — `loadDashboardRecords` takes two arguments, so the scope is ignored and `stranger.workItems.length` is not 0.

- [ ] **Step 3: Write the implementation**

In `lib/dashboard/postgres/repository.ts`, extend the drizzle import on line 1 and add the scope import:

```ts
import { and, asc, eq, inArray, or, sql } from "drizzle-orm";
```

```ts
import { FIRM_SCOPE, scopedUserIds, type DashboardScope } from "../scope";
```

Add above `loadDashboardRecords`:

```ts
/**
 * The work a scope selects: items the scoped users are assigned or reviewing.
 * Reviewing an item is holding it, so both columns count. `undefined` means no
 * predicate, which `and()` drops.
 */
function scopedWorkFilter(scope: DashboardScope) {
  const userIds = scopedUserIds(scope);
  if (!userIds) return undefined;
  // An empty scope must select nothing rather than everything.
  if (userIds.length === 0) return sql`false`;
  return or(inArray(workItems.assigneeId, userIds), inArray(workItems.reviewerId, userIds));
}
```

Change the signature (line 30):

```ts
export async function loadDashboardRecords(
  database: DashboardDatabase,
  tenantId: string,
  scope: DashboardScope = FIRM_SCOPE,
): Promise<DashboardRecords> {
```

Immediately after the `if (!tenantId.trim())` guard, add:

```ts
  const workFilter = scopedWorkFilter(scope);
  /*
   * Clients follow the work rather than being scoped separately, so the client
   * list can never name an entity whose work the viewer cannot see. A subquery
   * rather than a second round trip, so both queries still run in parallel.
   */
  const entityFilter = workFilter
    ? inArray(
        legalEntities.id,
        database.select({ id: workItems.legalEntityId }).from(workItems)
          .where(and(eq(workItems.tenantId, tenantId), workFilter)),
      )
    : undefined;
```

In the client query, change its `.where(...)` to:

```ts
      .where(and(eq(legalEntities.tenantId, tenantId), eq(legalEntities.status, "active"), entityFilter))
```

In the work query, change its `.where(...)` to:

```ts
      .where(and(eq(workItems.tenantId, tenantId), eq(legalEntities.status, "active"), workFilter))
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --env-file=.env.local --import tsx --import ./scripts/db/test-environment.ts --test --test-name-pattern "dashboard records narrow" tests/postgres-integration.test.ts`
Expected: PASS, 1 test.

- [ ] **Step 5: Confirm nothing else regressed**

Run: `npm run test:unit`
Expected: PASS. The existing `tests/postgres-boundaries-unit.test.ts` stubs `loadDashboardRecords` with a two-parameter function, which stays assignable, so it needs no change.

- [ ] **Step 6: Commit**

```bash
git add lib/dashboard/postgres/repository.ts tests/postgres-integration.test.ts
git commit -m "feat: scope the dashboard record loader to the viewer's work"
```

---

### Task 4: Passing the scope through the provider

**Files:**
- Modify: `lib/dashboard/postgres/provider.ts`
- Modify: `lib/dashboard/types.ts:84-88`
- Modify: `tests/postgres-boundaries-unit.test.ts:85-100`

**Interfaces:**
- Consumes: `DashboardScope`, `FIRM_SCOPE`, `loadDashboardRecords` with its scope parameter.
- Produces:
  - `getPostgresDashboardDataForTenant(tenantId: string, scope: DashboardScope, now?: Date, dependencies?): Promise<DashboardData>` — **scope is now the second argument**, so no caller can obtain firm-wide data by omission.
  - `DashboardData.scope?: { kind: "firm" | "team" | "own"; hasReports: boolean }` — optional, so the demo/fixture path and the mapper are untouched.

- [ ] **Step 1: Write the failing test**

Replace the body of `test("authenticated PostgreSQL provider loads only the explicit session tenant", ...)` in `tests/postgres-boundaries-unit.test.ts` with:

```ts
test("authenticated PostgreSQL provider loads only the explicit session tenant", async () => {
  let receivedTenantId = "";
  let receivedScope: unknown = null;
  const dashboard = await getPostgresDashboardDataForTenant(
    SEEDED_TENANT_ID,
    { kind: "own", userId: "viewer-1" },
    new Date("2026-08-15T09:00:00+05:30"),
    {
      getDatabase: () => ({}) as never,
      loadDashboardRecords: async (_database, tenantId, scope) => {
        receivedTenantId = tenantId;
        receivedScope = scope;
        return demoDashboardRecords;
      },
    },
  );

  assert.equal(receivedTenantId, SEEDED_TENANT_ID);
  assert.deepEqual(receivedScope, { kind: "own", userId: "viewer-1" });
  assert.equal(dashboard.source, "postgres");
  assert.equal(dashboard.scope?.kind, "own");
});
```

Keep the rest of the file as it is; the remaining assertions in that test after `dashboard.source` stay unchanged.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx tsx --test tests/postgres-boundaries-unit.test.ts`
Expected: FAIL — the provider takes `now` as its second argument, so the scope object is used as a date.

- [ ] **Step 3: Write the implementation**

In `lib/dashboard/types.ts`, add to `DashboardData` immediately after `titleDate: string;`:

```ts
  /**
   * How much of the firm this data covers. Absent on the demo path, which is
   * always firm-wide, so the fixtures need no change.
   */
  scope?: { kind: "firm" | "team" | "own"; hasReports: boolean };
```

In `lib/dashboard/postgres/provider.ts`, add the import:

```ts
import { FIRM_SCOPE, type DashboardScope } from "../scope";
```

Change `ProviderDependencies.loadDashboardRecords` to:

```ts
  loadDashboardRecords: (database: DashboardDatabase, tenantId: string, scope: DashboardScope) => Promise<DashboardRecords>;
```

In `getPostgresDashboardData`, pass the firm scope explicitly:

```ts
  const records = await dependencies.loadDashboardRecords(database, tenantId, FIRM_SCOPE);
```

Replace `getPostgresDashboardDataForTenant` with:

```ts
/**
 * Scope is required rather than defaulted, so a new caller cannot obtain
 * firm-wide data by forgetting to ask for less.
 */
export async function getPostgresDashboardDataForTenant(
  tenantId: string,
  scope: DashboardScope,
  now?: Date,
  dependencies: Pick<ProviderDependencies, "getDatabase" | "loadDashboardRecords"> = defaultDependencies,
): Promise<DashboardData> {
  if (!tenantId.trim()) throw new Error("tenantId is required.");
  const records = await dependencies.loadDashboardRecords(dependencies.getDatabase(), tenantId, scope);
  return {
    ...mapDashboardRecords(records, now, "postgres"),
    scope: { kind: scope.kind, hasReports: scope.kind !== "team" || scope.userIds.length > 1 },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx tsx --test tests/postgres-boundaries-unit.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/dashboard/postgres/provider.ts lib/dashboard/types.ts tests/postgres-boundaries-unit.test.ts
git commit -m "feat: require a scope when loading authenticated dashboard data"
```

---

### Task 5: Resolving the scope at both call sites

Both callers already hold a session. The sidebar frame scopes with the page so its practice-health bar cannot contradict the page beneath it.

**Files:**
- Modify: `app/page.tsx:99-112`
- Modify: `app/workspace-route-frame.tsx:9-14`
- Create: `tests/dashboard-scope-wiring-unit.test.ts`

**Interfaces:**
- Consumes: `dashboardScopeFor`, `listDirectReports` from Tasks 1-2; the provider signature from Task 4.
- Produces: nothing for later tasks.

- [ ] **Step 1: Write the failing test**

Create `tests/dashboard-scope-wiring-unit.test.ts`:

```ts
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

/**
 * Both entry points render dashboard data, so a scope resolved in only one of
 * them would leave the sidebar contradicting the page it frames.
 */
test("every dashboard entry point resolves a scope before loading data", async () => {
  for (const path of ["../app/page.tsx", "../app/workspace-route-frame.tsx"]) {
    const source = await read(path);
    assert.match(source, /listDirectReports\(/, `${path} reads the reporting line`);
    assert.match(source, /dashboardScopeFor\(/, `${path} resolves a scope`);
    assert.match(
      source,
      /getPostgresDashboardDataForTenant\(session\.tenantId, scope\)/,
      `${path} passes the scope to the provider`,
    );
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx tsx --test tests/dashboard-scope-wiring-unit.test.ts`
Expected: FAIL — neither file mentions `listDirectReports`.

- [ ] **Step 3: Write the implementation**

In `app/page.tsx`, add the import beside the existing navigation import:

```ts
import { dashboardScopeFor, listDirectReports } from "../lib/dashboard/scope";
```

Directly after the line `if (!canOpenWorkspace(session, initialWorkspace)) redirect("/forbidden");`, add:

```ts
    // A manager's dashboard covers their reports, so the reporting line is read
    // before the records that it narrows.
    const scope = dashboardScopeFor(
      session,
      session.roleKey === "manager" ? await listDirectReports(getDatabase(), session.tenantId, session.userId) : [],
    );
```

Change the provider call inside the `Promise.all` from `getPostgresDashboardDataForTenant(session.tenantId)` to:

```ts
        getPostgresDashboardDataForTenant(session.tenantId, scope),
```

In `app/workspace-route-frame.tsx`, add the import:

```ts
import { dashboardScopeFor, listDirectReports } from "../lib/dashboard/scope";
```

Replace the body between `const session = await requirePermission("dashboard:read");` and the `const [data, unreadNotifications] = await Promise.all([` line with:

```ts
  const scope = dashboardScopeFor(
    session,
    session.roleKey === "manager" ? await listDirectReports(getDatabase(), session.tenantId, session.userId) : [],
  );
  const [data, unreadNotifications] = await Promise.all([
```

and change the provider call in that array to:

```ts
    getPostgresDashboardDataForTenant(session.tenantId, scope),
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx tsx --test tests/dashboard-scope-wiring-unit.test.ts`
Expected: PASS.

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add app/page.tsx app/workspace-route-frame.tsx tests/dashboard-scope-wiring-unit.test.ts
git commit -m "feat: scope dashboard data to the signed-in viewer"
```

---

### Task 6: Saying why a manager's dashboard is empty

A team-scoped viewer with no configured reports sees only their own work. Without a word of explanation that reads as a fault rather than as configuration.

**Files:**
- Modify: `app/dashboard/overview-workspace.tsx:135-142`
- Modify: `app/globals.css`
- Modify: `tests/dashboard-scope-wiring-unit.test.ts`

**Interfaces:**
- Consumes: `DashboardData.scope` from Task 4.
- Produces: nothing for later tasks.

- [ ] **Step 1: Write the failing test**

Add to `tests/dashboard-scope-wiring-unit.test.ts`:

```ts
test("a team scope with no reports explains itself instead of looking broken", async () => {
  const [overview, css] = await Promise.all([
    read("../app/dashboard/overview-workspace.tsx"),
    read("../app/globals.css"),
  ]);

  assert.match(overview, /data\.scope\?\.kind === "team" && !data\.scope\.hasReports/);
  assert.match(overview, /reporting lines/i);
  // The explanation has to lead somewhere the reader can act.
  assert.match(overview, /href="\/\?workspace=team"/);
  assert.match(css, /\.scope-notice \{/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx tsx --test tests/dashboard-scope-wiring-unit.test.ts`
Expected: FAIL on the first assertion — `overview-workspace.tsx` does not mention `data.scope`.

- [ ] **Step 3: Write the implementation**

In `app/dashboard/overview-workspace.tsx`, insert directly after the `<PageTitle ... />` element in `OverviewWorkspace`:

```tsx
      {data.scope?.kind === "team" && !data.scope.hasReports && (
        <p className="scope-notice" role="status">
          This dashboard covers you and your direct reports, and nobody reports to you yet.
          {" "}
          <Link href="/?workspace=team">Set reporting lines in Employees</Link> to see your team&rsquo;s work here.
        </p>
      )}
```

`Link` is already imported at the top of the file.

In `app/globals.css`, add before the `.shift-name-line {` rule:

```css
/* A scoped dashboard that looks empty needs to say why, or it reads as a fault. */
.scope-notice {
  background: color-mix(in srgb, var(--accent) 10%, var(--surface));
  border: 1px solid color-mix(in srgb, var(--accent) 34%, var(--line));
  border-radius: 14px;
  color: var(--ink);
  font-size: var(--type-supporting);
  line-height: 1.5;
  margin: 0;
  padding: 12px 16px;
}

.scope-notice a {
  color: var(--accent-strong);
  font-weight: 750;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx tsx --test tests/dashboard-scope-wiring-unit.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add app/dashboard/overview-workspace.tsx app/globals.css tests/dashboard-scope-wiring-unit.test.ts
git commit -m "feat: explain a team dashboard with no reporting lines"
```

---

### Task 7: Full verification

**Files:**
- Modify: none unless a check fails.

- [ ] **Step 1: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no output.

- [ ] **Step 2: Lint**

Run: `npx eslint app lib tests`
Expected: no output.

- [ ] **Step 3: Unit suite**

Run: `npm run test:unit`
Expected: `fail 0`. The count rises by at least 8 over the pre-change baseline.

- [ ] **Step 4: The new integration tests, individually**

Run: `node --env-file=.env.local --import tsx --import ./scripts/db/test-environment.ts --test --test-name-pattern "direct reports are read|dashboard records narrow" tests/postgres-integration.test.ts`
Expected: `pass 2`, `fail 0`. Run them by name because roughly seven other tests in that file already fail at HEAD from local database drift.

- [ ] **Step 5: Build**

Run: `npm run build`
Expected: `✓ Compiled successfully`.

- [ ] **Step 6: Confirm line endings were not converted**

Run: `git diff --stat`
Expected: only the lines actually changed. A file showing its entire length as modified means it was rewritten with CRLF; repair it with a binary-mode `data.replace(b"\r\n", b"\n")` before committing.

- [ ] **Step 7: Check the result by role**

Run the app and sign in as a partner, a manager and an associate in turn. Expected: the partner's Overview is unchanged; the associate sees only work they are assigned or reviewing, with a client list containing only those clients; a manager with no reports sees their own work under the reporting-line notice.

---

## Notes for the implementer

- **Do not touch `lib/dashboard/mapper.ts`.** Every metric already derives from the records handed to it, so filtering at the loader scopes the whole dashboard. A change in the mapper would mean the scoping is in the wrong place.
- **Members stay firm-wide** on purpose. That list supplies names and initials for avatars, and Employees is separately permission-gated.
- The demo/fixture path is firm-wide by definition; `DashboardData.scope` is optional so that path needs no change.
