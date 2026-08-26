import Link from "next/link";
import { notFound } from "next/navigation";

import { requirePermission } from "../../../../lib/auth/server";
import { getDatabase } from "../../../../lib/dashboard/postgres/pool";
import { formatPaise } from "../../../../lib/payroll/money";
import { getSalaryStructureEditorData } from "../../../../lib/payroll/repository";
import { SalaryStructureForm } from "../../salary-structure-form";

export const dynamic = "force-dynamic";

export default async function SalaryStructurePage({ params }: { params: Promise<{ employeeId: string }> }) {
  const { employeeId } = await params;
  const session = await requirePermission("salary:manage", `/salary/structures/${employeeId}`);
  const data = await getSalaryStructureEditorData(getDatabase(), session.tenantId, session.userId, employeeId);
  if (!data) notFound();
  return <main className="salary-route-shell"><header className="salary-route-header"><Link href="/?workspace=salary">&larr; Back to Salary</Link><p className="eyebrow">SALARY STRUCTURE</p><h1>Salary structure · {data.employee.fullName}</h1><span>{data.employee.employeeCode} · {data.employee.designation}</span></header>
    {data.current && <section className="surface-card salary-current-structure"><div><p className="eyebrow">CURRENT VERSION</p><h2>Effective {data.current.effectiveFrom}</h2></div><div>{data.current.lines.map((line) => <span key={line.code}><small>{line.label}</small><strong>{formatPaise(line.monthlyAmountPaise)}</strong></span>)}</div></section>}
    <section className="surface-card salary-editor-card"><div><p className="eyebrow">CONTROLLED CHANGE</p><h2>{data.current ? "Create a new effective-dated version" : "Create salary structure"}</h2><p>Historical versions remain unchanged after payroll uses them.</p></div><SalaryStructureForm employeeUserId={data.employee.userId} initialLines={data.current?.lines} minimumEffectiveDate={data.current?.effectiveFrom} /></section>
  </main>;
}
