/**
 * Turning recorded effort into money.
 *
 * The firm has always known how many minutes went into a job and never what
 * they were worth, so every commercial question — is this client profitable, is
 * this fixed fee covering its cost, what is unbilled — had no answer in the
 * software. This module is the hinge: pure functions that resolve which rate
 * applied on a given day and value a time entry with it.
 *
 * Everything is in paise and whole minutes. Money is never a float; an hourly
 * rate divided across minutes is rounded once, at the end, so a day of entries
 * cannot drift from the day's total.
 */

const MINUTES_PER_HOUR = 60;

export type EffectiveRate = {
  chargePaisePerHour: number;
  costPaisePerHour: number | null;
  effectiveFrom: string;
};

export type EmployeeRateRow = EffectiveRate & { employeeUserId: string };

export type ClientRateOverrideRow = {
  chargePaisePerHour: number;
  effectiveFrom: string;
  employeeUserId: string;
  legalEntityId: string;
};

/**
 * The row in force on a date: the latest one that had already started.
 *
 * A rate dated in the future is a decision the firm has made but not yet
 * applied, so work done today is still valued at today's rate.
 */
export function rateInForce<T extends { effectiveFrom: string }>(rows: readonly T[], dateKey: string): T | null {
  let chosen: T | null = null;
  for (const row of rows) {
    if (row.effectiveFrom > dateKey) continue;
    if (!chosen || row.effectiveFrom > chosen.effectiveFrom) chosen = row;
  }
  return chosen;
}

export type RateBook = {
  /** Standard rates by employee, each already sorted or not — order is not assumed. */
  employees: ReadonlyMap<string, readonly EmployeeRateRow[]>;
  /** Negotiated exceptions, keyed `legalEntityId:employeeUserId`. */
  overrides: ReadonlyMap<string, readonly ClientRateOverrideRow[]>;
};

export const overrideKey = (legalEntityId: string, employeeUserId: string) => `${legalEntityId}:${employeeUserId}`;

export function buildRateBook(
  employeeRates: readonly EmployeeRateRow[],
  overrides: readonly ClientRateOverrideRow[],
): RateBook {
  const employees = new Map<string, EmployeeRateRow[]>();
  for (const row of employeeRates) {
    const existing = employees.get(row.employeeUserId) ?? [];
    existing.push(row);
    employees.set(row.employeeUserId, existing);
  }
  const byScope = new Map<string, ClientRateOverrideRow[]>();
  for (const row of overrides) {
    const key = overrideKey(row.legalEntityId, row.employeeUserId);
    const existing = byScope.get(key) ?? [];
    existing.push(row);
    byScope.set(key, existing);
  }
  return { employees, overrides: byScope };
}

export type ChargeBasis = "override" | "standard" | "none";

export type ResolvedCharge = {
  basis: ChargeBasis;
  paisePerHour: number | null;
};

/**
 * Which rate applies: the client's negotiated one if there is one, otherwise the
 * house rate. Internal time has no client, so it can only ever use the house
 * rate — and non-billable time is valued too, because knowing what unbillable
 * effort costs is the point of measuring it.
 */
export function resolveCharge(
  book: RateBook,
  employeeUserId: string,
  legalEntityId: string | null,
  dateKey: string,
): ResolvedCharge {
  if (legalEntityId) {
    const negotiated = rateInForce(book.overrides.get(overrideKey(legalEntityId, employeeUserId)) ?? [], dateKey);
    if (negotiated) return { basis: "override", paisePerHour: negotiated.chargePaisePerHour };
  }
  const standard = rateInForce(book.employees.get(employeeUserId) ?? [], dateKey);
  if (standard) return { basis: "standard", paisePerHour: standard.chargePaisePerHour };
  return { basis: "none", paisePerHour: null };
}

export type CostBasis = "payroll" | "rate_card" | "none";

export type ResolvedCost = {
  basis: CostBasis;
  paisePerHour: number | null;
};

/**
 * Monthly cost of employment spread over the hours the firm actually expects.
 *
 * Earnings plus what the employer pays on top — PF, ESI and the like are as much
 * the cost of the person as the salary is. Scheduled hours, not calendar hours,
 * because a month with more working days does not make anybody cheaper.
 */
export function costPerHourFromPayroll(monthlyCostPaise: number, scheduledMinutes: number): number | null {
  if (monthlyCostPaise <= 0 || scheduledMinutes <= 0) return null;
  return Math.round((monthlyCostPaise * MINUTES_PER_HOUR) / scheduledMinutes);
}

export type PayrollCostLookup = (employeeUserId: string, periodKey: string) => number | null;

export function resolveCost(
  book: RateBook,
  payrollCost: PayrollCostLookup,
  employeeUserId: string,
  dateKey: string,
): ResolvedCost {
  const derived = payrollCost(employeeUserId, dateKey.slice(0, 7));
  if (derived !== null) return { basis: "payroll", paisePerHour: derived };
  // Only when payroll cannot answer — a partner who draws no salary, or somebody
  // whose structure has not been captured yet.
  const standard = rateInForce(book.employees.get(employeeUserId) ?? [], dateKey);
  if (standard?.costPaisePerHour != null) return { basis: "rate_card", paisePerHour: standard.costPaisePerHour };
  return { basis: "none", paisePerHour: null };
}

/** Paise for a span of minutes at an hourly rate. Rounded once, at the end. */
export function valueOf(minutes: number, paisePerHour: number | null): number | null {
  if (paisePerHour === null) return null;
  return Math.round((minutes * paisePerHour) / MINUTES_PER_HOUR);
}

export type TimeEntryForValuation = {
  billable: boolean;
  employeeUserId: string;
  entryDate: string;
  legalEntityId: string | null;
  minutes: number;
};

export type ValuedEntry = {
  chargeBasis: ChargeBasis;
  /** Null when nobody has set a rate for this person; not zero, which would lie. */
  chargePaise: number | null;
  costBasis: CostBasis;
  costPaise: number | null;
  minutes: number;
};

/**
 * An unrated hour is worth `null`, never zero.
 *
 * Zero would quietly report a client as pure profit and a person as free, which
 * is a worse answer than admitting the rate is missing.
 */
export function valueEntry(
  entry: TimeEntryForValuation,
  book: RateBook,
  payrollCost: PayrollCostLookup,
): ValuedEntry {
  const charge = resolveCharge(book, entry.employeeUserId, entry.legalEntityId, entry.entryDate);
  const cost = resolveCost(book, payrollCost, entry.employeeUserId, entry.entryDate);
  return {
    chargeBasis: charge.basis,
    // Non-billable effort is never charged to anybody, whatever the rate card
    // says. It still carries a cost, which is exactly why it is worth counting.
    chargePaise: entry.billable ? valueOf(entry.minutes, charge.paisePerHour) : 0,
    costBasis: cost.basis,
    costPaise: valueOf(entry.minutes, cost.paisePerHour),
    minutes: entry.minutes,
  };
}

export type EffortValue = {
  billableMinutes: number;
  chargePaise: number;
  costPaise: number;
  minutes: number;
  nonBillableMinutes: number;
  /** Entries the firm could not value, so a total is never quietly understated. */
  unratedChargeMinutes: number;
  unratedCostMinutes: number;
};

export const emptyEffortValue = (): EffortValue => ({
  billableMinutes: 0,
  chargePaise: 0,
  costPaise: 0,
  minutes: 0,
  nonBillableMinutes: 0,
  unratedChargeMinutes: 0,
  unratedCostMinutes: 0,
});

export function accumulate(total: EffortValue, entry: TimeEntryForValuation, valued: ValuedEntry): EffortValue {
  return {
    billableMinutes: total.billableMinutes + (entry.billable ? entry.minutes : 0),
    chargePaise: total.chargePaise + (valued.chargePaise ?? 0),
    costPaise: total.costPaise + (valued.costPaise ?? 0),
    minutes: total.minutes + entry.minutes,
    nonBillableMinutes: total.nonBillableMinutes + (entry.billable ? 0 : entry.minutes),
    // Only billable time can be missing a charge rate in a way that matters.
    unratedChargeMinutes: total.unratedChargeMinutes + (entry.billable && valued.chargePaise === null ? entry.minutes : 0),
    unratedCostMinutes: total.unratedCostMinutes + (valued.costPaise === null ? entry.minutes : 0),
  };
}

export function summariseEffort(
  entries: readonly TimeEntryForValuation[],
  book: RateBook,
  payrollCost: PayrollCostLookup,
): EffortValue {
  return entries.reduce(
    (total, entry) => accumulate(total, entry, valueEntry(entry, book, payrollCost)),
    emptyEffortValue(),
  );
}

/**
 * Margin as basis points, so it survives being stored and compared without
 * floating-point drift. Null when there is nothing to divide by, rather than a
 * zero that would read as "we broke even".
 */
export function marginBasisPoints(revenuePaise: number, costPaise: number): number | null {
  if (revenuePaise <= 0) return null;
  return Math.round(((revenuePaise - costPaise) / revenuePaise) * 10_000);
}

export const formatBasisPoints = (value: number | null) => (value === null ? "—" : `${(value / 100).toFixed(1)}%`);

/** Hours, for reading. Minutes are the unit of record; hours are the unit of speech. */
export const hoursLabel = (minutes: number) => `${(minutes / MINUTES_PER_HOUR).toFixed(1)}h`;
