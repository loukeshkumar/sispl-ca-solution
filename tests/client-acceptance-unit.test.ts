import assert from "node:assert/strict";
import test from "node:test";

import {
  ACCEPTANCE_LABELS,
  acceptanceSummary,
  CHECK_KEYS,
  CHECK_LABELS,
  CHECK_NOTES,
  coveringLetter,
  isCheckKey,
  isCheckOutcome,
  LETTER_LABELS,
  letterSummary,
  MANDATORY_CHECKS,
  OUTCOME_LABELS,
  refuseCheck,
  refuseDecision,
  refuseLetter,
  standingOf,
  type AcceptanceCheck,
  type EngagementLetter,
} from "../lib/clients/acceptance";

const NISHA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const VIKRAM = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PRIYA = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const check = (over: Partial<AcceptanceCheck> = {}): AcceptanceCheck => ({
  checkKey: "conflict",
  checkedOn: "2026-12-08",
  note: "",
  outcome: "cleared",
  ...over,
});

const allMandatory = MANDATORY_CHECKS.map((checkKey) => check({ checkKey }));

test("a client with nothing recorded has every mandatory check outstanding", () => {
  const standing = standingOf({ checks: [], status: "in_progress" });
  assert.deepEqual(standing.missing, [...MANDATORY_CHECKS]);
  assert.equal(standing.ready, false);
  assert.equal(acceptanceSummary(standing), "4 checks outstanding");
});

test("communication with the outgoing auditor is offered, not demanded", () => {
  // A first-time engagement has no outgoing auditor, and demanding a row would
  // teach people to mark it not applicable without reading it.
  assert.ok(!MANDATORY_CHECKS.includes("predecessor"));
  assert.ok(CHECK_KEYS.includes("predecessor"));
  const standing = standingOf({ checks: allMandatory, status: "in_progress" });
  assert.equal(standing.ready, true, "ready without it");
});

test("every mandatory check answered makes a client ready to decide", () => {
  const standing = standingOf({ checks: allMandatory, status: "in_progress" });
  assert.deepEqual(standing.missing, []);
  assert.equal(acceptanceSummary(standing), "Every mandatory check answered — ready to decide");
});

test("a concern is surfaced, never buried, and never blocks on its own", () => {
  // Firms do take on clients with a known issue and manage it. What must not
  // happen is the issue disappearing.
  const standing = standingOf({
    checks: [...allMandatory.slice(1), check({ checkKey: "conflict", note: "Acts for a competitor", outcome: "concern" })],
    status: "in_progress",
  });
  assert.deepEqual(standing.concerns, ["conflict"]);
  assert.equal(standing.ready, true, "answered is answered");
  assert.match(acceptanceSummary(standing), /1 concern noted/);
});

test("a decided client is no longer in progress", () => {
  const accepted = standingOf({ checks: allMandatory, status: "accepted" });
  assert.equal(accepted.ready, false);
  assert.equal(acceptanceSummary(accepted), "Accepted");
  assert.equal(acceptanceSummary(standingOf({ checks: [], status: "declined" })), "Declined");
});

const record = (over: Partial<Parameters<typeof refuseCheck>[0]> = {}) => refuseCheck({
  acceptanceStatus: "in_progress",
  checkKey: "kyc",
  checkedOn: "2026-12-08",
  note: "",
  outcome: "cleared",
  ...over,
});

test("a check needs a known key, an outcome and a date", () => {
  assert.equal(record(), null);
  assert.equal(record({ checkKey: "vibes" }), "unknown_check");
  assert.equal(record({ outcome: "probably" }), "unknown_outcome");
  assert.equal(record({ checkedOn: "" }), "date_required");
  assert.equal(record({ checkedOn: "December" }), "date_required");
});

test("anything other than a clean pass has to say what it found", () => {
  assert.equal(record({ outcome: "concern" }), "note_required");
  assert.equal(record({ note: "  ", outcome: "not_applicable" }), "note_required");
  assert.equal(record({ note: "First-time engagement, no outgoing auditor", outcome: "not_applicable" }), null);
  assert.equal(record({ note: "", outcome: "cleared" }), null, "a clean pass needs no essay");
});

test("checks cannot be recorded once the firm has decided", () => {
  assert.equal(record({ acceptanceStatus: "accepted" }), "already_decided");
  assert.equal(record({ acceptanceStatus: "declined" }), "already_decided");
});

const decide = (over: Partial<Parameters<typeof refuseDecision>[0]> = {}) => refuseDecision({
  actorUserId: PRIYA,
  checkerUserIds: [NISHA, VIKRAM],
  outcome: "accepted",
  reason: "",
  standing: standingOf({ checks: allMandatory, status: "in_progress" }),
  ...over,
});

test("a client with every check answered can be accepted", () => {
  assert.equal(decide(), null);
});

test("a client with checks outstanding cannot be accepted", () => {
  assert.equal(
    decide({ standing: standingOf({ checks: allMandatory.slice(1), status: "in_progress" }) }),
    "checks_outstanding",
  );
});

test("a client can always be declined, and declining says why", () => {
  // Declining early, before every check is done, is exactly what happens when
  // the first check finds something.
  const barely = standingOf({ checks: [], status: "in_progress" });
  assert.equal(decide({ outcome: "declined", reason: "Conflict with an existing audit client", standing: barely }), null);
  assert.equal(decide({ outcome: "declined", reason: "", standing: barely }), "reason_required");
});

test("the person who did all the checking cannot accept on their own checks", () => {
  // Acceptance is a partner satisfying themselves that somebody else's work
  // supports taking the client on. One person doing both is the same word twice.
  assert.equal(decide({ actorUserId: NISHA, checkerUserIds: [NISHA] }), "self_check");
  assert.equal(decide({ actorUserId: NISHA, checkerUserIds: [NISHA, NISHA] }), "self_check");
  assert.equal(decide({ actorUserId: NISHA, checkerUserIds: [NISHA, VIKRAM] }), null, "somebody else checked too");
  assert.equal(decide({ actorUserId: NISHA, checkerUserIds: [] }), null, "no checks recorded is a different refusal");
});

test("a decision cannot be taken twice, or be a word that is not a decision", () => {
  assert.equal(decide({ standing: standingOf({ checks: allMandatory, status: "accepted" }) }), "already_decided");
  assert.equal(decide({ outcome: "maybe" }), "unknown_outcome");
});

const letter = (over: Partial<EngagementLetter> = {}): EngagementLetter => ({
  id: "letter-1",
  periodFrom: "2026-04-01",
  periodTo: "2027-03-31",
  serviceCodes: ["GST", "BOOKS"],
  signedOn: "2026-04-11",
  status: "signed",
  ...over,
});

const cover = (over: Partial<Parameters<typeof coveringLetter>[0]> = {}) => coveringLetter({
  dateKey: "2026-11-20",
  letters: [letter()],
  serviceCode: "GST",
  ...over,
});

test("a signed letter covering the service and the date is cover", () => {
  assert.equal(cover()?.id, "letter-1");
  assert.equal(cover({ serviceCode: "gst" })?.id, "letter-1", "codes match case-insensitively");
});

test("a letter issued and never returned is not cover", () => {
  // The firm's intention, not the client's agreement. Treating it as cover is
  // exactly the assumption that goes wrong when it matters.
  assert.equal(cover({ letters: [letter({ signedOn: null, status: "issued" })] }), null);
  assert.equal(cover({ letters: [letter({ signedOn: null, status: "draft" })] }), null);
  assert.equal(cover({ letters: [letter({ status: "superseded" })] }), null);
});

test("a letter that does not name the service is not cover for it", () => {
  assert.equal(cover({ serviceCode: "AUDIT" }), null);
});

test("a letter whose period has not started, or has ended, is not cover", () => {
  assert.equal(cover({ dateKey: "2026-03-31" }), null);
  assert.equal(cover({ dateKey: "2027-04-01" }), null);
  assert.equal(cover({ dateKey: "2026-04-01" })?.id, "letter-1", "the first day counts");
  assert.equal(cover({ dateKey: "2027-03-31" })?.id, "letter-1", "and the last");
});

test("where letters overlap, the most recently signed one is the cover", () => {
  const chosen = cover({
    letters: [
      letter({ id: "old", signedOn: "2026-04-11" }),
      letter({ id: "revised", signedOn: "2026-09-02" }),
    ],
  });
  assert.equal(chosen?.id, "revised");
});

const draft = (over: Partial<Parameters<typeof refuseLetter>[0]> = {}) => refuseLetter({
  issuedOn: "2026-04-02",
  periodFrom: "2026-04-01",
  periodTo: "2027-03-31",
  serviceCodes: ["GST"],
  signedOn: "2026-04-11",
  status: "signed",
  ...over,
});

test("a letter needs a period, at least one service, and dates that make sense", () => {
  assert.equal(draft(), null);
  assert.equal(draft({ status: "elsewhere" }), "unknown_status");
  assert.equal(draft({ periodTo: "2026-03-01" }), "period_invalid");
  assert.equal(draft({ periodFrom: "2026-04-01", periodTo: "2026-04-01" }), "period_invalid", "a period of no length");
  assert.equal(draft({ serviceCodes: [] }), "no_services");
});

test("a draft needs no dates; an issued letter needs one; a signed letter needs both", () => {
  assert.equal(draft({ issuedOn: null, signedOn: null, status: "draft" }), null);
  assert.equal(draft({ issuedOn: null, signedOn: null, status: "issued" }), "issue_date_required");
  assert.equal(draft({ issuedOn: "2026-04-02", signedOn: null, status: "issued" }), null);
  assert.equal(draft({ issuedOn: "2026-04-02", signedOn: null, status: "signed" }), "sign_date_required");
});

test("a letter cannot be signed before it was issued", () => {
  assert.equal(draft({ issuedOn: "2026-04-10", signedOn: "2026-04-02" }), "signed_before_issued");
  assert.equal(draft({ issuedOn: "2026-04-10", signedOn: "2026-04-10" }), null, "signed the day it went out");
});

test("a letter reads as a sentence somebody would say", () => {
  assert.equal(
    letterSummary(letter(), (key) => key),
    "GST, BOOKS · 2026-04-01 to 2027-03-31 · signed",
  );
});

test("every check, outcome and status reads as English and says what it is for", () => {
  assert.ok(isCheckKey("predecessor"));
  assert.ok(!isCheckKey("gut_feel"));
  assert.ok(isCheckOutcome("concern"));
  assert.ok(!isCheckOutcome("fine"));
  for (const key of CHECK_KEYS) {
    assert.ok(CHECK_LABELS[key].length > 0);
    assert.ok(CHECK_NOTES[key].length > 0, "a checklist item nobody can explain gets ticked");
  }
  for (const outcome of ["cleared", "concern", "not_applicable"] as const) assert.ok(OUTCOME_LABELS[outcome].length > 0);
  for (const status of ["in_progress", "accepted", "declined"] as const) assert.ok(ACCEPTANCE_LABELS[status].length > 0);
  for (const status of ["draft", "issued", "signed", "superseded"] as const) assert.ok(LETTER_LABELS[status].length > 0);
});
