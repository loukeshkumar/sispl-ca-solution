import { registerHref } from "./queue-params";

/**
 * Resting custody states a certificate can lapse from. `returned` is an event
 * that sets status back to `in_custody`, never a status a row comes to rest in,
 * and `expired`/`surrendered` are already-recorded ends. Matches the definition
 * the workspace metrics already use.
 */
export const LIVE_DSC_STATUSES = ["in_custody", "issued_out"] as const;

/** A notice in either of these states has been answered; nothing is outstanding. */
const SETTLED_NOTICE_STATUSES = ["responded", "closed"];

/**
 * How long a token may sit with a counterparty before the custody chain itself
 * is the problem. A signature device out for a fortnight with nobody chasing it
 * is the failure this register exists to prevent.
 */
export const CUSTODY_STALE_DAYS = 14;

/** An unowned notice is a risk whatever its deadline, but only inside a horizon worth acting on. */
const UNOWNED_HORIZON_DAYS = 30;

const DAY_MS = 86_400_000;
const dayDifference = (dateKey: string, todayKey: string) => Math.round(
  (Date.parse(`${dateKey}T00:00:00Z`) - Date.parse(`${todayKey}T00:00:00Z`)) / DAY_MS,
);

export type AttentionSeverity = "overdue" | "today" | "soon";

/**
 * Why an item is in the queue, which is not the same as how urgent it is.
 * A deadline is met by working; an unowned notice is met by assigning it, and a
 * token that never came back is met by phoning whoever has it.
 */
export type AttentionRisk = "deadline" | "lapsed" | "unowned" | "custody";

/** What each risk is asking the reader to do, not merely how soon. */
export const RISK_LABELS: Record<AttentionRisk, string> = {
  custody: "Not returned",
  deadline: "Deadline",
  lapsed: "Register drift",
  unowned: "Unassigned",
};

export type AttentionItem = {
  clientName: string;
  detail: string;
  dueDate: string;
  href: string;
  id: string;
  kind: "notice" | "certificate";
  label: string;
  risk: AttentionRisk;
  severity: AttentionSeverity;
};

export type CertificateBand = "expired" | "imminent" | "soon" | "later";

/** Time to lapse, in the bands a custodian actually acts on. */
export function certificateBand(validUntil: string, todayKey: string): CertificateBand {
  const days = dayDifference(validUntil, todayKey);
  if (days < 0) return "expired";
  if (days <= 7) return "imminent";
  if (days <= 30) return "soon";
  return "later";
}

type QueueCertificate = {
  clientName: string;
  holderName: string;
  id: string;
  /** Day the token was last signed out, when it is still out. Absent means never out. */
  issuedOutSince?: string | null;
  serialNumber: string;
  status: string;
  validUntil: string;
};

type QueueNotice = {
  assigneeName: string | null;
  clientName: string;
  id: string;
  responseDueDate: string;
  status: string;
  subject: string;
};

type QueueInput = {
  certificates: QueueCertificate[];
  custodyStaleDays?: number;
  expiryWindowDays?: number;
  notices: QueueNotice[];
  todayKey: string;
};

/**
 * Most pressing first. A missed statutory deadline outranks everything; a token
 * that is out and unaccounted for outranks one that merely expires soon,
 * because recovering it takes longer than renewing it. Ties inside a rank fall
 * back to the earlier date.
 */
const RANK: Record<string, number> = {
  "notice:overdue": 0,
  "certificate:overdue": 1,
  "notice:today": 2,
  "notice:unowned": 3,
  "certificate:custody": 4,
  "notice:soon": 5,
  "certificate:soon": 6,
};

const rankOf = (item: AttentionItem) => (
  RANK[`${item.kind}:${item.risk === "unowned" || item.risk === "custody" ? item.risk : item.severity}`] ?? 9
);

/** Link straight at the row, not merely at the register that contains it. */
const focusHref = (tab: "notices" | "dsc", id: string) => registerHref({ focus: id, status: "all", tab });

/**
 * One ranked list across all three registers, answering "what needs action
 * today" without opening each tab. Only genuinely outstanding items enter it:
 * a settled notice or an already-recorded lapse is not an action.
 *
 * Four distinct risks feed it — a deadline running out, a register that has
 * drifted from reality, a notice nobody owns, and a token that left the office
 * and never came back. A queue that only knew about deadlines let the last two
 * accumulate silently.
 */
export function buildAttentionQueue({
  certificates,
  custodyStaleDays = CUSTODY_STALE_DAYS,
  expiryWindowDays = 30,
  notices,
  todayKey,
}: QueueInput): AttentionItem[] {
  const items: AttentionItem[] = [];

  for (const notice of notices) {
    if (SETTLED_NOTICE_STATUSES.includes(notice.status)) continue;
    const days = dayDifference(notice.responseDueDate, todayKey);
    const severity: AttentionSeverity = days < 0 ? "overdue" : days === 0 ? "today" : "soon";
    const base = {
      clientName: notice.clientName,
      dueDate: notice.responseDueDate,
      href: focusHref("notices", notice.id),
      id: notice.id,
      kind: "notice" as const,
      label: notice.subject,
    };

    if (days <= 7) {
      items.push({
        ...base,
        detail: days < 0
          ? `${Math.abs(days)} days past the response date`
          : days === 0 ? "Response due today" : `Response due in ${days} days`,
        risk: "deadline",
        severity,
      });
      continue;
    }

    /*
     * Beyond the deadline horizon a notice is only news when nobody owns it.
     * Inside the horizon the deadline entry above already carries it, and
     * listing the same notice twice would inflate the queue it is meant to
     * shrink.
     */
    if (!notice.assigneeName && days <= UNOWNED_HORIZON_DAYS) {
      items.push({
        ...base,
        detail: `Nobody is assigned, and the response is due in ${days} days`,
        risk: "unowned",
        severity: "soon",
      });
    }
  }

  for (const certificate of certificates) {
    if (!(LIVE_DSC_STATUSES as readonly string[]).includes(certificate.status)) continue;
    const days = dayDifference(certificate.validUntil, todayKey);
    const base = {
      clientName: certificate.clientName,
      href: focusHref("dsc", certificate.id),
      id: certificate.id,
      kind: "certificate" as const,
      label: `${certificate.serialNumber} · ${certificate.holderName}`,
    };

    if (days <= expiryWindowDays) {
      items.push({
        ...base,
        // Past validity while still live means the register disagrees with reality.
        detail: days < 0
          ? `Expired ${Math.abs(days)} days ago and still recorded as live`
          : days === 0 ? "Expires today" : `Expires in ${days} days`,
        dueDate: certificate.validUntil,
        risk: days < 0 ? "lapsed" : "deadline",
        severity: days < 0 ? "overdue" : "soon",
      });
      continue;
    }

    /*
     * A token well inside its validity is still a problem when it is sitting
     * with someone outside the firm. Expiry and custody are separate clocks,
     * and only the expiry one was ever being read.
     */
    if (certificate.status === "issued_out" && certificate.issuedOutSince) {
      const out = Math.abs(dayDifference(certificate.issuedOutSince.slice(0, 10), todayKey));
      if (out >= custodyStaleDays) {
        items.push({
          ...base,
          detail: `Signed out ${out} days ago and not returned`,
          dueDate: certificate.issuedOutSince.slice(0, 10),
          risk: "custody",
          severity: "soon",
        });
      }
    }
  }

  return items.sort((left, right) => (
    rankOf(left) - rankOf(right) || left.dueDate.localeCompare(right.dueDate)
  ));
}

/** Headline counts for the queue, so the page can say what kind of trouble it is. */
export function summariseAttention(items: AttentionItem[]) {
  return {
    custody: items.filter((item) => item.risk === "custody").length,
    overdue: items.filter((item) => item.severity === "overdue").length,
    today: items.filter((item) => item.severity === "today").length,
    total: items.length,
    unowned: items.filter((item) => item.risk === "unowned").length,
  };
}
