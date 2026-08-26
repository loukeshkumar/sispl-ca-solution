import type { ComplianceFrequency, ComplianceScheduleRule } from "./recurrence";

/**
 * The calendar, per client.
 *
 * One schedule per service governed every client entitled to it. A client on
 * QRMP, a government deductor paying on a different day, a client who dropped a
 * service in July — none of it could be expressed, so all of it lived in
 * somebody's memory and surfaced as a missed filing.
 *
 * Two separate things live here, and they are not the same shape:
 *
 *   an override    is a standing fact about one client, effective from a date
 *   an extension   is a one-off fact about one period, from an authority
 *
 * Conflating them is how a blanket extension ends up applied to four clients
 * out of five, with nothing recording that they shared a cause.
 */

export type ScheduleMode = "override" | "exempt";

export const SCHEDULE_MODES: readonly ScheduleMode[] = ["override", "exempt"];

export const MODE_LABELS: Record<ScheduleMode, string> = {
  exempt: "Not applicable",
  override: "Own schedule",
};

export const isScheduleMode = (value: string): value is ScheduleMode =>
  (SCHEDULE_MODES as readonly string[]).includes(value);

export type ClientScheduleOverride = {
  effectiveFrom: string;
  legalEntityId: string;
  mode: ScheduleMode;
  /** Present for `override`, absent for `exempt`. */
  rule: ComplianceScheduleRule | null;
  serviceCode: string;
};

export type ResolvedSchedule = {
  /** Null when the client is exempt, or when no rule governs the service. */
  rule: ComplianceScheduleRule | null;
  /** Where the rule came from, so a queue can say why a date is what it is. */
  source: "firm" | "client" | "exempt" | "none";
};

/**
 * The rule that governs one client for one service.
 *
 * Resolved as of a single date rather than per period, which is the convention
 * the firm schedule already follows: an override records what is true from a
 * date forward and does not reach back and re-shape periods already generated.
 * Recording an override dated in the future is therefore safe — it starts
 * governing on the day, without anybody doing anything.
 */
export function resolveSchedule(input: {
  asOfKey: string;
  firmRules: readonly ComplianceScheduleRule[];
  legalEntityId: string;
  overrides: readonly ClientScheduleOverride[];
  serviceCode: string;
}): ResolvedSchedule {
  const code = input.serviceCode.toUpperCase();
  const applicable = input.overrides
    .filter((override) => override.legalEntityId === input.legalEntityId
      && override.serviceCode.toUpperCase() === code
      && override.effectiveFrom <= input.asOfKey)
    .sort((left, right) => left.effectiveFrom.localeCompare(right.effectiveFrom));

  const latest = applicable[applicable.length - 1];
  if (latest) {
    if (latest.mode === "exempt") return { rule: null, source: "exempt" };
    if (latest.rule) return { rule: latest.rule, source: "client" };
  }

  const firm = input.firmRules.find((entry) => entry.serviceCode.toUpperCase() === code);
  return firm ? { rule: firm, source: "firm" } : { rule: null, source: "none" };
}

export type ComplianceExtension = {
  extendedDueDate: string;
  /** Null means every client filing this service for this period. */
  legalEntityId: string | null;
  periodKey: string;
  serviceCode: string;
};

/**
 * The date an obligation is actually due, after any extension.
 *
 * A client-specific extension beats a class-wide one: an extension granted on
 * that client's own application is the more particular fact, and the general
 * notification does not override it.
 */
export function extendedDueDate(input: {
  extensions: readonly ComplianceExtension[];
  legalEntityId: string;
  periodKey: string;
  serviceCode: string;
  statutoryDueDate: string;
}): { dueDate: string; extended: boolean } {
  const code = input.serviceCode.toUpperCase();
  const matches = input.extensions.filter((extension) => extension.serviceCode.toUpperCase() === code
    && extension.periodKey === input.periodKey
    && (extension.legalEntityId === null || extension.legalEntityId === input.legalEntityId));
  if (matches.length === 0) return { dueDate: input.statutoryDueDate, extended: false };

  const specific = matches.find((extension) => extension.legalEntityId !== null);
  const chosen = specific ?? matches[0]!;
  return { dueDate: chosen.extendedDueDate, extended: chosen.extendedDueDate !== input.statutoryDueDate };
}

export type OverrideRefusal =
  | "unknown_mode" | "unknown_frequency" | "date_required" | "not_entitled"
  | "duplicate_date" | "same_as_firm" | "incomplete_rule" | "invalid_day";

export const OVERRIDE_REFUSAL_NOTES: Record<OverrideRefusal, string> = {
  date_required: "Say when this starts. A schedule with no start date cannot be applied to a period.",
  duplicate_date: "This client already has a schedule for that service starting on that date. Edit it instead.",
  incomplete_rule: "An own schedule needs a frequency, a due month, a due day and an internal lead time.",
  invalid_day: "Enter a due day between 1 and 31 and an internal lead between 0 and 60 days.",
  not_entitled: "This client is not engaged for that service, so there is nothing to schedule.",
  same_as_firm: "That is the firm's own schedule for this service. An override that changes nothing only hides where the rule comes from.",
  unknown_frequency: "Choose monthly, quarterly or annual.",
  unknown_mode: "Choose whether this client follows their own schedule or is not applicable.",
};

const FREQUENCIES: readonly ComplianceFrequency[] = ["monthly", "quarterly", "annual"];

const sameRule = (left: ComplianceScheduleRule, right: ComplianceScheduleRule) =>
  left.frequency === right.frequency
  && left.dueMonthOffset === right.dueMonthOffset
  && left.dueDay === right.dueDay
  && left.internalLeadDays === right.internalLeadDays;

export function refuseOverride(input: {
  effectiveFrom: string;
  entitled: boolean;
  existingDates: readonly string[];
  firmRule: ComplianceScheduleRule | null;
  mode: string;
  rule: Partial<ComplianceScheduleRule> | null;
}): OverrideRefusal | null {
  if (!isScheduleMode(input.mode)) return "unknown_mode";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.effectiveFrom)) return "date_required";
  if (!input.entitled) return "not_entitled";
  if (input.existingDates.includes(input.effectiveFrom)) return "duplicate_date";
  if (input.mode === "exempt") return null;

  const rule = input.rule;
  if (!rule || rule.frequency === undefined || rule.dueMonthOffset === undefined
    || rule.dueDay === undefined || rule.internalLeadDays === undefined) return "incomplete_rule";
  if (!FREQUENCIES.includes(rule.frequency as ComplianceFrequency)) return "unknown_frequency";
  if (!Number.isInteger(rule.dueDay) || rule.dueDay! < 1 || rule.dueDay! > 31) return "invalid_day";
  if (!Number.isInteger(rule.internalLeadDays) || rule.internalLeadDays! < 0 || rule.internalLeadDays! > 60) return "invalid_day";
  if (!Number.isInteger(rule.dueMonthOffset) || rule.dueMonthOffset! < 0 || rule.dueMonthOffset! > 12) return "invalid_day";
  // An override identical to the firm rule is not wrong, it is invisible: the
  // client silently stops following the firm without anybody seeing a change.
  if (input.firmRule && sameRule(rule as ComplianceScheduleRule, input.firmRule)) return "same_as_firm";
  return null;
}

export type ExtensionRefusal =
  | "date_required" | "not_later" | "authority_required" | "period_required" | "duplicate" | "unknown_service";

export const EXTENSION_REFUSAL_NOTES: Record<ExtensionRefusal, string> = {
  authority_required: "Cite the notification or order this comes from. An extension nobody can cite is a rumour.",
  date_required: "Enter both the original date and the date it moved to.",
  duplicate: "That period already has an extension recorded. Edit that one rather than adding a second.",
  not_later: "The new date must be later than the original. A date moved earlier is not an extension.",
  period_required: "Name the period this extension covers, exactly as the calendar labels it.",
  unknown_service: "Choose a service from the firm's service master.",
};

export function refuseExtension(input: {
  authority: string;
  duplicate: boolean;
  extendedDueDate: string;
  knownService: boolean;
  originalDueDate: string;
  periodKey: string;
}): ExtensionRefusal | null {
  if (!input.knownService) return "unknown_service";
  if (input.periodKey.trim().length < 2) return "period_required";
  const dates = /^\d{4}-\d{2}-\d{2}$/;
  if (!dates.test(input.originalDueDate) || !dates.test(input.extendedDueDate)) return "date_required";
  if (input.extendedDueDate <= input.originalDueDate) return "not_later";
  if (input.authority.trim().length < 2) return "authority_required";
  if (input.duplicate) return "duplicate";
  return null;
}

/** `Quarterly · due on the 13th of the following month · 5 days internal lead`. */
export function ruleSummary(rule: ComplianceScheduleRule): string {
  const cadence = rule.frequency.charAt(0).toUpperCase() + rule.frequency.slice(1);
  const month = rule.dueMonthOffset === 0
    ? "the same month"
    : rule.dueMonthOffset === 1
      ? "the following month"
      : `${rule.dueMonthOffset} months after`;
  return `${cadence} · due on the ${ordinal(rule.dueDay)} of ${month} · ${rule.internalLeadDays} day${rule.internalLeadDays === 1 ? "" : "s"} internal lead`;
}

function ordinal(day: number) {
  if (day % 100 >= 11 && day % 100 <= 13) return `${day}th`;
  return `${day}${["th", "st", "nd", "rd"][day % 10] ?? "th"}`;
}

/** How a resolved schedule reads where a client sits beside the firm default. */
export function sourceSummary(resolved: ResolvedSchedule): string {
  if (resolved.source === "exempt") return "Not applicable to this client";
  if (resolved.source === "none") return "No schedule governs this service";
  if (resolved.source === "firm") return "Follows the firm schedule";
  return "This client's own schedule";
}
