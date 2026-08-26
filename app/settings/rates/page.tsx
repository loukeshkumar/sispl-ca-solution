import Link from "next/link";

import { hasPermission } from "../../../lib/auth/authorization";
import { requirePermission } from "../../../lib/auth/server";
import { indiaDateKey } from "../../../lib/attendance/calculations";
import { getDatabase } from "../../../lib/dashboard/postgres/pool";
import { formatPaise } from "../../../lib/payroll/money";
import { listRateCard } from "../../../lib/rates/repository";
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
  const derivedCost = card.rows.filter((row) => row.costBasis === "payroll").length;

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

      <section className="package-kpi-grid kpi-grid">
        <article className="surface-card checklist-kpi">
          <span>RATED PEOPLE</span><strong>{String(rated.length).padStart(2, "0")}</strong>
          <small>of {card.rows.length} active employees</small>
        </article>
        <article className="surface-card checklist-kpi">
          <span>AVERAGE CHARGE</span><strong>{averageCharge ? formatPaise(averageCharge) : "—"}</strong>
          <small>Per hour, across rated people</small>
        </article>
        <article className="surface-card checklist-kpi">
          <span>COST FROM PAYROLL</span><strong>{String(derivedCost).padStart(2, "0")}</strong>
          <small>Derived rather than typed</small>
        </article>
        <article className="surface-card checklist-kpi">
          <span>NEGOTIATED RATES</span><strong>{String(card.overrides.length).padStart(2, "0")}</strong>
          <small>Client exceptions on file</small>
        </article>
      </section>

      <RateCardEditor canManage={canManage} card={card} />
    </main>
  );
}
