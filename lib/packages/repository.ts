import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gte, inArray, isNull, lte, ne, or, sql } from "drizzle-orm";

import {
  auditEvents,
  clientPackageAssignments,
  clientPackageAssignmentServices,
  clientServices,
  legalEntities,
  serviceCatalog,
  servicePackageItems,
  servicePackages,
} from "../../db/schema";
import type { DashboardDatabase } from "../dashboard/postgres/repository";
import type { ClientPackageAssignmentInput, PackageBillingCycle, PackageInput, ServiceInput } from "./validation";

type TransactionDatabase = Parameters<Parameters<DashboardDatabase["transaction"]>[0]>[0];
type PackageAssignmentStatus = "scheduled" | "active" | "ended" | "cancelled";

export class PackageRepositoryError extends Error {
  constructor(public readonly code: "not_found" | "invalid_service" | "invalid_package" | "overlap" | "replace_required" | "invalid_state") {
    super({
      not_found: "The requested package record is unavailable.",
      invalid_service: "Select active services from this firm's catalogue.",
      invalid_package: "Select an active package from this firm's catalogue.",
      overlap: "This client already has a package during the selected dates.",
      replace_required: "Confirm replacement of the client's current package.",
      invalid_state: "This package action is no longer available.",
    }[code]);
    this.name = "PackageRepositoryError";
  }
}

export type ServiceCatalogueView = ServiceInput & { id: string; packageCount: number };
export type ServiceOption = { category: string; code: string; id: string; name: string };
export type ServiceManagementWorkspaceData = {
  metrics: { activeServices: number; archivedServices: number; categories: number; packageLinks: number };
  services: ServiceCatalogueView[];
};
export type ServicePackageView = PackageInput & {
  id: string;
  services: Array<{ category: string; code: string; id: string; name: string }>;
};
export type PackageSetupWorkspaceData = {
  metrics: { activePackages: number; activeServices: number; archivedPackages: number; averageFeePaise: number };
  packages: ServicePackageView[];
  services: ServiceCatalogueView[];
};
export type ClientPackageServiceSnapshot = {
  category: string;
  code: string;
  id: string;
  name: string;
  serviceId: string;
  source: "package" | "addon";
};
export type ClientPackageAssignmentView = {
  agreedFeePaise: number;
  billingCycle: PackageBillingCycle;
  cancelledAt: string | null;
  cancellationReason: string;
  clientName: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  id: string;
  legalEntityId: string;
  packageCode: string;
  packageId: string;
  packageName: string;
  services: ClientPackageServiceSnapshot[];
  standardFeePaise: number;
  status: PackageAssignmentStatus;
};
export type ClientPackageWorkspaceData = {
  assignments: ClientPackageAssignmentView[];
  clients: Array<{ currentAssignmentId: string | null; id: string; name: string }>;
  metrics: { activeAssignments: number; monthlyRecurringPaise: number; renewalsDue: number; unassignedClients: number };
  packages: ServicePackageView[];
  services: ServiceCatalogueView[];
  todayKey: string;
};

export async function listActiveServiceOptions(database: DashboardDatabase, tenantId: string): Promise<ServiceOption[]> {
  requireTenant(tenantId);
  return database.select({
    category: serviceCatalog.category,
    code: serviceCatalog.code,
    id: serviceCatalog.id,
    name: serviceCatalog.name,
  }).from(serviceCatalog).where(and(
    eq(serviceCatalog.tenantId, tenantId),
    eq(serviceCatalog.status, "active"),
  )).orderBy(asc(serviceCatalog.category), asc(serviceCatalog.name));
}

function requireTenant(tenantId: string) {
  if (!tenantId.trim()) throw new Error("Tenant is required.");
}

function requireActor(tenantId: string, actorUserId: string) {
  requireTenant(tenantId);
  if (!actorUserId.trim()) throw new Error("Actor is required.");
}

function indiaDateKey(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function addDays(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function previousDay(dateKey: string) {
  return addDays(dateKey, -1);
}

function effectiveStatus(row: { cancelledAt?: Date | null; effectiveFrom: string; effectiveTo: string | null; status: string }, todayKey: string): PackageAssignmentStatus {
  if (row.status === "cancelled" || row.cancelledAt) return "cancelled";
  if (row.effectiveFrom > todayKey) return "scheduled";
  if (row.effectiveTo && row.effectiveTo < todayKey) return "ended";
  return "active";
}

function intervalsOverlap(leftFrom: string, leftTo: string | null, rightFrom: string, rightTo: string | null) {
  return (!leftTo || leftTo >= rightFrom) && (!rightTo || rightTo >= leftFrom);
}

function normalizedMonthlyValue(feePaise: number, cycle: PackageBillingCycle) {
  if (cycle === "monthly") return feePaise;
  if (cycle === "quarterly") return Math.round(feePaise / 3);
  if (cycle === "annual") return Math.round(feePaise / 12);
  return 0;
}

async function insertAudit(database: TransactionDatabase, tenantId: string, actorUserId: string, resourceType: string, resourceId: string, action: string, reason = "") {
  await database.insert(auditEvents).values({ tenantId, actorUserId, resourceType, resourceId, action, reason: reason || null });
}

async function loadPackageServices(database: Pick<DashboardDatabase, "select">, tenantId: string, packageId: string, activeOnly: boolean) {
  return database.select({
    category: serviceCatalog.category,
    code: serviceCatalog.code,
    id: serviceCatalog.id,
    name: serviceCatalog.name,
    status: serviceCatalog.status,
  }).from(servicePackageItems)
    .innerJoin(serviceCatalog, and(eq(serviceCatalog.tenantId, tenantId), eq(serviceCatalog.id, servicePackageItems.serviceId)))
    .where(and(
      eq(servicePackageItems.tenantId, tenantId),
      eq(servicePackageItems.packageId, packageId),
      activeOnly ? eq(serviceCatalog.status, "active") : undefined,
    )).orderBy(asc(serviceCatalog.name));
}

export async function listPackageSetupWorkspace(database: DashboardDatabase, tenantId: string): Promise<PackageSetupWorkspaceData> {
  requireTenant(tenantId);
  const [serviceRows, packageRows, itemRows] = await Promise.all([
    database.select().from(serviceCatalog).where(eq(serviceCatalog.tenantId, tenantId)).orderBy(asc(serviceCatalog.name)),
    database.select().from(servicePackages).where(eq(servicePackages.tenantId, tenantId)).orderBy(asc(servicePackages.name)),
    database.select({ packageId: servicePackageItems.packageId, serviceId: serviceCatalog.id, code: serviceCatalog.code, name: serviceCatalog.name, category: serviceCatalog.category })
      .from(servicePackageItems)
      .innerJoin(serviceCatalog, and(eq(serviceCatalog.tenantId, tenantId), eq(serviceCatalog.id, servicePackageItems.serviceId)))
      .where(eq(servicePackageItems.tenantId, tenantId)).orderBy(asc(serviceCatalog.name)),
  ]);
  const packageItems = new Map<string, ServicePackageView["services"]>();
  const usage = new Map<string, number>();
  for (const item of itemRows) {
    const current = packageItems.get(item.packageId) ?? [];
    current.push({ category: item.category, code: item.code, id: item.serviceId, name: item.name });
    packageItems.set(item.packageId, current);
    usage.set(item.serviceId, (usage.get(item.serviceId) ?? 0) + 1);
  }
  const services: ServiceCatalogueView[] = serviceRows.map((service) => ({
    id: service.id,
    code: service.code,
    name: service.name,
    category: service.category,
    description: service.description,
    standardMinutes: service.standardMinutes,
    status: service.status as ServiceInput["status"],
    packageCount: usage.get(service.id) ?? 0,
  }));
  const packages: ServicePackageView[] = packageRows.map((item) => ({
    id: item.id,
    code: item.code,
    name: item.name,
    description: item.description,
    billingCycle: item.billingCycle as PackageBillingCycle,
    standardFeePaise: item.standardFeePaise,
    status: item.status as PackageInput["status"],
    serviceIds: (packageItems.get(item.id) ?? []).map((service) => service.id),
    services: packageItems.get(item.id) ?? [],
  }));
  const activePackages = packages.filter((item) => item.status === "active");
  return {
    services,
    packages,
    metrics: {
      activePackages: activePackages.length,
      activeServices: services.filter((item) => item.status === "active").length,
      archivedPackages: packages.filter((item) => item.status === "archived").length,
      averageFeePaise: activePackages.length ? Math.round(activePackages.reduce((total, item) => total + item.standardFeePaise, 0) / activePackages.length) : 0,
    },
  };
}

export async function listServiceManagementWorkspace(database: DashboardDatabase, tenantId: string): Promise<ServiceManagementWorkspaceData> {
  requireTenant(tenantId);
  const [serviceRows, usageRows] = await Promise.all([
    database.select().from(serviceCatalog).where(eq(serviceCatalog.tenantId, tenantId)).orderBy(asc(serviceCatalog.name)),
    database.select({ serviceId: servicePackageItems.serviceId }).from(servicePackageItems).where(eq(servicePackageItems.tenantId, tenantId)),
  ]);
  const usage = new Map<string, number>();
  for (const item of usageRows) usage.set(item.serviceId, (usage.get(item.serviceId) ?? 0) + 1);
  const services: ServiceCatalogueView[] = serviceRows.map((service) => ({
    id: service.id,
    code: service.code,
    name: service.name,
    category: service.category,
    description: service.description,
    standardMinutes: service.standardMinutes,
    status: service.status as ServiceInput["status"],
    packageCount: usage.get(service.id) ?? 0,
  }));
  return {
    services,
    metrics: {
      activeServices: services.filter((service) => service.status === "active").length,
      archivedServices: services.filter((service) => service.status === "archived").length,
      categories: new Set(services.map((service) => service.category.toLowerCase())).size,
      packageLinks: usageRows.length,
    },
  };
}

export async function getServiceForEdit(database: DashboardDatabase, tenantId: string, serviceId: string) {
  requireTenant(tenantId);
  const [service] = await database.select().from(serviceCatalog).where(and(eq(serviceCatalog.tenantId, tenantId), eq(serviceCatalog.id, serviceId))).limit(1);
  return service ? { ...service, status: service.status as ServiceInput["status"] } : null;
}

export async function getPackageForEdit(database: DashboardDatabase, tenantId: string, packageId: string): Promise<ServicePackageView | null> {
  requireTenant(tenantId);
  const [item] = await database.select().from(servicePackages).where(and(eq(servicePackages.tenantId, tenantId), eq(servicePackages.id, packageId))).limit(1);
  if (!item) return null;
  const services = await loadPackageServices(database, tenantId, packageId, false);
  return {
    id: item.id,
    code: item.code,
    name: item.name,
    description: item.description,
    billingCycle: item.billingCycle as PackageBillingCycle,
    standardFeePaise: item.standardFeePaise,
    status: item.status as PackageInput["status"],
    serviceIds: services.map((service) => service.id),
    services: services.map(({ category, code, id, name }) => ({ category, code, id, name })),
  };
}

export async function createService(database: DashboardDatabase, tenantId: string, actorUserId: string, input: ServiceInput) {
  requireActor(tenantId, actorUserId);
  const id = randomUUID();
  await database.transaction(async (transaction) => {
    await transaction.insert(serviceCatalog).values({ id, tenantId, ...input });
    await insertAudit(transaction, tenantId, actorUserId, "service_catalog", id, "service.created", input.name);
  });
  return id;
}

export async function updateService(database: DashboardDatabase, tenantId: string, actorUserId: string, serviceId: string, input: ServiceInput) {
  requireActor(tenantId, actorUserId);
  await database.transaction(async (transaction) => {
    const [updated] = await transaction.update(serviceCatalog).set({ ...input, updatedAt: new Date() }).where(and(
      eq(serviceCatalog.tenantId, tenantId), eq(serviceCatalog.id, serviceId),
    )).returning({ id: serviceCatalog.id });
    if (!updated) throw new PackageRepositoryError("not_found");
    await insertAudit(transaction, tenantId, actorUserId, "service_catalog", serviceId, "service.updated", input.name);
  });
}

async function assertActiveServices(database: Pick<DashboardDatabase, "select">, tenantId: string, serviceIds: string[]) {
  if (!serviceIds.length) throw new PackageRepositoryError("invalid_service");
  const rows = await database.select({ id: serviceCatalog.id }).from(serviceCatalog).where(and(
    eq(serviceCatalog.tenantId, tenantId), eq(serviceCatalog.status, "active"), inArray(serviceCatalog.id, serviceIds),
  ));
  if (rows.length !== serviceIds.length) throw new PackageRepositoryError("invalid_service");
}

export async function createPackage(database: DashboardDatabase, tenantId: string, actorUserId: string, input: PackageInput) {
  requireActor(tenantId, actorUserId);
  const packageId = randomUUID();
  await database.transaction(async (transaction) => {
    await assertActiveServices(transaction, tenantId, input.serviceIds);
    await transaction.insert(servicePackages).values({
      id: packageId, tenantId, code: input.code, name: input.name, description: input.description,
      billingCycle: input.billingCycle, standardFeePaise: input.standardFeePaise, status: input.status,
    });
    await transaction.insert(servicePackageItems).values(input.serviceIds.map((serviceId) => ({ tenantId, packageId, serviceId })));
    await insertAudit(transaction, tenantId, actorUserId, "service_package", packageId, "package.created", input.name);
  });
  return packageId;
}

export async function updatePackage(database: DashboardDatabase, tenantId: string, actorUserId: string, packageId: string, input: PackageInput) {
  requireActor(tenantId, actorUserId);
  await database.transaction(async (transaction) => {
    await assertActiveServices(transaction, tenantId, input.serviceIds);
    const [updated] = await transaction.update(servicePackages).set({
      code: input.code, name: input.name, description: input.description, billingCycle: input.billingCycle,
      standardFeePaise: input.standardFeePaise, status: input.status, updatedAt: new Date(),
    }).where(and(eq(servicePackages.tenantId, tenantId), eq(servicePackages.id, packageId))).returning({ id: servicePackages.id });
    if (!updated) throw new PackageRepositoryError("not_found");
    await transaction.delete(servicePackageItems).where(and(eq(servicePackageItems.tenantId, tenantId), eq(servicePackageItems.packageId, packageId)));
    await transaction.insert(servicePackageItems).values(input.serviceIds.map((serviceId) => ({ tenantId, packageId, serviceId })));
    await insertAudit(transaction, tenantId, actorUserId, "service_package", packageId, "package.updated", input.name);
  });
}

export async function listClientPackageWorkspace(database: DashboardDatabase, tenantId: string, todayKey = indiaDateKey()): Promise<ClientPackageWorkspaceData> {
  requireTenant(tenantId);
  const setup = await listPackageSetupWorkspace(database, tenantId);
  const [clientRows, assignmentRows, snapshotRows] = await Promise.all([
    database.select({ id: legalEntities.id, name: legalEntities.displayName }).from(legalEntities)
      .where(and(eq(legalEntities.tenantId, tenantId), eq(legalEntities.status, "active"))).orderBy(asc(legalEntities.displayName)),
    database.select({
      agreedFeePaise: clientPackageAssignments.agreedFeePaiseSnapshot,
      billingCycle: clientPackageAssignments.billingCycleSnapshot,
      cancelledAt: clientPackageAssignments.cancelledAt,
      cancellationReason: clientPackageAssignments.cancellationReason,
      clientName: legalEntities.displayName,
      effectiveFrom: clientPackageAssignments.effectiveFrom,
      effectiveTo: clientPackageAssignments.effectiveTo,
      id: clientPackageAssignments.id,
      legalEntityId: clientPackageAssignments.legalEntityId,
      packageCode: clientPackageAssignments.packageCodeSnapshot,
      packageId: clientPackageAssignments.packageId,
      packageName: clientPackageAssignments.packageNameSnapshot,
      standardFeePaise: clientPackageAssignments.standardFeePaiseSnapshot,
      storedStatus: clientPackageAssignments.status,
    }).from(clientPackageAssignments)
      .innerJoin(legalEntities, and(eq(legalEntities.tenantId, tenantId), eq(legalEntities.id, clientPackageAssignments.legalEntityId)))
      .where(eq(clientPackageAssignments.tenantId, tenantId)).orderBy(desc(clientPackageAssignments.effectiveFrom), desc(clientPackageAssignments.createdAt)),
    database.select({
      assignmentId: clientPackageAssignmentServices.assignmentId,
      category: clientPackageAssignmentServices.serviceCategorySnapshot,
      code: clientPackageAssignmentServices.serviceCodeSnapshot,
      id: clientPackageAssignmentServices.id,
      name: clientPackageAssignmentServices.serviceNameSnapshot,
      serviceId: clientPackageAssignmentServices.serviceId,
      source: clientPackageAssignmentServices.source,
    }).from(clientPackageAssignmentServices).where(eq(clientPackageAssignmentServices.tenantId, tenantId)).orderBy(asc(clientPackageAssignmentServices.serviceNameSnapshot)),
  ]);
  const servicesByAssignment = new Map<string, ClientPackageServiceSnapshot[]>();
  for (const service of snapshotRows) {
    const current = servicesByAssignment.get(service.assignmentId) ?? [];
    current.push({ ...service, source: service.source as "package" | "addon" });
    servicesByAssignment.set(service.assignmentId, current);
  }
  const assignments: ClientPackageAssignmentView[] = assignmentRows.map((row) => ({
    ...row,
    billingCycle: row.billingCycle as PackageBillingCycle,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    services: servicesByAssignment.get(row.id) ?? [],
    status: effectiveStatus({ cancelledAt: row.cancelledAt, effectiveFrom: row.effectiveFrom, effectiveTo: row.effectiveTo, status: row.storedStatus }, todayKey),
  }));
  const active = assignments.filter((assignment) => assignment.status === "active");
  const currentByClient = new Map(active.map((assignment) => [assignment.legalEntityId, assignment.id]));
  const renewalLimit = addDays(todayKey, 30);
  return {
    assignments,
    clients: clientRows.map((client) => ({ ...client, currentAssignmentId: currentByClient.get(client.id) ?? null })),
    packages: setup.packages,
    services: setup.services,
    todayKey,
    metrics: {
      activeAssignments: active.length,
      monthlyRecurringPaise: active.reduce((total, assignment) => total + normalizedMonthlyValue(assignment.agreedFeePaise, assignment.billingCycle), 0),
      renewalsDue: active.filter((assignment) => assignment.effectiveTo && assignment.effectiveTo >= todayKey && assignment.effectiveTo <= renewalLimit).length,
      unassignedClients: clientRows.filter((client) => !currentByClient.has(client.id)).length,
    },
  };
}

export async function getAssignmentDetail(database: DashboardDatabase, tenantId: string, assignmentId: string) {
  requireTenant(tenantId);
  const workspace = await listClientPackageWorkspace(database, tenantId);
  return workspace.assignments.find((assignment) => assignment.id === assignmentId) ?? null;
}

async function synchronizeEntitlements(database: TransactionDatabase, tenantId: string, legalEntityId: string, serviceCodes: string[]) {
  await database.delete(clientServices).where(and(eq(clientServices.tenantId, tenantId), eq(clientServices.legalEntityId, legalEntityId)));
  if (serviceCodes.length) await database.insert(clientServices).values(serviceCodes.map((serviceKey) => ({ tenantId, legalEntityId, serviceKey, status: "active" })));
}

export async function assignClientPackage(
  database: DashboardDatabase,
  tenantId: string,
  actorUserId: string,
  input: ClientPackageAssignmentInput,
  todayKey = indiaDateKey(),
) {
  requireActor(tenantId, actorUserId);
  return database.transaction(async (transaction) => {
    const [client] = await transaction.select({ id: legalEntities.id }).from(legalEntities).where(and(
      eq(legalEntities.tenantId, tenantId), eq(legalEntities.id, input.legalEntityId), eq(legalEntities.status, "active"),
    )).limit(1).for("update");
    if (!client) throw new PackageRepositoryError("not_found");

    const [selectedPackage] = await transaction.select().from(servicePackages).where(and(
      eq(servicePackages.tenantId, tenantId), eq(servicePackages.id, input.packageId), eq(servicePackages.status, "active"),
    )).limit(1).for("update");
    if (!selectedPackage) throw new PackageRepositoryError("invalid_package");

    const packageServiceRows = await loadPackageServices(transaction, tenantId, input.packageId, true);
    if (!packageServiceRows.length) throw new PackageRepositoryError("invalid_package");
    const packageServiceIds = new Set(packageServiceRows.map((service) => service.id));
    if (input.addonServiceIds.some((serviceId) => packageServiceIds.has(serviceId))) throw new PackageRepositoryError("invalid_service");
    const addonRows = input.addonServiceIds.length ? await transaction.select({
      category: serviceCatalog.category, code: serviceCatalog.code, id: serviceCatalog.id, name: serviceCatalog.name,
    }).from(serviceCatalog).where(and(
      eq(serviceCatalog.tenantId, tenantId), eq(serviceCatalog.status, "active"), inArray(serviceCatalog.id, input.addonServiceIds),
    )) : [];
    if (addonRows.length !== input.addonServiceIds.length) throw new PackageRepositoryError("invalid_service");

    const existing = await transaction.select().from(clientPackageAssignments).where(and(
      eq(clientPackageAssignments.tenantId, tenantId), eq(clientPackageAssignments.legalEntityId, input.legalEntityId), ne(clientPackageAssignments.status, "cancelled"),
    )).orderBy(desc(clientPackageAssignments.effectiveFrom)).for("update");
    const overlapping = existing.filter((assignment) => intervalsOverlap(assignment.effectiveFrom, assignment.effectiveTo, input.effectiveFrom, input.effectiveTo));
    if (overlapping.length && !input.replaceExisting) throw new PackageRepositoryError("replace_required");
    if (overlapping.length > 1) throw new PackageRepositoryError("overlap");
    const replaced = overlapping[0];
    if (replaced) {
      if (input.effectiveFrom <= replaced.effectiveFrom) throw new PackageRepositoryError("overlap");
      await transaction.update(clientPackageAssignments).set({
        effectiveTo: previousDay(input.effectiveFrom), status: "ended", updatedAt: new Date(),
      }).where(and(eq(clientPackageAssignments.tenantId, tenantId), eq(clientPackageAssignments.id, replaced.id)));
    }

    const assignmentId = randomUUID();
    const status = effectiveStatus({ effectiveFrom: input.effectiveFrom, effectiveTo: input.effectiveTo, status: "active" }, todayKey);
    await transaction.insert(clientPackageAssignments).values({
      id: assignmentId,
      tenantId,
      legalEntityId: input.legalEntityId,
      packageId: selectedPackage.id,
      effectiveFrom: input.effectiveFrom,
      effectiveTo: input.effectiveTo,
      status,
      packageCodeSnapshot: selectedPackage.code,
      packageNameSnapshot: selectedPackage.name,
      billingCycleSnapshot: selectedPackage.billingCycle,
      standardFeePaiseSnapshot: selectedPackage.standardFeePaise,
      agreedFeePaiseSnapshot: input.agreedFeePaise,
      createdByUserId: actorUserId,
    });
    const snapshots = [
      ...packageServiceRows.map((service) => ({ ...service, source: "package" as const })),
      ...addonRows.map((service) => ({ ...service, status: "active", source: "addon" as const })),
    ];
    await transaction.insert(clientPackageAssignmentServices).values(snapshots.map((service) => ({
      tenantId,
      assignmentId,
      serviceId: service.id,
      serviceCodeSnapshot: service.code,
      serviceNameSnapshot: service.name,
      serviceCategorySnapshot: service.category,
      source: service.source,
    })));
    if (status === "active") await synchronizeEntitlements(transaction, tenantId, input.legalEntityId, snapshots.map((service) => service.code));
    await insertAudit(transaction, tenantId, actorUserId, "client_package", assignmentId, "client_package.assigned", selectedPackage.name);
    return assignmentId;
  });
}

export async function cancelClientPackage(database: DashboardDatabase, tenantId: string, actorUserId: string, assignmentId: string, reason: string, todayKey = indiaDateKey()) {
  requireActor(tenantId, actorUserId);
  const normalizedReason = reason.trim();
  if (normalizedReason.length < 3 || normalizedReason.length > 300) throw new PackageRepositoryError("invalid_state");
  await database.transaction(async (transaction) => {
    const [assignment] = await transaction.select().from(clientPackageAssignments).where(and(
      eq(clientPackageAssignments.tenantId, tenantId), eq(clientPackageAssignments.id, assignmentId),
    )).limit(1).for("update");
    if (!assignment) throw new PackageRepositoryError("not_found");
    const currentStatus = effectiveStatus(assignment, todayKey);
    if (currentStatus === "cancelled" || currentStatus === "ended") throw new PackageRepositoryError("invalid_state");
    await transaction.update(clientPackageAssignments).set({
      status: "cancelled", cancelledAt: new Date(), cancellationReason: normalizedReason, updatedAt: new Date(),
    }).where(and(eq(clientPackageAssignments.tenantId, tenantId), eq(clientPackageAssignments.id, assignmentId)));
    if (currentStatus === "active") await synchronizeEntitlements(transaction, tenantId, assignment.legalEntityId, []);
    await insertAudit(transaction, tenantId, actorUserId, "client_package", assignmentId, "client_package.cancelled", normalizedReason);
  });
}

export async function listEntitledServices(database: Pick<DashboardDatabase, "select">, tenantId: string, legalEntityId: string, todayKey = indiaDateKey()) {
  requireTenant(tenantId);
  const [assignment] = await database.select({ id: clientPackageAssignments.id }).from(clientPackageAssignments).where(and(
    eq(clientPackageAssignments.tenantId, tenantId),
    eq(clientPackageAssignments.legalEntityId, legalEntityId),
    ne(clientPackageAssignments.status, "cancelled"),
    lte(clientPackageAssignments.effectiveFrom, todayKey),
    or(isNull(clientPackageAssignments.effectiveTo), gte(clientPackageAssignments.effectiveTo, todayKey)),
  )).orderBy(desc(clientPackageAssignments.effectiveFrom)).limit(1);
  if (assignment) return database.select({ code: clientPackageAssignmentServices.serviceCodeSnapshot, name: clientPackageAssignmentServices.serviceNameSnapshot })
    .from(clientPackageAssignmentServices)
    .innerJoin(serviceCatalog, and(
      eq(serviceCatalog.tenantId, tenantId),
      eq(serviceCatalog.id, clientPackageAssignmentServices.serviceId),
      eq(serviceCatalog.status, "active"),
    ))
    .where(and(eq(clientPackageAssignmentServices.tenantId, tenantId), eq(clientPackageAssignmentServices.assignmentId, assignment.id)))
    .orderBy(asc(clientPackageAssignmentServices.serviceNameSnapshot));
  const [history] = await database.select({ id: clientPackageAssignments.id }).from(clientPackageAssignments).where(and(
    eq(clientPackageAssignments.tenantId, tenantId), eq(clientPackageAssignments.legalEntityId, legalEntityId),
  )).limit(1);
  if (history) return [];
  const legacyServices = await database.select({ code: serviceCatalog.code, name: serviceCatalog.name }).from(clientServices)
    .innerJoin(serviceCatalog, and(
      eq(serviceCatalog.tenantId, tenantId),
      eq(serviceCatalog.status, "active"),
      sql`lower(${serviceCatalog.code}) = lower(${clientServices.serviceKey})`,
    ))
    .where(and(eq(clientServices.tenantId, tenantId), eq(clientServices.legalEntityId, legalEntityId), eq(clientServices.status, "active")))
    .orderBy(asc(clientServices.serviceKey));
  return legacyServices;
}

export async function isServiceEntitled(database: Pick<DashboardDatabase, "select">, tenantId: string, legalEntityId: string, serviceCode: string, todayKey = indiaDateKey()) {
  const services = await listEntitledServices(database, tenantId, legalEntityId, todayKey);
  return services.some((service) => service.code.toUpperCase() === serviceCode.toUpperCase());
}
