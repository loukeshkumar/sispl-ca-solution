import { addDays, eachDay, endOfMonth, isWeekend, startOfMonth, startOfWeek, weekdayIndex } from "./dates";
import { severityFor, type CalendarEvent } from "./events";

export type CalendarCell = {
  dateKey: string;
  /** False for the leading and trailing days a six-week grid has to borrow. */
  inMonth: boolean;
  isToday: boolean;
  isWeekend: boolean;
};

/**
 * The whole weeks a month spans, Monday first.
 *
 * Adjacent days are rendered rather than blanked. A deadline on the 1st of next
 * month is exactly what somebody looking at the last week of this one needs to
 * see, and an empty cell hides it.
 */
export function buildMonthCells(anchorKey: string, todayKey: string): CalendarCell[] {
  const first = startOfMonth(anchorKey);
  const last = endOfMonth(anchorKey);
  const gridStart = addDays(first, -weekdayIndex(first));
  const gridEnd = addDays(last, 6 - weekdayIndex(last));
  const month = anchorKey.slice(0, 7);
  return eachDay(gridStart, gridEnd).map((dateKey) => ({
    dateKey,
    inMonth: dateKey.slice(0, 7) === month,
    isToday: dateKey === todayKey,
    isWeekend: isWeekend(dateKey),
  }));
}

export function buildWeekCells(anchorKey: string, todayKey: string): CalendarCell[] {
  const start = startOfWeek(anchorKey);
  return eachDay(start, addDays(start, 6)).map((dateKey) => ({
    dateKey,
    inMonth: true,
    isToday: dateKey === todayKey,
    isWeekend: isWeekend(dateKey),
  }));
}

/** How heavy a day looks at a glance, before anybody opens it. */
export type LoadBand = "clear" | "light" | "busy" | "heavy";

/**
 * Weighted rather than counted. Ten personal reminders is a full day of nothing
 * much; three statutory filings is a week of somebody's life, and a grid that
 * shaded them the same would point the reader at the wrong day.
 */
const LOAD_WEIGHTS: Record<string, number> = {
  work: 3,
  notices: 3,
  dsc: 2,
  documents: 1,
  tasks: 2,
  invoices: 1,
  forecast: 1,
  todos: 1,
  holidays: 0,
  leave: 0,
};

export function dayLoad(events: CalendarEvent[], todayKey: string): { band: LoadBand; deadlines: number; weight: number } {
  let weight = 0;
  let deadlines = 0;
  for (const event of events) {
    if (severityFor(event, todayKey) === "settled") continue;
    const eventWeight = LOAD_WEIGHTS[event.layer] ?? 1;
    if (eventWeight > 0) deadlines += 1;
    weight += eventWeight;
  }
  const band: LoadBand = weight === 0 ? "clear" : weight <= 3 ? "light" : weight <= 8 ? "busy" : "heavy";
  return { band, deadlines, weight };
}

export type DayCapacity = {
  /** Names of everyone away, so the warning can say who rather than how many. */
  awayNames: string[];
  deadlines: number;
  holidayName: string;
  /** The sentence to show, or "" when the day needs no warning. */
  warning: string;
  workingHeads: number;
};

/**
 * Whether a day has more falling due than people to do it.
 *
 * The collision is the point. A firm rarely misses a deadline it saw coming —
 * it misses the one that landed on the day half the office was at a wedding,
 * which no queue sorted by due date can show.
 */
export function dayCapacity(input: {
  dateKey: string;
  events: CalendarEvent[];
  teamSize: number;
  todayKey: string;
}): DayCapacity {
  const awayNames: string[] = [];
  let holidayName = "";
  for (const event of input.events) {
    if (event.layer === "leave" && event.ownerName) awayNames.push(event.ownerName);
    if (event.layer === "holidays" && !holidayName) holidayName = event.title;
  }
  const uniqueAway = [...new Set(awayNames)].sort();
  const { deadlines } = dayLoad(input.events, input.todayKey);
  const workingHeads = holidayName ? 0 : Math.max(0, input.teamSize - uniqueAway.length);

  let warning = "";
  if (deadlines > 0 && holidayName) {
    warning = `${deadlines} due on a closed day (${holidayName}).`;
  } else if (deadlines > 0 && input.teamSize > 0 && workingHeads === 0) {
    warning = `${deadlines} due with nobody in.`;
  } else if (deadlines >= 3 && workingHeads > 0 && deadlines > workingHeads * 2) {
    warning = `${deadlines} due across ${workingHeads} available.`;
  } else if (uniqueAway.length > 0 && deadlines > 0 && uniqueAway.length * 2 >= input.teamSize && input.teamSize > 0) {
    warning = `${deadlines} due with ${uniqueAway.length} of ${input.teamSize} away.`;
  }

  return { awayNames: uniqueAway, deadlines, holidayName, warning, workingHeads };
}

/**
 * Days in the window that need a warning, worst first. Drives the strain strip
 * above the grid, which is what turns the collision detection into something a
 * reader sees without hovering over every square.
 */
export function strainedDays(input: {
  byDay: Map<string, CalendarEvent[]>;
  fromKey: string;
  teamSize: number;
  toKey: string;
  todayKey: string;
}): Array<DayCapacity & { dateKey: string }> {
  const strained: Array<DayCapacity & { dateKey: string }> = [];
  for (const dateKey of eachDay(input.fromKey, input.toKey)) {
    const events = input.byDay.get(dateKey) ?? [];
    if (!events.length) continue;
    const capacity = dayCapacity({ dateKey, events, teamSize: input.teamSize, todayKey: input.todayKey });
    if (capacity.warning) strained.push({ ...capacity, dateKey });
  }
  return strained.sort((left, right) => right.deadlines - left.deadlines || left.dateKey.localeCompare(right.dateKey));
}
