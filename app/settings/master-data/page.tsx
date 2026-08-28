import Link from "next/link";

import { hasPermission } from "../../../lib/auth/authorization";
import { requirePermission } from "../../../lib/auth/server";
import { getDatabase } from "../../../lib/dashboard/postgres/pool";
import { listMasterDataWorkspace } from "../../../lib/master-data/repository";
import { KpiCard } from "../../dashboard/dashboard-ui";
import ChecklistRegister from "./checklist-register";

export const dynamic = "force-dynamic";

export default async function MasterDataPage() {
  const session = await requirePermission("services:read", "/settings/master-data");
  const workspace = await listMasterDataWorkspace(getDatabase(), session.tenantId);
  const canManage = hasPermission(session, "services:manage");

  return (
    <main className="client-page-shell settings-stack-shell">
      <header className="client-page-header">
        <Link href="/?workspace=service-management">&larr; Back to Service Management</Link>
        <div>
          <p className="eyebrow">SETTINGS · MASTER DATA</p>
          <h1>Documents needed</h1>
          <span>The standard documents this firm requests from clients, defined once and reused on every request.</span>
        </div>
      </header>

      <section className="kpi-grid">
        <KpiCard
          icon="documents"
          label="ACTIVE"
          note="Offered when raising a request"
          tone={workspace.metrics.active ? "blue" : "amber"}
          value={String(workspace.metrics.active).padStart(2, "0")}
        />
        <KpiCard
          icon="alert"
          label="USUALLY MANDATORY"
          note="Flagged as normally required"
          tone="amber"
          value={String(workspace.metrics.mandatory).padStart(2, "0")}
        />
        <KpiCard
          icon="services"
          label="LINKED TO A SERVICE"
          note="Suggested by engagement type"
          tone="mint"
          value={String(workspace.metrics.linkedToServices).padStart(2, "0")}
        />
        <KpiCard
          icon="documents"
          label="ARCHIVED"
          note="Kept for history only"
          tone="blue"
          value={String(workspace.metrics.archived).padStart(2, "0")}
        />
      </section>

      <ChecklistRegister canManage={canManage} workspace={workspace} />
    </main>
  );
}
