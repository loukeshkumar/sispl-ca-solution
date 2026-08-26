"use client";

import { PackageOpen, Search, Settings2 } from "lucide-react";
import Link from "next/link";

import { PackageDialogButton } from "./package-dialog";
import { useMemo, useState } from "react";

import type { PackageSetupWorkspaceData } from "../../lib/packages/repository";
import { formatPackageFee } from "../../lib/packages/validation";
import { EmptyState, KpiCard, PageTitle, StatusBadge } from "./dashboard-ui";

export function PackageSetupWorkspace({ canManage, workspace }: { canManage: boolean; workspace: PackageSetupWorkspaceData }) {
  const [query, setQuery] = useState("");
  const normalized = query.trim().toLowerCase();
  const packages = useMemo(
    () => workspace.packages.filter((item) => !normalized || `${item.code} ${item.name} ${item.services.map((service) => service.name).join(" ")}`.toLowerCase().includes(normalized)),
    [normalized, workspace.packages],
  );

  return <section className="package-setup-workspace">
    <PageTitle
      actions={<div className="package-title-actions"><Link className="secondary-button" href="/?workspace=service-management"><Settings2 aria-hidden="true" />Service master</Link>{canManage && <PackageDialogButton><PackageOpen aria-hidden="true" />Create package</PackageDialogButton>}</div>}
      description="Compose commercial packages from the approved service master without changing historical client agreements."
      eyebrow="COMMERCIAL CONTROL"
      title="Package setup"
    />
    <section className="package-kpi-grid kpi-grid">
      <KpiCard icon="packageSetup" label="ACTIVE SERVICES" note="Sourced from Service Management" tone="blue" value={String(workspace.metrics.activeServices).padStart(2, "0")} />
      <KpiCard icon="clientPackages" label="ACTIVE PACKAGES" note="Available for assignment" tone="mint" value={String(workspace.metrics.activePackages).padStart(2, "0")} />
      <KpiCard icon="packageSetup" label="ARCHIVED PACKAGES" note="Historical catalogue entries" tone="amber" value={String(workspace.metrics.archivedPackages).padStart(2, "0")} />
      <KpiCard icon="billing" label="AVERAGE PACKAGE FEE" note="Across active packages" tone="blue" value={formatPackageFee(workspace.metrics.averageFeePaise)} />
    </section>
    <section aria-label="Package catalogue" className="package-catalogue-panel surface-card">
      <div className="package-register-toolbar">
        <div><p className="eyebrow">PACKAGES</p><h2>Package catalogue</h2><span>{packages.length} matching packages</span></div>
        <label className="package-workspace-search"><Search aria-hidden="true" /><input aria-label="Search packages" onChange={(event) => setQuery(event.target.value)} placeholder="Search packages or included services..." type="search" value={query} /></label>
      </div>
      <div className="package-register-head package-plan-head"><span>Package</span><span>Included services</span><span>Fee</span><span>Status</span><span>Action</span></div>
      <div className="package-register-body">
        {packages.map((item) => <article className="package-register-row package-plan-row" key={item.id}>
          <span><strong>{item.name}</strong><small>{item.code} · {item.billingCycle.replaceAll("_", " ")}</small></span>
          <span className="package-service-chip-list">{item.services.slice(0, 4).map((service) => <i key={service.id}>{service.code}</i>)}{item.services.length > 4 && <i>+{item.services.length - 4}</i>}</span>
          <span><strong>{formatPackageFee(item.standardFeePaise)}</strong><small>per {item.billingCycle.replaceAll("_", " ")}</small></span>
          <StatusBadge tone={item.status === "active" ? "mint" : "neutral"}>{item.status}</StatusBadge>
          {canManage ? <PackageDialogButton className="row-action-link" initial={item} packageId={item.id}>Edit</PackageDialogButton> : <span>View only</span>}
        </article>)}
        {!packages.length && <EmptyState description="Adjust the search, or build a package from the approved service master." icon="packageSetup" title="No packages match this search" />}
      </div>
    </section>
  </section>;
}
