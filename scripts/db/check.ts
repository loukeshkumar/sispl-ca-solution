import { readPostgresConfig } from "../../lib/dashboard/config";
import { closePostgresPool, getPostgresPool } from "../../lib/dashboard/postgres/pool";

const requiredTables = [
  "tenants",
  "users",
  "tenant_memberships",
  "client_groups",
  "legal_entities",
  "client_services",
  "registrations",
  "work_items",
  "audit_events",
];

async function main() {
  const config = readPostgresConfig(process.env);
  const pool = getPostgresPool();
  const server = await pool.query<{ database: string; version: string }>(
    "select current_database() as database, current_setting('server_version') as version",
  );
  const tables = await pool.query<{ table_name: string }>(
    "select table_name from information_schema.tables where table_schema = 'public' and table_name = any($1::text[])",
    [requiredTables],
  );
  const found = new Set(tables.rows.map((row) => row.table_name));
  const missing = requiredTables.filter((table) => !found.has(table));

  console.log(`PostgreSQL ${server.rows[0]?.version ?? "unknown"} at ${config.host}:${config.port}`);
  console.log(`Database: ${server.rows[0]?.database ?? config.database}`);
  console.log(missing.length ? `Missing tables: ${missing.join(", ")}` : `Required tables: ${requiredTables.length}/${requiredTables.length}`);
  if (missing.length) process.exitCode = 1;
}

main()
  .catch(() => {
    console.error("Database check failed. Verify DATABASE_URL and PostgreSQL availability.");
    process.exitCode = 1;
  })
  .finally(closePostgresPool);
