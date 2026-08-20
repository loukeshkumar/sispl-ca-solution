import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import postcss from "postcss";

const root = new URL("../", import.meta.url);
const read = async (path: string) => {
  try {
    return await readFile(new URL(path, root), "utf8");
  } catch {
    return "";
  }
};

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
  assert.match(overview, /overview-kpi-grid/);
  assert.match(overview, /<OverviewAnalytics/);
  assert.match(overview, /priority-queue-panel/);
  assert.doesNotMatch(overview, /overview-summary-ribbon|Team capacity/);
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
    ".overview-analytics{display:grid",
    ".overview-kpi-grid{grid-template-columns:repeat(5,minmax(0,1fr))",
    ".analytics-gauge-grid{display:grid",
    ".clients-main{display:grid;grid-template-columns:repeat(12,minmax(0,1fr))",
    ".client-portfolio-panel{grid-column:span8",
    ".client-detail-panel{grid-column:span4",
  ];

  for (const token of required) assert.ok(compactCss.includes(token), `missing ${token}`);
  for (const query of ["(max-width:1279px)", "(max-width:1149px)", "(max-width:1023px)", "(max-width:767px)"]) {
    assert.ok(
      parsed.nodes.some((node) => node.type === "atrule" && node.name === "media" && node.params === query),
      `missing ${query}`,
    );
  }
  assert.match(compactCss, /@media\(max-width:767px\)[\s\S]*\.work-row\{grid-template-columns:1frauto/);
  assert.match(compactCss, /@media\(max-width:767px\)[\s\S]*\.portfolio-row\{grid-template-columns:1frauto/);
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
  assert.match(css, /--control-height:\s*44px/);
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
});

test("tablet layouts avoid crowded grids and sticky detail overflow", async () => {
  const css = await read("app/globals.css");
  const compactCss = css.replace(/\s+/g, "");

  assert.doesNotMatch(compactCss, /\.workspace-canvas\{[^}]*max-width:/);
  assert.match(compactCss, /button\.kpi-card:hover[^}]*transform:translateY\(-2px\)/);
  assert.match(compactCss, /@media\(prefers-reduced-motion:reduce\)[\s\S]*button\.kpi-card:hover[\s\S]*transform:none!important/);
  assert.match(compactCss, /\.dashboard-sidebar\{[^}]*overflow-y:auto/);
  assert.match(compactCss, /\.client-detail-body\{[^}]*max-height:calc\(100vh-var\(--command-bar-height\)-190px\)[^}]*overflow-y:auto/);
  assert.match(compactCss, /@media\(max-width:1535px\)[\s\S]*\.portfolio-list-head,.portfolio-row\{grid-template-columns:minmax\(180px,2fr\)/);
  assert.match(compactCss, /@media\(max-width:1499px\)[\s\S]*\.work-list-head,.work-row\{grid-template-columns:minmax\(205px,2fr\)/);
  assert.match(compactCss, /@media\(max-width:1439px\)[\s\S]*\.overview-kpi-grid\{grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(compactCss, /@media\(max-width:1023px\)[\s\S]*\.overview-analytics\{grid-template-columns:1fr/);
  assert.match(compactCss, /@media\(max-width:1149px\)[\s\S]*\.client-detail-body\{max-height:none;overflow:visible/);
});

test("the persistent shell uses Lucide icons and exposes theme switching", async () => {
  const [icons, shell] = await Promise.all([
    read("app/dashboard/dashboard-icons.tsx"),
    read("app/dashboard/dashboard-shell.tsx"),
  ]);

  assert.match(icons, /from "lucide-react"/);
  for (const name of ["overview", "work", "clients", "compliance", "documents", "calendar", "team", "insights", "search", "bell", "sun", "moon"]) {
    assert.match(icons, new RegExp(`\\b${name}:`), `missing Lucide mapping for ${name}`);
  }
  assert.doesNotMatch(icons, /iconPaths/);
  assert.match(shell, /import \{ ThemeToggle \}/);
  assert.match(shell, /<ThemeToggle \/>/);
});
