import Link from "next/link";
import { notFound } from "next/navigation";

import { hasPermission } from "../../../lib/auth/authorization";
import { requirePermission } from "../../../lib/auth/server";
import { getDatabase } from "../../../lib/dashboard/postgres/pool";
import { initials } from "../../../lib/dashboard/mapper";
import { getClient360Data } from "../../../lib/clients/repository";
import { listPortalContacts } from "../../../lib/portal/repository";
import { loadOptionalPanel } from "../../../lib/dashboard/optional-panel";
import { InitialsAvatar, ProgressBar } from "../../dashboard/dashboard-ui";
import ArchiveClientForm from "../archive-client-form";
import EditClientButton from "./edit-client-button";
import { DocumentRequestDialogButton } from "../../dashboard/document-request-dialog";
import { WorkDialogButton } from "../../dashboard/work-dialog";
import PortalAccessPanel from "../portal-access-panel";

import { AcceptancePanel } from "../acceptance-panel";
import { getAcceptance, listLetters } from "../../../lib/clients/acceptance-repository";
import { indiaDateKey } from "../../../lib/timesheets/period-repository";

export const dynamic = "force-dynamic";

const serviceLabels: Record<string, string> = {
  form_10b: "Form 10B",
  gstr_3b: "GSTR-3B",
  monthly_close: "Monthly close",
  tds_26q: "TDS 26Q",
};

function titleCase(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default async function Client360Page({ params, searchParams }: { params: Promise<{ clientId: string }>; searchParams: Promise<{ archiveError?: string }> }) {
  const { clientId } = await params;
  const session = await requirePermission("dashboard:read", `/clients/${clientId}`);
  const client = await getClient360Data(getDatabase(), session.tenantId, clientId);
  const [acceptance, letters] = await Promise.all([
    getAcceptance(getDatabase(), session.tenantId, clientId),
    listLetters(getDatabase(), session.tenantId, clientId),
  ]);
  if (!client) notFound();
  const isActive = client.status === "active";
  const canEdit = isActive && hasPermission(session, "clients:write");
  const canCreateWork = isActive && hasPermission(session, "work:write");
  const canRequestDocuments = isActive && hasPermission(session, "documents:write");
  const archiveError = (await searchParams).archiveError;
  const portalContacts = await loadOptionalPanel("portal-contacts", () => listPortalContacts(getDatabase(), session.tenantId, clientId), []);

  return (
    <main className="client-360-shell">
      <header className="client-360-header">
        <Link href="/?workspace=clients">← Back to clients</Link>
        <div className="client-360-title-row">
          <div className="client-360-identity"><InitialsAvatar initials={initials(client.displayName)} /><span><p className="eyebrow">CLIENT 360</p><h1>{client.displayName}</h1><small>{client.legalName}</small></span></div>
          {(canEdit || canCreateWork || canRequestDocuments) && <div className="client-360-actions">{canRequestDocuments && <DocumentRequestDialogButton initialClientId={client.id} variant="secondary">Request document</DocumentRequestDialogButton>}{canCreateWork && <WorkDialogButton legalEntityId={client.id}>Create work item</WorkDialogButton>}{canEdit && <><EditClientButton client={client} /><ArchiveClientForm clientId={client.id} clientName={client.displayName} /></>}</div>}
        </div>
      </header>

      {client.status === "archived" && <p className="client-form-banner client-archive-notice" role="status">This client is archived. Historical profile and compliance records remain available read-only.</p>}
      {archiveError === "active-obligations" && <p className="client-form-banner" role="alert">This client cannot be archived while open work or document requests remain. Complete or cancel those obligations first.</p>}

      <section className="client-360-grid">
        <article className="client-360-main surface-card">
          <div className="client-360-section-heading"><div><p className="eyebrow">RELATIONSHIP</p><h2>Practice profile</h2></div><span className={`client-risk-pill risk-${client.riskStatus}`}>{titleCase(client.riskStatus)}</span></div>
          <div className="client-360-detail-grid">
            <div><span>Entity type</span><strong>{client.entityType}</strong></div>
            <div><span>Masked PAN</span><strong>{client.maskedPan}</strong></div>
            <div><span>Location</span><strong>{client.city}</strong></div>
            <div><span>Relationship since</span><strong>{new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${client.relationshipStart}T00:00:00Z`))}</strong></div>
            <div><span>Relationship owner</span><strong>{client.ownerName ?? "Unassigned"}</strong></div>
            <div><span>GST registrations</span><strong>{client.gstRegistrations} active</strong></div>
          </div>

          <AcceptancePanel
            acceptance={acceptance}
            canWrite={hasPermission(session, "clients:write")}
            letters={letters}
            services={client.services}
            todayKey={indiaDateKey()}
          />
          <section className="client-360-services">
            <div className="client-360-section-heading"><div><p className="eyebrow">ENGAGEMENTS</p><h2>Active services</h2></div></div>
            <div>{client.services.map((service) => <span key={service}>{service}<small>Active</small></span>)}</div>
          </section>

          <section className="client-360-work">
            <div className="client-360-section-heading"><div><p className="eyebrow">DELIVERY</p><h2>Open work</h2></div><span>{client.work.length} items</span></div>
            <div className="client-360-work-list">
              {client.work.map((item) => (
                <article key={item.id}>
                  <div><strong>{serviceLabels[item.serviceKey] ?? titleCase(item.serviceKey)}</strong><span>{item.periodKey} · {item.assigneeName ?? "Unassigned"}</span></div>
                  <div><ProgressBar label={`${item.serviceKey} progress`} value={item.progress} /><small>{item.progress}%</small></div>
                  <div><strong>{new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${item.dueDate}T00:00:00Z`))}</strong><span>{titleCase(item.status)}</span></div>
                </article>
              ))}
              {!client.work.length && <p className="client-360-empty">No open work is assigned to this client.</p>}
            </div>
          </section>

          <PortalAccessPanel canManage={canEdit} contacts={portalContacts} legalEntityId={clientId} />
        </article>

        <aside className="client-360-aside surface-card">
          <p className="eyebrow">HEALTH SCORE</p>
          <strong className="client-360-score">{client.healthScore}<small>/100</small></strong>
          <ProgressBar label="Relationship health" value={client.healthScore} />
          <p>Relationship health combines service readiness, deadlines, and outstanding dependencies.</p>
          <dl><div><dt>Risk status</dt><dd>{titleCase(client.riskStatus)}</dd></div><div><dt>Active services</dt><dd>{client.services.length}</dd></div><div><dt>Open work</dt><dd>{client.work.length}</dd></div><div><dt>Missing items</dt><dd>{client.work.reduce((sum, item) => sum + item.missingItems, 0)}</dd></div></dl>
        </aside>
      </section>
    </main>
  );
}
