/**
 * Leave entitlement arithmetic.
 *
 * Everything here is pure: given a leave type's policy, an employee's service
 * dates and the postings already on the ledger, it says what else ought to be
 * there. The repository does the writing; keeping the decisions out of the
 * database means the awkward cases — a mid-year joiner, a leave that straddles
 * 31 March, a carried balance that lapses in June — can be argued about in a
 * test rather than in production.
 */

/** One day is two half-days everywhere in attendance; entitlement follows suit. */
export const HALF_DAYS_PER_DAY = 2;

export type AccrualMethod = "annual" | "monthly" | "none";

export type LeaveEntryType =
  | "opening" | "accrual" | "carry_forward" | "consumption"
  | "reversal" | "lapse" | "encashment" | "adjustment";

export type LeaveLedgerPosting = {
  dedupeKey: string | null;
  effectiveDate: string;
  entryType: LeaveEntryType;
  halfDays: number;
  leaveYear: string;
  reason: string;
};

export type LeaveTypePolicy = {
  accrualMethod: AccrualMethod;
  annualQuotaDays: number;
  carryForwardCap: number;
  carryForwardExpiryMonths: number | null;
  code: string;
  encashableOnExit: boolean;
};

export type ServiceDates = { employmentEndDate: string | null; joiningDate: string };

const pad = (value: number) => String(value).padStart(2, "0");

/**
 * Indian firms run leave on the financial year, which is also the clock the rest
 * of the practice runs on. April starts the year, so January to March belong to
 * the year that opened the previous April.
 */
export function leaveYearKey(dateKey: string): string {
  const year = Number(dateKey.slice(0, 4));
  const month = Number(dateKey.slice(5, 7));
  const startYear = month >= 4 ? year : year - 1;
  return `${startYear}-${pad((startYear + 1) % 100)}`;
}

export function leaveYearStartYear(leaveYear: string): number {
  return Number(leaveYear.slice(0, 4));
}

export function leaveYearBounds(leaveYear: string): { from: string; to: string } {
  const startYear = leaveYearStartYear(leaveYear);
  return { from: `${startYear}-04-01`, to: `${startYear + 1}-03-31` };
}

export function previousLeaveYear(leaveYear: string): string {
  const startYear = leaveYearStartYear(leaveYear) - 1;
  return `${startYear}-${pad((startYear + 1) % 100)}`;
}

/** Every leave year a date range touches, in order. A range may straddle 31 March. */
export function leaveYearsInRange(dateFrom: string, dateTo: string): string[] {
  const years: string[] = [];
  let cursor = leaveYearKey(dateFrom);
  const last = leaveYearKey(dateTo);
  for (let guard = 0; guard < 12; guard += 1) {
    years.push(cursor);
    if (cursor === last) return years;
    const startYear = leaveYearStartYear(cursor) + 1;
    cursor = `${startYear}-${pad((startYear + 1) % 100)}`;
  }
  return years;
}

/** The calendar month a leave year's nth month is, counting April as 1. */
function monthOfLeaveYear(leaveYear: string, index: number): { month: number; year: number } {
  const zeroBased = 3 + (index - 1);
  const startYear = leaveYearStartYear(leaveYear);
  return { month: (zeroBased % 12) + 1, year: startYear + Math.floor(zeroBased / 12) };
}

function lastDayOfMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

const dateKeyOf = (year: number, month: number, day: number) => `${year}-${pad(month)}-${pad(day)}`;

/**
 * Whether a month counts towards entitlement.
 *
 * A month is earned when the employee was in service across the bulk of it, and
 * the 15th is the usual line — joining on the 2nd earns the month, joining on
 * the 28th does not. Anything finer would be arguing about hours in a system
 * that grants leave in half-days.
 */
function servedMonth(service: ServiceDates, year: number, month: number) {
  const midpoint = dateKeyOf(year, month, 15);
  return service.joiningDate <= midpoint
    && (!service.employmentEndDate || service.employmentEndDate >= midpoint);
}

/**
 * Cumulative allocation, so twelve monthly credits sum to exactly the annual
 * quota however badly it divides. Crediting `quota / 12` rounded each month
 * turns fifteen days into eighteen.
 */
function creditThroughMonth(quotaHalfDays: number, monthIndex: number) {
  return Math.floor((quotaHalfDays * monthIndex) / 12);
}

export type AccrualInput = {
  leaveYear: string;
  policy: LeaveTypePolicy;
  service: ServiceDates;
  todayKey: string;
};

/**
 * The grants that should exist for one employee, one leave type, one year.
 *
 * The two methods gate on different things, and conflating them is the easy
 * mistake: `monthly` credits only months that have *finished*, because an
 * accrual for a month still running is a promise rather than a balance;
 * `annual` credits the whole year in April and reduces only for months the
 * person was not employed for. Pro-rating an annual grant by how far into the
 * year we are would make "granted in April" mean nothing.
 *
 * A quota of zero means the firm does not cap this type at all, so nothing is
 * granted and nothing will be enforced.
 */
export function accrualPostings({ leaveYear, policy, service, todayKey }: AccrualInput): LeaveLedgerPosting[] {
  if (policy.accrualMethod === "none" || policy.annualQuotaDays <= 0) return [];
  const quotaHalfDays = policy.annualQuotaDays * HALF_DAYS_PER_DAY;
  const bounds = leaveYearBounds(leaveYear);
  const completedOnly = policy.accrualMethod === "monthly";

  const served: number[] = [];
  for (let index = 1; index <= 12; index += 1) {
    const { month, year } = monthOfLeaveYear(leaveYear, index);
    const monthEnd = dateKeyOf(year, month, lastDayOfMonth(year, month));
    if (completedOnly && monthEnd > todayKey) break;
    if (servedMonth(service, year, month)) served.push(index);
  }
  if (served.length === 0) return [];

  if (policy.accrualMethod === "monthly") {
    return served.map((index) => {
      const { month, year } = monthOfLeaveYear(leaveYear, index);
      const halfDays = creditThroughMonth(quotaHalfDays, index) - creditThroughMonth(quotaHalfDays, index - 1);
      return {
        dedupeKey: `accrual:${policy.code}:${leaveYear}:${pad(index)}`,
        effectiveDate: dateKeyOf(year, month, lastDayOfMonth(year, month)),
        entryType: "accrual" as const,
        halfDays,
        leaveYear,
        reason: `Accrued for ${dateKeyOf(year, month, 1).slice(0, 7)}`,
      };
    }).filter((posting) => posting.halfDays > 0);
  }

  // `annual` credits the year in one posting, pro-rated by the months actually
  // served so a September joiner is not handed a full year's entitlement.
  const halfDays = served.length === 12
    ? quotaHalfDays
    : Math.round((quotaHalfDays * served.length) / 12);
  if (halfDays <= 0) return [];
  const effectiveDate = service.joiningDate > bounds.from ? service.joiningDate : bounds.from;
  // Next year's entitlement is not this year's to spend.
  if (todayKey < effectiveDate) return [];
  return [{
    dedupeKey: `accrual:${policy.code}:${leaveYear}:annual`,
    effectiveDate,
    entryType: "accrual",
    halfDays,
    leaveYear,
    reason: served.length === 12 ? "Annual entitlement" : `Annual entitlement, pro-rated for ${served.length} of 12 months`,
  }];
}

export type CarryForwardInput = {
  /** Closing balance of the year being carried from, in half-days. */
  closingHalfDays: number;
  leaveYear: string;
  policy: LeaveTypePolicy;
  todayKey: string;
};

/**
 * What survives from last year, and when it stops surviving.
 *
 * Returned as up to two postings: the credit at the start of the year, and the
 * lapse once the expiry window closes. Both are emitted together so the caller
 * never has to remember to come back for the second one — a carried balance
 * that silently never lapses is the failure mode firms actually hit.
 */
export function carryForwardPostings({ closingHalfDays, leaveYear, policy, todayKey }: CarryForwardInput): LeaveLedgerPosting[] {
  if (policy.carryForwardCap <= 0 || closingHalfDays <= 0) return [];
  const bounds = leaveYearBounds(leaveYear);
  if (todayKey < bounds.from) return [];
  const carried = Math.min(closingHalfDays, policy.carryForwardCap * HALF_DAYS_PER_DAY);
  if (carried <= 0) return [];

  const postings: LeaveLedgerPosting[] = [{
    dedupeKey: `carry_forward:${policy.code}:${leaveYear}`,
    effectiveDate: bounds.from,
    entryType: "carry_forward",
    halfDays: carried,
    leaveYear,
    reason: `Carried from ${previousLeaveYear(leaveYear)}`,
  }];

  if (policy.carryForwardExpiryMonths !== null) {
    const startYear = leaveYearStartYear(leaveYear);
    const zeroBased = 3 + policy.carryForwardExpiryMonths;
    const expiryYear = startYear + Math.floor(zeroBased / 12);
    const expiryMonth = (zeroBased % 12) + 1;
    const expiryDate = dateKeyOf(expiryYear, expiryMonth, 1);
    if (todayKey >= expiryDate) {
      postings.push({
        dedupeKey: `lapse:${policy.code}:${leaveYear}`,
        effectiveDate: expiryDate,
        entryType: "lapse",
        halfDays: -carried,
        leaveYear,
        reason: `Carried entitlement lapsed after ${policy.carryForwardExpiryMonths} month${policy.carryForwardExpiryMonths === 1 ? "" : "s"}`,
      });
    }
  }
  return postings;
}

/**
 * The lapse posting is sized against what was carried, not against what is left,
 * so an employee who has already spent the carried days is not driven negative.
 * Applied by the caller once the real balance is known.
 */
export function cappedLapse(posting: LeaveLedgerPosting, balanceHalfDays: number): LeaveLedgerPosting | null {
  if (posting.entryType !== "lapse") return posting;
  const removable = Math.min(-posting.halfDays, Math.max(0, balanceHalfDays));
  if (removable <= 0) return null;
  return { ...posting, halfDays: -removable };
}

export function balanceHalfDays(entries: ReadonlyArray<{ halfDays: number }>): number {
  return entries.reduce((total, entry) => total + entry.halfDays, 0);
}

export type QuotaAssessment = {
  /** Half-days the request would consume, per leave year it touches. */
  byLeaveYear: Array<{ halfDays: number; leaveYear: string }>;
  /** True when this type is uncapped, so nothing is enforced against it. */
  uncapped: boolean;
  balanceHalfDays: number;
  exceedsByHalfDays: number;
  requestedHalfDays: number;
  withinBalance: boolean;
};

export type QuotaAssessmentInput = {
  /** Balance in half-days for each leave year the request touches. */
  balances: ReadonlyArray<{ halfDays: number; leaveYear: string }>;
  consumption: ReadonlyArray<{ halfDays: number; leaveYear: string }>;
  policy: Pick<LeaveTypePolicy, "annualQuotaDays">;
};

/**
 * Whether a request fits inside what the employee has left.
 *
 * A quota of zero means the firm has chosen not to cap this type — the masters
 * screen labels it "0 = none" — so it must read as unlimited rather than as an
 * entitlement of nothing, which would refuse every request of that type.
 * Each leave year is judged on its own balance: a request spanning 31 March
 * cannot borrow next year's entitlement to cover this year's shortfall.
 */
export function assessQuota({ balances, consumption, policy }: QuotaAssessmentInput): QuotaAssessment {
  const requestedHalfDays = consumption.reduce((total, entry) => total + entry.halfDays, 0);
  const balanceTotal = balances.reduce((total, entry) => total + entry.halfDays, 0);
  if (policy.annualQuotaDays <= 0) {
    return {
      balanceHalfDays: balanceTotal,
      byLeaveYear: [...consumption],
      exceedsByHalfDays: 0,
      requestedHalfDays,
      uncapped: true,
      withinBalance: true,
    };
  }
  const balanceByYear = new Map(balances.map((entry) => [entry.leaveYear, entry.halfDays]));
  const shortfall = consumption.reduce((total, entry) => {
    const available = balanceByYear.get(entry.leaveYear) ?? 0;
    return total + Math.max(0, entry.halfDays - Math.max(0, available));
  }, 0);
  return {
    balanceHalfDays: balanceTotal,
    byLeaveYear: [...consumption],
    exceedsByHalfDays: shortfall,
    requestedHalfDays,
    uncapped: false,
    withinBalance: shortfall === 0,
  };
}

/** Half-days read back as the days a person actually talks in. */
export function formatHalfDays(halfDays: number): string {
  const days = halfDays / HALF_DAYS_PER_DAY;
  const rendered = Number.isInteger(days) ? String(days) : days.toFixed(1);
  return `${rendered} ${Math.abs(days) === 1 ? "day" : "days"}`;
}
