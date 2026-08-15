import { readPostgresConfig, resolveDataSource } from "./config";
import { demoDashboardRecords, SEEDED_TENANT_SLUG } from "./fixtures";
import { mapDashboardRecords } from "./mapper";
import type { DashboardData } from "./types";

type Environment = Record<string, string | undefined>;

type ProviderDependencies = {
  now?: Date;
  getPostgresDashboardData?: (tenantSlug: string, now?: Date) => Promise<DashboardData>;
};

export async function getDashboardDataForConfiguredSource(
  env: Environment,
  dependencies: ProviderDependencies = {},
) {
  const source = resolveDataSource(env);
  if (source === "demo") {
    return mapDashboardRecords(demoDashboardRecords, dependencies.now, "demo");
  }

  readPostgresConfig(env);
  const getPostgresDashboardData = dependencies.getPostgresDashboardData
    ?? (await import("./postgres/provider")).getPostgresDashboardData;
  return getPostgresDashboardData(SEEDED_TENANT_SLUG, dependencies.now);
}
