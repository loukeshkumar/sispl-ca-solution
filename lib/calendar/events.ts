import type { DashboardData } from "../dashboard/types";
import { dayDifference } from "./dates";
import type { CalendarLayer, CalendarParams } from "./queue-params";

/**
 * How close an event is to biting. Distinct from status: a completed filing
 * whose date has passed is settled, not overdue, and colouring it red would
 * teach the reader to ignore the colour.
 */
export type CalendarSeverity = "overdue" | "today" | "soon" | "later" | "settled";

/** What the day drawer may do to an item without leaving the calendar. */
export type CalendarAction = { kind: "work" | "task" | "todo"; id: string };

export type CalendarEvent = {
  action: CalendarAction | null;
  amountPaise: number | null;
  clientId: string;
  clientName: string;
  dateKey: string;
  /** Last day of a span. Equal to `dateKey` for everything except leave. */
  endKey: string;
  estimateMinutes: number | null;
  href: string;
  /** Unique across layers, because two sources may share an underlying id. */
  key: string;
  layer: CalendarLayer;
  /** True while the item still needs doing. A settled item is never overdue. */
  open: boolean;
  ownerId: string;
  ownerName: string;
  /** Projected from the recurring calendar; nothing has been raised yet. */
  provisional: boolean;
  status: string;
  statusLabel: string;
  subtitle: string;
  title: string;
};

/** Deadlines land above notes when a day is crowded. */
const LAYER_RANK: Record<CalendarLayer, number> = {
  holidays: 0,
  work: 1,
  notices: 2,
  dsc: 3,
  documents: 4,
  tasks: 5,
  invoices: 6,
  forecast: 7,
  todos: 8,
  leave: 9,
};

const SEVERITY_RANK: Record<CalendarSeverity, number> = {
  overdue: 0,
  today: 1,
  soon: 2,
  later: 3,
  settled: 4,
};

/** Days ahead that still count as pressing rather than merely scheduled. */
export const SOON_HORIZON_DAYS = 7;

export function severityFor(event: CalendarEvent, todayKey: string): CalendarSeverity {
  if (!event.open) return "settled";
  const days = dayDifference(event.dateKey, todayKey);
  if (days < 0) return "overdue";
  if (days === 0) return "today";
  return days <= SOON_HORIZON_DAYS ? "soon" : "later";
}

/**
 * Sorted the way a day is read: what is late first, then what is due, then the
 * register it came from, so the same day always lists in the same order.
 */
export function sortCalendarEvents(events: CalendarEvent[], todayKey: string): CalendarEvent[] {
  return [...events].sort((left, right) => (
    left.dateKey.localeCompare(right.dateKey)
    || SEVERITY_RANK[severityFor(left, todayKey)] - SEVERITY_RANK[severityFor(right, todayKey)]
    || LAYER_RANK[left.layer] - LAYER_RANK[right.layer]
    || left.clientName.localeCompare(right.clientName)
    || left.title.localeCompare(right.title)
  ));
}

function matchesQuery(event: CalendarEvent, query: string) {
  if (!query) return true;
  const haystack = `${event.title} ${event.subtitle} ${event.clientName} ${event.ownerName}`.toLowerCase();
  return haystack.includes(query.toLowerCase());
}

/**
 * The owner filter reads "unassigned" as a real answer. Work nobody owns is
 * what a partner most wants to isolate, and treating it as "no filter" would
 * hide exactly that.
 */
function matchesOwner(event: CalendarEvent, owner: string) {
  if (owner === "all") return true;
  if (owner === "unassigned") return !event.ownerId;
  return event.ownerId === owner;
}

export function filterCalendarEvents(events: CalendarEvent[], params: CalendarParams): CalendarEvent[] {
  return events.filter((event) => (
    !params.hidden.includes(event.layer)
    && matchesOwner(event, params.owner)
    && (params.client === "all" || event.clientId === params.client)
    && matchesQuery(event, params.q)
  ));
}

/**
 * Every day the event occupies, not only the day it starts. Leave is the
 * reason: a week away that marked only its first day would let somebody book a
 * deadline into the middle of it.
 */
export function occupiedDays(event: CalendarEvent, fromKey: string, toKey: string): string[] {
  const span = dayDifference(event.endKey, event.dateKey);
  if (span <= 0) return event.dateKey >= fromKey && event.dateKey <= toKey ? [event.dateKey] : [];
  const [year, month, day] = event.dateKey.split("-").map(Number);
  const days: string[] = [];
  for (let index = 0; index <= span; index += 1) {
    const key = new Date(Date.UTC(year, month - 1, day + index)).toISOString().slice(0, 10);
    if (key >= fromKey && key <= toKey) days.push(key);
  }
  return days;
}

export function eventsByDay(
  events: CalendarEvent[],
  fromKey: string,
  toKey: string,
  todayKey: string,
): Map<string, CalendarEvent[]> {
  const byDay = new Map<string, CalendarEvent[]>();
  for (const event of sortCalendarEvents(events, todayKey)) {
    for (const key of occupiedDays(event, fromKey, toKey)) {
      const bucket = byDay.get(key);
      if (bucket) bucket.push(event);
      else byDay.set(key, [event]);
    }
  }
  return byDay;
}

/**
 * Open items whose date has already passed, whatever month is being viewed.
 *
 * A month grid answers "what is due in March"; it cannot answer "what did we
 * miss in February", and a practice calendar that lets a missed filing scroll
 * out of sight is the failure this page exists to prevent.
 */
export function overdueBacklog(events: CalendarEvent[], todayKey: string): CalendarEvent[] {
  return sortCalendarEvents(
    events.filter((event) => (
      event.open && event.dateKey < todayKey && event.layer !== "leave" && event.layer !== "holidays"
    )),
    todayKey,
  );
}

export type CalendarSummary = {
  dueThisWeek: number;
  dueToday: number;
  overdue: number;
  provisional: number;
  unassigned: number;
};

/** Layers that describe availability rather than something owed. */
const CONTEXT_LAYERS: readonly CalendarLayer[] = ["leave", "holidays"];

/** Layers with no assignee column, so silence about an owner is not a gap. */
const UNOWNABLE_LAYERS: readonly CalendarLayer[] = ["todos", "invoices", "forecast"];

export function summariseCalendar(events: CalendarEvent[], todayKey: string): CalendarSummary {
  const summary: CalendarSummary = { dueThisWeek: 0, dueToday: 0, overdue: 0, provisional: 0, unassigned: 0 };
  for (const event of events) {
    if (CONTEXT_LAYERS.includes(event.layer)) continue;
    if (event.provisional) summary.provisional += 1;
    const severity = severityFor(event, todayKey);
    if (severity === "overdue") summary.overdue += 1;
    if (severity === "today") summary.dueToday += 1;
    if (severity === "today" || severity === "soon") summary.dueThisWeek += 1;
    if (event.open && !event.ownerId && !UNOWNABLE_LAYERS.includes(event.layer)) summary.unassigned += 1;
  }
  return summary;
}

/** Owners and clients present in the loaded window, for the filter pickers. */
export function calendarFacets(events: CalendarEvent[]) {
  const owners = new Map<string, string>();
  const clients = new Map<string, string>();
  for (const event of events) {
    if (event.ownerId) owners.set(event.ownerId, event.ownerName);
    if (event.clientId) clients.set(event.clientId, event.clientName);
  }
  const byName = (left: { name: string }, right: { name: string }) => left.name.localeCompare(right.name);
  return {
    clients: [...clients].map(([id, name]) => ({ id, name })).sort(byName),
    owners: [...owners].map(([id, name]) => ({ id, name })).sort(byName),
  };
}

const DASHBOARD_STATUS_LABELS: Record<string, string> = {
  Critical: "Critical",
  "At risk": "At risk",
  Waiting: "Waiting on client",
  Review: "In review",
  Completed: "Completed",
};

/**
 * The demo data source has no calendar tables behind it, only the dashboard
 * fixture. Rendering the same component from it keeps a demo honest, instead of
 * showing an empty grid that reads as "nothing is due".
 */
export function dashboardCalendarEvents(data: DashboardData): CalendarEvent[] {
  return data.work.map((item) => ({
    action: null,
    amountPaise: null,
    clientId: "",
    clientName: item.client,
    dateKey: item.dueDate,
    endKey: item.dueDate,
    estimateMinutes: null,
    href: `/work/${item.id}`,
    key: `work:${item.id}`,
    layer: "work" as CalendarLayer,
    open: item.status !== "Completed",
    ownerId: "",
    ownerName: item.owner,
    provisional: false,
    status: item.status,
    statusLabel: DASHBOARD_STATUS_LABELS[item.status] ?? item.status,
    subtitle: `${item.client} · ${item.period}`,
    title: item.service,
  }));
}
