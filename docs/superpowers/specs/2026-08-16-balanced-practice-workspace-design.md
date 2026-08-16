# Balanced Practice Workspace Design

## Goal

Redesign the SISPL CA Solution application shell, Overview workspace, and Clients workspace into a professional accounting-practice interface that is easier to scan, uses the available viewport efficiently, and remains readable at every supported width.

The redesign preserves the existing PostgreSQL data flow, dashboard calculations, navigation state, search and filter behavior, and database-unavailable handling. It changes information architecture, component boundaries, layout, visual hierarchy, icons, responsive behavior, and interaction presentation only.

## Selected Direction

The approved direction is **Balanced Practice Workspace**.

The action-first alternative made deadline triage dominant but underweighted portfolio and compliance context. The modular alternative offered more expansion capacity but introduced a second navigation layer that is unnecessary for the current product. The selected direction balances daily work, compliance health, deadlines, and team capacity in one predictable workspace.

## Problems in the Existing Layout

- The decorative operations hero consumes too much vertical space and repeats information already shown in the KPI cards.
- Fixed-height panels and narrow chart areas create crowding while leaving unused space elsewhere.
- Card edges, headings, controls, and content columns do not share one consistent alignment system.
- The priority queue is the most actionable surface but competes visually with decorative elements.
- The sidebar is visually heavy and uses large blocks for secondary information.
- Overview and Clients use related information but feel like separate layout systems.
- Several responsive rules hide information instead of reorganizing it into a readable mobile structure.

## Application Shell

### Desktop

- Use a 236px fixed navigation sidebar.
- Use a 72px sticky top command bar.
- Give the page canvas 32px horizontal padding and 24px vertical section spacing.
- Use a 12-column content grid with 16px gutters.
- Keep content fluid inside the available workspace rather than imposing a narrow fixed maximum width.
- Align the title row, summary ribbon, KPI row, main workspace, and Clients workspace to the same left and right edges.

### Navigation

- Group the firm switcher, main navigation, practice-health summary, and account area distinctly.
- Preserve the current destinations and active-state behavior.
- Replace text glyphs and emoji-like symbols with one consistent 20px line-icon family.
- Keep primary navigation targets at least 44px high with visible hover, active, keyboard-focus, and disabled states.
- Compress the sidebar to an 88px icon rail between 1024px and 1279px.
- Replace the rail with an accessible navigation drawer below 1024px.

### Command Bar

- Retain global search, financial-year control, notifications, and Create action.
- Keep search as the dominant header control and actions aligned to the right.
- Use a 44px control height and a visible keyboard focus ring.
- Keep the bar sticky without covering page content.

## Overview Workspace

### Page Introduction

- Use a direct page title and one supporting line.
- Remove the oversized orbit/score hero.
- Replace it with a 72px operational summary ribbon containing the current attention count, one short explanation, the on-time rate, and the primary review action.
- Retain restrained navy/violet brand depth in the ribbon without decorative elements competing with content.

### KPI Row

- Present Overdue, Due this week, Waiting on client, and Pending review as four equal cards.
- Use a 116px desktop card height with consistent 18px internal padding.
- Give each card an icon, uppercase label, numeric value, short explanation, and restrained trend indicator.
- Use tabular numerals and preserve current filtering behavior when a KPI is selected.

### Main Workspace

- Use an 8-column priority-queue panel and a 4-column insight stack.
- Make the priority queue the largest and most visually prominent operational surface.
- Keep its heading, filter tabs, column labels, rows, progress, owner, due date, and row action aligned to a consistent grid.
- Do not hide useful desktop columns until the mobile task-card breakpoint.
- Use content-driven minimum heights instead of large fixed heights that create unused space.

### Insight Stack

- Include Compliance health, Deadline radar, and Team capacity.
- Give every insight card a clear label, title, concise visualization, and an accessible text equivalent.
- Keep charts secondary to their numbers and labels.
- Align insight-card edges and spacing with the priority panel.

## Clients Workspace

- Reuse the same shell, page-title treatment, spacing scale, KPI-card pattern, colors, and typography as Overview.
- Keep the four existing client metrics.
- Use an 8-column portfolio workspace and a 4-column Client 360 panel.
- Keep portfolio search, segments, filters, client identity, services, health, next obligation, and owner readable without horizontal crowding.
- Make Client 360 sticky within the viewport on wide screens while allowing its body to scroll independently when necessary.
- Below 1150px, move Client 360 below the portfolio or expose it as a detail panel after client selection.
- On mobile, render each client as a structured card rather than hiding essential services, health, and obligation data.

## Typography and Color

- Continue using Geist Sans through the existing Next.js font variable.
- Preserve the approved readable scale:
  - Body: 15px minimum.
  - Navigation: 14px.
  - Primary information: 13px.
  - Supporting information: 12px.
  - Labels and compact metadata: 11px absolute minimum.
  - Card headings: 18px.
  - KPI values: 26px.
  - Page titles: 32px.
- Keep the existing navy, violet, blue, mint, amber, and red palette.
- Use `#58677b` or a darker value for non-status supporting text on light surfaces.
- Use accessible light text on dark sidebar and summary-ribbon surfaces.
- Maintain at least 4.5:1 contrast for normal non-status text.
- Never communicate status using color alone; retain a text label or icon.

## Spacing and Surfaces

- Use an 8px base spacing system with primary values of 8, 12, 16, 24, and 32px.
- Use 14–16px card radii.
- Use 1px neutral borders and restrained shadows; avoid heavy glow and glass effects.
- Keep section gaps consistent at 16 or 24px.
- Avoid hover transforms that shift surrounding layout.

## Responsive Behavior

### 1280px and wider

- Full 236px sidebar.
- Four-column KPI row.
- Overview uses an 8/4 workspace split.
- Clients uses an 8/4 portfolio/detail split.

### 1024px–1279px

- 88px icon rail.
- Overview may use a 7/5 split when the insight cards need additional width.
- Client 360 may remain beside the portfolio only when its minimum readable width is preserved.

### 768px–1023px

- Navigation drawer replaces the fixed sidebar.
- KPI cards become a 2×2 grid.
- Priority queue and insights stack vertically.
- Client 360 moves below the portfolio.

### Below 768px

- Use a single-column layout and 15px page padding.
- KPI cards stack vertically.
- Queue rows become task cards with client, status, progress, owner, and due date visible.
- Client rows become client cards with identity, service summary, health, obligation, and owner visible.
- No horizontal page scrolling is permitted.

## Component Architecture

Split the existing large interactive component into focused units while preserving one shared data model:

- `DashboardClient`: owns active module, search, menu, filter, segment, and selected-client state.
- `DashboardShell`: renders sidebar, command bar, mobile navigation, and page canvas.
- `OverviewWorkspace`: composes the summary ribbon, KPI grid, priority queue, and insight stack.
- `ClientsWorkspace`: composes client metrics, portfolio tools, portfolio list, and Client 360.
- Shared presentational components: `KpiCard`, `StatusBadge`, `ProgressBar`, and accessible icon primitives.

The components consume the existing `DashboardData`, work-item, client, deadline, and service-health shapes. No repository, provider, migration, or database interface changes are required.

## Interaction and Accessibility

- Preserve working navigation, KPI filters, work-status filters, client search, client segment selection, mobile menu, and client selection.
- Keep unavailable prototype actions disabled and visibly distinguish them from active actions.
- Provide accessible labels for icon-only controls.
- Maintain logical keyboard order and visible focus states.
- Use at least 44×44px touch targets for primary controls.
- Respect `prefers-reduced-motion` and keep transitions between 150ms and 250ms.
- Ensure charts and progress visuals have adjacent text values.

## Error Handling

- Preserve the database-unavailable page and its safe setup guidance.
- The redesigned shell must not render demonstration records when PostgreSQL mode fails.
- Empty work and client searches retain clear empty-state messages inside the appropriate content panel.

## Validation

- Add focused component/source tests for shell structure, Overview composition, Clients composition, navigation behavior, and accessibility labels.
- Preserve the global 11px typography-floor and contrast regression tests.
- Run the complete unit suite, TypeScript validation, and local production build.
- Visually inspect Overview and Clients at 375px, 768px, 1024px, 1440px, and 1920px.
- Verify no clipped text, overlapping controls, horizontal page scrolling, hidden essential mobile data, or sticky-header/sidebar collisions.

## Non-Goals

- No database schema, seed-data, repository, provider, authentication, billing, document-management, or deployment changes.
- No new analytics or workflow features.
- No dark-mode implementation.
- No new runtime dependency solely for layout or icons; icons should be implemented with existing capabilities or local reusable components.
