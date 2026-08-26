/**
 * Taking a client on, and the terms they agreed to.
 *
 * A client was created with a name and a start date and was active from that
 * moment. Nothing recorded that anybody had looked for a conflict, considered
 * whether the firm was independent, seen a PAN, or written to the outgoing
 * auditor. The first evidence a client had been accepted was that work existed
 * for them — which is evidence of nothing except that somebody started.
 *
 * The engagement letter is the other half. SA 210 wants the terms in writing,
 * and the question a reviewer asks is never "is there a letter" but "does it
 * cover this work".
 */

export type CheckKey = "conflict" | "independence" | "kyc" | "predecessor" | "integrity";

export const CHECK_KEYS: readonly CheckKey[] = ["conflict", "independence", "kyc", "predecessor", "integrity"];

export const CHECK_LABELS: Record<CheckKey, string> = {
  conflict: "Conflict of interest",
  independence: "Independence",
  integrity: "Integrity of the client and its management",
  kyc: "Know your client — PAN and identity",
  predecessor: "Communication with the outgoing auditor",
};

/**
 * What each check is for, in the words the standard uses.
 *
 * Written out because a checklist whose items nobody can explain gets ticked,
 * and a ticked checklist is worse than none: it looks like assurance.
 */
export const CHECK_NOTES: Record<CheckKey, string> = {
  conflict: "Whether acting for this client conflicts with an existing engagement.",
  independence: "Whether the firm and its people are independent of this client in fact and appearance.",
  integrity: "What is known about the client, its owners and its management.",
  kyc: "Identity and constitution evidenced, and the PAN seen.",
  predecessor: "The ICAI Code requires the firm to communicate with the retiring auditor before accepting.",
};

/**
 * Checks that must be answered before a client can be accepted.
 *
 * `predecessor` is not here: a first-time engagement has no outgoing auditor,
 * and demanding a row for it would teach people to mark it not applicable
 * without reading it. It is offered, and its absence is visible.
 */
export const MANDATORY_CHECKS: readonly CheckKey[] = ["conflict", "independence", "kyc", "integrity"];

export const isCheckKey = (value: string): value is CheckKey =>
  (CHECK_KEYS as readonly string[]).includes(value);

export type CheckOutcome = "cleared" | "concern" | "not_applicable";

export const CHECK_OUTCOMES: readonly CheckOutcome[] = ["cleared", "concern", "not_applicable"];

export const OUTCOME_LABELS: Record<CheckOutcome, string> = {
  cleared: "Cleared",
  concern: "Concern raised",
  not_applicable: "Not applicable",
};

export const isCheckOutcome = (value: string): value is CheckOutcome =>
  (CHECK_OUTCOMES as readonly string[]).includes(value);

export type AcceptanceCheck = {
  checkKey: CheckKey;
  checkedOn: string;
  note: string;
  outcome: CheckOutcome;
};

export type AcceptanceStatus = "in_progress" | "accepted" | "declined";

export const ACCEPTANCE_LABELS: Record<AcceptanceStatus, string> = {
  accepted: "Accepted",
  declined: "Declined",
  in_progress: "Not yet accepted",
};

export type AcceptanceStanding = {
  /** Mandatory checks with no row at all. */
  missing: CheckKey[];
  /** Checks answered with a concern. Not a bar, but a partner must see them. */
  concerns: CheckKey[];
  ready: boolean;
  status: AcceptanceStatus;
};

/**
 * Where one client's acceptance stands.
 *
 * A concern does not block acceptance. Firms do take on clients with a known
 * issue and manage it; what must not happen is the issue disappearing. It is
 * surfaced, and the partner's decision note is where it gets answered.
 */
export function standingOf(input: {
  checks: readonly AcceptanceCheck[];
  status: AcceptanceStatus;
}): AcceptanceStanding {
  const byKey = new Map(input.checks.map((check) => [check.checkKey, check]));
  const missing = MANDATORY_CHECKS.filter((key) => !byKey.has(key));
  return {
    concerns: input.checks.filter((check) => check.outcome === "concern").map((check) => check.checkKey),
    missing,
    ready: missing.length === 0 && input.status === "in_progress",
    status: input.status,
  };
}

export type CheckRefusal = "unknown_check" | "unknown_outcome" | "note_required" | "date_required" | "already_decided";

export const CHECK_REFUSAL_NOTES: Record<CheckRefusal, string> = {
  already_decided: "This client's acceptance has been decided. Reopen it before recording further checks.",
  date_required: "Say when the check was performed.",
  note_required: "A check that is not a clean pass has to say what it found.",
  unknown_check: "Choose one of the firm's acceptance checks.",
  unknown_outcome: "Say whether the check cleared, raised a concern, or does not apply.",
};

export function refuseCheck(input: {
  acceptanceStatus: AcceptanceStatus;
  checkKey: string;
  checkedOn: string;
  note: string;
  outcome: string;
}): CheckRefusal | null {
  if (input.acceptanceStatus !== "in_progress") return "already_decided";
  if (!isCheckKey(input.checkKey)) return "unknown_check";
  if (!isCheckOutcome(input.outcome)) return "unknown_outcome";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.checkedOn)) return "date_required";
  if (input.outcome !== "cleared" && input.note.trim().length < 3) return "note_required";
  return null;
}

export type DecisionRefusal = "checks_outstanding" | "already_decided" | "unknown_outcome" | "reason_required" | "self_check";

export const DECISION_REFUSAL_NOTES: Record<DecisionRefusal, string> = {
  already_decided: "This client's acceptance has already been decided.",
  checks_outstanding: "Every mandatory check has to be answered before the firm decides.",
  reason_required: "Say why the firm is declining. It is the only record of the decision.",
  self_check: "The person who performed every check cannot also be the one who accepts on them.",
  unknown_outcome: "Choose whether the client is accepted or declined.",
};

/**
 * Whether the firm may decide.
 *
 * `self_check` is the control worth naming: acceptance is a partner satisfying
 * themselves that somebody else's work supports taking the client on. One person
 * doing the checks and then accepting on their own checks is the same word
 * twice.
 */
export function refuseDecision(input: {
  actorUserId: string;
  /** Distinct users who performed the recorded checks. */
  checkerUserIds: readonly string[];
  outcome: string;
  reason: string;
  standing: AcceptanceStanding;
}): DecisionRefusal | null {
  if (input.standing.status !== "in_progress") return "already_decided";
  if (input.outcome !== "accepted" && input.outcome !== "declined") return "unknown_outcome";
  if (input.outcome === "declined") {
    return input.reason.trim().length < 3 ? "reason_required" : null;
  }
  if (input.standing.missing.length > 0) return "checks_outstanding";
  if (input.checkerUserIds.length > 0 && input.checkerUserIds.every((userId) => userId === input.actorUserId)) {
    return "self_check";
  }
  return null;
}

/** `2 checks outstanding` / `Accepted · 1 concern noted`. */
export function acceptanceSummary(standing: AcceptanceStanding): string {
  const concerns = standing.concerns.length > 0
    ? ` · ${standing.concerns.length} concern${standing.concerns.length === 1 ? "" : "s"} noted`
    : "";
  if (standing.status === "accepted") return `Accepted${concerns}`;
  if (standing.status === "declined") return "Declined";
  if (standing.missing.length === 0) return `Every mandatory check answered — ready to decide${concerns}`;
  return `${standing.missing.length} check${standing.missing.length === 1 ? "" : "s"} outstanding${concerns}`;
}

export type LetterStatus = "draft" | "issued" | "signed" | "superseded";

export const LETTER_LABELS: Record<LetterStatus, string> = {
  draft: "Draft",
  issued: "Issued, not signed",
  signed: "Signed",
  superseded: "Superseded",
};

export type EngagementLetter = {
  id: string;
  periodFrom: string;
  periodTo: string;
  serviceCodes: string[];
  signedOn: string | null;
  status: LetterStatus;
};

/**
 * Whether a signed letter covers one piece of work.
 *
 * Only `signed` counts. A letter issued and never returned is the firm's
 * intention, not the client's agreement, and treating it as cover is exactly
 * the assumption that goes wrong when it matters.
 */
export function coveringLetter(input: {
  dateKey: string;
  letters: readonly EngagementLetter[];
  serviceCode: string;
}): EngagementLetter | null {
  const code = input.serviceCode.toUpperCase();
  const covering = input.letters.filter((letter) => letter.status === "signed"
    && letter.periodFrom <= input.dateKey
    && input.dateKey <= letter.periodTo
    && letter.serviceCodes.some((entry) => entry.toUpperCase() === code));
  // The most recently signed one, where a client has overlapping letters.
  return covering.sort((left, right) => (left.signedOn ?? "").localeCompare(right.signedOn ?? "")).at(-1) ?? null;
}

export type LetterRefusal =
  | "period_invalid" | "no_services" | "unknown_status" | "issue_date_required"
  | "sign_date_required" | "signed_before_issued" | "already_signed";

export const LETTER_REFUSAL_NOTES: Record<LetterRefusal, string> = {
  already_signed: "That letter is already signed. Supersede it with a new one rather than editing the terms.",
  issue_date_required: "Say when the letter went to the client.",
  no_services: "A letter has to name the services it covers. One covering nothing covers nothing.",
  period_invalid: "Enter a period that ends after it starts.",
  sign_date_required: "Say when the client signed it.",
  signed_before_issued: "A letter cannot be signed before it was issued.",
  unknown_status: "Choose the state the letter is in.",
};

export function refuseLetter(input: {
  issuedOn: string | null;
  periodFrom: string;
  periodTo: string;
  serviceCodes: readonly string[];
  signedOn: string | null;
  status: string;
}): LetterRefusal | null {
  if (!["draft", "issued", "signed", "superseded"].includes(input.status)) return "unknown_status";
  const dates = /^\d{4}-\d{2}-\d{2}$/;
  if (!dates.test(input.periodFrom) || !dates.test(input.periodTo) || input.periodTo <= input.periodFrom) return "period_invalid";
  if (input.serviceCodes.length === 0) return "no_services";
  if (input.status === "draft") return null;
  if (!input.issuedOn || !dates.test(input.issuedOn)) return "issue_date_required";
  if (input.status === "issued") return null;
  if (!input.signedOn || !dates.test(input.signedOn)) return "sign_date_required";
  if (input.signedOn < input.issuedOn) return "signed_before_issued";
  return null;
}

/** `GST, BOOKS · 01 Apr 2026 to 31 Mar 2027 · signed`. */
export function letterSummary(letter: EngagementLetter, formatDate: (key: string) => string): string {
  return `${letter.serviceCodes.join(", ")} · ${formatDate(letter.periodFrom)} to ${formatDate(letter.periodTo)} · ${LETTER_LABELS[letter.status].toLowerCase()}`;
}
