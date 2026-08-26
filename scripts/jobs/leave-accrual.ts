import { pathToFileURL } from "node:url";

import { and, eq } from "drizzle-orm";

import { employeeProfiles, tenantMemberships } from "../../db/schema";
import { indiaDateKey } from "../../lib/attendance/calculations";
import { leaveYearKey } from "../../lib/attendance/leave-ledger";
import { ensureEntitlementPostings, findServiceDates, listLeaveTypePolicies } from "../../lib/attendance/leave-ledger-repository";
import { closePostgresPool, getDatabase } from "../../lib/dashboard/postgres/pool";
import type { DashboardDatabase } from "../../lib/dashboard/postgres/repository";
import { listActiveTenantIds } from "../../lib/notifications/repository";

/**
 * Materialise leave entitlement for everyone.
 *
 * Balances are also brought up to date whenever one is read, so this job is not
 * what makes them correct — it is what makes them *complete*, for the people
 * nobody happened to look at this month. Everything it writes carries a dedupe
 * key, so running it twice in a day, or after a manual run, changes nothing.
 *
 * It also posts the year-end movements: what carries into a new leave year, and
 * what lapses when the carry-forward window closes. Those have no other trigger
 * — nobody visits the workspace on 1 April to make them happen.
 */
export async function runLeaveAccrualJob(now = new Date()) {
  const database = getDatabase();
  const todayKey = indiaDateKey(now);
  const leaveYear = leaveYearKey(todayKey);
  const tenantIds = await listActiveTenantIds(database);
  let employeesProcessed = 0;
  let failures = 0;

  for (const tenantId of tenantIds) {
    const policies = await listLeaveTypePolicies(database, tenantId);
    if (policies.length === 0) continue;
    const employees = await activeEmployees(database, tenantId);
    for (const employeeUserId of employees) {
      const service = await findServiceDates(database, tenantId, employeeUserId);
      if (!service) continue;
      employeesProcessed += 1;
      for (const policy of policies) {
        // One employee's bad data must not stop the firm's payroll month.
        try {
          await ensureEntitlementPostings(database, tenantId, employeeUserId, policy, leaveYear, service, todayKey);
        } catch {
          failures += 1;
        }
      }
    }
  }
  return { employeesProcessed, failures, leaveYear, tenants: tenantIds.length, todayKey };
}

async function activeEmployees(database: DashboardDatabase, tenantId: string) {
  const rows = await database.select({ userId: employeeProfiles.userId })
    .from(employeeProfiles)
    .innerJoin(tenantMemberships, and(
      eq(tenantMemberships.tenantId, employeeProfiles.tenantId),
      eq(tenantMemberships.userId, employeeProfiles.userId),
    ))
    .where(and(eq(employeeProfiles.tenantId, tenantId), eq(tenantMemberships.status, "active")));
  return rows.map((row) => row.userId);
}

async function main() {
  const summary = await runLeaveAccrualJob();
  console.info("leave.accrual.job.completed", summary);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .catch((error) => {
      console.error("leave.accrual.job.failed", { errorType: error instanceof Error ? error.name : "UnknownError", message: error instanceof Error ? error.message : "" });
      process.exitCode = 1;
    })
    .finally(async () => {
      await closePostgresPool();
    });
}
