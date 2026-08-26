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
    const existing = await client.query<{ exists: boolean }>("select exists(select 1 from pg_database where datname = $1) as exists", [databaseName]);
    if (!existing.rows[0]?.exists) {
      const quotedName = `"${databaseName.replaceAll('"', '""')}"`;
      await client.query(`create database ${quotedName}`);
    }
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
