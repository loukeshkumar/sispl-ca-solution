import { pathToFileURL } from "node:url";

import { closePostgresPool, getDatabase } from "../../lib/dashboard/postgres/pool";
import { generateRecurringWorkItems } from "../../lib/compliance/repository";
import { expireLapsedCertificates } from "../../lib/registers/repository";
import { listActiveTenantIds } from "../../lib/notifications/repository";

export async function runRecurrenceJob() {
  const database = getDatabase();
  const tenantIds = await listActiveTenantIds(database);
  let created = 0;
  let expiredCertificates = 0;
  for (const tenantId of tenantIds) {
    created += await generateRecurringWorkItems(database, tenantId);
    expiredCertificates += await expireLapsedCertificates(database, tenantId);
  }
  return { tenants: tenantIds.length, created, expiredCertificates };
}

async function main() {
  const summary = await runRecurrenceJob();
  console.info("recurrence.job.completed", summary);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .catch((error) => {
      console.error("recurrence.job.failed", { errorType: error instanceof Error ? error.name : "UnknownError" });
      process.exitCode = 1;
    })
    .finally(async () => {
      await closePostgresPool();
    });
}
