import { CheckCircle2, Clock3, Layers3 } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { requirePermission } from "../../../lib/auth/server";
import { getDatabase } from "../../../lib/dashboard/postgres/pool";
import { getAssignmentDetail } from "../../../lib/packages/repository";
import { formatPackageFee } from "../../../lib/packages/validation";
import { StatusBadge } from "../../dashboard/dashboard-ui";
import { CancelAssignmentForm } from "../cancel-assignment-form";

const tone: Record<string, string> = { active: "mint", scheduled: "blue", ended: "neutral", cancelled: "red" };

export default async function ClientPackageDetailPage({ params, searchParams }: {
  params: Promise<{ assignmentId: string }>;
  searchParams: Promise<{ cancelError?: string }>;
}) {
  const { assignmentId } = await params;
  const query = await searchParams;
  const session = await requirePermission("client_packages:manage", `/client-packages/${assignmentId}`);
  const assignment = await getAssignmentDetail(getDatabase(), session.tenantId, assignmentId);
  if (!assignment) notFound();

  const included = assignment.services.filter((service) => service.source === "package");
  const addons = assignment.services.filter((service) => service.source === "addon");

  return (
    <section className="package-route-page package-detail-page">
      <Link className="route-back-link" href="/?workspace=client-packages">← Back to Client Packages</Link>
      <header className="package-detail-header">
        <div>
          <p className="eyebrow">CLIENT PACKAGE 360</p>
          <h1>{assignment.clientName}</h1>
          <span>{assignment.packageName} · {assignment.packageCode}</span>
        </div>
        <StatusBadge tone={tone[assignment.status] ?? "neutral"}>{assignment.status}</StatusBadge>
      </header>
      <div className="package-detail-grid">
        <main className="package-detail-main surface-card">
          <div className="package-detail-commercial">
            <div><Clock3 aria-hidden="true" /><span><small>Effective period</small><strong>{assignment.effectiveFrom} → {assignment.effectiveTo ?? "Open ended"}</strong></span></div>
            <div><CheckCircle2 aria-hidden="true" /><span><small>Agreed fee</small><strong>{formatPackageFee(assignment.agreedFeePaise)} · {assignment.billingCycle.replaceAll("_", " ")}</strong></span></div>
          </div>
          <section>
            <p className="eyebrow">IMMUTABLE SERVICE SNAPSHOT</p>
            <h2>Agreement services</h2>
            <div className="package-snapshot-services">
              {included.map((service) => <article key={service.id}><Layers3 aria-hidden="true" /><span><strong>{service.name}</strong><small>{service.code} · Included</small></span></article>)}
              {addons.map((service) => <article className="is-addon" key={service.id}><Layers3 aria-hidden="true" /><span><strong>{service.name}</strong><small>{service.code} · Add-on</small></span></article>)}
            </div>
          </section>
          {assignment.status === "cancelled" && <section className="package-cancellation-record"><strong>Cancelled</strong><span>{assignment.cancellationReason}</span><small>{assignment.cancelledAt}</small></section>}
        </main>
        <aside>
          <section className="package-summary-card surface-card">
            <p className="eyebrow">CONTROL SUMMARY</p>
            <dl>
              <div><dt>Package snapshot</dt><dd>{assignment.packageName}</dd></div>
              <div><dt>Standard fee</dt><dd>{formatPackageFee(assignment.standardFeePaise)}</dd></div>
              <div><dt>Agreed fee</dt><dd>{formatPackageFee(assignment.agreedFeePaise)}</dd></div>
              <div><dt>Included</dt><dd>{included.length} services</dd></div>
              <div><dt>Add-ons</dt><dd>{addons.length} services</dd></div>
            </dl>
          </section>
          {(["active", "scheduled"] as string[]).includes(assignment.status) && <CancelAssignmentForm assignmentId={assignment.id} error={query.cancelError} />}
        </aside>
      </div>
    </section>
  );
}
