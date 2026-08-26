/**
 * Turning recorded time into an invoice.
 *
 * Time was collected on one side of the system and invoices were typed on the
 * other, with nothing between them. A line said "GST compliance — November" and
 * an amount somebody decided on; whether it bore any relation to the 28 hours
 * recorded that month was a matter of the person's memory. The same hours could
 * be billed twice, or never, and neither would show.
 *
 * A line drafted from time carries the entries it consumed and what they were
 * worth at the rates in force. What the client is charged is a separate number,
 * and the gap between them is the write-down — the figure that tells a firm a
 * fixed fee is under water while there is still time to do something.
 */

export type BillableEntry = {
  /** Charge rate for this person on this client on this date, paise per hour. */
  chargePaisePerHour: number | null;
  employeeName: string;
  employeeUserId: string;
  entryDate: string;
  id: string;
  minutes: number;
  narration: string;
  /** Null where the entry is not against a specific obligation. */
  workItemId: string | null;
  workLabel: string | null;
};

/**
 * What one entry is worth. Rounded to the paise, once, at the entry.
 *
 * Rounding per entry rather than per line keeps a line's value equal to the sum
 * of the entries a reader can see under it. Rounding at the line total would
 * leave the two disagreeing by a paisa and nobody able to explain which is
 * wrong.
 */
export function entryValuePaise(entry: BillableEntry): number | null {
  if (entry.chargePaisePerHour === null) return null;
  return Math.round((entry.chargePaisePerHour * entry.minutes) / 60);
}

export type DraftLine = {
  /** Proposed charge. Starts equal to the value; a person may change it. */
  amountPaise: number;
  description: string;
  entryIds: string[];
  minutes: number;
  /** Entries with no rate, which contribute time but no value. */
  unratedCount: number;
  valuePaise: number;
  workItemId: string | null;
};

export type Draft = {
  lines: DraftLine[];
  /** Entries excluded because nobody has a rate for them. */
  unratedMinutes: number;
  totalMinutes: number;
  totalValuePaise: number;
};

/**
 * Group unbilled time into one line per obligation.
 *
 * Per obligation rather than per person: a client reads "GST · November 2026",
 * not a list of who did it. Who did it survives in the entries under the line,
 * which is where a partner reviewing realisation looks.
 *
 * An entry with no rate keeps its minutes but contributes no value, and its
 * line says so. Valuing it at zero would report a write-down the firm never
 * made, which is the wrong lesson from a missing rate.
 */
export function buildDraft(input: {
  entries: readonly BillableEntry[];
  fallbackLabel: string;
}): Draft {
  const groups = new Map<string, BillableEntry[]>();
  for (const entry of input.entries) {
    const key = entry.workItemId ?? "";
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }

  const lines: DraftLine[] = [];
  for (const [key, entries] of groups) {
    const minutes = entries.reduce((total, entry) => total + entry.minutes, 0);
    const valuePaise = entries.reduce((total, entry) => total + (entryValuePaise(entry) ?? 0), 0);
    const unratedCount = entries.filter((entry) => entry.chargePaisePerHour === null).length;
    lines.push({
      amountPaise: valuePaise,
      description: entries[0]?.workLabel ?? input.fallbackLabel,
      entryIds: entries.map((entry) => entry.id).sort(),
      minutes,
      unratedCount,
      valuePaise,
      workItemId: key || null,
    });
  }

  lines.sort((left, right) => left.description.localeCompare(right.description));
  return {
    lines,
    totalMinutes: lines.reduce((total, line) => total + line.minutes, 0),
    totalValuePaise: lines.reduce((total, line) => total + line.valuePaise, 0),
    unratedMinutes: input.entries
      .filter((entry) => entry.chargePaisePerHour === null)
      .reduce((total, entry) => total + entry.minutes, 0),
  };
}

/**
 * How far a line's charge may drift from its value before it needs explaining.
 *
 * A hundred rupees or one per cent, whichever is larger. Rounding a line to a
 * whole figure is not a write-down; demanding a reason for it would teach
 * everybody to type "rounding" and make the field worthless where it matters.
 */
export const WRITE_OFF_FLOOR_PAISE = 10_000;

export const writeOffTolerance = (valuePaise: number) =>
  Math.max(WRITE_OFF_FLOOR_PAISE, Math.floor(valuePaise / 100));

export const needsWriteOffReason = (input: { amountPaise: number; valuePaise: number | null }) =>
  input.valuePaise !== null && Math.abs(input.amountPaise - input.valuePaise) > writeOffTolerance(input.valuePaise);

export type Realisation = {
  chargedPaise: number;
  /** Negative is a write-down, positive a write-up. */
  differencePaise: number;
  /** Percentage of value actually charged, or null where nothing was worth anything. */
  percent: number | null;
  valuePaise: number;
};

export function realisationOf(lines: readonly { amountPaise: number; valuePaise: number | null }[]): Realisation {
  const timed = lines.filter((line) => line.valuePaise !== null);
  const valuePaise = timed.reduce((total, line) => total + (line.valuePaise ?? 0), 0);
  const chargedPaise = timed.reduce((total, line) => total + line.amountPaise, 0);
  return {
    chargedPaise,
    differencePaise: chargedPaise - valuePaise,
    percent: valuePaise > 0 ? Math.round((chargedPaise / valuePaise) * 100) : null,
    valuePaise,
  };
}

export type DraftRefusal = "no_unbilled_time" | "invalid_period" | "reason_required" | "negative_amount";

export const DRAFT_REFUSAL_NOTES: Record<DraftRefusal, string> = {
  invalid_period: "Enter a period that ends on or after it starts.",
  negative_amount: "A line cannot be charged at less than nothing.",
  no_unbilled_time: "There is no unbilled billable time for this client in that period.",
  reason_required: "Say why a line is being charged at less than the time is worth.",
};

export function refuseDraft(input: {
  entryCount: number;
  lines: readonly { amountPaise: number; valuePaise: number | null }[];
  periodFrom: string;
  periodTo: string;
}): DraftRefusal | null {
  const dates = /^\d{4}-\d{2}-\d{2}$/;
  if (!dates.test(input.periodFrom) || !dates.test(input.periodTo) || input.periodTo < input.periodFrom) return "invalid_period";
  if (input.entryCount === 0) return "no_unbilled_time";
  if (input.lines.some((line) => line.amountPaise < 0)) return "negative_amount";
  return null;
}

const rupees = (paise: number) => `₹${(Math.abs(paise) / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
const hours = (minutes: number) => `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;

/** `28:45 worth ₹41,700 · charged ₹35,000 · ₹6,700 written down (84%)`. */
export function realisationSummary(realisation: Realisation, minutes: number): string {
  const base = `${hours(minutes)} worth ${rupees(realisation.valuePaise)} · charged ${rupees(realisation.chargedPaise)}`;
  if (realisation.differencePaise === 0 || realisation.percent === null) return base;
  const direction = realisation.differencePaise < 0 ? "written down" : "written up";
  return `${base} · ${rupees(realisation.differencePaise)} ${direction} (${realisation.percent}%)`;
}

/** `GST · Nov 2026 — 20:30 at rate`. What a line says about itself. */
export function lineSummary(line: { minutes: number | null; unratedCount?: number }): string {
  if (line.minutes === null) return "";
  const unrated = line.unratedCount && line.unratedCount > 0
    ? ` · ${line.unratedCount} entr${line.unratedCount === 1 ? "y" : "ies"} with no rate`
    : "";
  return `${hours(line.minutes)} of recorded time${unrated}`;
}
