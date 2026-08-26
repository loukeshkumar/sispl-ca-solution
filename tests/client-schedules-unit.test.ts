import assert from "node:assert/strict";
import test from "node:test";

import {
  extendedDueDate,
  isScheduleMode,
  MODE_LABELS,
  refuseExtension,
  refuseOverride,
  resolveSchedule,
  ruleSummary,
  SCHEDULE_MODES,
  sourceSummary,
  type ClientScheduleOverride,
} from "../lib/compliance/client-schedules";
import { buildRecurringWorkDrafts, type ComplianceScheduleRule } from "../lib/compliance/recurrence";

const KOSHI = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const AARAV = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

/** The firm files GSTR-1 monthly, due on the 11th of the following month. */
const FIRM: ComplianceScheduleRule = {
  dueDay: 11, dueMonthOffset: 1, frequency: "monthly", internalLeadDays: 3, serviceCode: "GSTR1",
};

/** Koshi is on QRMP: quarterly, due on the 13th, with a longer internal lead. */
const QRMP: ComplianceScheduleRule = {
  dueDay: 13, dueMonthOffset: 1, frequency: "quarterly", internalLeadDays: 5, serviceCode: "GSTR1",
};

const override = (over: Partial<ClientScheduleOverride> = {}): ClientScheduleOverride => ({
  effectiveFrom: "2026-04-01",
  legalEntityId: KOSHI,
  mode: "override",
  rule: QRMP,
  serviceCode: "GSTR1",
  ...over,
});

const resolve = (legalEntityId: string, overrides: ClientScheduleOverride[], asOfKey = "2026-08-25") =>
  resolveSchedule({ asOfKey, firmRules: [FIRM], legalEntityId, overrides, serviceCode: "GSTR1" });

test("a client with nothing recorded follows the firm", () => {
  const resolved = resolve(AARAV, [override()]);
  assert.equal(resolved.source, "firm");
  assert.equal(resolved.rule?.frequency, "monthly");
  assert.equal(sourceSummary(resolved), "Follows the firm schedule");
});

test("a client with an override follows their own", () => {
  const resolved = resolve(KOSHI, [override()]);
  assert.equal(resolved.source, "client");
  assert.equal(resolved.rule?.frequency, "quarterly");
  assert.equal(resolved.rule?.dueDay, 13);
});

test("an override dated in the future does not govern yet", () => {
  // Recording it ahead of time is the point: it starts on the day, without
  // anybody having to remember to do anything.
  const resolved = resolve(KOSHI, [override({ effectiveFrom: "2026-12-01" })], "2026-08-25");
  assert.equal(resolved.source, "firm", "still monthly until December");
  assert.equal(resolve(KOSHI, [override({ effectiveFrom: "2026-12-01" })], "2026-12-01").source, "client");
});

test("the latest effective override wins, however the rows arrive", () => {
  const rows = [
    override({ effectiveFrom: "2026-07-01", rule: { ...QRMP, dueDay: 20 } }),
    override({ effectiveFrom: "2026-04-01" }),
    override({ effectiveFrom: "2027-01-01", rule: { ...QRMP, dueDay: 25 } }),
  ];
  assert.equal(resolve(KOSHI, rows, "2026-08-25").rule?.dueDay, 20);
  assert.equal(resolve(KOSHI, [...rows].reverse(), "2026-08-25").rule?.dueDay, 20, "row order changes nothing");
  assert.equal(resolve(KOSHI, rows, "2027-06-01").rule?.dueDay, 25);
});

test("a client can be returned to the firm calendar by a later exemption or override", () => {
  const rows = [override({ effectiveFrom: "2026-04-01" }), override({ effectiveFrom: "2026-07-01", mode: "exempt", rule: null })];
  const resolved = resolve(KOSHI, rows);
  assert.equal(resolved.source, "exempt");
  assert.equal(resolved.rule, null);
  assert.equal(sourceSummary(resolved), "Not applicable to this client");
});

test("a service the firm has no schedule for governs nobody", () => {
  const resolved = resolveSchedule({ asOfKey: "2026-08-25", firmRules: [], legalEntityId: AARAV, overrides: [], serviceCode: "GSTR9" });
  assert.equal(resolved.source, "none");
  assert.equal(resolved.rule, null);
});

test("an exemption stops generation even where the firm has a schedule", () => {
  const drafts = buildRecurringWorkDrafts({
    entitlements: [{ legalEntityId: KOSHI, serviceCode: "GSTR1" }, { legalEntityId: AARAV, serviceCode: "GSTR1" }],
    overrides: [override({ mode: "exempt", rule: null })],
    schedules: [FIRM],
    todayKey: "2026-08-25",
  });
  assert.ok(drafts.every((draft) => draft.legalEntityId === AARAV), "nothing raised for the exempt client");
  assert.ok(drafts.length > 0, "and the other client is unaffected");
});

test("two clients on the same service generate different periods and different dates", () => {
  // This is the finding: one calendar produced one answer for everybody.
  // The window is widened so both cadences fall due inside it — at the default
  // 45 days a quarterly period simply does not come round.
  const drafts = buildRecurringWorkDrafts({
    entitlements: [{ legalEntityId: KOSHI, serviceCode: "GSTR1" }, { legalEntityId: AARAV, serviceCode: "GSTR1" }],
    lookaheadDays: 200,
    overrides: [override()],
    schedules: [FIRM],
    todayKey: "2026-08-25",
  });
  const koshi = drafts.filter((draft) => draft.legalEntityId === KOSHI);
  const aarav = drafts.filter((draft) => draft.legalEntityId === AARAV);
  assert.ok(koshi.length > 0 && aarav.length > 0);
  assert.ok(koshi.every((draft) => /^Q\d/.test(draft.periodKey)), "Koshi files quarters");
  assert.ok(aarav.every((draft) => !/^Q\d/.test(draft.periodKey)), "Aarav files months");
  assert.ok(koshi.every((draft) => draft.statutoryDueDate.endsWith("-13")), "on the 13th");
  assert.ok(aarav.every((draft) => draft.statutoryDueDate.endsWith("-11")), "on the 11th");
  assert.equal(koshi[0]!.source, "client");
  assert.equal(aarav[0]!.source, "firm");
});

test("the internal lead is the client's own, not the firm's", () => {
  const drafts = buildRecurringWorkDrafts({
    entitlements: [{ legalEntityId: KOSHI, serviceCode: "GSTR1" }],
    lookaheadDays: 200,
    overrides: [override()],
    schedules: [FIRM],
    todayKey: "2026-08-25",
  });
  const draft = drafts[0]!;
  const days = Math.round((Date.parse(`${draft.statutoryDueDate}T00:00:00Z`) - Date.parse(`${draft.internalDueDate}T00:00:00Z`)) / 86_400_000);
  assert.equal(days, 5, "Koshi's five days, not the firm's three");
});

const EXTENSION = {
  extendedDueDate: "2027-01-31",
  legalEntityId: null,
  periodKey: "FY 2025–26",
  serviceCode: "GSTR9",
};

const due = (over: Partial<Parameters<typeof extendedDueDate>[0]> = {}) => extendedDueDate({
  extensions: [EXTENSION],
  legalEntityId: AARAV,
  periodKey: "FY 2025–26",
  serviceCode: "GSTR9",
  statutoryDueDate: "2026-12-31",
  ...over,
});

test("a class-wide extension moves the date for everybody filing that period", () => {
  assert.deepEqual(due(), { dueDate: "2027-01-31", extended: true });
  assert.deepEqual(due({ legalEntityId: KOSHI }), { dueDate: "2027-01-31", extended: true }, "including the client nobody got to");
});

test("an extension touches only the period and service it names", () => {
  assert.deepEqual(due({ periodKey: "FY 2026–27" }), { dueDate: "2026-12-31", extended: false });
  assert.deepEqual(due({ serviceCode: "GSTR1" }), { dueDate: "2026-12-31", extended: false });
  assert.deepEqual(due({ extensions: [] }), { dueDate: "2026-12-31", extended: false });
});

test("an extension granted to one client beats the general notification", () => {
  // A client who applied and got longer keeps their own date; the blanket one
  // is the more general fact and does not overwrite the particular.
  const both = due({
    extensions: [EXTENSION, { ...EXTENSION, extendedDueDate: "2027-03-31", legalEntityId: AARAV }],
  });
  assert.equal(both.dueDate, "2027-03-31");
  assert.equal(due({ extensions: [EXTENSION, { ...EXTENSION, extendedDueDate: "2027-03-31", legalEntityId: AARAV }], legalEntityId: KOSHI }).dueDate, "2027-01-31");
});

test("generation uses the extended date, and remembers the one it replaced", () => {
  const ANNUAL: ComplianceScheduleRule = { dueDay: 31, dueMonthOffset: 9, frequency: "annual", internalLeadDays: 10, serviceCode: "GSTR9" };
  const drafts = buildRecurringWorkDrafts({
    entitlements: [{ legalEntityId: AARAV, serviceCode: "GSTR9" }],
    extensions: [{ extendedDueDate: "2027-01-31", legalEntityId: null, periodKey: "FY 2025–26", serviceCode: "GSTR9" }],
    lookaheadDays: 400,
    schedules: [ANNUAL],
    todayKey: "2026-08-25",
  });
  const extended = drafts.find((draft) => draft.periodKey === "FY 2025–26");
  assert.ok(extended, "the period is generated");
  assert.equal(extended!.statutoryDueDate, "2027-01-31");
  assert.equal(extended!.originalStatutoryDueDate, "2026-12-31", "what it was before the notification");
  // Everything else keeps a null original, so "extended from" only appears where
  // something genuinely moved.
  assert.ok(drafts.filter((draft) => draft.periodKey !== "FY 2025–26").every((draft) => draft.originalStatutoryDueDate === null));
});

const raise = (over: Partial<Parameters<typeof refuseOverride>[0]> = {}) => refuseOverride({
  effectiveFrom: "2026-04-01",
  entitled: true,
  existingDates: [],
  firmRule: FIRM,
  mode: "override",
  rule: QRMP,
  ...over,
});

test("an override needs a client engaged for the service, a date, and a whole rule", () => {
  assert.equal(raise(), null);
  assert.equal(raise({ mode: "sometimes" }), "unknown_mode");
  assert.equal(raise({ effectiveFrom: "soon" }), "date_required");
  assert.equal(raise({ entitled: false }), "not_entitled");
  assert.equal(raise({ existingDates: ["2026-04-01"] }), "duplicate_date");
  assert.equal(raise({ rule: { ...QRMP, dueDay: undefined } }), "incomplete_rule");
  assert.equal(raise({ rule: { ...QRMP, frequency: "fortnightly" as never } }), "unknown_frequency");
  assert.equal(raise({ rule: { ...QRMP, dueDay: 0 } }), "invalid_day");
  assert.equal(raise({ rule: { ...QRMP, dueDay: 32 } }), "invalid_day");
  assert.equal(raise({ rule: { ...QRMP, internalLeadDays: 61 } }), "invalid_day");
});

test("an exemption needs no rule at all", () => {
  assert.equal(raise({ mode: "exempt", rule: null }), null);
  // And is still refused for a client who is not engaged for the service.
  assert.equal(raise({ entitled: false, mode: "exempt", rule: null }), "not_entitled");
});

test("an override identical to the firm rule is refused", () => {
  // Not wrong, invisible: the client silently stops following the firm, and a
  // later change to the firm schedule mysteriously misses them.
  assert.equal(raise({ rule: { ...FIRM } }), "same_as_firm");
  assert.equal(raise({ firmRule: null, rule: { ...FIRM } }), null, "with no firm rule there is nothing to duplicate");
});

const extend = (over: Partial<Parameters<typeof refuseExtension>[0]> = {}) => refuseExtension({
  authority: "CBIC Notification 12/2026",
  duplicate: false,
  extendedDueDate: "2027-01-31",
  knownService: true,
  originalDueDate: "2026-12-31",
  periodKey: "FY 2025–26",
  ...over,
});

test("an extension needs a service, a period, two dates and a citation", () => {
  assert.equal(extend(), null);
  assert.equal(extend({ knownService: false }), "unknown_service");
  assert.equal(extend({ periodKey: " " }), "period_required");
  assert.equal(extend({ originalDueDate: "" }), "date_required");
  assert.equal(extend({ extendedDueDate: "later" }), "date_required");
  assert.equal(extend({ authority: "" }), "authority_required");
  assert.equal(extend({ authority: "  " }), "authority_required");
  assert.equal(extend({ duplicate: true }), "duplicate");
});

test("a date moved earlier, or not at all, is not an extension", () => {
  assert.equal(extend({ extendedDueDate: "2026-11-30" }), "not_later");
  assert.equal(extend({ extendedDueDate: "2026-12-31" }), "not_later", "the same date moves nothing");
});

test("a rule reads as a sentence somebody would say", () => {
  assert.equal(ruleSummary(FIRM), "Monthly · due on the 11th of the following month · 3 days internal lead");
  assert.equal(ruleSummary(QRMP), "Quarterly · due on the 13th of the following month · 5 days internal lead");
  assert.equal(
    ruleSummary({ dueDay: 31, dueMonthOffset: 9, frequency: "annual", internalLeadDays: 1, serviceCode: "GSTR9" }),
    "Annual · due on the 31st of 9 months after · 1 day internal lead",
  );
  assert.equal(
    ruleSummary({ dueDay: 7, dueMonthOffset: 0, frequency: "monthly", internalLeadDays: 0, serviceCode: "TDS" }),
    "Monthly · due on the 7th of the same month · 0 days internal lead",
  );
  // 11th, 12th and 13th are the ones a naive ordinal gets wrong.
  for (const [day, expected] of [[11, "11th"], [12, "12th"], [13, "13th"], [21, "21st"], [22, "22nd"], [23, "23rd"]] as const) {
    assert.match(ruleSummary({ ...FIRM, dueDay: day }), new RegExp(`the ${expected} of`));
  }
});

test("modes are the listed ones and each reads as English", () => {
  assert.ok(isScheduleMode("exempt"));
  assert.ok(!isScheduleMode("skip"));
  for (const mode of SCHEDULE_MODES) assert.ok(MODE_LABELS[mode].length > 0);
});
