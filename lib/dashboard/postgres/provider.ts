import { mapDashboardRecords } from "../mapper";
import type { DashboardData, DashboardRecords } from "../types";
import { getDatabase } from "./pool";
import {
  findTenantIdBySlug,
  loadDashboardRecords,
  type DashboardDatabase,
} from "./repository";

type ProviderDependencies = {
  getDatabase: () => DashboardDatabase;
  findTenantIdBySlug: (database: DashboardDatabase, tenantSlug: string) => Promise<string | null>;
  loadDashboardRecords: (database: DashboardDatabase, tenantId: string) => Promise<DashboardRecords>;
};

const defaultDependencies: ProviderDependencies = {
  getDatabase,
  findTenantIdBySlug,
  loadDashboardRecords,
};

export async function getPostgresDashboardData(
  tenantSlug: string,
  now?: Date,
  dependencies: ProviderDependencies = defaultDependencies,
): Promise<DashboardData> {
  if (!tenantSlug.trim()) throw new Error("tenantSlug is required.");
  const database = dependencies.getDatabase();
  const tenantId = await dependencies.findTenantIdBySlug(database, tenantSlug);
  if (!tenantId) throw new Error(`Seeded tenant ${tenantSlug} was not found.`);
  const records = await dependencies.loadDashboardRecords(database, tenantId);
  return mapDashboardRecords(records, now, "postgres");
}

export async function getPostgresDashboardDataForTenant(
  tenantId: string,
  now?: Date,
  dependencies: Pick<ProviderDependencies, "getDatabase" | "loadDashboardRecords"> = defaultDependencies,
): Promise<DashboardData> {
  if (!tenantId.trim()) throw new Error("tenantId is required.");
  const records = await dependencies.loadDashboardRecords(dependencies.getDatabase(), tenantId);
  return mapDashboardRecords(records, now, "postgres");
}
