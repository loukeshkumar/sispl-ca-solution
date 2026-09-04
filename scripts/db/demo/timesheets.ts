/**
 * Effort against clients and work items for both demo months.
 *
 * The closed month is submitted by each employee and approved by a manager, so
 * the period reaches its terminal state. The current month is left open with
 * entries in it, which is what a live timesheet period looks like.
 */
import { and, eq } from "drizzle-orm";

import { legalEntities, timesheetPeriods, timesheetPolicies } from "../../../db/schema";
import type { DashboardDatabase } from "../../../lib/dashboard/postgres/repository";
import { decidePeriod, saveTimesheetPolicy, submitPeriod } from "../../../lib/timesheets/period-repository";
import { createTimeEntry } from "../../../lib/timesheets/repository";
import { lastDateKeyOf, type DemoContext } from "./context";

/** Seven hours a day against a client, five entries per employee per month. */
const ENTRY_MINUTES = 420;
const ENTRIES_PER_MONTH = 5;

async function ensurePolicy(database: DashboardDatabase, context: DemoContext) {
  const [existing] = await database.select({ id: timesheetPolicies.id }).from(timesheetPolicies)
    .where(eq(timesheetPolicies.tenantId, context.tenantId)).limit(1);
  if (existing) return;
  await saveTimesheetPolicy(database, context.tenantId, context.actors.administratorId, {
    allowFutureDates: false,
    // Wide enough that seeding a closed month is not itself a backdated entry
    // the policy would refuse.
    backdateWindowDays: 120,
    effectiveFrom: `${context.calendar.closedMonth}-01`,
    expectedMonthlyMinutes: 9_600,
  });
}

export async function seedDemoTimesheets(database: DashboardDatabase, context: DemoContext) {
  // The probe keys on the period, not on time entries: `seed.ts` already seeds
  // entries, so probing those would skip this module on every fresh database.
  const [existing] = await database.select({ id: timesheetPeriods.id }).from(timesheetPeriods)
    .where(and(eq(timesheetPeriods.tenantId, context.tenantId), eq(timesheetPeriods.periodKey, context.calendar.closedMonth))).limit(1);
  if (existing) return { timeEntries: 0, periodsApproved: 0 };

  await ensurePolicy(database, context);
  const clients = await database.select({ id: legalEntities.id }).from(legalEntities)
    .where(and(eq(legalEntities.tenantId, context.tenantId), eq(legalEntities.status, "active")))
    .orderBy(legalEntities.displayName);
  if (!clients.length) throw new Error("No active clients found; run db:seed:local first.");

  const { closedMonth, currentMonth, todayKey } = context.calendar;
  const recorders = context.actors.employees;
  let entries = 0;

  for (const periodKey of [closedMonth, currentMonth]) {
    const lastDay = Number(lastDateKeyOf(periodKey, todayKey).slice(-2));
    for (const [index, employee] of recorders.entries()) {
      for (let entry = 0; entry < ENTRIES_PER_MONTH; entry += 1) {
        // Spread across the month but never past the last permitted day.
        const day = Math.min(lastDay, 2 + entry * 5);
        if (day < 1) continue;
        await createTimeEntry(database, context.tenantId, employee.userId, {
          entryDate: `${periodKey}-${String(day).padStart(2, "0")}`,
          minutes: ENTRY_MINUTES,
          legalEntityId: clients[(index + entry) % clients.length].id,
          workItemId: null,
          officeTaskId: null,
          billable: entry % 4 !== 3,
          narration: "Seeded demonstration effort.",
        }, { backdateReason: "Seeded demonstration history." });
        entries += 1;
      }
    }
  }

  // Only the closed month is carried to approval. The current one stays open.
  let approved = 0;
  const reviewer = context.actors.managerIds[0] ?? context.actors.partnerId;
  for (const employee of recorders) {
    await submitPeriod(database, context.tenantId, employee.userId, closedMonth, todayKey);
    if (employee.userId === reviewer) continue;
    await decidePeriod(database, context.tenantId, reviewer, employee.userId, closedMonth, "approved", "Reviewed against the engagement plan.");
    approved += 1;
  }

  return { timeEntries: entries, periodsApproved: approved };
}
