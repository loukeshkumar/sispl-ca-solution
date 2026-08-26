import { NextResponse } from "next/server";

import { authorizeRoutePermission } from "../../../../../lib/auth/server";
import { getDatabase } from "../../../../../lib/dashboard/postgres/pool";
import { getPayrollRunDetail, recordPayrollAccess } from "../../../../../lib/payroll/repository";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const csv = (value: string | number) => {
  let output = String(value);
  if (/^[=+\-@]/.test(output)) output = `'${output}`;
  return `"${output.replaceAll('"', '""')}"`;
};

export async function GET(_request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const authorization = await authorizeRoutePermission("salary:manage");
  if (!authorization.ok) return NextResponse.json({ error: "Payroll export is unavailable." }, { status: authorization.reason === "authentication_required" ? 401 : 403 });
  const { runId } = await params;
  if (!UUID_PATTERN.test(runId)) return NextResponse.json({ error: "Payroll run not found." }, { status: 404 });
  const database = getDatabase();
  const detail = await getPayrollRunDetail(database, authorization.session.tenantId, authorization.session.userId, runId);
  if (!detail) return NextResponse.json({ error: "Payroll run not found." }, { status: 404 });
  await recordPayrollAccess(database, authorization.session.tenantId, authorization.session.userId, runId, "payroll.export_viewed");
  const headers = ["Employee code", "Employee name", "Designation", "Calendar working days", "Employment scheduled days", "Employment excluded days", "Payable days", "LOP days", "Full gross (paise)", "Employment proration deduction (paise)", "Attendance deduction (paise)", "Earned gross (paise)", "Total deductions (paise)", "Net pay (paise)"];
  const rows = detail.entries.map((entry) => [entry.employeeCode, entry.employeeName, entry.designation, entry.periodScheduledHalfDays / 2, entry.scheduledHalfDays / 2, entry.employmentExcludedHalfDays / 2, entry.payableHalfDays / 2, entry.lopHalfDays / 2, entry.fullGrossPaise, entry.employmentProrationDeductionPaise, entry.attendanceDeductionPaise, entry.earnedGrossPaise, entry.totalDeductionsPaise, entry.netPayPaise]);
  const body = [headers, ...rows].map((row) => row.map(csv).join(",")).join("\r\n");
  return new NextResponse(`\uFEFF${body}`, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="payroll-${detail.run.periodKey}.csv"`, "Cache-Control": "private, no-store" } });
}
