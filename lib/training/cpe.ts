/**
 * Continuing education: what a member owes, and what they have done.
 *
 * A member's CPE obligation is tested twice over, and the two fail
 * independently: a minimum each calendar year, and a larger minimum over a
 * rolling block of years. Reporting only the year is how somebody who has
 * cleared this year and is short across the block gets called compliant.
 *
 * The hour requirements are the firm's, held against the current ICAI
 * announcement. They are not written into this module for the same reason the
 * articleship figures are not: a number nobody can correct goes stale silently.
 */

const MINUTES_PER_HOUR = 60;

export type LearningType = "structured" | "unstructured" | "course";

export const LEARNING_TYPES: readonly LearningType[] = ["structured", "unstructured", "course"];

export const LEARNING_LABELS: Record<LearningType, string> = {
  structured: "Structured",
  unstructured: "Unstructured",
  course: "Course (no CPE weight)",
};

export const LEARNING_NOTES: Record<LearningType, string> = {
  structured: "Seminars, conferences and other organised learning that counts towards the structured minimum.",
  unstructured: "Self-study, in-house reading and discussion. Counts towards the total, not the structured minimum.",
  course: "Training that carries no CPE weight — an orientation programme, or a session for staff who are not members.",
};

export const isLearningType = (value: string): value is LearningType =>
  (LEARNING_TYPES as readonly string[]).includes(value);

export type CpeCategory = "in_practice" | "not_in_practice" | "exempt";

export const CPE_CATEGORIES: readonly CpeCategory[] = ["in_practice", "not_in_practice", "exempt"];

export const CATEGORY_LABELS: Record<CpeCategory, string> = {
  in_practice: "Member in practice",
  not_in_practice: "Member not in practice",
  exempt: "Exempt",
};

export const isCpeCategory = (value: string): value is CpeCategory =>
  (CPE_CATEGORIES as readonly string[]).includes(value);

export type CpePolicy = {
  blockStructuredMinutes: number;
  blockTotalMinutes: number;
  blockYears: number;
  category: CpeCategory;
  confirmed: boolean;
  effectiveFrom: string;
  yearlyStructuredMinutes: number;
  yearlyTotalMinutes: number;
};

export type TrainingEntry = {
  completedOn: string;
  learningType: LearningType;
  minutes: number;
};

export const yearOf = (dateKey: string) => Number(dateKey.slice(0, 4));

/** The rolling block ending with `year`, oldest first. */
export function blockOf(year: number, blockYears: number): number[] {
  const length = Math.max(1, blockYears);
  return Array.from({ length }, (_unused, index) => year - (length - 1) + index);
}

export type PeriodStanding = {
  compliant: boolean;
  structuredMinutes: number;
  structuredRequiredMinutes: number;
  /** Minutes still owed. Zero once met, never negative. */
  structuredShortMinutes: number;
  totalMinutes: number;
  totalRequiredMinutes: number;
  totalShortMinutes: number;
};

function standing(
  entries: readonly TrainingEntry[],
  structuredRequiredMinutes: number,
  totalRequiredMinutes: number,
): PeriodStanding {
  // A `course` carries no CPE weight, so it is excluded from both figures
  // rather than counted towards the total.
  const counting = entries.filter((entry) => entry.learningType !== "course");
  const structuredMinutes = counting
    .filter((entry) => entry.learningType === "structured")
    .reduce((total, entry) => total + entry.minutes, 0);
  const totalMinutes = counting.reduce((total, entry) => total + entry.minutes, 0);
  const structuredShortMinutes = Math.max(0, structuredRequiredMinutes - structuredMinutes);
  const totalShortMinutes = Math.max(0, totalRequiredMinutes - totalMinutes);
  return {
    compliant: structuredShortMinutes === 0 && totalShortMinutes === 0,
    structuredMinutes,
    structuredRequiredMinutes,
    structuredShortMinutes,
    totalMinutes,
    totalRequiredMinutes,
    totalShortMinutes,
  };
}

export type CpeStanding = {
  block: PeriodStanding;
  blockLabel: string;
  blockYears: number[];
  /** True only when both the year and the block are satisfied. */
  compliant: boolean;
  year: number;
  yearly: PeriodStanding;
};

/**
 * A member's standing at the end of `year`.
 *
 * Both periods are computed from the same log; the block simply reaches further
 * back. Compliance requires both, because clearing one says nothing about the
 * other.
 */
export function computeStanding(
  entries: readonly TrainingEntry[],
  policy: CpePolicy,
  year: number,
): CpeStanding {
  const years = blockOf(year, policy.blockYears);
  const inYear = entries.filter((entry) => yearOf(entry.completedOn) === year);
  const inBlock = entries.filter((entry) => {
    const entryYear = yearOf(entry.completedOn);
    return entryYear >= years[0]! && entryYear <= years[years.length - 1]!;
  });

  const yearly = standing(inYear, policy.yearlyStructuredMinutes, policy.yearlyTotalMinutes);
  const block = standing(inBlock, policy.blockStructuredMinutes, policy.blockTotalMinutes);
  return {
    block,
    blockLabel: years.length === 1 ? String(years[0]) : `${years[0]}–${years[years.length - 1]}`,
    blockYears: years,
    compliant: yearly.compliant && block.compliant,
    year,
    yearly,
  };
}

export type StandingBand = "not_applicable" | "met" | "year_short" | "block_short" | "both_short";

/**
 * Which of the two tests failed, because they call for different responses:
 * a short year can still be fixed this year, and a short block usually cannot.
 */
export function bandFor(standing: CpeStanding | null): StandingBand {
  if (!standing) return "not_applicable";
  if (standing.yearly.compliant && standing.block.compliant) return "met";
  if (!standing.yearly.compliant && !standing.block.compliant) return "both_short";
  return standing.yearly.compliant ? "block_short" : "year_short";
}

export const BAND_LABELS: Record<StandingBand, string> = {
  not_applicable: "No obligation",
  met: "Met",
  year_short: "Short this year",
  block_short: "Short over the block",
  both_short: "Short on both",
};

export const BAND_TONE: Record<StandingBand, "mint" | "amber" | "red" | "neutral"> = {
  not_applicable: "neutral",
  met: "mint",
  year_short: "amber",
  block_short: "red",
  both_short: "red",
};

export const BAND_NOTES: Record<StandingBand, string> = {
  not_applicable: "Not a member, or exempt. Training is still recorded.",
  met: "Both the year and the rolling block are satisfied.",
  year_short: "This year is short. There is still time in the year to close it.",
  block_short: "The rolling block is short even though this year is met. Earlier years cannot be redone.",
  both_short: "Short this year and across the block.",
};

/** Hours, to one decimal. CPE is spoken about in hours and counted in halves. */
export const hoursOf = (minutes: number) => minutes / MINUTES_PER_HOUR;
export const formatHours = (minutes: number) => `${hoursOf(minutes).toFixed(1)}h`;

/** Hours in, minutes stored. Rejects anything that is not a clean half-hour step. */
export function parseHours(raw: string): number | null {
  const cleaned = raw.replace(/[hH\s]/g, "");
  if (!/^\d{1,4}(\.\d{1,2})?$/.test(cleaned)) return null;
  const minutes = Math.round(Number(cleaned) * MINUTES_PER_HOUR);
  return minutes >= 1 && minutes <= 12_000 ? minutes : null;
}
