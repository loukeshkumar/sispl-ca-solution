"use client";

import { useMemo, useState } from "react";

import { ClientsWorkspace, type ClientSegment } from "./dashboard/clients-workspace";
import { DashboardShell } from "./dashboard/dashboard-shell";
import { OverviewWorkspace, type OverviewFilter } from "./dashboard/overview-workspace";
import type { DashboardData } from "../lib/dashboard/types";

export default function DashboardClient({ data }: { data: DashboardData }) {
  const [active, setActive] = useState("Overview");
  const [filter, setFilter] = useState<OverviewFilter>("All");
  const [query, setQuery] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [selectedId, setSelectedId] = useState(data.clients[0]?.id ?? "");
  const [segment, setSegment] = useState<ClientSegment>("All clients");
  const [clientQuery, setClientQuery] = useState("");

  const items = useMemo(() => data.work.filter((item) => (
    (filter === "All" || item.status === filter)
    && (!query || `${item.client} ${item.service} ${item.owner}`.toLowerCase().includes(query.toLowerCase()))
  )), [data.work, filter, query]);

  const visibleClients = useMemo(() => data.clients.filter((client) => (
    (segment === "All clients" || client.risk === segment)
    && (!clientQuery || `${client.name} ${client.pan}`.toLowerCase().includes(clientQuery.toLowerCase()))
  )), [clientQuery, data.clients, segment]);

  const selected = data.clients.find((client) => client.id === selectedId) ?? data.clients[0];

  return (
    <DashboardShell
      active={active}
      data={data}
      menuOpen={menuOpen}
      onMenuClose={() => setMenuOpen(false)}
      onMenuOpen={() => setMenuOpen(true)}
      onNavigate={(destination) => {
        setActive(destination);
        setMenuOpen(false);
      }}
      onQueryChange={setQuery}
      query={query}
    >
      {active === "Clients" ? (
        <ClientsWorkspace
          clients={visibleClients}
          data={data}
          onClientSelect={setSelectedId}
          onQueryChange={setClientQuery}
          onSegmentChange={setSegment}
          query={clientQuery}
          segment={segment}
          selected={selected}
        />
      ) : (
        <OverviewWorkspace
          active={active}
          data={data}
          filter={filter}
          items={items}
          onFilterChange={setFilter}
          onOpenMyWork={() => setActive("My work")}
        />
      )}
    </DashboardShell>
  );
}
