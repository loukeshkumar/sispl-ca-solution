import Link from "next/link";

import { hasPermission } from "../../../lib/auth/authorization";
import { requirePermission } from "../../../lib/auth/server";
import { indiaDateKey } from "../../../lib/attendance/calculations";
import { getDatabase } from "../../../lib/dashboard/postgres/pool";
import { formatPaise } from "../../../lib/payroll/money";
import { listRateCard } from "../../../lib/rates/repository";
import { KpiCard } from "../../dashboard/dashboard-ui";
import { RateCardEditor } from "./rate-card";

export const dynamic = "force-dynamic";

export default async function RateCardPage() {
  const session = await requirePermission("billing:read", "/settings/rates");
  const todayKey = indiaDateKey();
  const card = await listRateCard(getDatabase(), session.tenantId, todayKey);
  const canManage = hasPermission(session, "billing:manage");

  const rated = card.rows.filter((row) => row.chargePaisePerHour !== null);
  const averageCharge = rated.length
    ? Math.round(rated.reduce((total, row) => total + (row.chargePaisePerHour ?? 0), 0) / rated.length)
    : 0;
  // Margin only means anything where both halves are known, so it is averaged
  // over those people rather than over everybody.
  const margins = card.rows
    .filter((row) => row.chargePaisePerHour !== null && row.costPaisePerHour !== null)
    .map((row) => row.chargePaisePerHour! - row.costPaisePerHour!);
  const averageMargin = margins.length
    ? Math.round(margins.reduce((total, value) => total + value, 0) / margins.length)
    : null;

  return (
    <main className="client-page-shell settings-stack-shell">
      <header className="client-page-header">
        <Link href="/?workspace=timesheets">&larr; Back to Timesheets</Link>
        <div>
          <p className="eyebrow">SETTINGS · RATE CARD</p>
          <h1>Charge-out and cost rates</h1>
          <span>
            What an hour of each person&apos;s time is worth, and what it costs the firm. Recorded time is valued at the
            rate in force on the day it was worked, so a revision never rewrites what earlier work was worth.
          </span>
        </div>
      </header>

      <section className="kpi-grid">
        <KpiCard
          icon="billing"
          label="AVERAGE CHARGE"
          note="Per hour, across rated people"
          tone="blue"
          value={averageCharge ? formatPaise(averageCharge) : "—"}
        />
        <KpiCard
          icon="insights"
          label="AVERAGE MARGIN"
          note={margins.length ? `Per hour, where cost is known (${margins.length})` : "No cost on file yet"}
          tone={averageMargin !== null && averageMargin < 0 ? "red" : "mint"}
          value={averageMargin === null ? "—" : formatPaise(averageMargin)}
        />
        <KpiCard
          icon="team"
          label="RATED PEOPLE"
          note={`of ${card.rows.length} active employees`}
          tone={rated.length === card.rows.length ? "mint" : "amber"}
          value={String(rated.length).padStart(2, "0")}
        />
        <KpiCard
          icon="clients"
          label="NEGOTIATED RATES"
          note="Client exceptions on file"
          tone="blue"
          value={String(card.overrides.length).padStart(2, "0")}
        />
      </section>

      <RateCardEditor canManage={canManage} card={card} />
    </main>
  );
}
