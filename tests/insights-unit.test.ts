import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPracticeSignals,
  detectClientRisk,
  detectOverdueObligations,
  detectReceivablesAgeing,
  detectRegisterRisk,
  detectUnassignedWork,
  detectUtilisationGap,
  type SignalInputs,
} from "../lib/insights/signals";
import { summariseFirm, type PersonUtilisation } from "../lib/rates/utilisation";

const TODAY = "2026-08-17";

const empty: SignalInputs = {
  workItems: [], invoices: [], clients: [], timeEntries: [], certificates: [], notices: [], todayKey: TODAY,
};

const work = (overrides: Partial<SignalInputs["workItems"][number]> = {}) => ({
  id: "11111111-1111-4111-8111-111111111111",
  clientName: "Aurora Textiles",
  serviceKey: "gstr_3b",
  periodKey: "July 2026",
  statutoryDueDate: "2026-08-20",
  status: "at_risk",
  assigneeName: "Nisha S.",
  ...overrides,
});

test("a quiet practice raises no signals at all", () => {
  assert.deepEqual(buildPracticeSignals(empty), []);
});

test("overdue obligations group by service and escalate with slippage", () => {
  const mild = detectOverdueObligations({ ...empty, workItems: [work({ statutoryDueDate: "2026-08-10" })] });
  assert.equal(mild.length, 1);
  assert.equal(mild[0].severity, "warning");
  assert.match(mild[0].detail, /7 days overdue/);
  assert.match(mild[0].evidence, /Aurora Textiles/);

  const severe = detectOverdueObligations({ ...empty, workItems: [work({ statutoryDueDate: "2026-07-20" })] });
  assert.equal(severe[0].severity, "critical");
});

test("completed and future obligations never appear as overdue", () => {
  const signals = detectOverdueObligations({
    ...empty,
    workItems: [work({ statutoryDueDate: "2026-07-01", status: "completed" }), work({ statutoryDueDate: "2026-09-30" })],
  });
  assert.deepEqual(signals, []);
});

test("unassigned work escalates when a deadline is within a week", () => {
  const distant = detectUnassignedWork({ ...empty, workItems: [work({ assigneeName: null, statutoryDueDate: "2026-10-01" })] });
  assert.equal(distant[0].severity, "warning");
  const imminent = detectUnassignedWork({ ...empty, workItems: [work({ assigneeName: null, statutoryDueDate: "2026-08-20" })] });
  assert.equal(imminent[0].severity, "critical");
  assert.match(imminent[0].evidence, /due 2026-08-20/);
});

test("receivables report the worst ageing bucket that actually has invoices", () => {
  const invoice = (id: string, dueDate: string, totalPaise = 100_000) => ({
    id, invoiceNumber: `INV-${id}`, clientName: "Aurora Textiles", totalPaise, dueDate, status: "issued",
  });
  const ninety = detectReceivablesAgeing({ ...empty, invoices: [invoice("1", "2026-05-01"), invoice("2", "2026-08-01")] });
  assert.equal(ninety[0].id, "receivables-90");
  assert.equal(ninety[0].severity, "critical");

  const thirty = detectReceivablesAgeing({ ...empty, invoices: [invoice("3", "2026-07-10")] });
  assert.equal(thirty[0].id, "receivables-30");
  assert.equal(thirty[0].severity, "warning");

  const recent = detectReceivablesAgeing({ ...empty, invoices: [invoice("4", "2026-08-15")] });
  assert.equal(recent[0].severity, "info");
});

test("invoices that are issued but not yet due are not receivables signals", () => {
  assert.deepEqual(detectReceivablesAgeing({
    ...empty,
    invoices: [{ id: "1", invoiceNumber: "INV-1", clientName: "Aurora", totalPaise: 100_000, dueDate: "2026-09-30", status: "issued" }],
  }), []);
});

test("client risk names the lowest-scoring relationship", () => {
  const signals = detectClientRisk({
    ...empty,
    clients: [
      { id: "a", name: "Aurora Textiles", healthScore: 41, riskStatus: "critical", openObligations: 3 },
      { id: "b", name: "Koshi Infra", healthScore: 28, riskStatus: "critical", openObligations: 5 },
      { id: "c", name: "Neelam Foods", healthScore: 88, riskStatus: "healthy", openObligations: 1 },
    ],
  });
  assert.equal(signals.length, 1);
  assert.match(signals[0].title, /2 client relationships/);
  assert.match(signals[0].evidence, /Koshi Infra at 28\/100/);
});

const person = (over: Partial<PersonUtilisation> = {}): PersonUtilisation => ({
  availableMinutes: 9_000, band: "on_target", chargeableMinutes: 7_200,
  employeeUserId: "a", fullName: "Asha", leaveMinutes: 0, missingMinutes: 0,
  recordedMinutes: 9_000, recordingBps: 10_000, roleKey: "associate",
  scheduledMinutes: 9_000, targetBasisPoints: 8_000, targetSource: "role",
  utilisationBps: 8_000, varianceBps: 0,
  ...over,
});

test("a team that all under-records is caught, which the median never could", () => {
  // The old measure compared people to each other, so a firm where everybody
  // recorded half their month had a perfectly healthy median and said nothing.
  const utilisation = summariseFirm([
    person({ employeeUserId: "a", fullName: "Asha", recordedMinutes: 4_000, missingMinutes: 5_000 }),
    person({ employeeUserId: "b", fullName: "Bhavna", recordedMinutes: 4_200, missingMinutes: 4_800 }),
    person({ employeeUserId: "c", fullName: "Chetan", recordedMinutes: 4_100, missingMinutes: 4_900 }),
  ]);
  const signals = detectUtilisationGap({ ...empty, utilisation });
  const unrecorded = signals.find((signal) => signal.id === "utilisation-unrecorded");
  assert.ok(unrecorded, "three people missing half their month is the finding");
  assert.equal(unrecorded.severity, "warning");
  assert.match(unrecorded.evidence, /Asha/);
});

test("being below target is reported against the target, not against colleagues", () => {
  const utilisation = summariseFirm([
    person({ employeeUserId: "a", fullName: "Asha", band: "under", utilisationBps: 5_000, varianceBps: -3_000, chargeableMinutes: 4_500 }),
    person({ employeeUserId: "b", fullName: "Bhavna" }),
  ]);
  const signals = detectUtilisationGap({ ...empty, utilisation });
  const below = signals.find((signal) => signal.id === "utilisation-below-target");
  assert.ok(below);
  assert.match(below.evidence, /Asha at 50\.0% against a target of 80\.0%/);
});

test("nobody being measured is itself the finding", () => {
  const utilisation = summariseFirm([
    person({ band: "unmeasured", targetBasisPoints: null, targetSource: "none", varianceBps: null }),
  ]);
  const signals = detectUtilisationGap({ ...empty, utilisation });
  assert.ok(signals.some((signal) => signal.id === "utilisation-no-target"));
});

test("a firm with no measurement at all stays quiet rather than guessing", () => {
  assert.deepEqual(detectUtilisationGap({ ...empty, utilisation: null }), []);
  assert.deepEqual(detectUtilisationGap({ ...empty, utilisation: summariseFirm([]) }), []);
});

test("expired certificates and lapsed notices are both critical register signals", () => {
  const signals = detectRegisterRisk({
    ...empty,
    certificates: [
      { id: "1", holderName: "Asha Menon", serialNumber: "EMU-1", validUntil: "2026-06-30", status: "in_custody" },
      { id: "2", holderName: "Ravi Kumar", serialNumber: "EMU-2", validUntil: "2027-01-01", status: "in_custody" },
    ],
    notices: [{ id: "3", noticeNumber: "ITBA/1", clientName: "Aurora", responseDueDate: "2026-08-01", status: "open" }],
  });
  assert.equal(signals.length, 2);
  assert.ok(signals.every((signal) => signal.severity === "critical"));
  assert.match(signals[0].evidence, /EMU-1/);
  assert.match(signals[1].evidence, /ITBA\/1/);
});

test("signals are ordered with the most severe first and every one cites its evidence", () => {
  const signals = buildPracticeSignals({
    ...empty,
    workItems: [work({ statutoryDueDate: "2026-07-01" }), work({ id: "22222222-2222-4222-8222-222222222222", assigneeName: null, statutoryDueDate: "2026-11-01" })],
    invoices: [{ id: "1", invoiceNumber: "INV-1", clientName: "Aurora", totalPaise: 500_000, dueDate: "2026-08-14", status: "issued" }],
  });
  assert.ok(signals.length >= 3);
  const ranks = { critical: 0, warning: 1, info: 2 } as const;
  for (let index = 1; index < signals.length; index += 1) {
    assert.ok(ranks[signals[index - 1].severity] <= ranks[signals[index].severity], "signals must be ordered by severity");
  }
  assert.ok(signals.every((signal) => signal.evidence.length > 0), "every signal must cite verifiable evidence");
  assert.ok(signals.every((signal) => signal.id.length > 0));
});
