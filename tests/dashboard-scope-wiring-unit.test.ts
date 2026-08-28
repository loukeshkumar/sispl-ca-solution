import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

/**
 * Both entry points render dashboard data, so a scope resolved in only one of
 * them would leave the sidebar contradicting the page it frames.
 */
test("every dashboard entry point resolves a scope before loading data", async () => {
  for (const path of ["../app/page.tsx", "../app/workspace-route-frame.tsx"]) {
    const source = await read(path);
    assert.match(source, /listDirectReports\(/, `${path} reads the reporting line`);
    assert.match(source, /dashboardScopeFor\(/, `${path} resolves a scope`);
    assert.match(
      source,
      /getPostgresDashboardDataForTenant\(session\.tenantId, scope\)/,
      `${path} passes the scope to the provider`,
    );
    // A leftover FIRM_SCOPE placeholder would compile cleanly and silently
    // leave this entry point firm-wide, which is the exact failure this
    // feature exists to prevent.
    assert.doesNotMatch(source, /FIRM_SCOPE/, `${path} no longer references FIRM_SCOPE`);
  }
});
