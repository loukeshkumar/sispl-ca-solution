"use client";

import { useActionState, useState } from "react";

import type { PortalContactView } from "../../lib/portal/repository";
import type { PortalContactActionState } from "../../lib/portal/validation";
import { disablePortalAccessAction, provisionPortalAccessAction } from "./portal-access-actions";

const initialState: PortalContactActionState = { error: "", fieldErrors: {} };

const statusLabels: Record<string, string> = { invited: "Setup pending", active: "Active", disabled: "Disabled" };

export default function PortalAccessPanel({ canManage, contacts, legalEntityId }: { canManage: boolean; contacts: PortalContactView[]; legalEntityId: string }) {
  const [state, formAction, pending] = useActionState(provisionPortalAccessAction, initialState);
  const [copied, setCopied] = useState(false);

  return (
    <section className="client-360-services portal-access-panel">
      <div className="client-360-section-heading">
        <div><p className="eyebrow">CLIENT PORTAL</p><h2>Portal access</h2></div>
        <span>{contacts.filter((contact) => contact.status !== "disabled").length} contacts</span>
      </div>

      {contacts.length === 0 ? (
        <p className="client-360-empty">No portal contacts yet. Provisioning lets this client upload documents and see their status.</p>
      ) : (
        <ul className="portal-contact-list">
          {contacts.map((contact) => (
            <li key={contact.id}>
              <span><strong>{contact.fullName}</strong><small>{contact.email}</small></span>
              <span className={`portal-contact-status is-${contact.status}`}>{statusLabels[contact.status] ?? contact.status}</span>
              {canManage && contact.status !== "disabled" && (
                <form
                  action={disablePortalAccessAction}
                  onSubmit={(event) => {
                    if (!window.confirm(`Revoke portal access for ${contact.email}? Their sessions end immediately.`)) event.preventDefault();
                  }}
                >
                  <input name="legalEntityId" type="hidden" value={legalEntityId} />
                  <input name="portalUserId" type="hidden" value={contact.id} />
                  <button type="submit">Revoke</button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}

      {state.temporaryPassword && (
        <div className="portal-temporary-password" role="status">
          <p><strong>One-time password created.</strong> Share it with the contact through a channel you trust. It is shown once and must be changed at first sign-in.</p>
          <code>{state.temporaryPassword}</code>
          <button
            onClick={() => {
              navigator.clipboard?.writeText(state.temporaryPassword ?? "").then(() => setCopied(true)).catch(() => setCopied(false));
            }}
            type="button"
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      )}

      {canManage && (
        <form action={formAction} className="portal-access-form">
          {state.error && <p className="client-form-banner" role="alert">{state.error}</p>}
          <input name="legalEntityId" type="hidden" value={legalEntityId} />
          <label>
            <span>Contact name</span>
            <input maxLength={120} name="fullName" required type="text" />
            {state.fieldErrors.fullName && <em className="package-field-error">{state.fieldErrors.fullName}</em>}
          </label>
          <label>
            <span>Contact email</span>
            <input maxLength={254} name="email" required type="email" />
            {state.fieldErrors.email && <em className="package-field-error">{state.fieldErrors.email}</em>}
          </label>
          <button className="secondary-button" disabled={pending} type="submit">{pending ? "Provisioning…" : "Provision portal access"}</button>
        </form>
      )}
    </section>
  );
}
