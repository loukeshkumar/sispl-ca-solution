import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { getDashboardErrorViewModel } from "../app/dashboard-error";

const root = new URL("../", import.meta.url);

test("interactive dashboard modules receive records without importing PostgreSQL", async () => {
  const modules = [
    "app/dashboard-client.tsx",
    "app/dashboard/dashboard-shell.tsx",
    "app/dashboard/dashboard-ui.tsx",
    "app/dashboard/overview-workspace.tsx",
    "app/dashboard/clients-workspace.tsx",
  ];
  const source = (await Promise.all(modules.map(async (path) => {
    try {
      return await readFile(new URL(path, root), "utf8");
    } catch {
      return "";
    }
  }))).join("\n");

  assert.match(source, /DashboardData/);
  assert.doesNotMatch(source, /dashboard\/postgres|node-postgres|from ["']pg["']/);
  assert.doesNotMatch(source, /const\s+(clients|work)\s*[:=]\s*\[/);
});

test("server page loads the configured provider and remains dynamic", async () => {
  const pageSource = await readFile(new URL("app/page.tsx", root), "utf8");

  assert.match(pageSource, /getDashboardDataForConfiguredSource/);
  assert.match(pageSource, /export const dynamic\s*=\s*["']force-dynamic["']/);
  assert.match(pageSource, /async function/);
});

test("database error view model exposes setup help without error details", () => {
  const secret = "postgresql://admin:super-secret@localhost:5432/sispl";
  const viewModel = getDashboardErrorViewModel(new Error(`connect ECONNREFUSED ${secret}`));

  assert.match(viewModel.title, /database/i);
  assert.match(viewModel.guidance, /\.env\.local/);
  assert.doesNotMatch(JSON.stringify(viewModel), /super-secret|postgresql:\/\//);
});
