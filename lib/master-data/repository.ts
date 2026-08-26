import { randomUUID } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";

import { auditEvents, documentChecklistItems, serviceCatalog } from "../../db/schema";
import type { DashboardDatabase } from "../dashboard/postgres/repository";
import type { DocumentChecklistInput } from "./validation";

export class MasterDataError extends Error {
  constructor(public readonly code: "not_found" | "duplicate_code") {
    super(code === "not_found" ? "The checklist item was not found." : "That code is already used by another checklist item.");
    this.name = "MasterDataError";
  }
}

export type DocumentChecklistRow = {
  id: string;
  code: string;
  name: string;
  category: string;
  instructions: string;
  serviceCode: string;
  serviceName: string | null;
  defaultLeadDays: number;
  mandatory: boolean;
  status: string;
};

export type MasterDataWorkspace = {
  checklist: DocumentChecklistRow[];
  services: Array<{ code: string; name: string }>;
  categories: string[];
  metrics: { active: number; archived: number; mandatory: number; linkedToServices: number };
};

function requireTenant(tenantId: string) {
  if (!tenantId.trim()) throw new Error("Tenant is required.");
}

export async function listMasterDataWorkspace(database: DashboardDatabase, tenantId: string): Promise<MasterDataWorkspace> {
  requireTenant(tenantId);
  const [rows, services] = await Promise.all([
    database.select({
      id: documentChecklistItems.id,
      code: documentChecklistItems.code,
      name: documentChecklistItems.name,
      category: documentChecklistItems.category,
      instructions: documentChecklistItems.instructions,
      serviceCode: documentChecklistItems.serviceCode,
      serviceName: serviceCatalog.name,
      defaultLeadDays: documentChecklistItems.defaultLeadDays,
      mandatory: documentChecklistItems.mandatory,
      status: documentChecklistItems.status,
    }).from(documentChecklistItems)
      .leftJoin(serviceCatalog, and(
        eq(serviceCatalog.tenantId, documentChecklistItems.tenantId),
        eq(sql`lower(${serviceCatalog.code})`, sql`lower(${documentChecklistItems.serviceCode})`),
      ))
      .where(eq(documentChecklistItems.tenantId, tenantId))
      .orderBy(asc(documentChecklistItems.category), asc(documentChecklistItems.name)),
    database.select({ code: serviceCatalog.code, name: serviceCatalog.name }).from(serviceCatalog)
      .where(and(eq(serviceCatalog.tenantId, tenantId), eq(serviceCatalog.status, "active")))
      .orderBy(asc(serviceCatalog.code)),
  ]);
  return {
    checklist: rows,
    services,
    categories: [...new Set(rows.map((row) => row.category))].sort((left, right) => left.localeCompare(right)),
    metrics: {
      active: rows.filter((row) => row.status === "active").length,
      archived: rows.filter((row) => row.status === "archived").length,
      mandatory: rows.filter((row) => row.status === "active" && row.mandatory).length,
      linkedToServices: rows.filter((row) => row.status === "active" && row.serviceCode !== "").length,
    },
  };
}

/** Active checklist entries offered when raising a document request. */
export async function listActiveChecklistOptions(database: DashboardDatabase, tenantId: string) {
  requireTenant(tenantId);
  return database.select({
    id: documentChecklistItems.id,
    code: documentChecklistItems.code,
    name: documentChecklistItems.name,
    category: documentChecklistItems.category,
    instructions: documentChecklistItems.instructions,
    serviceCode: documentChecklistItems.serviceCode,
    defaultLeadDays: documentChecklistItems.defaultLeadDays,
    mandatory: documentChecklistItems.mandatory,
  }).from(documentChecklistItems).where(and(
    eq(documentChecklistItems.tenantId, tenantId),
    eq(documentChecklistItems.status, "active"),
  )).orderBy(asc(documentChecklistItems.category), asc(documentChecklistItems.name));
}

export async function getChecklistItem(database: DashboardDatabase, tenantId: string, itemId: string) {
  requireTenant(tenantId);
  const [row] = await database.select().from(documentChecklistItems).where(and(
    eq(documentChecklistItems.tenantId, tenantId), eq(documentChecklistItems.id, itemId),
  )).limit(1);
  return row ?? null;
}

export async function createChecklistItem(database: DashboardDatabase, tenantId: string, actorUserId: string, input: DocumentChecklistInput) {
  requireTenant(tenantId);
  const id = randomUUID();
  const inserted = await database.insert(documentChecklistItems).values({ id, tenantId, ...input, createdByUserId: actorUserId })
    .onConflictDoNothing().returning({ id: documentChecklistItems.id });
  if (inserted.length === 0) throw new MasterDataError("duplicate_code");
  await database.insert(auditEvents).values({
    tenantId, actorUserId, resourceType: "document_checklist_item", resourceId: id,
    action: "document_checklist.created", reason: `${input.code} · ${input.name}`,
  });
  return id;
}

export async function updateChecklistItem(database: DashboardDatabase, tenantId: string, actorUserId: string, itemId: string, input: DocumentChecklistInput) {
  requireTenant(tenantId);
  const [updated] = await database.update(documentChecklistItems).set({ ...input, updatedAt: new Date() }).where(and(
    eq(documentChecklistItems.tenantId, tenantId), eq(documentChecklistItems.id, itemId),
  )).returning({ id: documentChecklistItems.id });
  if (!updated) throw new MasterDataError("not_found");
  await database.insert(auditEvents).values({
    tenantId, actorUserId, resourceType: "document_checklist_item", resourceId: itemId,
    action: "document_checklist.updated", reason: `${input.code} · ${input.name}`,
  });
}
