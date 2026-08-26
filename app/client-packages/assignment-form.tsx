"use client";

import { useActionState, useState } from "react";

import type { ClientPackageWorkspaceData } from "../../lib/packages/repository";
import { emptyPackageActionState, type PackageActionState } from "../../lib/packages/validation";
import { assignClientPackageAction } from "../packages/actions";
import { useCloseOnSuccess } from "../dashboard/form-dialog";

function FieldError({ field, state }: { field: string; state: PackageActionState }) {
  const message = state.fieldErrors[field];
  return message ? <small className="package-field-error">{message}</small> : null;
}

export function AssignmentForm({ onCancel, onSaved, workspace }: { onCancel: () => void; onSaved: () => void; workspace: ClientPackageWorkspaceData }) {
  const activePackages = workspace.packages.filter((item) => item.status === "active");
  const [state, action, pending] = useActionState(assignClientPackageAction, emptyPackageActionState);
  useCloseOnSuccess(pending, state, onSaved);
  const [packageId, setPackageId] = useState(activePackages[0]?.id ?? "");
  const [clientId, setClientId] = useState(workspace.clients[0]?.id ?? "");
  const [agreedFee, setAgreedFee] = useState(activePackages[0] ? (activePackages[0].standardFeePaise / 100).toFixed(2) : "0.00");
  const selectedPackage = activePackages.find((item) => item.id === packageId);
  const includedIds = new Set(selectedPackage?.serviceIds ?? []);
  const currentAssignment = workspace.clients.find((client) => client.id === clientId)?.currentAssignmentId;

  return <form action={action} className="package-editor-card assignment-editor-card surface-card">
    <div className="package-editor-intro"><p className="eyebrow">CLIENT AGREEMENT</p><h2>Assign service package</h2><span>The saved agreement keeps an immutable copy of its price, cycle, and services.</span></div>
    <div className="package-form-grid">
      <label><span>Client legal entity</span><select name="legalEntityId" onChange={(event) => setClientId(event.target.value)} required value={clientId}><option value="">Choose client</option>{workspace.clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select><FieldError field="legalEntityId" state={state} /></label>
      <label><span>Base package</span><select name="packageId" onChange={(event) => { const next = activePackages.find((item) => item.id === event.target.value); setPackageId(event.target.value); if (next) setAgreedFee((next.standardFeePaise / 100).toFixed(2)); }} required value={packageId}><option value="">Choose package</option>{activePackages.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.billingCycle.replaceAll("_", " ")}</option>)}</select><FieldError field="packageId" state={state} /></label>
      <label><span>Effective from</span><input defaultValue={workspace.todayKey} name="effectiveFrom" required type="date" /><FieldError field="effectiveFrom" state={state} /></label>
      <label><span>Effective to (optional)</span><input name="effectiveTo" type="date" /><FieldError field="effectiveTo" state={state} /></label>
      <label><span>Agreed fee (INR)</span><input inputMode="decimal" name="agreedFee" onChange={(event) => setAgreedFee(event.target.value)} required value={agreedFee} /><FieldError field="agreedFee" state={state} /></label>
    </div>
    <section className="assignment-service-preview"><div><p className="eyebrow">INCLUDED SERVICES</p><h3>Included services</h3><span>{selectedPackage?.services.length ?? 0} services included in {selectedPackage?.name ?? "the selected package"}</span></div><div className="assignment-service-chips">{selectedPackage?.services.map((service) => <span key={service.id}><strong>{service.code}</strong>{service.name}</span>)}{!selectedPackage && <p>Select a package to preview its services.</p>}</div></section>
    <fieldset className="package-service-selector addon-selector"><legend>Optional add-on services</legend><p>Add services outside the base package. Included services are automatically excluded.</p><div>{workspace.services.filter((service) => service.status === "active").map((service) => <label className={includedIds.has(service.id) ? "is-included" : ""} key={service.id}><input disabled={includedIds.has(service.id)} name="addonServiceIds" type="checkbox" value={service.id} /><span><strong>{service.name}</strong><small>{includedIds.has(service.id) ? "Included in package" : `${service.code} · ${service.category}`}</small></span></label>)}</div><FieldError field="addonServiceIds" state={state} /></fieldset>
    {currentAssignment && <label className="replacement-confirmation"><input name="replaceExisting" required type="checkbox" /><span><strong>Replace the current package</strong><small>The existing agreement will end before this package starts. Its snapshots remain in history.</small></span><FieldError field="replaceExisting" state={state} /></label>}
    {state.error && <p className="package-form-banner" role="alert">{state.error}</p>}
    <div className="package-form-actions"><button className="secondary-button" onClick={onCancel} type="button">Cancel</button><button className="primary-button" disabled={pending || !activePackages.length || !workspace.clients.length} type="submit">{pending ? "Assigning..." : "Assign package"}</button></div>
  </form>;
}
