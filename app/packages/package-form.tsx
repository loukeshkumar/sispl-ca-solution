"use client";

import { useActionState } from "react";

import type { ServiceCatalogueView, ServicePackageView } from "../../lib/packages/repository";
import { emptyPackageActionState, packageBillingCycles, type PackageActionState } from "../../lib/packages/validation";
import { useCloseOnSuccess } from "../dashboard/form-dialog";

type Action = (state: PackageActionState, formData: FormData) => Promise<PackageActionState>;

function FieldError({ field, state }: { field: string; state: PackageActionState }) {
  const message = state.fieldErrors[field];
  return message ? <small className="package-field-error" id={`package-${field}-error`}>{message}</small> : null;
}

export function PackageForm({ action, initial, mode, onCancel, onSaved, packageId, services }: { action: Action; initial?: ServicePackageView; packageId?: string; mode: "create" | "edit"; onCancel: () => void; onSaved: () => void; services: ServiceCatalogueView[] }) {
  const [state, formAction, pending] = useActionState(action, emptyPackageActionState);
  useCloseOnSuccess(pending, state, onSaved);
  return <form action={formAction} className="package-editor-card surface-card is-in-dialog">{packageId && <input name="packageId" type="hidden" value={packageId} />}
    <div className="package-editor-intro"><p className="eyebrow">PACKAGE BUILDER</p><h2>{mode === "create" ? "Create service package" : "Edit service package"}</h2><span>Catalogue changes apply only to future client assignments.</span></div>
    <div className="package-form-grid">
      <label><span>Package code</span><input defaultValue={initial?.code} maxLength={20} name="code" placeholder="GROWTH_PLUS" required /><FieldError field="code" state={state} /></label>
      <label><span>Package name</span><input defaultValue={initial?.name} maxLength={100} name="name" placeholder="Growth Plus" required /><FieldError field="name" state={state} /></label>
      <label><span>Billing cycle</span><select defaultValue={initial?.billingCycle ?? "monthly"} name="billingCycle">{packageBillingCycles.map((cycle) => <option key={cycle} value={cycle}>{cycle.replaceAll("_", " ")}</option>)}</select><FieldError field="billingCycle" state={state} /></label>
      <label><span>Standard fee (INR)</span><input defaultValue={initial ? (initial.standardFeePaise / 100).toFixed(2) : "0.00"} inputMode="decimal" name="standardFee" placeholder="0.00" required /><FieldError field="standardFee" state={state} /></label>
      <label><span>Status</span><select defaultValue={initial?.status ?? "active"} name="status"><option value="active">Active</option><option value="archived">Archived</option></select><FieldError field="status" state={state} /></label>
      <label className="package-form-wide"><span>Description</span><textarea defaultValue={initial?.description} maxLength={800} name="description" placeholder="Describe the package scope and ideal client." rows={4} /></label>
    </div>
    <fieldset className="package-service-selector"><legend>Included services</legend><p>Select every service delivered under this base package.</p><div>{services.map((service) => {
      const checked = initial?.serviceIds.includes(service.id) ?? false;
      return <label className={service.status === "archived" ? "is-archived" : ""} key={service.id}><input defaultChecked={checked} disabled={service.status === "archived" && !checked} name="serviceIds" type="checkbox" value={service.id} /><span><strong>{service.name}</strong><small>{service.code} · {service.category}</small></span></label>;
    })}</div><FieldError field="serviceIds" state={state} /></fieldset>
    {state.error && <p className="package-form-banner" role="alert">{state.error}</p>}
    <div className="package-form-actions"><button className="secondary-button" onClick={onCancel} type="button">Cancel</button><button className="primary-button" disabled={pending} type="submit">{pending ? "Saving..." : mode === "create" ? "Create package" : "Save new catalogue version"}</button></div>
  </form>;
}
