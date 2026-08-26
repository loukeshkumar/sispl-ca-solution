import { addDays, addMonths, isDateKey, startOfMonth, startOfWeek } from "./dates";

export type CalendarView = "month" | "week" | "agenda";

/**
 * One layer per thing the firm has a date for. They are listed rather than
 * inferred because the calendar's whole claim is that these are the deadlines
 * — a source that quietly stops appearing is worse than one never added.
 */
export type CalendarLayer =
  | "work"
  | "forecast"
  | "tasks"
  | "todos"
  | "documents"
  | "invoices"
  | "dsc"
  | "notices"
  | "holidays"
  | "leave";

export type CalendarParams = {
  client: string;
  /** The day the view is anchored on. Month view reads its month from this. */
  date: string;
  /** The day whose drawer is open, or "" when none is. */
  day: string;
  /** Layers the reader has switched off. Empty means everything is shown. */
  hidden: CalendarLayer[];
  owner: string;
  q: string;
  view: CalendarView;
};

export const CALENDAR_LAYERS: ReadonlyArray<{
  key: CalendarLayer;
  label: string;
  /** What the reader is being told to do about it, for the legend. */
  hint: string;
  tone: string;
}> = [
  { key: "work", label: "Statutory work", hint: "Filing deadlines the firm owns", tone: "violet" },
  { key: "forecast", label: "Forecast", hint: "Obligations the calendar will raise", tone: "slate" },
  { key: "tasks", label: "Office tasks", hint: "Assigned internal work", tone: "blue" },
  { key: "todos", label: "My to-dos", hint: "Your own reminders", tone: "mint" },
  { key: "documents", label: "Document chases", hint: "Records requested from clients", tone: "amber" },
  { key: "invoices", label: "Invoices due", hint: "Money owed to the firm", tone: "green" },
  { key: "dsc", label: "DSC expiry", hint: "Signature tokens about to lapse", tone: "orange" },
  { key: "notices", label: "Notice responses", hint: "Statutory replies with a clock", tone: "red" },
  { key: "holidays", label: "Holidays", hint: "Office closed", tone: "grey" },
  { key: "leave", label: "Team leave", hint: "Who is away", tone: "teal" },
];

const LAYER_KEYS: readonly CalendarLayer[] = CALENDAR_LAYERS.map((layer) => layer.key);
const VIEWS: readonly CalendarView[] = ["month", "week", "agenda"];
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * The month is what a practice plans in, and everything is on by default: a
 * calendar that opens already filtered has told the reader a half-truth about
 * what is due.
 */
export const DEFAULT_CALENDAR_PARAMS: CalendarParams = {
  client: "all",
  date: "",
  day: "",
  hidden: [],
  owner: "all",
  q: "",
  view: "month",
};

function first(raw: Record<string, string | string[] | undefined>, key: string) {
  const value = raw[key];
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

function idFilter(value: string, sentinel?: string) {
  if (sentinel && value === sentinel) return value;
  return UUID_PATTERN.test(value) ? value : "all";
}

export function parseCalendarParams(
  raw: Record<string, string | string[] | undefined>,
  todayKey: string,
): CalendarParams {
  const view = first(raw, "view");
  const date = first(raw, "date");
  const day = first(raw, "day");
  const hidden = first(raw, "hide")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry): entry is CalendarLayer => LAYER_KEYS.includes(entry as CalendarLayer));
  return {
    client: idFilter(first(raw, "client")),
    date: isDateKey(date) ? date : todayKey,
    day: isDateKey(day) ? day : "",
    // Hiding every layer is allowed and says so in the empty state. Silently
    // restoring a layer would leave the reader believing they had switched it
    // off, which is the one mistake a deadline calendar must not make.
    hidden: [...new Set(hidden)],
    owner: idFilter(first(raw, "owner"), "unassigned"),
    q: first(raw, "q").slice(0, 120),
    view: VIEWS.includes(view as CalendarView) ? (view as CalendarView) : DEFAULT_CALENDAR_PARAMS.view,
  };
}

export function calendarHref(params: Partial<CalendarParams>): string {
  const search = new URLSearchParams({ workspace: "calendar" });
  const merged = { ...DEFAULT_CALENDAR_PARAMS, ...params };
  if (merged.view !== DEFAULT_CALENDAR_PARAMS.view) search.set("view", merged.view);
  if (merged.date) search.set("date", merged.date);
  if (merged.owner !== "all") search.set("owner", merged.owner);
  if (merged.client !== "all") search.set("client", merged.client);
  if (merged.q) search.set("q", merged.q);
  if (merged.hidden.length) search.set("hide", [...merged.hidden].sort().join(","));
  if (merged.day) search.set("day", merged.day);
  return `/?${search.toString()}`;
}

/** Changing what is shown closes the day drawer: it was about the old view. */
export function calendarFilterHref(params: CalendarParams, change: Partial<CalendarParams>): string {
  return calendarHref({ ...params, day: "", ...change });
}

export function toggleLayerHref(params: CalendarParams, layer: CalendarLayer): string {
  const hidden = params.hidden.includes(layer)
    ? params.hidden.filter((entry) => entry !== layer)
    : [...params.hidden, layer];
  return calendarFilterHref(params, { hidden });
}

/** Only these layers survive; used by the grid, the drawer and the export alike. */
export function visibleLayers(params: CalendarParams): CalendarLayer[] {
  return LAYER_KEYS.filter((layer) => !params.hidden.includes(layer));
}

/**
 * Steps the anchor by whatever the current view measures in. Agenda steps by
 * month because it lists forward from its anchor, not by a week the reader
 * cannot see the edges of.
 */
export function stepAnchor(params: CalendarParams, direction: -1 | 1): string {
  if (params.view === "week") return addDays(startOfWeek(params.date), direction * 7);
  return addMonths(startOfMonth(params.date), direction);
}

export function calendarStepHref(params: CalendarParams, direction: -1 | 1): string {
  return calendarFilterHref(params, { date: stepAnchor(params, direction) });
}

export function hasActiveCalendarFilters(params: CalendarParams): boolean {
  return params.owner !== "all" || params.client !== "all" || params.q !== "" || params.hidden.length > 0;
}

/**
 * How much of the timeline the page loads. Wider than the view on purpose:
 * agenda reads forward past the anchor month, and a reader who steps back one
 * month should not be told the past is empty.
 */
export function calendarRange(params: CalendarParams): { from: string; to: string } {
  const anchor = params.view === "week" ? startOfWeek(params.date) : startOfMonth(params.date);
  return { from: addMonths(anchor, -2), to: addMonths(anchor, 4) };
}
