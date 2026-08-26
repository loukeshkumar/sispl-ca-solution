"use client";

import Link from "next/link";
import { EmptyState } from "../dashboard/dashboard-ui";
import { useActionState } from "react";

import { useCloseOnSuccess } from "../dashboard/form-dialog";

import type { ClientMemberOption } from "../../lib/clients/repository";
import type { ServiceOption } from "../../lib/packages/repository";
import {
  clientEntityTypes,
  clientRiskStatuses,
  type ClientActionState,
  type ClientInput,
} from "../../lib/clients/validation";

type ClientFormAction = (state: ClientActionState, formData: FormData) => Promise<ClientActionState>;
type InitialClient = Partial<ClientInput> & { hasPackageHistory?: boolean; id?: string };

const initialState: ClientActionState = { error: "", fieldErrors: {} };

function FieldError({ field, message }: { field: string; message?: string }) {
  return message ? <small className="client-form-error" id={`${field}-error`}>{message}</small> : null;
}

export default function ClientForm({
  action,
  cancelHref,
  onCancel,
  onSaved,
  initial,
  members,
  mode,
  services,
}: {
  action: ClientFormAction;
  cancelHref?: string;
  onCancel?: () => void;
  onSaved?: () => void;
  initial?: InitialClient;
  members: ClientMemberOption[];
  mode: "create" | "edit";
  services: ServiceOption[];
}) {
  const [state, formAction, pending] = useActionState(action, initialState);
  // In a dialog the save returns clean state instead of redirecting; that is the close signal.
  useCloseOnSuccess(pending, state, () => onSaved?.());
  const fieldA11y = (field: keyof ClientActionState["fieldErrors"]) => state.fieldErrors[field]
    ? { "aria-describedby": `${field}-error`, "aria-invalid": true as const }
    : {};
  const selectedServices = new Set(initial?.services?.map((service) => service.toUpperCase()) ?? []);
  const serviceName = (code: string) => services.find((service) => service.code.toUpperCase() === code.toUpperCase())?.name ?? code;

  return (
    <form action={formAction} className={`client-editor-form ${onCancel ? "is-in-dialog" : ""}`}>
      <section className="client-form-section">
        <div><p className="eyebrow">IDENTITY</p><h2>Legal entity</h2><span>Store only the minimum identity data needed by the practice.</span></div>
        <div className="client-form-grid">
          <label className="client-form-wide"><span>Legal name</span><input {...fieldA11y("legalName")} defaultValue={initial?.legalName} maxLength={160} name="legalName" required /><FieldError field="legalName" message={state.fieldErrors.legalName} /></label>
          <label><span>Display name</span><input {...fieldA11y("displayName")} defaultValue={initial?.displayName} maxLength={120} name="displayName" required /><FieldError field="displayName" message={state.fieldErrors.displayName} /></label>
          <label><span>Entity type</span><select {...fieldA11y("entityType")} defaultValue={initial?.entityType ?? "Private Company"} name="entityType">{clientEntityTypes.map((type) => <option key={type}>{type}</option>)}</select><FieldError field="entityType" message={state.fieldErrors.entityType} /></label>
          <label><span>Masked PAN</span><input {...fieldA11y("maskedPan")} autoCapitalize="characters" defaultValue={initial?.maskedPan} maxLength={20} name="maskedPan" placeholder="AABCA••••F" required /><FieldError field="maskedPan" message={state.fieldErrors.maskedPan} /></label>
          <label><span>City / location</span><input {...fieldA11y("city")} defaultValue={initial?.city} maxLength={100} name="city" required /><FieldError field="city" message={state.fieldErrors.city} /></label>
          <label><span>Relationship since</span><input {...fieldA11y("relationshipStart")} defaultValue={initial?.relationshipStart ?? new Date().toISOString().slice(0, 10)} name="relationshipStart" required type="date" /><FieldError field="relationshipStart" message={state.fieldErrors.relationshipStart} /></label>
          <label><span>Relationship owner</span><select {...fieldA11y("ownerId")} defaultValue={initial?.ownerId ?? ""} name="ownerId"><option value="">Unassigned</option>{members.map((member) => <option key={member.id} value={member.id}>{member.fullName}</option>)}</select><FieldError field="ownerId" message={state.fieldErrors.ownerId} /></label>
        </div>
      </section>

      <section className="client-form-section">
        <div><p className="eyebrow">PORTFOLIO HEALTH</p><h2>Relationship status</h2><span>Set the current risk state and health score used across the dashboard.</span></div>
        <div className="client-form-grid">
          <label><span>Risk status</span><select {...fieldA11y("riskStatus")} defaultValue={initial?.riskStatus ?? "watch"} name="riskStatus">{clientRiskStatuses.map((risk) => <option key={risk} value={risk}>{risk[0]?.toUpperCase()}{risk.slice(1)}</option>)}</select><FieldError field="riskStatus" message={state.fieldErrors.riskStatus} /></label>
          <label><span>Health score</span><input {...fieldA11y("healthScore")} defaultValue={initial?.healthScore ?? 50} max={100} min={0} name="healthScore" required type="number" /><FieldError field="healthScore" message={state.fieldErrors.healthScore} /></label>
          <label><span>Active GST registrations</span><input {...fieldA11y("gstRegistrations")} defaultValue={initial?.gstRegistrations ?? 1} max={50} min={0} name="gstRegistrations" required type="number" /><FieldError field="gstRegistrations" message={state.fieldErrors.gstRegistrations} /></label>
        </div>
      </section>

      <section className="client-form-section">
        <div><p className="eyebrow">SERVICES</p><h2>{initial?.hasPackageHistory ? "Package-controlled services" : "Active engagements"}</h2><span>{initial?.hasPackageHistory ? "Service entitlement is controlled by the client's package and add-ons." : "Select every service currently delivered to this legal entity."}</span></div>
        {initial?.hasPackageHistory ? <div className="client-package-entitlement-summary"><div>{initial.services?.map((service) => <span key={service}>{serviceName(service)}<input name="services" type="hidden" value={service} /></span>)}</div><Link className="secondary-button" href="/?workspace=client-packages">Manage in Client Packages</Link></div> : <fieldset {...fieldA11y("services")} className="client-service-options">
          <legend className="sr-only">Active services</legend>{services.map((service) => <label key={service.id}><input defaultChecked={selectedServices.has(service.code.toUpperCase()) || (!initial?.services?.length && service.code === "GST")} name="services" type="checkbox" value={service.code} /><span><strong>{service.name}</strong><small>{service.code} · {service.category}</small></span></label>)}{!services.length && <EmptyState description="Add a service in Service Management before creating a client." icon="services" title="No active services" />}<FieldError field="services" message={state.fieldErrors.services} />
        </fieldset>}
      </section>

      {state.error && <p className="client-form-banner" role="alert">{state.error}</p>}
      <div className="client-form-actions">
        {onCancel
          ? <button className="secondary-button" onClick={onCancel} type="button">Cancel</button>
          : <Link className="secondary-button" href={cancelHref ?? "/?workspace=clients"}>Cancel</Link>}
        <button className="primary-button" disabled={pending || (!initial?.hasPackageHistory && !services.length)} type="submit">{pending ? "Saving…" : mode === "create" ? "Create client" : "Save changes"}</button>
      </div>
    </form>
  );
}
