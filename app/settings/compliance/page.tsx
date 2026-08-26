import Link from "next/link";

import { hasPermission } from "../../../lib/auth/authorization";
import { requirePermission } from "../../../lib/auth/server";
import { getDatabase } from "../../../lib/dashboard/postgres/pool";
import { listComplianceScheduleWorkspace } from "../../../lib/compliance/repository";
import ScheduleRegister from "./schedule-register";
import { ClientScheduleRegister } from "./client-schedule-register";
import { EscalationLadder } from "./escalation-ladder";
import { listEscalationRules } from "../../../lib/escalation/repository";
import {
  clientsEntitledTo,
  firmRulesToday,
  listClientSchedules,
  listExtensions,
} from "../../../lib/compliance/client-schedule-repository";
import { indiaDateKey } from "../../../lib/compliance/repository";

export const dynamic = "force-dynamic";

export default async function ComplianceSchedulesPage() {
  const session = await requirePermission("services:read", "/settings/compliance");
  const workspace = await listComplianceScheduleWorkspace(getDatabase(), session.tenantId);
  const canManage = hasPermission(session, "services:manage");
  const todayKey = indiaDateKey();
  const [schedules, extensions, engagements, firmRules, ladder] = await Promise.all([
    listClientSchedules(getDatabase(), session.tenantId),
    listExtensions(getDatabase(), session.tenantId),
    clientsEntitledTo(getDatabase(), session.tenantId, todayKey),
    firmRulesToday(getDatabase(), session.tenantId, todayKey),
    listEscalationRules(getDatabase(), session.tenantId),
  ]);

  return (
    <main className="client-page-shell settings-stack-shell">
      <header className="client-page-header">
        <Link href="/?workspace=service-management">&larr; Back to Service Management</Link>
        <div>
          <p className="eyebrow">SETTINGS</p>
          <h1>Compliance schedules</h1>
          <span>Rules that generate recurring obligations from each client&rsquo;s active package.</span>
        </div>
      </header>

      <ScheduleRegister canManage={canManage} workspace={workspace} />
      <ClientScheduleRegister
        canManage={canManage}
        engagements={engagements}
        extensions={extensions}
        firmRules={firmRules}
        schedules={schedules}
        services={workspace.services}
        todayKey={todayKey}
      />
      <EscalationLadder canManage={canManage} rules={ladder} />
    </main>
  );
}
