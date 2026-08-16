import type { DashboardClient, DashboardData } from "../../lib/dashboard/types";
import { DashboardIcon } from "./dashboard-icons";
import { InitialsAvatar, KpiCard, PageTitle, ProgressBar, StatusBadge } from "./dashboard-ui";

export type ClientSegment = "All clients" | "Healthy" | "Watch" | "Critical";

const segments: ClientSegment[] = ["All clients", "Healthy", "Watch", "Critical"];
const riskTone = (risk: DashboardClient["risk"]) => ({ Critical: "red", Healthy: "mint", Watch: "amber" })[risk];

function ClientKpis({
  data,
  onSegmentChange,
  segment,
}: {
  data: DashboardData;
  onSegmentChange: (segment: ClientSegment) => void;
  segment: ClientSegment;
}) {
  return (
    <section aria-label="Client portfolio metrics" className="kpi-grid">
      <KpiCard icon="clients" label="CLIENT GROUPS" note={`${data.metrics.legalEntities} legal entities`} onClick={() => onSegmentChange("All clients")} pressed={segment === "All clients"} tone="blue" value={String(data.metrics.clientGroups)} />
      <KpiCard icon="documents" label="GST REGISTRATIONS" note="Active registrations" tone="blue" value={String(data.metrics.gstRegistrations)} />
      <KpiCard icon="review" label="HEALTHY PORTFOLIO" note="Computed from client health" onClick={() => onSegmentChange("Healthy")} pressed={segment === "Healthy"} tone="mint" value={`${data.metrics.healthyPercentage}%`} />
      <KpiCard icon="alert" label="NEED ATTENTION" note={`${data.metrics.criticalClients} critical clients`} onClick={() => onSegmentChange("Critical")} pressed={segment === "Critical"} tone="red" value={String(data.metrics.attentionClients)} />
    </section>
  );
}

function ClientPortfolio({
  clients,
  onClientSelect,
  onQueryChange,
  onSegmentChange,
  query,
  segment,
  selected,
}: {
  clients: DashboardClient[];
  onClientSelect: (clientId: string) => void;
  onQueryChange: (value: string) => void;
  onSegmentChange: (segment: ClientSegment) => void;
  query: string;
  segment: ClientSegment;
  selected: DashboardClient | undefined;
}) {
  return (
    <section className="client-portfolio-panel surface-card">
      <div className="panel-heading client-portfolio-heading">
        <div><p className="eyebrow">PORTFOLIO</p><h2>Client relationships</h2><span>{clients.length} matching entities</span></div>
        <button aria-label="Portfolio filters" className="icon-button" disabled type="button"><DashboardIcon name="filter" /></button>
      </div>
      <div className="client-tools">
        <label className="client-search"><DashboardIcon name="search" size={17} /><input aria-label="Search client or masked PAN" onChange={(event) => onQueryChange(event.target.value)} placeholder="Search client or masked PAN..." type="search" value={query} /></label>
        <div aria-label="Filter clients by health" className="segment-control">
          {segments.map((item) => <button aria-pressed={segment === item} key={item} onClick={() => onSegmentChange(item)} type="button">{item}</button>)}
        </div>
      </div>
      <div className="portfolio-list-head" aria-hidden="true"><span>CLIENT / ENTITY</span><span>SERVICES</span><span>HEALTH</span><span>NEXT OBLIGATION</span><span>OWNER</span></div>
      <div className="portfolio-list">
        {clients.map((client) => (
          <button
            aria-pressed={selected?.id === client.id}
            className="portfolio-row"
            key={client.id}
            onClick={() => onClientSelect(client.id)}
            type="button"
          >
            <span className="portfolio-identity">
              <InitialsAvatar initials={client.short} tone="violet" />
              <span><strong className="portfolio-client-name">{client.name}</strong><span className="portfolio-meta">{client.type} · PAN {client.pan}</span><em>{client.gstins} GSTIN{client.gstins === 1 ? "" : "s"}</em></span>
            </span>
            <span className="portfolio-services">{client.services.slice(0, 3).map((service) => <i key={service}>{service}</i>)}{client.services.length > 3 && <i>+{client.services.length - 3}</i>}</span>
            <span className="portfolio-health"><span><ProgressBar label={`${client.name} health`} value={client.health} /><b>{client.health}%</b></span><StatusBadge tone={riskTone(client.risk)}>{client.risk}</StatusBadge></span>
            <span className="portfolio-obligation"><strong>{client.next}</strong><small>{client.missing ? `${client.missing} items missing` : "Everything ready"}</small></span>
            <span className="portfolio-owner"><InitialsAvatar initials={client.owner.split(" ").map((part) => part[0]).join("")} tone="light" /><strong>{client.owner}</strong></span>
          </button>
        ))}
        {!clients.length && <div className="empty-state">No clients match the current filters.</div>}
      </div>
    </section>
  );
}

function ClientDetail({ client }: { client: DashboardClient | undefined }) {
  if (!client) return <aside className="client-detail-panel surface-card"><div className="empty-state">Select a client to view details.</div></aside>;

  return (
    <aside className="client-detail-panel surface-card">
      <div className="client-detail-cover">
        <div className="client-detail-heading">
          <InitialsAvatar initials={client.short} tone="light" />
          <div><p>CLIENT 360</p><h2 className="client-detail-title">{client.name}</h2><span>{client.type} · {client.city}</span></div>
        </div>
        <StatusBadge tone={riskTone(client.risk)}>{client.risk}</StatusBadge>
      </div>
      <div className="client-detail-body">
        <section className="relationship-health">
          <div><p className="detail-label">RELATIONSHIP HEALTH</p><strong>{client.health}<small>/100</small></strong><StatusBadge tone={riskTone(client.risk)}>{client.risk}</StatusBadge></div>
          <div className="client-health-ring" style={{ background: `conic-gradient(var(--violet) 0 ${client.health}%, #ebe9fb ${client.health}% 100%)` }}><i /></div>
        </section>
        <section className="detail-section">
          <p className="detail-label">REGISTRATIONS & IDENTITY</p>
          <div className="detail-grid">
            <div><span>PAN</span><strong>{client.pan}</strong></div>
            <div><span>GSTIN</span><strong>{client.gstins} active</strong></div>
            <div><span>Relationship since</span><strong>{client.joined}</strong></div>
            <div><span>Owner</span><strong>{client.owner}</strong></div>
          </div>
        </section>
        <section className="detail-section">
          <p className="detail-label">ACTIVE SERVICES</p>
          <div className="client-service-list">{client.services.map((service) => <span key={service}><DashboardIcon name="compliance" size={16} />{service}<b>Active</b></span>)}</div>
        </section>
        <section className="detail-section">
          <p className="detail-label">NEXT ACTION</p>
          <div className="client-next-action"><span><DashboardIcon name="clock" /></span><div><strong>{client.next}</strong><small>{client.missing ? `${client.missing} documents or exceptions need attention` : "Ready for completion"}</small></div></div>
        </section>
        <div className="client-detail-actions"><button className="secondary-button" disabled type="button">Request document</button><button className="primary-button" disabled type="button">Open Client 360 <DashboardIcon name="arrow" size={16} /></button></div>
      </div>
    </aside>
  );
}

export function ClientsWorkspace({
  clients,
  data,
  onClientSelect,
  onQueryChange,
  onSegmentChange,
  query,
  segment,
  selected,
}: {
  clients: DashboardClient[];
  data: DashboardData;
  onClientSelect: (clientId: string) => void;
  onQueryChange: (value: string) => void;
  onSegmentChange: (segment: ClientSegment) => void;
  query: string;
  segment: ClientSegment;
  selected: DashboardClient | undefined;
}) {
  return (
    <div className="clients-workspace">
      <PageTitle
        actions={<><button className="secondary-button" disabled type="button">Import clients</button><button className="primary-button" disabled type="button"><DashboardIcon name="plus" size={17} />Add client</button></>}
        description="Manage identity, services, health, and upcoming obligations."
        eyebrow="CLIENT PORTFOLIO"
        title="Clients"
      />
      <ClientKpis data={data} onSegmentChange={onSegmentChange} segment={segment} />
      <section className="clients-main">
        <ClientPortfolio clients={clients} onClientSelect={onClientSelect} onQueryChange={onQueryChange} onSegmentChange={onSegmentChange} query={query} segment={segment} selected={selected} />
        <ClientDetail client={selected} />
      </section>
    </div>
  );
}
