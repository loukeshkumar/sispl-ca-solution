import Link from "next/link";

import { requirePermission } from "../../../lib/auth/server";
import { getDatabase } from "../../../lib/dashboard/postgres/pool";
import {
  assignmentStandings,
  priceCatalogue,
  servicesWithoutStandards,
  unmeasuredAssignments,
} from "../../../lib/packages/pricing-repository";
import { BAND_LABELS, marginBand, pricingSummary, standingSummary } from "../../../lib/packages/pricing";
import { indiaDateKey } from "../../../lib/billing/repository";
import { StatusBadge } from "../../dashboard/dashboard-ui";

export const dynamic = "force-dynamic";

const rupees = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

const TONE = { healthy: "blue", loss: "red", strong: "mint", thin: "amber", unknown: "slate" } as const;

export default async function PackagePricingPage() {
  const session = await requirePermission("packages:read", "/settings/package-pricing");
  const todayKey = indiaDateKey();
  const [catalogue, assignments, unmeasured, unstandardised] = await Promise.all([
    priceCatalogue(getDatabase(), session.tenantId, todayKey),
    assignmentStandings(getDatabase(), session.tenantId, todayKey),
    unmeasuredAssignments(getDatabase(), session.tenantId),
    servicesWithoutStandards(getDatabase(), session.tenantId),
  ]);

  return (
    <main className="client-page-shell settings-stack-shell">
      <header className="client-page-header">
        <Link href="/?workspace=service-management">&larr; Back to Service Management</Link>
        <div>
          <p className="eyebrow">SETTINGS</p>
          <h1>What packages cost to deliver</h1>
          <span>
            Built from the firm&rsquo;s own numbers: the services in each package, how often the calendar raises them,
            the standard time for each, and the rates in force. Nothing here is typed.
          </span>
        </div>
      </header>

      <section className="surface-card pricing-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">AT DESIGN</p>
            <h2>{catalogue.length === 0 ? "No active packages" : `${catalogue.length} package${catalogue.length === 1 ? "" : "s"}`}</h2>
            <span>The fee against what the firm&rsquo;s own standards say a year of it costs.</span>
          </div>
        </div>

        {/* A margin of 100% on every package means no rate exists, not that the
            firm has solved profitability. Saying so beats letting it read well. */}
        {catalogue.length > 0 && catalogue[0]!.costPaisePerHour === null && (
          <p className="client-form-banner" role="alert">
            No cost rate is recorded for anybody, so every margin below reads as 100%. Record rates before pricing
            against these figures.
          </p>
        )}

        <ul className="pricing-list">
          {catalogue.map((row) => (
            <li className={`pricing-row is-${marginBand(row.expectedMargin)}`} key={row.packageId}>
              <div className="pricing-row-head">
                <strong>{row.name}</strong>
                <span className="pricing-code">{row.code}</span>
                <StatusBadge tone={TONE[marginBand(row.expectedMargin)]}>{BAND_LABELS[marginBand(row.expectedMargin)]}</StatusBadge>
                {row.incomplete && <StatusBadge tone="amber">Estimate incomplete</StatusBadge>}
              </div>
              <small className="pricing-line">
                {rupees(row.annualFeePaise)} a year · {pricingSummary(row)}
              </small>
              <ul className="pricing-services">
                {row.expected.services.map((service) => (
                  <li key={service.serviceCode}>
                    {service.serviceCode} ·{" "}
                    {service.assumed
                      ? (service.standardMinutes === null ? "no standard time recorded" : "no schedule governs it")
                      : `${service.frequency} × ${service.occurrences} × ${service.standardMinutes} min`}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </section>

      <section className="surface-card pricing-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">IN DELIVERY</p>
            <h2>{assignments.length === 0 ? "No live assignments" : `${assignments.length} live assignment${assignments.length === 1 ? "" : "s"}`}</h2>
            <span>
              Margin says whether the package pays for itself. Realisation says how much of its value the firm is
              giving away. A package can be comfortably profitable and heavily discounted at once.
            </span>
          </div>
        </div>

        <ul className="pricing-list">
          {assignments.map((row) => (
            <li className={`pricing-row is-${marginBand(row.margin)}`} key={row.assignmentId}>
              <div className="pricing-row-head">
                <strong>{row.clientName}</strong>
                <span className="pricing-code">{row.packageName}</span>
                <StatusBadge tone={TONE[marginBand(row.margin)]}>{BAND_LABELS[marginBand(row.margin)]}</StatusBadge>
              </div>
              <small className="pricing-line">{standingSummary(row)}</small>
              <small className="pricing-meta">
                {rupees(row.feePaise)} of fee over {row.periodFrom} to {row.periodTo} ·{" "}
                {rupees(row.actual.costPaise)} at cost · {rupees(row.actual.chargeValuePaise)} at charge rates
              </small>
            </li>
          ))}
        </ul>
      </section>

      {(unmeasured.length > 0 || unstandardised.length > 0) && (
        <section className="surface-card pricing-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">WHAT IS NOT MEASURED</p>
              <h2>Gaps that make the figures above less than they seem</h2>
              <span>A margin computed over missing inputs is a number nobody should price against.</span>
            </div>
          </div>
          <ul className="pricing-gaps">
            {unmeasured.map((row) => (
              <li key={row.legalEntityId}>
                <strong>{row.clientName}</strong> pays for {row.packageName} and has no time recorded at all.
              </li>
            ))}
            {unstandardised.map((row) => (
              <li key={row.code}>
                <strong>{row.code}</strong> is sold in a package and has no standard time, so it contributes nothing
                to any estimate.
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
