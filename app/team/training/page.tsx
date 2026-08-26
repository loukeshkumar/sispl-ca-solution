import Link from "next/link";

import { hasPermission } from "../../../lib/auth/authorization";
import { requirePermission } from "../../../lib/auth/server";
import { indiaDateKey } from "../../../lib/attendance/calculations";
import { getDatabase } from "../../../lib/dashboard/postgres/pool";
import { listCapabilityServices } from "../../../lib/team/capability-repository";
import { formatHours } from "../../../lib/training/cpe";
import { listTrainingWorkspace } from "../../../lib/training/repository";
import { TrainingView } from "./training-view";

export const dynamic = "force-dynamic";

export default async function TrainingPage() {
  const session = await requirePermission("team:read", "/team/training");
  const database = getDatabase();
  const todayKey = indiaDateKey();
  const canManage = hasPermission(session, "team:manage");

  const [workspace, services] = await Promise.all([
    listTrainingWorkspace(database, session.tenantId, todayKey),
    listCapabilityServices(database, session.tenantId),
  ]);

  const obliged = workspace.members.filter((member) => member.standing);
  const met = obliged.filter((member) => member.standing!.compliant).length;
  const blockShort = obliged.filter((member) => !member.standing!.block.compliant).length;
  const loggedThisYear = workspace.records
    .filter((row) => Number(row.completedOn.slice(0, 4)) === workspace.year)
    .reduce((total, row) => total + row.minutes, 0);

  return (
    <main className="client-page-shell settings-stack-shell">
      <header className="client-page-header">
        <Link href="/?workspace=team">&larr; Back to Employees</Link>
        <div>
          <p className="eyebrow">PEOPLE OPERATIONS · TRAINING</p>
          <h1>Continuing education and training</h1>
          <span>
            What everybody has been trained on, and where members stand against the hours they owe — measured against
            the calendar year and the rolling block, because the two fail independently.
          </span>
        </div>
      </header>

      <section className="package-kpi-grid kpi-grid">
        <article className="surface-card checklist-kpi">
          <span>MEMBERS MET</span><strong>{String(met).padStart(2, "0")}</strong>
          <small>of {obliged.length} with an obligation</small>
        </article>
        <article className="surface-card checklist-kpi">
          <span>SHORT OVER THE BLOCK</span><strong>{String(blockShort).padStart(2, "0")}</strong>
          <small>Earlier years cannot be redone</small>
        </article>
        <article className="surface-card checklist-kpi">
          <span>LOGGED THIS YEAR</span><strong>{formatHours(loggedThisYear)}</strong>
          <small>Across everybody, {workspace.year}</small>
        </article>
        <article className="surface-card checklist-kpi">
          <span>RECORDS</span><strong>{String(workspace.records.length).padStart(2, "0")}</strong>
          <small>From {workspace.year - 2} onward</small>
        </article>
      </section>

      <TrainingView canManage={canManage} services={services} workspace={workspace} />
    </main>
  );
}
