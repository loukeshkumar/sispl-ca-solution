import assert from "node:assert/strict";
import test from "node:test";

import { readPostgresConfig } from "../lib/dashboard/config";
import { demoDashboardRecords } from "../lib/dashboard/fixtures";
import { mapDashboardRecords } from "../lib/dashboard/mapper";
import { getDashboardDataForConfiguredSource } from "../lib/dashboard/provider";

test("PostgreSQL configuration maps pool-only URL parameters without losing driver parameters", () => {
  const config = readPostgresConfig({
    SISPL_DATA_SOURCE: "postgres",
    DATABASE_URL:
      "postgresql://sispl_user:sensitive-value@localhost:5432/sispl_ca_solution?connection_limit=30&pool_timeout=30&sslmode=disable",
  });

  const sanitized = new URL(config.connectionString);
  assert.equal(sanitized.searchParams.has("connection_limit"), false);
  assert.equal(sanitized.searchParams.has("pool_timeout"), false);
  assert.equal(sanitized.searchParams.get("sslmode"), "disable");
  assert.equal(config.max, 30);
  assert.equal(config.connectionTimeoutMillis, 30_000);
  assert.equal(config.host, "localhost");
  assert.equal(config.port, 5432);
  assert.equal(config.database, "sispl_ca_solution");
});

test("PostgreSQL configuration failures never disclose credentials", () => {
  assert.throws(
    () =>
      readPostgresConfig({
        SISPL_DATA_SOURCE: "postgres",
        DATABASE_URL: "not-a-url-with-sensitive-value",
      }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /DATABASE_URL/);
      assert.doesNotMatch(error.message, /sensitive-value/);
      return true;
    },
  );

  assert.throws(
    () => readPostgresConfig({ SISPL_DATA_SOURCE: "postgres" }),
    /DATABASE_URL is required/,
  );
});

test("dashboard mapping derives client, work, deadline, and KPI values from one record set", () => {
  const dashboard = mapDashboardRecords(
    demoDashboardRecords,
    new Date("2026-08-15T09:00:00+05:30"),
  );

  assert.equal(dashboard.practice.name, "Sharma & Kumar");
  assert.equal(dashboard.clients.length, 5);
  assert.equal(dashboard.work.length, 4);
  assert.equal(dashboard.clients[0]?.short, "AR");
  assert.equal(dashboard.work[0]?.ownerInitials, "RK");
  assert.equal(dashboard.metrics.clientGroups, 5);
  assert.equal(dashboard.metrics.legalEntities, 5);
  assert.equal(dashboard.metrics.gstRegistrations, 11);
  assert.equal(dashboard.metrics.attentionClients, 3);
  assert.equal(dashboard.metrics.overdue, 1);
  assert.equal(dashboard.metrics.waitingOnClient, 1);
  assert.equal(dashboard.metrics.pendingReview, 1);
  assert.equal(dashboard.work.find((item) => item.client === "Aarav Retail Pvt. Ltd.")?.due, "Today");
  assert.equal(dashboard.work.find((item) => item.client === "Neelam Foods")?.due, "Tomorrow");
  assert.ok(dashboard.deadlines.length > 0);
});

test("PostgreSQL mode propagates provider failure instead of using demo records", async () => {
  const databaseFailure = new Error("database unavailable");

  await assert.rejects(
    getDashboardDataForConfiguredSource(
      { SISPL_DATA_SOURCE: "postgres", DATABASE_URL: "postgresql://localhost/sispl" },
      {
        now: new Date("2026-08-15T09:00:00+05:30"),
        getPostgresDashboardData: async () => {
          throw databaseFailure;
        },
      },
    ),
    (error: unknown) => error === databaseFailure,
  );
});

test("an omitted data source selects deterministic demo data", async () => {
  const dashboard = await getDashboardDataForConfiguredSource(
    {},
    { now: new Date("2026-08-15T09:00:00+05:30") },
  );

  assert.equal(dashboard.source, "demo");
  assert.equal(dashboard.clients.length, 5);
});
