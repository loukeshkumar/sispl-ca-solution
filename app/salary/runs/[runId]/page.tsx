import Link from "next/link";
import { notFound } from "next/navigation";

import { hasPermission } from "../../../../lib/auth/authorization";
import { requirePermission } from "../../../../lib/auth/server";
import { getDatabase } from "../../../../lib/dashboard/postgres/pool";
import { formatPaise } from "../../../../lib/payroll/money";
import { getPayrollRunDetail } from "../../../../lib/payroll/repository";
import { StatusBadge } from "../../../dashboard/dashboard-ui";
import {
  approvePayrollRunAction, markPayrollPaidAction, publishPayslipsAction, rejectPayrollRunAction,
  reopenPayrollRunAction, submitPayrollRunAction,
} from "../../actions";
import { PayrollEntryEditor } from "./payroll-entry-editor";
import { suggestStatutoryDeductions } from "../../../../lib/statutory/repository";
import { loadOptionalPanel } from "../../../../lib/dashboard/optional-panel";

/** Attendance policy is Bihar-based in this release, so PT resolves against BR. */
const PAYROLL_JURISDICTION = "BR";

export const dynamic = "force-dynamic";
const tone = (status: string) => status === "paid" || status === "payslips_published" ? "mint" : status === "submitted" ? "amber" : "blue";

export default async function PayrollRunPage({ params, searchParams }: { params: Promise<{ runId: string }>; searchParams: Promise<{ salaryError?: string }> }) {
  const { runId } = await params;
  const session = await requirePermission("salary:manage", `/salary/runs/${runId}`);
  const detail = await getPayrollRunDetail(getDatabase(), session.tenantId, session.userId, runId);
  if (!detail) notFound();
  const canApprove = hasPermission(session, "salary:approve");
  const error = (await searchParams).salaryError;
  // Statutory suggestions assist the preparer; payroll control must open without them.
  const suggestions = detail.run.status === "draft"
    ? await loadOptionalPanel("statutory-suggestions", async () => new Map(await Promise.all(detail.entries.map(async (entry) => [
        entry.employeeUserId,
        await suggestStatutoryDeductions(getDatabase(), session.tenantId, {
          monthlyWagesPaise: entry.earnedGrossPaise,
          asOfDateKey: detail.run.payDate,
          jurisdiction: PAYROLL_JURISDICTION,
        }),
      ] as const))), new Map())
    : new Map();
  return <main className="salary-route-shell"><header className="salary-route-header"><Link href="/?workspace=salary">&larr; Back to Salary</Link><div className="salary-run-title"><div><p className="eyebrow">PAYROLL CONTROL</p><h1>Payroll control · {detail.run.periodKey}</h1><span>Pay date {detail.run.payDate} · {detail.run.employeeCount} employees</span></div><StatusBadge tone={tone(detail.run.status)}>{detail.run.status.replaceAll("_", " ")}</StatusBadge></div></header>
    {error && <p className="client-form-banner" role="alert">The payroll transition could not be completed. Refresh the run and review its current state.</p>}
    <section className="salary-run-kpis"><article className="surface-card"><span>Gross payroll</span><strong>{formatPaise(detail.run.totalGrossPaise)}</strong></article><article className="surface-card"><span>Total deductions</span><strong>{formatPaise(detail.run.totalDeductionsPaise)}</strong></article><article className="surface-card"><span>Net payroll</span><strong>{formatPaise(detail.run.totalNetPaise)}</strong></article></section>
    <section className="surface-card salary-run-control"><div><p className="eyebrow">WORKFLOW</p><h2>Controlled release</h2><p>Attendance and salary values are snapshotted before submission. Publication makes payslips visible to employees.</p></div><div className="salary-run-actions">
      {detail.run.status === "draft" && <form action={submitPayrollRunAction}><input name="runId" type="hidden" value={runId} /><button className="primary-button" type="submit">Submit payroll</button></form>}
      {detail.run.status === "submitted" && canApprove && <form action={approvePayrollRunAction}><input name="runId" type="hidden" value={runId} /><input aria-label="Approval or override reason" name="reason" placeholder="Approval authorization note" required /><button className="primary-button" type="submit">Approve &amp; lock</button></form>}
      {detail.run.status === "submitted" && canApprove && <form action={rejectPayrollRunAction}><input name="runId" type="hidden" value={runId} /><input aria-label="Rejection reason" name="reason" placeholder="Reason for return" required /><button className="secondary-button" type="submit">Return to draft</button></form>}
      {detail.run.status === "approved_locked" && canApprove && <form action={publishPayslipsAction}><input name="runId" type="hidden" value={runId} /><input aria-label="Publication reason" name="reason" placeholder="Publication authorization note" required /><button className="primary-button" type="submit">Publish payslips</button></form>}
      {detail.run.status === "payslips_published" && canApprove && <form action={markPayrollPaidAction}><input name="runId" type="hidden" value={runId} /><input aria-label="Payment reason" name="reason" placeholder="Payment authorization note" required /><input aria-label="Payment reference" name="paymentReference" placeholder="Bank payment reference" required /><button className="primary-button" type="submit">Mark paid</button></form>}
      {canApprove && ["approved_locked", "payslips_published"].includes(detail.run.status) && <form action={reopenPayrollRunAction}><input name="runId" type="hidden" value={runId} /><input aria-label="Reopen reason" name="reason" placeholder="Reason for reopening" required /><button className="secondary-button" type="submit">Reopen draft</button></form>}
      <Link className="secondary-button" href={`/salary/runs/${runId}/export`}>Export payroll CSV</Link>
      {canApprove && ["approved_locked", "payslips_published", "paid"].includes(detail.run.status) && <a className="secondary-button" href={`/salary/runs/${runId}/disbursement`}>Download bank file</a>}
    </div>
    {canApprove && ["approved_locked", "payslips_published", "paid"].includes(detail.run.status) && <p className="disbursement-note">Held employees and anyone without payment instructions are excluded from the bank file and listed as exclusions. Generating a file records the batch for audit; it does not move money.</p>}
    </section>
    <section className="surface-card salary-run-register"><div><p className="eyebrow">EMPLOYEE REGISTER</p><h2>Payroll entries</h2><span>{detail.run.status === "draft" ? "Open an employee to enter reviewed statutory amounts and adjustments." : "This payroll snapshot is read-only."}</span></div><div>{detail.entries.map((entry) => detail.run.status === "draft" ? <PayrollEntryEditor entry={entry} key={entry.id} runId={runId} statutory={suggestions.get(entry.employeeUserId) ?? null} /> : <article className="salary-mobile-card" key={entry.id}><span><strong>{entry.employeeName}</strong><small>{entry.employeeCode}</small></span><span><small>Earned gross</small><strong>{formatPaise(entry.earnedGrossPaise)}</strong></span><span><small>Deductions</small><strong>{formatPaise(entry.totalDeductionsPaise)}</strong></span><span><small>Net pay</small><strong>{formatPaise(entry.netPayPaise)}</strong></span>{["payslips_published", "paid"].includes(detail.run.status) && <Link href={`/salary/payslips/${entry.id}`}>Payslip</Link>}</article>)}</div></section>
  </main>;
}
