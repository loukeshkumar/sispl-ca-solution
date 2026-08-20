export type ComplianceFrequency = "monthly" | "quarterly" | "annual";

export type ComplianceScheduleRule = {
  serviceCode: string;
  frequency: ComplianceFrequency;
  dueMonthOffset: number;
  dueDay: number;
  internalLeadDays: number;
};

export type EntitledService = {
  legalEntityId: string;
  serviceCode: string;
};

export type RecurringWorkDraft = {
  legalEntityId: string;
  serviceKey: string;
  periodKey: string;
  statutoryDueDate: string;
  internalDueDate: string;
  status: "waiting";
  blockerNote: string;
};

const MONTH_LABELS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DEFAULT_LOOKAHEAD_DAYS = 45;

type PeriodEnd = { year: number; month: number };

function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function toDateKey(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function addDaysToDateKey(dateKey: string, days: number) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

function addMonthsClamped(periodEnd: PeriodEnd, monthOffset: number, day: number) {
  const zeroBased = periodEnd.month - 1 + monthOffset;
  const year = periodEnd.year + Math.floor(zeroBased / 12);
  const month = (zeroBased % 12) + 1;
  return toDateKey(year, month, Math.min(day, daysInMonth(year, month)));
}

function shortFinancialYearLabel(fyStartYear: number) {
  return `FY ${String(fyStartYear).slice(2)}–${String(fyStartYear + 1).slice(2)}`;
}

export function periodLabel(frequency: ComplianceFrequency, periodEnd: PeriodEnd) {
  if (frequency === "monthly") return `${MONTH_LABELS[periodEnd.month - 1]} ${periodEnd.year}`;
  if (frequency === "quarterly") {
    const quarterByMonth: Record<number, number> = { 6: 1, 9: 2, 12: 3, 3: 4 };
    const fyStartYear = periodEnd.month === 3 ? periodEnd.year - 1 : periodEnd.year;
    return `Q${quarterByMonth[periodEnd.month]} · ${shortFinancialYearLabel(fyStartYear)}`;
  }
  return `FY ${periodEnd.year - 1}–${String(periodEnd.year).slice(2)}`;
}

function candidatePeriodEnds(frequency: ComplianceFrequency, todayKey: string): PeriodEnd[] {
  const [todayYear, todayMonth] = todayKey.split("-").map(Number);
  const ends: PeriodEnd[] = [];
  if (frequency === "monthly") {
    for (let offset = 14; offset >= 0; offset -= 1) {
      const zeroBased = todayMonth - 1 - offset;
      ends.push({ year: todayYear + Math.floor(zeroBased / 12), month: ((zeroBased % 12) + 12) % 12 + 1 });
    }
    return ends;
  }
  if (frequency === "quarterly") {
    for (let offset = 5; offset >= 0; offset -= 1) {
      const zeroBased = Math.floor((todayMonth - 1) / 3) * 3 + 2 - offset * 3;
      ends.push({ year: todayYear + Math.floor(zeroBased / 12), month: ((zeroBased % 12) + 12) % 12 + 1 });
    }
    return ends.filter((end) => [3, 6, 9, 12].includes(end.month));
  }
  return [
    { year: todayYear - 1, month: 3 },
    { year: todayYear, month: 3 },
    { year: todayYear + 1, month: 3 },
  ];
}

export function buildRecurringWorkDrafts(input: {
  schedules: ComplianceScheduleRule[];
  entitlements: EntitledService[];
  todayKey: string;
  lookaheadDays?: number;
  /**
   * Earliest statutory due date to produce. Defaults to today, which is what
   * generation wants: it never back-fills a deadline that has already passed.
   * Coverage reporting passes an earlier date to find obligations that were
   * never raised, using this same period arithmetic so it can never report a
   * gap the generator would not have created.
   */
  fromKey?: string;
}): RecurringWorkDraft[] {
  const lookahead = input.lookaheadDays ?? DEFAULT_LOOKAHEAD_DAYS;
  const horizonKey = addDaysToDateKey(input.todayKey, lookahead);
  const fromKey = input.fromKey ?? input.todayKey;
  const entitlementsByCode = new Map<string, string[]>();
  for (const entitlement of input.entitlements) {
    const code = entitlement.serviceCode.toUpperCase();
    entitlementsByCode.set(code, [...(entitlementsByCode.get(code) ?? []), entitlement.legalEntityId]);
  }
  const drafts: RecurringWorkDraft[] = [];
  const seen = new Set<string>();
  for (const schedule of input.schedules) {
    const entityIds = entitlementsByCode.get(schedule.serviceCode.toUpperCase()) ?? [];
    if (entityIds.length === 0) continue;
    for (const periodEnd of candidatePeriodEnds(schedule.frequency, input.todayKey)) {
      const statutoryDueDate = addMonthsClamped(periodEnd, schedule.dueMonthOffset, schedule.dueDay);
      if (statutoryDueDate < fromKey || statutoryDueDate > horizonKey) continue;
      const key = periodLabel(schedule.frequency, periodEnd);
      const internalDueDate = addDaysToDateKey(statutoryDueDate, -schedule.internalLeadDays);
      for (const legalEntityId of entityIds) {
        const dedupe = `${legalEntityId}:${schedule.serviceCode.toUpperCase()}:${key}`;
        if (seen.has(dedupe)) continue;
        seen.add(dedupe);
        drafts.push({
          legalEntityId,
          serviceKey: schedule.serviceCode.toUpperCase(),
          periodKey: key,
          statutoryDueDate,
          internalDueDate: internalDueDate < statutoryDueDate ? internalDueDate : statutoryDueDate,
          status: "waiting",
          blockerNote: "Awaiting client information for this period.",
        });
      }
    }
  }
  return drafts;
}
