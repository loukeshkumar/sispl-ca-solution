/**
 * Document requests, two of them satisfied by an actual upload.
 *
 * Uploads go through `storeDocumentFile`, which hashes the bytes and writes them
 * through the same abstraction the product uses, so the local driver and S3 both
 * work. Seeding only the rows would leave a demo where every download fails.
 */
import { and, eq } from "drizzle-orm";

import { documents, legalEntities, workItems } from "../../../db/schema";
import { createDocumentRequest, recordDocumentUpload } from "../../../lib/documents/repository";
import { storeDocumentFile } from "../../../lib/documents/storage";
import type { DashboardDatabase } from "../../../lib/dashboard/postgres/repository";
import type { DemoContext } from "./context";

/** A minimal well-formed PDF, so a download returns something a viewer opens. */
function placeholderPdf(title: string) {
  const body = `%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 120]/Contents 4 0 R>>endobj\n4 0 obj<</Length ${title.length + 40}>>stream\nBT /F1 12 Tf 20 60 Td (${title}) Tj ET\nendstream endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n`;
  return new TextEncoder().encode(body);
}

function shiftDays(dateKey: string, days: number) {
  const shifted = new Date(`${dateKey}T00:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

export async function seedDemoDocuments(database: DashboardDatabase, context: DemoContext) {
  // Probing document requests would skip on every fresh database, because
  // `seed.ts` seeds those already. An uploaded document is this module's own.
  const [existing] = await database.select({ id: documents.id }).from(documents)
    .where(eq(documents.tenantId, context.tenantId)).limit(1);
  if (existing) return { requests: 0, uploads: 0 };

  const clients = await database.select({ id: legalEntities.id }).from(legalEntities)
    .where(and(eq(legalEntities.tenantId, context.tenantId), eq(legalEntities.status, "active")))
    .orderBy(legalEntities.displayName);
  if (!clients.length) throw new Error("No active clients found; run db:seed:local first.");
  const work = await database.select({ id: workItems.id, legalEntityId: workItems.legalEntityId })
    .from(workItems).where(eq(workItems.tenantId, context.tenantId));

  const { todayKey } = context.calendar;
  const plan = [
    { title: "Bank statements", description: "All operating accounts for the period.", upload: true },
    { title: "Purchase register", description: "Tally export covering the month.", upload: true },
    { title: "Signed engagement letter", description: "Scanned copy with authorised signature.", upload: false },
  ];

  let requests = 0;
  let uploads = 0;
  for (const [index, entry] of plan.entries()) {
    const client = clients[index % clients.length];
    const relatedWork = work.find((item) => item.legalEntityId === client.id) ?? null;
    const requestId = await createDocumentRequest(database, context.tenantId, context.actors.administratorId, {
      description: entry.description,
      dueDate: shiftDays(todayKey, 7 - index * 4),
      legalEntityId: client.id,
      title: entry.title,
      workItemId: relatedWork?.id ?? null,
    });
    requests += 1;
    if (!entry.upload) continue;

    const bytes = placeholderPdf(entry.title);
    const stored = await storeDocumentFile(context.tenantId, bytes);
    await recordDocumentUpload(database, context.tenantId, context.actors.administratorId, {
      legalEntityId: client.id,
      workItemId: relatedWork?.id ?? null,
      requestId,
      originalName: `${entry.title.toLowerCase().replace(/\s+/g, "-")}.pdf`,
      storageName: stored.storageName,
      mimeType: "application/pdf",
      sizeBytes: bytes.byteLength,
      sha256: stored.sha256,
    });
    uploads += 1;
  }

  return { requests, uploads };
}
