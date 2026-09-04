/**
 * One payroll run for the closed month, carried to `paid`.
 *
 * The administrator prepares and submits; the partner approves, publishes and
 * records payment. That split is not decoration — approving a run you submitted
 * yourself is an audited same-person override, and the demo should show the
 * ordinary path. Publishing also produces a payslip notification per employee,
 * which is how the notification workspace fills.
 *
 * The current month gets no run at all, because its attendance is not locked.
 */
import { and, eq } from "drizzle-orm";

import { attendancePeriods, attendancePeriodSummaries, payrollRuns, salaryStructures } from "../../../db/schema";
import type { DashboardDatabase } from "../../../lib/dashboard/postgres/repository";
import {
  approvePayrollRun,
  createPayrollRun,
  createSalaryStructure,
  markPayrollPaid,
  publishPayslips,
  submitPayrollRun,
} from "../../../lib/payroll/repository";
import type { DemoContext } from "./context";

const APPROVAL_REASON = "Reviewed against the locked attendance month.";

/**
 * `createPayrollRun` refuses a period where anyone in the attendance summary has
 * no effective salary structure, and the base seed gives one to five of the six
 * employees — the partner draws from the firm rather than payroll. A firm would
 * create the missing structure before running payroll, so the demo does too,
 * through the same function rather than by inserting rows behind it.
 */
async function ensureSalaryStructures(database: DashboardDatabase, context: DemoContext, periodId: string) {
  const covered = new Set(
    (await database.select({ employeeUserId: salaryStructures.employeeUserId }).from(salaryStructures)
      .where(and(eq(salaryStructures.tenantId, context.tenantId), eq(salaryStructures.status, "active"))))
      .map((row) => row.employeeUserId),
  );
  // The summary is payroll's own list, not this seed's idea of who works here.
  // An employee profile without an active membership still lands in a prepared
  // month, and covering only the seeded fixture would miss them.
  const inPayroll = await database.select({ employeeUserId: attendancePeriodSummaries.employeeUserId })
    .from(attendancePeriodSummaries)
    .where(and(eq(attendancePeriodSummaries.tenantId, context.tenantId), eq(attendancePeriodSummaries.attendancePeriodId, periodId)));
  let created = 0;
  for (const employee of inPayroll) {
    if (covered.has(employee.employeeUserId)) continue;
    await createSalaryStructure(database, context.tenantId, context.actors.administratorId, {
      employeeUserId: employee.employeeUserId,
      effectiveFrom: `${context.calendar.closedMonth}-01`,
      lines: [
        { code: "BASIC", label: "Basic", kind: "earning", monthlyAmountPaise: 7_500_000 },
        { code: "HRA", label: "House rent allowance", kind: "earning", monthlyAmountPaise: 3_750_000 },
      ],
    });
    created += 1;
  }
  return created;
}

export async function seedDemoPayroll(database: DashboardDatabase, context: DemoContext) {
  const { closedMonth } = context.calendar;
  const [lockedPeriod] = await database.select({ id: attendancePeriods.id }).from(attendancePeriods).where(and(
    eq(attendancePeriods.tenantId, context.tenantId),
    eq(attendancePeriods.periodKey, closedMonth),
    eq(attendancePeriods.status, "locked"),
  )).limit(1);
  if (!lockedPeriod) throw new Error(`Attendance for ${closedMonth} is not locked, so no payroll run is possible.`);
  const structuresCreated = await ensureSalaryStructures(database, context, lockedPeriod.id);
  const [existing] = await database.select({ id: payrollRuns.id, status: payrollRuns.status })
    .from(payrollRuns)
    .where(and(eq(payrollRuns.tenantId, context.tenantId), eq(payrollRuns.periodKey, closedMonth)))
    .limit(1);
  if (existing?.status === "paid") return { payrollRuns: 0, salaryStructures: structuresCreated };

  const { administratorId, partnerId } = context.actors;
  const runId = existing?.id ?? await createPayrollRun(
    database,
    context.tenantId,
    administratorId,
    closedMonth,
    // Salaries are paid on the seventh of the following month.
    payDateFor(closedMonth),
  );

  // Each transition refuses a run that is not in the state before it, so the
  // status is re-read rather than assumed. That makes a partial previous run
  // resumable instead of fatal.
  const advance = async () => {
    const [run] = await database.select({ status: payrollRuns.status }).from(payrollRuns)
      .where(and(eq(payrollRuns.tenantId, context.tenantId), eq(payrollRuns.id, runId))).limit(1);
    return run?.status ?? null;
  };

  if (await advance() === "draft") await submitPayrollRun(database, context.tenantId, administratorId, runId);
  if (await advance() === "submitted") await approvePayrollRun(database, context.tenantId, partnerId, "partner", runId, APPROVAL_REASON);
  if (await advance() === "approved_locked") await publishPayslips(database, context.tenantId, partnerId, "partner", runId, "Payslips released to employees.");
  if (await advance() === "payslips_published") {
    await markPayrollPaid(database, context.tenantId, partnerId, "partner", runId, `NEFT-${closedMonth.replace("-", "")}`, "Bank transfer completed.");
  }

  return { payrollRuns: 1, salaryStructures: structuresCreated };
}

function payDateFor(periodKey: string) {
  const [year, month] = periodKey.split("-").map(Number);
  const payYear = month === 12 ? year + 1 : year;
  const payMonth = month === 12 ? 1 : month + 1;
  return `${payYear}-${String(payMonth).padStart(2, "0")}-07`;
}
