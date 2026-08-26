/**
 * When a late obligation changes hands, and whose hands it reaches.
 *
 * Both deadline notifications went to the assignee. The only person told a
 * filing was slipping was the one it was slipping past, and nothing reached
 * anybody above them until a human looked at a queue and noticed.
 *
 * A ladder is an ordered list of rungs. Each names a date — an offset from one
 * of the two deadlines — and an audience. Climbing a rung tells that audience
 * and writes down that it happened; it does not move the work, because who
 * should now hold a late filing is a judgement and not an arithmetic result.
 */

export type EscalationAnchor = "internal_due" | "statutory_due";

export const ESCALATION_ANCHORS: readonly EscalationAnchor[] = ["internal_due", "statutory_due"];

export const ANCHOR_LABELS: Record<EscalationAnchor, string> = {
  internal_due: "internal due date",
  statutory_due: "statutory due date",
};

export const isEscalationAnchor = (value: string): value is EscalationAnchor =>
  (ESCALATION_ANCHORS as readonly string[]).includes(value);

export type TargetKind = "assignee" | "role";

export const TARGET_KINDS: readonly TargetKind[] = ["assignee", "role"];

export const isTargetKind = (value: string): value is TargetKind =>
  (TARGET_KINDS as readonly string[]).includes(value);

export const ESCALATION_ROLES = ["firm_administrator", "partner", "manager", "associate"] as const;

export type EscalationRole = typeof ESCALATION_ROLES[number];

export const ROLE_LABELS: Record<EscalationRole, string> = {
  associate: "Associates",
  firm_administrator: "Firm administrators",
  manager: "Managers",
  partner: "Partners",
};

export const isEscalationRole = (value: string): value is EscalationRole =>
  (ESCALATION_ROLES as readonly string[]).includes(value);

export type EscalationRule = {
  anchor: EscalationAnchor;
  id: string;
  label: string;
  offsetDays: number;
  rung: number;
  targetKind: TargetKind;
  targetRole: EscalationRole | null;
};

export type EscalatableItem = {
  internalDueDate: string | null;
  statutoryDueDate: string;
};

export function addDays(dateKey: string, days: number) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year!, month! - 1, day! + days)).toISOString().slice(0, 10);
}

/**
 * The date a rung becomes due for one obligation.
 *
 * An obligation with no internal date falls back to the statutory one rather
 * than skipping the rung: a firm that has not set an internal deadline still
 * wants to hear before the statutory one passes, and silently dropping the rung
 * is the failure this whole ladder exists to prevent.
 */
export function rungDate(rule: EscalationRule, item: EscalatableItem): string {
  const anchor = rule.anchor === "internal_due"
    ? item.internalDueDate ?? item.statutoryDueDate
    : item.statutoryDueDate;
  return addDays(anchor, rule.offsetDays);
}

export type DueRung = {
  /** True where a higher rung fired the same day, so this one told nobody. */
  overtaken: boolean;
  rule: EscalationRule;
  /** The date it became due, which may be well before today. */
  dueOn: string;
};

/**
 * Which rungs fire today.
 *
 * Where several became due — a job that did not run for a week, or an
 * obligation raised already late — only the highest tells anybody. Telling a
 * manager after a partner already knows is the ladder run backwards, and
 * sending three notifications about one filing teaches people to ignore them.
 * The rungs it passed are still recorded, marked as overtaken, so the history
 * does not pretend they never came due.
 */
export function dueRungs(input: {
  alreadyFired: readonly number[];
  item: EscalatableItem;
  rules: readonly EscalationRule[];
  todayKey: string;
}): DueRung[] {
  const fired = new Set(input.alreadyFired);
  const due = input.rules
    .filter((rule) => !fired.has(rule.rung))
    .map((rule) => ({ dueOn: rungDate(rule, input.item), overtaken: false, rule }))
    .filter((entry) => entry.dueOn <= input.todayKey)
    .sort((left, right) => left.rule.rung - right.rule.rung);

  if (due.length === 0) return [];
  const highest = due[due.length - 1]!;
  return due.map((entry) => ({ ...entry, overtaken: entry !== highest }));
}

/** `Rung 2 · 0 days after the internal due date · Managers`. */
export function rungSummary(rule: EscalationRule): string {
  const offset = rule.offsetDays === 0
    ? `on the ${ANCHOR_LABELS[rule.anchor]}`
    : rule.offsetDays < 0
      ? `${Math.abs(rule.offsetDays)} day${Math.abs(rule.offsetDays) === 1 ? "" : "s"} before the ${ANCHOR_LABELS[rule.anchor]}`
      : `${rule.offsetDays} day${rule.offsetDays === 1 ? "" : "s"} after the ${ANCHOR_LABELS[rule.anchor]}`;
  const audience = rule.targetKind === "assignee" ? "the assignee" : ROLE_LABELS[rule.targetRole!];
  return `Rung ${rule.rung} · ${offset} · ${audience}`;
}

/** What an overtaken rung says instead of naming recipients. */
export const overtakenBy = (rung: number) => `Overtaken by rung ${rung}, which fired the same day.`;

export type RuleRefusal =
  | "unknown_anchor" | "unknown_target" | "unknown_role" | "role_required"
  | "role_not_allowed" | "label_required" | "offset_out_of_range" | "rung_taken"
  | "rung_out_of_range" | "not_later_than_previous";

export const RULE_REFUSAL_NOTES: Record<RuleRefusal, string> = {
  label_required: "Say what this rung means. It becomes the sentence the notification leads with.",
  not_later_than_previous: "A rung must come no earlier than the one below it, or the ladder climbs downwards.",
  offset_out_of_range: "Enter an offset between 60 days before and 60 days after the deadline.",
  role_not_allowed: "A rung that tells the assignee cannot also name a role.",
  role_required: "Choose whose role hears this rung.",
  rung_out_of_range: "Rungs are numbered 1 to 20.",
  rung_taken: "That rung already exists. Edit it, or choose the next number up.",
  unknown_anchor: "Choose whether this counts from the internal or the statutory due date.",
  unknown_role: "Choose a role the firm actually uses.",
  unknown_target: "Choose whether this rung tells the assignee or a role.",
};

/**
 * Whether a rung can join the ladder.
 *
 * The ordering rule is the one worth stating: rung 3 firing before rung 2 would
 * tell a partner while the manager still had days in hand, which is not an
 * escalation but a leapfrog. Comparison is on the offset within an anchor and
 * on the anchor otherwise, since the statutory date is never before the
 * internal one.
 */
export function refuseRule(input: {
  anchor: string;
  existingRungs: readonly number[];
  label: string;
  offsetDays: number;
  /** The rung immediately below, if the ladder already has one. */
  previous: Pick<EscalationRule, "anchor" | "offsetDays"> | null;
  rung: number;
  targetKind: string;
  targetRole: string | null;
}): RuleRefusal | null {
  if (!Number.isInteger(input.rung) || input.rung < 1 || input.rung > 20) return "rung_out_of_range";
  if (input.existingRungs.includes(input.rung)) return "rung_taken";
  if (!isEscalationAnchor(input.anchor)) return "unknown_anchor";
  if (!isTargetKind(input.targetKind)) return "unknown_target";
  if (input.targetKind === "role") {
    if (!input.targetRole) return "role_required";
    if (!isEscalationRole(input.targetRole)) return "unknown_role";
  } else if (input.targetRole) return "role_not_allowed";
  if (!Number.isInteger(input.offsetDays) || input.offsetDays < -60 || input.offsetDays > 60) return "offset_out_of_range";
  if (input.label.trim().length < 3) return "label_required";
  if (input.previous && anchorRank(input.previous) > anchorRank({ anchor: input.anchor, offsetDays: input.offsetDays })) {
    return "not_later_than_previous";
  }
  return null;
}

/**
 * A comparable position for a rung without a specific obligation in front of us.
 *
 * The internal date is never after the statutory one, so anchoring to the
 * statutory date always places a rung at or later than the same offset on the
 * internal one. That is enough to order a ladder at the point it is written.
 */
function anchorRank(rule: Pick<EscalationRule, "anchor" | "offsetDays">) {
  return (rule.anchor === "statutory_due" ? 1000 : 0) + rule.offsetDays;
}

/** How the ladder reads where a firm has not built one. */
export const EMPTY_LADDER_NOTE =
  "No ladder is recorded, so a late obligation stays with whoever holds it until somebody looks.";

export function escalationNotice(input: {
  clientName: string;
  label: string;
  periodKey: string;
  rung: number;
  serviceKey: string;
  statutoryDueDate: string;
  todayKey: string;
}) {
  const days = Math.round(
    (Date.parse(`${input.todayKey}T00:00:00Z`) - Date.parse(`${input.statutoryDueDate}T00:00:00Z`)) / 86_400_000,
  );
  const standing = days > 0
    ? `${days} day${days === 1 ? "" : "s"} past its statutory due date`
    : days === 0
      ? "due today"
      : `due in ${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"}`;
  return {
    body: `${input.label}. This obligation is ${standing} and is still open. It has not been reassigned — it is being raised with you.`,
    title: `Rung ${input.rung}: ${input.serviceKey} · ${input.clientName} · ${input.periodKey}`,
  };
}
