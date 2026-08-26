import { and, asc, eq, isNull, sql } from "drizzle-orm";

import {
  clientPackageAssignments,
  legalEntities,
  serviceCatalog,
  servicePackageItems,
  servicePackages,
  timeEntries,
} from "../../db/schema";
import type { DashboardDatabase } from "../dashboard/postgres/repository";
import { listActiveScheduleRules, listClientScheduleOverrides } from "../compliance/repository";
import { resolveSchedule } from "../compliance/client-schedules";
import { buildPayrollCostLookup, loadRateBook } from "../rates/repository";
import { resolveCharge, resolveCost } from "../rates/valuation";
import {
  minutesToPaise,
  priceAtDesign,
  standingOf,
  type ActualDelivery,
  type AssignmentStanding,
  type BillingCycle,
  type Frequency,
  type PackagePricing,
  type PackageService,
} from "./pricing";

/**
 * What a package implies, from what the firm has already recorded.
 *
 * Nothing here is a new fact. The services are in the package, the cadence is in
 * the compliance calendar, the standard time is in the catalogue and the rates
 * are in the rate book. The price was the only number nobody had connected to
 * any of them.
 */

/**
 * The firm's median cost rate, used where a package is priced before anybody is
 * assigned to it.
 *
 * The median rather than the mean: one partner's rate would drag an average
 * upward and make every package look unprofitable, which is a worse error than
 * being slightly wrong about the mix.
 */
export async function medianCostRate(
  database: DashboardDatabase,
  tenantId: string,
  dateKey: string,
): Promise<number | null> {
  const book = await loadRateBook(database, tenantId);
  // Cost comes from payroll where the structure is captured and falls back to
  // the rate card, which is the same order everything else in the firm uses.
  const payrollCost = await buildPayrollCostLookup(database, tenantId, [dateKey.slice(0, 7)]);
  const rates = [...book.employees.keys()]
    .map((employeeUserId) => resolveCost(book, payrollCost, employeeUserId, dateKey).paisePerHour)
    .filter((paise): paise is number => paise !== null && paise > 0)
    .sort((left, right) => left - right);
  if (rates.length === 0) return null;
  const middle = Math.floor(rates.length / 2);
  return rates.length % 2 === 0 ? Math.round((rates[middle - 1]! + rates[middle]!) / 2) : rates[middle]!;
}

/** The services a package holds, with the cadence and standard time for each. */
export async function packageServices(
  database: DashboardDatabase,
  tenantId: string,
  packageId: string,
  todayKey: string,
  legalEntityId?: string,
): Promise<PackageService[]> {
  const [rows, firmRules, overrides] = await Promise.all([
    database.select({
      serviceCode: serviceCatalog.code,
      serviceName: serviceCatalog.name,
      standardMinutes: serviceCatalog.standardMinutes,
    }).from(servicePackageItems)
      .innerJoin(serviceCatalog, and(
        eq(serviceCatalog.tenantId, servicePackageItems.tenantId),
        eq(serviceCatalog.id, servicePackageItems.serviceId),
      ))
      .where(and(eq(servicePackageItems.tenantId, tenantId), eq(servicePackageItems.packageId, packageId)))
      .orderBy(asc(serviceCatalog.code)),
    listActiveScheduleRules(database, tenantId, todayKey),
    legalEntityId ? listClientScheduleOverrides(database, tenantId) : Promise.resolve([]),
  ]);

  return rows.map((row) => {
    // A client's own cadence where there is one, because that is what the
    // calendar will actually raise for them.
    const resolved = legalEntityId
      ? resolveSchedule({ asOfKey: todayKey, firmRules, legalEntityId, overrides, serviceCode: row.serviceCode })
      : { rule: firmRules.find((rule) => rule.serviceCode.toUpperCase() === row.serviceCode.toUpperCase()) ?? null, source: "firm" as const };
    return {
      frequency: (resolved.rule?.frequency as Frequency | undefined) ?? null,
      serviceCode: row.serviceCode.toUpperCase(),
      serviceName: row.serviceName,
      standardMinutes: row.standardMinutes,
    };
  });
}

export type PackagePricingRow = PackagePricing & {
  billingCycle: BillingCycle;
  code: string;
  costPaisePerHour: number | null;
  feePaise: number;
  name: string;
  packageId: string;
};

/** Every package the firm sells, priced against its own standards. */
export async function priceCatalogue(
  database: DashboardDatabase,
  tenantId: string,
  todayKey: string,
): Promise<PackagePricingRow[]> {
  const [packages, costRate] = await Promise.all([
    database.select({
      billingCycle: servicePackages.billingCycle,
      code: servicePackages.code,
      feePaise: servicePackages.standardFeePaise,
      id: servicePackages.id,
      name: servicePackages.name,
    }).from(servicePackages)
      .where(and(eq(servicePackages.tenantId, tenantId), eq(servicePackages.status, "active")))
      .orderBy(asc(servicePackages.name)),
    medianCostRate(database, tenantId, todayKey),
  ]);

  return Promise.all(packages.map(async (row) => ({
    ...priceAtDesign({
      billingCycle: row.billingCycle as BillingCycle,
      // Zero where no rate exists, which leaves the cost at nothing and the
      // margin at 100% — so `costPaisePerHour` is returned for the screen to
      // say the estimate rests on no rate at all.
      costPaisePerHour: costRate ?? 0,
      feePaise: row.feePaise,
      services: await packageServices(database, tenantId, row.id, todayKey),
    }),
    billingCycle: row.billingCycle as BillingCycle,
    code: row.code,
    costPaisePerHour: costRate,
    feePaise: row.feePaise,
    name: row.name,
    packageId: row.id,
  })));
}

/**
 * What one client's package has actually consumed.
 *
 * Every hour recorded against the client in the window, not only hours on the
 * services the package lists. That is deliberate for a retainer, which is what
 * these packages are: the advisory call that arrives because the client is on a
 * retainer is real cost, and excluding it would flatter every package the firm
 * sells. A firm billing some work outside the retainer would over-count here,
 * and should read the figure as cost of serving the client rather than cost of
 * the package alone.
 *
 * Valued twice: at cost, which answers whether the package pays for itself, and
 * at charge, which answers how much of its value the firm is giving away.
 */
export async function actualDelivery(
  database: DashboardDatabase,
  tenantId: string,
  legalEntityId: string,
  periodFrom: string,
  periodTo: string,
): Promise<ActualDelivery> {
  const [rows, book] = await Promise.all([
    database.select({
      employeeUserId: timeEntries.employeeUserId,
      entryDate: timeEntries.entryDate,
      minutes: timeEntries.minutes,
    }).from(timeEntries)
      .where(and(
        eq(timeEntries.tenantId, tenantId),
        eq(timeEntries.legalEntityId, legalEntityId),
        sql`${timeEntries.entryDate} >= ${periodFrom}::date`,
        sql`${timeEntries.entryDate} <= ${periodTo}::date`,
      )),
    loadRateBook(database, tenantId),
  ]);

  const months = [...new Set(rows.map((row) => row.entryDate.slice(0, 7)))];
  const payrollCost = await buildPayrollCostLookup(database, tenantId, months);

  let chargeValuePaise = 0;
  let costPaise = 0;
  let minutes = 0;
  for (const row of rows) {
    minutes += row.minutes;
    const charge = resolveCharge(book, row.employeeUserId, legalEntityId, row.entryDate).paisePerHour;
    const cost = resolveCost(book, payrollCost, row.employeeUserId, row.entryDate).paisePerHour;
    if (charge !== null) chargeValuePaise += minutesToPaise(row.minutes, charge);
    if (cost !== null) costPaise += minutesToPaise(row.minutes, cost);
  }
  return { chargeValuePaise, costPaise, minutes };
}

export type AssignmentPricingRow = AssignmentStanding & {
  assignmentId: string;
  clientName: string;
  legalEntityId: string;
  packageName: string;
  periodFrom: string;
  periodTo: string;
};

/**
 * How every live package assignment is actually going.
 *
 * Measured over the assignment's own window, capped at today: a retainer three
 * months into its year has consumed three months of effort, and comparing that
 * against a year's fee would report every new engagement as a disaster.
 */
export async function assignmentStandings(
  database: DashboardDatabase,
  tenantId: string,
  todayKey: string,
): Promise<AssignmentPricingRow[]> {
  const assignments = await database.select({
    agreedFeePaise: clientPackageAssignments.agreedFeePaiseSnapshot,
    billingCycle: clientPackageAssignments.billingCycleSnapshot,
    clientName: legalEntities.displayName,
    effectiveFrom: clientPackageAssignments.effectiveFrom,
    effectiveTo: clientPackageAssignments.effectiveTo,
    id: clientPackageAssignments.id,
    legalEntityId: clientPackageAssignments.legalEntityId,
    packageId: clientPackageAssignments.packageId,
    packageName: clientPackageAssignments.packageNameSnapshot,
  }).from(clientPackageAssignments)
    .innerJoin(legalEntities, and(
      eq(legalEntities.tenantId, clientPackageAssignments.tenantId),
      eq(legalEntities.id, clientPackageAssignments.legalEntityId),
    ))
    .where(and(
      eq(clientPackageAssignments.tenantId, tenantId),
      eq(clientPackageAssignments.status, "active"),
    ))
    .orderBy(asc(legalEntities.displayName));

  return Promise.all(assignments.map(async (row) => {
    const periodFrom = row.effectiveFrom;
    const periodTo = row.effectiveTo && row.effectiveTo < todayKey ? row.effectiveTo : todayKey;
    const [actual, services] = await Promise.all([
      actualDelivery(database, tenantId, row.legalEntityId, periodFrom, periodTo),
      packageServices(database, tenantId, row.packageId, todayKey, row.legalEntityId),
    ]);

    // The expectation is scaled to the window actually elapsed, so a retainer
    // three months old is measured against three months of expected effort.
    const elapsedDays = Math.max(1, Math.round(
      (Date.parse(`${periodTo}T00:00:00Z`) - Date.parse(`${periodFrom}T00:00:00Z`)) / 86_400_000,
    ) + 1);
    const yearFraction = Math.min(1, elapsedDays / 365);
    const annual = priceAtDesign({
      billingCycle: row.billingCycle as BillingCycle,
      costPaisePerHour: 0,
      feePaise: row.agreedFeePaise,
      services,
    });

    return {
      ...standingOf({
        actual,
        expectedMinutes: Math.round(annual.expected.minutesAYear * yearFraction),
        feePaise: Math.round(annual.annualFeePaise * yearFraction),
      }),
      assignmentId: row.id,
      clientName: row.clientName,
      legalEntityId: row.legalEntityId,
      packageName: row.packageName,
      periodFrom,
      periodTo,
    };
  }));
}

/** Clients paying a package fee with no time recorded against them at all. */
export async function unmeasuredAssignments(database: DashboardDatabase, tenantId: string) {
  return database.select({
    clientName: legalEntities.displayName,
    legalEntityId: clientPackageAssignments.legalEntityId,
    packageName: clientPackageAssignments.packageNameSnapshot,
  }).from(clientPackageAssignments)
    .innerJoin(legalEntities, and(
      eq(legalEntities.tenantId, clientPackageAssignments.tenantId),
      eq(legalEntities.id, clientPackageAssignments.legalEntityId),
    ))
    .leftJoin(timeEntries, and(
      eq(timeEntries.tenantId, clientPackageAssignments.tenantId),
      eq(timeEntries.legalEntityId, clientPackageAssignments.legalEntityId),
    ))
    .where(and(
      eq(clientPackageAssignments.tenantId, tenantId),
      eq(clientPackageAssignments.status, "active"),
      isNull(timeEntries.id),
    ))
    .groupBy(legalEntities.displayName, clientPackageAssignments.legalEntityId, clientPackageAssignments.packageNameSnapshot);
}

/** Services a package sells that the firm has no standard time for. */
export async function servicesWithoutStandards(database: DashboardDatabase, tenantId: string) {
  return database.select({
    code: serviceCatalog.code,
    name: serviceCatalog.name,
  }).from(serviceCatalog)
    .innerJoin(servicePackageItems, and(
      eq(servicePackageItems.tenantId, serviceCatalog.tenantId),
      eq(servicePackageItems.serviceId, serviceCatalog.id),
    ))
    .where(and(eq(serviceCatalog.tenantId, tenantId), isNull(serviceCatalog.standardMinutes)))
    .groupBy(serviceCatalog.code, serviceCatalog.name)
    .orderBy(asc(serviceCatalog.code));
}
