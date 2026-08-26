/**
 * Date arithmetic for the practice calendar.
 *
 * Every date in this module is a `YYYY-MM-DD` key in the firm's own timezone,
 * never a `Date`. The dashboard already settles what "today" is once, server
 * side, and hands it down; re-deriving it from the browser clock would put a
 * user in Dubai a day ahead of the deadline they are being shown.
 */

export const DAY_MS = 86_400_000;

const DATE_KEY_PATTERN = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Monday first: an Indian practice week runs Monday to Saturday. */
export const WEEKDAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function isDateKey(value: string): boolean {
  if (!DATE_KEY_PATTERN.test(value)) return false;
  // Rejects 2026-02-30, which the pattern alone accepts.
  return toUtc(value).toISOString().slice(0, 10) === value;
}

function toUtc(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function toKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function addDays(dateKey: string, days: number): string {
  return toKey(new Date(toUtc(dateKey).getTime() + days * DAY_MS));
}

/** Whole days from `fromKey` to `toKey`; negative when `toKey` is earlier. */
export function dayDifference(toKey_: string, fromKey: string): number {
  return Math.round((toUtc(toKey_).getTime() - toUtc(fromKey).getTime()) / DAY_MS);
}

/** 0 for Monday through 6 for Sunday. */
export function weekdayIndex(dateKey: string): number {
  return (toUtc(dateKey).getUTCDay() + 6) % 7;
}

export function startOfWeek(dateKey: string): string {
  return addDays(dateKey, -weekdayIndex(dateKey));
}

export function startOfMonth(dateKey: string): string {
  return `${dateKey.slice(0, 7)}-01`;
}

export function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

export function endOfMonth(dateKey: string): string {
  const [year, month] = dateKey.split("-").map(Number);
  return `${dateKey.slice(0, 7)}-${String(daysInMonth(year, month - 1)).padStart(2, "0")}`;
}

/**
 * Month stepping that clamps rather than overflowing. Stepping forward from
 * 31 January lands on 28 February, not on 3 March — a calendar that skips a
 * month when you press "next" is worse than no calendar.
 */
export function addMonths(dateKey: string, months: number): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const zeroBased = month - 1 + months;
  const targetYear = year + Math.floor(zeroBased / 12);
  const targetMonth = ((zeroBased % 12) + 12) % 12;
  const clamped = Math.min(day, daysInMonth(targetYear, targetMonth));
  return `${targetYear}-${String(targetMonth + 1).padStart(2, "0")}-${String(clamped).padStart(2, "0")}`;
}

/** Inclusive at both ends. Returns an empty list when the range is inverted. */
export function eachDay(fromKey: string, toKey_: string): string[] {
  const span = dayDifference(toKey_, fromKey);
  if (span < 0) return [];
  return Array.from({ length: span + 1 }, (_, index) => addDays(fromKey, index));
}

export function monthLabel(dateKey: string): string {
  const [year, month] = dateKey.split("-").map(Number);
  return `${MONTH_NAMES[month - 1]} ${year}`;
}

export function dayNumber(dateKey: string): number {
  return Number(dateKey.slice(8, 10));
}

export function shortMonth(dateKey: string): string {
  return MONTH_NAMES[Number(dateKey.slice(5, 7)) - 1].slice(0, 3).toUpperCase();
}

export function longDayLabel(dateKey: string): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  return `${day} ${MONTH_NAMES[month - 1]} ${year}`;
}

/**
 * "in 3 days" / "5 days ago", in the words a deadline is actually discussed in.
 */
export function relativeDayLabel(dateKey: string, todayKey: string): string {
  const days = dayDifference(dateKey, todayKey);
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days === -1) return "Yesterday";
  if (days < 0) return `${Math.abs(days)} days ago`;
  return `In ${days} days`;
}

/** Saturday is a working day in most Indian practices; Sunday is not. */
export function isWeekend(dateKey: string): boolean {
  return weekdayIndex(dateKey) === 6;
}
