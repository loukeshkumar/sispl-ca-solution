import type { EpfParameters, EsiParameters, ProfessionalTaxParameters, RoundingMode } from "./calculators";

export type StatutoryRuleType = "epf" | "esi" | "professional_tax";
export type ParameterUnit = "basis_points" | "paise" | "count";
export type ParameterRow = { parameterKey: string; numericValue: number; unit: ParameterUnit };

export class StatutoryParameterError extends Error {
  constructor(public readonly ruleType: StatutoryRuleType, public readonly parameterKey: string) {
    super(`The ${ruleType} rate version is missing the ${parameterKey} parameter.`);
    this.name = "StatutoryParameterError";
  }
}

function requireValue(ruleType: StatutoryRuleType, rows: ParameterRow[], key: string) {
  const row = rows.find((candidate) => candidate.parameterKey === key);
  if (!row) throw new StatutoryParameterError(ruleType, key);
  return row.numericValue;
}

function optionalValue(rows: ParameterRow[], key: string, fallback: number) {
  return rows.find((candidate) => candidate.parameterKey === key)?.numericValue ?? fallback;
}

function roundingFrom(rows: ParameterRow[], fallback: RoundingMode): RoundingMode {
  const raw = rows.find((candidate) => candidate.parameterKey === "rounding_up_to_rupee")?.numericValue;
  if (raw === undefined) return fallback;
  return raw === 1 ? "up_to_rupee" : "nearest";
}

export function toEpfParameters(rows: ParameterRow[]): EpfParameters {
  return {
    employeeRateBasisPoints: requireValue("epf", rows, "employee_rate_bp"),
    employerRateBasisPoints: requireValue("epf", rows, "employer_rate_bp"),
    pensionRateBasisPoints: requireValue("epf", rows, "pension_rate_bp"),
    wageCeilingPaise: requireValue("epf", rows, "wage_ceiling_paise"),
    applyCeiling: optionalValue(rows, "apply_ceiling", 1) === 1,
    rounding: roundingFrom(rows, "nearest"),
  };
}

export function toEsiParameters(rows: ParameterRow[]): EsiParameters {
  return {
    employeeRateBasisPoints: requireValue("esi", rows, "employee_rate_bp"),
    employerRateBasisPoints: requireValue("esi", rows, "employer_rate_bp"),
    wageThresholdPaise: requireValue("esi", rows, "wage_threshold_paise"),
    rounding: roundingFrom(rows, "up_to_rupee"),
  };
}

const SLAB_UPTO = /^pt_slab_(\d{1,2})_upto_paise$/;

export function toProfessionalTaxParameters(rows: ParameterRow[]): ProfessionalTaxParameters {
  const slabs = rows
    .map((row) => ({ row, match: SLAB_UPTO.exec(row.parameterKey) }))
    .filter((entry): entry is { row: ParameterRow; match: RegExpExecArray } => entry.match !== null)
    .map((entry) => {
      const index = entry.match[1];
      const amount = rows.find((candidate) => candidate.parameterKey === `pt_slab_${index}_amount_paise`);
      if (!amount) throw new StatutoryParameterError("professional_tax", `pt_slab_${index}_amount_paise`);
      return { uptoPaise: entry.row.numericValue, amountPaise: amount.numericValue };
    })
    .sort((left, right) => left.uptoPaise - right.uptoPaise);
  if (slabs.length === 0) throw new StatutoryParameterError("professional_tax", "pt_slab_1_upto_paise");
  return { slabs };
}
