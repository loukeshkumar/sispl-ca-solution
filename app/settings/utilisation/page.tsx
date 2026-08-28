import Link from "next/link";
import { and, asc, eq } from "drizzle-orm";

import { employeeProfiles, tenantMemberships, users } from "../../../db/schema";
import { hasPermission } from "../../../lib/auth/authorization";
import { requirePermission } from "../../../lib/auth/server";
import { indiaDateKey } from "../../../lib/attendance/calculations";
import { getDatabase } from "../../../lib/dashboard/postgres/pool";
import { listFirmUtilisation, listUtilisationTargetRows } from "../../../lib/rates/utilisation-repository";
import { KpiCard } from "../../dashboard/dashboard-ui";
import { Attainment } from "./attainment";
import { TargetEditor } from "./target-editor";

export const dynamic = "force-dynamic";

export default async function UtilisationSettingsPage() {
  const session = await requirePermission("timesheets:manage", "/settings/utilisation");
  const database = getDatabase();
  const todayKey = indiaDateKey();
  const canManage = hasPermission(session, "team:manage");

  const [targets, employees, utilisation] = await Promise.all([
    listUtilisationTargetRows(database, session.tenantId),
    database.select({
      fullName: users.fullName,
      roleKey: tenantMemberships.roleKey,
      userId: employeeProfiles.userId,
    }).from(employeeProfiles)
      .innerJoin(users, eq(users.id, employeeProfiles.userId))
      .innerJoin(tenantMemberships, and(
        eq(tenantMemberships.tenantId, employeeProfiles.tenantId),
        eq(tenantMemberships.userId, employeeProfiles.userId),
      ))
      .where(and(eq(employeeProfiles.tenantId, session.tenantId), eq(tenantMemberships.status, "active")))
      .orderBy(asc(users.fullName)),
    listFirmUtilisation(database, session.tenantId, todayKey.slice(0, 7)).catch(() => null),
  ]);

  const measured = utilisation ? utilisation.people.length - utilisation.unmeasured : 0;
  // "Meeting target" counts anybody not short of it: above target is not a miss.
  const onTarget = utilisation?.people.filter((person) => person.band === "on_target" || person.band === "over").length ?? 0;

  return (
    <main className="client-page-shell settings-stack-shell">
      <header className="client-page-header">
        <Link href="/?workspace=timesheets">&larr; Back to Timesheets</Link>
        <div>
          <p className="eyebrow">SETTINGS · UTILISATION</p>
          <h1>Utilisation targets</h1>
          <span>
            The share of available time each person is expected to sell. Utilisation is measured against these rather
            than against the rest of the team, so it stays honest when everybody drifts in the same direction.
          </span>
        </div>
      </header>

      <section className="kpi-grid">
        <KpiCard
          icon="insights"
          label="FIRM UTILISATION"
          note={`Chargeable of available, ${todayKey.slice(0, 7)}`}
          tone="blue"
          value={utilisation?.utilisationBps == null ? "—" : `${(utilisation.utilisationBps / 100).toFixed(1)}%`}
        />
        <KpiCard
          icon="review"
          label="MEETING TARGET"
          note={`of ${measured} measured this month`}
          tone={onTarget === measured ? "mint" : "amber"}
          value={String(onTarget).padStart(2, "0")}
        />
        <KpiCard
          icon="settings"
          label="ROLE TARGETS"
          note="Inherited by everyone in the role"
          tone="blue"
          value={String(targets.filter((row) => row.scope === "role").length).padStart(2, "0")}
        />
        <KpiCard
          icon="team"
          label="OVERRIDES"
          note="People measured to their own figure"
          tone="mint"
          value={String(targets.filter((row) => row.scope === "employee").length).padStart(2, "0")}
        />
      </section>

      <TargetEditor canManage={canManage} employees={employees} targets={targets} todayKey={todayKey} />

      <Attainment periodKey={todayKey.slice(0, 7)} utilisation={utilisation} />
    </main>
  );
}
