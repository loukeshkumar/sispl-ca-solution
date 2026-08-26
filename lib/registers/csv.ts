import type { DscRow, NoticeRow, UdinRow } from "./repository";

/**
 * One CSV cell.
 *
 * Always quoted, because a register carries client names with commas, notice
 * subjects with quotes, and remarks with newlines, and a half-quoted file is
 * worse than no export at all. A leading `=`, `+`, `-` or `@` is prefixed with
 * an apostrophe so a spreadsheet reads it as text rather than a formula — the
 * register holds attacker-influenced strings such as counterparty names.
 */
function cell(value: string | number | null | undefined): string {
  const raw = value === null || value === undefined ? "" : String(value);
  const safe = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function toCsv(headers: string[], rows: Array<Array<string | number | null | undefined>>): string {
  // A BOM so Excel opens UTF-8 client names correctly instead of mojibake.
  return `﻿${[headers, ...rows].map((row) => row.map(cell).join(",")).join("\r\n")}\r\n`;
}

const NOTICE_HEADERS = [
  "Notice number", "Client", "Authority", "Section", "Subject",
  "Notice date", "Received", "Response due", "Status", "Owner", "Responded on", "Response summary",
];

const DSC_HEADERS = [
  "Serial", "Holder", "Client", "Issuing authority", "Class",
  "Valid from", "Valid until", "Custody status", "Custodian", "Signed out since", "Storage", "Notes",
];

const UDIN_HEADERS = [
  "UDIN", "Client", "Document type", "Description", "Signed by", "Membership number", "Generated on", "Status", "Revocation reason",
];

export function noticesCsv(rows: NoticeRow[]): string {
  return toCsv(NOTICE_HEADERS, rows.map((row) => [
    row.noticeNumber, row.clientName, row.authority, row.noticeSection, row.subject,
    row.noticeDate, row.receivedDate, row.responseDueDate, row.status,
    row.assigneeName ?? "Unassigned", row.respondedOn ?? "", row.responseSummary,
  ]));
}

export function certificatesCsv(rows: DscRow[]): string {
  return toCsv(DSC_HEADERS, rows.map((row) => [
    row.serialNumber, row.holderName, row.clientName, row.issuingAuthority, row.certificateClass,
    row.validFrom, row.validUntil, row.status, row.custodianName ?? "",
    row.issuedOutSince ? row.issuedOutSince.slice(0, 10) : "", row.storageLocation, row.notes,
  ]));
}

export function udinsCsv(rows: UdinRow[]): string {
  return toCsv(UDIN_HEADERS, rows.map((row) => [
    row.udin, row.clientName, row.documentType, row.documentDescription,
    row.signedByName, row.membershipNumber, row.generatedOn, row.status, row.revocationReason,
  ]));
}

/** `registers-notices-2026-08-24.csv` — the tab and the day it was taken. */
export const registerExportFilename = (tab: string, todayKey: string) => `registers-${tab}-${todayKey}.csv`;
