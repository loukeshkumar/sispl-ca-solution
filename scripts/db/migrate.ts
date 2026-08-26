import { migrate } from "drizzle-orm/node-postgres/migrator";
import { pathToFileURL } from "node:url";

import { closePostgresPool, getDatabase } from "../../lib/dashboard/postgres/pool";

export async function migrateDatabase() {
  await migrate(getDatabase(), { migrationsFolder: "drizzle" });
}

async function main() {
  await migrateDatabase();
  console.log("Database migrations applied.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .catch(() => {
      console.error("Database migration failed. Verify DATABASE_URL and PostgreSQL availability.");
      process.exitCode = 1;
    })
    .finally(closePostgresPool);
}
