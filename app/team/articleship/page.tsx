import Link from "next/link";

import { hasPermission } from "../../../lib/auth/authorization";
import { requirePermission } from "../../../lib/auth/server";
import { indiaDateKey } from "../../../lib/attendance/calculations";
import { getDatabase } from "../../../lib/dashboard/postgres/pool";
import {
  listArticleshipRegister,
  listArticleshipSubjects,
  policyInForce,
} from "../../../lib/articleship/repository";
import { ArticleshipRegisterView } from "./register-view";

export const dynamic = "force-dynamic";

export default async function ArticleshipPage() {
  const session = await requirePermission("team:read", "/team/articleship");
  const database = getDatabase();
  const todayKey = indiaDateKey();
  const canManage = hasPermission(session, "team:manage");

  const [registrations, subjects, policy] = await Promise.all([
    listArticleshipRegister(database, session.tenantId, todayKey),
    listArticleshipSubjects(database, session.tenantId),
    policyInForce(database, session.tenantId, todayKey),
  ]);

  const active = registrations.filter((row) => row.status === "active");
  const attention = active.filter((row) => row.alerts.length > 0).length;
  const completingSoon = active.filter((row) => row.alerts.includes("completing_soon") || row.alerts.includes("overdue_completion")).length;
  const excessLeave = active.filter((row) => row.term.excessLeaveDays > 0).length;

  return (
    <main className="client-page-shell settings-stack-shell">
      <header className="client-page-header">
        <Link href="/?workspace=team">&larr; Back to Employees</Link>
        <div>
          <p className="eyebrow">PEOPLE OPERATIONS · ARTICLESHIP</p>
          <h1>Articleship register</h1>
          <span>
            Who is training under whom, from when, and when their training actually finishes once leave is accounted
            for. Leave is read from the attendance register, so this cannot disagree with it.
          </span>
        </div>
      </header>

      <section className="package-kpi-grid kpi-grid">
        <article className="surface-card checklist-kpi">
          <span>IN TRAINING</span><strong>{String(active.length).padStart(2, "0")}</strong>
          <small>Live registrations</small>
        </article>
        <article className="surface-card checklist-kpi">
          <span>NEEDING ATTENTION</span><strong>{String(attention).padStart(2, "0")}</strong>
          <small>Paperwork, leave, or term</small>
        </article>
        <article className="surface-card checklist-kpi">
          <span>COMPLETING SOON</span><strong>{String(completingSoon).padStart(2, "0")}</strong>
          <small>Within 60 days, or overrun</small>
        </article>
        <article className="surface-card checklist-kpi">
          <span>LEAVE EXCEEDED</span><strong>{String(excessLeave).padStart(2, "0")}</strong>
          <small>Term extended to make it up</small>
        </article>
      </section>

      <ArticleshipRegisterView
        canManage={canManage}
        policy={policy}
        registrations={registrations}
        subjects={subjects}
        todayKey={todayKey}
      />
    </main>
  );
}
