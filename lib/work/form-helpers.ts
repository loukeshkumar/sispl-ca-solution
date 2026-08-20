import type { WorkInput } from "./validation";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const DAY_MS = 86_400_000;

/**
 * India's statutory year runs April to March, so a January filing belongs to
 * the financial year that opened the previous April. Calendar-year arithmetic
 * mislabels a whole quarter.
 */
export function financialYearLabel(dateKey: string) {
  const date = new Date(`${dateKey}T00:00:00Z`);
  const startYear = date.getUTCMonth() >= 3 ? date.getUTCFullYear() : date.getUTCFullYear() - 1;
  return `FY ${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}

/** Statutory quarters: Apr-Jun is Q1, so the calendar quarter is off by one. */
function statutoryQuarter(dateKey: string) {
  const month = new Date(`${dateKey}T00:00:00Z`).getUTCMonth();
  return Math.floor(((month + 9) % 12) / 3) + 1;
}

export type PeriodPreset = { key: string; label: string; value: string };

export function periodPresets(todayKey: string): PeriodPreset[] {
  const date = new Date(`${todayKey}T00:00:00Z`);
  const financialYear = financialYearLabel(todayKey);
  return [
    { key: "month", label: "This month", value: `${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}` },
    { key: "quarter", label: "This quarter", value: `Q${statutoryQuarter(todayKey)} - ${financialYear}` },
    { key: "year", label: "This FY", value: financialYear },
  ];
}

export type BufferTone = "none" | "ok" | "tight" | "invalid";
export type BufferState = { days: number | null; label: string; tone: BufferTone };

const isDateKey = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);

/**
 * How much slack the firm gave itself before the statutory date, surfaced while
 * typing. The database enforces the ordering too, but a check constraint only
 * speaks after a round trip.
 */
export function bufferState(statutoryDueDate: string, internalDueDate: string): BufferState {
  if (!isDateKey(statutoryDueDate) || !isDateKey(internalDueDate)) return { days: null, label: "", tone: "none" };
  const days = Math.round((Date.parse(`${statutoryDueDate}T00:00:00Z`) - Date.parse(`${internalDueDate}T00:00:00Z`)) / DAY_MS);
  if (days < 0) return { days, label: "Internal date is after the statutory deadline", tone: "invalid" };
  if (days === 0) return { days, label: "Same day as the statutory deadline", tone: "tight" };
  return {
    days,
    label: `${days} day${days === 1 ? "" : "s"} internal buffer`,
    tone: days < 3 ? "tight" : "ok",
  };
}

/** Minutes as a person says them: 90 is "1h 30m", never "1.5h" or "90 minutes". */
export function minutesLabel(minutes: number | null) {
  if (minutes === null || !Number.isFinite(minutes) || minutes <= 0) return "";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest}m`;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

/** The tone of the badge this status will produce, shown before it is committed. */
export function workStatusTone(status: WorkInput["status"] | string) {
  return ({ critical: "red", at_risk: "amber", waiting: "blue", review: "mint" } as const)[status as WorkInput["status"]] ?? "blue";
}

/**
 * An empty service list has two causes needing two different fixes: pick a
 * client, or give that client a package. One message for both sends people
 * looking in the wrong place.
 */
export function servicePlaceholder(hasClient: boolean, serviceCount: number) {
  if (!hasClient) return "Select a client first";
  if (!serviceCount) return "This client's package includes no services";
  return "";
}
