import assert from "node:assert/strict";
import test from "node:test";

import {
  CALENDAR_LAYERS,
  DEFAULT_CALENDAR_PARAMS,
  calendarFilterHref,
  calendarHref,
  calendarRange,
  calendarStepHref,
  hasActiveCalendarFilters,
  parseCalendarParams,
  stepAnchor,
  toggleLayerHref,
  visibleLayers,
  type CalendarParams,
} from "../lib/calendar/queue-params";
import {
  escapeIcsText,
  foldIcsLine,
  icsExportable,
  icsFilename,
  icsStamp,
  toIcsCalendar,
} from "../lib/calendar/ics";
import type { CalendarEvent } from "../lib/calendar/events";

const TODAY = "2026-08-21";
const UUID = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
const OTHER_UUID = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";

const params = (over: Partial<CalendarParams> = {}): CalendarParams => ({
  ...DEFAULT_CALENDAR_PARAMS,
  date: TODAY,
  ...over,
});

test("an absent or malformed anchor falls back to today", () => {
  // A bookmark carrying a nonsense date must open on today rather than render a
  // month around a day that does not exist.
  assert.equal(parseCalendarParams({}, TODAY).date, TODAY);
  assert.equal(parseCalendarParams({ date: "2026-02-30" }, TODAY).date, TODAY);
  assert.equal(parseCalendarParams({ date: "not-a-date" }, TODAY).date, TODAY);
  assert.equal(parseCalendarParams({ date: "2026-03-15" }, TODAY).date, "2026-03-15");
});

test("an unknown view falls back to the month", () => {
  assert.equal(parseCalendarParams({ view: "gantt" }, TODAY).view, "month");
  assert.equal(parseCalendarParams({ view: "week" }, TODAY).view, "week");
  assert.equal(parseCalendarParams({ view: "agenda" }, TODAY).view, "agenda");
});

test("only real layer keys survive the hide list", () => {
  const parsed = parseCalendarParams({ hide: "work,nonsense,todos,work" }, TODAY);
  assert.deepEqual(parsed.hidden, ["work", "todos"], "unknown keys dropped, duplicates collapsed");
});

test("owner and client filters accept only ids, plus the unassigned sentinel", () => {
  // A filter that quietly accepted arbitrary text would narrow the calendar to
  // nothing and read as a quiet month.
  assert.equal(parseCalendarParams({ owner: UUID }, TODAY).owner, UUID);
  assert.equal(parseCalendarParams({ owner: "unassigned" }, TODAY).owner, "unassigned");
  assert.equal(parseCalendarParams({ owner: "rahul" }, TODAY).owner, "all");
  assert.equal(parseCalendarParams({ client: UUID }, TODAY).client, UUID);
  assert.equal(parseCalendarParams({ client: "unassigned" }, TODAY).client, "all", "clients have no unassigned state");
});

test("the search term is bounded", () => {
  assert.equal(parseCalendarParams({ q: "x".repeat(500) }, TODAY).q.length, 120);
  assert.equal(parseCalendarParams({ q: "  gstr  " }, TODAY).q, "gstr");
});

test("the drawer day is validated like any other date", () => {
  assert.equal(parseCalendarParams({ day: "2026-08-15" }, TODAY).day, "2026-08-15");
  assert.equal(parseCalendarParams({ day: "2026-02-31" }, TODAY).day, "");
  assert.equal(parseCalendarParams({}, TODAY).day, "");
});

test("a link carries only what differs from the default", () => {
  assert.equal(calendarHref({ date: TODAY }), `/?workspace=calendar&date=${TODAY}`);
  assert.equal(
    calendarHref({ date: TODAY, view: "week", owner: UUID }),
    `/?workspace=calendar&view=week&date=${TODAY}&owner=${UUID}`,
  );
});

test("every link round-trips back through the parser", () => {
  // The URL is the only state this page has; a link that parsed back to
  // something else would lose the reader's view on every navigation.
  const original = params({ client: OTHER_UUID, day: "2026-08-15", hidden: ["todos", "leave"], owner: UUID, q: "gstr", view: "agenda" });
  const query = Object.fromEntries(new URL(calendarHref(original), "http://x").searchParams);
  assert.deepEqual(parseCalendarParams(query, TODAY), { ...original, hidden: ["leave", "todos"] });
});

test("changing a filter closes the day drawer", () => {
  // The drawer was opened about the old view; leaving it open would show a day
  // detail that no longer matches what is on the grid behind it.
  const href = calendarFilterHref(params({ day: "2026-08-15" }), { owner: UUID });
  assert.equal(href.includes("day="), false);
  assert.equal(href.includes(`owner=${UUID}`), true);
});

test("a layer toggle adds and removes it", () => {
  const on = params();
  const hidden = toggleLayerHref(on, "todos");
  assert.equal(hidden.includes("hide=todos"), true);
  const restored = toggleLayerHref(params({ hidden: ["todos"] }), "todos");
  assert.equal(restored.includes("hide="), false);
});

test("visible layers are every layer minus the hidden ones", () => {
  assert.equal(visibleLayers(params()).length, CALENDAR_LAYERS.length);
  assert.deepEqual(visibleLayers(params({ hidden: ["work", "leave"] })).includes("work"), false);
});

test("stepping moves by whatever the current view measures in", () => {
  // A week view that stepped by a month, or a month view that stepped by seven
  // days, would leave the reader unable to say what they were looking at.
  assert.equal(stepAnchor(params({ view: "month", date: "2026-08-15" }), 1), "2026-09-01");
  assert.equal(stepAnchor(params({ view: "month", date: "2026-08-15" }), -1), "2026-07-01");
  assert.equal(stepAnchor(params({ view: "week", date: "2026-08-27" }), 1), "2026-08-31");
  assert.equal(stepAnchor(params({ view: "week", date: "2026-08-27" }), -1), "2026-08-17");
  assert.equal(stepAnchor(params({ view: "agenda", date: "2026-08-15" }), 1), "2026-09-01");
});

test("stepping from a 31-day month does not skip February", () => {
  assert.equal(stepAnchor(params({ view: "month", date: "2026-01-31" }), 1), "2026-02-01");
  assert.equal(calendarStepHref(params({ view: "month", date: "2026-01-31" }), 1).includes("date=2026-02-01"), true);
});

test("the loaded window is wider than the view", () => {
  // Agenda reads forward past the anchor month, and stepping back one month
  // must not be told the past is empty.
  const range = calendarRange(params({ view: "month", date: "2026-08-15" }));
  assert.equal(range.from, "2026-06-01");
  assert.equal(range.to, "2026-12-01");
  assert.ok(range.from < range.to);
});

test("active filters are reported so the page can offer a reset", () => {
  assert.equal(hasActiveCalendarFilters(params()), false);
  assert.equal(hasActiveCalendarFilters(params({ view: "week" })), false, "a view is not a filter");
  assert.equal(hasActiveCalendarFilters(params({ owner: UUID })), true);
  assert.equal(hasActiveCalendarFilters(params({ hidden: ["todos"] })), true);
  assert.equal(hasActiveCalendarFilters(params({ q: "gstr" })), true);
});

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

const STAMP = new Date("2026-08-21T04:30:00.000Z");

test("ICS text escapes exactly what the specification names", () => {
  assert.equal(escapeIcsText("Smith, Jones & Co; Ltd"), "Smith\\, Jones & Co\\; Ltd");
  assert.equal(escapeIcsText("path\\to"), "path\\\\to");
  assert.equal(escapeIcsText("line one\nline two"), "line one\\nline two");
  assert.equal(escapeIcsText("line one\r\nline two"), "line one\\nline two");
  assert.equal(escapeIcsText("plain"), "plain", "nothing else is touched");
});

test("long lines fold and short lines are left alone", () => {
  assert.equal(foldIcsLine("SUMMARY:short"), "SUMMARY:short");
  const folded = foldIcsLine(`SUMMARY:${"a".repeat(200)}`);
  assert.ok(folded.includes("\r\n "), "continuation lines start with a space");
  for (const line of folded.split("\r\n")) {
    assert.ok(Buffer.byteLength(line, "utf8") <= 75, `line over the octet limit: ${line.length}`);
  }
});

test("folding counts octets, not characters", () => {
  // A client name in Devanagari is three bytes a glyph; folding on character
  // count would push the line past the limit some parsers enforce.
  const folded = foldIcsLine(`SUMMARY:${"क".repeat(60)}`);
  for (const line of folded.split("\r\n")) {
    assert.ok(Buffer.byteLength(line, "utf8") <= 75, "multi-byte line stayed inside the limit");
  }
});

test("the stamp is UTC to the second", () => {
  assert.equal(icsStamp(STAMP), "20260821T043000Z");
});

test("who is away is not exported", () => {
  // Leave and holidays are context inside the application. Exporting them would
  // duplicate rows the firm's HR calendar already owns.
  const exported = icsExportable([
    event({ key: "work:1" }),
    event({ key: "leave:1", layer: "leave" }),
    event({ key: "holiday:1", layer: "holidays" }),
  ]);
  assert.deepEqual(exported.map((entry) => entry.key), ["work:1"]);
});

test("an all-day deadline ends on the following day", () => {
  // DTEND is exclusive in RFC 5545. Writing the same date twice produces a
  // zero-length event that Outlook drops.
  const ics = toIcsCalendar([event({ dateKey: "2026-08-20", endKey: "2026-08-20" })], { name: "Test", stamp: STAMP });
  assert.ok(ics.includes("DTSTART;VALUE=DATE:20260820"));
  assert.ok(ics.includes("DTEND;VALUE=DATE:20260821"));
});

test("a leave-style span exports its whole range", () => {
  const ics = toIcsCalendar([event({ dateKey: "2026-08-20", endKey: "2026-08-24" })], { name: "Test", stamp: STAMP });
  assert.ok(ics.includes("DTEND;VALUE=DATE:20260825"));
});

test("a forecast row is exported as tentative and carries no alarm", () => {
  // Nothing has been raised yet; an alarm would chase somebody about work that
  // does not exist.
  const ics = toIcsCalendar([event({ provisional: true, title: "GSTR-1" })], { name: "Test", stamp: STAMP });
  assert.ok(ics.includes("STATUS:TENTATIVE"));
  assert.ok(ics.includes("SUMMARY:[Forecast] GSTR-1"));
  assert.equal(ics.includes("BEGIN:VALARM"), false);
});

test("an open deadline carries a reminder the day before", () => {
  const ics = toIcsCalendar([event()], { name: "Test", stamp: STAMP });
  assert.ok(ics.includes("BEGIN:VALARM"));
  assert.ok(ics.includes("TRIGGER:-P1D"));
  assert.ok(ics.includes("STATUS:CONFIRMED"));
});

test("a settled deadline is exported without a reminder", () => {
  const ics = toIcsCalendar([event({ open: false })], { name: "Test", stamp: STAMP });
  assert.ok(ics.includes("STATUS:COMPLETED"));
  assert.equal(ics.includes("BEGIN:VALARM"), false);
});

test("the calendar wraps its events and ends with CRLF", () => {
  const ics = toIcsCalendar([event()], { baseUrl: "https://firm.example", name: "SISPL deadlines", stamp: STAMP });
  assert.ok(ics.startsWith("BEGIN:VCALENDAR\r\n"));
  assert.ok(ics.endsWith("END:VCALENDAR\r\n"));
  assert.equal(ics.split("\r\n").filter((line) => line === "BEGIN:VEVENT").length, 1);
  assert.ok(ics.includes("X-WR-CALNAME:SISPL deadlines"));
  assert.ok(ics.includes("URL:https://firm.example/work/w1"));
  assert.ok(ics.includes("UID:work:w1@sispl-ca-solution"));
});

test("an empty calendar is still a valid calendar", () => {
  const ics = toIcsCalendar([], { name: "Empty", stamp: STAMP });
  assert.equal(ics.includes("BEGIN:VEVENT"), false);
  assert.ok(ics.startsWith("BEGIN:VCALENDAR\r\n"));
  assert.ok(ics.endsWith("END:VCALENDAR\r\n"));
});

test("the download is named for the day it was taken", () => {
  assert.equal(icsFilename(TODAY), "practice-calendar-2026-08-21.ics");
});
