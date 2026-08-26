"use client";

import Link from "next/link";

import { longDayLabel, relativeDayLabel, weekdayIndex, WEEKDAY_NAMES } from "../../lib/calendar/dates";
import { sortCalendarEvents, type CalendarEvent } from "../../lib/calendar/events";
import { dayCapacity } from "../../lib/calendar/grid";
import { CalendarEventRow } from "./calendar-parts";
import { EmptyState } from "./dashboard-ui";

/**
 * A flat chronological read of the loaded window.
 *
 * The month grid answers "what does this month look like"; agenda answers "what
 * is next", which is a different question and the one asked more often. It runs
 * past the end of the month deliberately — a deadline on the 2nd is not less
 * urgent for falling outside the square the reader happens to be looking at.
 */
export function CalendarAgendaView({ events, dayHref, teamSize, todayKey }: {
  dayHref: (dateKey: string) => string;
  events: CalendarEvent[];
  teamSize: number;
  todayKey: string;
}) {
  const grouped = new Map<string, CalendarEvent[]>();
  for (const event of sortCalendarEvents(events, todayKey)) {
    const bucket = grouped.get(event.dateKey);
    if (bucket) bucket.push(event);
    else grouped.set(event.dateKey, [event]);
  }

  if (!grouped.size) {
    return (
      <EmptyState
        description="Nothing falls due in this window with the current filters."
        icon="calendar"
        title="A clear run"
      />
    );
  }

  return (
    <ol className="calendar-agenda-days">
      {[...grouped].map(([dateKey, dayEvents]) => {
        const capacity = dayCapacity({ dateKey, events: dayEvents, teamSize, todayKey });
        return (
          <li className={dateKey === todayKey ? "is-today" : ""} key={dateKey}>
            <header>
              <Link href={dayHref(dateKey)}>
                <strong>{longDayLabel(dateKey)}</strong>
                <small>{WEEKDAY_NAMES[weekdayIndex(dateKey)]} · {relativeDayLabel(dateKey, todayKey)}</small>
              </Link>
              <span>{dayEvents.length} item{dayEvents.length === 1 ? "" : "s"}</span>
            </header>
            {capacity.warning && <p className="calendar-day-warning">{capacity.warning}</p>}
            <div className="calendar-agenda-rows">
              {dayEvents.map((event) => <CalendarEventRow event={event} key={event.key} todayKey={todayKey} />)}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
