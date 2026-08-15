import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { getDashboardErrorViewModel } from "../app/dashboard-error";

const root = new URL("../", import.meta.url);

test("interactive dashboard receives records through props without importing PostgreSQL", async () => {
  const clientSource = await readFile(new URL("app/dashboard-client.tsx", root), "utf8");

  assert.match(clientSource, /DashboardData/);
  assert.match(clientSource, /data:\s*DashboardData/);
  assert.doesNotMatch(clientSource, /dashboard\/postgres|node-postgres|\bpg\b/);
  assert.doesNotMatch(clientSource, /const\s+(clients|work)\s*[:=]/);
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
