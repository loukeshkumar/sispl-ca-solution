import Link from "next/link";

import { hasPermission } from "../../../lib/auth/authorization";
import { requirePermission } from "../../../lib/auth/server";
import { getDatabase } from "../../../lib/dashboard/postgres/pool";
import { indiaDateKey, listPeriodQueue, policyInForce } from "../../../lib/timesheets/period-repository";
import { PeriodBoard } from "./period-board";

export const dynamic = "force-dynamic";

/** The month just gone: the one a person is actually asked to submit. */
function lastMonthKey(todayKey: string) {
  const [year, month] = todayKey.split("-").map(Number);
  const previous = new Date(Date.UTC(year!, month! - 2, 1));
  return previous.toISOString().slice(0, 7);
}

export default async function TimesheetPeriodsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const session = await requirePermission("timesheets:use", "/timesheets/periods");
  const { period } = await searchParams;
  const todayKey = indiaDateKey();
  const periodKey = /^\d{4}-(0[1-9]|1[0-2])$/.test(period ?? "") ? period! : lastMonthKey(todayKey);
  const canManage = hasPermission(session, "timesheets:manage");

  const [rows, policy] = await Promise.all([
    listPeriodQueue(getDatabase(), session.tenantId, periodKey),
    policyInForce(getDatabase(), session.tenantId, todayKey),
  ]);

  return (
    <main className="client-page-shell settings-stack-shell">
      <header className="client-page-header">
        <Link href="/?workspace=timesheets">&larr; Back to Timesheets</Link>
        <div>
          <p className="eyebrow">TIMESHEETS</p>
          <h1>Monthly approval</h1>
          <span>
            Time older than {policy.backdateWindowDays} day{policy.backdateWindowDays === 1 ? "" : "s"} is recorded by a
            manager, with a reason. An approved month cannot be changed by anybody until it is reopened.
          </span>
        </div>
      </header>

      <PeriodBoard canManage={canManage} periodKey={periodKey} rows={rows} viewerUserId={session.userId} />
    </main>
  );
}
