import Link from "next/link";

import { requirePermission } from "../../../lib/auth/server";
import { getDatabase } from "../../../lib/dashboard/postgres/pool";
import { previewDraft, unbilledByClient } from "../../../lib/billing/time-billing-repository";
import { indiaDateKey } from "../../../lib/billing/repository";
import { DraftForm } from "./draft-form";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const monthLabel = (key: string) => new Intl.DateTimeFormat("en-IN", {
  month: "long", timeZone: "UTC", year: "numeric",
}).format(new Date(`${key}-01T00:00:00Z`));

/** The month just gone, which is what a firm bills. */
function lastMonth(todayKey: string) {
  const [year, month] = todayKey.split("-").map(Number);
  return new Date(Date.UTC(year!, month! - 2, 1)).toISOString().slice(0, 7);
}

const lastDayOf = (periodKey: string) => {
  const [year, month] = periodKey.split("-").map(Number);
  return new Date(Date.UTC(year!, month!, 0)).toISOString().slice(0, 10);
};

export default async function BillFromTimePage({
  searchParams,
}: {
  searchParams: Promise<{ client?: string; period?: string }>;
}) {
  const session = await requirePermission("billing:manage", "/?workspace=billing");
  const { client, period } = await searchParams;
  const todayKey = indiaDateKey();
  const periodKey = /^\d{4}-(0[1-9]|1[0-2])$/.test(period ?? "") ? period! : lastMonth(todayKey);
  const clients = await unbilledByClient(getDatabase(), session.tenantId);
  const chosen = UUID_PATTERN.test(client ?? "") ? clients.find((row) => row.legalEntityId === client) : undefined;

  const draft = chosen
    ? await previewDraft(
      getDatabase(),
      session.tenantId,
      chosen.legalEntityId,
      `${periodKey}-01`,
      lastDayOf(periodKey),
      `General advisory · ${monthLabel(periodKey)}`,
    )
    : null;

  return (
    <main className="client-page-shell settings-stack-shell">
      <header className="client-page-header">
        <Link href="/?workspace=billing">&larr; Back to Billing</Link>
        <div>
          <p className="eyebrow">BILLING</p>
          <h1>Bill from recorded time</h1>
          <span>
            Lines are proposed from unbilled billable time at the rates in force. Raising the draft claims those
            entries, so the same hours cannot appear on a second invoice.
          </span>
        </div>
      </header>

      <section className="surface-card from-time-picker">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">UNBILLED TIME</p>
            <h2>{clients.length === 0 ? "Nothing is waiting to be billed" : `${clients.length} client${clients.length === 1 ? "" : "s"} with unbilled time`}</h2>
          </div>
        </div>
        <ul className="from-time-clients">
          {clients.map((row) => (
            <li className={row.legalEntityId === chosen?.legalEntityId ? "is-chosen" : ""} key={row.legalEntityId}>
              <Link href={`/billing/from-time?client=${row.legalEntityId}&period=${periodKey}`}>
                <strong>{row.clientName}</strong>
                <span>
                  {Math.floor(row.minutes / 60)}h {String(row.minutes % 60).padStart(2, "0")}m unbilled · oldest {row.oldest}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {chosen && draft && (draft.lines.length > 0
        ? (
          <DraftForm
            clientName={chosen.clientName}
            draft={draft}
            legalEntityId={chosen.legalEntityId}
            periodLabel={monthLabel(periodKey)}
          />
        )
        : (
          <section className="surface-card from-time-picker">
            <p>
              {chosen.clientName} has unbilled time, but none of it falls in {monthLabel(periodKey)}. Their oldest
              unbilled entry is {chosen.oldest}.
            </p>
          </section>
        ))}
    </main>
  );
}
