import { NextResponse } from "next/server";

import { authorizeRoutePermission } from "../../../lib/auth/server";
import { addMonths } from "../../../lib/calendar/dates";
import { filterCalendarEvents } from "../../../lib/calendar/events";
import { icsFilename, toIcsCalendar } from "../../../lib/calendar/ics";
import { permittedCalendarLayers } from "../../../lib/calendar/permissions";
import { parseCalendarParams } from "../../../lib/calendar/queue-params";
import { indiaDateKey, listCalendarWorkspace } from "../../../lib/calendar/repository";
import { getDatabase } from "../../../lib/dashboard/postgres/pool";

/**
 * How much of the timeline a subscriber gets. Wider than any on-screen view:
 * the file is read in Outlook weeks after it was taken, and a feed that stopped
 * at the end of the month the reader happened to be on would quietly go stale.
 */
const BACKWARD_MONTHS = 3;
const FORWARD_MONTHS = 12;

/**
 * The firm's deadlines as an `.ics` file.
 *
 * A deadline that lives only inside this application is one somebody misses on
 * the day they are working out of their mail client. The export honours the
 * same filters the page was showing, so what is downloaded is what was on
 * screen — and the same permission gate, so it cannot widen anybody's view.
 */
export async function GET(request: Request) {
  const authorization = await authorizeRoutePermission("dashboard:read");
  if (!authorization.ok) {
    return NextResponse.json(
      { error: "The calendar export is unavailable." },
      { status: authorization.reason === "authentication_required" ? 401 : 403 },
    );
  }

  const session = authorization.session;
  const todayKey = indiaDateKey();
  const query = Object.fromEntries(new URL(request.url).searchParams);
  const params = parseCalendarParams(query, todayKey);
  const permittedLayers = permittedCalendarLayers(session);

  const from = addMonths(`${todayKey.slice(0, 7)}-01`, -BACKWARD_MONTHS);
  const to = addMonths(`${todayKey.slice(0, 7)}-01`, FORWARD_MONTHS);

  let workspace;
  try {
    workspace = await listCalendarWorkspace(
      getDatabase(),
      session.tenantId,
      { name: session.fullName, userId: session.userId },
      { from, permittedLayers, to, todayKey },
    );
  } catch (error) {
    console.error("Calendar export failed.", { errorType: error instanceof Error ? error.name : "UnknownError" });
    return NextResponse.json({ error: "The calendar export is unavailable." }, { status: 500 });
  }

  const body = toIcsCalendar(filterCalendarEvents(workspace.events, params), {
    name: "SISPL practice deadlines",
    stamp: new Date(),
  });

  return new NextResponse(body, {
    headers: {
      // Never cached by a proxy: the file carries one reader's permitted view.
      "Cache-Control": "private, no-store",
      "Content-Disposition": `attachment; filename="${icsFilename(todayKey)}"`,
      "Content-Type": "text/calendar; charset=utf-8",
    },
  });
}
