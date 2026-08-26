import assert from "node:assert/strict";
import test from "node:test";

import {
  allDimensionsRated,
  buildEvidence,
  defaultPeriod,
  DIMENSION_LABELS,
  DIMENSION_PROMPTS,
  DIMENSIONS,
  isDimension,
  isRating,
  isReviewStatus,
  monthsInPeriod,
  periodLabel,
  RATING_LABELS,
  RATINGS,
  shareBlockers,
  type EvidenceInput,
  type RatingEntry,
} from "../lib/performance/review";

const hours = (value: number) => value * 60;

const evidence = (over: Partial<EvidenceInput> = {}): EvidenceInput => ({
  attendanceExceptions: 0,
  availableMinutes: hours(1000),
  capabilityCounts: { learning: 1, prepare: 2, review: 1, sign: 0 },
  chargeableMinutes: hours(800),
  cpeBand: null,
  lateCount: 0,
  overdueNow: 0,
  recordedMinutes: hours(950),
  reviewsPerformed: 4,
  targetBasisPoints: 8000,
  trainingMinutes: hours(12),
  workCompleted: 9,
  ...over,
});

const find = (items: ReturnType<typeof buildEvidence>, id: string) => items.find((item) => item.id === id)!;

test("the pack states utilisation against the target, not on its own", () => {
  const items = buildEvidence(evidence());
  assert.equal(find(items, "utilisation").value, "80.0% v 80.0%");
  assert.equal(find(items, "utilisation").tone, "good");
});

test("utilisation short of target by more than tolerance reads as a concern", () => {
  const items = buildEvidence(evidence({ chargeableMinutes: hours(400) }));
  assert.equal(find(items, "utilisation").tone, "concern");
  assert.match(find(items, "utilisation").detail, /against a target of 80\.0%/);
});

test("without a target, utilisation is reported and not judged", () => {
  // A number with nothing to measure it against is not evidence of anything.
  const items = buildEvidence(evidence({ targetBasisPoints: null }));
  assert.equal(find(items, "utilisation").tone, "neutral");
  assert.match(find(items, "utilisation").detail, /No utilisation target is set/);
});

test("an unfilled timesheet is flagged next to the figures it undermines", () => {
  const items = buildEvidence(evidence({ recordedMinutes: hours(500) }));
  const timesheet = find(items, "timesheet");
  assert.equal(timesheet.tone, "concern");
  assert.match(timesheet.detail, /understates everything below/);
});

test("overdue work is a concern however much was completed", () => {
  const busy = buildEvidence(evidence({ overdueNow: 3, workCompleted: 40 }));
  assert.equal(find(busy, "delivery").tone, "concern");
  assert.match(find(busy, "delivery").value, /40 done · 3 overdue/);

  const clean = buildEvidence(evidence({ overdueNow: 0, workCompleted: 2 }));
  assert.equal(find(clean, "delivery").tone, "good");
});

test("no capability at all is a concern; reviewing is reported without judgement", () => {
  const none = buildEvidence(evidence({ capabilityCounts: { learning: 3, prepare: 0, review: 0, sign: 0 } }));
  assert.equal(find(none, "capability").tone, "concern");
  assert.equal(find(none, "capability").value, "0 services");

  // How much somebody reviews is a fact about their role, not their performance.
  assert.equal(find(none, "reviews").tone, "neutral");
});

test("no training in a whole period is a concern, whether or not CPE applies", () => {
  const untrained = buildEvidence(evidence({ cpeBand: null, trainingMinutes: 0 }));
  assert.equal(find(untrained, "training").tone, "concern");
  assert.match(find(untrained, "training").detail, /No CPE obligation/);

  const member = buildEvidence(evidence({ cpeBand: "Short over the block", trainingMinutes: hours(6) }));
  assert.match(find(member, "training").detail, /CPE standing: Short over the block/);
});

test("every evidence item explains where its number came from", () => {
  for (const item of buildEvidence(evidence())) {
    assert.ok(item.detail.length > 0, `${item.id} must be checkable, not merely believable`);
    assert.ok(item.label.length > 0);
    assert.ok(item.value.length > 0);
  }
});

test("a review is not shareable until every dimension is rated", () => {
  const partial: RatingEntry[] = [
    { dimension: "delivery", note: "", rating: "meets" },
    { dimension: "quality", note: "", rating: "below" },
  ];
  assert.equal(allDimensionsRated(partial), false);
  const blockers = shareBlockers({ development: "Fine", entries: partial, overallRating: "meets", strengths: "Good" });
  assert.deepEqual(blockers, ["dimensions"]);
});

test("a review is not shareable without an overall rating or written notes", () => {
  const full: RatingEntry[] = DIMENSIONS.map((dimension) => ({ dimension, note: "", rating: "meets" as const }));
  assert.equal(allDimensionsRated(full), true);

  assert.deepEqual(
    shareBlockers({ development: "Fine", entries: full, overallRating: null, strengths: "Good" }),
    ["overall"],
  );
  // A review shared half-written reads to the employee as the judgement.
  assert.deepEqual(
    shareBlockers({ development: "  ", entries: full, overallRating: "meets", strengths: "Good" }),
    ["notes"],
  );
  assert.deepEqual(
    shareBlockers({ development: "Work on timesheets", entries: full, overallRating: "meets", strengths: "Reliable" }),
    [],
  );
});

test("an invalid overall rating is refused rather than quietly accepted", () => {
  const full: RatingEntry[] = DIMENSIONS.map((dimension) => ({ dimension, note: "", rating: "meets" as const }));
  assert.deepEqual(
    shareBlockers({ development: "x", entries: full, overallRating: "outstanding", strengths: "y" }),
    ["overall", "notes"],
  );
});

test("periods default to the half-year the firm is in", () => {
  assert.deepEqual(defaultPeriod("2026-08-24"), { periodFrom: "2026-04-01", periodTo: "2026-09-30" });
  assert.deepEqual(defaultPeriod("2026-11-02"), { periodFrom: "2026-10-01", periodTo: "2027-03-31" });
  assert.deepEqual(defaultPeriod("2026-02-14"), { periodFrom: "2025-10-01", periodTo: "2026-03-31" });
});

test("a period enumerates every month it touches, and stops", () => {
  assert.deepEqual(monthsInPeriod("2026-04-01", "2026-09-30"), ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"]);
  assert.deepEqual(monthsInPeriod("2026-12-01", "2027-02-28"), ["2026-12", "2027-01", "2027-02"]);
  assert.deepEqual(monthsInPeriod("2026-04-10", "2026-04-20"), ["2026-04"]);
  assert.deepEqual(monthsInPeriod("2026-09-01", "2026-04-01"), [], "a period that runs backwards is no period");
});

test("periods and ratings read as English", () => {
  // en-IN abbreviates September as "Sept"; the label follows the locale rather
  // than a hand-written month table.
  assert.equal(periodLabel("2026-04-01", "2026-09-30"), "Apr 2026 – Sept 2026");
  assert.equal(periodLabel("2026-10-01", "2027-03-31"), "Oct 2026 – Mar 2027");
  for (const rating of RATINGS) assert.ok(RATING_LABELS[rating].length > 0);
  for (const dimension of DIMENSIONS) {
    assert.ok(DIMENSION_LABELS[dimension].length > 0);
    // Two reviewers should mean the same thing by the same word.
    assert.ok(DIMENSION_PROMPTS[dimension].endsWith("?"));
  }
});

test("only the listed dimensions, ratings and statuses are accepted", () => {
  assert.ok(isDimension("quality"));
  assert.ok(!isDimension("attitude"));
  assert.ok(isRating("below"));
  assert.ok(!isRating("terrible"));
  assert.ok(isReviewStatus("shared"));
  assert.ok(!isReviewStatus("published"));
});
