import { certificateBand, LIVE_DSC_STATUSES, RISK_LABELS, type AttentionItem } from "./attention";
import { dayDifference, dueChip } from "./lens";
import { registerHref, type RegisterParams } from "./queue-params";
import type { DscRow, NoticeRow, UdinRow } from "./repository";

/**
 * The rows behind a Registers KPI figure, in one shape.
 *
 * Each headline number on the workspace is an answer to "how many"; the reader's
 * next question is always "which ones". Sending them off to a filtered register
 * loses the page they were reading, so the figures open the list in place — and
 * that list has to be built identically whether the rows are already on the
 * client or have to be fetched, which is what this module exists to guarantee.
 */

export const PEEK_KINDS = ["attention", "notices", "dsc", "udin"] as const;
export type PeekKind = (typeof PEEK_KINDS)[number];

/** Which register has to be in hand before a peek can be built. */
export type PeekSource = "attention" | "certificates" | "notices" | "udins";

export type PeekRow = {
  /** ISO date key, or empty when the row runs to no clock. The panel formats it. */
  dateKey: string;
  detail: string;
  href: string;
  id: string;
  note: string;
  subtitle: string;
  title: string;
  tone: "amber" | "blue" | "mint" | "red" | "violet";
};

/**
 * A peek is a preview, not a replacement for the register. Past this many rows
 * the reader is searching rather than scanning, and the panel says so instead of
 * quietly showing a prefix of the truth.
 */
export const PEEK_ROW_LIMIT = 200;

export type PeekResult = { rows: PeekRow[]; total: number };

export type PeekDefinition = {
  description: string;
  emptyNote: string;
  /** Where "Open in the register" goes — the navigation the figure used to do. */
  filters: Partial<RegisterParams>;
  source: PeekSource;
  title: string;
};

export const PEEK_DEFINITIONS: Record<PeekKind, PeekDefinition> = {
  attention: {
    description: "Everything across the three registers that is overdue, due soon, unowned, or still signed out.",
    emptyNote: "Nothing needs action right now.",
    filters: { tab: "attention" },
    source: "attention",
    title: "Needs action",
  },
  dsc: {
    description: "Certificates still recorded as live whose validity lapses within the next 30 days.",
    emptyNote: "No live certificate lapses within 30 days.",
    filters: { band: "soon", tab: "dsc" },
    source: "certificates",
    title: "DSC expiring",
  },
  notices: {
    // The figure counts open *and* in-progress notices, so the list must too —
    // a panel that opened on `status=open` alone would contradict its own count.
    description: "Statutory notices still open or in progress, soonest response date first.",
    emptyNote: "No notice is outstanding.",
    filters: { status: "open", tab: "notices" },
    source: "notices",
    title: "Open notices",
  },
  udin: {
    description: "UDINs recorded on the ICAI portal and not revoked, most recent first.",
    emptyNote: "No UDIN is active.",
    filters: { status: "active", tab: "udin" },
    source: "udins",
    title: "Active UDINs",
  },
};

/** Matches the workspace metric: a notice is outstanding until it is answered. */
export const OUTSTANDING_NOTICE_STATUSES = ["open", "in_progress"] as const;

const deadlineTone = (days: number): PeekRow["tone"] => (days < 0 ? "red" : days === 0 ? "amber" : days <= 7 ? "amber" : "blue");

const attentionRows = (items: AttentionItem[]): PeekRow[] => items.map((item) => ({
  dateKey: item.dueDate,
  detail: item.detail,
  href: item.href,
  id: `${item.kind}:${item.risk}:${item.id}`,
  note: RISK_LABELS[item.risk],
  subtitle: item.clientName,
  title: item.label,
  tone: item.risk === "unowned" ? "violet" : item.severity === "overdue" ? "red" : item.severity === "today" ? "amber" : "blue",
}));

const noticeRows = (rows: NoticeRow[], todayKey: string): PeekRow[] => rows
  .filter((row) => (OUTSTANDING_NOTICE_STATUSES as readonly string[]).includes(row.status))
  .sort((left, right) => left.responseDueDate.localeCompare(right.responseDueDate))
  .map((row) => {
    const days = dayDifference(row.responseDueDate, todayKey);
    return {
      dateKey: row.responseDueDate,
      detail: row.subject,
      href: registerHref({ focus: row.id, tab: "notices" }),
      id: row.id,
      note: `${dueChip(days).label} · ${row.assigneeName ?? "Unassigned"}`,
      subtitle: row.clientName,
      title: row.noticeNumber,
      tone: deadlineTone(days),
    };
  });

const certificateRows = (rows: DscRow[], todayKey: string): PeekRow[] => rows
  .filter((row) => (LIVE_DSC_STATUSES as readonly string[]).includes(row.status)
    && ["imminent", "soon"].includes(certificateBand(row.validUntil, todayKey)))
  .sort((left, right) => left.validUntil.localeCompare(right.validUntil))
  .map((row) => {
    const days = dayDifference(row.validUntil, todayKey);
    return {
      dateKey: row.validUntil,
      detail: row.holderName,
      href: registerHref({ focus: row.id, tab: "dsc" }),
      id: row.id,
      note: `${days === 0 ? "Lapses today" : `${days}d left`}${row.status === "issued_out" ? " · signed out" : ""}`,
      subtitle: row.clientName,
      title: row.serialNumber,
      tone: days <= 7 ? "red" : "amber",
    };
  });

const udinRows = (rows: UdinRow[]): PeekRow[] => rows
  .filter((row) => row.status === "active")
  .sort((left, right) => right.generatedOn.localeCompare(left.generatedOn))
  .map((row) => ({
    dateKey: row.generatedOn,
    detail: row.documentDescription,
    href: registerHref({ focus: row.id, tab: "udin" }),
    id: row.id,
    note: row.signedByName,
    subtitle: row.clientName,
    title: row.udin,
    tone: "mint" as const,
  }));

export type PeekSourceRows = {
  attention?: AttentionItem[];
  certificates?: DscRow[];
  notices?: NoticeRow[];
  udins?: UdinRow[];
};

/**
 * Build one KPI's list from whatever register rows the caller holds.
 *
 * `total` is the true size of the list, reported separately from the capped
 * rows so the panel can say when it is showing a prefix.
 */
export function buildPeek(kind: PeekKind, source: PeekSourceRows, todayKey: string): PeekResult {
  const rows = kind === "attention" ? attentionRows(source.attention ?? [])
    : kind === "notices" ? noticeRows(source.notices ?? [], todayKey)
      : kind === "dsc" ? certificateRows(source.certificates ?? [], todayKey)
        : udinRows(source.udins ?? []);
  return { rows: rows.slice(0, PEEK_ROW_LIMIT), total: rows.length };
}

export const isPeekKind = (value: string): value is PeekKind => (PEEK_KINDS as readonly string[]).includes(value);
