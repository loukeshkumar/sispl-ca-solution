import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = async (path: string) => {
  try {
    return await readFile(new URL(`../${path}`, import.meta.url), "utf8");
  } catch {
    return "";
  }
};

test("overview presents five truthful operational KPIs and premium analytics", async () => {
  const overview = await read("app/dashboard/overview-workspace.tsx");
  const analytics = await read("app/dashboard/overview-analytics.tsx");

  assert.equal((overview.match(/<KpiCard/g) ?? []).length, 5);
  for (const metric of ["attentionNeeded", "onTimeRate", "averageHealth", "dueThisWeek", "activeTeamMembers"]) {
    assert.match(overview, new RegExp(`data\\.(?:metrics|practice)\\.${metric}`), `missing live KPI ${metric}`);
  }
  assert.match(overview, /<OverviewAnalytics data=\{data\} \/>/);
  assert.match(overview, /priority-queue-panel/);
  assert.doesNotMatch(overview, /overview-summary-ribbon|Team capacity/);

  assert.match(analytics, /"use client"/);
  assert.match(analytics, /from "recharts"/);
  for (const chart of ["ComposedChart", "Bar", "Area", "PieChart", "Pie", "RadialBarChart", "RadialBar"]) {
    assert.match(analytics, new RegExp(`\\b${chart}\\b`), `missing Recharts primitive ${chart}`);
  }
  for (const builder of ["buildServicePerformance", "buildDeadlinePressure", "buildWorkStatusDistribution", "buildGaugeMetrics"]) {
    assert.match(analytics, new RegExp(`\\b${builder}\\b`), `missing live transformation ${builder}`);
  }
  assert.match(analytics, /aria-label="Service performance chart"/);
  assert.match(analytics, /aria-label="Deadline pressure values"/);
  assert.match(analytics, /deadlines\.map/);
  assert.match(analytics, /aria-label="Work status distribution chart"/);
  assert.match(analytics, /analytics-text-summary/);
  assert.match(analytics, /prefers-reduced-motion: reduce/);

  // Guards against invented figures. `placeholder=` is an input hint, not data,
  // so the attribute form is excluded rather than the word being banned outright.
  const combined = `${overview}\n${analytics}`.toLowerCase();
  assert.doesNotMatch(combined, /revenue|% change|placeholder(?!=)/);
});

test("KPI micro visualizations consume supplied live values instead of decorative constants", async () => {
  const ui = await read("app/dashboard/dashboard-ui.tsx");
  assert.match(ui, /sparkValues\?: number\[\]/);
  assert.match(ui, /sparkValues\.map/);
  assert.doesNotMatch(ui, /\[38, 54, 44, 72, 61\]/);
});
