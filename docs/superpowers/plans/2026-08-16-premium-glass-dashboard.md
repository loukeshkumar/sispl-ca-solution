# Premium Glass Dashboard Implementation Plan

> **For agentic workers:** Implement this plan inline, task by task, using test-driven development. Preserve all existing uncommitted work and do not create commits unless the user requests one.

**Goal:** Deliver a production-grade glassmorphism redesign of the existing CA application with persisted light/dark themes, truthful live-data analytics, consistent Lucide icons, and the persistent authenticated shell on every feature route.

**Architecture:** A document-level theme controller drives semantic CSS tokens through `data-theme`. The current `DashboardShell` remains the single authenticated navigation owner. Pure analytics transformations convert `DashboardData` into serializable chart models, while a focused client component renders Recharts visualizations without database access.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind CSS 4, semantic global CSS tokens, Recharts, Lucide React, Node test runner.

## Global Constraints

- Keep all PostgreSQL repositories, Server Actions, authorization rules, and route contracts unchanged.
- Use only real tenant data; do not fabricate historical changes or revenue.
- Use Geist typography and teal `#2DD4BF` as the primary accent.
- Support system preference plus persisted explicit light/dark selection.
- Maintain WCAG AA text contrast, 44px controls, keyboard focus, reduced motion, and the existing 12px absolute font floor.
- Preserve the current dirty worktree and do not overwrite unrelated changes.

---

### Task 1: Theme contract and persistence

**Files:**
- Create: `app/theme/theme-provider.tsx`
- Create: `app/theme/theme-toggle.tsx`
- Create: `app/theme/theme-script.tsx`
- Modify: `app/layout.tsx`
- Test: `tests/theme-unit.test.ts`

**Interfaces:**
- Produces: `ThemeProvider({ children })`, `ThemeToggle()`, and `ThemeScript()`.
- Storage key: `sispl-theme` with values `light` or `dark`.
- Document contract: `<html data-theme="light|dark">` after bootstrap.

- [ ] **Step 1: Write the failing theme contract test**

Assert that the provider reads and writes `sispl-theme`, responds to `prefers-color-scheme`, updates `document.documentElement.dataset.theme`, and exposes an accessible toggle. Assert that `RootLayout` includes the static bootstrap and provider.

- [ ] **Step 2: Run the test and verify RED**

Run: `npx tsx --test tests/theme-unit.test.ts`

Expected: fail because the theme files and layout integration do not exist.

- [ ] **Step 3: Implement the minimal theme system**

Use this public context contract:

```ts
type Theme = "light" | "dark";
type ThemeContextValue = { theme: Theme; toggleTheme: () => void };
```

The provider initializes from the document attribute, falls back to `matchMedia`, persists explicit toggles, and listens for system changes only when no explicit preference exists. The bootstrap contains only a constant script string and never injects user data.

- [ ] **Step 4: Run focused tests and typecheck**

Run: `npx tsx --test tests/theme-unit.test.ts && npx tsc --noEmit`

Expected: pass.

### Task 2: Lucide icon adapter and command-bar theme control

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `app/dashboard/dashboard-icons.tsx`
- Modify: `app/dashboard/dashboard-shell.tsx`
- Test: `tests/dashboard-layout-unit.test.ts`

**Interfaces:**
- Preserve: `DashboardIcon({ name, size? })` and `DashboardIconName`.
- Add: `ThemeToggle` between notifications and the create action.

- [ ] **Step 1: Extend the shell test**

Assert `dashboard-icons.tsx` imports from `lucide-react`, retains every existing icon name, and `DashboardShell` renders `ThemeToggle` with no conditional route branch.

- [ ] **Step 2: Run the test and verify RED**

Run: `npx tsx --test tests/dashboard-layout-unit.test.ts`

Expected: fail because Lucide and the toggle are not integrated.

- [ ] **Step 3: Install dependencies and implement the adapter**

Run: `npm install lucide-react recharts`

Map the existing semantic names to Lucide components in one typed record. Keep `aria-hidden` on decorative icons and allow callers to supply accessible naming through their control.

- [ ] **Step 4: Add the theme toggle to the command bar**

Render the toggle as a 44px icon button with an action label such as `Switch to dark theme`.

- [ ] **Step 5: Run focused tests and typecheck**

Run: `npx tsx --test tests/dashboard-layout-unit.test.ts tests/theme-unit.test.ts && npx tsc --noEmit`

Expected: pass.

### Task 3: Truthful dashboard analytics model

**Files:**
- Create: `lib/dashboard/analytics.ts`
- Test: `tests/dashboard-analytics-unit.test.ts`

**Interfaces:**
- Produces:

```ts
type ServicePerformancePoint = { service: string; health: number; progress: number; assignments: number };
type WorkStatusPoint = { status: string; value: number };
type DeadlinePressurePoint = { label: string; value: number };
type GaugeMetric = { label: string; value: number; detail: string };

function buildServicePerformance(data: DashboardData): ServicePerformancePoint[];
function buildWorkStatusDistribution(data: DashboardData): WorkStatusPoint[];
function buildDeadlinePressure(data: DashboardData): DeadlinePressurePoint[];
function buildGaugeMetrics(data: DashboardData): GaugeMetric[];
```

- [ ] **Step 1: Write failing transformation tests**

Cover grouped average progress, missing service work, empty arrays, status counts, due-date buckets relative to `todayKey`, percentage clamping, and overdue ratio when no active work exists.

- [ ] **Step 2: Run the test and verify RED**

Run: `npx tsx --test tests/dashboard-analytics-unit.test.ts`

Expected: fail because `analytics.ts` does not exist.

- [ ] **Step 3: Implement pure transformations**

Use deterministic arithmetic only. Exclude completed work from overdue ratio and deadline pressure. Sort service points by service name and use fixed pressure buckets: overdue, today, next seven days, later.

- [ ] **Step 4: Run focused tests and typecheck**

Run: `npx tsx --test tests/dashboard-analytics-unit.test.ts && npx tsc --noEmit`

Expected: pass.

### Task 4: Premium Overview analytics and five live KPIs

**Files:**
- Create: `app/dashboard/overview-analytics.tsx`
- Modify: `app/dashboard/overview-workspace.tsx`
- Modify: `app/dashboard/dashboard-ui.tsx`
- Test: `tests/dashboard-premium-ui-unit.test.ts`

**Interfaces:**
- Produces: `OverviewAnalytics({ data }: { data: DashboardData })`.
- `KpiCard` gains `context`, `metric`, and real spark values while preserving button behavior.

- [ ] **Step 1: Write the failing UI structure test**

Assert five KPI definitions, an `OverviewAnalytics` region, Recharts composed/bar/area/pie primitives, textual chart summaries, and no revenue or fabricated percentage-change copy.

- [ ] **Step 2: Run the test and verify RED**

Run: `npx tsx --test tests/dashboard-premium-ui-unit.test.ts`

Expected: fail because the analytics component and fifth KPI do not exist.

- [ ] **Step 3: Implement the analytics client component**

Render service performance, deadline pressure, status donut, and three gauges using the Task 3 functions. Disable chart animation for reduced-motion users and include text/legend equivalents.

- [ ] **Step 4: Refactor the Overview composition**

Replace the decorative ribbon and legacy insight cards with the five-card KPI row, analytics grid, gauges, and existing priority queue. Preserve every filter and record link.

- [ ] **Step 5: Run focused tests and typecheck**

Run: `npx tsx --test tests/dashboard-premium-ui-unit.test.ts tests/dashboard-unit.test.ts && npx tsc --noEmit`

Expected: pass.

### Task 5: App-wide glass tokens and responsive surfaces

**Files:**
- Modify: `app/globals.css`
- Test: `tests/premium-theme-css-unit.test.ts`
- Modify: `tests/typography-unit.test.ts`

**Interfaces:**
- Theme selector contract: `:root`, `[data-theme="light"]`, `[data-theme="dark"]`.
- Shared surfaces: `.surface-card`, `.dashboard-sidebar`, `.command-bar`, form/detail shell cards, list/table rows.

- [ ] **Step 1: Write the failing CSS contract test**

Assert semantic light/dark tokens, dark canvas `#0A1628`, accent `#2DD4BF`, backdrop blur, glass border/inner highlight, ambient background layers, 44px control floor, breakpoints for 1440/1024/768/375 behavior, and reduced-motion rules.

- [ ] **Step 2: Run tests and verify RED**

Run: `npx tsx --test tests/premium-theme-css-unit.test.ts tests/typography-unit.test.ts`

Expected: fail because premium theme tokens and responsive contracts are absent.

- [ ] **Step 3: Implement semantic theme tokens and shared surfaces**

Replace hard-coded surface/text colors in authenticated UI rules with tokens. Add ambient pseudo-elements behind the workspace, glass cards with appropriate light opacity, teal focus/hover states, stable transforms, and chart styling.

- [ ] **Step 4: Harmonize secondary pages**

Apply tokens to client, work, document, task, employee, form, and detail selectors without changing their markup or workflow behavior.

- [ ] **Step 5: Run focused tests, lint, and typecheck**

Run: `npx tsx --test tests/premium-theme-css-unit.test.ts tests/typography-unit.test.ts tests/authenticated-workspace-shell-unit.test.ts && npm run lint && npx tsc --noEmit`

Expected: pass.

### Task 6: Production verification

**Files:**
- Verify only; fix only failures caused by Tasks 1–5.

- [ ] **Step 1: Run the complete unit suite**

Run: `npm test`

Expected: all tests pass with no warnings or skipped tests.

- [ ] **Step 2: Run static validation**

Run: `npx tsc --noEmit && npm run lint`

Expected: both exit zero.

- [ ] **Step 3: Run the production build**

Run: `npm run build`

Expected: successful Next.js build with all feature routes present.

- [ ] **Step 4: Restart development server and smoke routes**

Verify `/`, `/work/<seed-id>`, `/tasks/<seed-id>`, and `/team/<seed-id>` return successful authenticated pages and retain the shared shell.

- [ ] **Step 5: Review the final diff**

Confirm no repository, authorization, database, migration, or Server Action changes occurred and no unrelated user changes were overwritten.
