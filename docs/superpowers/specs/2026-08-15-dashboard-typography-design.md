# SISPL Dashboard Typography Harmonization Design

## Objective

Make every SISPL dashboard screen feel as polished and readable as the existing Clients workspace without changing the product's layout, color palette, information density, or interaction model.

## Current problem

The application already loads Geist Sans correctly. The Clients workspace also has a later readability layer, but the Overview surface and the shared dashboard widgets retain the original 6–10px typography. Tiny metadata, light weights, pale text, and excessive tracking weaken the hierarchy and make otherwise premium cards look inexpensive.

## Approved direction

Keep Geist Sans as the single interface typeface. Use Geist Mono only for keyboard shortcuts or genuinely technical values. Harmonize the remaining dashboard with the Clients workspace by increasing minimum sizes, strengthening important weights, reducing tracking on small labels, and improving muted-text contrast.

Do not introduce a new font family. Do not redesign the cards, navigation, gradients, spacing system, or data layout.

## Typography system

| Role | Size | Weight | Line height | Notes |
| --- | ---: | ---: | ---: | --- |
| Page title | 32px | 700 | 1.15 | Preserve tight display tracking |
| Hero statement | 30px | 700 | 1.12 | Keep the violet emphasis treatment |
| Card heading | 17–18px | 600 | 1.3 | Used for queue, health, and deadline cards |
| KPI value | 26px | 700 | 1.1 | Use tabular numerals where available |
| Navigation and primary table text | 13–14px | 500–600 | 1.4 | Names and primary actions use 600 |
| Supporting text | 12px | 400–500 | 1.45 | Increase contrast from the original pale gray |
| Uppercase label | 11px | 700 | 1.3 | Tracking must not exceed 0.12em |
| Compact metadata | 11px | 400–500 | 1.4 | No visible interface text below 11px |

The document body remains 15px on desktop and smaller screens. Form controls and buttons inherit Geist Sans.

Every `font-size` declaration in the stylesheet, including grouped selectors, responsive rules, and important declarations, must resolve to a numeric or named-token value of at least 11px. This source invariant prevents a lower-size declaration from winning through cascade details.

## Component coverage

The harmonized scale applies to:

- Global header search, financial-year control, notification control, and create action.
- Sidebar firm card, section label, navigation, practice health, and account identity.
- Overview title, operations pulse, KPI cards, priority queue, health score, service progress, and deadline radar.
- Non-Clients navigation states, which reuse the Overview surface.
- Database-unavailable state and other shared feedback surfaces.

The Clients workspace remains the visual reference. Its existing readable sizes must not regress.

## Layout behavior

Typography changes must fit the current desktop card and grid structure. Table rows and compact panels may gain only the minimum height needed to prevent clipping. Existing responsive breakpoints remain in place, and no horizontal scrolling may be introduced at 375px, 768px, 1024px, 1440px, or 1920px widths.

## Color and accessibility

Primary text continues to use the existing ink/navy palette. Supporting text must use a darker muted tone where the current value is too pale for comfortable reading. Normal-sized text should meet a 4.5:1 contrast ratio against its background. Focus states, disabled states, and status colors remain unchanged.

## Implementation boundary

Implement the design in `app/globals.css` by extending the existing readability layer and consolidating the duplicate body font declaration. Do not restructure `app/dashboard-client.tsx` unless a selector cannot express the approved hierarchy. No new runtime dependency is required.

## Verification

- Add a focused source-level regression test that confirms the global Geist stack, 11px minimum readable scale, and shared dashboard selector coverage remain present.
- Run unit tests, TypeScript validation, and the native Next.js production build.
- Confirm the Overview route renders without clipping and retains the existing card/grid composition.
- Confirm the Clients workspace retains its current hierarchy.

## Out of scope

- New screens, routes, cards, interactions, or data fields.
- Font-family replacement or an additional heading typeface.
- Color palette, icon, layout, or component redesign.
- Hosted database or deployment changes.
