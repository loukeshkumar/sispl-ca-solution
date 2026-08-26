import Link from "next/link";
import { notFound } from "next/navigation";

import { hasPermission } from "../../../../lib/auth/authorization";
import { requirePermission } from "../../../../lib/auth/server";
import { getDatabase } from "../../../../lib/dashboard/postgres/pool";
import { formatPaise } from "../../../../lib/payroll/money";
import { getPublishedPayslip } from "../../../../lib/payroll/repository";

export const dynamic = "force-dynamic";

export default async function PayslipPage({ params }: { params: Promise<{ entryId: string }> }) {
  const { entryId } = await params;
  const session = await requirePermission("salary:read:own", `/salary/payslips/${entryId}`);
  const payslip = await getPublishedPayslip(getDatabase(), session.tenantId, session.userId, entryId, hasPermission(session, "salary:manage"));
  if (!payslip) notFound();
  const earnings = payslip.lines.filter((line) => line.kind === "earning");
  const deductions = payslip.lines.filter((line) => line.kind === "deduction");
  const totalEarningsPaise = earnings.reduce((sum, line) => sum + line.amountPaise, 0);
  return <main className="salary-payslip-shell"><div className="salary-payslip-toolbar"><Link href="/?workspace=salary">&larr; Back to Salary</Link><span>Use your browser&apos;s Print command to save this payslip as PDF.</span></div><article className="salary-payslip surface-card">
    <header><div><p className="eyebrow">SISPL CA SOLUTION</p><h1>Salary payslip</h1><span>Pay period {payslip.run.periodKey}</span></div><div><strong>{payslip.entry.employeeName}</strong><span>{payslip.entry.employeeCode} · {payslip.entry.designation}</span><small>Pay date {payslip.run.payDate}</small></div></header>
    <section className="payslip-attendance"><div><span>Calendar working days</span><strong>{payslip.entry.periodScheduledHalfDays / 2}</strong></div><div><span>Employment scheduled days</span><strong>{payslip.entry.scheduledHalfDays / 2}</strong></div><div><span>Payable days</span><strong>{payslip.entry.payableHalfDays / 2}</strong></div><div><span>LOP days</span><strong>{payslip.entry.lopHalfDays / 2}</strong></div></section>
    <section className="payslip-columns"><div><h2>EARNINGS</h2>{earnings.map((line) => <p key={line.code}><span>{line.label}</span><strong>{formatPaise(line.amountPaise)}</strong></p>)}<p className="payslip-subtotal"><span>Total earnings</span><strong>{formatPaise(totalEarningsPaise)}</strong></p><small>Earned gross after attendance: {formatPaise(payslip.entry.earnedGrossPaise)}</small></div><div><h2>DEDUCTIONS</h2>{deductions.map((line) => <p key={line.code}><span>{line.label}</span><strong>{formatPaise(line.amountPaise)}</strong></p>)}<p className="payslip-subtotal"><span>Total deductions</span><strong>{formatPaise(payslip.entry.totalDeductionsPaise)}</strong></p></div></section>
    <footer><div><span>NET PAY</span><strong>{formatPaise(payslip.entry.netPayPaise)}</strong></div>{payslip.run.paymentReference && <p>Payment reference: {payslip.run.paymentReference}</p>}<small>This system-generated payslip reflects the approved payroll snapshot. Statutory values were reviewed and entered by the payroll administrator.</small></footer>
  </article></main>;
}
