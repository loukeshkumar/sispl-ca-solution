"use client";

import Link from "next/link";

import { longDayLabel, WEEKDAY_NAMES } from "../../lib/calendar/dates";
import type { CalendarEvent } from "../../lib/calendar/events";
import { dayCapacity, dayLoad, type CalendarCell } from "../../lib/calendar/grid";
import { CalendarEventChip } from "./calendar-parts";

/**
 * How many events a cell shows before it stops trying. Three fits a month cell
 * at every width the grid is used at; the rest are one click away rather than
 * silently absent, which is what the old "+N more" text amounted to.
 */
const CELL_LIMIT = 3;

export function CalendarMonthGrid({ byDay, cells, dayHref, teamSize, todayKey }: {
  byDay: Map<string, CalendarEvent[]>;
  cells: CalendarCell[];
  dayHref: (dateKey: string) => string;
  teamSize: number;
  todayKey: string;
}) {
  return (
    <div className="calendar-scroll">
      <div aria-hidden="true" className="calendar-weekdays">
        {WEEKDAY_NAMES.map((day) => <span key={day}>{day}</span>)}
      </div>
      <div aria-labelledby="calendar-range-heading" className="calendar-days" role="grid">
        {cells.map((cell) => {
          const events = byDay.get(cell.dateKey) ?? [];
          const load = dayLoad(events, todayKey);
          const capacity = dayCapacity({ dateKey: cell.dateKey, events, teamSize, todayKey });
          const overflow = Math.max(0, events.length - CELL_LIMIT);
          const label = [
            longDayLabel(cell.dateKey),
            `${events.length} item${events.length === 1 ? "" : "s"}`,
            cell.isToday ? "today" : "",
            capacity.warning,
          ].filter(Boolean).join("; ");
          return (
            <div
              className={[
                "calendar-day",
                `load-${load.band}`,
                cell.inMonth ? "" : "is-adjacent",
                cell.isToday ? "is-today" : "",
                cell.isWeekend ? "is-weekend" : "",
                capacity.holidayName ? "is-closed" : "",
                capacity.warning ? "is-strained" : "",
              ].filter(Boolean).join(" ")}
              key={cell.dateKey}
              role="gridcell"
            >
              <div className="calendar-day-head">
                {/* The number is the way into the day: the old grid had none. */}
                <Link aria-label={`Open ${label}`} className="calendar-day-number" href={dayHref(cell.dateKey)}>
                  {Number(cell.dateKey.slice(8, 10))}
                </Link>
                {capacity.holidayName && <em className="calendar-day-flag" title={capacity.holidayName}>Closed</em>}
                {!capacity.holidayName && capacity.awayNames.length > 0 && (
                  <em className="calendar-day-flag is-away" title={`Away: ${capacity.awayNames.join(", ")}`}>
                    {capacity.awayNames.length} away
                  </em>
                )}
              </div>

              {capacity.warning && <p className="calendar-day-warning">{capacity.warning}</p>}

              <div className="calendar-day-events">
                {events.slice(0, CELL_LIMIT).map((event) => (
                  <CalendarEventChip compact event={event} key={event.key} todayKey={todayKey} />
                ))}
              </div>

              {overflow > 0 && (
                <Link className="calendar-more" href={dayHref(cell.dateKey)}>
                  +{overflow} more
                </Link>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
