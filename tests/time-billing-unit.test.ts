import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDraft,
  entryValuePaise,
  lineSummary,
  needsWriteOffReason,
  realisationOf,
  realisationSummary,
  refuseDraft,
  WRITE_OFF_FLOOR_PAISE,
  writeOffTolerance,
  type BillableEntry,
} from "../lib/billing/time-billing";

const VIKRAM = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const NISHA = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const GST = "11111111-1111-4111-8111-111111111111";
const TDS = "22222222-2222-4222-8222-222222222222";

/** ₹1,200 an hour for Vikram, ₹2,400 for Nisha. */
const entry = (over: Partial<BillableEntry> = {}): BillableEntry => ({
  chargePaisePerHour: 120_000,
  employeeName: "Vikram R.",
  employeeUserId: VIKRAM,
  entryDate: "2026-11-10",
  id: "e1",
  minutes: 60,
  narration: "Reconciled 2B",
  workItemId: GST,
  workLabel: "GST · Nov 2026",
  ...over,
});

test("an hour at the rate is the rate", () => {
  assert.equal(entryValuePaise(entry()), 120_000);
  assert.equal(entryValuePaise(entry({ minutes: 30 })), 60_000);
  assert.equal(entryValuePaise(entry({ minutes: 90 })), 180_000);
});

test("an entry with no rate is worth nothing rather than zero", () => {
  // Valuing it at zero would report a write-down the firm never made, which is
  // the wrong lesson to draw from a missing rate.
  assert.equal(entryValuePaise(entry({ chargePaisePerHour: null })), null);
});

test("odd minutes round once, at the entry", () => {
  // Rounding here rather than at the line keeps a line's value equal to the sum
  // of the entries a reader can see under it.
  assert.equal(entryValuePaise(entry({ chargePaisePerHour: 100_000, minutes: 7 })), 11_667);
  const draft = buildDraft({
    entries: [
      entry({ chargePaisePerHour: 100_000, id: "a", minutes: 7 }),
      entry({ chargePaisePerHour: 100_000, id: "b", minutes: 7 }),
      entry({ chargePaisePerHour: 100_000, id: "c", minutes: 7 }),
    ],
    fallbackLabel: "Advisory",
  });
  assert.equal(draft.lines[0]!.valuePaise, 35_001, "three rounded entries, summed");
});

test("time is grouped into one line per obligation", () => {
  const draft = buildDraft({
    entries: [
      entry({ id: "a", minutes: 870 }),
      entry({ chargePaisePerHour: 240_000, employeeName: "Nisha S.", employeeUserId: NISHA, id: "b", minutes: 360 }),
      entry({ id: "c", minutes: 495, workItemId: TDS, workLabel: "TDS · Q3" }),
    ],
    fallbackLabel: "Advisory",
  });
  assert.equal(draft.lines.length, 2, "two obligations, two lines");
  const gst = draft.lines.find((line) => line.workItemId === GST)!;
  assert.equal(gst.minutes, 1230, "14:30 and 6:00");
  assert.equal(gst.valuePaise, 1_740_000 + 1_440_000, "₹17,400 plus ₹14,400");
  assert.deepEqual(gst.entryIds, ["a", "b"], "the entries it consumed, named");
  assert.equal(draft.totalMinutes, 1725);
  assert.equal(draft.totalValuePaise, 3_180_000 + 990_000);
});

test("a line's proposed charge starts at the value, not at nothing", () => {
  const draft = buildDraft({ entries: [entry()], fallbackLabel: "Advisory" });
  assert.equal(draft.lines[0]!.amountPaise, draft.lines[0]!.valuePaise);
});

test("time against no obligation becomes one line under the fallback label", () => {
  const draft = buildDraft({
    entries: [entry({ id: "a", workItemId: null, workLabel: null }), entry({ id: "b", workItemId: null, workLabel: null })],
    fallbackLabel: "General advisory · November 2026",
  });
  assert.equal(draft.lines.length, 1);
  assert.equal(draft.lines[0]!.description, "General advisory · November 2026");
  assert.equal(draft.lines[0]!.workItemId, null);
});

test("unrated time keeps its minutes and its line says so", () => {
  const draft = buildDraft({
    entries: [entry({ id: "a" }), entry({ chargePaisePerHour: null, id: "b", minutes: 120 })],
    fallbackLabel: "Advisory",
  });
  const line = draft.lines[0]!;
  assert.equal(line.minutes, 180, "the time is real whether or not it is priced");
  assert.equal(line.valuePaise, 120_000, "only the rated hour has value");
  assert.equal(line.unratedCount, 1);
  assert.equal(draft.unratedMinutes, 120);
  assert.match(lineSummary(line), /3:00 of recorded time · 1 entry with no rate/);
});

test("lines come back in a stable order however the entries arrive", () => {
  const entries = [
    entry({ id: "z", workItemId: TDS, workLabel: "TDS · Q3" }),
    entry({ id: "a" }),
  ];
  assert.deepEqual(
    buildDraft({ entries, fallbackLabel: "x" }).lines.map((line) => line.description),
    ["GST · Nov 2026", "TDS · Q3"],
  );
  assert.deepEqual(
    buildDraft({ entries: [...entries].reverse(), fallbackLabel: "x" }).lines.map((line) => line.description),
    ["GST · Nov 2026", "TDS · Q3"],
  );
});

test("nothing to bill produces nothing", () => {
  const draft = buildDraft({ entries: [], fallbackLabel: "x" });
  assert.deepEqual(draft.lines, []);
  assert.equal(draft.totalValuePaise, 0);
});

test("rounding a line to a whole figure is not a write-down", () => {
  // Demanding a reason for it would teach everybody to type "rounding" and make
  // the field worthless where it matters.
  assert.equal(writeOffTolerance(3_180_000), 31_800, "one per cent");
  assert.equal(writeOffTolerance(100_000), WRITE_OFF_FLOOR_PAISE, "the floor on a small line");
  assert.equal(needsWriteOffReason({ amountPaise: 3_150_000, valuePaise: 3_180_000 }), false);
  assert.equal(needsWriteOffReason({ amountPaise: 3_100_000, valuePaise: 3_180_000 }), true);
});

test("a write-up needs explaining as much as a write-down", () => {
  assert.equal(needsWriteOffReason({ amountPaise: 4_000_000, valuePaise: 3_180_000 }), true);
});

test("a line with no value never needs a write-off reason", () => {
  assert.equal(needsWriteOffReason({ amountPaise: 5_000_000, valuePaise: null }), false);
});

test("realisation is charge against value, and only for lines made of time", () => {
  const realisation = realisationOf([
    { amountPaise: 2_500_000, valuePaise: 3_180_000 },
    { amountPaise: 990_000, valuePaise: 990_000 },
    // A package fee is not measured effort and must not dilute the percentage.
    { amountPaise: 5_000_000, valuePaise: null },
  ]);
  assert.equal(realisation.valuePaise, 4_170_000);
  assert.equal(realisation.chargedPaise, 3_490_000);
  assert.equal(realisation.differencePaise, -680_000);
  assert.equal(realisation.percent, 84);
});

test("a write-up reads as a write-up", () => {
  const realisation = realisationOf([{ amountPaise: 4_000_000, valuePaise: 3_180_000 }]);
  assert.ok(realisation.differencePaise > 0);
  assert.match(realisationSummary(realisation, 1230), /written up \(126%\)/);
});

test("realisation of nothing is not zero per cent", () => {
  const realisation = realisationOf([{ amountPaise: 100, valuePaise: null }]);
  assert.equal(realisation.percent, null, "nothing was worth anything, so nothing was realised");
  assert.equal(realisationSummary(realisation, 0), "0:00 worth ₹0 · charged ₹0");
});

test("the summary says the hours, the worth and the gap", () => {
  const realisation = realisationOf([{ amountPaise: 3_500_000, valuePaise: 4_170_000 }]);
  assert.equal(
    realisationSummary(realisation, 1725),
    "28:45 worth ₹41,700 · charged ₹35,000 · ₹6,700 written down (84%)",
  );
});

const draft = (over: Partial<Parameters<typeof refuseDraft>[0]> = {}) => refuseDraft({
  entryCount: 12,
  lines: [{ amountPaise: 2_500_000, valuePaise: 3_180_000 }],
  periodFrom: "2026-11-01",
  periodTo: "2026-11-30",
  ...over,
});

test("a draft needs a period and some unbilled time", () => {
  assert.equal(draft(), null);
  assert.equal(draft({ periodTo: "2026-10-01" }), "invalid_period");
  assert.equal(draft({ periodFrom: "" }), "invalid_period");
  assert.equal(draft({ periodFrom: "2026-11-01", periodTo: "2026-11-01" }), null, "a single day is a period");
  assert.equal(draft({ entryCount: 0 }), "no_unbilled_time");
});

test("a line cannot be charged at less than nothing", () => {
  assert.equal(draft({ lines: [{ amountPaise: -1, valuePaise: 100 }] }), "negative_amount");
  assert.equal(draft({ lines: [{ amountPaise: 0, valuePaise: 3_180_000 }] }), null, "written off entirely is allowed");
});
