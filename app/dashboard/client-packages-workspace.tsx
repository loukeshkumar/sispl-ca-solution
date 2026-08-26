"use client";

import { CalendarClock, CircleDollarSign, PackageCheck, Search, UserRoundX } from "lucide-react";
import Link from "next/link";

import { ClientPackageDialogButton } from "./client-package-dialog";
import { useMemo, useState } from "react";

import type { ClientPackageWorkspaceData } from "../../lib/packages/repository";
import { formatPackageFee, packageBillingCycles } from "../../lib/packages/validation";
import { KpiCard, PageTitle, StatusBadge } from "./dashboard-ui";

const statusTone: Record<string, string> = { active: "mint", scheduled: "blue", ended: "neutral", cancelled: "red" };

export function ClientPackagesWorkspace({ workspace }: { workspace: ClientPackageWorkspaceData }) {
  const [billingCycle, setBillingCycle] = useState("all");
  const [packageId, setPackageId] = useState("all");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const assignments = useMemo(() => workspace.assignments.filter((assignment) => {
    const matchesStatus = status === "all" || assignment.status === status;
    const matchesPackage = packageId === "all" || assignment.packageId === packageId;
    const matchesCycle = billingCycle === "all" || assignment.billingCycle === billingCycle;
    const matchesQuery = !query.trim() || `${assignment.clientName} ${assignment.packageName} ${assignment.packageCode} ${assignment.billingCycle}`.toLowerCase().includes(query.trim().toLowerCase());
    return matchesStatus && matchesPackage && matchesCycle && matchesQuery;
  }), [billingCycle, packageId, query, status, workspace.assignments]);

  return (
    <section className="client-packages-workspace">
      <PageTitle actions={<ClientPackageDialogButton><PackageCheck aria-hidden="true" />Assign package</ClientPackageDialogButton>} description="Control each client's service entitlement, commercial terms, renewals, and agreement history." eyebrow="CLIENT COMMERCIALS" title="Client packages" />
      <section className="package-kpi-grid kpi-grid">
        <KpiCard icon="clientPackages" label="ACTIVE PACKAGES" note="Current client agreements" tone="mint" value={String(workspace.metrics.activeAssignments).padStart(2, "0")} />
        <KpiCard icon="calendar" label="UPCOMING RENEWALS" note="Ending in the next 30 days" tone="amber" value={String(workspace.metrics.renewalsDue).padStart(2, "0")} />
        <KpiCard icon="clients" label="UNASSIGNED CLIENTS" note="No current base package" tone="red" value={String(workspace.metrics.unassignedClients).padStart(2, "0")} />
        <KpiCard icon="billing" label="MONTHLY RECURRING VALUE" note="One-time fees excluded" tone="blue" value={formatPackageFee(workspace.metrics.monthlyRecurringPaise)} />
      </section>
      <section className="client-package-register surface-card">
        <div className="package-register-toolbar">
          <div><p className="eyebrow">ASSIGNMENT REGISTER</p><h2>Client package agreements</h2><span>{assignments.length} matching assignments</span></div>
          <div className="package-register-controls">
            <label><Search aria-hidden="true" /><input aria-label="Search client packages" onChange={(event) => setQuery(event.target.value)} placeholder="Search client or package..." type="search" value={query} /></label>
            <label className="sr-only" htmlFor="package-name-filter">Filter by package</label>
            <select id="package-name-filter" onChange={(event) => setPackageId(event.target.value)} value={packageId}><option value="all">All packages</option>{workspace.packages.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
            <label className="sr-only" htmlFor="package-cycle-filter">Filter by billing cycle</label>
            <select id="package-cycle-filter" onChange={(event) => setBillingCycle(event.target.value)} value={billingCycle}><option value="all">All cycles</option>{packageBillingCycles.map((cycle) => <option key={cycle} value={cycle}>{cycle.replaceAll("_", " ")}</option>)}</select>
            <label className="sr-only" htmlFor="package-status-filter">Filter by status</label>
            <select id="package-status-filter" onChange={(event) => setStatus(event.target.value)} value={status}><option value="all">All statuses</option><option value="active">Active</option><option value="scheduled">Scheduled</option><option value="ended">Ended</option><option value="cancelled">Cancelled</option></select>
          </div>
        </div>
        <div className="package-register-head client-package-head"><span>Client</span><span>Package & services</span><span>Commercials</span><span>Effective period</span><span>Status</span><span>Action</span></div>
        <div className="package-register-body">
          {assignments.map((assignment) => {
            const included = assignment.services.filter((service) => service.source === "package").length;
            const addons = assignment.services.length - included;
            return <article className="package-register-row client-package-row" key={assignment.id}>
              <span><strong>{assignment.clientName}</strong><small>Legal entity agreement</small></span>
              <span><strong>{assignment.packageName}</strong><small>{included} included · {addons} add-ons</small></span>
              <span><strong>{formatPackageFee(assignment.agreedFeePaise)}</strong><small>{assignment.billingCycle.replaceAll("_", " ")}</small></span>
              <span><strong>{assignment.effectiveFrom}</strong><small>{assignment.effectiveTo ? `to ${assignment.effectiveTo}` : "No end date"}</small></span>
              <StatusBadge tone={statusTone[assignment.status] ?? "neutral"}>{assignment.status}</StatusBadge>
              <Link aria-label={`Open ${assignment.clientName} package`} className="row-action-link" href={`/client-packages/${assignment.id}`}>Open</Link>
            </article>;
          })}
          {!assignments.length && <div className="package-empty-state"><UserRoundX aria-hidden="true" /><strong>No client packages found</strong><span>Adjust the filters or assign a package to an active client.</span></div>}
        </div>
      </section>
      <section className="package-control-note surface-card"><CalendarClock aria-hidden="true" /><div><strong>Agreement history is immutable</strong><span>Package edits affect future assignments only. Existing client prices and service snapshots remain unchanged.</span></div><CircleDollarSign aria-hidden="true" /></section>
    </section>
  );
}
