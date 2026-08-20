import assert from "node:assert/strict";
import test from "node:test";

import {
  applyRounding,
  computeEpf,
  computeEsi,
  computeProfessionalTax,
  computeStatutorySuggestion,
  type EpfParameters,
  type EsiParameters,
} from "../lib/statutory/calculators";
import {
  StatutoryParameterError,
  toEpfParameters,
  toEsiParameters,
  toProfessionalTaxParameters,
  type ParameterRow,
} from "../lib/statutory/parameters";

const epf: EpfParameters = {
  employeeRateBasisPoints: 1200,
  employerRateBasisPoints: 1200,
  pensionRateBasisPoints: 833,
  wageCeilingPaise: 1_500_000,
  applyCeiling: true,
  rounding: "nearest",
};

const esi: EsiParameters = {
  employeeRateBasisPoints: 75,
  employerRateBasisPoints: 325,
  wageThresholdPaise: 2_100_000,
  rounding: "up_to_rupee",
};

const ptSlabs = {
  slabs: [
    { uptoPaise: 2_500_000, amountPaise: 0 },
    { uptoPaise: 4_166_600, amountPaise: 10_400 },
    { uptoPaise: 8_333_300, amountPaise: 20_800 },
    { uptoPaise: 999_999_999, amountPaise: 41_600 },
  ],
};

test("rounding modes behave as configured, including exact rupees", () => {
  assert.equal(applyRounding(12_345.6, "nearest"), 12_346);
  assert.equal(applyRounding(12_301, "up_to_rupee"), 12_400);
  assert.equal(applyRounding(12_300, "up_to_rupee"), 12_300);
  assert.equal(applyRounding(0, "up_to_rupee"), 0);
});

test("EPF applies the wage ceiling and splits the employer share between pension and PF", () => {
  const belowCeiling = computeEpf(1_200_000, epf);
  assert.equal(belowCeiling.wageBasePaise, 1_200_000);
  assert.equal(belowCeiling.employeeContributionPaise, 144_000);
  assert.equal(belowCeiling.employerPensionPaise, 99_960);
  assert.equal(belowCeiling.employerProvidentFundPaise, 44_040);
  assert.equal(belowCeiling.employerPensionPaise + belowCeiling.employerProvidentFundPaise, belowCeiling.employerTotalPaise);

  const aboveCeiling = computeEpf(5_000_000, epf);
  assert.equal(aboveCeiling.wageBasePaise, 1_500_000, "wages above the ceiling contribute only on the ceiling");
  assert.equal(aboveCeiling.employeeContributionPaise, 180_000);
});

test("EPF can be configured without a ceiling for firms that contribute on full wages", () => {
  const uncapped = computeEpf(5_000_000, { ...epf, applyCeiling: false });
  assert.equal(uncapped.wageBasePaise, 5_000_000);
  assert.equal(uncapped.employeeContributionPaise, 600_000);
});

test("ESI applies only at or below the wage threshold", () => {
  const covered = computeEsi(1_800_000, esi);
  assert.equal(covered.applicable, true);
  assert.equal(covered.employeeContributionPaise, 13_500);
  assert.equal(covered.employerContributionPaise, 58_500);

  const atThreshold = computeEsi(2_100_000, esi);
  assert.equal(atThreshold.applicable, true, "an employee exactly at the threshold is still covered");

  const above = computeEsi(2_100_100, esi);
  assert.equal(above.applicable, false);
  assert.equal(above.employeeContributionPaise, 0);
  assert.equal(above.employerContributionPaise, 0);
});

test("ESI contributions round up to the rupee as configured", () => {
  const result = computeEsi(1_234_567, esi);
  assert.equal(result.employeeContributionPaise % 100, 0);
  assert.equal(result.employerContributionPaise % 100, 0);
});

test("professional tax picks the first slab the wage falls within, including boundaries", () => {
  assert.equal(computeProfessionalTax(2_000_000, ptSlabs), 0);
  assert.equal(computeProfessionalTax(2_500_000, ptSlabs), 0, "the slab boundary belongs to the lower slab");
  assert.equal(computeProfessionalTax(2_500_100, ptSlabs), 10_400);
  assert.equal(computeProfessionalTax(5_000_000, ptSlabs), 20_800);
  assert.equal(computeProfessionalTax(90_000_000, ptSlabs), 41_600);
});

test("unordered slabs are evaluated in ascending order regardless of storage order", () => {
  const shuffled = { slabs: [ptSlabs.slabs[3], ptSlabs.slabs[1], ptSlabs.slabs[0], ptSlabs.slabs[2]] };
  assert.equal(computeProfessionalTax(2_000_000, shuffled), 0);
  assert.equal(computeProfessionalTax(5_000_000, shuffled), 20_800);
});

test("negative or non-integer wages are rejected rather than silently coerced", () => {
  assert.throws(() => computeEpf(-1, epf), /non-negative integer paise/);
  assert.throws(() => computeEsi(1.5, esi), /non-negative integer paise/);
  assert.throws(() => computeProfessionalTax(-100, ptSlabs), /non-negative integer paise/);
});

test("an unconfigured rule contributes zero without pretending it was computed", () => {
  const suggestion = computeStatutorySuggestion({ monthlyWagesPaise: 1_800_000, epf, esi: null, professionalTax: null });
  assert.equal(suggestion.employeeProvidentFundPaise, 180_000);
  assert.equal(suggestion.employeeStateInsurancePaise, 0);
  assert.equal(suggestion.professionalTaxPaise, 0);
  assert.equal(suggestion.esiApplicable, false);
});

test("parameter rows map onto typed parameters and missing keys fail loudly", () => {
  const rows: ParameterRow[] = [
    { parameterKey: "employee_rate_bp", numericValue: 1200, unit: "basis_points" },
    { parameterKey: "employer_rate_bp", numericValue: 1200, unit: "basis_points" },
    { parameterKey: "pension_rate_bp", numericValue: 833, unit: "basis_points" },
    { parameterKey: "wage_ceiling_paise", numericValue: 1_500_000, unit: "paise" },
  ];
  const mapped = toEpfParameters(rows);
  assert.equal(mapped.applyCeiling, true, "the ceiling applies unless explicitly disabled");
  assert.equal(mapped.rounding, "nearest");

  assert.throws(
    () => toEpfParameters(rows.filter((row) => row.parameterKey !== "pension_rate_bp")),
    (error: unknown) => error instanceof StatutoryParameterError && error.parameterKey === "pension_rate_bp",
  );
  assert.throws(() => toEsiParameters([]), StatutoryParameterError);
});

test("ESI defaults to rupee rounding and honours an explicit override", () => {
  const rows: ParameterRow[] = [
    { parameterKey: "employee_rate_bp", numericValue: 75, unit: "basis_points" },
    { parameterKey: "employer_rate_bp", numericValue: 325, unit: "basis_points" },
    { parameterKey: "wage_threshold_paise", numericValue: 2_100_000, unit: "paise" },
  ];
  assert.equal(toEsiParameters(rows).rounding, "up_to_rupee");
  assert.equal(toEsiParameters([...rows, { parameterKey: "rounding_up_to_rupee", numericValue: 0, unit: "count" }]).rounding, "nearest");
});

test("professional tax slabs are paired by index and an orphaned bound is rejected", () => {
  const rows: ParameterRow[] = [
    { parameterKey: "pt_slab_2_upto_paise", numericValue: 4_166_600, unit: "paise" },
    { parameterKey: "pt_slab_2_amount_paise", numericValue: 10_400, unit: "paise" },
    { parameterKey: "pt_slab_1_upto_paise", numericValue: 2_500_000, unit: "paise" },
    { parameterKey: "pt_slab_1_amount_paise", numericValue: 0, unit: "paise" },
  ];
  assert.deepEqual(toProfessionalTaxParameters(rows).slabs, [
    { uptoPaise: 2_500_000, amountPaise: 0 },
    { uptoPaise: 4_166_600, amountPaise: 10_400 },
  ]);
  assert.throws(() => toProfessionalTaxParameters(rows.filter((row) => row.parameterKey !== "pt_slab_2_amount_paise")), StatutoryParameterError);
  assert.throws(() => toProfessionalTaxParameters([]), StatutoryParameterError);
});
