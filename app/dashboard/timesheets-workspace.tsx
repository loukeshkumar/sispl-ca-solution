"use client";

import { Clock3, Trash2 } from "lucide-react";
import { useActionState } from "react";

import { formatPaise } from "../../lib/payroll/money";
import { formatBasisPoints, marginBasisPoints } from "../../lib/rates/valuation";
import type { TimesheetWorkspaceData } from "../../lib/timesheets/repository";
import { formatMinutes, type TimeEntryActionState } from "../../lib/timesheets/validation";
import { createTimeEntryAction, deleteTimeEntryAction } from "../timesheets/actions";
import { KpiCard, PageTitle, StatusBadge } from "./dashboard-ui";
import { UtilisationPanel } from "./utilisation-panel";

const initialState: TimeEntryActionState = { error: "", fieldErrors: {} };

/** Losing money is red whatever the number; thin is worth noticing before it is. */
const marginTone = (basisPoints: number | null): "red" | "amber" | "mint" | "blue" => (
  basisPoints === null ? "blue" : basisPoints < 0 ? "red" : basisPoints < 2000 ? "amber" : "mint"
);

export function TimesheetsWorkspace({
  data,
  options,
  timesheetError,
  viewerUserId,
}: {
  data: TimesheetWorkspaceData;
  options: { clients: Array<{ id: string; name: string }>; work: Array<{ id: string; label: string }>; tasks: Array<{ id: string; title: string }> };
  timesheetError?: string;
  viewerUserId?: string;
}) {
  // Only claimed when every entry behind it could actually be costed. Counting a
  // missing cost as zero would report the shortfall as profit.
  const firmMargin = data.metrics.unratedCostMinutes > 0
    ? null
    : marginBasisPoints(data.metrics.firmChargePaise, data.metrics.firmCostPaise);
  const [state, formAction, pending] = useActionState(createTimeEntryAction, initialState);

  return <section className="timesheets-workspace">
    <PageTitle
      description="Record effort against clients, obligations, and office tasks. Billable time is the basis for engagement effort review."
      eyebrow="EFFORT TRACKING"
      title="Timesheets"
    />

    {timesheetError && <p className="package-form-banner" role="alert">That entry is no longer available.</p>}

    <section className="package-kpi-grid kpi-grid">
      <KpiCard icon="clock" label="MY TIME THIS MONTH" note={`${formatMinutes(data.metrics.ownBillableMinutes)} billable`} tone="blue" value={formatMinutes(data.metrics.ownMinutes)} />
      <KpiCard icon="insights" label="MY BILLABLE SHARE" note="Of my recorded time" tone="mint" value={`${data.metrics.ownMinutes ? Math.round((data.metrics.ownBillableMinutes / data.metrics.ownMinutes) * 100) : 0}%`} />
      {data.canManage && <KpiCard icon="team" label="FIRM TIME" note={`${formatMinutes(data.metrics.firmBillableMinutes)} billable`} tone="amber" value={formatMinutes(data.metrics.firmMinutes)} />}
      <KpiCard icon="work" label="ENTRIES" note={`Period ${data.periodKey}`} tone="blue" value={String(data.metrics.entryCount).padStart(2, "0")} />
      {data.canManage && <KpiCard icon="billing" label="UNBILLED VALUE" note={data.metrics.unratedChargeMinutes ? `${formatMinutes(data.metrics.unratedChargeMinutes)} unrated` : "All billable time is rated"} tone={data.metrics.unratedChargeMinutes ? "amber" : "mint"} value={formatPaise(data.metrics.firmChargePaise)} />}
      {data.canSeeCost && <KpiCard icon="insights" label="MARGIN THIS MONTH" note={firmMargin === null ? "Some effort has no cost basis" : `${formatPaise(data.metrics.firmCostPaise)} cost of delivery`} tone={marginTone(firmMargin)} value={formatBasisPoints(firmMargin)} />}
    </section>

    <section className="surface-card timesheet-entry-card">
      <div className="client-360-section-heading"><div><p className="eyebrow">QUICK ENTRY</p><h2>Record time</h2></div></div>
      <form action={formAction} className="timesheet-entry-form">
        {state.error && <p className="package-form-banner" role="alert">{state.error}</p>}
        <label>
          <span>Date</span>
          <input defaultValue={data.todayKey} name="entryDate" required type="date" />
          {state.fieldErrors.entryDate && <em className="package-field-error">{state.fieldErrors.entryDate}</em>}
        </label>
        <label>
          <span>Time spent</span>
          <input name="duration" placeholder="1:30 or 90" required type="text" />
          {state.fieldErrors.duration && <em className="package-field-error">{state.fieldErrors.duration}</em>}
        </label>
        <label>
          <span>Client</span>
          <select defaultValue="" name="legalEntityId">
            <option value="">Internal (non-billable)</option>
            {options.clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
          </select>
          {state.fieldErrors.legalEntityId && <em className="package-field-error">{state.fieldErrors.legalEntityId}</em>}
        </label>
        <label>
          <span>Obligation</span>
          <select defaultValue="" name="workItemId">
            <option value="">None</option>
            {options.work.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </label>
        <label>
          <span>Task</span>
          <select defaultValue="" name="officeTaskId">
            <option value="">None</option>
            {options.tasks.map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}
          </select>
        </label>
        <label className="timesheet-billable">
          <input defaultChecked name="billable" type="checkbox" />
          <span>Billable</span>
        </label>
        <label className="timesheet-narration">
          <span>What was done</span>
          <input maxLength={500} name="narration" placeholder="e.g. Reviewed July GST reconciliation" required type="text" />
          {state.fieldErrors.narration && <em className="package-field-error">{state.fieldErrors.narration}</em>}
        </label>
        <button className="primary-button" disabled={pending} type="submit">{pending ? "Saving…" : "Add entry"}</button>
      </form>
    </section>

    {data.canManage && data.utilisation && <UtilisationPanel periodKey={data.periodKey} utilisation={data.utilisation} />}

    {data.canManage && data.engagements.length > 0 && (
      <section className="surface-card timesheet-engagements">
        <div className="client-360-section-heading"><div><p className="eyebrow">ENGAGEMENT EFFORT</p><h2>Time by client this month</h2></div></div>
        <div className={`package-register-head engagement-head${data.canSeeCost ? " with-cost" : ""}`}>
          <span>Client</span><span>Billable</span><span>Non-billable</span><span>Total</span>
          <span>Unbilled value</span>{data.canSeeCost && <><span>Cost</span><span>Margin</span></>}
        </div>
        {data.engagements.map((engagement) => (
          <article className={`package-register-row engagement-row${data.canSeeCost ? " with-cost" : ""}`} key={engagement.legalEntityId}>
            <span>
              <strong>{engagement.clientName}</strong>
              {/* A total that silently omits unrated effort reads as the whole
                  picture, so it says what it could not value. */}
              {engagement.unratedChargeMinutes > 0 && <small className="engagement-unrated">{formatMinutes(engagement.unratedChargeMinutes)} unrated</small>}
            </span>
            <span>{formatMinutes(engagement.billableMinutes)}</span>
            <span>{formatMinutes(engagement.nonBillableMinutes)}</span>
            <span><strong>{formatMinutes(engagement.billableMinutes + engagement.nonBillableMinutes)}</strong></span>
            <span><strong>{formatPaise(engagement.chargePaise)}</strong></span>
            {data.canSeeCost && <>
              <span>
                <strong>{formatPaise(engagement.costPaise)}</strong>
                {engagement.unratedCostMinutes > 0 && <small className="engagement-unrated">{formatMinutes(engagement.unratedCostMinutes)} uncosted</small>}
              </span>
              <span className={`engagement-margin is-${marginTone(engagement.marginBps)}`}><strong>{formatBasisPoints(engagement.marginBps)}</strong></span>
            </>}
          </article>
        ))}
        <p className="package-control-note-text">Unbilled value is recorded time at the rate in force on the day it was worked. It is not an invoice.</p>
      </section>
    )}

    <section className="client-package-register surface-card">
      <div className="package-register-toolbar">
        <Clock3 aria-hidden="true" />
        <div><strong>{data.canManage ? "Firm time entries" : "My time entries"}</strong></div>
      </div>
      {data.entries.length === 0 ? (
        <div className="package-empty-state"><Clock3 aria-hidden="true" /><strong>No time recorded for {data.periodKey}</strong><p>Use quick entry above to record effort as you work.</p></div>
      ) : (
        <div>
          <div className="package-register-head timesheet-register-head"><span>Date</span><span>Who · what</span><span>Client · context</span><span>Time</span><span>Type</span><span aria-hidden="true" /></div>
          {data.entries.map((entry) => (
            <article className="package-register-row timesheet-register-row" key={entry.id}>
              <span>{entry.entryDate}</span>
              <span><strong>{entry.employeeName}</strong><small>{entry.narration}</small></span>
              <span><strong>{entry.clientName ?? "Internal"}</strong><small>{entry.workLabel ?? entry.taskTitle ?? "—"}</small></span>
              <span><strong>{formatMinutes(entry.minutes)}</strong></span>
              <StatusBadge tone={entry.billable ? "mint" : "neutral"}>{entry.billable ? "Billable" : "Internal"}</StatusBadge>
              {entry.employeeUserId === viewerUserId ? (
                <form action={deleteTimeEntryAction}>
                  <input name="entryId" type="hidden" value={entry.id} />
                  <button aria-label={`Delete entry from ${entry.entryDate}`} className="icon-button" type="submit"><Trash2 aria-hidden="true" size={16} /></button>
                </form>
              ) : <span />}
            </article>
          ))}
        </div>
      )}
    </section>
  </section>;
}
