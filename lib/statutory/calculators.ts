/**
 * Pure statutory calculators.
 *
 * Every rate, ceiling, threshold, and rounding rule arrives as a parameter from a
 * versioned rate set — nothing is hard-coded here — so a historic payroll can be
 * recomputed with the rules that were in force at the time. The output is a
 * *suggestion* the firm reviews and may override; SISPL does not claim automatic
 * statutory compliance.
 */

export type RoundingMode = "nearest" | "up_to_rupee";

export type EpfParameters = {
  employeeRateBasisPoints: number;
  employerRateBasisPoints: number;
  pensionRateBasisPoints: number;
  wageCeilingPaise: number;
  applyCeiling: boolean;
  rounding: RoundingMode;
};

export type EsiParameters = {
  employeeRateBasisPoints: number;
  employerRateBasisPoints: number;
  wageThresholdPaise: number;
  rounding: RoundingMode;
};

export type ProfessionalTaxSlab = { uptoPaise: number; amountPaise: number };
export type ProfessionalTaxParameters = { slabs: ProfessionalTaxSlab[] };

export type EpfResult = {
  wageBasePaise: number;
  employeeContributionPaise: number;
  employerPensionPaise: number;
  employerProvidentFundPaise: number;
  employerTotalPaise: number;
};

export type EsiResult = {
  applicable: boolean;
  wageBasePaise: number;
  employeeContributionPaise: number;
  employerContributionPaise: number;
};

export function applyRounding(paise: number, mode: RoundingMode) {
  if (mode === "up_to_rupee") return Math.ceil(paise / 100) * 100;
  return Math.round(paise);
}

function applyRate(basePaise: number, basisPoints: number, mode: RoundingMode) {
  return applyRounding((basePaise * basisPoints) / 10_000, mode);
}

export function computeEpf(monthlyWagesPaise: number, parameters: EpfParameters): EpfResult {
  if (!Number.isSafeInteger(monthlyWagesPaise) || monthlyWagesPaise < 0) throw new Error("Wages must be non-negative integer paise.");
  const wageBasePaise = parameters.applyCeiling ? Math.min(monthlyWagesPaise, parameters.wageCeilingPaise) : monthlyWagesPaise;
  const employeeContributionPaise = applyRate(wageBasePaise, parameters.employeeRateBasisPoints, parameters.rounding);
  const employerTotalPaise = applyRate(wageBasePaise, parameters.employerRateBasisPoints, parameters.rounding);
  const employerPensionPaise = Math.min(applyRate(wageBasePaise, parameters.pensionRateBasisPoints, parameters.rounding), employerTotalPaise);
  return {
    wageBasePaise,
    employeeContributionPaise,
    employerPensionPaise,
    employerProvidentFundPaise: employerTotalPaise - employerPensionPaise,
    employerTotalPaise,
  };
}

export function computeEsi(monthlyWagesPaise: number, parameters: EsiParameters): EsiResult {
  if (!Number.isSafeInteger(monthlyWagesPaise) || monthlyWagesPaise < 0) throw new Error("Wages must be non-negative integer paise.");
  if (monthlyWagesPaise > parameters.wageThresholdPaise) {
    return { applicable: false, wageBasePaise: monthlyWagesPaise, employeeContributionPaise: 0, employerContributionPaise: 0 };
  }
  return {
    applicable: true,
    wageBasePaise: monthlyWagesPaise,
    employeeContributionPaise: applyRate(monthlyWagesPaise, parameters.employeeRateBasisPoints, parameters.rounding),
    employerContributionPaise: applyRate(monthlyWagesPaise, parameters.employerRateBasisPoints, parameters.rounding),
  };
}

/** Slabs are evaluated in ascending order; the first slab the wage falls within wins. */
export function computeProfessionalTax(monthlyWagesPaise: number, parameters: ProfessionalTaxParameters) {
  if (!Number.isSafeInteger(monthlyWagesPaise) || monthlyWagesPaise < 0) throw new Error("Wages must be non-negative integer paise.");
  const ordered = [...parameters.slabs].sort((left, right) => left.uptoPaise - right.uptoPaise);
  for (const slab of ordered) {
    if (monthlyWagesPaise <= slab.uptoPaise) return slab.amountPaise;
  }
  return ordered.at(-1)?.amountPaise ?? 0;
}

export type StatutorySuggestion = {
  employeeProvidentFundPaise: number;
  employeeStateInsurancePaise: number;
  professionalTaxPaise: number;
  employerProvidentFundPaise: number;
  employerPensionPaise: number;
  employerStateInsurancePaise: number;
  esiApplicable: boolean;
};

export function computeStatutorySuggestion(input: {
  monthlyWagesPaise: number;
  epf: EpfParameters | null;
  esi: EsiParameters | null;
  professionalTax: ProfessionalTaxParameters | null;
}): StatutorySuggestion {
  const epf = input.epf ? computeEpf(input.monthlyWagesPaise, input.epf) : null;
  const esi = input.esi ? computeEsi(input.monthlyWagesPaise, input.esi) : null;
  return {
    employeeProvidentFundPaise: epf?.employeeContributionPaise ?? 0,
    employeeStateInsurancePaise: esi?.employeeContributionPaise ?? 0,
    professionalTaxPaise: input.professionalTax ? computeProfessionalTax(input.monthlyWagesPaise, input.professionalTax) : 0,
    employerProvidentFundPaise: epf?.employerProvidentFundPaise ?? 0,
    employerPensionPaise: epf?.employerPensionPaise ?? 0,
    employerStateInsurancePaise: esi?.employerContributionPaise ?? 0,
    esiApplicable: esi?.applicable ?? false,
  };
}
