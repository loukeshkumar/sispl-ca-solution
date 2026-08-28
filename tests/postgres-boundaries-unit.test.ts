import assert from "node:assert/strict";
import test from "node:test";

import { demoDashboardRecords, SEEDED_TENANT_ID, SEEDED_TENANT_SLUG } from "../lib/dashboard/fixtures";
import { getPostgresDashboardData, getPostgresDashboardDataForTenant } from "../lib/dashboard/postgres/provider";
import { findTenantIdBySlug, loadDashboardRecords } from "../lib/dashboard/postgres/repository";
import { resolveTestDatabaseUrl } from "../lib/dashboard/postgres/test-config";
import { FIRM_SCOPE } from "../lib/dashboard/scope";

test("integration database URLs are isolated from the development database", () => {
  const derived = new URL(resolveTestDatabaseUrl({ DATABASE_URL: "postgresql://user:secret@localhost:5432/sispl_local" }));
  assert.equal(derived.pathname, "/sispl_local_test");
  assert.throws(() => resolveTestDatabaseUrl({
    DATABASE_URL: "postgresql://user:secret@localhost:5432/sispl_local",
    DATABASE_URL_TEST: "postgresql://user:secret@localhost:5432/sispl_local",
  }), /separate database/);
  assert.throws(() => resolveTestDatabaseUrl({
    DATABASE_URL: "postgresql://user:secret@localhost:5432/sispl_local",
    DATABASE_URL_TEST: "postgresql://user:secret@localhost:5432/shared_ci",
  }), /ends with _test/);
});

test("repository rejects an empty tenant id before querying", async () => {
  let queried = false;
  const unusableDatabase = new Proxy({}, {
    get() {
      queried = true;
      throw new Error("query should not run");
    },
  });

  await assert.rejects(
    loadDashboardRecords(unusableDatabase as never, "", FIRM_SCOPE),
    /tenantId is required/,
  );
  assert.equal(queried, false);
});

test("tenant lookup rejects an empty seeded slug before querying", async () => {
  await assert.rejects(findTenantIdBySlug({} as never, ""), /tenantSlug is required/);
});

test("PostgreSQL provider resolves the seeded slug and passes its explicit tenant id to the repository", async () => {
  let receivedSlug = "";
  let receivedTenantId = "";

  const dashboard = await getPostgresDashboardData(
    SEEDED_TENANT_SLUG,
    new Date("2026-08-15T09:00:00+05:30"),
    {
      getDatabase: () => ({}) as never,
      findTenantIdBySlug: async (_database, tenantSlug) => {
        receivedSlug = tenantSlug;
        return SEEDED_TENANT_ID;
      },
      loadDashboardRecords: async (_database, tenantId) => {
        receivedTenantId = tenantId;
        return demoDashboardRecords;
      },
    },
  );

  assert.equal(receivedSlug, SEEDED_TENANT_SLUG);
  assert.equal(receivedTenantId, SEEDED_TENANT_ID);
  assert.equal(dashboard.source, "postgres");
  assert.equal(dashboard.clients.length, 5);
});

test("PostgreSQL provider does not continue when the seeded tenant is missing", async () => {
  let repositoryCalled = false;

  await assert.rejects(
    getPostgresDashboardData(SEEDED_TENANT_SLUG, undefined, {
      getDatabase: () => ({}) as never,
      findTenantIdBySlug: async () => null,
      loadDashboardRecords: async () => {
        repositoryCalled = true;
        return demoDashboardRecords;
      },
    }),
    /Seeded tenant .* was not found/,
  );
  assert.equal(repositoryCalled, false);
});

test("authenticated PostgreSQL provider loads only the explicit session tenant", async () => {
  let receivedTenantId = "";
  let receivedScope: unknown = null;
  const dashboard = await getPostgresDashboardDataForTenant(
    SEEDED_TENANT_ID,
    { kind: "own", userId: "viewer-1" },
    new Date("2026-08-15T09:00:00+05:30"),
    {
      getDatabase: () => ({}) as never,
      loadDashboardRecords: async (_database, tenantId, scope) => {
        receivedTenantId = tenantId;
        receivedScope = scope;
        return demoDashboardRecords;
      },
    },
  );

  assert.equal(receivedTenantId, SEEDED_TENANT_ID);
  assert.deepEqual(receivedScope, { kind: "own", userId: "viewer-1" });
  assert.equal(dashboard.source, "postgres");
  assert.equal(dashboard.scope?.kind, "own");
});

test("hasReports is false for a team scope holding only the viewer, and true once a report joins", async () => {
  const dependencies = {
    getDatabase: () => ({}) as never,
    loadDashboardRecords: async () => demoDashboardRecords,
  };

  const soloManager = await getPostgresDashboardDataForTenant(
    SEEDED_TENANT_ID,
    { kind: "team", userIds: ["manager-1"] },
    new Date("2026-08-15T09:00:00+05:30"),
    dependencies,
  );
  assert.equal(soloManager.scope?.kind, "team");
  assert.equal(soloManager.scope?.hasReports, false);

  const managerWithReport = await getPostgresDashboardDataForTenant(
    SEEDED_TENANT_ID,
    { kind: "team", userIds: ["manager-1", "report-1"] },
    new Date("2026-08-15T09:00:00+05:30"),
    dependencies,
  );
  assert.equal(managerWithReport.scope?.kind, "team");
  assert.equal(managerWithReport.scope?.hasReports, true);
});
