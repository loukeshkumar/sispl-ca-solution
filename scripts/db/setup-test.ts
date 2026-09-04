import pg from "pg";

import { resolveTestDatabaseUrl } from "../../lib/dashboard/postgres/test-config";

async function main() {
  const testUrl = resolveTestDatabaseUrl(process.env);
  const parsedTestUrl = new URL(testUrl);
  const databaseName = decodeURIComponent(parsedTestUrl.pathname.replace(/^\//, ""));
  const maintenanceUrl = new URL(process.env.DATABASE_URL as string);
  maintenanceUrl.pathname = "/postgres";
  maintenanceUrl.searchParams.delete("connection_limit");
  maintenanceUrl.searchParams.delete("pool_timeout");
  const client = new pg.Client({ connectionString: maintenanceUrl.toString() });
  await client.connect();
  try {
    // Dropped and rebuilt, not reused. The integration tests mutate rows and
    // clean up after themselves per test, but a run that fails part-way leaves
    // its fixtures behind, and the next run then fails somewhere unrelated. A
    // suite whose result depends on what the previous run left is not a suite
    // anybody can trust, so every run starts from an empty database.
    const quotedName = `"${databaseName.replaceAll('"', '""')}"`;
    await client.query(`drop database if exists ${quotedName} with (force)`);
    await client.query(`create database ${quotedName}`);
  } finally {
    await client.end();
  }

  process.env.DATABASE_URL = testUrl;
  const { migrateDatabase } = await import("./migrate");
  const { seedDevelopmentData } = await import("./seed");
  const { closePostgresPool, getDatabase } = await import("../../lib/dashboard/postgres/pool");
  try {
    await migrateDatabase();
    await seedDevelopmentData(getDatabase());
  } finally {
    await closePostgresPool();
  }
  console.log(`Isolated integration database ready: ${databaseName}`);
}

main().catch(() => {
  console.error("Test database setup failed. Confirm the PostgreSQL role can create and migrate an isolated *_test database.");
  process.exitCode = 1;
});
