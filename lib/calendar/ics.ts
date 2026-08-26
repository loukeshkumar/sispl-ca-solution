import { addDays } from "./dates";
import type { CalendarEvent } from "./events";
import { CALENDAR_LAYERS, type CalendarLayer } from "./queue-params";

/**
 * RFC 5545 serialisation for the practice calendar.
 *
 * A deadline that only exists inside this application is a deadline somebody
 * misses on the day they are working out of Outlook. The file is written to the
 * specification rather than approximately, because the consumers are Outlook and
 * Google and neither forgives a malformed fold.
 */

const CRLF = "\r\n";
const FOLD_LIMIT = 75;

/** TEXT values escape backslash, semicolon, comma and newline. Nothing else. */
export function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/**
 * Folds to 75 *octets*, not characters. A client name in Devanagari is three
 * bytes a glyph, and folding on character count would push the line past the
 * limit that some parsers enforce.
 */
export function foldIcsLine(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= FOLD_LIMIT) return line;
  const parts: string[] = [];
  let current = "";
  let currentBytes = 0;
  // The continuation octet budget is one lower: the leading space counts.
  let limit = FOLD_LIMIT;
  for (const character of line) {
    const size = encoder.encode(character).length;
    if (currentBytes + size > limit) {
      parts.push(current);
      current = "";
      currentBytes = 0;
      limit = FOLD_LIMIT - 1;
    }
    current += character;
    currentBytes += size;
  }
  if (current) parts.push(current);
  return parts.join(`${CRLF} `);
}

function icsDate(dateKey: string) {
  return dateKey.replace(/-/g, "");
}

/** UTC stamp, seconds precision, as DTSTAMP and the alarm trigger require. */
export function icsStamp(instant: Date): string {
  return `${instant.toISOString().slice(0, 19).replace(/[-:]/g, "")}Z`;
}

const LAYER_LABELS = new Map(CALENDAR_LAYERS.map((layer) => [layer.key, layer.label]));

/**
 * Only what somebody would act on. Leave and holidays are context inside the
 * application; exporting them would duplicate rows the firm's HR calendar
 * already owns, and a subscriber cannot tell the copy from the original.
 */
const EXPORTABLE_LAYERS: ReadonlySet<CalendarLayer> = new Set(
  CALENDAR_LAYERS.map((layer) => layer.key).filter((key) => key !== "leave" && key !== "holidays"),
);

export function icsExportable(events: CalendarEvent[]): CalendarEvent[] {
  return events.filter((event) => EXPORTABLE_LAYERS.has(event.layer));
}

function eventLines(event: CalendarEvent, options: { baseUrl: string; stamp: string }): string[] {
  const summary = event.provisional ? `[Forecast] ${event.title}` : event.title;
  const description = [
    event.subtitle,
    event.clientName ? `Client: ${event.clientName}` : "",
    event.ownerName ? `Owner: ${event.ownerName}` : "",
    event.statusLabel ? `Status: ${event.statusLabel}` : "",
    LAYER_LABELS.get(event.layer) ? `Source: ${LAYER_LABELS.get(event.layer)}` : "",
  ].filter(Boolean).join("\n");

  const lines = [
    "BEGIN:VEVENT",
    // Stable across exports so a re-subscribe updates rather than duplicates.
    `UID:${escapeIcsText(event.key)}@sispl-ca-solution`,
    `DTSTAMP:${options.stamp}`,
    // All-day events: DTEND is exclusive, so a one-day deadline ends the next day.
    `DTSTART;VALUE=DATE:${icsDate(event.dateKey)}`,
    `DTEND;VALUE=DATE:${icsDate(addDays(event.endKey, 1))}`,
    `SUMMARY:${escapeIcsText(summary)}`,
    `DESCRIPTION:${escapeIcsText(description)}`,
    `CATEGORIES:${escapeIcsText(LAYER_LABELS.get(event.layer) ?? event.layer)}`,
    // A forecast row is not yet a commitment, and saying so is the difference
    // between a calendar a partner trusts and one they stop reading.
    `STATUS:${event.provisional ? "TENTATIVE" : event.open ? "CONFIRMED" : "COMPLETED"}`,
    "TRANSP:TRANSPARENT",
  ];
  if (options.baseUrl && event.href) lines.push(`URL:${escapeIcsText(`${options.baseUrl}${event.href}`)}`);
  if (event.open && !event.provisional) {
    lines.push(
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      // The day before, not the morning of: a filing found at 09:00 on the due
      // date is already late by the time the papers are chased.
      "TRIGGER:-P1D",
      `DESCRIPTION:${escapeIcsText(summary)}`,
      "END:VALARM",
    );
  }
  lines.push("END:VEVENT");
  return lines;
}

export function toIcsCalendar(events: CalendarEvent[], options: {
  baseUrl?: string;
  name: string;
  stamp: Date;
}): string {
  const stamp = icsStamp(options.stamp);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//SISPL//CA Practice Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeIcsText(options.name)}`,
    "X-WR-TIMEZONE:Asia/Kolkata",
    ...icsExportable(events).flatMap((event) => eventLines(event, { baseUrl: options.baseUrl ?? "", stamp })),
    "END:VCALENDAR",
  ];
  return `${lines.map(foldIcsLine).join(CRLF)}${CRLF}`;
}

export function icsFilename(todayKey: string): string {
  return `practice-calendar-${todayKey}.ics`;
}
