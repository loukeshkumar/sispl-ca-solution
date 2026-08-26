import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, lte, sql } from "drizzle-orm";

import {
  attendancePeriodSummaries, attendancePeriods, auditEvents, employeeProfiles, payrollEntries,
  payrollEntryLines, payrollRuns, salaryStructureLines, salaryStructures, tenantMemberships, users,
} from "../../db/schema";
import type { Role } from "../auth/authorization";
import type { DashboardDatabase } from "../dashboard/postgres/repository";
import { insertNotifications } from "../notifications/repository";
import { calculatePayrollEntry, calculateVarianceBasisPoints } from "./calculations";
import { formatPaise } from "./money";
import type { PayrollEntryInput, SalaryStructureInput } from "./validation";

export class PayrollRepositoryError extends Error {
  constructor(public readonly code:
    | "not_found" | "invalid_state" | "attendance_not_locked" | "missing_attendance" | "missing_salary"
    | "duplicate_version" | "separation_required" | "override_reason_required" | "entry_on_hold") {
    super({
      not_found: "Payroll record not found or unavailable.",
      invalid_state: "This payroll action is no longer available.",
      attendance_not_locked: "Lock attendance for this month before preparing payroll.",
      missing_attendance: "Locked attendance summaries are required before payroll can be prepared.",
      missing_salary: "Every employee in attendance must have an effective salary structure.",
      duplicate_version: "Salary effective dates must be later than the employee's current salary version.",
      separation_required: "Payroll approval must be completed by a different authorized person.",
      override_reason_required: "A firm administrator override requires a reason.",
      entry_on_hold: "Resolve every payroll hold before submission.",
    }[code]);
    this.name = "PayrollRepositoryError";
  }
}

export type PayrollRunStatus = "draft" | "submitted" | "approved_locked" | "payslips_published" | "paid";
export type SalaryEmployeeView = { employeeCode: string; fullName: string; userId: string; designation: string; salaryEffectiveFrom: string | null; monthlyGrossPaise: number | null };
export type SalaryRunView = { id: string; payDate: string; periodKey: string; status: PayrollRunStatus; employeeCount: number; totalDeductionsPaise: number; totalGrossPaise: number; totalNetPaise: number; updatedAt: string };
export type PayslipSummary = { entryId: string; netPayPaise: number; payDate: string; periodKey: string; status: "payslips_published" | "paid" };
export type SalaryWorkspaceData = {
  canManage: boolean;
  employees: SalaryEmployeeView[];
  metrics: { activeStructures: number; draftRuns: number; payableEmployees: number; publishedPayslips: number; totalNetPaise: number };
  ownPayslips: PayslipSummary[];
  periodKey: string;
  runs: SalaryRunView[];
};
export type PublishedPayslip = {
  entry: {
    id: string; employeeCode: string; employeeName: string; designation: string; periodScheduledHalfDays: number; employmentExcludedHalfDays: number;
    scheduledHalfDays: number; payableHalfDays: number; lopHalfDays: number; fullGrossPaise: number; earnedGrossPaise: number;
    employmentProrationDeductionPaise: number; attendanceDeductionPaise: number; recurringDeductionPaise: number;
    oneTimeAdditionPaise: number; oneTimeDeductionPaise: number; employeeProvidentFundPaise: number; employeeStateInsurancePaise: number;
    professionalTaxPaise: number; incomeTaxPaise: number; totalDeductionsPaise: number; netPayPaise: number; employerCostPaise: number; note: string;
  };
  lines: Array<{ amountPaise: number; code: string; kind: string; label: string; source: string }>;
  run: { id: string; payDate: string; periodKey: string; status: PayrollRunStatus; paymentReference: string };
};
export type SalaryStructureEditorData = {
  employee: { employeeCode: string; fullName: string; userId: string; designation: string };
  current: { effectiveFrom: string; lines: SalaryStructureInput["lines"] } | null;
};
export type PayrollRunDetail = {
  entries: Array<{
    id: string; employeeUserId: string; employeeCode: string; employeeName: string; designation: string;
    periodScheduledHalfDays: number; employmentExcludedHalfDays: number; scheduledHalfDays: number; payableHalfDays: number;
    lopHalfDays: number; fullGrossPaise: number; earnedGrossPaise: number; employmentProrationDeductionPaise: number;
    attendanceDeductionPaise: number; oneTimeAdditionPaise: number; oneTimeDeductionPaise: number; employeeProvidentFundPaise: number;
    employeeStateInsurancePaise: number; professionalTaxPaise: number; incomeTaxPaise: number; totalDeductionsPaise: number;
    netPayPaise: number; hold: boolean; holdReason: string; note: string;
  }>;
  run: SalaryRunView & { preparedByUserId: string; submittedByUserId: string | null; transitionReason: string; paymentReference: string };
};

type TransactionDatabase = Parameters<Parameters<DashboardDatabase["transaction"]>[0]>[0];
const managerRoles = new Set<Role>(["firm_administrator", "partner"]);

function requireIdentity(tenantId: string, userId: string) {
  if (!tenantId.trim() || !userId.trim()) throw new Error("Tenant and user are required.");
}

function endOfMonth(periodKey: string) {
  const [year, month] = periodKey.split("-").map(Number);
  const day = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${periodKey}-${String(day).padStart(2, "0")}`;
}

async function insertAudit(database: TransactionDatabase, tenantId: string, actorUserId: string, resourceId: string, action: string, reason = "") {
  await database.insert(auditEvents).values({ id: randomUUID(), tenantId, actorUserId, resourceType: "payroll", resourceId, action, reason: reason || null });
}

export async function recordPayrollAccess(database: DashboardDatabase, tenantId: string, actorUserId: string, resourceId: string, action: "payroll.workspace_viewed" | "payroll.run_viewed" | "payroll.payslip_viewed" | "payroll.export_viewed" | "salary_structure.viewed") {
  requireIdentity(tenantId, actorUserId);
  await database.insert(auditEvents).values({ id: randomUUID(), tenantId, actorUserId, resourceType: "payroll", resourceId, action });
}

function assertApprovalActor(actorRole: Role, reason: string) {
  if (!managerRoles.has(actorRole)) throw new PayrollRepositoryError("invalid_state");
  if (reason.trim().length < 3) {
    if (actorRole === "firm_administrator") throw new PayrollRepositoryError("override_reason_required");
    throw new PayrollRepositoryError("invalid_state");
  }
}

async function lockedRun(database: TransactionDatabase, tenantId: string, runId: string) {
  const [run] = await database.select().from(payrollRuns).where(and(
    eq(payrollRuns.tenantId, tenantId), eq(payrollRuns.id, runId),
  )).for("update").limit(1);
  if (!run) throw new PayrollRepositoryError("not_found");
  return run;
}

async function recalculateRunTotals(database: TransactionDatabase, tenantId: string, runId: string) {
  const [totals] = await database.select({
    totalDeductionsPaise: sql<number>`coalesce(sum(${payrollEntries.totalDeductionsPaise}), 0)`.mapWith(Number),
    totalGrossPaise: sql<number>`coalesce(sum(${payrollEntries.fullGrossPaise} + ${payrollEntries.oneTimeAdditionPaise}), 0)`.mapWith(Number),
    totalNetPaise: sql<number>`coalesce(sum(${payrollEntries.netPayPaise}), 0)`.mapWith(Number),
  }).from(payrollEntries).where(and(eq(payrollEntries.tenantId, tenantId), eq(payrollEntries.payrollRunId, runId)));
  await database.update(payrollRuns).set({ ...totals, updatedAt: new Date(), version: sql`${payrollRuns.version} + 1` }).where(and(
    eq(payrollRuns.tenantId, tenantId), eq(payrollRuns.id, runId), eq(payrollRuns.status, "draft"),
  ));
}

export async function listSalaryWorkspace(
  database: DashboardDatabase, tenantId: string, viewerUserId: string, viewerRole: Role, periodKey: string,
): Promise<SalaryWorkspaceData> {
  requireIdentity(tenantId, viewerUserId);
  await recordPayrollAccess(database, tenantId, viewerUserId, tenantId, "payroll.workspace_viewed");
  const canManage = managerRoles.has(viewerRole);
  const ownPayslipRows = await database.select({
    entryId: payrollEntries.id, netPayPaise: payrollEntries.netPayPaise, payDate: payrollRuns.payDate,
    periodKey: payrollRuns.periodKey, status: payrollRuns.status,
  }).from(payrollEntries).innerJoin(payrollRuns, and(
    eq(payrollRuns.tenantId, tenantId), eq(payrollRuns.id, payrollEntries.payrollRunId),
  )).where(and(
    eq(payrollEntries.tenantId, tenantId), eq(payrollEntries.employeeUserId, viewerUserId),
    inArray(payrollRuns.status, ["payslips_published", "paid"]),
  )).orderBy(desc(payrollRuns.periodKey));
  const ownPayslips = ownPayslipRows.map((row) => ({ ...row, status: row.status as "payslips_published" | "paid" }));
  if (!canManage) return {
    canManage: false, employees: [], metrics: { activeStructures: 0, draftRuns: 0, payableEmployees: 0, publishedPayslips: ownPayslips.length, totalNetPaise: 0 },
    ownPayslips, periodKey, runs: [],
  };

  const [employeeRows, structureRows, runRows] = await Promise.all([
    database.select({ employeeCode: employeeProfiles.employeeCode, fullName: users.fullName, userId: employeeProfiles.userId, designation: employeeProfiles.designation })
      .from(employeeProfiles).innerJoin(users, eq(users.id, employeeProfiles.userId)).innerJoin(tenantMemberships, and(
        eq(tenantMemberships.tenantId, tenantId), eq(tenantMemberships.userId, employeeProfiles.userId), eq(tenantMemberships.status, "active"),
      )).where(eq(employeeProfiles.tenantId, tenantId)).orderBy(asc(users.fullName)),
    database.select({ employeeUserId: salaryStructures.employeeUserId, effectiveFrom: salaryStructures.effectiveFrom, monthlyGrossPaise: sql<number>`coalesce(sum(${salaryStructureLines.monthlyAmountPaise}) filter (where ${salaryStructureLines.kind} = 'earning'), 0)`.mapWith(Number) })
      .from(salaryStructures).innerJoin(salaryStructureLines, and(eq(salaryStructureLines.tenantId, tenantId), eq(salaryStructureLines.salaryStructureId, salaryStructures.id)))
      .where(and(eq(salaryStructures.tenantId, tenantId), eq(salaryStructures.status, "active"))).groupBy(salaryStructures.id),
    database.select({ id: payrollRuns.id, payDate: payrollRuns.payDate, periodKey: payrollRuns.periodKey, status: payrollRuns.status,
      totalDeductionsPaise: payrollRuns.totalDeductionsPaise, totalGrossPaise: payrollRuns.totalGrossPaise, totalNetPaise: payrollRuns.totalNetPaise,
      updatedAt: payrollRuns.updatedAt, employeeCount: sql<number>`count(${payrollEntries.id})`.mapWith(Number),
    }).from(payrollRuns).leftJoin(payrollEntries, and(eq(payrollEntries.tenantId, tenantId), eq(payrollEntries.payrollRunId, payrollRuns.id)))
      .where(eq(payrollRuns.tenantId, tenantId)).groupBy(payrollRuns.id).orderBy(desc(payrollRuns.periodKey)),
  ]);
  const salaryByEmployee = new Map(structureRows.map((row) => [row.employeeUserId, row]));
  const employees = employeeRows.map((employee) => ({
    ...employee, salaryEffectiveFrom: salaryByEmployee.get(employee.userId)?.effectiveFrom ?? null,
    monthlyGrossPaise: salaryByEmployee.get(employee.userId)?.monthlyGrossPaise ?? null,
  }));
  const runs = runRows.map((row) => ({ ...row, status: row.status as PayrollRunStatus, updatedAt: row.updatedAt.toISOString() }));
  const current = runs.find((run) => run.periodKey === periodKey);
  return {
    canManage: true,
    employees,
    metrics: {
      activeStructures: employees.filter((employee) => employee.salaryEffectiveFrom).length,
      draftRuns: runs.filter((run) => run.status === "draft").length,
      payableEmployees: current?.employeeCount ?? 0,
      publishedPayslips: ownPayslips.length,
      totalNetPaise: current?.totalNetPaise ?? 0,
    },
    ownPayslips, periodKey, runs,
  };
}

export async function getPublishedPayslip(
  database: DashboardDatabase, tenantId: string, viewerUserId: string, entryId: string, canManage: boolean,
): Promise<PublishedPayslip | null> {
  requireIdentity(tenantId, viewerUserId);
  const employeeScope = canManage ? eq(payrollEntries.tenantId, tenantId) : eq(payrollEntries.employeeUserId, viewerUserId);
  const [row] = await database.select({
    entry: payrollEntries,
    run: { id: payrollRuns.id, payDate: payrollRuns.payDate, periodKey: payrollRuns.periodKey, status: payrollRuns.status, paymentReference: payrollRuns.paymentReference },
  }).from(payrollEntries).innerJoin(payrollRuns, and(eq(payrollRuns.tenantId, tenantId), eq(payrollRuns.id, payrollEntries.payrollRunId))).where(and(
    eq(payrollEntries.tenantId, tenantId), eq(payrollEntries.id, entryId), employeeScope,
    inArray(payrollRuns.status, ["payslips_published", "paid"]),
  )).limit(1);
  if (!row) return null;
  const lines = await database.select({ amountPaise: payrollEntryLines.amountPaise, code: payrollEntryLines.code, kind: payrollEntryLines.kind, label: payrollEntryLines.label, source: payrollEntryLines.source })
    .from(payrollEntryLines).where(and(eq(payrollEntryLines.tenantId, tenantId), eq(payrollEntryLines.payrollEntryId, entryId))).orderBy(asc(payrollEntryLines.code));
  await recordPayrollAccess(database, tenantId, viewerUserId, entryId, "payroll.payslip_viewed");
  return {
    entry: {
      id: row.entry.id, employeeCode: row.entry.employeeCodeSnapshot, employeeName: row.entry.employeeNameSnapshot, designation: row.entry.designationSnapshot,
      periodScheduledHalfDays: row.entry.periodScheduledHalfDays, employmentExcludedHalfDays: row.entry.employmentExcludedHalfDays,
      scheduledHalfDays: row.entry.scheduledHalfDays, payableHalfDays: row.entry.payableHalfDays, lopHalfDays: row.entry.lopHalfDays,
      fullGrossPaise: row.entry.fullGrossPaise, earnedGrossPaise: row.entry.earnedGrossPaise,
      employmentProrationDeductionPaise: row.entry.employmentProrationDeductionPaise, attendanceDeductionPaise: row.entry.attendanceDeductionPaise,
      recurringDeductionPaise: row.entry.recurringDeductionPaise, oneTimeAdditionPaise: row.entry.oneTimeAdditionPaise,
      oneTimeDeductionPaise: row.entry.oneTimeDeductionPaise, employeeProvidentFundPaise: row.entry.employeeProvidentFundPaise,
      employeeStateInsurancePaise: row.entry.employeeStateInsurancePaise, professionalTaxPaise: row.entry.professionalTaxPaise,
      incomeTaxPaise: row.entry.incomeTaxPaise, totalDeductionsPaise: row.entry.totalDeductionsPaise, netPayPaise: row.entry.netPayPaise,
      employerCostPaise: row.entry.employerCostPaise, note: row.entry.note,
    },
    lines,
    run: { ...row.run, status: row.run.status as PayrollRunStatus },
  };
}

export async function getSalaryStructureEditorData(
  database: DashboardDatabase, tenantId: string, actorUserId: string, employeeUserId: string,
): Promise<SalaryStructureEditorData | null> {
  if (!tenantId.trim() || !employeeUserId.trim()) throw new Error("Tenant and employee are required.");
  const [employee] = await database.select({ employeeCode: employeeProfiles.employeeCode, fullName: users.fullName, userId: employeeProfiles.userId, designation: employeeProfiles.designation })
    .from(employeeProfiles).innerJoin(users, eq(users.id, employeeProfiles.userId)).innerJoin(tenantMemberships, and(
      eq(tenantMemberships.tenantId, tenantId), eq(tenantMemberships.userId, employeeProfiles.userId), eq(tenantMemberships.status, "active"),
    )).where(and(eq(employeeProfiles.tenantId, tenantId), eq(employeeProfiles.userId, employeeUserId))).limit(1);
  if (!employee) return null;
  await recordPayrollAccess(database, tenantId, actorUserId, employeeUserId, "salary_structure.viewed");
  const [structure] = await database.select({ id: salaryStructures.id, effectiveFrom: salaryStructures.effectiveFrom }).from(salaryStructures).where(and(
    eq(salaryStructures.tenantId, tenantId), eq(salaryStructures.employeeUserId, employeeUserId), eq(salaryStructures.status, "active"),
  )).orderBy(desc(salaryStructures.effectiveFrom)).limit(1);
  if (!structure) return { employee, current: null };
  const lines = await database.select({ code: salaryStructureLines.code, label: salaryStructureLines.label, kind: salaryStructureLines.kind, monthlyAmountPaise: salaryStructureLines.monthlyAmountPaise })
    .from(salaryStructureLines).where(and(eq(salaryStructureLines.tenantId, tenantId), eq(salaryStructureLines.salaryStructureId, structure.id))).orderBy(asc(salaryStructureLines.displayOrder));
  return { employee, current: { effectiveFrom: structure.effectiveFrom, lines: lines.map((line) => ({ ...line, kind: line.kind as SalaryStructureInput["lines"][number]["kind"] })) } };
}

export async function getPayrollRunDetail(database: DashboardDatabase, tenantId: string, actorUserId: string, runId: string): Promise<PayrollRunDetail | null> {
  if (!tenantId.trim() || !runId.trim()) throw new Error("Tenant and run are required.");
  const [runRow] = await database.select({
    id: payrollRuns.id, payDate: payrollRuns.payDate, periodKey: payrollRuns.periodKey, status: payrollRuns.status,
    totalDeductionsPaise: payrollRuns.totalDeductionsPaise, totalGrossPaise: payrollRuns.totalGrossPaise, totalNetPaise: payrollRuns.totalNetPaise,
    updatedAt: payrollRuns.updatedAt, preparedByUserId: payrollRuns.preparedByUserId, submittedByUserId: payrollRuns.submittedByUserId,
    transitionReason: payrollRuns.transitionReason, paymentReference: payrollRuns.paymentReference,
    employeeCount: sql<number>`count(${payrollEntries.id})`.mapWith(Number),
  }).from(payrollRuns).leftJoin(payrollEntries, and(eq(payrollEntries.tenantId, tenantId), eq(payrollEntries.payrollRunId, payrollRuns.id)))
    .where(and(eq(payrollRuns.tenantId, tenantId), eq(payrollRuns.id, runId))).groupBy(payrollRuns.id).limit(1);
  if (!runRow) return null;
  await recordPayrollAccess(database, tenantId, actorUserId, runId, "payroll.run_viewed");
  const entries = await database.select({
    id: payrollEntries.id, employeeUserId: payrollEntries.employeeUserId, employeeCode: payrollEntries.employeeCodeSnapshot,
    employeeName: payrollEntries.employeeNameSnapshot, designation: payrollEntries.designationSnapshot,
    periodScheduledHalfDays: payrollEntries.periodScheduledHalfDays, employmentExcludedHalfDays: payrollEntries.employmentExcludedHalfDays,
    scheduledHalfDays: payrollEntries.scheduledHalfDays, payableHalfDays: payrollEntries.payableHalfDays, lopHalfDays: payrollEntries.lopHalfDays,
    fullGrossPaise: payrollEntries.fullGrossPaise, earnedGrossPaise: payrollEntries.earnedGrossPaise,
    employmentProrationDeductionPaise: payrollEntries.employmentProrationDeductionPaise,
    attendanceDeductionPaise: payrollEntries.attendanceDeductionPaise, oneTimeAdditionPaise: payrollEntries.oneTimeAdditionPaise,
    oneTimeDeductionPaise: payrollEntries.oneTimeDeductionPaise, employeeProvidentFundPaise: payrollEntries.employeeProvidentFundPaise,
    employeeStateInsurancePaise: payrollEntries.employeeStateInsurancePaise, professionalTaxPaise: payrollEntries.professionalTaxPaise,
    incomeTaxPaise: payrollEntries.incomeTaxPaise, totalDeductionsPaise: payrollEntries.totalDeductionsPaise,
    netPayPaise: payrollEntries.netPayPaise, hold: payrollEntries.hold, holdReason: payrollEntries.holdReason, note: payrollEntries.note,
  }).from(payrollEntries).where(and(eq(payrollEntries.tenantId, tenantId), eq(payrollEntries.payrollRunId, runId))).orderBy(asc(payrollEntries.employeeNameSnapshot));
  return { entries, run: { ...runRow, status: runRow.status as PayrollRunStatus, updatedAt: runRow.updatedAt.toISOString() } };
}

export async function createSalaryStructure(
  database: DashboardDatabase, tenantId: string, actorUserId: string, input: SalaryStructureInput,
) {
  requireIdentity(tenantId, actorUserId);
  return database.transaction(async (transaction) => {
    const [employee] = await transaction.select({ userId: tenantMemberships.userId }).from(tenantMemberships).where(and(
      eq(tenantMemberships.tenantId, tenantId), eq(tenantMemberships.userId, input.employeeUserId), eq(tenantMemberships.status, "active"),
    )).for("update").limit(1);
    if (!employee) throw new PayrollRepositoryError("not_found");
    const [latest] = await transaction.select({ effectiveFrom: salaryStructures.effectiveFrom }).from(salaryStructures).where(and(
      eq(salaryStructures.tenantId, tenantId), eq(salaryStructures.employeeUserId, input.employeeUserId),
    )).orderBy(desc(salaryStructures.effectiveFrom)).for("update").limit(1);
    if (latest && latest.effectiveFrom >= input.effectiveFrom) throw new PayrollRepositoryError("duplicate_version");
    const salaryStructureId = randomUUID();
    await transaction.update(salaryStructures).set({ status: "superseded", updatedAt: new Date() }).where(and(
      eq(salaryStructures.tenantId, tenantId), eq(salaryStructures.employeeUserId, input.employeeUserId), eq(salaryStructures.status, "active"),
    ));
    await transaction.insert(salaryStructures).values({ id: salaryStructureId, tenantId, employeeUserId: input.employeeUserId, effectiveFrom: input.effectiveFrom, status: "active", createdByUserId: actorUserId });
    await transaction.insert(salaryStructureLines).values(input.lines.map((line, displayOrder) => ({ id: randomUUID(), tenantId, salaryStructureId, ...line, displayOrder })));
    await insertAudit(transaction, tenantId, actorUserId, salaryStructureId, "salary_structure.created");
    return salaryStructureId;
  });
}

export async function createPayrollRun(
  database: DashboardDatabase, tenantId: string, actorUserId: string, periodKey: string, payDate: string,
) {
  requireIdentity(tenantId, actorUserId);
  return database.transaction(async (transaction) => {
    const [period] = await transaction.select({ id: attendancePeriods.id }).from(attendancePeriods).where(and(
      eq(attendancePeriods.tenantId, tenantId), eq(attendancePeriods.periodKey, periodKey), eq(attendancePeriods.status, "locked"),
    )).for("update").limit(1);
    if (!period) throw new PayrollRepositoryError("attendance_not_locked");
    const summaries = await transaction.select({
      employeeUserId: attendancePeriodSummaries.employeeUserId, periodScheduledHalfDays: attendancePeriodSummaries.periodScheduledHalfDays,
      employmentExcludedHalfDays: attendancePeriodSummaries.employmentExcludedHalfDays, scheduledHalfDays: attendancePeriodSummaries.scheduledHalfDays,
      payableHalfDays: attendancePeriodSummaries.payableHalfDays, lopHalfDays: attendancePeriodSummaries.lopHalfDays,
    }).from(attendancePeriodSummaries).where(and(eq(attendancePeriodSummaries.tenantId, tenantId), eq(attendancePeriodSummaries.attendancePeriodId, period.id)));
    if (!summaries.length) throw new PayrollRepositoryError("missing_attendance");
    const runId = randomUUID();
    await transaction.insert(payrollRuns).values({ id: runId, tenantId, attendancePeriodId: period.id, periodKey, payDate, preparedByUserId: actorUserId });
    for (const summary of summaries) {
      const [snapshot] = await transaction.select({
        employeeCode: employeeProfiles.employeeCode, employeeName: users.fullName, designation: employeeProfiles.designation,
      }).from(employeeProfiles).innerJoin(users, eq(users.id, employeeProfiles.userId)).where(and(
        eq(employeeProfiles.tenantId, tenantId), eq(employeeProfiles.userId, summary.employeeUserId),
      )).limit(1);
      const [structure] = await transaction.select({ id: salaryStructures.id }).from(salaryStructures).where(and(
        eq(salaryStructures.tenantId, tenantId), eq(salaryStructures.employeeUserId, summary.employeeUserId),
        lte(salaryStructures.effectiveFrom, endOfMonth(periodKey)),
      )).orderBy(desc(salaryStructures.effectiveFrom)).limit(1);
      if (!snapshot || !structure) throw new PayrollRepositoryError("missing_salary");
      const salaryLines = await transaction.select({ code: salaryStructureLines.code, label: salaryStructureLines.label, kind: salaryStructureLines.kind, monthlyAmountPaise: salaryStructureLines.monthlyAmountPaise })
        .from(salaryStructureLines).where(and(eq(salaryStructureLines.tenantId, tenantId), eq(salaryStructureLines.salaryStructureId, structure.id))).orderBy(asc(salaryStructureLines.displayOrder));
      const calculation = calculatePayrollEntry({ ...summary, salaryLines: salaryLines.map((line) => ({ ...line, kind: line.kind as SalaryStructureInput["lines"][number]["kind"] })) });
      const entryId = randomUUID();
      await transaction.insert(payrollEntries).values({
        id: entryId, tenantId, payrollRunId: runId, salaryStructureId: structure.id,
        employeeCodeSnapshot: snapshot.employeeCode, employeeNameSnapshot: snapshot.employeeName, designationSnapshot: snapshot.designation,
        ...summary, fullGrossPaise: calculation.fullGrossPaise, earnedGrossPaise: calculation.earnedGrossPaise,
        employmentProrationDeductionPaise: calculation.employmentProrationDeductionPaise,
        attendanceDeductionPaise: calculation.attendanceDeductionPaise, recurringDeductionPaise: calculation.recurringDeductionPaise,
        totalDeductionsPaise: calculation.totalDeductionsPaise, netPayPaise: calculation.netPayPaise, employerCostPaise: calculation.employerCostPaise,
      });
      await transaction.insert(payrollEntryLines).values(calculation.lines.map((line) => ({ id: randomUUID(), tenantId, payrollEntryId: entryId, ...line })));
    }
    await recalculateRunTotals(transaction, tenantId, runId);
    await insertAudit(transaction, tenantId, actorUserId, runId, "payroll.created");
    return runId;
  });
}

export async function updatePayrollEntryInputs(
  database: DashboardDatabase, tenantId: string, actorUserId: string, runId: string, input: PayrollEntryInput,
) {
  requireIdentity(tenantId, actorUserId);
  await database.transaction(async (transaction) => {
    const run = await lockedRun(transaction, tenantId, runId);
    if (run.status !== "draft") throw new PayrollRepositoryError("invalid_state");
    const [entry] = await transaction.select().from(payrollEntries).where(and(
      eq(payrollEntries.tenantId, tenantId), eq(payrollEntries.payrollRunId, runId), eq(payrollEntries.employeeUserId, input.employeeUserId),
    )).for("update").limit(1);
    if (!entry) throw new PayrollRepositoryError("not_found");
    const salaryLines = await transaction.select({ code: salaryStructureLines.code, label: salaryStructureLines.label, kind: salaryStructureLines.kind, monthlyAmountPaise: salaryStructureLines.monthlyAmountPaise })
      .from(salaryStructureLines).where(and(eq(salaryStructureLines.tenantId, tenantId), eq(salaryStructureLines.salaryStructureId, entry.salaryStructureId))).orderBy(asc(salaryStructureLines.displayOrder));
    const calculation = calculatePayrollEntry({
      ...input, periodScheduledHalfDays: entry.periodScheduledHalfDays, employmentExcludedHalfDays: entry.employmentExcludedHalfDays,
      scheduledHalfDays: entry.scheduledHalfDays, payableHalfDays: entry.payableHalfDays, lopHalfDays: entry.lopHalfDays,
      salaryLines: salaryLines.map((line) => ({ ...line, kind: line.kind as SalaryStructureInput["lines"][number]["kind"] })),
    });
    await transaction.update(payrollEntries).set({
      employeeProvidentFundPaise: input.employeeProvidentFundPaise, employeeStateInsurancePaise: input.employeeStateInsurancePaise,
      professionalTaxPaise: input.professionalTaxPaise, incomeTaxPaise: input.incomeTaxPaise, oneTimeAdditionPaise: input.oneTimeAdditionPaise,
      oneTimeDeductionPaise: input.oneTimeDeductionPaise, hold: input.hold, holdReason: input.holdReason, note: input.note, fullGrossPaise: calculation.fullGrossPaise,
      earnedGrossPaise: calculation.earnedGrossPaise, employmentProrationDeductionPaise: calculation.employmentProrationDeductionPaise,
      attendanceDeductionPaise: calculation.attendanceDeductionPaise,
      recurringDeductionPaise: calculation.recurringDeductionPaise, totalDeductionsPaise: calculation.totalDeductionsPaise,
      netPayPaise: calculation.netPayPaise, employerCostPaise: calculation.employerCostPaise, updatedAt: new Date(),
    }).where(and(eq(payrollEntries.tenantId, tenantId), eq(payrollEntries.id, entry.id)));
    await transaction.delete(payrollEntryLines).where(and(eq(payrollEntryLines.tenantId, tenantId), eq(payrollEntryLines.payrollEntryId, entry.id)));
    await transaction.insert(payrollEntryLines).values(calculation.lines.map((line) => ({ id: randomUUID(), tenantId, payrollEntryId: entry.id, ...line })));
    await recalculateRunTotals(transaction, tenantId, runId);
    await insertAudit(transaction, tenantId, actorUserId, runId, "payroll.entry_updated", input.note);
  });
}

export async function submitPayrollRun(database: DashboardDatabase, tenantId: string, actorUserId: string, runId: string) {
  requireIdentity(tenantId, actorUserId);
  await database.transaction(async (transaction) => {
    const run = await lockedRun(transaction, tenantId, runId);
    if (run.status !== "draft") throw new PayrollRepositoryError("invalid_state");
    const [holds] = await transaction.select({ count: sql<number>`count(*)`.mapWith(Number) }).from(payrollEntries).where(and(
      eq(payrollEntries.tenantId, tenantId), eq(payrollEntries.payrollRunId, runId), eq(payrollEntries.hold, true),
    ));
    if ((holds?.count ?? 0) > 0) throw new PayrollRepositoryError("entry_on_hold");
    const now = new Date();
    await transaction.update(payrollRuns).set({ status: "submitted", submittedByUserId: actorUserId, submittedAt: now, updatedAt: now, version: sql`${payrollRuns.version} + 1` }).where(and(
      eq(payrollRuns.tenantId, tenantId), eq(payrollRuns.id, runId), eq(payrollRuns.status, "draft"),
    ));
    await insertAudit(transaction, tenantId, actorUserId, runId, "payroll.submitted");
  });
}

export async function approvePayrollRun(database: DashboardDatabase, tenantId: string, actorUserId: string, actorRole: Role, runId: string, reason: string) {
  requireIdentity(tenantId, actorUserId);
  assertApprovalActor(actorRole, reason);
  await database.transaction(async (transaction) => {
    const run = await lockedRun(transaction, tenantId, runId);
    if (run.status !== "submitted") throw new PayrollRepositoryError("invalid_state");
    const samePerson = actorUserId === run.preparedByUserId || actorUserId === run.submittedByUserId;
    if (samePerson && actorRole !== "firm_administrator") throw new PayrollRepositoryError("separation_required");
    const now = new Date();
    await transaction.update(payrollRuns).set({ status: "approved_locked", approvedByUserId: actorUserId, approvedAt: now, transitionReason: reason.trim(), updatedAt: now, version: sql`${payrollRuns.version} + 1` }).where(and(
      eq(payrollRuns.tenantId, tenantId), eq(payrollRuns.id, runId), eq(payrollRuns.status, "submitted"),
    ));
    await insertAudit(transaction, tenantId, actorUserId, runId, "payroll.approved", reason);
  });
}

export async function rejectPayrollRun(database: DashboardDatabase, tenantId: string, actorUserId: string, actorRole: Role, runId: string, reason: string) {
  requireIdentity(tenantId, actorUserId);
  assertApprovalActor(actorRole, reason);
  await database.transaction(async (transaction) => {
    const run = await lockedRun(transaction, tenantId, runId);
    if (run.status !== "submitted") throw new PayrollRepositoryError("invalid_state");
    await transaction.update(payrollRuns).set({ status: "draft", submittedByUserId: null, submittedAt: null, transitionReason: reason.trim(), updatedAt: new Date(), version: sql`${payrollRuns.version} + 1` }).where(and(eq(payrollRuns.tenantId, tenantId), eq(payrollRuns.id, runId), eq(payrollRuns.status, "submitted")));
    await insertAudit(transaction, tenantId, actorUserId, runId, "payroll.rejected", reason);
  });
}

export async function reopenPayrollRun(database: DashboardDatabase, tenantId: string, actorUserId: string, actorRole: Role, runId: string, reason: string) {
  requireIdentity(tenantId, actorUserId);
  assertApprovalActor(actorRole, reason);
  await database.transaction(async (transaction) => {
    const run = await lockedRun(transaction, tenantId, runId);
    if (!inArrayValue(run.status, ["approved_locked", "payslips_published"])) throw new PayrollRepositoryError("invalid_state");
    await transaction.update(payrollRuns).set({
      status: "draft", submittedByUserId: null, submittedAt: null, approvedByUserId: null, approvedAt: null,
      publishedByUserId: null, publishedAt: null, transitionReason: reason.trim(), updatedAt: new Date(), version: sql`${payrollRuns.version} + 1`,
    }).where(and(eq(payrollRuns.tenantId, tenantId), eq(payrollRuns.id, runId), inArray(payrollRuns.status, ["approved_locked", "payslips_published"])));
    await insertAudit(transaction, tenantId, actorUserId, runId, "payroll.reopened", reason);
  });
}

function inArrayValue(value: string, values: readonly string[]) { return values.includes(value); }

export async function publishPayslips(database: DashboardDatabase, tenantId: string, actorUserId: string, actorRole: Role, runId: string, reason: string) {
  requireIdentity(tenantId, actorUserId);
  assertApprovalActor(actorRole, reason);
  await database.transaction(async (transaction) => {
    const run = await lockedRun(transaction, tenantId, runId);
    if (run.status !== "approved_locked") throw new PayrollRepositoryError("invalid_state");
    const now = new Date();
    await transaction.update(payrollRuns).set({ status: "payslips_published", publishedByUserId: actorUserId, publishedAt: now, transitionReason: reason.trim(), updatedAt: now, version: sql`${payrollRuns.version} + 1` }).where(and(eq(payrollRuns.tenantId, tenantId), eq(payrollRuns.id, runId), eq(payrollRuns.status, "approved_locked")));
    await insertAudit(transaction, tenantId, actorUserId, runId, "payroll.payslips_published", reason);

    // Publishing is the moment a payslip becomes readable. Telling nobody made
    // it something an employee had to go and look for.
    const entries = await transaction.select({
      employeeUserId: payrollEntries.employeeUserId,
      netPayPaise: payrollEntries.netPayPaise,
    }).from(payrollEntries).where(and(
      eq(payrollEntries.tenantId, tenantId),
      eq(payrollEntries.payrollRunId, runId),
    ));
    await insertNotifications(transaction, tenantId, entries.map((entry) => ({
      recipientUserId: entry.employeeUserId,
      type: "payslip_published" as const,
      title: `Your payslip for ${run.periodKey} is available`,
      // The amount is the employee's own, and the payslip itself is behind the
      // permission that already guards it.
      body: `Net pay ${formatPaise(entry.netPayPaise)}. Open Salary to view the payslip.`,
      resourceType: "payroll_entry" as const,
      resourceId: runId,
      dedupeKey: `payslip_published:${runId}:${entry.employeeUserId}`,
    })));
  });
}

export async function markPayrollPaid(database: DashboardDatabase, tenantId: string, actorUserId: string, actorRole: Role, runId: string, paymentReference: string, reason: string) {
  requireIdentity(tenantId, actorUserId);
  assertApprovalActor(actorRole, reason);
  await database.transaction(async (transaction) => {
    const run = await lockedRun(transaction, tenantId, runId);
    if (run.status !== "payslips_published" || paymentReference.trim().length < 3) throw new PayrollRepositoryError("invalid_state");
    const now = new Date();
    await transaction.update(payrollRuns).set({ status: "paid", paidByUserId: actorUserId, paidAt: now, paymentReference: paymentReference.trim(), transitionReason: reason.trim(), updatedAt: now, version: sql`${payrollRuns.version} + 1` }).where(and(eq(payrollRuns.tenantId, tenantId), eq(payrollRuns.id, runId), eq(payrollRuns.status, "payslips_published")));
    await insertAudit(transaction, tenantId, actorUserId, runId, "payroll.paid", `${reason.trim()} | ${paymentReference.trim()}`);
  });
}

export function payrollVarianceBasisPoints(currentNetPaise: number, previousNetPaise: number) {
  return calculateVarianceBasisPoints(currentNetPaise, previousNetPaise);
}
