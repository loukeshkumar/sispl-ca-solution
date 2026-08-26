"use client";

import { useActionState, useMemo, useState } from "react";

import { MODE_LABELS, ruleSummary } from "../../../lib/compliance/client-schedules";
import type { ClientScheduleRow, ExtensionRow } from "../../../lib/compliance/client-schedule-repository";
import type { ComplianceScheduleRule } from "../../../lib/compliance/recurrence";
import { StatusBadge } from "../../dashboard/dashboard-ui";
import {
  recordExtensionAction,
  removeClientScheduleAction,
  saveClientScheduleAction,
  type ClientScheduleActionState,
} from "./client-schedule-actions";

const initialState: ClientScheduleActionState = { error: "", notice: "" };

const formatDate = (key: string) => new Intl.DateTimeFormat("en-IN", {
  day: "numeric", month: "short", timeZone: "Asia/Kolkata", year: "numeric",
}).format(new Date(`${key}T00:00:00+05:30`));

export type Engagement = { clientName: string; legalEntityId: string; serviceCode: string };

/**
 * Where a client's calendar departs from the firm's, and where an authority
 * moved a date for everybody.
 *
 * Deliberately two lists rather than one. A standing fact about one client and a
 * one-off fact about one period behave differently and are corrected
 * differently; showing them as one register is what let an extension be applied
 * client by client until somebody was missed.
 */
export function ClientScheduleRegister({
  canManage,
  engagements,
  extensions,
  firmRules,
  schedules,
  services,
  todayKey,
}: {
  canManage: boolean;
  engagements: Engagement[];
  extensions: ExtensionRow[];
  firmRules: ComplianceScheduleRule[];
  schedules: ClientScheduleRow[];
  services: Array<{ code: string; name: string }>;
  todayKey: string;
}) {
  const [saveState, save, saving] = useActionState(saveClientScheduleAction, initialState);
  const [removeState, remove, removing] = useActionState(removeClientScheduleAction, initialState);
  const [extendState, extend, extending] = useActionState(recordExtensionAction, initialState);
  const [mode, setMode] = useState("override");
  const [client, setClient] = useState("");
  const [addingSchedule, setAddingSchedule] = useState(false);
  const [addingExtension, setAddingExtension] = useState(false);

  const error = saveState.error || removeState.error || extendState.error;
  const notice = saveState.notice || removeState.notice || extendState.notice;

  const clients = useMemo(() => {
    const byId = new Map<string, string>();
    for (const engagement of engagements) byId.set(engagement.legalEntityId, engagement.clientName);
    return [...byId.entries()].map(([id, name]) => ({ id, name })).sort((left, right) => left.name.localeCompare(right.name));
  }, [engagements]);

  // Only services this client is actually engaged for: a schedule for a service
  // they do not buy is refused anyway, and offering it invites the mistake.
  const servicesForClient = useMemo(
    () => engagements.filter((engagement) => engagement.legalEntityId === client).map((engagement) => engagement.serviceCode),
    [client, engagements],
  );

  const firmFor = (code: string) => firmRules.find((rule) => rule.serviceCode.toUpperCase() === code.toUpperCase()) ?? null;

  return (
    <>
      <section className="surface-card client-schedule-register">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">PER-CLIENT SCHEDULES</p>
            <h2>{schedules.length === 0 ? "Every client follows the firm calendar" : `${schedules.length} client schedule${schedules.length === 1 ? "" : "s"}`}</h2>
            <span>
              A client on QRMP files quarterly; one who dropped a service raises nothing. Recorded here, both happen on
              their own instead of being remembered.
            </span>
          </div>
          {canManage && (
            <button className="secondary-button" onClick={() => setAddingSchedule(!addingSchedule)} type="button">
              {addingSchedule ? "Cancel" : "Record a client schedule"}
            </button>
          )}
        </div>

        {error && <p className="client-form-banner" role="alert">{error}</p>}
        {notice && <p className="client-form-notice">{notice}</p>}

        {schedules.length > 0 && (
          <ul className="client-schedule-list">
            {schedules.map((schedule) => {
              const future = schedule.effectiveFrom > todayKey;
              return (
                <li className={`client-schedule-row is-${schedule.mode}`} key={schedule.id}>
                  <div className="client-schedule-row-head">
                    <strong>{schedule.clientName}</strong>
                    <span className="client-schedule-service">{schedule.serviceCode}</span>
                    <StatusBadge tone={schedule.mode === "exempt" ? "slate" : "blue"}>{MODE_LABELS[schedule.mode]}</StatusBadge>
                    {future && <StatusBadge tone="amber">From {formatDate(schedule.effectiveFrom)}</StatusBadge>}
                  </div>
                  <small className="client-schedule-line">
                    {schedule.rule ? ruleSummary(schedule.rule) : "No obligations are raised for this client and service."}
                  </small>
                  <small className="client-schedule-meta">
                    {future ? "Starts" : "In force since"} {formatDate(schedule.effectiveFrom)} · recorded by {schedule.createdByName}
                    {schedule.note ? ` · ${schedule.note}` : ""}
                    {schedule.rule && firmFor(schedule.serviceCode)
                      ? ` · the firm files ${firmFor(schedule.serviceCode)!.frequency}`
                      : ""}
                  </small>
                  {canManage && (
                    <form action={remove} className="client-schedule-remove">
                      <input name="scheduleId" type="hidden" value={schedule.id} />
                      <button className="secondary-button" disabled={removing} type="submit">Remove</button>
                    </form>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {canManage && addingSchedule && (
          <form action={save} className="client-schedule-form">
            <label>
              <span>Client</span>
              <select name="legalEntityId" onChange={(event) => setClient(event.target.value)} required value={client}>
                <option value="">Choose a client</option>
                {clients.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
              </select>
            </label>
            <label>
              <span>Service</span>
              <select name="serviceCode" required>
                <option value="">Choose a service</option>
                {servicesForClient.map((code) => <option key={code} value={code}>{code}</option>)}
              </select>
              {client && servicesForClient.length === 0 && <small>This client has no active engagements.</small>}
            </label>
            <label>
              <span>How this client differs</span>
              <select name="mode" onChange={(event) => setMode(event.target.value)} value={mode}>
                <option value="override">Files on their own schedule</option>
                <option value="exempt">Not applicable — raise nothing</option>
              </select>
            </label>

            {mode === "override" && (
              <>
                <label>
                  <span>Frequency</span>
                  <select defaultValue="quarterly" name="frequency" required>
                    <option value="monthly">Monthly</option>
                    <option value="quarterly">Quarterly</option>
                    <option value="annual">Annual</option>
                  </select>
                </label>
                <label>
                  <span>Due months after the period ends</span>
                  <input defaultValue={1} max={12} min={0} name="dueMonthOffset" required type="number" />
                </label>
                <label>
                  <span>Due day</span>
                  <input defaultValue={13} max={31} min={1} name="dueDay" required type="number" />
                </label>
                <label>
                  <span>Internal lead (days)</span>
                  <input defaultValue={3} max={60} min={0} name="internalLeadDays" required type="number" />
                </label>
              </>
            )}

            <label>
              <span>In force from</span>
              <input name="effectiveFrom" required type="date" />
            </label>
            <label className="client-schedule-form-wide">
              <span>Why</span>
              <input maxLength={500} name="note" placeholder="Opted into QRMP from Q1 FY 26–27" type="text" />
            </label>
            <button className="primary-button" disabled={saving} type="submit">
              {saving ? "Recording…" : "Record schedule"}
            </button>
          </form>
        )}
      </section>

      <section className="surface-card client-schedule-register">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">EXTENSIONS</p>
            <h2>{extensions.length === 0 ? "No dates have been moved" : `${extensions.length} extension${extensions.length === 1 ? "" : "s"} recorded`}</h2>
            <span>
              A date moved by CBIC or CBDT applies to everybody filing that return. Recorded once, with the notification
              it came from, and applied to work already raised.
            </span>
          </div>
          {canManage && (
            <button className="secondary-button" onClick={() => setAddingExtension(!addingExtension)} type="button">
              {addingExtension ? "Cancel" : "Record an extension"}
            </button>
          )}
        </div>

        {extensions.length > 0 && (
          <ul className="client-schedule-list">
            {extensions.map((extension) => (
              <li className="client-schedule-row is-extension" key={extension.id}>
                <div className="client-schedule-row-head">
                  <strong>{extension.serviceCode} · {extension.periodKey}</strong>
                  <StatusBadge tone="mint">{formatDate(extension.originalDueDate)} → {formatDate(extension.extendedDueDate)}</StatusBadge>
                </div>
                <small className="client-schedule-line">
                  {extension.clientName ? `${extension.clientName} only` : "Every client filing this service"} · {extension.authority}
                </small>
                <small className="client-schedule-meta">
                  {extension.appliedCount === 0
                    ? "Nothing open matched when this was recorded; it applies as obligations are raised."
                    : `${extension.appliedCount} open obligation${extension.appliedCount === 1 ? "" : "s"} moved · anything already filed was left as it was`}
                  {extension.note ? ` · ${extension.note}` : ""} · recorded by {extension.createdByName}
                </small>
              </li>
            ))}
          </ul>
        )}

        {canManage && addingExtension && (
          <form action={extend} className="client-schedule-form">
            <label>
              <span>Service</span>
              <select name="serviceCode" required>
                <option value="">Choose a service</option>
                {services.map((service) => <option key={service.code} value={service.code}>{service.code} · {service.name}</option>)}
              </select>
            </label>
            <label>
              <span>Period, exactly as the calendar labels it</span>
              <input maxLength={60} name="periodKey" placeholder="FY 2025–26" required type="text" />
            </label>
            <label>
              <span>Original due date</span>
              <input name="originalDueDate" required type="date" />
            </label>
            <label>
              <span>Extended to</span>
              <input name="extendedDueDate" required type="date" />
            </label>
            <label>
              <span>Applies to</span>
              <select defaultValue="" name="legalEntityId">
                <option value="">Every client filing this service</option>
                {clients.map((entry) => <option key={entry.id} value={entry.id}>{entry.name} only</option>)}
              </select>
            </label>
            <label className="client-schedule-form-wide">
              <span>Authority</span>
              <input maxLength={200} name="authority" placeholder="CBIC Notification 12/2026" required type="text" />
            </label>
            <label className="client-schedule-form-wide">
              <span>Note</span>
              <input maxLength={500} name="note" type="text" />
            </label>
            <button className="primary-button" disabled={extending} type="submit">
              {extending ? "Applying…" : "Record and apply"}
            </button>
          </form>
        )}
      </section>
    </>
  );
}
