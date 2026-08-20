const DAY_MS = 86_400_000;

/** The mask is Monday-first, one character per weekday, '1' meaning a working day. */
export function workingDaysInMask(mask: string) {
  return [...mask].filter((day) => day === "1").length;
}

export function weeklyAvailableMinutes(fullDayMinutes: number, mask: string) {
  return fullDayMinutes * workingDaysInMask(mask);
}

/**
 * Effort still to come, not effort estimated. A job at 90% stops consuming a
 * full job's capacity. An unbudgeted job contributes nothing — the lane reports
 * its unbudgeted count separately rather than guessing a number here, because a
 * fabricated zero reads as "this person is free".
 */
export function remainingBudgetMinutes(budgetMinutes: number | null, progress: number) {
  if (budgetMinutes === null) return 0;
  return Math.round((budgetMinutes * (100 - progress)) / 100);
}

/** Parsed at midnight UTC so a week boundary does not move with the reader's timezone. */
export function weekStartKey(dateKey: string) {
  const date = new Date(`${dateKey}T00:00:00Z`);
  const weekday = (date.getUTCDay() + 6) % 7;
  return new Date(date.valueOf() - weekday * DAY_MS).toISOString().slice(0, 10);
}

export function capacityHorizonWeeks(todayKey: string, weeks: number) {
  const start = Date.parse(`${weekStartKey(todayKey)}T00:00:00Z`);
  return Array.from({ length: weeks }, (_unused, index) => new Date(start + index * 7 * DAY_MS).toISOString().slice(0, 10));
}

/** Null when the obligation is unbudgeted, so the row can say "no budget" rather than "0%". */
export function burnPercentage(loggedMinutes: number, budgetMinutes: number | null) {
  if (budgetMinutes === null || budgetMinutes <= 0) return null;
  return Math.round((loggedMinutes / budgetMinutes) * 100);
}
