import assert from "node:assert/strict";
import test from "node:test";

import {
  bandFor,
  blockOf,
  computeStanding,
  CPE_CATEGORIES,
  CATEGORY_LABELS,
  formatHours,
  isCpeCategory,
  isLearningType,
  LEARNING_TYPES,
  parseHours,
  type CpePolicy,
  type TrainingEntry,
} from "../lib/training/cpe";

const hours = (value: number) => value * 60;

const policy = (over: Partial<CpePolicy> = {}): CpePolicy => ({
  blockStructuredMinutes: hours(60),
  blockTotalMinutes: hours(120),
  blockYears: 3,
  category: "in_practice",
  confirmed: true,
  effectiveFrom: "2024-01-01",
  yearlyStructuredMinutes: hours(20),
  yearlyTotalMinutes: hours(20),
  ...over,
});

const entry = (completedOn: string, minutes: number, learningType: TrainingEntry["learningType"] = "structured"): TrainingEntry =>
  ({ completedOn, learningType, minutes });

test("the block is the rolling window ending with the year", () => {
  assert.deepEqual(blockOf(2026, 3), [2024, 2025, 2026]);
  assert.deepEqual(blockOf(2026, 1), [2026]);
  assert.deepEqual(blockOf(2026, 5), [2022, 2023, 2024, 2025, 2026]);
});

test("a year is met when both the structured minimum and the total are reached", () => {
  const standing = computeStanding([
    entry("2026-03-01", hours(12)),
    entry("2026-07-01", hours(8)),
    entry("2026-08-01", hours(4), "unstructured"),
  ], policy(), 2026);
  assert.equal(standing.yearly.structuredMinutes, hours(20));
  assert.equal(standing.yearly.totalMinutes, hours(24));
  assert.equal(standing.yearly.compliant, true);
});

test("unstructured hours count towards the total but never the structured minimum", () => {
  const standing = computeStanding([
    entry("2026-03-01", hours(6)),
    entry("2026-07-01", hours(30), "unstructured"),
  ], policy(), 2026);
  assert.equal(standing.yearly.totalMinutes, hours(36), "the total is comfortably met");
  assert.equal(standing.yearly.structuredMinutes, hours(6));
  assert.equal(standing.yearly.structuredShortMinutes, hours(14));
  assert.equal(standing.yearly.compliant, false, "self-study cannot substitute for structured learning");
});

test("a course carries no CPE weight at all, not even towards the total", () => {
  const standing = computeStanding([
    entry("2026-03-01", hours(40), "course"),
  ], policy(), 2026);
  assert.equal(standing.yearly.totalMinutes, 0);
  assert.equal(standing.yearly.structuredMinutes, 0);
});

test("clearing the year says nothing about the block", () => {
  // Twenty structured hours this year and nothing before it: the year passes and
  // the three-year block does not. Reporting only the year would call this
  // member compliant, which is the failure the block requirement exists to catch.
  const standing = computeStanding([entry("2026-06-01", hours(20))], policy(), 2026);
  assert.equal(standing.yearly.compliant, true);
  assert.equal(standing.block.compliant, false);
  assert.equal(standing.block.structuredShortMinutes, hours(40));
  assert.equal(standing.compliant, false, "compliance needs both");
  assert.equal(bandFor(standing), "block_short");
});

test("the block reaches back exactly as far as it should, and no further", () => {
  const standing = computeStanding([
    entry("2023-06-01", hours(50)),
    entry("2024-06-01", hours(40)),
    entry("2025-06-01", hours(40)),
    entry("2026-06-01", hours(40)),
  ], policy(), 2026);
  assert.deepEqual(standing.blockYears, [2024, 2025, 2026]);
  assert.equal(standing.block.structuredMinutes, hours(120), "the 50 hours from 2023 are outside the block");
  assert.equal(standing.block.compliant, true, "120 clears both the structured floor and the block total");
  assert.equal(standing.blockLabel, "2024–2026");
});

test("the two failures are distinguished, because they call for different responses", () => {
  const both = computeStanding([], policy(), 2026);
  assert.equal(bandFor(both), "both_short");

  // 122 structured hours over the block clears both block minimums; two hours
  // this year clears neither of the yearly ones.
  const yearOnly = computeStanding([
    entry("2024-06-01", hours(60)),
    entry("2025-06-01", hours(60)),
    entry("2026-06-01", hours(2)),
  ], policy(), 2026);
  assert.equal(yearOnly.block.compliant, true);
  assert.equal(yearOnly.yearly.compliant, false);
  assert.equal(bandFor(yearOnly), "year_short");

  assert.equal(bandFor(null), "not_applicable");
});

test("a shortfall is what is owed, and never negative", () => {
  const over = computeStanding([entry("2026-01-01", hours(80))], policy(), 2026);
  assert.equal(over.yearly.structuredShortMinutes, 0);
  assert.equal(over.yearly.totalShortMinutes, 0);
});

test("an exempt member owes nothing and is satisfied by nothing", () => {
  const standing = computeStanding([], policy({
    blockStructuredMinutes: 0, blockTotalMinutes: 0, category: "exempt",
    yearlyStructuredMinutes: 0, yearlyTotalMinutes: 0,
  }), 2026);
  assert.equal(standing.compliant, true);
  assert.equal(bandFor(standing), "met");
});

test("hours go in and minutes are stored, refusing anything that is not a duration", () => {
  assert.equal(parseHours("6"), 360);
  assert.equal(parseHours("6.5"), 390);
  assert.equal(parseHours("0.5"), 30);
  assert.equal(parseHours(" 6h "), 360);
  assert.equal(parseHours("0"), null, "a session of no length is not a session");
  assert.equal(parseHours("-3"), null);
  assert.equal(parseHours("abc"), null);
  assert.equal(parseHours("99999"), null, "beyond any plausible course");
});

test("hours read back the way they were spoken", () => {
  assert.equal(formatHours(360), "6.0h");
  assert.equal(formatHours(390), "6.5h");
  assert.equal(formatHours(0), "0.0h");
});

test("only the listed types and categories are accepted", () => {
  assert.ok(isLearningType("structured"));
  assert.ok(!isLearningType("webinar"));
  assert.ok(isCpeCategory("in_practice"));
  assert.ok(!isCpeCategory("retired"));
  for (const category of CPE_CATEGORIES) assert.ok(CATEGORY_LABELS[category].length > 0);
  assert.equal(LEARNING_TYPES.length, 3);
});
