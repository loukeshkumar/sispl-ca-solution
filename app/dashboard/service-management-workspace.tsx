"use client";

import { Archive, Layers3, ListTree, Plus, Search } from "lucide-react";
import Link from "next/link";
import { useActionState, useMemo, useState } from "react";

import type { ServiceCatalogueView, ServiceManagementWorkspaceData } from "../../lib/packages/repository";
import type { PackageActionState } from "../../lib/packages/validation";
import { saveServiceAction } from "../packages/actions";
import { KpiCard, PageTitle, StatusBadge } from "./dashboard-ui";
import {
  dialogRecord,
  FormDialog,
  FormDialogActions,
  FormDialogBody,
  useCloseOnSuccess,
  type DialogState,
} from "./form-dialog";
import { useToast } from "./toast";

type StatusFilter = "all" | "active" | "archived";

const initialState: PackageActionState = { error: "", fieldErrors: {} };
const fieldError = (message?: string) => message ? <em className="package-field-error">{message}</em> : null;

export function ServiceManagementWorkspace({ canManage, workspace }: { canManage: boolean; workspace: ServiceManagementWorkspaceData }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [dialog, setDialog] = useState<DialogState<ServiceCatalogueView>>(null);
  const [state, formAction, pending] = useActionState(saveServiceAction, initialState);
  const toast = useToast();
  useCloseOnSuccess(pending, state, () => { toast.success(dialogRecord(dialog) ? "Service updated." : "Service added."); setDialog(null); });
  const record = dialogRecord(dialog);
  const normalized = query.trim().toLowerCase();
  const services = useMemo(() => workspace.services.filter((service) => (
    (status === "all" || service.status === status)
    && (!normalized || `${service.code} ${service.name} ${service.category} ${service.description}`.toLowerCase().includes(normalized))
  )), [normalized, status, workspace.services]);

  return (
    <section className="service-management-workspace">
      <PageTitle
        actions={<div className="package-title-actions">
          <Link className="secondary-button" href="/settings/compliance">Compliance schedules</Link>
          {canManage && <button className="primary-button" onClick={() => setDialog("add")} type="button"><Plus aria-hidden="true" />Create service</button>}
        </div>}
        description="Maintain one tenant-wide service master used by packages, client engagements, and compliance work."
        eyebrow="SETTINGS · MASTER DATA"
        title="Service Management"
      />

      <section className="package-kpi-grid kpi-grid">
        <KpiCard icon="services" label="ACTIVE SERVICES" note="Available across the application" tone="mint" value={String(workspace.metrics.activeServices).padStart(2, "0")} />
        <KpiCard icon="services" label="ARCHIVED SERVICES" note="Retained for historical records" tone="amber" value={String(workspace.metrics.archivedServices).padStart(2, "0")} />
        <KpiCard icon="packageSetup" label="CATEGORIES" note="Organised service families" tone="blue" value={String(workspace.metrics.categories).padStart(2, "0")} />
        <KpiCard icon="clientPackages" label="PACKAGE LINKS" note="Current catalogue relationships" tone="blue" value={String(workspace.metrics.packageLinks).padStart(2, "0")} />
      </section>

      <section className="service-master-card surface-card">
        <div className="service-master-toolbar">
          <div>
            <p className="eyebrow">SERVICE MASTER</p>
            <h2>Firm service catalogue</h2>
            <span>{services.length} matching services · codes remain stable for audit history</span>
          </div>
          <div className="service-master-controls">
            <div aria-label="Filter services by status" className="service-status-filter" role="group">
              {(["all", "active", "archived"] as const).map((value) => <button aria-pressed={status === value} key={value} onClick={() => setStatus(value)} type="button">{value[0].toUpperCase()}{value.slice(1)}</button>)}
            </div>
            <label className="package-workspace-search"><Search aria-hidden="true" /><input aria-label="Search service master" onChange={(event) => setQuery(event.target.value)} placeholder="Search code, name or category..." type="search" value={query} /></label>
          </div>
        </div>

        <div className="package-register-head service-register-head"><span>Service</span><span>Category</span><span>Standard</span><span>Packages</span><span>Status</span><span>Action</span></div>
        <div className="package-register-body">
          {services.map((service) => <article className="package-register-row service-register-row" key={service.id}>
            <span><strong>{service.name}</strong><small>{service.code}{service.description ? ` · ${service.description}` : ""}</small></span>
            <span className="service-category-label"><Layers3 aria-hidden="true" />{service.category}</span>
            <span className="service-standard-cell">{service.standardMinutes === null ? <small>Not estimated</small> : <strong>{service.standardMinutes}m</strong>}</span>
            <span><strong>{service.packageCount}</strong><small>{service.packageCount === 1 ? "package" : "packages"}</small></span>
            <StatusBadge tone={service.status === "active" ? "mint" : "neutral"}>{service.status}</StatusBadge>
            {canManage ? <button aria-label={`Edit ${service.name}`} className="master-toggle-button" onClick={() => setDialog(service)} type="button">Edit</button> : <span className="service-read-only">View only</span>}
          </article>)}
          {!services.length && <div className="service-master-empty"><span><Archive aria-hidden="true" /></span><strong>No matching services</strong><p>Change the search or status filter to view another part of the master list.</p></div>}
        </div>
        <footer className="service-master-footer"><ListTree aria-hidden="true" /><span>Active services appear automatically in package, client, and work configuration.</span></footer>
      </section>

      <FormDialog
        description="Codes stay stable for audit history. Archiving keeps a service in past records and only removes it from future selection."
        onClose={() => setDialog(null)}
        open={dialog !== null}
        title={record ? `Edit ${record.name}` : "Create a service"}
      >
        <form action={formAction} className="form-dialog-form" key={record?.id ?? "new-service"}>
          <FormDialogBody>
            {state.error && <p className="package-form-banner" role="alert">{state.error}</p>}
            {record && <input name="serviceId" type="hidden" value={record.id} />}
            <label><span>Code</span>
              <input defaultValue={record?.code ?? ""} maxLength={20} name="code" placeholder="GST" readOnly={Boolean(record)} required type="text" />
              {fieldError(state.fieldErrors.code)}
            </label>
            <label><span>Name</span>
              <input defaultValue={record?.name ?? ""} maxLength={120} name="name" placeholder="GST compliance" required type="text" />
              {fieldError(state.fieldErrors.name)}
            </label>
            <label><span>Category</span>
              <input defaultValue={record?.category ?? ""} maxLength={60} name="category" placeholder="Indirect tax" required type="text" />
              {fieldError(state.fieldErrors.category)}
            </label>
            <label><span>Status</span>
              <select defaultValue={record?.status ?? "active"} name="status">
                <option value="active">Active</option>
                <option value="archived">Archived</option>
              </select>
              {fieldError(state.fieldErrors.status)}
            </label>
            <label><span>Standard effort (minutes)</span>
              <input defaultValue={record?.standardMinutes ?? ""} inputMode="numeric" max={100000} min={1} name="standardMinutes" placeholder="Not estimated" type="number" />
              <small className="field-hint">New work items copy this as their budget. Editing it never changes work already raised.</small>
              {fieldError(state.fieldErrors.standardMinutes)}
            </label>
            <label className="form-dialog-wide"><span>Description</span>
              <textarea defaultValue={record?.description ?? ""} maxLength={300} name="description" rows={2} />
              {fieldError(state.fieldErrors.description)}
            </label>
          </FormDialogBody>
          <FormDialogActions onCancel={() => setDialog(null)} pending={pending} submitLabel={record ? "Save changes" : "Create service"} />
        </form>
      </FormDialog>
    </section>
  );
}
