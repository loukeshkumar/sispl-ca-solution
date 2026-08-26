import { pathToFileURL } from "node:url";

import { and, asc, desc, eq, lte } from "drizzle-orm";

import { attendancePolicies, leaveRequests } from "../../db/schema";
import { indiaDateKey } from "../../lib/attendance/calculations";
import {
  consumptionForRequest,
  findServiceDates,
  listLeaveTypePolicies,
  postLeaveConsumption,
} from "../../lib/attendance/leave-ledger-repository";
import { closePostgresPool, getDatabase } from "../../lib/dashboard/postgres/pool";
import type { DashboardDatabase } from "../../lib/dashboard/postgres/repository";
import { listActiveTenantIds } from "../../lib/notifications/repository";
import { runLeaveAccrualJob } from "../jobs/leave-accrual";

/**
 * Bring the entitlement ledger up to date with leave that was already approved.
 *
 * Before the ledger existed, leave was granted with nothing recording what it
 * spent. Opening every balance at the full quota would tell each employee they
 * have a year's leave untouched, which is worse than no number at all — so this
 * replays every approved request through the same consumption rule the live
 * path uses, and lets the accrual job supply the grants.
 *
 * Idempotent: consumption is keyed by request, accruals by month, so running it
 * again after new approvals only adds what is missing.
 */
export async function backfillLeaveLedger(now = new Date()) {
  const database = getDatabase();
  const todayKey = indiaDateKey(now);

  // Grants first: a consumption posted against an empty year would read as a
  // balance that was always negative.
  const accrual = await runLeaveAccrualJob(now);

  const tenantIds = await listActiveTenantIds(database);
  let requestsReplayed = 0;
  let skipped = 0;

  for (const tenantId of tenantIds) {
    const policies = new Map((await listLeaveTypePolicies(database, tenantId)).map((policy) => [policy.code, policy]));
    if (policies.size === 0) continue;
    const approved = await approvedLeave(database, tenantId);

    for (const request of approved) {
      if (request.paidClassification !== "paid" || !policies.has(request.leaveType)) { skipped += 1; continue; }
      const service = await findServiceDates(database, tenantId, request.employeeUserId);
      if (!service) { skipped += 1; continue; }
      const policy = await policyMaskFor(database, tenantId, request.dateFrom);
      const consumption = await consumptionForRequest(database, tenantId, service, {
        dateFrom: request.dateFrom, dateTo: request.dateTo,
        dayPortion: request.dayPortion as "full" | "first_half" | "second_half",
      }, policy.workingWeekMask, policy.jurisdictionState);
      await postLeaveConsumption(database, tenantId, request.employeeUserId, request, consumption);
      requestsReplayed += 1;
    }
  }
  return { accrual, requestsReplayed, skipped, todayKey };
}

async function approvedLeave(database: DashboardDatabase, tenantId: string) {
  return database.select({
    dateFrom: leaveRequests.dateFrom,
    dateTo: leaveRequests.dateTo,
    dayPortion: leaveRequests.dayPortion,
    employeeUserId: leaveRequests.employeeUserId,
    id: leaveRequests.id,
    leaveType: leaveRequests.leaveType,
    paidClassification: leaveRequests.paidClassification,
  }).from(leaveRequests)
    .where(and(eq(leaveRequests.tenantId, tenantId), eq(leaveRequests.status, "approved")))
    .orderBy(asc(leaveRequests.dateFrom));
}

/**
 * The working week in force when the leave was taken, so a policy change since
 * then does not rewrite what an old request cost.
 */
async function policyMaskFor(database: DashboardDatabase, tenantId: string, dateKey: string) {
  const [policy] = await database.select({
    jurisdictionState: attendancePolicies.jurisdictionState,
    workingWeekMask: attendancePolicies.workingWeekMask,
  }).from(attendancePolicies)
    .where(and(eq(attendancePolicies.tenantId, tenantId), lte(attendancePolicies.effectiveFrom, dateKey)))
    .orderBy(desc(attendancePolicies.effectiveFrom)).limit(1);
  return policy ?? { jurisdictionState: "Bihar", workingWeekMask: "1111110" };
}

async function main() {
  const summary = await backfillLeaveLedger();
  console.info("leave.ledger.backfill.completed", summary);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .catch((error) => {
      console.error("leave.ledger.backfill.failed", { errorType: error instanceof Error ? error.name : "UnknownError", message: error instanceof Error ? error.message : "" });
      process.exitCode = 1;
    })
    .finally(async () => {
      await closePostgresPool();
    });
}
