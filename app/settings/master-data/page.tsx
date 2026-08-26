import Link from "next/link";

import { hasPermission } from "../../../lib/auth/authorization";
import { requirePermission } from "../../../lib/auth/server";
import { getDatabase } from "../../../lib/dashboard/postgres/pool";
import { listMasterDataWorkspace } from "../../../lib/master-data/repository";
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

      <section className="package-kpi-grid kpi-grid">
        <article className="surface-card checklist-kpi"><span>ACTIVE</span><strong>{String(workspace.metrics.active).padStart(2, "0")}</strong><small>Offered when raising a request</small></article>
        <article className="surface-card checklist-kpi"><span>USUALLY MANDATORY</span><strong>{String(workspace.metrics.mandatory).padStart(2, "0")}</strong><small>Flagged as normally required</small></article>
        <article className="surface-card checklist-kpi"><span>LINKED TO A SERVICE</span><strong>{String(workspace.metrics.linkedToServices).padStart(2, "0")}</strong><small>Suggested by engagement type</small></article>
        <article className="surface-card checklist-kpi"><span>ARCHIVED</span><strong>{String(workspace.metrics.archived).padStart(2, "0")}</strong><small>Kept for history only</small></article>
      </section>

      <ChecklistRegister canManage={canManage} workspace={workspace} />
    </main>
  );
}
