"use client";

import { useMemo, useState } from "react";

import type { DashboardData } from "../lib/dashboard/types";

const navigation = ["Overview", "My work", "Clients", "Compliance", "Documents", "Calendar", "Team", "Billing", "Insights"];
const icons = ["⌂", "✓", "◇", "◫", "▱", "□", "♙", "₹", "⌁"];
const statuses = ["All", "Critical", "At risk", "Waiting", "Review"] as const;
const clientSegments = ["All clients", "Healthy", "Watch", "Critical"] as const;

function ClientsModule({ data }: { data: DashboardData }) {
  const [selectedId, setSelectedId] = useState(data.clients[0]?.id ?? "");
  const [segment, setSegment] = useState<(typeof clientSegments)[number]>("All clients");
  const [search, setSearch] = useState("");
  const selected = data.clients.find((client) => client.id === selectedId) ?? data.clients[0];
  const visible = data.clients.filter((client) =>
    (segment === "All clients" || client.risk === segment)
    && (!search || `${client.name} ${client.pan}`.toLowerCase().includes(search.toLowerCase())),
  );

  if (!selected) return <div className="empty">No clients are available for this firm.</div>;

  return (
    <div className="clients-module">
      <section className="clients-title">
        <div>
          <p><span>PORTFOLIO</span> {data.metrics.legalEntities} active clients</p>
          <h1>Client command centre</h1>
          <small>Review entities, registrations, engagements and compliance health from one place.</small>
        </div>
        <div>
          <button disabled title="Available in a later milestone">⇧ Import clients</button>
          <button disabled title="Available in a later milestone">＋ Add new client</button>
        </div>
      </section>

      <section className="client-metrics">
        <article><span className="cm violet">◇</span><div><small>CLIENT GROUPS</small><b>{data.metrics.clientGroups}</b><em>{data.metrics.legalEntities} legal entities</em></div></article>
        <article><span className="cm blue">◆</span><div><small>GST REGISTRATIONS</small><b>{data.metrics.gstRegistrations}</b><em>Active registrations</em></div></article>
        <article><span className="cm mint">✓</span><div><small>HEALTHY PORTFOLIO</small><b>{data.metrics.healthyPercentage}%</b><em>Computed from client health</em></div></article>
        <article><span className="cm coral">!</span><div><small>NEED ATTENTION</small><b>{data.metrics.attentionClients}</b><em>{data.metrics.criticalClients} critical clients</em></div></article>
      </section>

      <section className="client-layout">
        <div className="portfolio card">
          <div className="portfolio-tools">
            <label><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search client or masked PAN…" /></label>
            <div>{clientSegments.map((item) => <button key={item} onClick={() => setSegment(item)} className={segment === item ? "active" : ""}>{item}</button>)}</div>
            <button className="filter-btn" disabled>☷ Filters</button>
          </div>
          <div className="portfolio-head"><span>CLIENT / ENTITY</span><span>SERVICES</span><span>HEALTH</span><span>NEXT OBLIGATION</span><span>OWNER</span></div>
          {visible.map((client) => (
            <button className={selected.id === client.id ? "portfolio-row selected" : "portfolio-row"} key={client.id} onClick={() => setSelectedId(client.id)}>
              <div className="entity-cell"><span>{client.short}</span><div><b>{client.name}</b><small>{client.type} · PAN {client.pan}</small><em>{client.gstins} GSTIN{client.gstins === 1 ? "" : "s"}</em></div></div>
              <div className="service-chips">{client.services.slice(0, 3).map((service) => <span key={service}>{service}</span>)}{client.services.length > 3 && <i>+{client.services.length - 3}</i>}</div>
              <div className="client-health"><div><i style={{ width: `${client.health}%` }} /></div><b>{client.health}%</b><em className={client.risk.toLowerCase()}>{client.risk}</em></div>
              <div className="next-item"><b>{client.next}</b><small>{client.missing ? `${client.missing} items missing` : "Everything ready"}</small></div>
              <div className="portfolio-owner"><span>{client.owner.split(" ").map((part) => part[0]).join("")}</span><b>{client.owner}</b></div>
            </button>
          ))}
          {!visible.length && <div className="empty">No clients match this search.</div>}
        </div>

        <aside className="client-360 card">
          <div className="c360-cover"><div className="c360-orb one" /><div className="c360-orb two" /><span>{selected.short}</span><div><small>{selected.risk.toUpperCase()} CLIENT</small><h2>{selected.name}</h2><p>{selected.type} · {selected.city}</p></div><button aria-label="More client options" disabled>•••</button></div>
          <div className="c360-tabs"><button className="active">Overview</button><button disabled>Compliance</button><button disabled>Documents</button><button disabled>Billing</button></div>
          <div className="c360-body">
            <div className="profile-health"><div><span>RELATIONSHIP HEALTH</span><b>{selected.health}<small>/100</small></b><em className={selected.risk.toLowerCase()}>{selected.risk}</em></div><div className="mini-ring" style={{ background: `conic-gradient(#6f5ce7 0 ${selected.health}%,#eeecfb ${selected.health}%)` }}><i /></div></div>
            <section><p className="detail-label">REGISTRATIONS & IDENTITY</p><div className="detail-grid"><div><small>PAN</small><b>{selected.pan}</b></div><div><small>GSTIN</small><b>{selected.gstins} active</b></div><div><small>Relationship since</small><b>{selected.joined}</b></div><div><small>Owner</small><b>{selected.owner}</b></div></div></section>
            <section><p className="detail-label">ACTIVE SERVICES</p><div className="active-services">{selected.services.map((service, index) => <span key={service}><i>{["◇", "₹", "◫", "▱"][index % 4]}</i>{service}<b>Active</b></span>)}</div></section>
            <section><p className="detail-label">NEXT ACTION</p><div className="next-action"><span>◷</span><div><b>{selected.next}</b><small>{selected.missing ? `${selected.missing} documents or exceptions need attention` : "Ready for completion"}</small></div><button disabled>Open →</button></div></section>
            <div className="c360-actions"><button disabled>Request document</button><button disabled>Open Client 360 →</button></div>
          </div>
        </aside>
      </section>
    </div>
  );
}

export default function DashboardClient({ data }: { data: DashboardData }) {
  const [active, setActive] = useState("Overview");
  const [filter, setFilter] = useState<(typeof statuses)[number]>("All");
  const [query, setQuery] = useState("");
  const [menu, setMenu] = useState(false);
  const items = useMemo(() => data.work.filter((item) =>
    (filter === "All" || item.status === filter)
    && (!query || `${item.client} ${item.service} ${item.owner}`.toLowerCase().includes(query.toLowerCase())),
  ), [data.work, filter, query]);
  const activeOwnerInitials = [...new Set(data.work.map((item) => item.ownerInitials))].slice(0, 3);
  const displayNumber = (value: number) => value.toString().padStart(2, "0");

  return (
    <main className="shell">
      <aside className={`side ${menu ? "show" : ""}`}>
        <div className="logo"><div>S</div><span><b>SISPL</b><small>CA SOLUTION</small></span><button onClick={() => setMenu(false)} aria-label="Close navigation">×</button></div>
        <button className="firm-card"><span>{data.practice.initials}</span><div><small>ACTIVE FIRM</small><b>{data.practice.name}</b><em>{data.practice.subtitle}</em></div><i>⌄</i></button>
        <p className="section-label">MAIN MENU</p>
        <nav>{navigation.map((item, index) => <button key={item} onClick={() => { setActive(item); setMenu(false); }} className={active === item ? "active" : ""}><i>{icons[index]}</i><span>{item}</span>{item === "My work" && <em>{data.metrics.attentionNeeded}</em>}</button>)}</nav>
        <div className="upgrade"><span>✦</span><b>Practice health</b><p>Relationship health is calculated from the active client portfolio.</p><div><i style={{ background: `linear-gradient(90deg,#7965ef 0 ${data.metrics.averageHealth}%,#334263 ${data.metrics.averageHealth}%)` }} /><b>{data.metrics.averageHealth}%</b></div><button disabled>View insights →</button></div>
        <div className="account"><span>{data.practice.administratorInitials}</span><div><b>{data.practice.administratorName}</b><small>{data.practice.administratorRole}</small></div><button disabled aria-label="Account options">•••</button></div>
      </aside>

      {menu && <button className="backdrop" onClick={() => setMenu(false)} aria-label="Close navigation" />}
      <section className="main">
        <header>
          <button className="menu" onClick={() => setMenu(true)} aria-label="Open navigation">☰</button>
          <label className="global-search"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search clients, tasks or owners…" /><kbd>⌘ K</kbd></label>
          <div className="header-actions"><button className="fy">FY 2026–27⌄</button><button className="notify" aria-label="Notifications" disabled>♢<i /></button><button className="add" disabled>＋ <span>Create new</span></button></div>
        </header>

        <div className="page">
          {active === "Clients" ? <ClientsModule data={data} /> : <>
            <section className="title-row"><div><p><span>{data.source === "postgres" ? "LOCAL DATABASE" : "DEMO"}</span> {data.titleDate}</p><h1>{active === "Overview" ? "Your practice, in command." : active}</h1><small>Good day, {data.practice.administratorName}. Here’s the pulse of your firm.</small></div><div className="title-actions"><button disabled>Export report</button><button onClick={() => setActive("My work")}>Open my work <span>→</span></button></div></section>

            <section className="pulse-card">
              <div className="pulse-glow one" /><div className="pulse-glow two" />
              <div className="pulse-copy"><span className="pulse-kicker">TODAY’S OPERATIONS PULSE</span><h2>{data.metrics.attentionNeeded} deadlines need<br /><em>your attention.</em></h2><p>{data.metrics.waitingOnClient} waiting on clients and {data.metrics.pendingReview} pending review.</p><div className="pulse-actions"><button onClick={() => setFilter("Critical")}>Review critical work →</button><span>{activeOwnerInitials.map((owner) => <i key={owner}>{owner}</i>)}<b>{data.practice.activeTeamMembers} team members active</b></span></div></div>
              <div className="pulse-visual"><div className="orbit outer"><i /><i /><i /></div><div className="orbit middle" /><div className="pulse-score"><span>ON-TIME RATE</span><b>{data.metrics.onTimeRate}<small>%</small></b><em>Current open work</em></div><div className="float-card fc1"><span>✓</span><div><b>{displayNumber(data.metrics.completed)}</b><small>Completed</small></div></div><div className="float-card fc2"><span>!</span><div><b>{displayNumber(data.metrics.overdue)}</b><small>Overdue</small></div></div></div>
            </section>

            <section className="metrics">
              <button onClick={() => setFilter("Critical")}><div className="metric-icon red">!</div><div><span>OVERDUE</span><b>{displayNumber(data.metrics.overdue)}</b><small><i>Live</i> from work items</small></div><div className="spark red-spark"><i /><i /><i /><i /><i /><i /><i /></div></button>
              <button onClick={() => setFilter("At risk")}><div className="metric-icon gold">◷</div><div><span>DUE THIS WEEK</span><b>{displayNumber(data.metrics.dueThisWeek)}</b><small>Next seven days</small></div><div className="spark gold-spark"><i /><i /><i /><i /><i /><i /><i /></div></button>
              <button onClick={() => setFilter("Waiting")}><div className="metric-icon blue">⇧</div><div><span>WAITING ON CLIENT</span><b>{displayNumber(data.metrics.waitingOnClient)}</b><small>Blocked work items</small></div><div className="spark blue-spark"><i /><i /><i /><i /><i /><i /><i /></div></button>
              <button onClick={() => setFilter("Review")}><div className="metric-icon mint">✓</div><div><span>PENDING REVIEW</span><b>{displayNumber(data.metrics.pendingReview)}</b><small>Review queue</small></div><div className="spark mint-spark"><i /><i /><i /><i /><i /><i /><i /></div></button>
            </section>

            <section className="bento">
              <div className="work-panel card"><div className="card-head"><div><span className="mini-kicker">PRIORITY QUEUE</span><h3>Attention needed</h3><p>Ranked by deadline and dependency</p></div><button onClick={() => setFilter("All")}>View all work →</button></div><div className="tabs">{statuses.map((status) => <button key={status} className={filter === status ? "active" : ""} onClick={() => setFilter(status)}>{status}{status === "All" && <i>{data.work.length}</i>}</button>)}</div><div className="work-table"><div className="table-labels"><span>CLIENT & ASSIGNMENT</span><span>PROGRESS</span><span>OWNER</span><span>DUE DATE</span><span /></div>{items.map((item) => <article key={item.id}><div className="client"><span className={item.color}>{item.initials}</span><div><b>{item.client}</b><p>{item.service}<i>•</i>{item.period}<em className={item.status.toLowerCase().replace(" ", "")}>{item.status}</em></p><small>{item.note}</small></div></div><div className="progress"><div><i style={{ width: `${item.progress}%` }} /></div><span>{item.progress}%</span></div><div className="owner"><span>{item.ownerInitials}</span><b>{item.owner}</b></div><div className="deadline"><b>{item.due}</b><small>{item.dueDetail}</small></div><button className="go" disabled aria-label={`Open ${item.client} work item`}>→</button></article>)}{!items.length && <div className="empty">No work matches your search.</div>}</div></div>

              <aside className="insight-column">
                <div className="health-card card"><div className="card-head"><div><span className="mini-kicker">COMPLIANCE</span><h3>Health score</h3></div><button disabled>•••</button></div><div className="health-body"><div className="donut" style={{ background: `conic-gradient(#6f5ce7 0 ${data.metrics.averageHealth}%,#eeeefe ${data.metrics.averageHealth}%)` }}><div><b>{data.metrics.averageHealth}</b><span>/100</span><small>Portfolio</small></div></div><div className="health-copy"><span><i className="good" />Healthy <b>{data.metrics.legalEntities - data.metrics.attentionClients}</b></span><span><i className="warn" />Watch <b>{data.clients.filter((client) => client.risk === "Watch").length}</b></span><span><i className="bad" />Critical <b>{data.metrics.criticalClients}</b></span></div></div><div className="service-list">{data.serviceHealth.map((service) => <div key={service.name}><span>{service.name}</span><div><i style={{ width: `${service.value}%` }} /></div><b>{service.value}%</b><em>Live</em></div>)}</div></div>
                <div className="deadline-card card"><div className="card-head"><div><span className="mini-kicker">UPCOMING</span><h3>Deadline radar</h3></div><button disabled>Calendar →</button></div><div className="deadline-list">{data.deadlines.slice(0, 3).map((deadline) => <article key={deadline.id}><time><b>{deadline.day}</b><small>{deadline.month}</small></time><div><b>{deadline.label}</b><small>{deadline.summary}</small></div><span className={deadline.urgent ? "urgent" : ""}>{deadline.relative}</span></article>)}</div></div>
              </aside>
            </section>
          </>}
        </div>
      </section>
    </main>
  );
}
