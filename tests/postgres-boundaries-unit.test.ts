import assert from "node:assert/strict";
import test from "node:test";

import { demoDashboardRecords, SEEDED_TENANT_ID, SEEDED_TENANT_SLUG } from "../lib/dashboard/fixtures";
import { getPostgresDashboardData } from "../lib/dashboard/postgres/provider";
import { findTenantIdBySlug, loadDashboardRecords } from "../lib/dashboard/postgres/repository";

test("repository rejects an empty tenant id before querying", async () => {
  let queried = false;
  const unusableDatabase = new Proxy({}, {
    get() {
      queried = true;
      throw new Error("query should not run");
    },
  });

  await assert.rejects(
    loadDashboardRecords(unusableDatabase as never, ""),
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
