import Link from "next/link";

import { hasPermission } from "../../../lib/auth/authorization";
import { requirePermission } from "../../../lib/auth/server";
import { getDatabase } from "../../../lib/dashboard/postgres/pool";
import { listAttendanceMasters } from "../../../lib/attendance-masters/repository";
import { KpiCard } from "../../dashboard/dashboard-ui";
import AttendanceMasters from "./attendance-masters";

export const dynamic = "force-dynamic";

const tabs = new Set(["leave", "holidays", "shifts"]);

export default async function AttendanceMastersPage({ searchParams }: { searchParams: Promise<{ masterError?: string; saved?: string; tab?: string }> }) {
  const session = await requirePermission("attendance:use", "/settings/attendance");
  const query = await searchParams;
  const workspace = await listAttendanceMasters(getDatabase(), session.tenantId);
  const canManage = hasPermission(session, "attendance:manage");
  const initialTab = tabs.has(query.tab ?? "") ? (query.tab as "leave" | "holidays" | "shifts") : "leave";

  return (
    <main className="client-page-shell settings-stack-shell">
      <header className="client-page-header">
        <Link href="/?workspace=attendance">&larr; Back to Attendance</Link>
        <div>
          <p className="eyebrow">SETTINGS · ATTENDANCE MASTERS</p>
          <h1>Leave, holidays and shifts</h1>
          <span>The master data the attendance workspace runs on: what leave employees may request, which days the firm is closed, and the timings employees work to.</span>
        </div>
      </header>

      {query.saved === "1" && <p className="package-form-banner schedule-saved-banner" role="status">The master record was saved and applies to attendance from now on.</p>}
      {query.masterError === "1" && <p className="package-form-banner" role="alert">That record could not be updated. Refresh and try again.</p>}

      <section className="kpi-grid">
        <KpiCard
          icon="calendar"
          label="ACTIVE LEAVE TYPES"
          note="Offered on the leave request form"
          tone={workspace.metrics.activeLeaveTypes ? "blue" : "amber"}
          value={String(workspace.metrics.activeLeaveTypes).padStart(2, "0")}
        />
        <KpiCard
          icon="calendar"
          label="UPCOMING HOLIDAYS"
          note={`From ${workspace.todayKey} onward`}
          tone="mint"
          value={String(workspace.metrics.upcomingHolidays).padStart(2, "0")}
        />
        <KpiCard
          icon="clock"
          label="ACTIVE SHIFTS"
          note="Assignable to employees"
          tone={workspace.metrics.activeShifts ? "blue" : "amber"}
          value={String(workspace.metrics.activeShifts).padStart(2, "0")}
        />
      </section>

      <AttendanceMasters canManage={canManage} initialTab={initialTab} workspace={workspace} />

      <p className="package-control-note-text">
        Archiving keeps history and only removes the record from future use. Public holidays are excluded from scheduled
        working days when a month is prepared; months already locked are never recalculated.
      </p>
    </main>
  );
}
