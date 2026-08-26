import { and, asc, desc, eq, lte } from "drizzle-orm";

import { statutoryRateParameters, statutoryRateVersions } from "../../db/schema";
import type { DashboardDatabase } from "../dashboard/postgres/repository";
import { computeStatutorySuggestion, type StatutorySuggestion } from "./calculators";
import { toEpfParameters, toEsiParameters, toProfessionalTaxParameters, type ParameterRow, type StatutoryRuleType } from "./parameters";

export const DEFAULT_JURISDICTION = "IN";

export type ResolvedRateVersion = {
  id: string;
  ruleType: StatutoryRuleType;
  jurisdiction: string;
  effectiveFrom: string;
  sourceReference: string;
  parameters: ParameterRow[];
};

export type StatutorySuggestionResult = {
  suggestion: StatutorySuggestion;
  versions: Array<{ ruleType: StatutoryRuleType; effectiveFrom: string; jurisdiction: string; sourceReference: string }>;
  missing: StatutoryRuleType[];
};

function requireTenant(tenantId: string) {
  if (!tenantId.trim()) throw new Error("Tenant is required.");
}

/** Resolves the newest active version effective on or before `asOfDateKey`. */
export async function resolveRateVersion(
  database: DashboardDatabase,
  tenantId: string,
  ruleType: StatutoryRuleType,
  jurisdiction: string,
  asOfDateKey: string,
): Promise<ResolvedRateVersion | null> {
  requireTenant(tenantId);
  const [version] = await database.select({
    id: statutoryRateVersions.id,
    ruleType: statutoryRateVersions.ruleType,
    jurisdiction: statutoryRateVersions.jurisdiction,
    effectiveFrom: statutoryRateVersions.effectiveFrom,
    sourceReference: statutoryRateVersions.sourceReference,
  }).from(statutoryRateVersions).where(and(
    eq(statutoryRateVersions.tenantId, tenantId),
    eq(statutoryRateVersions.ruleType, ruleType),
    eq(statutoryRateVersions.jurisdiction, jurisdiction.toUpperCase()),
    eq(statutoryRateVersions.status, "active"),
    lte(statutoryRateVersions.effectiveFrom, asOfDateKey),
  )).orderBy(desc(statutoryRateVersions.effectiveFrom)).limit(1);
  if (!version) return null;
  const parameters = await database.select({
    parameterKey: statutoryRateParameters.parameterKey,
    numericValue: statutoryRateParameters.numericValue,
    unit: statutoryRateParameters.unit,
  }).from(statutoryRateParameters).where(and(
    eq(statutoryRateParameters.tenantId, tenantId),
    eq(statutoryRateParameters.versionId, version.id),
  )).orderBy(asc(statutoryRateParameters.parameterKey));
  return {
    ...version,
    ruleType: version.ruleType as StatutoryRuleType,
    parameters: parameters.map((row) => ({ ...row, unit: row.unit as ParameterRow["unit"] })),
  };
}

/**
 * Computes what the statutory deductions would be under the rules in force for
 * the period. Rules that are not configured are reported in `missing` rather than
 * silently treated as zero, so a firm never mistakes "not configured" for "nil".
 */
export async function suggestStatutoryDeductions(
  database: DashboardDatabase,
  tenantId: string,
  input: { monthlyWagesPaise: number; asOfDateKey: string; jurisdiction?: string },
): Promise<StatutorySuggestionResult> {
  requireTenant(tenantId);
  const stateJurisdiction = (input.jurisdiction ?? DEFAULT_JURISDICTION).toUpperCase();
  const [epfVersion, esiVersion, ptVersion] = await Promise.all([
    resolveRateVersion(database, tenantId, "epf", DEFAULT_JURISDICTION, input.asOfDateKey),
    resolveRateVersion(database, tenantId, "esi", DEFAULT_JURISDICTION, input.asOfDateKey),
    resolveRateVersion(database, tenantId, "professional_tax", stateJurisdiction, input.asOfDateKey),
  ]);
  const missing: StatutoryRuleType[] = [];
  if (!epfVersion) missing.push("epf");
  if (!esiVersion) missing.push("esi");
  if (!ptVersion) missing.push("professional_tax");
  const suggestion = computeStatutorySuggestion({
    monthlyWagesPaise: input.monthlyWagesPaise,
    epf: epfVersion ? toEpfParameters(epfVersion.parameters) : null,
    esi: esiVersion ? toEsiParameters(esiVersion.parameters) : null,
    professionalTax: ptVersion ? toProfessionalTaxParameters(ptVersion.parameters) : null,
  });
  return {
    suggestion,
    versions: [epfVersion, esiVersion, ptVersion].filter((version): version is ResolvedRateVersion => version !== null)
      .map((version) => ({ ruleType: version.ruleType, effectiveFrom: version.effectiveFrom, jurisdiction: version.jurisdiction, sourceReference: version.sourceReference })),
    missing,
  };
}

export type RateVersionSummary = {
  id: string;
  ruleType: StatutoryRuleType;
  jurisdiction: string;
  effectiveFrom: string;
  status: string;
  sourceReference: string;
  parameterCount: number;
};

export async function listRateVersions(database: DashboardDatabase, tenantId: string): Promise<RateVersionSummary[]> {
  requireTenant(tenantId);
  const versions = await database.select({
    id: statutoryRateVersions.id,
    ruleType: statutoryRateVersions.ruleType,
    jurisdiction: statutoryRateVersions.jurisdiction,
    effectiveFrom: statutoryRateVersions.effectiveFrom,
    status: statutoryRateVersions.status,
    sourceReference: statutoryRateVersions.sourceReference,
  }).from(statutoryRateVersions).where(eq(statutoryRateVersions.tenantId, tenantId))
    .orderBy(asc(statutoryRateVersions.ruleType), desc(statutoryRateVersions.effectiveFrom));
  const parameters = await database.select({ versionId: statutoryRateParameters.versionId })
    .from(statutoryRateParameters).where(eq(statutoryRateParameters.tenantId, tenantId));
  const counts = new Map<string, number>();
  for (const row of parameters) counts.set(row.versionId, (counts.get(row.versionId) ?? 0) + 1);
  return versions.map((version) => ({
    ...version,
    ruleType: version.ruleType as StatutoryRuleType,
    parameterCount: counts.get(version.id) ?? 0,
  }));
}
