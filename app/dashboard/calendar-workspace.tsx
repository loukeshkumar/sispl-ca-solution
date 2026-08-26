"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo } from "react";

import { longDayLabel, monthLabel, startOfWeek, addDays } from "../../lib/calendar/dates";
import {
  eventsByDay,
  filterCalendarEvents,
  overdueBacklog,
  sortCalendarEvents,
  summariseCalendar,
} from "../../lib/calendar/events";
import { buildMonthCells, buildWeekCells, strainedDays } from "../../lib/calendar/grid";
import {
  calendarFilterHref,
  calendarHref,
  calendarStepHref,
  hasActiveCalendarFilters,
  toggleLayerHref,
  type CalendarLayer,
  type CalendarParams,
  type CalendarView,
} from "../../lib/calendar/queue-params";
import type { CalendarWorkspaceData } from "../../lib/calendar/repository";
import { CalendarAgendaView } from "./calendar-agenda-view";
import { CalendarDayDrawer, type CalendarActor } from "./calendar-day-drawer";
import { CalendarMonthGrid } from "./calendar-month-grid";
import { CalendarEventRow, CalendarLegend } from "./calendar-parts";
import { CalendarWeekView } from "./calendar-week-view";
import { DashboardIcon } from "./dashboard-icons";
import { EmptyState, KpiCard, PageTitle } from "./dashboard-ui";
import { WorkDialogButton } from "./work-dialog";

const VIEWS: Array<{ key: CalendarView; label: string }> = [
  { key: "month", label: "Month" },
  { key: "week", label: "Week" },
  { key: "agenda", label: "Agenda" },
];

/** What each inline action reports back, in the words the reader needs. */
const NOTICES: Record<string, { tone: string; message: string }> = {
  completed: { tone: "mint", message: "Marked complete." },
  reassigned: { tone: "mint", message: "Reassigned." },
  refused: { tone: "amber", message: "That change was refused — open the item to see why." },
  failed: { tone: "red", message: "That change could not be saved. Try it from the item itself." },
  invalid: { tone: "red", message: "That item could not be identified." },
};

export type CalendarViewData = {
  actor: CalendarActor;
  data: CalendarWorkspaceData;
  members: Array<{ id: string; name: string }>;
  notice?: string;
  params: CalendarParams;
};

/**
 * Every dated obligation the firm carries, on one grid.
 *
 * The whole of this page's state lives in the URL — the month, the view, the
 * filters, the open day — so a partner can send "look at the 15th" as a link,
 * and a server action can return the reader to exactly where they were.
 */
export function CalendarWorkspace({ actor, data, members, notice, params }: CalendarViewData) {
  const router = useRouter();
  const { todayKey } = data;

  const visible = useMemo(() => filterCalendarEvents(data.events, params), [data.events, params]);

  const window = useMemo(() => {
    if (params.view === "week") {
      const start = startOfWeek(params.date);
      return { cells: buildWeekCells(params.date, todayKey), from: start, to: addDays(start, 6) };
    }
    const cells = buildMonthCells(params.date, todayKey);
    return { cells, from: cells[0].dateKey, to: cells[cells.length - 1].dateKey };
  }, [params.date, params.view, todayKey]);

  // Agenda reads forward from the anchor rather than stopping at the month, so
  // it indexes the whole loaded range.
  const indexFrom = params.view === "agenda" ? params.date : window.from;
  const indexTo = params.view === "agenda" ? data.rangeTo : window.to;
  const byDay = useMemo(
    () => eventsByDay(visible, indexFrom, indexTo, todayKey),
    [indexFrom, indexTo, todayKey, visible],
  );

  const summary = useMemo(() => summariseCalendar(visible, todayKey), [todayKey, visible]);
  const backlog = useMemo(() => overdueBacklog(visible, todayKey), [todayKey, visible]);
  const strain = useMemo(
    () => strainedDays({ byDay, fromKey: indexFrom, teamSize: data.teamSize, toKey: indexTo, todayKey }),
    [byDay, data.teamSize, indexFrom, indexTo, todayKey],
  );

  const agendaEvents = useMemo(
    () => sortCalendarEvents(visible.filter((event) => event.dateKey >= params.date), todayKey),
    [params.date, todayKey, visible],
  );

  const dayHref = (dateKey: string) => calendarHref({ ...params, day: dateKey });
  const layerHref = (layer: CalendarLayer) => toggleLayerHref(params, layer);
  const currentHref = calendarHref(params);
  /*
   * Indexed for the open day alone rather than read out of the grid's own
   * index. A day reached from the backlog or the strain strip is routinely
   * outside the month on screen, and taking it from the grid left those
   * drawers empty — the day looked clear when it was merely off-window.
   */
  const drawerEvents = useMemo(
    () => (params.day ? eventsByDay(visible, params.day, params.day, todayKey).get(params.day) ?? [] : []),
    [params.day, todayKey, visible],
  );

  const heading = params.view === "week"
    ? `Week of ${longDayLabel(startOfWeek(params.date))}`
    : params.view === "agenda"
      ? `From ${longDayLabel(params.date)}`
      : monthLabel(params.date);

  const navigate = (change: Partial<CalendarParams>) => router.push(calendarFilterHref(params, change));
  const noticeDetail = notice ? NOTICES[notice] : undefined;

  return (
    <div className="calendar-workspace">
      <PageTitle
        actions={
          <>
            <Link className="ghost-button" href={`/calendar/export?${new URLSearchParams({
              ...(params.client !== "all" ? { client: params.client } : {}),
              ...(params.owner !== "all" ? { owner: params.owner } : {}),
              ...(params.hidden.length ? { hide: [...params.hidden].sort().join(",") } : {}),
              ...(params.q ? { q: params.q } : {}),
            }).toString()}`} prefetch={false}>
              <DashboardIcon name="calendar" size={17} />Export .ics
            </Link>
            {actor.canWriteWork && (
              <WorkDialogButton title="Add deadline"><DashboardIcon name="plus" size={17} />Add deadline</WorkDialogButton>
            )}
          </>
        }
        description="Every dated obligation the firm carries — statutory filings, tasks, chases, notices, certificates and invoices — against who is actually in."
        eyebrow="PRACTICE CALENDAR"
        title="Calendar"
      />

      {noticeDetail && (
        <p className={`calendar-notice tone-${noticeDetail.tone}`} role="status">
          {noticeDetail.message} <Link href={currentHref}>Dismiss</Link>
        </p>
      )}

      <section className="kpi-grid">
        <KpiCard icon="alert" label="OVERDUE" note="Open and past its date" tone="red" value={String(summary.overdue).padStart(2, "0")} />
        <KpiCard icon="clock" label="DUE TODAY" note={longDayLabel(todayKey)} tone="amber" value={String(summary.dueToday).padStart(2, "0")} />
        <KpiCard icon="calendar" label="NEXT SEVEN DAYS" note="Including today" tone="blue" value={String(summary.dueThisWeek).padStart(2, "0")} />
        <KpiCard icon="waiting" label="UNASSIGNED" note="Open with no owner" tone="mint" value={String(summary.unassigned).padStart(2, "0")} />
      </section>

      <section className="calendar-controls surface-card">
        <div className="workspace-toolbar">
          <nav aria-label="Choose a calendar view" className="segment-control">
            {VIEWS.map((view) => (
              <Link
                aria-current={params.view === view.key ? "page" : undefined}
                href={calendarFilterHref(params, { view: view.key })}
                key={view.key}
              >
                {view.label}
              </Link>
            ))}
          </nav>

          <div className="calendar-stepper">
            <Link aria-label="Previous period" href={calendarStepHref(params, -1)}>←</Link>
            <h2 id="calendar-range-heading">{heading}</h2>
            <Link aria-label="Next period" href={calendarStepHref(params, 1)}>→</Link>
            <Link className="ghost-button" href={calendarFilterHref(params, { date: todayKey })}>Today</Link>
          </div>
        </div>

        <div className="workspace-toolbar">
          <form action="/" className="client-search" method="get">
            <input name="workspace" type="hidden" value="calendar" />
            <input name="view" type="hidden" value={params.view} />
            <input name="date" type="hidden" value={params.date} />
            {params.hidden.length > 0 && <input name="hide" type="hidden" value={[...params.hidden].sort().join(",")} />}
            <DashboardIcon name="search" size={17} />
            <input
              aria-label="Search the calendar by title, client, or owner"
              defaultValue={params.q}
              name="q"
              placeholder="Search deadlines, clients, owners..."
              type="search"
            />
          </form>

          <label className="calendar-filter">
            <span>Owner</span>
            <select onChange={(fired) => navigate({ owner: fired.target.value })} value={params.owner}>
              <option value="all">Everyone</option>
              <option value="unassigned">Unassigned</option>
              {data.owners.map((owner) => <option key={owner.id} value={owner.id}>{owner.name}</option>)}
            </select>
          </label>

          <label className="calendar-filter">
            <span>Client</span>
            <select onChange={(fired) => navigate({ client: fired.target.value })} value={params.client}>
              <option value="all">All clients</option>
              {data.clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
            </select>
          </label>

          {hasActiveCalendarFilters(params) && (
            <Link className="ghost-button" href={calendarHref({ date: params.date, view: params.view })}>Clear filters</Link>
          )}
        </div>

        <CalendarLegend hidden={params.hidden} layerHref={layerHref} permitted={data.permittedLayers} />
      </section>

      {strain.length > 0 && (
        <section aria-label="Days under strain" className="calendar-strain surface-card">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">PRESSURE POINTS</p>
              <h2>Days that will not fit</h2>
              <span>Deadlines measured against who is actually in</span>
            </div>
          </div>
          <ul>
            {strain.slice(0, 6).map((day) => (
              <li key={day.dateKey}>
                <Link href={dayHref(day.dateKey)}>
                  <strong>{longDayLabel(day.dateKey)}</strong>
                  <small>{day.warning}</small>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {backlog.length > 0 && (
        <section aria-label="Overdue backlog" className="calendar-backlog surface-card">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">STILL OPEN</p>
              <h2>Carried over from before today</h2>
              {/* Pinned above the grid on purpose: a month view cannot show a
                  miss that happened in a month nobody is looking at. */}
              <span>{backlog.length} item{backlog.length === 1 ? "" : "s"} past their date, whatever month is on screen</span>
            </div>
          </div>
          <div className="calendar-backlog-rows">
            {backlog.slice(0, 8).map((event) => (
              <CalendarEventRow event={event} key={event.key} showDate todayKey={todayKey} />
            ))}
          </div>
          {backlog.length > 8 && (
            <Link className="ghost-button" href={calendarFilterHref(params, { date: backlog[0].dateKey, view: "agenda" })}>
              See all {backlog.length} in agenda
            </Link>
          )}
        </section>
      )}

      <section className={`calendar-stage${params.day ? " has-drawer" : ""}`}>
        <article className="calendar-panel surface-card">
          {!data.permittedLayers.length ? (
            <EmptyState
              description="Your role does not include any of the registers this calendar draws from."
              icon="calendar"
              title="Nothing to show"
            />
          ) : params.hidden.length >= data.permittedLayers.length ? (
            <EmptyState
              description="Every layer is switched off. Turn one back on in the legend above."
              icon="calendar"
              title="All layers hidden"
            />
          ) : params.view === "month" ? (
            <CalendarMonthGrid byDay={byDay} cells={window.cells} dayHref={dayHref} teamSize={data.teamSize} todayKey={todayKey} />
          ) : params.view === "week" ? (
            <CalendarWeekView byDay={byDay} cells={window.cells} dayHref={dayHref} teamSize={data.teamSize} todayKey={todayKey} />
          ) : (
            <CalendarAgendaView dayHref={dayHref} events={agendaEvents} teamSize={data.teamSize} todayKey={todayKey} />
          )}
        </article>

        {params.day && (
          <CalendarDayDrawer
            actor={actor}
            closeHref={calendarHref({ ...params, day: "" })}
            dateKey={params.day}
            events={drawerEvents}
            members={members}
            returnTo={currentHref}
            teamSize={data.teamSize}
            todayKey={todayKey}
          />
        )}
      </section>
    </div>
  );
}
