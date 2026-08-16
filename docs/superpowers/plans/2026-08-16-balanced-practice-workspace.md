# Balanced Practice Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` for inline execution. Do not use subagent-driven development for this plan unless the user explicitly requests it. Complete one consolidated implementation, one validation pass, and one final Critical/Important review.

**Goal:** Replace the current SISPL dashboard layout with the approved Balanced Practice Workspace across the shared shell, Overview, and Clients without changing application data or behavior.

**Architecture:** Keep `DashboardClient` as the client-state orchestrator and split visual responsibility into a shared shell, Overview workspace, Clients workspace, shared dashboard UI primitives, and local line icons. Replace the accumulated legacy CSS cascade with one organized global design system whose desktop and responsive rules directly implement the approved 12-column layout.

**Tech Stack:** Next.js 16, React 19, TypeScript 5.9, CSS, Node test runner, PostCSS test parsing.

## Global Constraints

- Preserve the existing `DashboardData`, PostgreSQL provider, repository, migrations, fixtures, calculations, and failure behavior.
- Preserve navigation, global search, KPI filtering, work-status filtering, client search, client segment selection, mobile menu, and client selection.
- Desktop shell: 236px sidebar, 72px sticky command bar, 32px horizontal page padding, 12 columns, 16px gutters.
- Overview: 72px summary ribbon, four 116px KPI cards, 8-column priority queue, 4-column insight stack.
- Clients: four shared KPI cards, 8-column portfolio, 4-column sticky Client 360 panel.
- Responsive: 88px rail from 1024px through 1279px, navigation drawer below 1024px, 2×2 KPIs from 768px through 1023px, single-column task/client cards below 768px.
- Typography: Geist Sans; body 15px; navigation 14px; primary 13px; supporting 12px; labels and compact metadata never below 11px; card titles 18px; KPI values 26px; page titles 32px.
- Normal non-status text must maintain at least 4.5:1 contrast on its actual surface.
- Primary controls must provide 44×44px minimum targets, visible focus, and text/icon status cues that do not rely on color alone.
- Use local reusable line icons; add no runtime dependency solely for layout or icons.
- Do not add new product features, backend changes, dark mode, deployment changes, or speculative state.
- Batch all implementation findings into one correction pass. Fix every Critical and Important finding; Minor findings do not trigger a review loop unless they affect the approved design.

---

## File Structure

- Create `app/dashboard/dashboard-icons.tsx`: local accessible line-icon primitive and the finite icon-name union used by the shell and workspaces.
- Create `app/dashboard/dashboard-ui.tsx`: shared `KpiCard`, `StatusBadge`, `ProgressBar`, and `InitialsAvatar` presentational components.
- Create `app/dashboard/dashboard-shell.tsx`: desktop sidebar, compact rail, mobile drawer, sticky command bar, and page canvas.
- Create `app/dashboard/overview-workspace.tsx`: title row, summary ribbon, KPI row, priority queue, compliance health, deadline radar, and team capacity.
- Create `app/dashboard/clients-workspace.tsx`: Clients title/metrics, portfolio tools/list, responsive client cards, and Client 360.
- Modify `app/dashboard-client.tsx`: retain state and derived filtering only; compose the new shell and workspaces.
- Replace `app/globals.css`: one formatted token, shell, component, Overview, Clients, state, and responsive cascade.
- Create `tests/dashboard-layout-unit.test.ts`: component-boundary, structure, accessibility, grid, and responsive regressions.
- Modify `tests/page-boundary-unit.test.ts`: scan all client UI modules for forbidden PostgreSQL imports and embedded demo data.
- Modify `tests/typography-unit.test.ts`: retain the global 11px declaration invariant and update semantic selectors for the redesigned components.

---

### Task 1: Build the Balanced Practice Workspace

**Files:**

- Create: `app/dashboard/dashboard-icons.tsx`
- Create: `app/dashboard/dashboard-ui.tsx`
- Create: `app/dashboard/dashboard-shell.tsx`
- Create: `app/dashboard/overview-workspace.tsx`
- Create: `app/dashboard/clients-workspace.tsx`
- Modify: `app/dashboard-client.tsx`
- Replace: `app/globals.css`
- Create: `tests/dashboard-layout-unit.test.ts`
- Modify: `tests/page-boundary-unit.test.ts`
- Modify: `tests/typography-unit.test.ts`

**Interfaces:**

- Consumes: `DashboardData`, `DashboardClient`, `DashboardWorkItem`, `RiskStatus`, and `WorkStatus` from `lib/dashboard/types.ts`.
- Produces: `DashboardShell`, `OverviewWorkspace`, `ClientsWorkspace`, `DashboardIcon`, `KpiCard`, `StatusBadge`, `ProgressBar`, and `InitialsAvatar`.
- `DashboardClient` remains the only owner of interactive dashboard state.

- [ ] **Step 1: Write the failing layout regression test**

Create `tests/dashboard-layout-unit.test.ts` with these exact checks:

```ts
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import postcss from "postcss";

const root = new URL("../", import.meta.url);
const read = (path: string) => readFile(new URL(path, root), "utf8");

test("dashboard is decomposed into the approved workspace boundaries", async () => {
  const [client, shell, overview, clients] = await Promise.all([
    read("app/dashboard-client.tsx"),
    read("app/dashboard/dashboard-shell.tsx"),
    read("app/dashboard/overview-workspace.tsx"),
    read("app/dashboard/clients-workspace.tsx"),
  ]);

  assert.match(client, /<DashboardShell/);
  assert.match(client, /<OverviewWorkspace/);
  assert.match(client, /<ClientsWorkspace/);
  assert.doesNotMatch(client, /pulse-card|orbit outer|client-360 card/);
  assert.match(shell, /aria-label="Primary navigation"/);
  assert.match(shell, /aria-label="Open navigation"/);
  assert.match(shell, /aria-label="Notifications"/);
  assert.match(overview, /overview-summary-ribbon/);
  assert.match(overview, /priority-queue-panel/);
  assert.match(overview, /Team capacity/);
  assert.match(clients, /client-portfolio-panel/);
  assert.match(clients, /client-detail-panel/);
});

test("layout CSS implements the approved grid and responsive transformations", async () => {
  const css = await read("app/globals.css");
  const compactCss = css.replace(/\s+/g, "");
  const parsed = postcss.parse(css);
  const required = [
    "--sidebar-width:236px",
    "--command-bar-height:72px",
    "--page-pad:32px",
    "--grid-gap:16px",
    ".overview-main{display:grid;grid-template-columns:repeat(12,minmax(0,1fr))",
    ".priority-queue-panel{grid-column:span 8",
    ".overview-insights{grid-column:span 4",
    ".clients-main{display:grid;grid-template-columns:repeat(12,minmax(0,1fr))",
    ".client-portfolio-panel{grid-column:span 8",
    ".client-detail-panel{grid-column:span 4",
  ];
  for (const token of required) assert.ok(compactCss.includes(token), `missing ${token}`);
  for (const query of ["(max-width:1279px)", "(max-width:1149px)", "(max-width:1023px)", "(max-width:767px)"])
    assert.ok(parsed.nodes.some((node) => node.type === "atrule" && node.name === "media" && node.params === query), `missing ${query}`);
  assert.match(css, /@media\(max-width:767px\)[\s\S]*\.work-row\{grid-template-columns:1fr auto/);
  assert.match(css, /@media\(max-width:767px\)[\s\S]*\.portfolio-row\{grid-template-columns:1fr auto/);
  assert.doesNotMatch(css, /\.pulse-card|\.orbit\.|\.pulse-score/);
});

test("interactive controls retain accessible labels and readable targets", async () => {
  const sources = (await Promise.all([
    read("app/dashboard/dashboard-shell.tsx"),
    read("app/dashboard/overview-workspace.tsx"),
    read("app/dashboard/clients-workspace.tsx"),
  ])).join("\n");
  const css = await read("app/globals.css");
  assert.match(sources, /aria-label="Open navigation"/);
  assert.match(sources, /aria-label="Close navigation"/);
  assert.match(sources, /aria-label="Notifications"/);
  assert.match(sources, /Open \$\{item\.client\} work item/);
  assert.match(sources, /aria-pressed=/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /--control-height:44px/);
  assert.match(css, /@media\(prefers-reduced-motion:reduce\)/);
});
```

- [ ] **Step 2: Extend the client-boundary test before moving code**

Replace the single-file client scan in `tests/page-boundary-unit.test.ts` with a scan across the complete client UI surface:

```ts
test("interactive dashboard modules receive records without importing PostgreSQL", async () => {
  const modules = [
    "app/dashboard-client.tsx",
    "app/dashboard/dashboard-shell.tsx",
    "app/dashboard/dashboard-ui.tsx",
    "app/dashboard/overview-workspace.tsx",
    "app/dashboard/clients-workspace.tsx",
  ];
  const source = (await Promise.all(modules.map((path) => readFile(new URL(path, root), "utf8")))).join("\n");
  assert.match(source, /DashboardData/);
  assert.doesNotMatch(source, /dashboard\/postgres|node-postgres|from ["']pg["']/);
  assert.doesNotMatch(source, /const\s+(clients|work)\s*[:=]\s*\[/);
});
```

- [ ] **Step 3: Run the focused tests and confirm RED**

Run:

```powershell
npx tsx --test tests/dashboard-layout-unit.test.ts tests/page-boundary-unit.test.ts tests/typography-unit.test.ts
```

Expected: FAIL because the five dashboard component files and approved layout selectors do not exist.

- [ ] **Step 4: Create the shared component contracts**

Create the component files using these exact public contracts:

```tsx
// app/dashboard/dashboard-icons.tsx
export type DashboardIconName =
  | "overview" | "work" | "clients" | "compliance" | "documents"
  | "calendar" | "team" | "billing" | "insights" | "search"
  | "bell" | "plus" | "menu" | "close" | "chevron" | "alert"
  | "clock" | "waiting" | "review" | "arrow" | "filter";

export function DashboardIcon({ name, size = 20 }: { name: DashboardIconName; size?: number }) {
  return <svg className="dashboard-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{iconPaths[name].map((path) => <path key={path} d={path} />)}</svg>;
}

// app/dashboard/dashboard-ui.tsx
export function KpiCard(props: {
  label: string; value: string; note: string; tone: "red" | "amber" | "blue" | "mint";
  icon: DashboardIconName; onClick?: () => void; pressed?: boolean;
}): React.JSX.Element;
export function StatusBadge({ children, tone }: { children: React.ReactNode; tone: string }): React.JSX.Element;
export function ProgressBar({ value, label }: { value: number; label: string }): React.JSX.Element;
export function InitialsAvatar({ initials, tone }: { initials: string; tone?: string }): React.JSX.Element;
```

Every icon-only button must carry its own `aria-label`; decorative SVGs remain `aria-hidden`.

- [ ] **Step 5: Create the application shell**

Create `DashboardShell` with this contract and region order:

```tsx
export function DashboardShell(props: {
  data: DashboardData;
  active: string;
  menuOpen: boolean;
  query: string;
  onQueryChange: (value: string) => void;
  onNavigate: (destination: string) => void;
  onMenuOpen: () => void;
  onMenuClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <main className="dashboard-shell">
      <aside className={`dashboard-sidebar ${props.menuOpen ? "is-open" : ""}`} aria-label="Primary navigation"><SidebarContent data={props.data} active={props.active} onNavigate={props.onNavigate} onClose={props.onMenuClose} /></aside>
      {props.menuOpen && <button className="nav-backdrop" onClick={props.onMenuClose} aria-label="Close navigation" />}
      <section className="dashboard-workspace">
        <header className="command-bar"><CommandBar data={props.data} query={props.query} onQueryChange={props.onQueryChange} onMenuOpen={props.onMenuOpen} /></header>
        <div className="workspace-canvas">{props.children}</div>
      </section>
    </main>
  );
}
```

Use the existing navigation labels and preserve `onNavigate` behavior. Render text beside icons in the full sidebar, visually hide it in the compact rail, and keep it available through `aria-label` and title text.

- [ ] **Step 6: Create the Overview workspace**

Create `OverviewWorkspace` with the existing filtered work items and callbacks supplied by `DashboardClient`:

```tsx
export function OverviewWorkspace(props: {
  data: DashboardData;
  active: string;
  items: DashboardWorkItem[];
  filter: string;
  onFilterChange: (filter: string) => void;
  onOpenMyWork: () => void;
}) {
  return <>
    <PageTitle eyebrow={props.data.titleDate} title={props.active === "Overview" ? "Your practice, in command." : props.active} description={`Good day, ${props.data.practice.administratorName}. Here is the pulse of your firm.`} />
    <SummaryRibbon data={props.data} onOpenMyWork={props.onOpenMyWork} />
    <OverviewKpis data={props.data} filter={props.filter} onFilterChange={props.onFilterChange} />
    <section className="overview-main">
      <PriorityQueue items={props.items} filter={props.filter} onFilterChange={props.onFilterChange} />
      <OverviewInsights data={props.data} />
    </section>
  </>;
}
```

Use `.work-row` for each work item. Keep client, service, period, status, progress, owner, due date, and labeled row action in the DOM at every width.

- [ ] **Step 7: Create the Clients workspace**

Create `ClientsWorkspace` with this controlled interface:

```tsx
export function ClientsWorkspace(props: {
  data: DashboardData;
  clients: DashboardClient[];
  selected: DashboardClient | undefined;
  query: string;
  segment: string;
  onQueryChange: (value: string) => void;
  onSegmentChange: (segment: string) => void;
  onClientSelect: (clientId: string) => void;
}) {
  return <>
    <PageTitle eyebrow="CLIENT PORTFOLIO" title="Clients" description="Manage identity, services, health, and upcoming obligations." />
    <ClientKpis data={props.data} segment={props.segment} onSegmentChange={props.onSegmentChange} />
    <section className="clients-main">
      <ClientPortfolio clients={props.clients} selected={props.selected} query={props.query} segment={props.segment} onQueryChange={props.onQueryChange} onSegmentChange={props.onSegmentChange} onClientSelect={props.onClientSelect} />
      <ClientDetail client={props.selected} />
    </section>
  </>;
}
```

Use `.portfolio-row` for every client and `aria-pressed={selected?.id === client.id}`. Keep identity, service summary, health, obligation, and owner in each row/card at every width.

- [ ] **Step 8: Reduce `DashboardClient` to state and composition**

Keep the current state variables and derived filters, then render:

```tsx
return (
  <DashboardShell
    data={data}
    active={active}
    menuOpen={menu}
    query={query}
    onQueryChange={setQuery}
    onNavigate={(destination) => { setActive(destination); setMenu(false); }}
    onMenuOpen={() => setMenu(true)}
    onMenuClose={() => setMenu(false)}
  >
    {active === "Clients" ? (
      <ClientsWorkspace data={data} clients={visibleClients} selected={selected} query={clientQuery} segment={segment} onQueryChange={setClientQuery} onSegmentChange={setSegment} onClientSelect={setSelectedId} />
    ) : (
      <OverviewWorkspace data={data} active={active} items={items} filter={filter} onFilterChange={setFilter} onOpenMyWork={() => setActive("My work")} />
    )}
  </DashboardShell>
);
```

Do not move provider access, fixtures, or copied record arrays into client UI files.

- [ ] **Step 9: Replace the legacy stylesheet with the approved design system**

Rebuild `app/globals.css` as formatted sections in this order: tokens/reset, shell, navigation, command bar, shared primitives, Overview, Clients, states/accessibility, responsive rules, database-error screen.

The layout foundation must begin with these exact values:

```css
:root {
  --ink: #18243a;
  --muted: #58677b;
  --line: #e2e7ef;
  --canvas: #f4f6fa;
  --surface: #ffffff;
  --navy: #101d39;
  --violet: #6f5ce7;
  --blue: #4d8ff5;
  --mint: #2f9f89;
  --amber: #b97910;
  --red: #d94f5b;
  --sidebar-width: 236px;
  --command-bar-height: 72px;
  --page-pad: 32px;
  --grid-gap: 16px;
  --control-height: 44px;
  --type-page-title: 32px;
  --type-card-title: 18px;
  --type-kpi: 26px;
  --type-nav: 14px;
  --type-primary: 13px;
  --type-supporting: 12px;
  --type-label: 11px;
  --type-compact: 11px;
}
.dashboard-shell { min-height: 100vh; display: flex; }
.dashboard-sidebar { position: fixed; inset: 0 auto 0 0; width: var(--sidebar-width); }
.dashboard-workspace { min-width: 0; width: calc(100% - var(--sidebar-width)); margin-left: var(--sidebar-width); }
.command-bar { position: sticky; top: 0; z-index: 20; height: var(--command-bar-height); }
.workspace-canvas { padding: 24px var(--page-pad) 40px; }
.kpi-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: var(--grid-gap); }
.overview-main { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: var(--grid-gap); }
.priority-queue-panel { grid-column: span 8; }
.overview-insights { grid-column: span 4; display: grid; gap: var(--grid-gap); }
.clients-main { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: var(--grid-gap); }
.client-portfolio-panel { grid-column: span 8; }
.client-detail-panel { grid-column: span 4; position: sticky; top: calc(var(--command-bar-height) + 24px); }
```

Responsive rules must implement these exact transformations:

```css
@media(max-width:1279px) {
  :root { --sidebar-width: 88px; --page-pad: 24px; }
  .priority-queue-panel { grid-column: span 7; }
  .overview-insights { grid-column: span 5; }
}
@media(max-width:1149px) {
  .client-portfolio-panel,.client-detail-panel { grid-column: 1/-1; }
  .client-detail-panel { position: static; }
}
@media(max-width:1023px) {
  :root { --sidebar-width: 0px; --page-pad: 20px; }
  .dashboard-sidebar { transform: translateX(-100%); width: 280px; }
  .dashboard-sidebar.is-open { transform: translateX(0); }
  .dashboard-workspace { width: 100%; margin-left: 0; }
  .kpi-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .priority-queue-panel,.overview-insights,.client-portfolio-panel,.client-detail-panel { grid-column: 1/-1; }
  .client-detail-panel { position: static; }
}
@media(max-width:767px) {
  :root { --page-pad: 15px; }
  .kpi-grid { grid-template-columns: 1fr; }
  .overview-main,.clients-main { display: block; }
  .work-row,.portfolio-row { grid-template-columns: 1fr auto; }
}
@media(prefers-reduced-motion:reduce) {
  *,*::before,*::after { scroll-behavior: auto !important; transition-duration: .01ms !important; }
}
```

Every `font-size` declaration must resolve to at least 11px. Remove the old pulse, orbit, float-card, duplicate readability, and obsolete Clients cascade selectors instead of overriding them again.

- [ ] **Step 10: Update typography tests for the new semantic selectors**

Keep the PostCSS-wide `assertFontSizeFloor(css)` invariant and the contrast helper. Replace legacy pulse/old-table selector assertions with final declarations for:

```ts
const semanticTypography = [
  [".sidebar-nav-button", "var(--type-nav)"],
  [".page-title", "var(--type-page-title)"],
  [".summary-ribbon-copy", "var(--type-primary)"],
  [".kpi-label", "var(--type-label)"],
  [".kpi-value", "var(--type-kpi)"],
  [".work-client-name", "var(--type-primary)"],
  [".work-meta", "var(--type-compact)"],
  [".insight-title", "var(--type-card-title)"],
  [".portfolio-client-name", "var(--type-primary)"],
  [".portfolio-meta", "var(--type-compact)"],
  [".client-detail-title", "var(--type-card-title)"],
] as const;
```

Test `--muted` on `--surface` and `--canvas`, plus sidebar support text on `--navy`, at 4.5:1 or greater.

- [ ] **Step 11: Run the focused tests and fix only implementation defects**

Run:

```powershell
npx tsx --test tests/dashboard-layout-unit.test.ts tests/page-boundary-unit.test.ts tests/typography-unit.test.ts
```

Expected: all focused tests pass. Fix missing structure, behavior, accessibility, typography, contrast, or responsive rules; do not expand product scope.

- [ ] **Step 12: Run consolidated automated verification**

Run once after the complete patch:

```powershell
npm run test:unit
npx tsc --noEmit
npm run build:local
git diff --check
```

Expected: all unit tests pass, TypeScript exits 0, the Next.js production build completes successfully, and `git diff --check` prints no errors.

- [ ] **Step 13: Perform the responsive visual acceptance pass**

Keep one local preview running and inspect Overview and Clients at 375px, 768px, 1024px, 1440px, and 1920px.

At each width verify:

- no horizontal page scroll;
- header and navigation do not cover content;
- no text, status badge, action, chart label, or table/card value clips;
- Overview keeps work details visible when rows become cards;
- Clients keeps service, health, obligation, and owner visible when rows become cards;
- Client 360 is sticky only when enough width exists;
- focus outlines and 44px primary targets remain usable.

- [ ] **Step 14: Run one final Critical/Important review and batch fixes**

Review the complete branch once against `docs/superpowers/specs/2026-08-16-balanced-practice-workspace-design.md`. Batch every Critical and Important finding into one correction pass, rerun only the tests covering those corrections, and perform one confirmation review. Record Minor findings without looping unless they affect the approved design.

- [ ] **Step 15: Commit the complete redesign**

```powershell
git add -- app/dashboard-client.tsx app/dashboard app/globals.css tests/dashboard-layout-unit.test.ts tests/page-boundary-unit.test.ts tests/typography-unit.test.ts
git commit -m "feat: redesign balanced practice workspace"
```

Expected: one implementation commit containing only the approved UI component, stylesheet, and test changes.
