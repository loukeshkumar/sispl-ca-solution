import { mapDashboardRecords } from "../mapper";
import type { DashboardData, DashboardRecords } from "../types";
import { FIRM_SCOPE, type DashboardScope } from "../scope";
import { getDatabase } from "./pool";
import {
  findTenantIdBySlug,
  loadDashboardRecords,
  type DashboardDatabase,
} from "./repository";

type ProviderDependencies = {
  getDatabase: () => DashboardDatabase;
  findTenantIdBySlug: (database: DashboardDatabase, tenantSlug: string) => Promise<string | null>;
  loadDashboardRecords: (database: DashboardDatabase, tenantId: string, scope: DashboardScope) => Promise<DashboardRecords>;
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
  const records = await dependencies.loadDashboardRecords(database, tenantId, FIRM_SCOPE);
  return mapDashboardRecords(records, now, "postgres");
}

/**
 * Scope is required rather than defaulted, so a new caller cannot obtain
 * firm-wide data by forgetting to ask for less.
 */
export async function getPostgresDashboardDataForTenant(
  tenantId: string,
  scope: DashboardScope,
  now?: Date,
  dependencies: Pick<ProviderDependencies, "getDatabase" | "loadDashboardRecords"> = defaultDependencies,
): Promise<DashboardData> {
  if (!tenantId.trim()) throw new Error("tenantId is required.");
  const records = await dependencies.loadDashboardRecords(dependencies.getDatabase(), tenantId, scope);
  return {
    ...mapDashboardRecords(records, now, "postgres"),
    scope: { kind: scope.kind, hasReports: scope.kind !== "team" || scope.userIds.length > 1 },
  };
}
