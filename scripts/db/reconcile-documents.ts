import { and, eq, lt } from "drizzle-orm";

import { documents } from "../../db/schema";
import { closePostgresPool, getDatabase } from "../../lib/dashboard/postgres/pool";
import { removeDocumentFile, removeStagedDocument } from "../../lib/documents/storage";

const STALE_AFTER_MS = 60 * 60_000;

async function main() {
  const database = getDatabase();
  const cutoff = new Date(Date.now() - STALE_AFTER_MS);
  const stale = await database.select({ id: documents.id, storageName: documents.storageName, tenantId: documents.tenantId })
    .from(documents)
    .where(and(eq(documents.status, "pending"), lt(documents.createdAt, cutoff)));

  for (const document of stale) {
    const [discarded] = await database.delete(documents).where(and(
      eq(documents.id, document.id), eq(documents.tenantId, document.tenantId), eq(documents.status, "pending"),
    )).returning({ id: documents.id });
    if (!discarded) continue;
    await Promise.all([
      removeStagedDocument(document.tenantId, document.storageName),
      removeDocumentFile(document.tenantId, document.storageName),
    ]);
  }
  console.log(`Document reconciliation removed ${stale.length} stale pending upload${stale.length === 1 ? "" : "s"}.`);
}

main()
  .catch(() => {
    console.error("Document reconciliation failed. Verify the local database and storage permissions.");
    process.exitCode = 1;
  })
  .finally(closePostgresPool);
