"use client";

import Link from "next/link";
import { useActionState } from "react";
import { BadgeIndianRupee, FileCheck2, Landmark, WalletCards } from "lucide-react";

import { formatPaise } from "../../lib/payroll/money";
import type { SalaryWorkspaceData } from "../../lib/payroll/repository";
import {
  approvePayrollRunAction, createPayrollRunAction, markPayrollPaidAction, publishPayslipsAction,
  submitPayrollRunAction, type SalaryActionState,
} from "../salary/actions";
import { EmptyState, KpiCard, PageTitle, StatusBadge } from "./dashboard-ui";

const initialState: SalaryActionState = { error: "", fieldErrors: {} };
const statusTone = (status: string) => status === "paid" || status === "payslips_published" ? "mint" : status === "submitted" ? "amber" : "blue";
const monthEnd = (periodKey: string) => {
  const [year, month] = periodKey.split("-").map(Number);
  return `${periodKey}-${String(new Date(Date.UTC(year, month, 0)).getUTCDate()).padStart(2, "0")}`;
};

function CreatePayroll({ periodKey }: { periodKey: string }) {
  const [state, action, pending] = useActionState(createPayrollRunAction, initialState);
  return <form action={action} className="salary-create-run surface-card">
    <div><p className="eyebrow">NEW PAYROLL</p><h2>Create payroll</h2><span>Requires a locked attendance month and salary structure for every employee.</span></div>
    <label><span>Payroll month</span><input defaultValue={periodKey} name="periodKey" required type="month" /></label>
    <label><span>Pay date</span><input defaultValue={monthEnd(periodKey)} name="payDate" required type="date" /></label>
    <button className="primary-button" disabled={pending} type="submit">{pending ? "Preparing..." : "Create payroll"}</button>
    {state.error && <p role="alert">{state.error}</p>}
  </form>;
}

function OwnPayslips({ data }: { data: SalaryWorkspaceData }) {
  return <section className="salary-own-payslips surface-card">
    <div className="panel-heading"><div><p className="eyebrow">MY PAYSLIPS</p><h2>Published salary records</h2><span>Only payslips released by payroll are visible here.</span></div><WalletCards aria-hidden="true" /></div>
    <div className="salary-payslip-list">{data.ownPayslips.map((payslip) => <Link className="salary-mobile-card" href={`/salary/payslips/${payslip.entryId}`} key={payslip.entryId}><span><strong>{payslip.periodKey}</strong><small>Pay date {payslip.payDate}</small></span><strong>{formatPaise(payslip.netPayPaise)}</strong><StatusBadge tone="mint">{payslip.status === "paid" ? "Paid" : "Published"}</StatusBadge></Link>)}{!data.ownPayslips.length && <EmptyState description="Payslips appear here once a payroll run is approved and published." icon="salary" title="No payslips yet" />}</div>
  </section>;
}

function PayrollActions({ canApprove, run }: { canApprove: boolean; run: SalaryWorkspaceData["runs"][number] }) {
  return <div className="salary-inline-actions">
    <Link href={`/salary/runs/${run.id}`}>Open</Link>
    {run.status === "draft" && <form action={submitPayrollRunAction}><input name="runId" type="hidden" value={run.id} /><button type="submit">Submit payroll</button></form>}
    {run.status === "submitted" && canApprove && <form action={approvePayrollRunAction}><input name="runId" type="hidden" value={run.id} /><input aria-label="Approval reason" name="reason" placeholder="Approval authorization note" required /><button type="submit">Approve &amp; lock</button></form>}
    {run.status === "approved_locked" && canApprove && <form action={publishPayslipsAction}><input name="runId" type="hidden" value={run.id} /><input aria-label="Publication reason" name="reason" placeholder="Publication authorization note" required /><button type="submit">Publish payslips</button></form>}
    {run.status === "payslips_published" && canApprove && <form action={markPayrollPaidAction}><input name="runId" type="hidden" value={run.id} /><input aria-label="Payment reason" name="reason" placeholder="Payment authorization note" required /><input aria-label="Payment reference" name="paymentReference" placeholder="Payment reference" required /><button type="submit">Mark paid</button></form>}
  </div>;
}

export function SalaryWorkspace({ canApprove, data }: { canApprove: boolean; data: SalaryWorkspaceData }) {
  return <div className="salary-workspace">
    <PageTitle description="Manage effective-dated salary structures, attendance-linked payroll, approvals, and private payslips." eyebrow="PEOPLE OPERATIONS" title="Salary & payroll" />
    {data.canManage ? <>
      <section className="salary-kpi-grid kpi-grid"><KpiCard icon="team" label="SALARY STRUCTURES" note="Active employee versions" tone="blue" value={String(data.metrics.activeStructures).padStart(2, "0")} /><KpiCard icon="work" label="PAYABLE EMPLOYEES" note="Current payroll run" tone="mint" value={String(data.metrics.payableEmployees).padStart(2, "0")} /><KpiCard icon="review" label="DRAFT RUNS" note="Still editable" tone="amber" value={String(data.metrics.draftRuns).padStart(2, "0")} /><KpiCard icon="billing" label="NET PAYROLL" note="Current month" tone="mint" value={formatPaise(data.metrics.totalNetPaise)} /></section>
      <CreatePayroll periodKey={data.periodKey} />
      <section className="salary-main-grid">
        <section className="salary-structures surface-card"><div className="panel-heading"><div><p className="eyebrow">SALARY STRUCTURES</p><h2>Employee salary setup</h2><span>Each change creates a new effective-dated version.</span></div><BadgeIndianRupee aria-hidden="true" /></div><div className="salary-employee-list">{data.employees.map((employee) => <article className="salary-mobile-card" key={employee.userId}><span><strong>{employee.fullName}</strong><small>{employee.employeeCode} · {employee.designation}</small></span><span><small>{employee.salaryEffectiveFrom ? `Effective ${employee.salaryEffectiveFrom}` : "Not configured"}</small><strong>{employee.monthlyGrossPaise === null ? "—" : formatPaise(employee.monthlyGrossPaise)}</strong></span><Link className="secondary-button" href={`/salary/structures/${employee.userId}`}>{employee.salaryEffectiveFrom ? "New version" : "Configure"}</Link></article>)}</div></section>
        <section className="salary-runs surface-card"><div className="panel-heading"><div><p className="eyebrow">PAYROLL RUNS</p><h2>Monthly control register</h2><span>Draft → submitted → approved → published → paid</span></div><Landmark aria-hidden="true" /></div><div className="salary-run-list">{data.runs.map((run) => <article className="salary-mobile-card" key={run.id}><span><strong>{run.periodKey}</strong><small>{run.employeeCount} employees · Pay {run.payDate}</small></span><span><small>Net payroll</small><strong>{formatPaise(run.totalNetPaise)}</strong></span><StatusBadge tone={statusTone(run.status)}>{run.status.replaceAll("_", " ")}</StatusBadge><PayrollActions canApprove={canApprove} run={run} /></article>)}{!data.runs.length && <EmptyState description="Lock the attendance period first, then create the monthly payroll run." icon="salary" title="No payroll runs yet" />}</div></section>
      </section>
      <section className="salary-control-note surface-card"><FileCheck2 aria-hidden="true" /><div><strong>Statutory review is controlled, not automatic</strong><span>PF, ESI, professional tax, and income-tax amounts must be reviewed and entered by an authorized payroll administrator before submission.</span></div></section>
      <OwnPayslips data={data} />
    </> : <OwnPayslips data={data} />}
  </div>;
}
