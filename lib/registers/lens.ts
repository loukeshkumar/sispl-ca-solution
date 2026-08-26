import { certificateBand } from "./attention";
import { REGISTER_PAGE_SIZE, type RegisterParams } from "./queue-params";
import type { DscRow, NoticeRow, UdinRow } from "./repository";

const DAY_MS = 86_400_000;

export const dayDifference = (dateKey: string, todayKey: string) => Math.round(
  (Date.parse(`${dateKey}T00:00:00Z`) - Date.parse(`${todayKey}T00:00:00Z`)) / DAY_MS,
);

export type NoticeBand = "overdue" | "today" | "week" | "later";

/** The same urgency bands the delivery workspaces use, so one habit covers all. */
export function noticeBand(responseDueDate: string, todayKey: string): NoticeBand {
  const days = dayDifference(responseDueDate, todayKey);
  if (days < 0) return "overdue";
  if (days === 0) return "today";
  if (days <= 7) return "week";
  return "later";
}

const matches = (haystack: string, needle: string) => !needle || haystack.toLowerCase().includes(needle);

/**
 * Every register narrows the same way: by text, by client, by its own status
 * vocabulary, and by the clock it runs against. Keeping that in one place is
 * what lets the three tabs behave identically without repeating the logic.
 */
export function filterNotices(rows: NoticeRow[], params: RegisterParams, todayKey: string): NoticeRow[] {
  const needle = params.q.trim().toLowerCase();
  return rows.filter((row) => (
    (params.status === "all" || row.status === params.status)
    && (params.client === "all" || row.legalEntityId === params.client)
    && (params.authority === "all" || row.authority === params.authority)
    && (params.owner === "all" || (params.owner === "unassigned" ? !row.assigneeId : row.assigneeId === params.owner))
    && (params.band === "all" || noticeBand(row.responseDueDate, todayKey) === params.band)
    && matches(`${row.noticeNumber} ${row.subject} ${row.clientName} ${row.noticeSection} ${row.assigneeName ?? ""}`, needle)
  ));
}

export function filterCertificates(rows: DscRow[], params: RegisterParams, todayKey: string): DscRow[] {
  const needle = params.q.trim().toLowerCase();
  return rows.filter((row) => (
    (params.status === "all" || row.status === params.status)
    && (params.client === "all" || row.legalEntityId === params.client)
    && (params.owner === "all" || (params.owner === "unassigned" ? !row.custodianUserId : row.custodianUserId === params.owner))
    && (params.band === "all" || certificateBand(row.validUntil, todayKey) === params.band)
    && matches(`${row.serialNumber} ${row.holderName} ${row.clientName} ${row.issuingAuthority} ${row.storageLocation}`, needle)
  ));
}

export function filterUdins(rows: UdinRow[], params: RegisterParams): UdinRow[] {
  const needle = params.q.trim().toLowerCase();
  return rows.filter((row) => (
    (params.status === "all" || row.status === params.status)
    && (params.client === "all" || row.legalEntityId === params.client)
    && matches(`${row.udin} ${row.clientName} ${row.documentDescription} ${row.signedByName} ${row.membershipNumber}`, needle)
  ));
}

type Sortable = { clientName: string };

/**
 * `due` is each register's own clock, supplied by the caller because a notice
 * runs to a deadline and a UDIN only ever ran forwards from when it was signed.
 */
export function sortRows<T extends Sortable>(rows: T[], sort: RegisterParams["sort"], due: (row: T) => string): T[] {
  const sorted = [...rows];
  if (sort === "client") return sorted.sort((left, right) => left.clientName.localeCompare(right.clientName) || due(left).localeCompare(due(right)));
  if (sort === "recent") return sorted.sort((left, right) => due(right).localeCompare(due(left)));
  return sorted.sort((left, right) => due(left).localeCompare(due(right)));
}

export type Paged<T> = { from: number; items: T[]; page: number; pages: number; to: number; total: number };

/**
 * A register can run to thousands of rows; the reader can read twenty-five.
 * An out-of-range page clamps to the last one rather than rendering nothing,
 * which is what happens when a filter shrinks the list under the reader.
 */
export function paginate<T>(rows: T[], page: number, size = REGISTER_PAGE_SIZE): Paged<T> {
  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / size));
  const current = Math.min(Math.max(1, page), pages);
  const from = (current - 1) * size;
  const items = rows.slice(from, from + size);
  return { from: total === 0 ? 0 : from + 1, items, page: current, pages, to: from + items.length, total };
}

export type ClientLensGroup<T> = {
  clientName: string;
  items: T[];
  legalEntityId: string;
  /** Negative days for the most pressing row, so the worst client sorts first. */
  leadDays: number;
  overdue: number;
};

/**
 * A firm chases per client, not per row: one call settles four notices for the
 * same company. Groups are ordered by the single most pressing item inside
 * them, because that is the client somebody rings first.
 */
export function groupByClient<T extends { legalEntityId: string; clientName: string }>(
  rows: T[],
  todayKey: string,
  due: (row: T) => string,
): Array<ClientLensGroup<T>> {
  const groups = new Map<string, ClientLensGroup<T>>();
  for (const row of rows) {
    const days = dayDifference(due(row), todayKey);
    const existing = groups.get(row.legalEntityId);
    if (!existing) {
      groups.set(row.legalEntityId, {
        clientName: row.clientName,
        items: [row],
        leadDays: days,
        legalEntityId: row.legalEntityId,
        overdue: days < 0 ? 1 : 0,
      });
      continue;
    }
    existing.items.push(row);
    existing.leadDays = Math.min(existing.leadDays, days);
    if (days < 0) existing.overdue += 1;
  }
  return [...groups.values()]
    .map((group) => ({ ...group, items: [...group.items].sort((left, right) => due(left).localeCompare(due(right))) }))
    .sort((left, right) => left.leadDays - right.leadDays || left.clientName.localeCompare(right.clientName));
}

/** Compact time-to-deadline chip, shared by every banded register row. */
export function dueChip(days: number): { label: string; tone: string } {
  if (days < 0) return { label: `${Math.abs(days)}d overdue`, tone: "overdue" };
  if (days === 0) return { label: "Due today", tone: "today" };
  if (days === 1) return { label: "Due tomorrow", tone: "soon" };
  if (days <= 7) return { label: `${days}d left`, tone: "soon" };
  return { label: `${days}d left`, tone: "later" };
}
