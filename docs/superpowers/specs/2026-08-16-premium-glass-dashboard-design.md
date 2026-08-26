# Premium Glass Dashboard Design

**Status:** Approved on 16 August 2026

## Objective

Redesign the existing SISPL CA Solution as a cohesive premium glassmorphism application with accessible light and dark themes. Preserve every working PostgreSQL-backed client, compliance, document, work, task, and employee workflow while improving visual hierarchy, navigation continuity, responsive behavior, and data comprehension.

## Scope

The redesign covers the authenticated application shell, Overview dashboard, all workspace views, forms, and record-detail pages. It does not add the unrelated reasoning-effort settings modal, revenue reporting, or fabricated historical trends. Login and account-security screens receive the shared theme tokens but remain intentionally focused standalone screens.

The existing Next.js 16.3.1, React 19.2.6, TypeScript 5.9, Tailwind CSS 4, PostgreSQL, Drizzle, App Router, Server Actions, permission system, and repository boundaries remain in place. The project will not be downgraded to Next.js 14 or React 18.

## Design Direction

### Visual language

- Dark canvas: `#0A1628`, with deep navy secondary layers and teal `#2DD4BF` as the primary accent.
- Light canvas: soft cool grey with high-opacity white glass surfaces and slate text.
- Cards use translucent backgrounds, `backdrop-filter`, subtle one-pixel edges, restrained inner highlights, and broad low-opacity shadows.
- Background depth comes from fixed blurred teal and indigo ambient shapes that never intercept pointer events.
- Geist remains the sole interface typeface. Headings use tight tracking; supporting copy uses comfortable line height.
- Normal body text maintains at least WCAG AA contrast and mobile body copy remains at least 16px.
- Interactive targets remain at least 44 by 44 pixels.

### Motion

- Interactive surfaces use 180–260ms color, opacity, shadow, and transform transitions.
- Hover lift is limited to two pixels and never changes document flow.
- Focus is represented by a high-contrast teal ring in both themes.
- `prefers-reduced-motion: reduce` disables lifts and nonessential transitions.

## Theme Behavior

The initial theme follows `prefers-color-scheme`. A labeled header control toggles between light and dark and stores the explicit choice in local storage. A pre-hydration theme bootstrap applies a saved choice before first paint, preventing a visible theme flash. The document exposes the active mode through `data-theme="light|dark"`; one semantic token set drives all components so there are no duplicated light and dark component trees.

Theme tokens include canvas, elevated canvas, glass surface, strong glass surface, border, text, muted text, accent, accent contrast, danger, warning, success, shadows, focus ring, and chart colors.

## Authenticated Application Shell

The fixed desktop sidebar and sticky command bar remain visible for root workspaces and all nested client, work, task, document, and employee routes.

### Sidebar

- Premium dark glass in both themes, with a slightly lighter light-theme treatment while preserving brand contrast.
- Active navigation uses a teal-tinted translucent fill, left accent, and soft glow rather than a solid purple block.
- Employee navigation remains named **Employees**.
- Firm summary, practice health, and account controls use shared glass primitives.
- Tablet collapses to an icon rail; mobile uses the existing keyboard-trapped slide-over drawer.

### Command bar

- Frosted sticky surface with search, financial year, notifications, theme toggle, and create action.
- Theme control has an accessible label describing the action, not merely the current icon.
- Disabled controls remain visibly disabled and are not presented as functioning actions.

## Overview Dashboard

### KPI row

Five responsive KPI cards display only live application data:

1. Attention needed.
2. On-time rate.
3. Portfolio health.
4. Due this week.
5. Active employees.

Each card includes a Lucide icon, value, operational context badge, and compact real-data visualization. Historical percentage-change claims are excluded because the database has no metric snapshot history.

### Service performance

A large Recharts composed chart groups current work by service. Bars show service health; a thin teal line/area shows average progress for active assignments in the same service. Empty services are omitted. A semantic summary beneath the chart makes the values available without relying on the visual alone.

### Operational insights

The right column contains:

- Deadline pressure derived from actual due dates and work status.
- Work-status distribution as a Recharts donut with an accessible text legend.

The bottom gauge row shows portfolio health, overdue-work ratio, and on-time rate using live metrics. Existing priority work remains the main operational register beneath the analytical summary, retaining filtering and record navigation.

Revenue trends are excluded because the current schema has no billing or historical revenue series. No mock revenue data will be introduced.

## Secondary Workspaces and Record Pages

Existing workspace structures remain recognizable. Their cards, tables, filters, empty states, forms, badges, buttons, progress indicators, and detail panels adopt the shared glass tokens and spacing scale. Tables remain tables on wide screens and use existing mobile-card transformations at narrow widths. Status is communicated with icon/text as well as color.

All new, edit, and detail routes continue to inherit the persistent application shell. Standalone pages cannot create a second independent navigation implementation.

## Component Architecture

- `ThemeProvider` owns client theme state, system-change listening, persistence, and document attributes.
- `ThemeToggle` is a reusable accessible command-bar control.
- `DashboardIcon` becomes a typed adapter over `lucide-react`, preserving the existing call sites while standardizing icon geometry.
- `OverviewAnalytics` owns chart rendering only and receives serializable dashboard data.
- Pure transformation functions derive service performance, deadline pressure, status distribution, and gauge values from `DashboardData`; they do not query PostgreSQL.
- Existing `DashboardShell`, `DashboardClient`, workspace components, repositories, and Server Actions retain their current responsibilities.

## Data and Error Handling

All dashboard values are derived from the authenticated tenant snapshot already loaded by the server. Chart transformation functions handle empty collections and clamp percentage values to zero through one hundred. Recharts components provide empty states when no meaningful series exists. Theme persistence failures degrade to system preference without blocking rendering.

No authorization, tenant scoping, database writes, document access, or task-assignment behavior changes as part of this redesign.

## Dependencies

- Add `lucide-react` for interface icons.
- Add `recharts` for dashboard charts.
- Do not introduce an additional component framework, theme package, animation library, or chart library.

## Responsive Requirements

- 1440px: five KPI cards, wide analytics chart, right insight column, full sidebar.
- 1024px: KPI cards wrap, analytics becomes two columns where space permits, sidebar uses the existing compact treatment.
- 768px: analytics stacks, data tables use established compact behavior, mobile navigation is available.
- 375px: single-column content, no horizontal page overflow, chart labels remain legible, all controls meet the touch-target floor.

## Accessibility Requirements

- WCAG AA contrast for all normal text in both themes.
- Visible focus states and correct keyboard order.
- Accessible names for icon-only buttons.
- Chart values repeated in text or legends.
- Color is never the sole status indicator.
- Motion preferences are respected.
- Theme bootstrap must not introduce a hydration warning.

## Verification

Implementation follows test-driven development. Automated coverage must verify theme persistence/system fallback, semantic chart transformations, five live KPI cards, persistent route shell, Lucide/Recharts integration, contrast tokens, 12px absolute font-size floor, reduced-motion handling, and responsive breakpoints. Final validation runs focused tests, all unit tests, TypeScript, ESLint, a production build, and authenticated route smoke checks.
