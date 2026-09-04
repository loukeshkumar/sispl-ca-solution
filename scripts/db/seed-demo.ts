/**
 * Transactional history for the seeded firm, so every workspace opens with
 * something in it.
 *
 * `seed.ts` creates masters: roles, the service catalogue, clients, employees,
 * salary structures, rate versions. It creates no attendance, payroll, invoices,
 * documents, timesheets or registers, so those workspaces render empty. This
 * script fills them by calling the same functions the product calls, which is
 * what makes every state it produces one the product can actually reach — and
 * what makes audit events and notifications appear rather than be fabricated.
 *
 * It is opt-in and is never part of `db:setup:local`. Setting up a real firm
 * must not deposit invented payroll runs and invoices in its books.
 */
import { and, eq } from "drizzle-orm";
import { pathToFileURL } from "node:url";

import { employeeProfiles, tenantMemberships, tenants, users } from "../../db/schema";
import { SEEDED_TENANT_ID } from "../../lib/dashboard/fixtures";
import { closePostgresPool, getDatabase } from "../../lib/dashboard/postgres/pool";
import type { DashboardDatabase } from "../../lib/dashboard/postgres/repository";
import { seedDemoAttendance } from "./demo/attendance";
import { seedDemoBilling } from "./demo/billing";
import { seedDemoHolidays } from "./demo/calendar";
import { resolveDemoCalendar, type DemoActors, type DemoContext } from "./demo/context";
import { seedDemoDocuments } from "./demo/documents";
import { seedDemoPayroll } from "./demo/payroll";
import { seedDemoRegisters } from "./demo/registers";
import { seedDemoTimesheets } from "./demo/timesheets";

export class DemoSeedError extends Error {}

/**
 * Resolves who performs each action from the seeded fixture. Failing here, with
 * an instruction, beats failing four modules later on a foreign key.
 */
async function resolveActors(database: DashboardDatabase, tenantId: string): Promise<DemoActors> {
  const [tenant] = await database.select({ id: tenants.id }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  if (!tenant) throw new DemoSeedError("The seeded tenant does not exist. Run `npm run db:seed:local` first.");

  // An employee profile carries no status of its own; the membership is what
  // says whether the person is still active in this tenant.
  const members = await database
    .select({ userId: users.id, roleKey: tenantMemberships.roleKey })
    .from(employeeProfiles)
    .innerJoin(users, eq(users.id, employeeProfiles.userId))
    .innerJoin(tenantMemberships, and(eq(tenantMemberships.userId, users.id), eq(tenantMemberships.tenantId, tenantId)))
    .where(and(eq(employeeProfiles.tenantId, tenantId), eq(tenantMemberships.status, "active")))
    .orderBy(users.id);

  const employees = members.map((member) => ({ userId: member.userId, roleKey: member.roleKey ?? "associate" }));
  const administratorId = employees.find((member) => member.roleKey === "firm_administrator")?.userId;
  const partnerId = employees.find((member) => member.roleKey === "partner")?.userId;
  if (!administratorId) throw new DemoSeedError("No firm administrator found. Run `npm run db:seed:local` first.");
  if (!partnerId) {
    // Payroll approval by the person who submitted it is an audited override.
    // Without a partner the demo could only show the exceptional path.
    throw new DemoSeedError("No partner found; payroll approval needs someone other than the preparer.");
  }

  return {
    administratorId,
    partnerId,
    managerIds: employees.filter((member) => member.roleKey === "manager").map((member) => member.userId),
    associateIds: employees.filter((member) => member.roleKey === "associate").map((member) => member.userId),
    employees,
  };
}

/**
 * Modules run in dependency order and each one probes for its own work before
 * starting. A failure part-way leaves earlier modules applied; re-running skips
 * what is already there, so the fix-and-retry loop converges rather than
 * duplicating.
 *
 * This cannot be one transaction — every service function opens its own.
 */
export async function seedDemoHistory(
  database: DashboardDatabase,
  options: { tenantId?: string; now?: Date } = {},
) {
  const tenantId = options.tenantId ?? SEEDED_TENANT_ID;
  const context: DemoContext = {
    tenantId,
    calendar: resolveDemoCalendar(options.now ?? new Date()),
    actors: await resolveActors(database, tenantId),
  };

  const modules = [
    // Holidays first: they leave the scheduled working days when a month is
    // prepared, so attendance seeded ahead of them marks a firm closure absent.
    { name: "calendar", run: () => seedDemoHolidays(database, context) },
    { name: "attendance", run: () => seedDemoAttendance(database, context) },
    { name: "payroll", run: () => seedDemoPayroll(database, context) },
    { name: "billing", run: () => seedDemoBilling(database, context) },
    { name: "documents", run: () => seedDemoDocuments(database, context) },
    { name: "timesheets", run: () => seedDemoTimesheets(database, context) },
    { name: "registers", run: () => seedDemoRegisters(database, context) },
  ];

  const summary: Record<string, unknown> = { closedMonth: context.calendar.closedMonth, currentMonth: context.calendar.currentMonth };
  for (const step of modules) {
    try {
      summary[step.name] = await step.run();
    } catch (error) {
      throw new DemoSeedError(`Demo seed failed in the ${step.name} module: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return summary;
}

async function main() {
  const database = getDatabase();
  const summary = await seedDemoHistory(database);
  console.log(`Demo history seeded. Closed month ${summary.closedMonth}, current month ${summary.currentMonth}.`);
  console.log(JSON.stringify(summary, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    })
    .finally(closePostgresPool);
}
