import assert from "node:assert/strict";
import test from "node:test";

import {
  calendarFacets,
  eventsByDay,
  filterCalendarEvents,
  occupiedDays,
  overdueBacklog,
  severityFor,
  sortCalendarEvents,
  summariseCalendar,
  type CalendarEvent,
} from "../lib/calendar/events";
import {
  buildMonthCells,
  buildWeekCells,
  dayCapacity,
  dayLoad,
  strainedDays,
} from "../lib/calendar/grid";
import { DEFAULT_CALENDAR_PARAMS, type CalendarParams } from "../lib/calendar/queue-params";

const TODAY = "2026-08-21";

/**
 * `endKey` follows `dateKey` unless a test names it, so moving an event's date
 * cannot accidentally turn it into a multi-day span.
 */
const event = (over: Partial<CalendarEvent> = {}): CalendarEvent => {
  const dateKey = over.dateKey ?? TODAY;
  return {
    action: null,
    amountPaise: null,
    clientId: "c1",
    clientName: "Koshi Infra LLP",
    dateKey,
    endKey: dateKey,
    estimateMinutes: null,
    href: "/work/w1",
    key: "work:w1",
    layer: "work",
    open: true,
    ownerId: "u1",
    ownerName: "Rahul K.",
    provisional: false,
    status: "at_risk",
    statusLabel: "At risk",
    subtitle: "August 2026",
    title: "GSTR-3B",
    ...over,
  };
};

const params = (over: Partial<CalendarParams> = {}): CalendarParams => ({ ...DEFAULT_CALENDAR_PARAMS, ...over });

test("a settled item whose date has passed is not overdue", () => {
  // Colouring a completed filing red because its date is behind us would teach
  // the reader that red means nothing, which costs the real overdue rows.
  assert.equal(severityFor(event({ dateKey: "2026-08-01", open: false }), TODAY), "settled");
  assert.equal(severityFor(event({ dateKey: "2026-08-01", open: true }), TODAY), "overdue");
});

test("severity bands run overdue, today, soon, later", () => {
  assert.equal(severityFor(event({ dateKey: TODAY }), TODAY), "today");
  assert.equal(severityFor(event({ dateKey: "2026-08-28" }), TODAY), "soon", "seven days is still soon");
  assert.equal(severityFor(event({ dateKey: "2026-08-29" }), TODAY), "later", "eight days is not");
});

test("a day lists what is late before what is merely due", () => {
  const sorted = sortCalendarEvents([
    event({ key: "b", dateKey: TODAY, layer: "todos", title: "Call the client" }),
    event({ key: "a", dateKey: TODAY, layer: "work", title: "GSTR-3B" }),
  ], TODAY);
  assert.deepEqual(sorted.map((entry) => entry.key), ["a", "b"], "statutory work outranks a personal note");
});

test("leave occupies every day it spans, not only the day it starts", () => {
  // A week away that marked only its first day would let somebody book a filing
  // into the middle of it.
  const away = event({ layer: "leave", dateKey: "2026-08-24", endKey: "2026-08-28", open: false });
  assert.deepEqual(occupiedDays(away, "2026-08-01", "2026-08-31"), [
    "2026-08-24", "2026-08-25", "2026-08-26", "2026-08-27", "2026-08-28",
  ]);
});

test("a span is clipped to the window being rendered", () => {
  const away = event({ layer: "leave", dateKey: "2026-07-30", endKey: "2026-08-03" });
  assert.deepEqual(occupiedDays(away, "2026-08-01", "2026-08-31"), ["2026-08-01", "2026-08-02", "2026-08-03"]);
});

test("the day index carries a span into every day it covers", () => {
  const byDay = eventsByDay([
    event({ key: "leave:1", layer: "leave", dateKey: "2026-08-20", endKey: "2026-08-22" }),
    event({ key: "work:1", dateKey: "2026-08-21" }),
  ], "2026-08-01", "2026-08-31", TODAY);
  assert.equal(byDay.get("2026-08-20")?.length, 1);
  assert.equal(byDay.get("2026-08-21")?.length, 2);
  assert.equal(byDay.get("2026-08-22")?.length, 1);
  assert.equal(byDay.get("2026-08-23"), undefined);
});

test("overdue work stays visible whatever month is on screen", () => {
  // The whole reason the backlog exists: a February miss must not scroll out of
  // sight because the reader is looking at March.
  const backlog = overdueBacklog([
    event({ key: "old", dateKey: "2026-02-15" }),
    event({ key: "done", dateKey: "2026-02-15", open: false }),
    event({ key: "future", dateKey: "2026-09-15" }),
    event({ key: "away", dateKey: "2026-02-15", layer: "leave" }),
    event({ key: "shut", dateKey: "2026-02-15", layer: "holidays" }),
  ], TODAY);
  assert.deepEqual(backlog.map((entry) => entry.key), ["old"]);
});

test("hidden layers are removed and nothing else is", () => {
  const events = [event({ key: "w", layer: "work" }), event({ key: "t", layer: "todos" })];
  assert.deepEqual(filterCalendarEvents(events, params({ hidden: ["todos"] })).map((entry) => entry.key), ["w"]);
  assert.equal(filterCalendarEvents(events, params()).length, 2);
});

test("hiding every layer empties the grid rather than silently restoring one", () => {
  // A reader who switched everything off must see an empty calendar saying so.
  // Quietly re-adding a layer would have them believe they had filtered it out.
  const events = [event({ key: "w", layer: "work" }), event({ key: "t", layer: "todos" })];
  assert.deepEqual(filterCalendarEvents(events, params({ hidden: ["work", "todos"] })), []);
});

test("the unassigned filter isolates work nobody owns", () => {
  const events = [event({ key: "owned", ownerId: "u1" }), event({ key: "orphan", ownerId: "" })];
  assert.deepEqual(filterCalendarEvents(events, params({ owner: "unassigned" })).map((entry) => entry.key), ["orphan"]);
  assert.deepEqual(filterCalendarEvents(events, params({ owner: "u1" })).map((entry) => entry.key), ["owned"]);
});

test("search reads the client and the owner, not only the title", () => {
  const events = [event({ key: "a", title: "GSTR-3B", clientName: "Koshi Infra LLP", ownerName: "Rahul K." })];
  for (const query of ["gstr", "koshi", "rahul", "august"]) {
    assert.equal(filterCalendarEvents(events, params({ q: query })).length, 1, `"${query}" must match`);
  }
  assert.equal(filterCalendarEvents(events, params({ q: "nothing here" })).length, 0);
});

test("the summary counts what is owed and ignores who is away", () => {
  const summary = summariseCalendar([
    event({ key: "late", dateKey: "2026-08-01" }),
    event({ key: "now", dateKey: TODAY }),
    event({ key: "soon", dateKey: "2026-08-25" }),
    event({ key: "later", dateKey: "2026-10-01" }),
    event({ key: "guess", dateKey: "2026-09-01", layer: "forecast", provisional: true, ownerId: "" }),
    event({ key: "orphan", dateKey: "2026-09-02", ownerId: "" }),
    event({ key: "away", dateKey: TODAY, layer: "leave", ownerId: "" }),
    event({ key: "shut", dateKey: TODAY, layer: "holidays", ownerId: "" }),
  ], TODAY);
  assert.equal(summary.overdue, 1);
  assert.equal(summary.dueToday, 1);
  assert.equal(summary.dueThisWeek, 2, "today plus the one inside seven days");
  assert.equal(summary.provisional, 1);
  assert.equal(summary.unassigned, 1, "a forecast row has no owner to be missing");
});

test("filter pickers offer only what the window actually holds", () => {
  const facets = calendarFacets([
    event({ clientId: "c2", clientName: "Zenith Foods", ownerId: "u2", ownerName: "Anita B." }),
    event({ clientId: "c1", clientName: "Koshi Infra LLP", ownerId: "u1", ownerName: "Rahul K." }),
    event({ clientId: "", clientName: "", ownerId: "", ownerName: "" }),
  ]);
  assert.deepEqual(facets.clients.map((entry) => entry.name), ["Koshi Infra LLP", "Zenith Foods"]);
  assert.deepEqual(facets.owners.map((entry) => entry.name), ["Anita B.", "Rahul K."]);
});

test("the month grid shows whole weeks including neighbouring days", () => {
  // A deadline on the 1st of next month is exactly what somebody reading the
  // last week of this one needs to see; a blank cell would hide it.
  const cells = buildMonthCells("2026-08-15", TODAY);
  assert.equal(cells.length % 7, 0);
  assert.equal(cells[0].dateKey, "2026-07-27", "August 2026 starts on a Saturday");
  assert.equal(cells[0].inMonth, false);
  assert.equal(cells.at(-1)?.dateKey, "2026-09-06");
  assert.equal(cells.filter((cell) => cell.inMonth).length, 31);
  assert.equal(cells.filter((cell) => cell.isToday).length, 1);
});

test("the week grid is the seven days from Monday", () => {
  const cells = buildWeekCells("2026-08-27", TODAY);
  assert.equal(cells.length, 7);
  assert.equal(cells[0].dateKey, "2026-08-24");
  assert.equal(cells.at(-1)?.dateKey, "2026-08-30");
});

test("a day of statutory filings weighs more than a day of reminders", () => {
  // Counting rows would shade a day of ten personal notes darker than a day of
  // three filings, and point the reader at the wrong day.
  const notes = dayLoad(Array.from({ length: 4 }, (_, index) => event({ key: `t${index}`, layer: "todos" })), TODAY);
  const filings = dayLoad(Array.from({ length: 3 }, (_, index) => event({ key: `w${index}`, layer: "work" })), TODAY);
  assert.ok(filings.weight > notes.weight, "three filings outweigh four reminders");
  assert.equal(notes.band, "busy");
  assert.equal(filings.band, "heavy");
  assert.equal(dayLoad([], TODAY).band, "clear");
  assert.equal(dayLoad([event({ layer: "todos" })], TODAY).band, "light");
});

test("settled work stops counting towards the day's load", () => {
  const load = dayLoad([event({ open: false }), event({ key: "w2" })], TODAY);
  assert.equal(load.deadlines, 1);
});

test("a deadline falling on a closed office is called out", () => {
  const capacity = dayCapacity({
    dateKey: "2026-08-15",
    events: [event({ dateKey: "2026-08-15" }), event({ key: "h", layer: "holidays", title: "Independence Day", dateKey: "2026-08-15", open: false })],
    teamSize: 5,
    todayKey: TODAY,
  });
  assert.equal(capacity.holidayName, "Independence Day");
  assert.equal(capacity.workingHeads, 0);
  assert.match(capacity.warning, /Independence Day/);
});

test("deadlines landing on the day half the office is away are flagged", () => {
  // The collision no queue sorted by due date can show, and the one a firm
  // actually misses.
  const capacity = dayCapacity({
    dateKey: TODAY,
    events: [
      event({ key: "w1" }),
      event({ key: "w2" }),
      event({ key: "a1", layer: "leave", ownerName: "Rahul K.", open: false }),
      event({ key: "a2", layer: "leave", ownerName: "Anita B.", open: false }),
    ],
    teamSize: 4,
    todayKey: TODAY,
  });
  assert.deepEqual(capacity.awayNames, ["Anita B.", "Rahul K."]);
  assert.equal(capacity.workingHeads, 2);
  assert.match(capacity.warning, /2 of 4 away/);
});

test("a quiet day with everyone in raises no warning", () => {
  const capacity = dayCapacity({ dateKey: TODAY, events: [event()], teamSize: 5, todayKey: TODAY });
  assert.equal(capacity.warning, "");
  assert.equal(capacity.workingHeads, 5);
});

test("the same person on two overlapping leave rows counts once", () => {
  const capacity = dayCapacity({
    dateKey: TODAY,
    events: [
      event({ key: "a1", layer: "leave", ownerName: "Rahul K.", open: false }),
      event({ key: "a2", layer: "leave", ownerName: "Rahul K.", open: false }),
      event({ key: "w1" }),
    ],
    teamSize: 4,
    todayKey: TODAY,
  });
  assert.deepEqual(capacity.awayNames, ["Rahul K."]);
  assert.equal(capacity.workingHeads, 3);
});

test("the strain strip lists the worst days first and skips the calm ones", () => {
  const byDay = eventsByDay([
    event({ key: "h", layer: "holidays", dateKey: "2026-08-15", title: "Independence Day", open: false }),
    event({ key: "w1", dateKey: "2026-08-15" }),
    event({ key: "w2", dateKey: "2026-08-15" }),
    event({ key: "w3", dateKey: "2026-08-15" }),
    event({ key: "calm", dateKey: "2026-08-18" }),
  ], "2026-08-01", "2026-08-31", TODAY);
  const strained = strainedDays({ byDay, fromKey: "2026-08-01", teamSize: 5, toKey: "2026-08-31", todayKey: TODAY });
  assert.deepEqual(strained.map((day) => day.dateKey), ["2026-08-15"]);
  assert.equal(strained[0].deadlines, 3);
});
