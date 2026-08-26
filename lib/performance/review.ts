/**
 * Performance reviews, and the evidence they rest on.
 *
 * The firm already recorded everything an honest appraisal needs — what was
 * delivered, what ran late, how much of the person's available time was sold,
 * whether the timesheet was filled in, what they were trained on and rated
 * capable of. None of it reached the conversation, so the conversation was
 * conducted from memory.
 *
 * Nothing here judges. It assembles what is true and leaves the judgement to
 * the reviewer, whose name goes on it.
 */

export type ReviewStatus = "draft" | "shared" | "acknowledged";

export const REVIEW_STATUSES: readonly ReviewStatus[] = ["draft", "shared", "acknowledged"];

export const STATUS_LABELS: Record<ReviewStatus, string> = {
  draft: "Draft",
  shared: "Shared",
  acknowledged: "Acknowledged",
};

export const STATUS_TONE: Record<ReviewStatus, "amber" | "blue" | "mint"> = {
  draft: "amber",
  shared: "blue",
  acknowledged: "mint",
};

export const isReviewStatus = (value: string): value is ReviewStatus =>
  (REVIEW_STATUSES as readonly string[]).includes(value);

/**
 * Three points, not five. A finer scale invites everybody to land in the middle
 * and turns the review into a negotiation about a number.
 */
export type Rating = "below" | "meets" | "exceeds";

export const RATINGS: readonly Rating[] = ["below", "meets", "exceeds"];

export const RATING_LABELS: Record<Rating, string> = {
  below: "Below expectations",
  meets: "Meets expectations",
  exceeds: "Exceeds expectations",
};

export const RATING_TONE: Record<Rating, "red" | "mint" | "blue"> = {
  below: "red",
  meets: "mint",
  exceeds: "blue",
};

export const isRating = (value: string): value is Rating => (RATINGS as readonly string[]).includes(value);

export type Dimension = "delivery" | "quality" | "capability" | "conduct";

export const DIMENSIONS: readonly Dimension[] = ["delivery", "quality", "capability", "conduct"];

export const DIMENSION_LABELS: Record<Dimension, string> = {
  delivery: "Delivery",
  quality: "Quality of work",
  capability: "Capability growth",
  conduct: "Conduct and teamwork",
};

/** What each dimension is asking about, so two reviewers mean the same thing. */
export const DIMENSION_PROMPTS: Record<Dimension, string> = {
  delivery: "Did the work get done, on time, in the volume the firm planned for?",
  quality: "Did it hold up on review, and did the firm have to redo any of it?",
  capability: "Is this person able to do more than they could at the start of the period?",
  conduct: "How do colleagues and clients find them to work with?",
};

export const isDimension = (value: string): value is Dimension =>
  (DIMENSIONS as readonly string[]).includes(value);

export type EvidenceTone = "good" | "neutral" | "concern";

export type EvidenceItem = {
  /** Where the number came from, so it can be checked rather than believed. */
  detail: string;
  id: string;
  label: string;
  tone: EvidenceTone;
  value: string;
};

export type EvidenceInput = {
  attendanceExceptions: number;
  availableMinutes: number;
  capabilityCounts: { learning: number; prepare: number; review: number; sign: number };
  chargeableMinutes: number;
  cpeBand: string | null;
  lateCount: number;
  overdueNow: number;
  recordedMinutes: number;
  reviewsPerformed: number;
  targetBasisPoints: number | null;
  trainingMinutes: number;
  workCompleted: number;
};

const hours = (minutes: number) => `${(minutes / 60).toFixed(1)}h`;
const percent = (basisPoints: number | null) => (basisPoints === null ? "—" : `${(basisPoints / 100).toFixed(1)}%`);

const shareBps = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 10_000) : null);

/**
 * The pack, in the order a reviewer would want to read it: what was sold, what
 * was recorded, what was delivered, what it cost the firm to correct, and what
 * the person can now do that they could not before.
 */
export function buildEvidence(input: EvidenceInput): EvidenceItem[] {
  const utilisationBps = shareBps(input.chargeableMinutes, input.availableMinutes);
  const recordingBps = shareBps(input.recordedMinutes, input.availableMinutes);
  const items: EvidenceItem[] = [];

  items.push({
    detail: input.targetBasisPoints === null
      ? "No utilisation target is set for this person or their role."
      : `${hours(input.chargeableMinutes)} chargeable of ${hours(input.availableMinutes)} available, against a target of ${percent(input.targetBasisPoints)}.`,
    id: "utilisation",
    label: "Utilisation",
    tone: utilisationBps === null || input.targetBasisPoints === null ? "neutral"
      : utilisationBps + 250 < input.targetBasisPoints ? "concern" : "good",
    value: input.targetBasisPoints === null ? percent(utilisationBps) : `${percent(utilisationBps)} v ${percent(input.targetBasisPoints)}`,
  });

  items.push({
    // Everything else in the pack is understated while this is short, so it is
    // stated next to them rather than left for somebody to remember.
    detail: `${hours(input.recordedMinutes)} recorded of ${hours(input.availableMinutes)} available. Unrecorded time understates everything below.`,
    id: "timesheet",
    label: "Timesheet",
    tone: recordingBps === null ? "neutral" : recordingBps < 7_500 ? "concern" : "good",
    value: percent(recordingBps),
  });

  items.push({
    detail: `${input.workCompleted} obligations completed in the period. ${input.overdueNow} assigned to them are overdue today.`,
    id: "delivery",
    label: "Work delivered",
    tone: input.overdueNow > 0 ? "concern" : "good",
    value: `${input.workCompleted} done · ${input.overdueNow} overdue`,
  });

  items.push({
    detail: `Signed off ${input.reviewsPerformed} obligations as reviewer. Reviewing is how a firm gets a second pair of eyes onto work.`,
    id: "reviews",
    label: "Reviews performed",
    tone: "neutral",
    value: String(input.reviewsPerformed),
  });

  const capable = input.capabilityCounts.prepare + input.capabilityCounts.review + input.capabilityCounts.sign;
  items.push({
    detail: `${input.capabilityCounts.sign} can sign, ${input.capabilityCounts.review} can review, ${input.capabilityCounts.prepare} can prepare, ${input.capabilityCounts.learning} still learning.`,
    id: "capability",
    label: "Capability",
    tone: capable === 0 ? "concern" : "good",
    value: `${capable} service${capable === 1 ? "" : "s"}`,
  });

  items.push({
    detail: input.cpeBand
      ? `${hours(input.trainingMinutes)} of training logged in the period. CPE standing: ${input.cpeBand}.`
      : `${hours(input.trainingMinutes)} of training logged in the period. No CPE obligation.`,
    id: "training",
    label: "Training",
    tone: input.trainingMinutes === 0 ? "concern" : "good",
    value: hours(input.trainingMinutes),
  });

  items.push({
    detail: `${input.attendanceExceptions} unexplained absences or missing punches, and ${input.lateCount} late arrivals in the period.`,
    id: "attendance",
    label: "Attendance",
    tone: input.attendanceExceptions > 0 ? "concern" : "good",
    value: `${input.attendanceExceptions} exception${input.attendanceExceptions === 1 ? "" : "s"}`,
  });

  return items;
}

export type RatingEntry = { dimension: Dimension; note: string; rating: Rating };

/** True once every dimension has been rated; a review is not a partial opinion. */
export const allDimensionsRated = (entries: readonly RatingEntry[]) =>
  DIMENSIONS.every((dimension) => entries.some((entry) => entry.dimension === dimension));

export type ShareBlocker = "dimensions" | "overall" | "notes";

export const SHARE_BLOCKER_NOTES: Record<ShareBlocker, string> = {
  dimensions: "Rate every dimension before sharing.",
  overall: "Give an overall rating before sharing.",
  notes: "Write something under strengths and development before sharing.",
};

/**
 * What still stops this review being shown to the person it is about.
 *
 * A review shared half-written is worse than one not yet shared: the employee
 * reads the gaps as the judgement.
 */
export function shareBlockers(input: {
  development: string;
  entries: readonly RatingEntry[];
  overallRating: string | null;
  strengths: string;
}): ShareBlocker[] {
  const blockers: ShareBlocker[] = [];
  if (!allDimensionsRated(input.entries)) blockers.push("dimensions");
  if (!input.overallRating || !isRating(input.overallRating)) blockers.push("overall");
  if (input.strengths.trim().length < 3 || input.development.trim().length < 3) blockers.push("notes");
  return blockers;
}

/** Half-year periods, which is how most firms actually run reviews. */
export function defaultPeriod(todayKey: string): { periodFrom: string; periodTo: string } {
  const year = Number(todayKey.slice(0, 4));
  const month = Number(todayKey.slice(5, 7));
  return month >= 4 && month <= 9
    ? { periodFrom: `${year}-04-01`, periodTo: `${year}-09-30` }
    : month > 9
      ? { periodFrom: `${year}-10-01`, periodTo: `${year + 1}-03-31` }
      : { periodFrom: `${year - 1}-10-01`, periodTo: `${year}-03-31` };
}

export const periodLabel = (from: string, to: string) => {
  const format = (value: string) => new Intl.DateTimeFormat("en-IN", { month: "short", timeZone: "UTC", year: "numeric" })
    .format(new Date(`${value}T00:00:00Z`));
  return `${format(from)} – ${format(to)}`;
};

/** Calendar months a period spans, for the monthly figures it aggregates. */
export function monthsInPeriod(from: string, to: string): string[] {
  const months: string[] = [];
  let year = Number(from.slice(0, 4));
  let month = Number(from.slice(5, 7));
  const lastYear = Number(to.slice(0, 4));
  const lastMonth = Number(to.slice(5, 7));
  for (let guard = 0; guard < 240; guard += 1) {
    if (year > lastYear || (year === lastYear && month > lastMonth)) break;
    months.push(`${year}-${String(month).padStart(2, "0")}`);
    month += 1;
    if (month > 12) { month = 1; year += 1; }
  }
  return months;
}
