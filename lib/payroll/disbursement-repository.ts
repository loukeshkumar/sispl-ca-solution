import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";

import { auditEvents, employeeBankAccounts, payrollDisbursements, payrollEntries, payrollRuns } from "../../db/schema";
import type { DashboardDatabase } from "../dashboard/postgres/repository";
import { buildDisbursementBatch, type DisbursementBatch, type DisbursementCandidate } from "./disbursement";

export class DisbursementError extends Error {
  constructor(public readonly code: "not_found" | "invalid_state" | "nothing_payable") {
    super(
      code === "not_found" ? "The payroll run was not found."
        : code === "invalid_state" ? "A disbursement file can only be generated after the run is approved and locked."
          : "No employee in this run is payable. Review holds and payment instructions.",
    );
    this.name = "DisbursementError";
  }
}

const DISBURSABLE_STATUSES = ["approved_locked", "payslips_published", "paid"];

export type DisbursementPreparation = {
  runId: string;
  periodKey: string;
  payDate: string;
  batch: DisbursementBatch;
};

export async function prepareDisbursement(database: DashboardDatabase, tenantId: string, runId: string): Promise<DisbursementPreparation> {
  if (!tenantId.trim()) throw new Error("Tenant is required.");
  const [run] = await database.select({
    id: payrollRuns.id, periodKey: payrollRuns.periodKey, payDate: payrollRuns.payDate, status: payrollRuns.status,
  }).from(payrollRuns).where(and(eq(payrollRuns.tenantId, tenantId), eq(payrollRuns.id, runId))).limit(1);
  if (!run) throw new DisbursementError("not_found");
  if (!DISBURSABLE_STATUSES.includes(run.status)) throw new DisbursementError("invalid_state");

  const rows = await database.select({
    employeeUserId: payrollEntries.employeeUserId,
    employeeCode: payrollEntries.employeeCodeSnapshot,
    employeeName: payrollEntries.employeeNameSnapshot,
    netPayPaise: payrollEntries.netPayPaise,
    hold: payrollEntries.hold,
    holdReason: payrollEntries.holdReason,
    accountHolderName: employeeBankAccounts.accountHolderName,
    accountNumber: employeeBankAccounts.accountNumber,
    ifscCode: employeeBankAccounts.ifscCode,
    bankName: employeeBankAccounts.bankName,
  }).from(payrollEntries)
    .leftJoin(employeeBankAccounts, and(
      eq(employeeBankAccounts.tenantId, payrollEntries.tenantId),
      eq(employeeBankAccounts.employeeUserId, payrollEntries.employeeUserId),
      eq(employeeBankAccounts.status, "active"),
    ))
    .where(and(eq(payrollEntries.tenantId, tenantId), eq(payrollEntries.payrollRunId, runId)))
    .orderBy(asc(payrollEntries.employeeCodeSnapshot));

  const batch = buildDisbursementBatch(rows as DisbursementCandidate[], { periodKey: run.periodKey });
  return { runId: run.id, periodKey: run.periodKey, payDate: run.payDate, batch };
}

/** Records that a file was generated. Generating is preparation, not payment. */
export async function recordDisbursementBatch(
  database: DashboardDatabase,
  tenantId: string,
  actorUserId: string,
  input: { runId: string; periodKey: string; paymentDate: string; batch: DisbursementBatch },
) {
  if (!tenantId.trim() || !actorUserId.trim()) throw new Error("Tenant and actor are required.");
  if (input.batch.instructions.length === 0) throw new DisbursementError("nothing_payable");
  const id = randomUUID();
  const batchReference = `PAY-${input.periodKey.replace(/[^0-9A-Za-z]/g, "").toUpperCase()}-${id.slice(0, 8).toUpperCase()}`;
  await database.transaction(async (transaction) => {
    await transaction.insert(payrollDisbursements).values({
      id,
      tenantId,
      payrollRunId: input.runId,
      batchReference,
      paymentDate: input.paymentDate,
      instructionCount: input.batch.instructions.length,
      totalAmountPaise: input.batch.totalAmountPaise,
      excludedCount: input.batch.exclusions.length,
      generatedByUserId: actorUserId,
    });
    await transaction.insert(auditEvents).values({
      tenantId, actorUserId, resourceType: "payroll_disbursement", resourceId: id,
      action: "payroll.disbursement_generated",
      reason: `${batchReference} · ${input.batch.instructions.length} instructions · ${input.batch.exclusions.length} excluded`,
    });
  });
  return { id, batchReference };
}

export async function listDisbursements(database: DashboardDatabase, tenantId: string, runId: string) {
  const rows = await database.select({
    id: payrollDisbursements.id,
    batchReference: payrollDisbursements.batchReference,
    paymentDate: payrollDisbursements.paymentDate,
    instructionCount: payrollDisbursements.instructionCount,
    totalAmountPaise: payrollDisbursements.totalAmountPaise,
    excludedCount: payrollDisbursements.excludedCount,
    generatedAt: payrollDisbursements.generatedAt,
  }).from(payrollDisbursements).where(and(
    eq(payrollDisbursements.tenantId, tenantId), eq(payrollDisbursements.payrollRunId, runId),
  )).orderBy(asc(payrollDisbursements.generatedAt));
  return rows.map((row) => ({ ...row, generatedAt: row.generatedAt.toISOString() }));
}
