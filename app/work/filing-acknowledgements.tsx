"use client";

import { useActionState } from "react";

import type { FilingAcknowledgementRow } from "../../lib/filings/repository";
import { filingPortals, filingPortalStatuses, type FilingActionState } from "../../lib/filings/validation";
import { recordFilingAcknowledgementAction } from "./filing-actions";

const initialState: FilingActionState = { error: "", fieldErrors: {} };

const portalLabels: Record<string, string> = {
  gstn: "GST portal", income_tax: "Income-tax portal", traces: "TRACES", mca: "MCA", other: "Other",
};
const statusLabels: Record<string, string> = {
  filed: "Filed", filed_late: "Filed late", processed: "Processed", defective: "Defective", rejected: "Rejected",
};

export default function FilingAcknowledgements({
  acknowledgements,
  canRecord,
  defaultFilingType,
  defaultPeriodKey,
  legalEntityId,
  todayKey,
  workItemId,
}: {
  acknowledgements: FilingAcknowledgementRow[];
  canRecord: boolean;
  defaultFilingType: string;
  defaultPeriodKey: string;
  legalEntityId: string;
  todayKey: string;
  workItemId: string;
}) {
  const [state, formAction, pending] = useActionState(recordFilingAcknowledgementAction, initialState);
  return (
    <section className="client-360-services filing-ack-panel">
      <div className="client-360-section-heading">
        <div><p className="eyebrow">PORTAL EVIDENCE</p><h2>Filing acknowledgements</h2></div>
        <span>{acknowledgements.length} recorded</span>
      </div>

      {acknowledgements.length === 0 ? (
        <p className="client-360-empty">No acknowledgement recorded. Internal status is the firm&rsquo;s own tracking, not proof of filing.</p>
      ) : (
        <ul className="filing-ack-list">
          {acknowledgements.map((entry) => (
            <li key={entry.id}>
              <span>
                <strong>{entry.acknowledgementNumber}</strong>
                <small>{entry.filingType} · {entry.periodKey} · {portalLabels[entry.portal] ?? entry.portal}</small>
              </span>
              <span className={`filing-ack-status is-${entry.portalStatus}`}>{statusLabels[entry.portalStatus] ?? entry.portalStatus}</span>
              <span className="filing-ack-meta">
                <small>Filed {entry.filedOn}</small>
                <small>{entry.source === "manual" ? `Recorded by ${entry.recordedByName}` : "Retrieved from the portal"}</small>
              </span>
            </li>
          ))}
        </ul>
      )}

      {canRecord && (
        <form action={formAction} className="filing-ack-form">
          {state.error && <p className="client-form-banner" role="alert">{state.error}</p>}
          <input name="workItemId" type="hidden" value={workItemId} />
          <input name="legalEntityId" type="hidden" value={legalEntityId} />
          <label><span>Portal</span>
            <select defaultValue="gstn" name="portal">
              {filingPortals.map((portal) => <option key={portal} value={portal}>{portalLabels[portal]}</option>)}
            </select>
          </label>
          <label><span>Return or form</span>
            <input defaultValue={defaultFilingType} maxLength={40} name="filingType" required type="text" />
            {state.fieldErrors.filingType && <em className="package-field-error">{state.fieldErrors.filingType}</em>}
          </label>
          <label><span>Period</span>
            <input defaultValue={defaultPeriodKey} maxLength={60} name="periodKey" required type="text" />
            {state.fieldErrors.periodKey && <em className="package-field-error">{state.fieldErrors.periodKey}</em>}
          </label>
          <label><span>ARN / acknowledgement number</span>
            <input maxLength={40} name="acknowledgementNumber" required type="text" />
            {state.fieldErrors.acknowledgementNumber && <em className="package-field-error">{state.fieldErrors.acknowledgementNumber}</em>}
          </label>
          <label><span>Filed on</span>
            <input defaultValue={todayKey} name="filedOn" required type="date" />
            {state.fieldErrors.filedOn && <em className="package-field-error">{state.fieldErrors.filedOn}</em>}
          </label>
          <label><span>Portal status</span>
            <select defaultValue="filed" name="portalStatus">
              {filingPortalStatuses.map((status) => <option key={status} value={status}>{statusLabels[status]}</option>)}
            </select>
          </label>
          <label className="filing-ack-wide"><span>Remarks</span>
            <input maxLength={1000} name="remarks" placeholder="Optional" type="text" />
          </label>
          <button className="secondary-button" disabled={pending} type="submit">{pending ? "Saving…" : "Record acknowledgement"}</button>
        </form>
      )}
    </section>
  );
}
