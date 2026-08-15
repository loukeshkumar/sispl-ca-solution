import { migrate } from "drizzle-orm/node-postgres/migrator";

import { closePostgresPool, getDatabase } from "../../lib/dashboard/postgres/pool";

async function main() {
  await migrate(getDatabase(), { migrationsFolder: "drizzle" });
  console.log("Database migrations applied.");
}

main()
  .catch(() => {
    console.error("Database migration failed. Verify DATABASE_URL and PostgreSQL availability.");
    process.exitCode = 1;
  })
  .finally(closePostgresPool);
