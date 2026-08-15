import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { and, count, eq } from "drizzle-orm";

import { clientGroups, legalEntities, tenants, workItems } from "../db/schema";
import { SEEDED_TENANT_ID } from "../lib/dashboard/fixtures";
import { closePostgresPool, getDatabase, getPostgresPool } from "../lib/dashboard/postgres/pool";
import { loadDashboardRecords } from "../lib/dashboard/postgres/repository";
import { getSeedCounts, seedDevelopmentData } from "../scripts/db/seed";

const FOREIGN_TENANT_ID = "10000000-0000-4000-8000-000000000099";
const databaseUrl = process.env.DATABASE_URL;

before(() => {
  assert.ok(databaseUrl, "DATABASE_URL is required; create .env.local from .env.example before running integration tests.");
});

after(async () => {
  await closePostgresPool();
});

test("configured PostgreSQL accepts a basic query", async () => {
  const result = await getPostgresPool().query<{ value: number }>("select 1::int as value");
  assert.equal(result.rows[0]?.value, 1);
});

test("development seed is idempotent and loads the expected dashboard rows", async () => {
  const database = getDatabase();
  await seedDevelopmentData(database);
  const firstCounts = await getSeedCounts(database, SEEDED_TENANT_ID);
  await seedDevelopmentData(database);
  const secondCounts = await getSeedCounts(database, SEEDED_TENANT_ID);

  assert.deepEqual(secondCounts, firstCounts);
  assert.deepEqual(secondCounts, {
    tenants: 1,
    clientGroups: 5,
    legalEntities: 5,
    workItems: 4,
  });

  const records = await loadDashboardRecords(database, SEEDED_TENANT_ID);
  assert.equal(records.clients.length, 5);
  assert.equal(records.workItems.length, 4);
});

test("a different tenant id cannot read seeded client or work records", async () => {
  const database = getDatabase();
  const [clientCount] = await database.select({ value: count() }).from(legalEntities)
    .where(eq(legalEntities.tenantId, FOREIGN_TENANT_ID));
  const [workCount] = await database.select({ value: count() }).from(workItems)
    .where(eq(workItems.tenantId, FOREIGN_TENANT_ID));

  assert.equal(clientCount?.value, 0);
  assert.equal(workCount?.value, 0);

  const [seededDataVisibleThroughForeignTenant] = await database
    .select({ value: count() })
    .from(legalEntities)
    .innerJoin(clientGroups, and(
      eq(clientGroups.id, legalEntities.clientGroupId),
      eq(clientGroups.tenantId, FOREIGN_TENANT_ID),
    ))
    .innerJoin(tenants, eq(tenants.id, FOREIGN_TENANT_ID));
  assert.equal(seededDataVisibleThroughForeignTenant?.value, 0);
});
