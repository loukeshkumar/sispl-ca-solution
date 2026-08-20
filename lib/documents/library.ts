import { and, desc, eq } from "drizzle-orm";

import { documents, legalEntities, users, workItems } from "../../db/schema";
import type { DashboardDatabase } from "../dashboard/postgres/repository";

export type ClientDocument = {
  context: string;
  id: string;
  mimeType: string;
  originalName: string;
  sizeBytes: number;
  uploadedAt: string;
  uploadedBy: string;
};

export type ClientDocumentGroup = {
  documents: ClientDocument[];
  legalEntityId: string;
  legalName: string;
  name: string;
  totalBytes: number;
};

export type ClientDocumentLibrary = {
  clients: Array<{ id: string; name: string }>;
  groups: ClientDocumentGroup[];
  totalBytes: number;
  totalDocuments: number;
};

/**
 * Types the viewer may open in the browser rather than download.
 *
 * Deliberately narrow. Serving an uploaded file inline lets it run in the
 * application's origin, so HTML and SVG — both of which can carry script — are
 * download-only no matter what the uploader named them.
 */
export const INLINE_VIEWABLE = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp", "image/gif"]);

export const canViewInline = (mimeType: string) => INLINE_VIEWABLE.has(mimeType.toLowerCase());

/**
 * Every stored document for the firm, grouped by the client it belongs to.
 *
 * Only committed uploads appear: a pending row is a staged file that has not
 * passed its integrity check yet, and listing one would offer a download that
 * cannot be served.
 */
export async function listClientDocumentLibrary(
  database: DashboardDatabase,
  tenantId: string,
  legalEntityId?: string,
): Promise<ClientDocumentLibrary> {
  const scoped = legalEntityId ? and(eq(documents.tenantId, tenantId), eq(documents.legalEntityId, legalEntityId)) : eq(documents.tenantId, tenantId);

  const [rows, clients] = await Promise.all([
    database
      .select({
        id: documents.id,
        legalEntityId: documents.legalEntityId,
        legalName: legalEntities.legalName,
        mimeType: documents.mimeType,
        name: legalEntities.displayName,
        originalName: documents.originalName,
        periodKey: workItems.periodKey,
        serviceKey: workItems.serviceKey,
        sizeBytes: documents.sizeBytes,
        uploadedAt: documents.createdAt,
        uploadedBy: users.fullName,
      })
      .from(documents)
      .innerJoin(legalEntities, and(eq(legalEntities.tenantId, documents.tenantId), eq(legalEntities.id, documents.legalEntityId)))
      .innerJoin(users, eq(users.id, documents.uploadedByUserId))
      .leftJoin(workItems, and(eq(workItems.tenantId, documents.tenantId), eq(workItems.id, documents.workItemId)))
      // "ready" is a committed upload. A "pending" row is still staged and has
      // not passed its integrity check, so listing one would offer a download
      // that cannot be served. Those two are the only statuses the schema allows.
      .where(and(scoped, eq(documents.status, "ready")))
      .orderBy(desc(documents.createdAt)),
    database
      .select({ id: legalEntities.id, legalName: legalEntities.legalName, name: legalEntities.displayName })
      .from(legalEntities)
      .where(and(eq(legalEntities.tenantId, tenantId), eq(legalEntities.status, "active")))
      .orderBy(legalEntities.displayName),
  ]);

  /*
   * Every active client gets a row, including those with nothing on file. A
   * library that hides empty clients has nothing to show a firm on its first
   * day and no way to start — the row itself is where an upload begins.
   */
  const groups = new Map<string, ClientDocumentGroup>(
    clients.map((client) => [client.id, { documents: [], legalEntityId: client.id, legalName: client.legalName, name: client.name, totalBytes: 0 }]),
  );
  let totalBytes = 0;
  for (const row of rows) {
    totalBytes += row.sizeBytes;
    // An archived client keeps its documents, so it may not be in the active list.
    const group = groups.get(row.legalEntityId) ?? { documents: [], legalEntityId: row.legalEntityId, legalName: row.legalName, name: row.name, totalBytes: 0 };
    group.totalBytes += row.sizeBytes;
    group.documents.push({
      // What the file was filed against, so a name like "scan_02.pdf" still has meaning.
      context: row.serviceKey ? `${row.serviceKey.replaceAll("_", " ").toUpperCase()} · ${row.periodKey}` : "General client record",
      id: row.id,
      mimeType: row.mimeType,
      originalName: row.originalName,
      sizeBytes: row.sizeBytes,
      uploadedAt: row.uploadedAt.toISOString(),
      uploadedBy: row.uploadedBy,
    });
    groups.set(row.legalEntityId, group);
  }

  return {
    clients: clients.map(({ id, name }) => ({ id, name })),
    groups: [...groups.values()].sort((a, b) => a.name.localeCompare(b.name)),
    totalBytes,
    totalDocuments: rows.length,
  };
}
