/**
 * Resting custody states a certificate can lapse from. `returned` is an event
 * that sets status back to `in_custody`, never a status a row comes to rest in,
 * and `expired`/`surrendered` are already-recorded ends. Matches the definition
 * the workspace metrics already use.
 */
export const LIVE_DSC_STATUSES = ["in_custody", "issued_out"] as const;

/** A notice in either of these states has been answered; nothing is outstanding. */
const SETTLED_NOTICE_STATUSES = ["responded", "closed"];

const DAY_MS = 86_400_000;
const dayDifference = (dateKey: string, todayKey: string) => Math.round(
  (Date.parse(`${dateKey}T00:00:00Z`) - Date.parse(`${todayKey}T00:00:00Z`)) / DAY_MS,
);

export type AttentionSeverity = "overdue" | "today" | "soon";
export type AttentionItem = {
  clientName: string;
  detail: string;
  dueDate: string;
  id: string;
  kind: "notice" | "certificate";
  label: string;
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

type QueueInput = {
  certificates: Array<{ clientName: string; holderName: string; id: string; serialNumber: string; status: string; validUntil: string }>;
  expiryWindowDays?: number;
  notices: Array<{ assigneeName: string | null; clientName: string; id: string; responseDueDate: string; status: string; subject: string }>;
  todayKey: string;
};

/** Most pressing first. Ties inside a rank fall back to the earlier date. */
const RANK: Record<string, number> = { "notice:overdue": 0, "certificate:overdue": 1, "notice:today": 2, "notice:soon": 3, "certificate:soon": 4 };

/**
 * One ranked list across all three registers, answering "what needs action
 * today" without opening each tab. Only genuinely outstanding items enter it:
 * a settled notice or an already-recorded lapse is not an action.
 */
export function buildAttentionQueue({ certificates, expiryWindowDays = 30, notices, todayKey }: QueueInput): AttentionItem[] {
  const items: AttentionItem[] = [];

  for (const notice of notices) {
    if (SETTLED_NOTICE_STATUSES.includes(notice.status)) continue;
    const days = dayDifference(notice.responseDueDate, todayKey);
    if (days > 7) continue;
    const severity: AttentionSeverity = days < 0 ? "overdue" : days === 0 ? "today" : "soon";
    items.push({
      clientName: notice.clientName,
      detail: days < 0
        ? `${Math.abs(days)} days past the response date`
        : days === 0 ? "Response due today" : `Response due in ${days} days`,
      dueDate: notice.responseDueDate,
      id: notice.id,
      kind: "notice",
      label: notice.subject,
      severity,
    });
  }

  for (const certificate of certificates) {
    if (!(LIVE_DSC_STATUSES as readonly string[]).includes(certificate.status)) continue;
    const days = dayDifference(certificate.validUntil, todayKey);
    if (days > expiryWindowDays) continue;
    items.push({
      clientName: certificate.clientName,
      // Past validity while still live means the register disagrees with reality.
      detail: days < 0
        ? `Expired ${Math.abs(days)} days ago and still recorded as live`
        : days === 0 ? "Expires today" : `Expires in ${days} days`,
      dueDate: certificate.validUntil,
      id: certificate.id,
      kind: "certificate",
      label: `${certificate.serialNumber} · ${certificate.holderName}`,
      severity: days < 0 ? "overdue" : "soon",
    });
  }

  return items.sort((left, right) => (
    (RANK[`${left.kind}:${left.severity}`] ?? 9) - (RANK[`${right.kind}:${right.severity}`] ?? 9)
    || left.dueDate.localeCompare(right.dueDate)
  ));
}
