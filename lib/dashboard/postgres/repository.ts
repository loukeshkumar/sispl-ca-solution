import { and, asc, eq, inArray, or, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import {
  clientGroups,
  clientServices,
  legalEntities,
  registrations,
  serviceCatalog,
  tenantMemberships,
  tenants,
  users,
  workItems,
} from "../../../db/schema";
import * as schema from "../../../db/schema";
import { scopedUserIds, type DashboardScope } from "../scope";
import type { DashboardRecords } from "../types";

export type DashboardDatabase = NodePgDatabase<typeof schema>;

export async function findTenantIdBySlug(database: DashboardDatabase, tenantSlug: string) {
  if (!tenantSlug.trim()) throw new Error("tenantSlug is required.");
  const [tenant] = await database
    .select({ id: tenants.id })
    .from(tenants)
    .where(and(eq(tenants.slug, tenantSlug), eq(tenants.status, "active")))
    .limit(1);
  return tenant?.id ?? null;
}

/**
 * The work a scope selects: items the scoped users are assigned or reviewing.
 * Reviewing an item is holding it, so both columns count. `undefined` means no
 * predicate, which `and()` drops.
 */
function scopedWorkFilter(scope: DashboardScope) {
  const userIds = scopedUserIds(scope);
  if (!userIds) return undefined;
  // An empty scope must select nothing rather than everything.
  if (userIds.length === 0) return sql`false`;
  return or(inArray(workItems.assigneeId, userIds), inArray(workItems.reviewerId, userIds));
}

export async function loadDashboardRecords(
  database: DashboardDatabase,
  tenantId: string,
  scope: DashboardScope,
): Promise<DashboardRecords> {
  if (!tenantId.trim()) throw new Error("tenantId is required.");

  const workFilter = scopedWorkFilter(scope);
  /*
   * Clients follow the work rather than being scoped separately, so the client
   * list can never name an entity whose work the viewer cannot see. A subquery
   * rather than a second round trip, so both queries still run in parallel.
   */
  const entityFilter = workFilter
    ? inArray(
        legalEntities.id,
        database.select({ id: workItems.legalEntityId }).from(workItems)
          .where(and(eq(workItems.tenantId, tenantId), workFilter)),
      )
    : undefined;

  const [tenantRows, memberRows, clientRows, serviceRows, registrationRows, workRows] = await Promise.all([
    database.select({
      id: tenants.id,
      slug: tenants.slug,
      displayName: tenants.displayName,
      legalName: tenants.legalName,
    }).from(tenants).where(eq(tenants.id, tenantId)).limit(1),
    database.select({
      id: users.id,
      fullName: users.fullName,
      roleKey: tenantMemberships.roleKey,
      status: tenantMemberships.status,
    }).from(tenantMemberships)
      .innerJoin(users, eq(users.id, tenantMemberships.userId))
      .where(and(eq(tenantMemberships.tenantId, tenantId), eq(tenantMemberships.status, "active")))
      .orderBy(asc(users.fullName)),
    database.select({
      id: legalEntities.id,
      clientGroupId: legalEntities.clientGroupId,
      legalName: legalEntities.legalName,
      displayName: legalEntities.displayName,
      entityType: legalEntities.entityType,
      maskedPan: legalEntities.maskedPan,
      city: legalEntities.city,
      relationshipStart: legalEntities.relationshipStart,
      ownerName: users.fullName,
      riskStatus: clientGroups.riskStatus,
      healthScore: clientGroups.healthScore,
    }).from(legalEntities)
      .innerJoin(clientGroups, and(eq(clientGroups.id, legalEntities.clientGroupId), eq(clientGroups.tenantId, tenantId)))
      .leftJoin(users, eq(users.id, clientGroups.relationshipOwnerId))
      .where(and(eq(legalEntities.tenantId, tenantId), eq(legalEntities.status, "active"), entityFilter))
      .orderBy(asc(legalEntities.legalName)),
    database.select({
      legalEntityId: clientServices.legalEntityId,
      serviceKey: clientServices.serviceKey,
    }).from(clientServices)
      .where(and(eq(clientServices.tenantId, tenantId), eq(clientServices.status, "active")))
      .orderBy(asc(clientServices.serviceKey)),
    database.select({
      legalEntityId: registrations.legalEntityId,
      registrationType: registrations.registrationType,
    }).from(registrations)
      .where(and(eq(registrations.tenantId, tenantId), eq(registrations.status, "active"))),
    database.select({
      id: workItems.id,
      legalEntityId: workItems.legalEntityId,
      clientName: legalEntities.displayName,
      serviceKey: workItems.serviceKey,
      serviceName: serviceCatalog.name,
      periodKey: workItems.periodKey,
      ownerName: users.fullName,
      dueDate: workItems.statutoryDueDate,
      status: workItems.status,
      blockerNote: workItems.blockerNote,
      progress: workItems.progress,
      missingItems: workItems.missingItemCount,
    }).from(workItems)
      .innerJoin(legalEntities, and(eq(legalEntities.id, workItems.legalEntityId), eq(legalEntities.tenantId, tenantId)))
      .leftJoin(serviceCatalog, and(eq(serviceCatalog.tenantId, tenantId), sql`lower(${serviceCatalog.code}) = lower(${workItems.serviceKey})`))
      .leftJoin(users, eq(users.id, workItems.assigneeId))
      .where(and(eq(workItems.tenantId, tenantId), eq(legalEntities.status, "active"), workFilter))
      .orderBy(asc(workItems.statutoryDueDate)),
  ]);

  const tenant = tenantRows[0];
  if (!tenant) throw new Error("The requested tenant was not found.");

  const servicesByEntity = new Map<string, string[]>();
  for (const row of serviceRows) {
    const serviceLabels = servicesByEntity.get(row.legalEntityId) ?? [];
    serviceLabels.push(row.serviceKey);
    servicesByEntity.set(row.legalEntityId, serviceLabels);
  }

  const gstByEntity = new Map<string, number>();
  for (const row of registrationRows) {
    if (row.registrationType !== "gst") continue;
    gstByEntity.set(row.legalEntityId, (gstByEntity.get(row.legalEntityId) ?? 0) + 1);
  }

  return {
    tenant,
    members: memberRows,
    clients: clientRows.map((row) => ({
      ...row,
      ownerName: row.ownerName ?? "Unassigned",
      riskStatus: row.riskStatus as DashboardRecords["clients"][number]["riskStatus"],
      services: servicesByEntity.get(row.id) ?? [],
      gstRegistrations: gstByEntity.get(row.id) ?? 0,
    })),
    workItems: workRows.map((row) => ({
      ...row,
      ownerName: row.ownerName ?? "Unassigned",
      status: row.status as DashboardRecords["workItems"][number]["status"],
    })),
  };
}
