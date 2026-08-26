"use client";

import { useActionState, useState } from "react";

import type { ComplianceScheduleRow, ComplianceScheduleWorkspace } from "../../../lib/compliance/repository";
import { complianceFrequencies, describeSchedule, type ComplianceScheduleActionState } from "../../../lib/compliance/validation";
import {
  dialogRecord,
  FormDialog,
  FormDialogActions,
  FormDialogBody,
  useCloseOnSuccess,
  type DialogState,
} from "../../dashboard/form-dialog";
import { useToast } from "../../dashboard/toast";
import { saveComplianceScheduleAction } from "./actions";

const initialState: ComplianceScheduleActionState = { error: "", fieldErrors: {} };
const fieldError = (message?: string) => message ? <em className="package-field-error">{message}</em> : null;
const frequencyLabels: Record<string, string> = { monthly: "Monthly", quarterly: "Quarterly", annual: "Annual" };

export default function ScheduleRegister({
  canManage,
  workspace,
}: {
  canManage: boolean;
  workspace: ComplianceScheduleWorkspace;
}) {
  const [dialog, setDialog] = useState<DialogState<ComplianceScheduleRow>>(null);
  const [state, formAction, pending] = useActionState(saveComplianceScheduleAction, initialState);
  const toast = useToast();
  useCloseOnSuccess(pending, state, () => { toast.success("Compliance schedule saved."); setDialog(null); });
  const record = dialogRecord(dialog);

  return (
    <>
      <section className="surface-card client-package-register">
        {canManage && (
          <div className="master-register-toolbar">
            <div>
              <strong>Compliance schedules</strong>
              <small>Rules that generate recurring obligations from each client&rsquo;s active package.</small>
            </div>
            <button className="primary-button" onClick={() => setDialog("add")} type="button">Add schedule</button>
          </div>
        )}

        {workspace.schedules.length === 0 ? (
          <div className="package-empty-state">
            <strong>No schedules configured</strong>
            <p>Without a schedule, obligations must be created by hand. Add one per recurring service.</p>
          </div>
        ) : (
          <div>
            <div className="package-register-head schedule-register-head">
              <span>Service</span><span>Cadence</span><span>Effective from</span><span>Lead</span><span>Status</span><span aria-hidden="true" />
            </div>
            {workspace.schedules.map((schedule) => (
              <article className={`package-register-row schedule-register-row ${schedule.superseded ? "is-superseded" : ""}`} key={schedule.id}>
                <span><strong>{schedule.serviceCode}</strong><small>{schedule.serviceName ?? "Not in the service master"}</small></span>
                <span><small>{describeSchedule(schedule)}</small></span>
                <span>{schedule.effectiveFrom}</span>
                <span>{schedule.internalLeadDays} day{schedule.internalLeadDays === 1 ? "" : "s"}</span>
                <span className={`schedule-status is-${schedule.status}`}>
                  {schedule.status === "archived" ? "Archived" : schedule.superseded ? "Superseded" : "Active"}
                </span>
                {canManage
                  ? <button className="master-toggle-button" onClick={() => setDialog(schedule)} type="button">Edit</button>
                  : <span>View only</span>}
              </article>
            ))}
          </div>
        )}
      </section>

      <p className="package-control-note-text">
        Seeded schedules are firm-reviewable defaults, not statutory advice. Verify every due date against the governing
        statute before relying on it. Editing a rule never rewrites obligations that were already generated.
      </p>

      <FormDialog
        description="A new effective date supersedes the previous rule from that date forward. Obligations already generated are never rewritten."
        onClose={() => setDialog(null)}
        open={dialog !== null}
        title={record ? `Edit ${record.serviceCode} schedule` : "Add a compliance schedule"}
      >
        <form action={formAction} className="form-dialog-form" key={record?.id ?? "new-schedule"}>
          <FormDialogBody>
            {state.error && <p className="package-form-banner" role="alert">{state.error}</p>}
            {record && <input name="scheduleId" type="hidden" value={record.id} />}
            <label><span>Service</span>
              <select defaultValue={record?.serviceCode ?? ""} name="serviceCode" required>
                <option disabled value="">Select a master service</option>
                {workspace.services.map((service) => <option key={service.code} value={service.code}>{service.code} · {service.name}</option>)}
              </select>
              {fieldError(state.fieldErrors.serviceCode)}
            </label>
            <label><span>Frequency</span>
              <select defaultValue={record?.frequency ?? "monthly"} name="frequency">
                {complianceFrequencies.map((value) => <option key={value} value={value}>{frequencyLabels[value]}</option>)}
              </select>
              {fieldError(state.fieldErrors.frequency)}
            </label>
            <label><span>Months after the period ends</span>
              <input defaultValue={record?.dueMonthOffset ?? 1} max={12} min={0} name="dueMonthOffset" required type="number" />
              {fieldError(state.fieldErrors.dueMonthOffset)}
            </label>
            <label><span>Statutory due day</span>
              <input defaultValue={record?.dueDay ?? 20} max={31} min={1} name="dueDay" required type="number" />
              {fieldError(state.fieldErrors.dueDay)}
            </label>
            <label><span>Internal lead days</span>
              <input defaultValue={record?.internalLeadDays ?? 3} max={60} min={0} name="internalLeadDays" required type="number" />
              {fieldError(state.fieldErrors.internalLeadDays)}
            </label>
            <label><span>Effective from</span>
              <input defaultValue={record?.effectiveFrom ?? workspace.todayKey} name="effectiveFrom" required type="date" />
              {fieldError(state.fieldErrors.effectiveFrom)}
            </label>
            <label><span>Status</span>
              <select defaultValue={record?.status ?? "active"} name="status">
                <option value="active">Active</option>
                <option value="archived">Archived</option>
              </select>
            </label>
          </FormDialogBody>
          <FormDialogActions onCancel={() => setDialog(null)} pending={pending} submitLabel={record ? "Save changes" : "Add schedule"} />
        </form>
      </FormDialog>
    </>
  );
}
