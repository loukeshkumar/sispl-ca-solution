import { and, eq, inArray, ne, notInArray, sql } from "drizzle-orm";

import {
  dscCertificates,
  employeeCapabilities,
  employeeProfiles,
  officeTasks,
  serviceCatalog,
  tenantMemberships,
  workItems,
} from "../../db/schema";
import type { DashboardDatabase } from "../dashboard/postgres/repository";
import { listLeaveTypePolicies } from "../attendance/leave-ledger-repository";
import { leaveYearKey } from "../attendance/leave-ledger";
import { leaveLedgerEntries } from "../../db/schema";
import { buildClearance, type Clearance } from "./offboarding";

/**
 * Gathering the exit clearance from what the firm already records.
 *
 * Each query answers one question a departing employee's manager would
 * otherwise have to remember to ask.
 */
export async function buildExitClearance(
  database: DashboardDatabase,
  tenantId: string,
  employeeUserId: string,
  todayKey: string,
): Promise<Clearance> {
  const openWorkStatuses = ["critical", "at_risk", "waiting", "review"];
  const openTaskStatuses = ["todo", "in_progress", "waiting", "review"];

  const [dsc, workAssigned, workReviewing, tasksAssigned, tasksReviewing, reportees, capabilities, encashable] = await Promise.all([
    database.select({ value: sql<number>`count(*)::int` }).from(dscCertificates).where(and(
      eq(dscCertificates.tenantId, tenantId),
      eq(dscCertificates.custodianUserId, employeeUserId),
      inArray(dscCertificates.status, ["in_custody", "issued_out"]),
    )),
    database.select({ value: sql<number>`count(*)::int` }).from(workItems).where(and(
      eq(workItems.tenantId, tenantId),
      eq(workItems.assigneeId, employeeUserId),
      inArray(workItems.status, openWorkStatuses),
    )),
    database.select({ value: sql<number>`count(*)::int` }).from(workItems).where(and(
      eq(workItems.tenantId, tenantId),
      eq(workItems.reviewerId, employeeUserId),
      inArray(workItems.status, openWorkStatuses),
    )),
    database.select({ value: sql<number>`count(*)::int` }).from(officeTasks).where(and(
      eq(officeTasks.tenantId, tenantId),
      eq(officeTasks.assigneeId, employeeUserId),
      inArray(officeTasks.status, openTaskStatuses),
    )),
    database.select({ value: sql<number>`count(*)::int` }).from(officeTasks).where(and(
      eq(officeTasks.tenantId, tenantId),
      eq(officeTasks.reviewerId, employeeUserId),
      inArray(officeTasks.status, openTaskStatuses),
    )),
    database.select({ value: sql<number>`count(*)::int` }).from(employeeProfiles)
      .innerJoin(tenantMemberships, and(
        eq(tenantMemberships.tenantId, employeeProfiles.tenantId),
        eq(tenantMemberships.userId, employeeProfiles.userId),
      ))
      .where(and(
        eq(employeeProfiles.tenantId, tenantId),
        eq(tenantMemberships.status, "active"),
        sql`exists (select 1 from employee_work_profiles ewp where ewp.tenant_id = ${tenantId} and ewp.employee_user_id = ${employeeProfiles.userId} and ewp.manager_user_id = ${employeeUserId})`,
      )),
    // Every review-capable rating in the firm, so "only person who can" is a
    // fact rather than an assumption.
    database.select({
      employeeUserId: employeeCapabilities.employeeUserId,
      serviceCode: employeeCapabilities.serviceCode,
    }).from(employeeCapabilities)
      .innerJoin(tenantMemberships, and(
        eq(tenantMemberships.tenantId, employeeCapabilities.tenantId),
        eq(tenantMemberships.userId, employeeCapabilities.employeeUserId),
      ))
      .where(and(
        eq(employeeCapabilities.tenantId, tenantId),
        inArray(employeeCapabilities.level, ["review", "sign"]),
        eq(tenantMemberships.status, "active"),
      )),
    encashableBalance(database, tenantId, employeeUserId, todayKey),
  ]);

  const soleReviewerCodes = [...new Set(
    capabilities.filter((row) => row.employeeUserId === employeeUserId).map((row) => row.serviceCode.toUpperCase()),
  )].filter((code) => !capabilities.some((row) => (
    row.employeeUserId !== employeeUserId && row.serviceCode.toUpperCase() === code
  )));

  const serviceNames = soleReviewerCodes.length === 0 ? [] : await database
    .select({ code: serviceCatalog.code, name: serviceCatalog.name }).from(serviceCatalog)
    .where(and(eq(serviceCatalog.tenantId, tenantId), inArray(serviceCatalog.code, soleReviewerCodes)));

  return buildClearance({
    dscInCustody: dsc[0]?.value ?? 0,
    leaveToEncashHalfDays: encashable,
    openOfficeTasksAssigned: tasksAssigned[0]?.value ?? 0,
    openOfficeTasksReviewing: tasksReviewing[0]?.value ?? 0,
    openWorkAssigned: workAssigned[0]?.value ?? 0,
    openWorkReviewing: workReviewing[0]?.value ?? 0,
    reportees: reportees[0]?.value ?? 0,
    soleReviewerServices: soleReviewerCodes.map(
      (code) => serviceNames.find((row) => row.code.toUpperCase() === code)?.name ?? code,
    ),
  });
}

/** Half-days of encashable leave still standing, across the encashable types. */
async function encashableBalance(
  database: DashboardDatabase,
  tenantId: string,
  employeeUserId: string,
  todayKey: string,
): Promise<number> {
  const policies = (await listLeaveTypePolicies(database, tenantId)).filter((policy) => policy.encashableOnExit);
  if (policies.length === 0) return 0;
  const [row] = await database.select({ total: sql<number>`coalesce(sum(${leaveLedgerEntries.halfDays}), 0)::int` })
    .from(leaveLedgerEntries).where(and(
      eq(leaveLedgerEntries.tenantId, tenantId),
      eq(leaveLedgerEntries.employeeUserId, employeeUserId),
      eq(leaveLedgerEntries.leaveYear, leaveYearKey(todayKey)),
      inArray(leaveLedgerEntries.leaveTypeCode, policies.map((policy) => policy.code)),
    ));
  return Math.max(0, row?.total ?? 0);
}

export type EmploymentStageInput = {
  effectiveOn: string;
  reason: string;
  stage: "probation" | "confirmed" | "notice";
};

/** Rows the Employees workspace needs to show who is mid-lifecycle. */
export async function countByStage(database: DashboardDatabase, tenantId: string) {
  const rows = await database.select({
    stage: employeeProfiles.employmentStage,
    value: sql<number>`count(*)::int`,
  }).from(employeeProfiles)
    .innerJoin(tenantMemberships, and(
      eq(tenantMemberships.tenantId, employeeProfiles.tenantId),
      eq(tenantMemberships.userId, employeeProfiles.userId),
    ))
    .where(and(eq(employeeProfiles.tenantId, tenantId), ne(tenantMemberships.status, "disabled")))
    .groupBy(employeeProfiles.employmentStage);
  return Object.fromEntries(rows.map((row) => [row.stage, row.value])) as Record<string, number>;
}

export const openTaskStatuses = ["todo", "in_progress", "waiting", "review"] as const;

export const hasOpenTasks = async (database: DashboardDatabase, tenantId: string, employeeUserId: string) => {
  const [row] = await database.select({ id: officeTasks.id }).from(officeTasks).where(and(
    eq(officeTasks.tenantId, tenantId),
    eq(officeTasks.assigneeId, employeeUserId),
    notInArray(officeTasks.status, ["completed", "cancelled"]),
  )).limit(1);
  return Boolean(row);
};
