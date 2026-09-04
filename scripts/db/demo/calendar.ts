/**
 * Holidays, which must exist before any attendance month is prepared.
 *
 * Active public holidays are removed from scheduled working days both when a
 * month is prepared and again when it is locked. Seeding attendance first would
 * mark every employee absent on a firm closure, so this module runs ahead of it.
 */
import { and, eq } from "drizzle-orm";

import { holidayCalendar } from "../../../db/schema";
import { saveHoliday } from "../../../lib/attendance-masters/repository";
import type { DashboardDatabase } from "../../../lib/dashboard/postgres/repository";
import type { DemoContext } from "./context";

/** The seeded firm keeps a Bihar attendance policy on a six-day working week. */
const JURISDICTION = "Bihar";

/** One closure in each demo month, placed on a date the working-week mask includes. */
function holidaysFor(context: DemoContext) {
  return [
    { periodKey: context.calendar.closedMonth, day: "15", name: "Firm closure" },
    { periodKey: context.calendar.currentMonth, day: "02", name: "Founders' day" },
  ].map((holiday) => ({
    holidayDate: `${holiday.periodKey}-${holiday.day}`,
    name: holiday.name,
    holidayType: "public" as const,
    jurisdictionState: JURISDICTION,
    status: "active" as const,
  }));
}

export async function seedDemoHolidays(database: DashboardDatabase, context: DemoContext) {
  let created = 0;
  for (const holiday of holidaysFor(context)) {
    const [existing] = await database.select({ id: holidayCalendar.id }).from(holidayCalendar).where(and(
      eq(holidayCalendar.tenantId, context.tenantId),
      eq(holidayCalendar.holidayDate, holiday.holidayDate),
    )).limit(1);
    if (existing) continue;
    await saveHoliday(database, context.tenantId, context.actors.administratorId, holiday);
    created += 1;
  }
  return { holidays: created };
}
