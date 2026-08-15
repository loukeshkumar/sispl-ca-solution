# Dashboard Typography Harmonization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the readable Geist typography hierarchy from the Clients workspace to Overview and all shared dashboard surfaces without changing layout, color, data, or interactions.

**Architecture:** Keep typography centralized in `app/globals.css`. Add named type-scale custom properties, make the global body use a single Geist stack, and extend the existing readability layer with explicit Overview selectors. Protect the hierarchy with a source-level unit test that runs in the existing `test:unit` suite.

**Tech Stack:** Next.js 16, React 19, TypeScript 5.9, CSS, Node test runner, tsx.

## Global Constraints

- Keep Geist Sans as the single interface typeface; use Geist Mono only for keyboard shortcuts or genuinely technical values.
- Use 32px page titles, 28px hero statements, 17–18px card headings, 26px KPI values, 12–13px navigation/primary table text, 10–11px supporting text, and a 9px minimum for labels and compact metadata.
- No visible interface text may be smaller than 9px after the final cascade.
- Do not change the existing layout, color palette, cards, gradients, data model, or interactions.
- Preserve the Clients workspace as the typography reference and do not regress its current readable scale.
- Do not add a runtime dependency.
- Preserve unrelated working-tree changes in `package.json`, `package-lock.json`, and `tests/package-scripts-unit.test.ts`; do not stage them in this task's commit.

---

## File structure

- Modify `app/globals.css`: own the global font stack, type-scale tokens, Overview hierarchy, compact metadata sizes, and muted-copy contrast.
- Create `tests/typography-unit.test.ts`: protect the global font stack, token values, and representative Overview selector coverage.

### Task 1: Harmonize the shared dashboard typography

**Files:**
- Create: `tests/typography-unit.test.ts`
- Modify: `app/globals.css:2`
- Modify: `app/globals.css:9-28`
- Test: `tests/typography-unit.test.ts`

**Interfaces:**
- Consumes: `--font-geist-sans` supplied by `app/layout.tsx` and the existing Overview class names emitted by `app/dashboard-client.tsx`.
- Produces: CSS custom properties `--type-page-title`, `--type-hero`, `--type-card-title`, `--type-kpi`, `--type-nav`, `--type-primary`, `--type-supporting`, `--type-label`, and `--type-compact`.

- [ ] **Step 1: Write the failing typography regression test**

Create `tests/typography-unit.test.ts` with:

```ts
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

test("dashboard typography uses one Geist stack and the approved scale", () => {
  assert.match(css, /body\{[^}]*font-family:var\(--font-geist-sans\)/);
  assert.doesNotMatch(css, /font-family:Arial,Helvetica,sans-serif/);

  for (const token of [
    "--type-page-title:32px",
    "--type-hero:28px",
    "--type-card-title:18px",
    "--type-kpi:26px",
    "--type-nav:13px",
    "--type-primary:12px",
    "--type-supporting:10px",
    "--type-label:9px",
    "--type-compact:9px",
  ]) {
    assert.ok(css.includes(token), `missing approved typography token ${token}`);
  }
});

test("Overview widgets use the readable typography tokens", () => {
  for (const [name, rule] of [
    ["queue labels", /\.table-labels\{[^}]*font-size:var\(--type-label\)/],
    ["client names", /\.client b\{[^}]*font-size:var\(--type-primary\)/],
    ["client metadata", /\.client small\{[^}]*font-size:var\(--type-compact\)/],
    ["owner names", /\.owner b\{[^}]*font-size:var\(--type-supporting\)/],
    ["deadline metadata", /\.deadline small\{[^}]*font-size:var\(--type-compact\)/],
    ["health legend", /\.health-copy span\{[^}]*font-size:var\(--type-supporting\)/],
    ["service rows", /\.service-list>div\{[^}]*font-size:var\(--type-compact\)/],
    ["radar metadata", /\.deadline-list article>div small\{[^}]*font-size:var\(--type-compact\)/],
  ] as const) {
    assert.match(css, rule, `${name} must use the approved readable scale`);
  }
});
```

- [ ] **Step 2: Run the focused test and verify the expected failure**

Run:

```powershell
npx tsx --test tests/typography-unit.test.ts
```

Expected: FAIL because `app/globals.css` still contains `font-family:Arial,Helvetica,sans-serif`, lacks the `--type-*` tokens, and does not apply those tokens to the Overview selectors.

- [ ] **Step 3: Consolidate the global font stack and add type-scale tokens**

Extend the existing `:root` declaration at the beginning of `app/globals.css` with these exact properties:

```css
--type-page-title:32px;
--type-hero:28px;
--type-card-title:18px;
--type-kpi:26px;
--type-nav:13px;
--type-primary:12px;
--type-supporting:10px;
--type-label:9px;
--type-compact:9px;
```

Replace the initial Arial body declaration with the complete global declaration below, then remove the duplicate body declaration currently under the `Readability scale` comment:

```css
body{
  margin:0;
  background:var(--canvas);
  color:var(--ink);
  font-family:var(--font-geist-sans),Inter,system-ui,-apple-system,"Segoe UI",sans-serif;
  font-size:14px;
  -webkit-font-smoothing:antialiased;
  text-rendering:optimizeLegibility;
}
```

Keep `button,input{font:inherit}` unchanged.

- [ ] **Step 4: Add the Overview hierarchy to the readability layer**

Add this block after the existing shared pulse/metric/card readability rules and before the Clients-specific readability rules:

```css
/* Overview typography harmonization */
.pulse-copy h2{font-size:var(--type-hero);font-weight:700;line-height:1.12}
.float-card b{font-size:var(--type-primary)}
.float-card small{font-size:var(--type-compact);color:#aeb8cf}
.metrics>button>div:nth-child(2)>span{font-size:var(--type-label);letter-spacing:.1em}
.metrics>button>div:nth-child(2)>b{font-size:var(--type-kpi);font-weight:700;line-height:1.1;font-variant-numeric:tabular-nums}
.metrics>button>div:nth-child(2)>small{font-size:var(--type-compact);color:#68778a}
.card-head h3{font-size:var(--type-card-title);font-weight:600;line-height:1.3}
.card-head p,.card-head>button{font-size:var(--type-supporting)}
.mini-kicker{font-size:var(--type-label);letter-spacing:.12em}
.tabs button{font-size:var(--type-supporting)}
.table-labels{font-size:var(--type-label);font-weight:700;letter-spacing:.08em}
.work-table article{min-height:78px}
.client b{font-size:var(--type-primary);font-weight:600;line-height:1.35}
.client p{font-size:var(--type-supporting);line-height:1.4;color:#657488}
.client p em{font-size:var(--type-compact)}
.client small{font-size:var(--type-compact);line-height:1.4;color:#748397}
.progress span{font-size:var(--type-compact)}
.owner span{font-size:var(--type-compact)}
.owner b{font-size:var(--type-supporting);font-weight:600}
.deadline b{font-size:var(--type-supporting)}
.deadline small{font-size:var(--type-compact);line-height:1.4}
.empty{font-size:var(--type-supporting)}
.donut b{font-size:var(--type-kpi)}
.donut span{font-size:var(--type-supporting)}
.donut small{font-size:var(--type-compact)}
.health-copy span{font-size:var(--type-supporting);color:#5f6f83}
.service-list>div{font-size:var(--type-compact)}
.service-list>div>b,.service-list em{font-size:var(--type-compact)}
.deadline-list time small{font-size:var(--type-compact)}
.deadline-list article>div b{font-size:11px;font-weight:600}
.deadline-list article>div small{font-size:var(--type-compact);line-height:1.4;color:#68778a}
.deadline-list article>span{font-size:var(--type-compact)}
```

Keep all Clients-specific readability declarations after this block unchanged.

- [ ] **Step 5: Run the focused test and verify it passes**

Run:

```powershell
npx tsx --test tests/typography-unit.test.ts
```

Expected: 2 tests pass, 0 fail.

- [ ] **Step 6: Run the complete automated verification**

Run:

```powershell
npm run test:unit
npx tsc --noEmit
npm run build:local
```

Expected: 15 unit tests pass, TypeScript exits with code 0, and Next.js reports `Compiled successfully`.

- [ ] **Step 7: Check the rendered hierarchy at the reference widths**

Start the existing development server with `npm run dev`. On Overview and Clients, verify at 1920px, 1440px, 1024px, 768px, and 375px widths:

- Overview table names, metadata, owners, progress values, due dates, health legend, services, and deadline radar are readable without zooming.
- No text clips, overlaps, or creates horizontal scrolling.
- The current card grid, sidebar width, gradients, and data density remain unchanged.
- Clients retains its approved hierarchy and layout.

If a compact panel clips, adjust only its minimum height or line height; do not shrink any approved text token below 9px.

- [ ] **Step 8: Commit only the typography implementation**

Run:

```powershell
git add -- app/globals.css tests/typography-unit.test.ts
git commit -m "style: harmonize dashboard typography"
```

Expected: the commit contains only `app/globals.css` and `tests/typography-unit.test.ts`; unrelated package-script changes remain unstaged.
