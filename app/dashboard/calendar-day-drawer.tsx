"use client";

import Link from "next/link";
import { X } from "lucide-react";

import { completeCalendarItemAction, reassignCalendarItemAction } from "../calendar/actions";
import { longDayLabel, relativeDayLabel, weekdayIndex, WEEKDAY_NAMES } from "../../lib/calendar/dates";
import { severityFor, type CalendarEvent } from "../../lib/calendar/events";
import { dayCapacity } from "../../lib/calendar/grid";
import { LAYER_LABEL, LAYER_TONE, SEVERITY_LABEL } from "./calendar-parts";
import { EmptyState } from "./dashboard-ui";

export type CalendarActor = { canAssignTasks: boolean; canWriteWork: boolean };

/**
 * Whether this reader may act on this item from here.
 *
 * A to-do is the reader's own and needs no extra right; work and tasks are
 * governed by the same permissions their own workspaces enforce, so acting from
 * the calendar is a shorter route to the same act rather than a way round it.
 */
function mayAct(event: CalendarEvent, actor: CalendarActor) {
  if (!event.action) return false;
  if (event.action.kind === "work") return actor.canWriteWork;
  if (event.action.kind === "task") return actor.canAssignTasks;
  return true;
}

/**
 * Everything on one day, with the actions that day's items accept.
 *
 * The old grid capped a cell at three events and offered "+N more" as plain
 * text, so a busy day was the one day you could not read. This is where that
 * click lands.
 */
export function CalendarDayDrawer({ actor, closeHref, dateKey, events, members, returnTo, teamSize, todayKey }: {
  actor: CalendarActor;
  closeHref: string;
  dateKey: string;
  events: CalendarEvent[];
  members: Array<{ id: string; name: string }>;
  returnTo: string;
  teamSize: number;
  todayKey: string;
}) {
  const capacity = dayCapacity({ dateKey, events, teamSize, todayKey });
  const actionable = events.filter((event) => mayAct(event, actor));

  return (
    <aside aria-label={`Detail for ${longDayLabel(dateKey)}`} className="calendar-drawer surface-card">
      <header className="calendar-drawer-head">
        <div>
          <p className="eyebrow">{WEEKDAY_NAMES[weekdayIndex(dateKey)].toUpperCase()} · {relativeDayLabel(dateKey, todayKey).toUpperCase()}</p>
          <h2>{longDayLabel(dateKey)}</h2>
          <span>{events.length} item{events.length === 1 ? "" : "s"}{actionable.length ? ` · ${actionable.length} you can action` : ""}</span>
        </div>
        <Link aria-label="Close the day detail" className="calendar-drawer-close" href={closeHref}>
          <X size={17} />
        </Link>
      </header>

      {capacity.holidayName && (
        <p className="calendar-drawer-banner is-closed">
          {capacity.holidayName} — the office is closed.
        </p>
      )}
      {capacity.warning && <p className="calendar-drawer-banner">{capacity.warning}</p>}
      {capacity.awayNames.length > 0 && (
        <p className="calendar-drawer-away">
          Away today: {capacity.awayNames.join(", ")}
          {teamSize > 0 && ` · ${capacity.workingHeads} of ${teamSize} available`}
        </p>
      )}

      {!events.length && (
        <EmptyState description="Nothing falls due on this day with the current filters." icon="calendar" title="A clear day" />
      )}

      <ol className="calendar-drawer-list">
        {events.map((event) => {
          const severity = severityFor(event, todayKey);
          return (
            <li className={`tone-${LAYER_TONE.get(event.layer) ?? "blue"} is-${severity}`} key={event.key}>
              <div className="calendar-drawer-item">
                <Link href={event.href}>
                  <strong>{event.title}</strong>
                  <small>{[event.clientName, event.subtitle].filter(Boolean).join(" · ")}</small>
                </Link>
                <span className="calendar-drawer-meta">
                  <em>{LAYER_LABEL.get(event.layer)}</em>
                  <small>{event.provisional ? "Not yet raised" : event.statusLabel}</small>
                  <small className={`calendar-severity is-${severity}`}>{SEVERITY_LABEL[severity]}</small>
                  <small>{event.ownerName || "Unassigned"}</small>
                </span>
              </div>

              {mayAct(event, actor) && event.action && (
                <div className="calendar-drawer-actions">
                  <form action={completeCalendarItemAction}>
                    <input name="kind" type="hidden" value={event.action.kind} />
                    <input name="itemId" type="hidden" value={event.action.id} />
                    <input name="returnTo" type="hidden" value={returnTo} />
                    <button className="ghost-button" type="submit">Mark complete</button>
                  </form>

                  {event.action.kind !== "todo" && members.length > 0 && (
                    <form action={reassignCalendarItemAction}>
                      <input name="kind" type="hidden" value={event.action.kind} />
                      <input name="itemId" type="hidden" value={event.action.id} />
                      <input name="returnTo" type="hidden" value={returnTo} />
                      <label className="sr-only" htmlFor={`reassign-${event.key}`}>Reassign {event.title}</label>
                      <select defaultValue={event.ownerId} id={`reassign-${event.key}`} name="memberId">
                        {members.map((member) => (
                          <option key={member.id} value={member.id}>{member.name}</option>
                        ))}
                      </select>
                      <button className="ghost-button" type="submit">Reassign</button>
                    </form>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </aside>
  );
}
