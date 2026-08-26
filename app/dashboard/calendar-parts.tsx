"use client";

import Link from "next/link";

import { dayNumber, relativeDayLabel, shortMonth } from "../../lib/calendar/dates";
import { severityFor, type CalendarEvent, type CalendarSeverity } from "../../lib/calendar/events";
import { CALENDAR_LAYERS, type CalendarLayer } from "../../lib/calendar/queue-params";

export const LAYER_TONE = new Map<CalendarLayer, string>(CALENDAR_LAYERS.map((layer) => [layer.key, layer.tone]));
export const LAYER_LABEL = new Map<CalendarLayer, string>(CALENDAR_LAYERS.map((layer) => [layer.key, layer.label]));

/** The severity words a reader acts on, rather than the enum they come as. */
export const SEVERITY_LABEL: Record<CalendarSeverity, string> = {
  overdue: "Overdue",
  today: "Due today",
  soon: "Due soon",
  later: "Scheduled",
  settled: "Done",
};

export function eventAriaLabel(event: CalendarEvent, todayKey: string) {
  const severity = severityFor(event, todayKey);
  return [
    event.provisional ? "Forecast" : LAYER_LABEL.get(event.layer),
    event.title,
    event.clientName,
    SEVERITY_LABEL[severity],
    relativeDayLabel(event.dateKey, todayKey),
  ].filter(Boolean).join(", ");
}

/**
 * One event as it appears inside a day.
 *
 * The layer supplies the colour and the severity supplies the emphasis, because
 * they answer different questions: what kind of thing this is, and how close it
 * is to hurting. Collapsing them into one colour loses whichever the reader
 * happened to need.
 */
export function CalendarEventChip({ compact = false, event, todayKey }: {
  compact?: boolean;
  event: CalendarEvent;
  todayKey: string;
}) {
  const severity = severityFor(event, todayKey);
  return (
    <Link
      aria-label={eventAriaLabel(event, todayKey)}
      className={`calendar-chip tone-${LAYER_TONE.get(event.layer) ?? "blue"} is-${severity}${event.provisional ? " is-provisional" : ""}${compact ? " is-compact" : ""}`}
      href={event.href}
      title={`${event.title}${event.clientName ? ` — ${event.clientName}` : ""}`}
    >
      <span aria-hidden="true" className="calendar-chip-rail" />
      <span className="calendar-chip-body">
        <strong>{event.title}</strong>
        {!compact && <small>{event.clientName || event.subtitle || LAYER_LABEL.get(event.layer)}</small>}
      </span>
    </Link>
  );
}

/** A dated row for the agenda and the drawer, where there is room for detail. */
export function CalendarEventRow({ event, showDate = false, todayKey }: {
  event: CalendarEvent;
  showDate?: boolean;
  todayKey: string;
}) {
  const severity = severityFor(event, todayKey);
  return (
    <Link
      aria-label={eventAriaLabel(event, todayKey)}
      className={`calendar-row tone-${LAYER_TONE.get(event.layer) ?? "blue"} is-${severity}`}
      href={event.href}
    >
      {showDate && (
        <time dateTime={event.dateKey}>
          <strong>{dayNumber(event.dateKey)}</strong>
          <small>{shortMonth(event.dateKey)}</small>
        </time>
      )}
      <span className="calendar-row-body">
        <strong>{event.title}</strong>
        <small>{[event.clientName, event.subtitle].filter(Boolean).join(" · ") || LAYER_LABEL.get(event.layer)}</small>
      </span>
      <span className="calendar-row-meta">
        <em className={`calendar-severity is-${severity}`}>
          {event.provisional ? "Not yet raised" : SEVERITY_LABEL[severity]}
        </em>
        <small>{event.ownerName || (event.provisional ? "Unowned" : "—")}</small>
      </span>
    </Link>
  );
}

/**
 * The colour key. A grid that encodes ten sources in colour and never says what
 * the colours mean is decoration; this is what makes it readable.
 */
export function CalendarLegend({ hidden, layerHref, permitted }: {
  hidden: CalendarLayer[];
  layerHref: (layer: CalendarLayer) => string;
  permitted: CalendarLayer[];
}) {
  const shown = CALENDAR_LAYERS.filter((layer) => permitted.includes(layer.key));
  return (
    <div aria-label="Show or hide calendar layers" className="calendar-legend" role="group">
      {shown.map((layer) => {
        const off = hidden.includes(layer.key);
        return (
          <Link
            // The state lives in the name rather than in a toggle role: this is
            // a link that navigates, and a screen reader is better served by
            // being told what the click does than by a switch that is not one.
            aria-label={`${off ? "Show" : "Hide"} ${layer.label} — ${layer.hint}`}
            className={`calendar-legend-item tone-${layer.tone}${off ? " is-off" : ""}`}
            href={layerHref(layer.key)}
            key={layer.key}
            title={layer.hint}
          >
            <span aria-hidden="true" className="calendar-legend-swatch" />
            {layer.label}
          </Link>
        );
      })}
    </div>
  );
}
