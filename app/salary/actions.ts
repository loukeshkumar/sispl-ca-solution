"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { hasPermission, type Role } from "../../lib/auth/authorization";
import { requirePermission } from "../../lib/auth/server";
import { getDatabase } from "../../lib/dashboard/postgres/pool";
import {
  approvePayrollRun, createPayrollRun, createSalaryStructure, markPayrollPaid, PayrollRepositoryError,
  publishPayslips, rejectPayrollRun, reopenPayrollRun, submitPayrollRun, updatePayrollEntryInputs,
} from "../../lib/payroll/repository";
import {
  validatePayrollEntryFields, validatePayrollPeriodFields, validateSalaryStructureFields, validateTransitionReason,
  type PayrollFields,
} from "../../lib/payroll/validation";

export type SalaryActionState = { error: string; fieldErrors: Record<string, string> };
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fields = (formData: FormData, names: string[]): PayrollFields => Object.fromEntries(names.map((name) => [name, typeof formData.get(name) === "string" ? String(formData.get(name)) : ""]));
const actionError = (error: unknown): SalaryActionState => ({ error: error instanceof PayrollRepositoryError ? error.message : "Payroll could not be updated. Refresh and try again.", fieldErrors: {} });
const refreshSalary = () => { revalidatePath("/"); revalidatePath("/salary", "layout"); };

export async function createSalaryStructureAction(_previous: SalaryActionState, formData: FormData): Promise<SalaryActionState> {
  const session = await requirePermission("salary:manage", "/?workspace=salary");
  const validation = validateSalaryStructureFields(fields(formData, ["employeeUserId", "effectiveFrom", "lines"]));
  if (!validation.success) return { error: "Review the highlighted salary fields.", fieldErrors: validation.fieldErrors };
  try { await createSalaryStructure(getDatabase(), session.tenantId, session.userId, validation.data); } catch (error) { return actionError(error); }
  refreshSalary(); redirect("/?workspace=salary");
}

export async function createPayrollRunAction(_previous: SalaryActionState, formData: FormData): Promise<SalaryActionState> {
  const session = await requirePermission("salary:manage", "/?workspace=salary");
  const validation = validatePayrollPeriodFields(fields(formData, ["periodKey", "payDate"]));
  if (!validation.success) return { error: "Enter a valid payroll month and pay date.", fieldErrors: validation.fieldErrors };
  let runId: string;
  try { runId = await createPayrollRun(getDatabase(), session.tenantId, session.userId, validation.data.periodKey, validation.data.payDate); } catch (error) { return actionError(error); }
  refreshSalary(); redirect(`/salary/runs/${runId}`);
}

export async function updatePayrollEntryAction(_previous: SalaryActionState, formData: FormData): Promise<SalaryActionState> {
  const session = await requirePermission("salary:manage", "/?workspace=salary");
  const runId = String(formData.get("runId") ?? "");
  if (!UUID_PATTERN.test(runId)) return { error: "Payroll run is invalid.", fieldErrors: {} };
  const validation = validatePayrollEntryFields(fields(formData, [
    "employeeUserId", "employeeProvidentFund", "employeeStateInsurance", "professionalTax", "incomeTax",
    "oneTimeAddition", "oneTimeDeduction", "hold", "holdReason", "note",
  ]));
  if (!validation.success) return { error: "Review the highlighted payroll fields.", fieldErrors: validation.fieldErrors };
  try { await updatePayrollEntryInputs(getDatabase(), session.tenantId, session.userId, runId, validation.data); } catch (error) { return actionError(error); }
  refreshSalary(); return { error: "", fieldErrors: {} };
}

export async function submitPayrollRunAction(formData: FormData) {
  const session = await requirePermission("salary:manage", "/?workspace=salary");
  const runId = String(formData.get("runId") ?? "");
  if (!UUID_PATTERN.test(runId)) redirect("/?workspace=salary&salaryError=run");
  try { await submitPayrollRun(getDatabase(), session.tenantId, session.userId, runId); }
  catch { redirect(`/salary/runs/${runId}?salaryError=transition`); }
  refreshSalary(); redirect(`/salary/runs/${runId}`);
}

async function approvalTransition(formData: FormData, operation: "approve" | "reject" | "reopen" | "publish" | "paid") {
  const session = await requirePermission("salary:read:own", "/?workspace=salary");
  if (!hasPermission(session, "salary:approve")) redirect("/forbidden");
  const runId = String(formData.get("runId") ?? "");
  const validation = validateTransitionReason(String(formData.get("reason") ?? ""), true);
  if (!UUID_PATTERN.test(runId) || !validation.success) redirect(`/?workspace=salary&salaryError=approval`);
  const role = session.roleKey as Role;
  try {
    if (operation === "approve") await approvePayrollRun(getDatabase(), session.tenantId, session.userId, role, runId, validation.data.reason);
    else if (operation === "reject") await rejectPayrollRun(getDatabase(), session.tenantId, session.userId, role, runId, validation.data.reason);
    else if (operation === "reopen") await reopenPayrollRun(getDatabase(), session.tenantId, session.userId, role, runId, validation.data.reason);
    else if (operation === "publish") await publishPayslips(getDatabase(), session.tenantId, session.userId, role, runId, validation.data.reason);
    else await markPayrollPaid(getDatabase(), session.tenantId, session.userId, role, runId, String(formData.get("paymentReference") ?? ""), validation.data.reason);
  } catch { redirect(`/salary/runs/${runId}?salaryError=transition`); }
  refreshSalary(); redirect(`/salary/runs/${runId}`);
}

export async function rejectPayrollRunAction(formData: FormData) { return approvalTransition(formData, "reject"); }
export async function reopenPayrollRunAction(formData: FormData) { return approvalTransition(formData, "reopen"); }
export async function publishPayslipsAction(formData: FormData) { return approvalTransition(formData, "publish"); }
export async function markPayrollPaidAction(formData: FormData) { return approvalTransition(formData, "paid"); }

export async function approvePayrollRunAction(formData: FormData) {
  return approvalTransition(formData, "approve");
}
