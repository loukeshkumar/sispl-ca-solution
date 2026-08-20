export const todoRecurrenceRules = ["day", "week", "month"] as const;
export type TodoRecurrenceRule = typeof todoRecurrenceRules[number];

const DAY_MS = 86_400_000;
const isDateKey = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);

const lastDayOfMonth = (year: number, monthIndex: number) => new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();

/**
 * The next occurrence after `dueDate`, or null when the input cannot produce
 * one. Returns null rather than a guess: a caller that silently invents a date
 * would schedule a reminder nobody asked for.
 *
 * Month arithmetic clamps to the last day of the target month — 31 January plus
 * a month is 28 February, not 3 March. Rolling forward would push a monthly
 * reminder progressively later every year.
 */
export function nextDueDate(dueDate: string, rule: TodoRecurrenceRule, interval: number): string | null {
  if (!isDateKey(dueDate)) return null;
  if (!Number.isInteger(interval) || interval < 1 || interval > 365) return null;
  if (!todoRecurrenceRules.includes(rule)) return null;

  const date = new Date(`${dueDate}T00:00:00Z`);
  if (Number.isNaN(date.valueOf())) return null;

  if (rule === "day") return new Date(date.valueOf() + interval * DAY_MS).toISOString().slice(0, 10);
  if (rule === "week") return new Date(date.valueOf() + interval * 7 * DAY_MS).toISOString().slice(0, 10);

  const targetMonth = date.getUTCMonth() + interval;
  const year = date.getUTCFullYear() + Math.floor(targetMonth / 12);
  const monthIndex = ((targetMonth % 12) + 12) % 12;
  const targetLastDay = lastDayOfMonth(year, monthIndex);
  // A date that sits on its own month end means "the last day of the month", so
  // it recurs to the next month end. Without this, clamping compounds: 31 Jan
  // becomes 28 Feb, then 28 Mar, then 28 Apr, and a month-end reminder silently
  // walks backwards forever.
  const onMonthEnd = date.getUTCDate() === lastDayOfMonth(date.getUTCFullYear(), date.getUTCMonth());
  const day = onMonthEnd ? targetLastDay : Math.min(date.getUTCDate(), targetLastDay);
  return new Date(Date.UTC(year, monthIndex, day)).toISOString().slice(0, 10);
}

export type LoadStripDay = { count: number; dateKey: string };

/**
 * How many of the viewer's own dated to-dos land on each day of the horizon.
 * Undated items have no day to sit on, and anything beyond the horizon is
 * dropped rather than piled onto the final cell, which would misread as a spike.
 */
export function buildLoadStrip(items: Array<{ dueDate: string | null }>, todayKey: string, days: number): LoadStripDay[] {
  const start = Date.parse(`${todayKey}T00:00:00Z`);
  const counts = new Map<string, number>();
  for (const item of items) {
    if (!item.dueDate) continue;
    counts.set(item.dueDate, (counts.get(item.dueDate) ?? 0) + 1);
  }
  return Array.from({ length: days }, (_unused, index) => {
    const dateKey = new Date(start + index * DAY_MS).toISOString().slice(0, 10);
    return { count: counts.get(dateKey) ?? 0, dateKey };
  });
}
