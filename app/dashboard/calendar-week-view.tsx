"use client";

import Link from "next/link";

import { dayNumber, longDayLabel, shortMonth, WEEKDAY_NAMES } from "../../lib/calendar/dates";
import type { CalendarEvent } from "../../lib/calendar/events";
import { dayCapacity, dayLoad, type CalendarCell } from "../../lib/calendar/grid";
import { CalendarEventChip } from "./calendar-parts";

/**
 * Seven columns, everything in each.
 *
 * The week is where a manager plans, so nothing is truncated here: the point of
 * the view is to see the whole of a heavy day next to the whole of a light one.
 */
export function CalendarWeekView({ byDay, cells, dayHref, teamSize, todayKey }: {
  byDay: Map<string, CalendarEvent[]>;
  cells: CalendarCell[];
  dayHref: (dateKey: string) => string;
  teamSize: number;
  todayKey: string;
}) {
  const busiest = Math.max(1, ...cells.map((cell) => dayLoad(byDay.get(cell.dateKey) ?? [], todayKey).weight));
  return (
    <div className="calendar-scroll">
      <div className="calendar-week" role="list">
        {cells.map((cell, index) => {
          const events = byDay.get(cell.dateKey) ?? [];
          const load = dayLoad(events, todayKey);
          const capacity = dayCapacity({ dateKey: cell.dateKey, events, teamSize, todayKey });
          return (
            <section
              className={[
                "calendar-week-day",
                `load-${load.band}`,
                cell.isToday ? "is-today" : "",
                cell.isWeekend ? "is-weekend" : "",
                capacity.holidayName ? "is-closed" : "",
              ].filter(Boolean).join(" ")}
              key={cell.dateKey}
              role="listitem"
            >
              <header>
                <Link aria-label={`Open ${longDayLabel(cell.dateKey)}`} href={dayHref(cell.dateKey)}>
                  <small>{WEEKDAY_NAMES[index]}</small>
                  <strong>{dayNumber(cell.dateKey)}</strong>
                  <em>{shortMonth(cell.dateKey)}</em>
                </Link>
                {/* Relative to the busiest day on screen, so the bar compares
                    the days the reader is actually choosing between. */}
                <span aria-hidden="true" className="calendar-week-load">
                  <i style={{ width: `${Math.round((load.weight / busiest) * 100)}%` }} />
                </span>
                <small className="calendar-week-count">
                  {events.length ? `${events.length} item${events.length === 1 ? "" : "s"}` : "Clear"}
                </small>
              </header>

              {capacity.holidayName && <p className="calendar-day-warning is-closed">{capacity.holidayName} — office closed</p>}
              {!capacity.holidayName && capacity.warning && <p className="calendar-day-warning">{capacity.warning}</p>}
              {capacity.awayNames.length > 0 && (
                <p className="calendar-week-away">Away: {capacity.awayNames.join(", ")}</p>
              )}

              <div className="calendar-week-events">
                {events.map((event) => <CalendarEventChip event={event} key={event.key} todayKey={todayKey} />)}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
