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
    ".priority-queue-panel{grid-column:span8",
    ".overview-insights{grid-column:span4",
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
  assert.doesNotMatch(compactCss, /button\.kpi-card:hover[^}]*transform:/);
  assert.match(compactCss, /\.dashboard-sidebar\{[^}]*overflow-y:auto/);
  assert.match(compactCss, /\.client-detail-body\{[^}]*max-height:calc\(100vh-var\(--command-bar-height\)-190px\)[^}]*overflow-y:auto/);
  assert.match(compactCss, /@media\(max-width:1535px\)[\s\S]*\.portfolio-list-head,.portfolio-row\{grid-template-columns:minmax\(180px,2fr\)/);
  assert.match(compactCss, /@media\(max-width:1499px\)[\s\S]*\.work-list-head,.work-row\{grid-template-columns:minmax\(205px,2fr\)/);
  assert.match(compactCss, /@media\(max-width:1199px\)[\s\S]*\.priority-queue-panel,.overview-insights\{grid-column:1\/-1/);
  assert.match(compactCss, /@media\(max-width:1149px\)[\s\S]*\.client-detail-body\{max-height:none;overflow:visible/);
});
