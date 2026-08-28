import Link from "next/link";

import { hasPermission } from "../../../lib/auth/authorization";
import { requirePermission } from "../../../lib/auth/server";
import { indiaDateKey } from "../../../lib/attendance/calculations";
import { getDatabase } from "../../../lib/dashboard/postgres/pool";
import { listCapabilityServices } from "../../../lib/team/capability-repository";
import {
  listProcedures,
  listProcedureSteps,
  servicesWithoutProcedure,
  type ProcedureStepRow,
} from "../../../lib/procedures/repository";
import { KpiCard } from "../../dashboard/dashboard-ui";
import { ProcedureEditor } from "./procedure-editor";

export const dynamic = "force-dynamic";

export default async function ProceduresPage() {
  const session = await requirePermission("services:read", "/settings/procedures");
  const database = getDatabase();
  const todayKey = indiaDateKey();
  const canManage = hasPermission(session, "services:manage");

  const [procedures, services, uncovered] = await Promise.all([
    listProcedures(database, session.tenantId),
    listCapabilityServices(database, session.tenantId),
    servicesWithoutProcedure(database, session.tenantId),
  ]);

  const stepsByVersion: Record<string, ProcedureStepRow[]> = {};
  for (const procedure of procedures) {
    stepsByVersion[procedure.id] = await listProcedureSteps(database, session.tenantId, procedure.id);
  }

  const published = procedures.filter((row) => row.status === "published");
  const drafts = procedures.filter((row) => row.status === "draft");
  const totalSteps = published.reduce((total, row) => total + row.stepCount, 0);

  return (
    <main className="client-page-shell settings-stack-shell">
      <header className="client-page-header">
        <Link href="/?workspace=work">&larr; Back to My work</Link>
        <div>
          <p className="eyebrow">SETTINGS · PROCEDURES</p>
          <h1>Work procedures</h1>
          <span>
            The steps the firm follows for each service. A published procedure is copied onto every obligation raised
            for that service, so progress is counted from what was actually done rather than typed — and the record can
            say who did each step and when.
          </span>
        </div>
      </header>

      <section className="kpi-grid">
        <KpiCard
          icon="compliance"
          label="SERVICES COVERED"
          note={`of ${services.length} active services`}
          tone={uncovered.length === 0 ? "mint" : "amber"}
          value={String(published.length).padStart(2, "0")}
        />
        <KpiCard
          icon="review"
          label="STEPS PUBLISHED"
          note="Across every live procedure"
          tone="blue"
          value={String(totalSteps).padStart(2, "0")}
        />
        <KpiCard
          icon="documents"
          label="DRAFTS"
          note="Not yet applied to any work"
          tone={drafts.length ? "amber" : "blue"}
          value={String(drafts.length).padStart(2, "0")}
        />
        <KpiCard
          icon="alert"
          label="UNCOVERED"
          note="Progress still typed by hand"
          tone={uncovered.length ? "red" : "mint"}
          value={String(uncovered.length).padStart(2, "0")}
        />
      </section>

      <ProcedureEditor
        canManage={canManage}
        procedures={procedures}
        services={services}
        stepsByVersion={stepsByVersion}
        todayKey={todayKey}
        uncovered={uncovered}
      />
    </main>
  );
}
