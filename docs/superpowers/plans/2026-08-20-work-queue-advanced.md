# Advanced Work Queue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `?workspace=work` from a firm-wide, client-side-filtered read-only list into a server-driven personal work queue with scope tabs, shareable URL views, bulk triage, capacity lanes, and budget-vs-actual.

**Architecture:** A new `lib/work/queue.ts` owns every read this workspace performs, replacing the shared `DashboardData` blob as its source. Pure arithmetic and parsing live in two side-effect-free modules (`queue-params.ts`, `capacity.ts`) so they are unit-testable without a database. The page becomes a server component reading the query string, with one client island holding row-selection state.

**Tech Stack:** Next.js App Router (server components + Server Actions), React, TypeScript, Drizzle ORM, PostgreSQL, `node:test` via `tsx`.

**Spec:** `docs/superpowers/specs/2026-08-20-work-queue-advanced-design.md`

## Global Constraints

- Every repository query carries `tenant_id` in its `WHERE` clause. Tenant scope at every data-access boundary is non-negotiable.
- Scope is resolved server-side from the session user. The client never supplies its own viewer identity.
- A null budget renders as "no budget". Never render, sum, or default it as `0`.
- The service standard is copied into `work_items.budget_minutes` at creation time, in the repository. Never a database default, never a display-time join.
- Bulk actions never set status to `completed`.
- One `audit_events` row per changed work item. Bulk actions never collapse into a single event.
- Unit tests: `npm run test:unit` (files matching `tests/*-unit.test.ts`).
- Integration tests: `npm run test:integration` (requires `.env.local` and a `_test` database).
- Lint: `npm run lint`. Build: `npm run build`.
- Migrations are generated with `npm run db:generate` and applied with `npm run db:migrate:local`. Never hand-edit an existing migration file.
- Follow existing code style: named exports, alphabetically-ordered JSX props, no default exports from `lib/`.

---

### Task 1: Schema columns and indexes

**Files:**
- Modify: `db/schema.ts:209-225` (serviceCatalog), `db/schema.ts:349-380` (workItems), `db/schema.ts:1225-1235` (timeEntries)
- Create: `drizzle/0028_*.sql` (generated)

**Interfaces:**
- Consumes: nothing.
- Produces: `serviceCatalog.standardMinutes` (`integer | null`), `workItems.budgetMinutes` (`integer | null`), and three indexes used by Tasks 6 and 7.

- [ ] **Step 1: Add `standardMinutes` to the service catalogue**

In `db/schema.ts`, inside `serviceCatalog`'s column block, after `description`:

```ts
  standardMinutes: integer("standard_minutes"),
```

And in its constraint array, after the status check:

```ts
  check("service_catalog_standard_minutes_check", sql`${table.standardMinutes} is null or ${table.standardMinutes} between 1 and 100000`),
```

- [ ] **Step 2: Add `budgetMinutes` to work items**

In `workItems`'s column block, after `missingItemCount`:

```ts
  budgetMinutes: integer("budget_minutes"),
```

And in its constraint array, after `work_items_missing_count_check`:

```ts
  check("work_items_budget_minutes_check", sql`${table.budgetMinutes} is null or ${table.budgetMinutes} between 1 and 100000`),
```

- [ ] **Step 3: Add the three indexes**

In `workItems`'s constraint array:

```ts
  index("work_items_assignee_due_idx").on(table.tenantId, table.assigneeId, table.status, table.internalDueDate),
  index("work_items_reviewer_idx").on(table.tenantId, table.reviewerId, table.status),
```

In `timeEntries`'s constraint array, after the existing indexes:

```ts
  index("time_entries_work_idx").on(table.tenantId, table.workItemId),
```

- [ ] **Step 4: Generate the migration**

Run: `npm run db:generate`
Expected: a new `drizzle/0028_*.sql` containing two `ALTER TABLE ... ADD COLUMN`, two `ADD CONSTRAINT`, and three `CREATE INDEX`. Read it and confirm there is no `DROP` and no `NOT NULL` on the new columns.

- [ ] **Step 5: Apply and verify**

Run: `npm run db:migrate:local && npm run db:check:local`
Expected: migration applies, check reports required tables present.

- [ ] **Step 6: Commit**

```bash
git add db/schema.ts drizzle/
git commit -m "feat: add service standard and work item budget columns"
```

---

### Task 2: Service standard minutes in the catalogue

**Files:**
- Modify: `lib/packages/validation.ts:11-17` (`ServiceInput`), `lib/packages/repository.ts` (`createService`, `updateService`, `listServiceManagementWorkspace`)
- Modify: `app/dashboard/service-management-workspace.tsx` (form field + column)
- Test: `tests/packages-unit.test.ts` (create if absent)

**Interfaces:**
- Consumes: `serviceCatalog.standardMinutes` from Task 1.
- Produces: `ServiceInput.standardMinutes: number | null`, persisted and returned by `ServiceCatalogueView`.

- [ ] **Step 1: Write the failing test**

Add to `tests/packages-unit.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";

import { validateServiceFields } from "../lib/packages/validation";

test("service standard minutes accepts a blank value as unestimated", () => {
  const result = validateServiceFields({ category: "GST", code: "GSTR3B", description: "", name: "GSTR-3B", standardMinutes: "", status: "active" });
  assert.equal(result.success, true);
  assert.equal(result.success && result.data.standardMinutes, null);
});

test("service standard minutes accepts a whole number of minutes", () => {
  const result = validateServiceFields({ category: "GST", code: "GSTR3B", description: "", name: "GSTR-3B", standardMinutes: "90", status: "active" });
  assert.equal(result.success && result.data.standardMinutes, 90);
});

test("service standard minutes rejects zero, fractions, and out-of-range values", () => {
  for (const value of ["0", "1.5", "-5", "100001"]) {
    const result = validateServiceFields({ category: "GST", code: "GSTR3B", description: "", name: "GSTR-3B", standardMinutes: value, status: "active" });
    assert.equal(result.success, false, `expected ${value} to be rejected`);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit`
Expected: FAIL — `standardMinutes` is not a property of the validated data.

- [ ] **Step 3: Extend the validator**

In `lib/packages/validation.ts`, add to `ServiceInput`:

```ts
  standardMinutes: number | null;
```

In `validateServiceFields`, before the return, add:

```ts
  const standardMinutesRaw = text(fields, "standardMinutes");
  let standardMinutes: number | null = null;
  if (standardMinutesRaw) {
    const parsed = Number(standardMinutesRaw);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100000) {
      fieldErrors.standardMinutes = "Standard effort must be a whole number of minutes between 1 and 100000.";
    } else {
      standardMinutes = parsed;
    }
  }
```

Add `standardMinutes` to the returned `data` object.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit`
Expected: PASS.

- [ ] **Step 5: Persist and surface the column**

In `lib/packages/repository.ts`, add `standardMinutes: input.standardMinutes` to the `insert` in `createService` and the `set` in `updateService`. In `listServiceManagementWorkspace` and `listPackageSetupWorkspace`, include `standardMinutes: service.standardMinutes` in the mapped `ServiceCatalogueView`.

In `app/dashboard/service-management-workspace.tsx`, add a numeric input to the service form:

```tsx
<label className="field">
  <span>Standard effort (minutes)</span>
  <input defaultValue={service?.standardMinutes ?? ""} inputMode="numeric" max={100000} min={1} name="standardMinutes" placeholder="Not estimated" type="number" />
  <small>New work items copy this as their budget. Editing it never changes work already raised.</small>
</label>
```

and a table cell rendering `service.standardMinutes ? `${service.standardMinutes}m` : "—"`.

- [ ] **Step 6: Verify the build**

Run: `npm run lint && npm run build`
Expected: both succeed.

- [ ] **Step 7: Commit**

```bash
git add lib/packages tests/packages-unit.test.ts app/dashboard/service-management-workspace.tsx
git commit -m "feat: record standard effort minutes on catalogue services"
```

---

### Task 3: Budget snapshot on work items

**Files:**
- Modify: `lib/work/validation.ts` (`WorkInput`, `validateWorkFields`), `lib/work/repository.ts` (`createWorkItem`, `updateWorkItem`, `getWorkItem360`)
- Modify: `app/dashboard/work-dialog.tsx`
- Test: `tests/work-queue-unit.test.ts` (create)

**Interfaces:**
- Consumes: `serviceCatalog.standardMinutes` (Task 1), `workServiceEntitlementCode` from `lib/work/validation.ts`.
- Produces: `WorkInput.budgetMinutes: number | null`; `createWorkItem` defaults it from the catalogue; `Work360Data.budgetMinutes`.

**Context the implementer needs:** `work_items.service_key` is not the catalogue code. Newly created items store the uppercase catalogue code (`listWorkClients` maps entitlements to `service.code.toUpperCase()`), while seeded and legacy items store keys like `gstr_3b`. `workServiceEntitlementCode(serviceKey)` already normalises both to the catalogue code — use it, do not join on `service_key` directly.

- [ ] **Step 1: Write the failing test**

Create `tests/work-queue-unit.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";

import { validateWorkFields } from "../lib/work/validation";

const baseFields = {
  assigneeId: "", blockerNote: "", internalDueDate: "", legalEntityId: "3f1a2b4c-5d6e-4f70-8901-a2b3c4d5e6f7",
  missingItemCount: "0", periodKey: "2026-07", progress: "10", reviewerId: "", serviceKey: "GST",
  statutoryDueDate: "2026-08-20", status: "critical",
};

test("work budget is null when the field is left blank", () => {
  const result = validateWorkFields({ ...baseFields, budgetMinutes: "" });
  assert.equal(result.success, true);
  assert.equal(result.success && result.data.budgetMinutes, null);
});

test("work budget accepts a whole number of minutes", () => {
  const result = validateWorkFields({ ...baseFields, budgetMinutes: "90" });
  assert.equal(result.success && result.data.budgetMinutes, 90);
});

test("work budget rejects zero and non-integers", () => {
  for (const value of ["0", "-1", "12.5", "100001"]) {
    const result = validateWorkFields({ ...baseFields, budgetMinutes: value });
    assert.equal(result.success, false, `expected ${value} to be rejected`);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit`
Expected: FAIL — `budgetMinutes` is not on the validated data.

- [ ] **Step 3: Extend the work validator**

In `lib/work/validation.ts`, add `budgetMinutes: number | null;` to `WorkInput`, then inside `validateWorkFields`:

```ts
  const budgetMinutesRaw = text(fields, "budgetMinutes");
  let budgetMinutes: number | null = null;
  if (budgetMinutesRaw) {
    const parsed = Number(budgetMinutesRaw);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100000) {
      fieldErrors.budgetMinutes = "Budget must be a whole number of minutes between 1 and 100000.";
    } else {
      budgetMinutes = parsed;
    }
  }
```

Add `budgetMinutes` to the returned `data`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit`
Expected: PASS.

- [ ] **Step 5: Snapshot the standard on create**

In `lib/work/repository.ts`, add the import `serviceCatalog` to the `db/schema` import block, then inside `createWorkItem`'s transaction, after the entitlement assertion:

```ts
    let budgetMinutes = input.budgetMinutes;
    if (budgetMinutes === null) {
      const [standard] = await transaction.select({ standardMinutes: serviceCatalog.standardMinutes })
        .from(serviceCatalog)
        .where(and(
          eq(serviceCatalog.tenantId, tenantId),
          sql`upper(${serviceCatalog.code}) = ${workServiceEntitlementCode(input.serviceKey)}`,
        )).limit(1);
      budgetMinutes = standard?.standardMinutes ?? null;
    }
```

Pass `budgetMinutes` in the `insert` values. Add `sql` to the `drizzle-orm` import.

In `updateWorkItem`, add `budgetMinutes: input.budgetMinutes` to the `set` object — an explicit edit always wins, and clearing the field returns the item to unbudgeted. Do **not** re-read the catalogue on update; that would resurrect the standard after a deliberate clear.

In `getWorkItem360`, select `budgetMinutes: workItems.budgetMinutes` and add it to `Work360Data` via `WorkEditorData`.

- [ ] **Step 6: Add the dialog field**

In `app/dashboard/work-dialog.tsx`, add beside the progress field:

```tsx
<label className="field">
  <span>Budget (minutes)</span>
  <input defaultValue={initial?.budgetMinutes ?? ""} inputMode="numeric" max={100000} min={1} name="budgetMinutes" placeholder="From service standard" type="number" />
</label>
```

- [ ] **Step 7: Verify**

Run: `npm run test:unit && npm run lint && npm run build`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add lib/work app/dashboard/work-dialog.tsx tests/work-queue-unit.test.ts
git commit -m "feat: snapshot service standard as work item budget"
```

---

### Task 4: Query-string parameters

**Files:**
- Create: `lib/work/queue-params.ts`
- Test: `tests/work-queue-unit.test.ts` (append)

**Interfaces:**
- Consumes: `WorkFilter` from `lib/dashboard/filters.ts`.
- Produces:
  - `type WorkScope = "mine" | "reviewing" | "firm"`
  - `type WorkView = "list" | "board" | "capacity"`
  - `type WorkSort = "due" | "progress" | "client"`
  - `type WorkQueueParams = { budget: "over" | null; filter: WorkFilter; owner: string | null; q: string; scope: WorkScope; service: string | null; sort: WorkSort; view: WorkView }`
  - `owner` accepts either a member UUID or the literal `"unassigned"`.
  - `parseWorkQueueParams(raw: Record<string, string | string[] | undefined>): WorkQueueParams`
  - `workQueueHref(params: Partial<WorkQueueParams>): string`
  - `WORK_QUEUE_PRESETS: ReadonlyArray<{ key: string; label: string; params: Partial<WorkQueueParams> }>`

- [ ] **Step 1: Write the failing test**

Append to `tests/work-queue-unit.test.ts`:

```ts
import { parseWorkQueueParams, workQueueHref, WORK_QUEUE_PRESETS } from "../lib/work/queue-params";

test("queue parameters default to the viewer's own list", () => {
  const params = parseWorkQueueParams({});
  assert.equal(params.scope, "mine");
  assert.equal(params.filter, "All");
  assert.equal(params.sort, "due");
  assert.equal(params.view, "list");
  assert.equal(params.owner, null);
});

test("queue parameters round-trip through a href", () => {
  const params = parseWorkQueueParams({ filter: "Due this week", scope: "firm", sort: "progress", view: "board" });
  const parsed = parseWorkQueueParams(Object.fromEntries(new URL(`http://x${workQueueHref(params)}`).searchParams));
  assert.deepEqual(parsed, params);
});

test("unknown parameter values fall back to defaults instead of erroring", () => {
  const params = parseWorkQueueParams({ filter: "Nonsense", scope: "everyone", sort: "colour", view: "gantt" });
  assert.equal(params.scope, "mine");
  assert.equal(params.filter, "All");
  assert.equal(params.sort, "due");
  assert.equal(params.view, "list");
});

test("owner applies only to the firm scope", () => {
  const owner = "3f1a2b4c-5d6e-4f70-8901-a2b3c4d5e6f7";
  assert.equal(parseWorkQueueParams({ owner, scope: "firm" }).owner, owner);
  assert.equal(parseWorkQueueParams({ owner, scope: "mine" }).owner, null);
  assert.equal(parseWorkQueueParams({ owner, scope: "reviewing" }).owner, null);
});

test("repeated parameters take the first value rather than concatenating", () => {
  assert.equal(parseWorkQueueParams({ scope: ["firm", "mine"] }).scope, "firm");
});

test("the unassigned sentinel survives parsing but only under the firm scope", () => {
  assert.equal(parseWorkQueueParams({ owner: "unassigned", scope: "firm" }).owner, "unassigned");
  assert.equal(parseWorkQueueParams({ owner: "unassigned", scope: "mine" }).owner, null);
});

test("the over-budget flag is a real filter, not a sort", () => {
  assert.equal(parseWorkQueueParams({ budget: "over" }).budget, "over");
  assert.equal(parseWorkQueueParams({ budget: "under" }).budget, null);
  assert.equal(parseWorkQueueParams({}).budget, null);
});

test("every preset produces a workspace href that parses back to its own parameters", () => {
  for (const preset of WORK_QUEUE_PRESETS) {
    const href = workQueueHref(preset.params);
    assert.ok(href.startsWith("/?workspace=work"), `${preset.key} must stay on the work workspace`);
    const parsed = parseWorkQueueParams(Object.fromEntries(new URL(`http://x${href}`).searchParams));
    for (const [key, value] of Object.entries(preset.params)) {
      assert.deepEqual(parsed[key as keyof typeof parsed], value, `${preset.key}.${key}`);
    }
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit`
Expected: FAIL — cannot find module `../lib/work/queue-params`.

- [ ] **Step 3: Write the implementation**

Create `lib/work/queue-params.ts`:

```ts
import type { WorkFilter } from "../dashboard/filters";

export type WorkScope = "mine" | "reviewing" | "firm";
export type WorkView = "list" | "board" | "capacity";
export type WorkSort = "due" | "progress" | "client";

export type WorkQueueParams = {
  budget: "over" | null;
  filter: WorkFilter;
  /** A member UUID, or the literal "unassigned" to select work with no assignee. */
  owner: string | null;
  q: string;
  scope: WorkScope;
  service: string | null;
  sort: WorkSort;
  view: WorkView;
};

const SCOPES: readonly WorkScope[] = ["mine", "reviewing", "firm"];
const VIEWS: readonly WorkView[] = ["list", "board", "capacity"];
const SORTS: readonly WorkSort[] = ["due", "progress", "client"];
const FILTERS: readonly WorkFilter[] = ["All", "Overdue", "Due this week", "Critical", "At risk", "Waiting", "Review"];
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SERVICE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{1,59}$/;

export const DEFAULT_WORK_QUEUE_PARAMS: WorkQueueParams = {
  budget: null, filter: "All", owner: null, q: "", scope: "mine", service: null, sort: "due", view: "list",
};

/** Repeated query parameters take the first value; a malformed value is not an error, it is a default. */
function first(raw: Record<string, string | string[] | undefined>, key: string) {
  const value = raw[key];
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

function oneOf<T extends string>(value: string, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

export function parseWorkQueueParams(raw: Record<string, string | string[] | undefined>): WorkQueueParams {
  const scope = oneOf(first(raw, "scope"), SCOPES, DEFAULT_WORK_QUEUE_PARAMS.scope);
  const owner = first(raw, "owner");
  const service = first(raw, "service");
  return {
    budget: first(raw, "budget") === "over" ? "over" : null,
    filter: oneOf(first(raw, "filter"), FILTERS, DEFAULT_WORK_QUEUE_PARAMS.filter),
    // Under mine/reviewing the owner is already the viewer, so an owner value is ignored rather than intersected.
    owner: scope === "firm" && (owner === "unassigned" || UUID_PATTERN.test(owner)) ? owner : null,
    q: first(raw, "q").slice(0, 120),
    scope,
    service: SERVICE_PATTERN.test(service) ? service : null,
    sort: oneOf(first(raw, "sort"), SORTS, DEFAULT_WORK_QUEUE_PARAMS.sort),
    view: oneOf(first(raw, "view"), VIEWS, DEFAULT_WORK_QUEUE_PARAMS.view),
  };
}

export function workQueueHref(params: Partial<WorkQueueParams>): string {
  const search = new URLSearchParams({ workspace: "work" });
  const merged = { ...DEFAULT_WORK_QUEUE_PARAMS, ...params };
  for (const key of ["scope", "filter", "sort", "view"] as const) {
    if (merged[key] !== DEFAULT_WORK_QUEUE_PARAMS[key]) search.set(key, merged[key]);
  }
  if (merged.q) search.set("q", merged.q);
  if (merged.owner && merged.scope === "firm") search.set("owner", merged.owner);
  if (merged.service) search.set("service", merged.service);
  if (merged.budget) search.set("budget", merged.budget);
  return `/?${search.toString()}`;
}

export const WORK_QUEUE_PRESETS = [
  { key: "my-overdue", label: "My overdue", params: { filter: "Overdue", scope: "mine" } },
  { key: "awaiting-client", label: "Awaiting client", params: { filter: "Waiting", scope: "firm" } },
  { key: "my-reviews", label: "Ready for my review", params: { filter: "Review", scope: "reviewing" } },
  { key: "over-budget", label: "Over budget", params: { budget: "over", scope: "firm" } },
  { key: "unassigned", label: "Unassigned", params: { owner: "unassigned", scope: "firm" } },
] as const satisfies ReadonlyArray<{ key: string; label: string; params: Partial<WorkQueueParams> }>;
```

Note the round-trip test constrains `workQueueHref`: it must omit defaults but `parseWorkQueueParams` must reproduce them, which the code above satisfies.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/work/queue-params.ts tests/work-queue-unit.test.ts
git commit -m "feat: parse work queue view state from the query string"
```

---

### Task 5: Capacity and burn arithmetic

**Files:**
- Create: `lib/work/capacity.ts`
- Test: `tests/work-queue-unit.test.ts` (append)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `workingDaysInMask(mask: string): number`
  - `weeklyAvailableMinutes(fullDayMinutes: number, mask: string): number`
  - `remainingBudgetMinutes(budgetMinutes: number | null, progress: number): number`
  - `weekStartKey(dateKey: string): string`
  - `capacityHorizonWeeks(todayKey: string, weeks: number): string[]`
  - `burnPercentage(loggedMinutes: number, budgetMinutes: number | null): number | null`

- [ ] **Step 1: Write the failing test**

Append to `tests/work-queue-unit.test.ts`:

```ts
import { burnPercentage, capacityHorizonWeeks, remainingBudgetMinutes, weeklyAvailableMinutes, weekStartKey, workingDaysInMask } from "../lib/work/capacity";

test("working days come from the configured week mask", () => {
  assert.equal(workingDaysInMask("1111110"), 6);
  assert.equal(workingDaysInMask("1111100"), 5);
  assert.equal(workingDaysInMask("0000000"), 0);
});

test("weekly available minutes multiply the shift full day by its working days", () => {
  assert.equal(weeklyAvailableMinutes(450, "1111110"), 2700);
  assert.equal(weeklyAvailableMinutes(450, "1111100"), 2250);
});

test("remaining budget discounts work already done", () => {
  assert.equal(remainingBudgetMinutes(100, 0), 100);
  assert.equal(remainingBudgetMinutes(100, 90), 10);
  assert.equal(remainingBudgetMinutes(100, 100), 0);
});

test("an unbudgeted item contributes nothing to load rather than a zero-minute estimate", () => {
  assert.equal(remainingBudgetMinutes(null, 50), 0);
});

test("weeks start on Monday regardless of which day the date falls on", () => {
  assert.equal(weekStartKey("2026-08-20"), "2026-08-17");
  assert.equal(weekStartKey("2026-08-17"), "2026-08-17");
  assert.equal(weekStartKey("2026-08-23"), "2026-08-17");
  assert.equal(weekStartKey("2026-08-24"), "2026-08-24");
});

test("the capacity horizon is consecutive week starts beginning with the current week", () => {
  assert.deepEqual(capacityHorizonWeeks("2026-08-20", 4), ["2026-08-17", "2026-08-24", "2026-08-31", "2026-09-07"]);
});

test("burn percentage is null when no budget exists, so the view can say so", () => {
  assert.equal(burnPercentage(120, null), null);
  assert.equal(burnPercentage(0, 90), 0);
  assert.equal(burnPercentage(45, 90), 50);
  assert.equal(burnPercentage(180, 90), 200);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit`
Expected: FAIL — cannot find module `../lib/work/capacity`.

- [ ] **Step 3: Write the implementation**

Create `lib/work/capacity.ts`:

```ts
const DAY_MS = 86_400_000;

/** The mask is Monday-first, one character per weekday, '1' meaning a working day. */
export function workingDaysInMask(mask: string) {
  return [...mask].filter((day) => day === "1").length;
}

export function weeklyAvailableMinutes(fullDayMinutes: number, mask: string) {
  return fullDayMinutes * workingDaysInMask(mask);
}

/**
 * Effort still to come, not effort estimated. A job at 90% stops consuming a
 * full job's capacity. An unbudgeted job contributes nothing — the lane reports
 * its unbudgeted count separately rather than guessing a number here.
 */
export function remainingBudgetMinutes(budgetMinutes: number | null, progress: number) {
  if (budgetMinutes === null) return 0;
  return Math.round((budgetMinutes * (100 - progress)) / 100);
}

/** Parsed at midnight UTC so a week boundary does not move with the reader's timezone. */
export function weekStartKey(dateKey: string) {
  const date = new Date(`${dateKey}T00:00:00Z`);
  const weekday = (date.getUTCDay() + 6) % 7;
  return new Date(date.valueOf() - weekday * DAY_MS).toISOString().slice(0, 10);
}

export function capacityHorizonWeeks(todayKey: string, weeks: number) {
  const start = Date.parse(`${weekStartKey(todayKey)}T00:00:00Z`);
  return Array.from({ length: weeks }, (_unused, index) => new Date(start + index * 7 * DAY_MS).toISOString().slice(0, 10));
}

export function burnPercentage(loggedMinutes: number, budgetMinutes: number | null) {
  if (budgetMinutes === null || budgetMinutes <= 0) return null;
  return Math.round((loggedMinutes / budgetMinutes) * 100);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/work/capacity.ts tests/work-queue-unit.test.ts
git commit -m "feat: add capacity and burn arithmetic"
```

---

### Task 6: The queue reads

**Files:**
- Create: `lib/work/queue.ts`
- Test: `tests/postgres-integration.test.ts` (Task 12)

**Interfaces:**
- Consumes: `WorkQueueParams` (Task 4), `workItems`, `legalEntities`, `users`, `timeEntries` from `db/schema`, `DashboardDatabase` from `lib/dashboard/postgres/repository`.
- Produces:
  - `type WorkQueueRow = { assigneeId: string | null; budgetMinutes: number | null; client: string; clientInitials: string; id: string; internalDueDate: string | null; loggedMinutes: number; missingItemCount: number; owner: string; ownerInitials: string; periodKey: string; progress: number; reviewerId: string | null; serviceKey: string; status: WorkStatus; statutoryDueDate: string; blockerNote: string }`
  - `listWorkQueue(database, tenantId, viewerId, params: WorkQueueParams, todayKey: string): Promise<WorkQueueRow[]>`
  - `getQueueTotals(database, tenantId, viewerId, params: WorkQueueParams, todayKey: string): Promise<{ active: number; overdue: number; review: number; waiting: number }>`

- [ ] **Step 1: Write the module**

Create `lib/work/queue.ts`. Build the scope and filter predicates as composable Drizzle conditions and let SQL do the work:

```ts
import { and, asc, eq, ilike, isNull, lt, lte, ne, or, sql, type SQL } from "drizzle-orm";

import { legalEntities, timeEntries, users, workItems } from "../../db/schema";
import type { DashboardDatabase } from "../dashboard/postgres/repository";
import type { WorkStatus } from "../dashboard/types";
import type { WorkQueueParams, WorkScope } from "./queue-params";

const STATUS_LABELS: Record<string, WorkStatus> = {
  critical: "Critical", at_risk: "At risk", waiting: "Waiting", review: "Review", completed: "Completed",
};

export type WorkQueueRow = {
  assigneeId: string | null;
  blockerNote: string;
  budgetMinutes: number | null;
  client: string;
  clientInitials: string;
  id: string;
  internalDueDate: string | null;
  loggedMinutes: number;
  missingItemCount: number;
  owner: string;
  ownerInitials: string;
  periodKey: string;
  progress: number;
  reviewerId: string | null;
  serviceKey: string;
  status: WorkStatus;
  statutoryDueDate: string;
};

function initialsOf(value: string) {
  return value.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]!.toUpperCase()).join("") || "??";
}

/** Scope is resolved from the session user, never from a client-supplied identity. */
function scopePredicate(scope: WorkScope, viewerId: string, owner: string | null) {
  if (scope === "mine") return eq(workItems.assigneeId, viewerId);
  if (scope === "reviewing") return eq(workItems.reviewerId, viewerId);
  if (owner === "unassigned") return isNull(workItems.assigneeId);
  return owner ? eq(workItems.assigneeId, owner) : undefined;
}

/** Logged time exceeding a recorded budget. An unbudgeted item can never be over budget. */
const OVER_BUDGET = sql`${workItems.budgetMinutes} is not null and (
  select coalesce(sum(${timeEntries.minutes}), 0)
  from ${timeEntries}
  where ${timeEntries.tenantId} = ${workItems.tenantId} and ${timeEntries.workItemId} = ${workItems.id}
) > ${workItems.budgetMinutes}`;

function filterPredicate(params: WorkQueueParams, todayKey: string) {
  switch (params.filter) {
    case "All": return undefined;
    case "Overdue": return lt(sql`coalesce(${workItems.internalDueDate}, ${workItems.statutoryDueDate})`, todayKey);
    case "Due this week": return and(
      sql`coalesce(${workItems.internalDueDate}, ${workItems.statutoryDueDate}) >= ${todayKey}`,
      sql`coalesce(${workItems.internalDueDate}, ${workItems.statutoryDueDate}) <= ${todayKey}::date + 7`,
    );
    case "Critical": return eq(workItems.status, "critical");
    case "At risk": return eq(workItems.status, "at_risk");
    case "Waiting": return eq(workItems.status, "waiting");
    case "Review": return eq(workItems.status, "review");
    default: return undefined;
  }
}

function conditions(tenantId: string, viewerId: string, params: WorkQueueParams, todayKey: string) {
  const parts: Array<SQL | undefined> = [
    eq(workItems.tenantId, tenantId),
    eq(legalEntities.status, "active"),
    ne(workItems.status, "completed"),
    scopePredicate(params.scope, viewerId, params.owner),
    filterPredicate(params, todayKey),
    params.budget === "over" ? OVER_BUDGET : undefined,
    params.service ? sql`upper(${workItems.serviceKey}) = ${params.service.toUpperCase()}` : undefined,
    params.q
      ? or(
        ilike(legalEntities.displayName, `%${params.q}%`),
        ilike(workItems.serviceKey, `%${params.q}%`),
        ilike(users.fullName, `%${params.q}%`),
      )
      : undefined,
  ];
  return and(...parts.filter(Boolean));
}
```

Then `listWorkQueue` selects the row shape with a correlated logged-minutes subquery and sorts in SQL:

```ts
export async function listWorkQueue(
  database: DashboardDatabase,
  tenantId: string,
  viewerId: string,
  params: WorkQueueParams,
  todayKey: string,
): Promise<WorkQueueRow[]> {
  if (!tenantId.trim() || !viewerId.trim()) throw new Error("Tenant and viewer are required.");
  const loggedMinutes = sql<number>`(
    select coalesce(sum(${timeEntries.minutes}), 0)
    from ${timeEntries}
    where ${timeEntries.tenantId} = ${workItems.tenantId} and ${timeEntries.workItemId} = ${workItems.id}
  )`;
  const rows = await database.select({
    assigneeId: workItems.assigneeId,
    blockerNote: workItems.blockerNote,
    budgetMinutes: workItems.budgetMinutes,
    client: legalEntities.displayName,
    id: workItems.id,
    internalDueDate: workItems.internalDueDate,
    loggedMinutes,
    missingItemCount: workItems.missingItemCount,
    owner: users.fullName,
    periodKey: workItems.periodKey,
    progress: workItems.progress,
    reviewerId: workItems.reviewerId,
    serviceKey: workItems.serviceKey,
    status: workItems.status,
    statutoryDueDate: workItems.statutoryDueDate,
  }).from(workItems)
    .innerJoin(legalEntities, and(eq(legalEntities.id, workItems.legalEntityId), eq(legalEntities.tenantId, tenantId)))
    .leftJoin(users, eq(users.id, workItems.assigneeId))
    .where(conditions(tenantId, viewerId, params, todayKey))
    .orderBy(
      params.sort === "progress" ? asc(workItems.progress)
        : params.sort === "client" ? asc(legalEntities.displayName)
        : asc(sql`coalesce(${workItems.internalDueDate}, ${workItems.statutoryDueDate})`),
    );
  return rows.map((row) => ({
    ...row,
    clientInitials: initialsOf(row.client),
    loggedMinutes: Number(row.loggedMinutes),
    owner: row.owner ?? "Unassigned",
    ownerInitials: row.owner ? initialsOf(row.owner) : "—",
    status: STATUS_LABELS[row.status] ?? "Critical",
  }));
}
```

`getQueueTotals` runs one aggregate under the same scope, with the filter forced to `All` so the cards describe the scope rather than the current narrowing:

```ts
export async function getQueueTotals(
  database: DashboardDatabase,
  tenantId: string,
  viewerId: string,
  params: WorkQueueParams,
  todayKey: string,
) {
  const scoped = { ...params, filter: "All" as const, q: "" };
  const [totals] = await database.select({
    active: sql<number>`count(*)`,
    overdue: sql<number>`count(*) filter (where coalesce(${workItems.internalDueDate}, ${workItems.statutoryDueDate}) < ${todayKey})`,
    review: sql<number>`count(*) filter (where ${workItems.status} = 'review')`,
    waiting: sql<number>`count(*) filter (where ${workItems.status} = 'waiting')`,
  }).from(workItems)
    .innerJoin(legalEntities, and(eq(legalEntities.id, workItems.legalEntityId), eq(legalEntities.tenantId, tenantId)))
    .leftJoin(users, eq(users.id, workItems.assigneeId))
    .where(conditions(tenantId, viewerId, scoped, todayKey));
  return {
    active: Number(totals?.active ?? 0),
    overdue: Number(totals?.overdue ?? 0),
    review: Number(totals?.review ?? 0),
    waiting: Number(totals?.waiting ?? 0),
  };
}
```

Drop `lte` from the import list — the final code does not reference it, and `npm run lint` will flag it. `isNull` is used by the unassigned predicate.

- [ ] **Step 2: Verify it compiles and lints**

Run: `npm run lint && npm run build`
Expected: both succeed. Behavioural coverage lands in Task 12; this step only proves the module type-checks.

- [ ] **Step 3: Commit**

```bash
git add lib/work/queue.ts
git commit -m "feat: add scoped server-side work queue reads"
```

---

### Task 7: Capacity lanes

**Files:**
- Modify: `lib/work/queue.ts`

**Interfaces:**
- Consumes: `weeklyAvailableMinutes`, `remainingBudgetMinutes`, `weekStartKey`, `capacityHorizonWeeks` (Task 5); `employeeWorkProfiles`, `shiftTypes`, `tenantMemberships` from `db/schema`.
- Produces: `type CapacityCell = { availableMinutes: number; loadMinutes: number; unbudgetedCount: number; weekStart: string }`, `type CapacityLane = { availableMinutes: number; memberId: string; memberName: string; weeks: CapacityCell[] }`, `getCapacityLanes(database, tenantId, todayKey, weeks?): Promise<CapacityLane[]>`

- [ ] **Step 1: Write the implementation**

Append to `lib/work/queue.ts`:

```ts
export type CapacityCell = { availableMinutes: number; loadMinutes: number; unbudgetedCount: number; weekStart: string };
export type CapacityLane = { availableMinutes: number; memberId: string; memberName: string; weeks: CapacityCell[] };

const CAPACITY_WEEKS = 4;

export async function getCapacityLanes(
  database: DashboardDatabase,
  tenantId: string,
  todayKey: string,
  weeks = CAPACITY_WEEKS,
): Promise<CapacityLane[]> {
  if (!tenantId.trim()) throw new Error("tenantId is required.");
  const horizon = capacityHorizonWeeks(todayKey, weeks);
  const horizonEnd = new Date(Date.parse(`${horizon.at(-1)!}T00:00:00Z`) + 7 * 86_400_000).toISOString().slice(0, 10);
  const defaultShift = alias(shiftTypes, "default_shift");

  const members = await database.select({
    fullDayMinutes: sql<number>`coalesce(${shiftTypes.fullDayMinutes}, ${defaultShift.fullDayMinutes}, 450)`,
    memberId: users.id,
    memberName: users.fullName,
    workingWeekMask: sql<string>`coalesce(${shiftTypes.workingWeekMask}, ${defaultShift.workingWeekMask}, '1111110')`,
  }).from(tenantMemberships)
    .innerJoin(users, eq(users.id, tenantMemberships.userId))
    .innerJoin(employeeWorkProfiles, and(
      eq(employeeWorkProfiles.tenantId, tenantId),
      eq(employeeWorkProfiles.employeeUserId, tenantMemberships.userId),
    ))
    .leftJoin(shiftTypes, and(eq(shiftTypes.tenantId, tenantId), eq(shiftTypes.id, employeeWorkProfiles.shiftTypeId)))
    .leftJoin(defaultShift, and(eq(defaultShift.tenantId, tenantId), eq(defaultShift.isDefault, true), eq(defaultShift.status, "active")))
    .where(and(
      eq(tenantMemberships.tenantId, tenantId),
      eq(tenantMemberships.status, "active"),
      eq(users.status, "active"),
    )).orderBy(asc(users.fullName));

  const open = await database.select({
    assigneeId: workItems.assigneeId,
    budgetMinutes: workItems.budgetMinutes,
    bucketDate: sql<string>`coalesce(${workItems.internalDueDate}, ${workItems.statutoryDueDate})`,
    progress: workItems.progress,
  }).from(workItems)
    .innerJoin(legalEntities, and(eq(legalEntities.id, workItems.legalEntityId), eq(legalEntities.tenantId, tenantId)))
    .where(and(
      eq(workItems.tenantId, tenantId),
      eq(legalEntities.status, "active"),
      ne(workItems.status, "completed"),
      sql`coalesce(${workItems.internalDueDate}, ${workItems.statutoryDueDate}) >= ${horizon[0]}`,
      sql`coalesce(${workItems.internalDueDate}, ${workItems.statutoryDueDate}) < ${horizonEnd}`,
    ));

  return members.map((member) => {
    const availableMinutes = weeklyAvailableMinutes(Number(member.fullDayMinutes), member.workingWeekMask);
    const mine = open.filter((item) => item.assigneeId === member.memberId);
    return {
      availableMinutes,
      memberId: member.memberId,
      memberName: member.memberName,
      weeks: horizon.map((weekStart) => {
        const inWeek = mine.filter((item) => weekStartKey(item.bucketDate) === weekStart);
        return {
          availableMinutes,
          loadMinutes: inWeek.reduce((total, item) => total + remainingBudgetMinutes(item.budgetMinutes, item.progress), 0),
          // Reported separately so an empty-looking lane reads as unknown, not free.
          unbudgetedCount: inWeek.filter((item) => item.budgetMinutes === null).length,
          weekStart,
        };
      }),
    };
  });
}
```

Add `alias` from `drizzle-orm/pg-core`, the `employeeWorkProfiles`, `shiftTypes`, `tenantMemberships` schema imports, and the four `./capacity` imports to the top of the file.

- [ ] **Step 2: Verify it compiles and lints**

Run: `npm run lint && npm run build`
Expected: both succeed.

- [ ] **Step 3: Commit**

```bash
git add lib/work/queue.ts
git commit -m "feat: derive capacity lanes from configured shift data"
```

---

### Task 8: Bulk action planning

**Files:**
- Create: `lib/work/bulk.ts`
- Test: `tests/work-queue-unit.test.ts` (append)

**Interfaces:**
- Consumes: `WorkQueueRow` (Task 6).
- Produces:
  - `type BulkAction = { kind: "assignee"; memberId: string | null } | { kind: "reviewer"; memberId: string | null } | { kind: "internalDue"; shiftDays: number } | { kind: "status"; status: "critical" | "at_risk" | "waiting" | "review" }`
  - `type BulkPlanItem = { id: string; internalDueDate?: string | null }`
  - `type BulkPlan = { apply: BulkPlanItem[]; skip: Array<{ id: string; reason: string }> }`
  - `planBulkChange(items: BulkPlanCandidate[], action: BulkAction): BulkPlan`
  - `type BulkPlanCandidate = Pick<WorkQueueRow, "assigneeId" | "blockerNote" | "id" | "internalDueDate" | "reviewerId" | "statutoryDueDate">`

- [ ] **Step 1: Write the failing test**

Append to `tests/work-queue-unit.test.ts`:

```ts
import { planBulkChange } from "../lib/work/bulk";

const candidate = (over: Partial<Parameters<typeof planBulkChange>[0][number]> = {}) => ({
  assigneeId: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa",
  blockerNote: "",
  id: "11111111-1111-4111-8111-111111111111",
  internalDueDate: "2026-08-17",
  reviewerId: null,
  statutoryDueDate: "2026-08-20",
  ...over,
});

test("bulk reassign skips items where the new assignee already reviews them", () => {
  const reviewer = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";
  const plan = planBulkChange(
    [candidate(), candidate({ id: "22222222-2222-4222-8222-222222222222", reviewerId: reviewer })],
    { kind: "assignee", memberId: reviewer },
  );
  assert.equal(plan.apply.length, 1);
  assert.equal(plan.skip.length, 1);
  assert.match(plan.skip[0]!.reason, /already reviews/i);
});

test("shifting the internal date never crosses the statutory date", () => {
  const plan = planBulkChange([candidate(), candidate({ id: "33333333-3333-4333-8333-333333333333", internalDueDate: "2026-08-19" })], { kind: "internalDue", shiftDays: 3 });
  assert.equal(plan.apply.length, 1);
  assert.equal(plan.apply[0]!.internalDueDate, "2026-08-20");
  assert.match(plan.skip[0]!.reason, /statutory/i);
});

test("shifting an item with no internal date starts from its statutory date", () => {
  const plan = planBulkChange([candidate({ internalDueDate: null })], { kind: "internalDue", shiftDays: -2 });
  assert.equal(plan.apply[0]!.internalDueDate, "2026-08-18");
});

test("bulk status cannot complete work", () => {
  assert.throws(() => planBulkChange([candidate()], { kind: "status", status: "completed" as never }), /completed/i);
});

test("bulk status to waiting requires a recorded dependency", () => {
  const plan = planBulkChange(
    [candidate(), candidate({ id: "44444444-4444-4444-8444-444444444444", blockerNote: "Awaiting bank statements" })],
    { kind: "status", status: "waiting" },
  );
  assert.equal(plan.apply.length, 1);
  assert.equal(plan.apply[0]!.id, "44444444-4444-4444-8444-444444444444");
  assert.match(plan.skip[0]!.reason, /dependency/i);
});

test("an empty selection plans nothing rather than throwing", () => {
  assert.deepEqual(planBulkChange([], { kind: "assignee", memberId: null }), { apply: [], skip: [] });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit`
Expected: FAIL — cannot find module `../lib/work/bulk`.

- [ ] **Step 3: Write the implementation**

Create `lib/work/bulk.ts`:

```ts
import type { WorkQueueRow } from "./queue";

export type BulkAction =
  | { kind: "assignee"; memberId: string | null }
  | { kind: "reviewer"; memberId: string | null }
  | { kind: "internalDue"; shiftDays: number }
  | { kind: "status"; status: "critical" | "at_risk" | "waiting" | "review" };

export type BulkPlanCandidate = Pick<WorkQueueRow, "assigneeId" | "blockerNote" | "id" | "internalDueDate" | "reviewerId" | "statutoryDueDate">;
export type BulkPlanItem = { id: string; internalDueDate?: string | null };
export type BulkPlan = { apply: BulkPlanItem[]; skip: Array<{ id: string; reason: string }> };

const DAY_MS = 86_400_000;

function shiftDateKey(dateKey: string, days: number) {
  return new Date(Date.parse(`${dateKey}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Validates the whole selection before anything is written. Three database
 * checks bound what a batch may do, and a violated check aborts the entire
 * transaction — so an item that would violate one is skipped with a reason a
 * user can act on, never silently dropped.
 */
export function planBulkChange(items: BulkPlanCandidate[], action: BulkAction): BulkPlan {
  if (action.kind === "status" && (action.status as string) === "completed") {
    throw new Error("Work items cannot be marked completed from a bulk action.");
  }
  const plan: BulkPlan = { apply: [], skip: [] };
  for (const item of items) {
    if (action.kind === "assignee" && action.memberId && item.reviewerId === action.memberId) {
      plan.skip.push({ id: item.id, reason: "That member already reviews this item." });
      continue;
    }
    if (action.kind === "reviewer" && action.memberId && item.assigneeId === action.memberId) {
      plan.skip.push({ id: item.id, reason: "That member is already the assignee on this item." });
      continue;
    }
    if (action.kind === "internalDue") {
      const internalDueDate = shiftDateKey(item.internalDueDate ?? item.statutoryDueDate, action.shiftDays);
      if (internalDueDate > item.statutoryDueDate) {
        plan.skip.push({ id: item.id, reason: "The shifted internal date would fall after the statutory date." });
        continue;
      }
      plan.apply.push({ id: item.id, internalDueDate });
      continue;
    }
    if (action.kind === "status" && action.status === "waiting" && item.blockerNote.trim().length < 3) {
      plan.skip.push({ id: item.id, reason: "Waiting needs a recorded dependency on the item." });
      continue;
    }
    plan.apply.push({ id: item.id });
  }
  return plan;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/work/bulk.ts tests/work-queue-unit.test.ts
git commit -m "feat: pre-validate bulk work changes against database checks"
```

---

### Task 9: Bulk repository write and Server Action

**Files:**
- Modify: `lib/work/repository.ts` (add `applyBulkWorkChange`)
- Create: `app/work/bulk-actions.ts`

**Interfaces:**
- Consumes: `planBulkChange`, `BulkAction` (Task 8); `listWorkQueue` (Task 6).
- Produces:
  - `applyBulkWorkChange(database, tenantId, actorUserId, workItemIds, action): Promise<BulkPlan>`
  - `applyBulkWorkAction(previous: BulkActionState, formData: FormData): Promise<BulkActionState>` where `type BulkActionState = { error: string; applied: number; skipped: Array<{ id: string; reason: string }> }`

- [ ] **Step 1: Add the repository write**

Append to `lib/work/repository.ts`:

```ts
export async function applyBulkWorkChange(
  database: DashboardDatabase,
  tenantId: string,
  actorUserId: string,
  workItemIds: string[],
  action: BulkAction,
): Promise<BulkPlan> {
  if (!tenantId.trim() || !actorUserId.trim()) throw new Error("Tenant and actor are required.");
  if (!workItemIds.length) return { apply: [], skip: [] };
  return database.transaction(async (transaction) => {
    if (action.kind === "assignee" || action.kind === "reviewer") {
      await assertActiveMember(transaction, tenantId, action.memberId);
    }
    const current = await transaction.select({
      assigneeId: workItems.assigneeId,
      blockerNote: workItems.blockerNote,
      id: workItems.id,
      internalDueDate: workItems.internalDueDate,
      reviewerId: workItems.reviewerId,
      statutoryDueDate: workItems.statutoryDueDate,
    }).from(workItems).where(and(
      eq(workItems.tenantId, tenantId),
      inArray(workItems.id, workItemIds),
      ne(workItems.status, "completed"),
    )).for("update");

    const plan = planBulkChange(current, action);
    for (const item of plan.apply) {
      const set = action.kind === "assignee" ? { assigneeId: action.memberId }
        : action.kind === "reviewer" ? { reviewerId: action.memberId }
        : action.kind === "internalDue" ? { internalDueDate: item.internalDueDate! }
        : { status: action.status };
      await transaction.update(workItems).set({ ...set, updatedAt: new Date() })
        .where(and(eq(workItems.id, item.id), eq(workItems.tenantId, tenantId), ne(workItems.status, "completed")));
      // One event per item so Work Item 360 history stays per-item rather than
      // showing one opaque "bulk edit".
      await transaction.insert(auditEvents).values({
        tenantId,
        actorUserId,
        resourceType: "work_item",
        resourceId: item.id,
        action: `work.bulk.${action.kind}`,
        reason: "Changed from a My Work bulk action",
      });
    }
    return plan;
  });
}
```

Add `inArray` to the `drizzle-orm` import and import `planBulkChange`, `type BulkAction`, `type BulkPlan` from `./bulk`.

- [ ] **Step 2: Add the Server Action**

Create `app/work/bulk-actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "../../lib/auth/server";
import { hasPermission } from "../../lib/auth/authorization";
import { getDatabase } from "../../lib/dashboard/postgres/pool";
import { applyBulkWorkChange } from "../../lib/work/repository";
import type { BulkAction } from "../../lib/work/bulk";

export type BulkActionState = { applied: number; error: string; skipped: Array<{ id: string; reason: string }> };
export const emptyBulkActionState: BulkActionState = { applied: 0, error: "", skipped: [] };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BULK_STATUSES = ["critical", "at_risk", "waiting", "review"] as const;

function readAction(formData: FormData): BulkAction | null {
  const kind = String(formData.get("kind") ?? "");
  const memberId = String(formData.get("memberId") ?? "").trim() || null;
  if (kind === "assignee" || kind === "reviewer") {
    if (memberId && !UUID_PATTERN.test(memberId)) return null;
    return { kind, memberId };
  }
  if (kind === "internalDue") {
    const shiftDays = Number(formData.get("shiftDays"));
    if (!Number.isInteger(shiftDays) || shiftDays === 0 || Math.abs(shiftDays) > 60) return null;
    return { kind, shiftDays };
  }
  if (kind === "status") {
    const status = String(formData.get("status") ?? "");
    if (!BULK_STATUSES.includes(status as never)) return null;
    return { kind, status: status as typeof BULK_STATUSES[number] };
  }
  return null;
}

export async function applyBulkWorkAction(_previous: BulkActionState, formData: FormData): Promise<BulkActionState> {
  const session = await requirePermission("dashboard:read", "/?workspace=work");
  if (!hasPermission(session, "work:write")) {
    return { ...emptyBulkActionState, error: "You do not have permission to change work items." };
  }
  const action = readAction(formData);
  if (!action) return { ...emptyBulkActionState, error: "Choose a valid bulk change." };
  const workItemIds = formData.getAll("workItemId").map(String).filter((id) => UUID_PATTERN.test(id));
  if (!workItemIds.length) return { ...emptyBulkActionState, error: "Select at least one work item." };

  try {
    const plan = await applyBulkWorkChange(getDatabase(), session.tenantId, session.userId, workItemIds, action);
    revalidatePath("/");
    return { applied: plan.apply.length, error: "", skipped: plan.skip };
  } catch (error) {
    console.error("Bulk work change failed.", { errorType: error instanceof Error ? error.name : "UnknownError" });
    return { ...emptyBulkActionState, error: "That bulk change could not be applied." };
  }
}
```

- [ ] **Step 3: Verify**

Run: `npm run test:unit && npm run lint && npm run build`
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add lib/work/repository.ts app/work/bulk-actions.ts
git commit -m "feat: apply audited bulk work changes"
```

---

### Task 10: Server-render the workspace

**Files:**
- Modify: `app/page.tsx`, `app/dashboard-client.tsx:59-64,106`, `app/dashboard/work-workspace.tsx`, `app/dashboard/dashboard-ui.tsx`, `app/globals.css`

**Interfaces:**
- Consumes: `listWorkQueue`, `getQueueTotals`, `getCapacityLanes` (Tasks 6-7); `parseWorkQueueParams`, `workQueueHref`, `WORK_QUEUE_PRESETS` (Task 4); `burnPercentage` (Task 5).
- Produces: `type WorkQueueViewData = { canWrite: boolean; lanes: CapacityLane[]; members: WorkMemberOption[]; params: WorkQueueParams; rows: WorkQueueRow[]; todayKey: string; totals: Awaited<ReturnType<typeof getQueueTotals>> }` passed as a single `workQueue` prop through `DashboardClient` to `WorkWorkspace`.

- [ ] **Step 1: Load the data in the page**

In `app/page.tsx`, widen the `searchParams` type with `filter?: string; owner?: string; q?: string; scope?: string; service?: string; sort?: string; view?: string`, and after the existing permission checks:

```tsx
    const workQueueParams = parseWorkQueueParams(query as Record<string, string | undefined>);
    const wantsWorkQueue = initialWorkspace === "My work";
```

Add three entries to the existing `Promise.all`, guarded so other workspaces pay nothing:

```tsx
        wantsWorkQueue ? listWorkQueue(getDatabase(), session.tenantId, session.userId, workQueueParams, indiaDateKey()) : Promise.resolve([]),
        wantsWorkQueue ? getQueueTotals(getDatabase(), session.tenantId, session.userId, workQueueParams, indiaDateKey()) : Promise.resolve({ active: 0, overdue: 0, review: 0, waiting: 0 }),
        wantsWorkQueue && workQueueParams.view === "capacity" ? getCapacityLanes(getDatabase(), session.tenantId, indiaDateKey()) : Promise.resolve([]),
```

Destructure them into `workQueueRows`, `workQueueTotals`, `workQueueLanes`, and pass one prop to `DashboardClient`:

```tsx
        workQueue={{ canWrite: hasPermission(session, "work:write"), lanes: workQueueLanes, members: workMembers, params: workQueueParams, rows: workQueueRows, todayKey: indiaDateKey(), totals: workQueueTotals }}
```

`workMembers` comes from `listWorkMembers(getDatabase(), session.tenantId)` under the same guard — the bulk bar needs the member list. Import `indiaDateKey` from `../lib/registers/repository` (already used by the Work 360 route).

For the non-PostgreSQL demo branch at the bottom of the file, pass `workQueue={{ canWrite: false, lanes: [], members: [], params: DEFAULT_WORK_QUEUE_PARAMS, rows: [], todayKey: data.todayKey, totals: { active: 0, overdue: 0, review: 0, waiting: 0 } }}`.

- [ ] **Step 2: Stop filtering work client-side**

In `app/dashboard-client.tsx`, delete the `items` `useMemo` at lines 59-64 and the `filter`/`query` state feeding it (keep `matchesClientHealthFilter`; drop the now-unused `matchesWorkFilter` import). Accept the new `workQueue` prop and render:

```tsx
<WorkWorkspace {...workQueue} />
```

- [ ] **Step 3: Rewrite the workspace**

Rewrite `app/dashboard/work-workspace.tsx` against the new props. Keep `URGENCY`, `BOARD_COLUMNS`, `dueChip`, and `statusTone` — the grouping logic is unchanged — but drive dates from `internalDueDate ?? statutoryDueDate`, drop `useState` for view/sort in favour of links, and add the scope tabs and presets above the toolbar:

```tsx
<nav aria-label="Work scope" className="segment-control work-scope-tabs">
  {SCOPES.map((scope) => (
    <Link aria-current={params.scope === scope.key ? "page" : undefined} href={workQueueHref({ ...params, scope: scope.key })} key={scope.key}>{scope.label}</Link>
  ))}
</nav>
<nav aria-label="Preset views" className="work-presets">
  {WORK_QUEUE_PRESETS.map((preset) => <Link href={workQueueHref(preset.params)} key={preset.key}>{preset.label}</Link>)}
</nav>
```

with `const SCOPES = [{ key: "mine", label: "Assigned to me" }, { key: "reviewing", label: "I review" }, { key: "firm", label: "Whole firm" }] as const;`

The empty state must offer the firm scope when a personal scope is empty:

```tsx
{!rows.length && (
  <EmptyState
    action={params.scope !== "firm" ? <Link href={workQueueHref({ ...params, scope: "firm" })}>View the whole firm&apos;s queue</Link> : undefined}
    description={params.scope === "mine" ? "Nothing is assigned to you under these filters." : params.scope === "reviewing" ? "Nothing is waiting on your review." : "Clear the filters to include completed and upcoming obligations."}
    icon="work"
    title="No active work here"
  />
)}
```

Add an `action` prop to `EmptyState` in `app/dashboard/dashboard-ui.tsx` if it does not already accept one.

- [ ] **Step 4: Rewrite the row**

`WorkRow` currently wraps everything in one `<Link>`. A checkbox cannot be nested inside an anchor. Replace it with a grid container:

```tsx
function WorkRow({ canWrite, item, todayKey }: { canWrite: boolean; item: WorkQueueRow; todayKey: string }) {
  const effectiveDue = item.internalDueDate ?? item.statutoryDueDate;
  const chip = dueChip(dayDifference(effectiveDue, todayKey));
  const burn = burnPercentage(item.loggedMinutes, item.budgetMinutes);
  return (
    <div className="work-workspace-row">
      {canWrite && (
        <label className="work-row-select">
          <input aria-label={`Select ${item.client} ${item.serviceKey} ${item.periodKey}`} form="work-bulk-form" name="workItemId" type="checkbox" value={item.id} />
        </label>
      )}
      <Link className="work-row-main" href={`/work/${item.id}`}>
        <InitialsAvatar initials={item.clientInitials} tone="violet" />
        <span><strong>{item.client}</strong><small>{workServiceLabel(item.serviceKey)} · {item.periodKey}</small><em>{item.blockerNote || "No blocker recorded"}</em></span>
      </Link>
      <span className="work-workspace-progress"><ProgressBar label={`${item.client} progress`} value={item.progress} /><small>{item.progress}%</small></span>
      <span className="work-workspace-burn">
        {burn === null ? <small className="work-burn-none">No budget</small> : <small className={`work-burn ${burn > 100 ? "is-over" : ""}`}>{formatMinutes(item.loggedMinutes)} / {formatMinutes(item.budgetMinutes!)}</small>}
      </span>
      <span className="work-workspace-owner"><InitialsAvatar initials={item.ownerInitials} tone="light" /><strong>{item.owner}</strong></span>
      <span className="work-workspace-due">
        <strong>{formatDateKey(effectiveDue)}</strong>
        <small className={`work-due-chip is-${chip.tone}`}>{chip.label}</small>
        {item.internalDueDate && item.internalDueDate !== item.statutoryDueDate && <small className="work-statutory-note">Statutory {formatDateKey(item.statutoryDueDate)}</small>}
      </span>
      {item.missingItemCount > 0 && <span className="work-missing-chip">{item.missingItemCount} missing</span>}
      <StatusBadge tone={statusTone(item.status)}>{item.status}</StatusBadge>
      <DashboardIcon name="arrow" size={17} />
    </div>
  );
}
```

Add local helpers:

```tsx
const formatMinutes = (minutes: number) => (minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`.replace(" 0m", ""));
const formatDateKey = (value: string) => new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
```

The `form="work-bulk-form"` attribute lets checkboxes anywhere in the list submit to the bulk form rendered in Task 12 without nesting forms.

- [ ] **Step 5: Add the styles**

In `app/globals.css`, beside the existing `.work-workspace-row` rules, add `.work-row-select`, `.work-workspace-burn`, `.work-burn.is-over`, `.work-burn-none`, `.work-missing-chip`, `.work-statutory-note`, `.work-scope-tabs`, and `.work-presets`. Match the surrounding token usage — reuse the existing red tone variable for `.is-over` and the muted text token for `.work-burn-none`.

- [ ] **Step 6: Verify**

Run: `npm run lint && npm run build`
Expected: both succeed with no unused-import warnings.

- [ ] **Step 7: Commit**

```bash
git add app/page.tsx app/dashboard-client.tsx app/dashboard/work-workspace.tsx app/globals.css
git commit -m "feat: server-render the work queue with scopes and presets"
```

---

### Task 11: Capacity view

**Files:**
- Create: `app/dashboard/work-capacity-view.tsx`
- Modify: `app/dashboard/work-workspace.tsx`, `app/globals.css`

**Interfaces:**
- Consumes: `CapacityLane`, `CapacityCell` (Task 7); `workQueueHref` (Task 4).
- Produces: `WorkCapacityView({ lanes, params, todayKey })` rendered when `params.view === "capacity"`.

- [ ] **Step 1: Write the component**

Create `app/dashboard/work-capacity-view.tsx`:

```tsx
import Link from "next/link";

import type { CapacityLane } from "../../lib/work/queue";
import type { WorkQueueParams } from "../../lib/work/queue-params";
import { workQueueHref } from "../../lib/work/queue-params";
import { EmptyState } from "./dashboard-ui";

const weekLabel = (weekStart: string) => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${weekStart}T00:00:00Z`));

export function WorkCapacityView({ lanes, params }: { lanes: CapacityLane[]; params: WorkQueueParams }) {
  if (!lanes.length) return <EmptyState description="Capacity needs employees with an attendance work profile." icon="team" title="No capacity to show" />;
  const weeks = lanes[0]!.weeks.map((week) => week.weekStart);
  return (
    <div className="work-capacity">
      <div className="work-capacity-head"><span>Team member</span>{weeks.map((week) => <span key={week}>w/c {weekLabel(week)}</span>)}</div>
      {lanes.map((lane) => (
        <div className="work-capacity-lane" key={lane.memberId}>
          <span className="work-capacity-name">{lane.memberName}</span>
          {lane.weeks.map((cell) => {
            const percentage = cell.availableMinutes > 0 ? Math.round((cell.loadMinutes / cell.availableMinutes) * 100) : 0;
            return (
              <Link
                aria-label={`${lane.memberName}, week starting ${cell.weekStart}: ${percentage}% committed`}
                className={`work-capacity-cell ${percentage > 100 ? "is-over" : percentage >= 80 ? "is-tight" : ""}`}
                href={workQueueHref({ ...params, owner: lane.memberId, scope: "firm", view: "list" })}
                key={cell.weekStart}
              >
                <span className="work-capacity-bar" style={{ "--fill": `${Math.min(percentage, 100)}%` } as React.CSSProperties} />
                <strong>{percentage}%</strong>
                {/* An unbudgeted job contributes no minutes, so say so rather than letting the lane read as free. */}
                {cell.unbudgetedCount > 0 && <em>+{cell.unbudgetedCount} unbudgeted</em>}
              </Link>
            );
          })}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Wire it into the workspace**

In `app/dashboard/work-workspace.tsx`, render it in place of the list and board when `params.view === "capacity"`, and add "Capacity" as a third link in the view toggle via `workQueueHref({ ...params, view: "capacity" })`.

- [ ] **Step 3: Add the styles**

In `app/globals.css` add `.work-capacity`, `.work-capacity-head`, `.work-capacity-lane`, `.work-capacity-name`, `.work-capacity-cell`, `.work-capacity-bar` (width driven by `var(--fill)`), `.work-capacity-cell.is-tight`, and `.work-capacity-cell.is-over`. The grid is `grid-template-columns: minmax(9rem, 1fr) repeat(4, minmax(6rem, 1fr))`, and the whole block needs `overflow-x: auto` so it scrolls on narrow screens rather than forcing the page to.

- [ ] **Step 4: Verify**

Run: `npm run lint && npm run build`
Expected: both succeed.

- [ ] **Step 5: Commit**

```bash
git add app/dashboard/work-capacity-view.tsx app/dashboard/work-workspace.tsx app/globals.css
git commit -m "feat: add the work capacity view"
```

---

### Task 12: Bulk action bar

**Files:**
- Create: `app/dashboard/work-bulk-bar.tsx`
- Modify: `app/dashboard/work-workspace.tsx`

**Interfaces:**
- Consumes: `applyBulkWorkAction`, `emptyBulkActionState`, `BulkActionState` (Task 9); `WorkMemberOption` from `lib/work/repository`.
- Produces: `WorkBulkBar({ members })`, a client component rendering the `work-bulk-form` that the row checkboxes target.

- [ ] **Step 1: Write the component**

Create `app/dashboard/work-bulk-bar.tsx`:

```tsx
"use client";

import { useActionState, useState } from "react";

import { applyBulkWorkAction, emptyBulkActionState } from "../work/bulk-actions";
import type { WorkMemberOption } from "../../lib/work/repository";

const KINDS = [
  { key: "assignee", label: "Reassign" },
  { key: "reviewer", label: "Set reviewer" },
  { key: "internalDue", label: "Shift internal date" },
  { key: "status", label: "Change status" },
] as const;

// 'completed' is absent by design: completion requires progress 100 and no
// missing items, and closing statutory obligations from a checkbox list is the
// wrong affordance regardless.
const STATUSES = [
  { key: "critical", label: "Critical" },
  { key: "at_risk", label: "At risk" },
  { key: "waiting", label: "Waiting" },
  { key: "review", label: "Review" },
] as const;

export function WorkBulkBar({ members }: { members: WorkMemberOption[] }) {
  const [state, action, pending] = useActionState(applyBulkWorkAction, emptyBulkActionState);
  const [kind, setKind] = useState<typeof KINDS[number]["key"]>("assignee");

  return (
    <form action={action} className="work-bulk-bar" id="work-bulk-form">
      <label><span>Bulk change</span>
        <select name="kind" onChange={(event) => setKind(event.target.value as typeof kind)} value={kind}>
          {KINDS.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
        </select>
      </label>

      {(kind === "assignee" || kind === "reviewer") && (
        <label><span>Member</span>
          <select name="memberId"><option value="">Unassigned</option>{members.map((member) => <option key={member.id} value={member.id}>{member.fullName}</option>)}</select>
        </label>
      )}
      {kind === "internalDue" && (
        <label><span>Shift by days</span><input defaultValue={-3} max={60} min={-60} name="shiftDays" type="number" /></label>
      )}
      {kind === "status" && (
        <label><span>Status</span><select name="status">{STATUSES.map((status) => <option key={status.key} value={status.key}>{status.label}</option>)}</select></label>
      )}

      <button disabled={pending} type="submit">{pending ? "Applying…" : "Apply to selected"}</button>

      <p aria-live="polite" className="work-bulk-result">
        {state.error}
        {!state.error && state.applied > 0 && `${state.applied} updated`}
        {!state.error && state.skipped.length > 0 && ` · ${state.skipped.length} skipped: ${state.skipped[0]!.reason}`}
      </p>
    </form>
  );
}
```

- [ ] **Step 2: Render it and verify the checkbox wiring**

In `app/dashboard/work-workspace.tsx`, render `{canWrite && params.view !== "capacity" && <WorkBulkBar members={members} />}` directly above the list. The row checkboxes from Task 10 carry `form="work-bulk-form"`, so they submit with this form despite living outside it — do not nest the list inside the form.

- [ ] **Step 3: Verify by hand**

Run: `npm run dev`, sign in as `loukesh@example.invalid` / `SISPL-Local-2026!`, open `http://localhost:3000/?workspace=work`, select two rows, reassign them, and confirm the result line reports the applied and skipped counts.

- [ ] **Step 4: Verify the suite**

Run: `npm run test:unit && npm run lint && npm run build`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add app/dashboard/work-bulk-bar.tsx app/dashboard/work-workspace.tsx app/globals.css
git commit -m "feat: add the work bulk action bar"
```

---

### Task 13: Integration coverage

**Files:**
- Modify: `tests/postgres-integration.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: no new exports.

- [ ] **Step 1: Write the failing tests**

Append to `tests/postgres-integration.test.ts`, following the file's existing pattern of seeding through the exported repository functions rather than raw inserts:

```ts
test("work queue scopes never cross a tenant boundary", async () => {
  const database = getDatabase();
  const params = { ...DEFAULT_WORK_QUEUE_PARAMS, scope: "firm" as const };
  const rows = await listWorkQueue(database, SEEDED_TENANT_ID, seededAdminUserId, params, "2026-08-20");
  const otherTenantRows = await database.select({ id: workItems.id }).from(workItems).where(ne(workItems.tenantId, SEEDED_TENANT_ID));
  const leaked = rows.filter((row) => otherTenantRows.some((other) => other.id === row.id));
  assert.deepEqual(leaked, [], "no other tenant's work item may appear in any scope");
});

test("assignee and reviewer scopes return disjoint, correct sets", async () => {
  const database = getDatabase();
  const mine = await listWorkQueue(database, SEEDED_TENANT_ID, assigneeUserId, { ...DEFAULT_WORK_QUEUE_PARAMS, scope: "mine" }, "2026-08-20");
  const reviewing = await listWorkQueue(database, SEEDED_TENANT_ID, assigneeUserId, { ...DEFAULT_WORK_QUEUE_PARAMS, scope: "reviewing" }, "2026-08-20");
  assert.ok(mine.every((row) => row.assigneeId === assigneeUserId));
  assert.ok(reviewing.every((row) => row.reviewerId === assigneeUserId));
  // The separation check guarantees these cannot overlap.
  assert.deepEqual(mine.filter((row) => reviewing.some((other) => other.id === row.id)), []);
});

test("a work item budget does not move when the service standard is later edited", async () => {
  const database = getDatabase();
  await updateService(database, SEEDED_TENANT_ID, seededAdminUserId, gstServiceId, { category: "GST", code: "GST", description: "", name: "GST", standardMinutes: 90, status: "active" });
  const workItemId = await createWorkItem(database, SEEDED_TENANT_ID, seededAdminUserId, { ...baseWorkInput, budgetMinutes: null, periodKey: "2026-09" });
  const created = await getWorkItem360(database, SEEDED_TENANT_ID, workItemId);
  assert.equal(created?.budgetMinutes, 90, "a new item copies the standard");

  await updateService(database, SEEDED_TENANT_ID, seededAdminUserId, gstServiceId, { category: "GST", code: "GST", description: "", name: "GST", standardMinutes: 150, status: "active" });
  const afterEdit = await getWorkItem360(database, SEEDED_TENANT_ID, workItemId);
  assert.equal(afterEdit?.budgetMinutes, 90, "the existing budget is a snapshot, not a live join");

  const laterId = await createWorkItem(database, SEEDED_TENANT_ID, seededAdminUserId, { ...baseWorkInput, budgetMinutes: null, periodKey: "2026-10" });
  assert.equal((await getWorkItem360(database, SEEDED_TENANT_ID, laterId))?.budgetMinutes, 150, "a later item picks up the new standard");
});

test("a bulk reassign applies the valid subset, reports the rest, and audits per item", async () => {
  const database = getDatabase();
  const reviewerHeldId = await createWorkItem(database, SEEDED_TENANT_ID, seededAdminUserId, { ...baseWorkInput, periodKey: "2026-11", reviewerId: reviewerUserId });
  const plainId = await createWorkItem(database, SEEDED_TENANT_ID, seededAdminUserId, { ...baseWorkInput, periodKey: "2026-12" });

  const plan = await applyBulkWorkChange(database, SEEDED_TENANT_ID, seededAdminUserId, [reviewerHeldId, plainId], { kind: "assignee", memberId: reviewerUserId });
  assert.equal(plan.apply.length, 1);
  assert.equal(plan.apply[0]!.id, plainId);
  assert.equal(plan.skip.length, 1);
  assert.equal(plan.skip[0]!.id, reviewerHeldId);

  const [{ value: events }] = await database.select({ value: count() }).from(auditEvents).where(and(
    eq(auditEvents.tenantId, SEEDED_TENANT_ID),
    eq(auditEvents.resourceId, plainId),
    eq(auditEvents.action, "work.bulk.assignee"),
  ));
  assert.equal(events, 1, "one audit event per changed item, not one per batch");
});

test("capacity lanes derive availability from the configured shift", async () => {
  const lanes = await getCapacityLanes(getDatabase(), SEEDED_TENANT_ID, "2026-08-20");
  assert.ok(lanes.length > 0);
  for (const lane of lanes) {
    assert.equal(lane.weeks.length, 4);
    // Seeded profiles use the Bihar default shift: 450 minutes across a six-day mask.
    assert.equal(lane.availableMinutes, 2700);
    assert.ok(lane.weeks.every((week) => week.loadMinutes >= 0 && week.unbudgetedCount >= 0));
  }
});
```

Declare `seededAdminUserId`, `assigneeUserId`, `reviewerUserId`, `gstServiceId`, and `baseWorkInput` in the file's existing `before` block using `listWorkMembers` and `listServiceManagementWorkspace`, matching how neighbouring tests resolve seeded identifiers. Add the new imports: `listWorkQueue`, `getCapacityLanes`, `applyBulkWorkChange`, `DEFAULT_WORK_QUEUE_PARAMS`.

- [ ] **Step 2: Run the integration suite**

Run: `npm run test:integration`
Expected: all new tests pass. If the budget-snapshot test fails with the later value, `createWorkItem` is joining live instead of snapshotting — fix Task 3 Step 5, do not relax the test.

- [ ] **Step 3: Run everything**

Run: `npm run test:unit && npm run test:integration && npm run lint && npm run build`
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add tests/postgres-integration.test.ts
git commit -m "test: cover work queue scope, budget snapshot, and bulk changes"
```

---

### Task 14: Documentation

**Files:**
- Modify: `LOCAL_SETUP.md`, `EXECUTION_PLAN.md`

- [ ] **Step 1: Document the workspace**

In `LOCAL_SETUP.md`, extend the paragraph at line 89 describing what the Super Admin can do, adding: My Work opens on the viewer's own assignments with scope tabs for review work and the whole firm; filter, sort and view state live in the URL so a view can be shared; bulk changes require `work:write` and cannot complete work; capacity is derived from each employee's configured shift; and budgets are copied from the service standard at creation and never rewritten by later catalogue edits.

- [ ] **Step 2: Correct the stale checkpoint**

In `EXECUTION_PLAN.md`, move recurrence and notification jobs out of the "Still planned" sentence — both ship in `lib/compliance/recurrence.ts`, `lib/notifications/`, and `scripts/jobs/`. Leave template/rule versioning, document versions, evidence chains, and statutory-domain engines listed as planned.

- [ ] **Step 3: Commit**

```bash
git add LOCAL_SETUP.md EXECUTION_PLAN.md
git commit -m "docs: describe the advanced work queue"
```
