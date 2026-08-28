"use client";

import { useActionState, useState } from "react";

import type { AttendanceMastersWorkspace, HolidayRow, LeaveTypeRow, ShiftTypeRow } from "../../../lib/attendance-masters/repository";
import {
  describeWorkingWeek,
  holidayTypes,
  type HolidayActionState,
  type LeaveTypeActionState,
  type ShiftTypeActionState,
} from "../../../lib/attendance-masters/validation";
import { StatusBadge } from "../../dashboard/dashboard-ui";
import {
  dialogRecord,
  FormDialog,
  FormDialogActions,
  FormDialogBody,
  useCloseOnSuccess,
  type DialogState,
} from "../../dashboard/form-dialog";
import { useToast } from "../../dashboard/toast";
import { saveHolidayAction, saveLeaveTypeAction, saveShiftTypeAction, toggleAttendanceMasterAction } from "./actions";

type Tab = "leave" | "holidays" | "shifts";

const leaveInitial: LeaveTypeActionState = { error: "", fieldErrors: {} };
const holidayInitial: HolidayActionState = { error: "", fieldErrors: {} };
const shiftInitial: ShiftTypeActionState = { error: "", fieldErrors: {} };

const WEEK_INITIALS = ["M", "T", "W", "T", "F", "S", "S"];

const formatHoliday = (value: string) => new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "UTC" })
  .format(new Date(`${value}T00:00:00Z`));

const weekdayOf = (value: string) => new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", weekday: "long" })
  .format(new Date(`${value}T00:00:00Z`));

/** Monday-first, matching the seven-character working-week mask. */
const weekIndexOf = (value: string) => (new Date(`${value}T00:00:00Z`).getUTCDay() + 6) % 7;

/**
 * The working week as seven marks rather than a sentence.
 *
 * The prose stays as the accessible name, so a screen reader still hears
 * "Mon, Tue, Wed, Thu, Fri" while the eye gets a shape it can compare down
 * the column.
 */
function WorkingWeek({ mask }: { mask: string }) {
  return (
    <span aria-label={describeWorkingWeek(mask)} className="week-strip" role="img">
      {WEEK_INITIALS.map((initial, index) => (
        <b className={mask[index] === "1" ? "is-on" : ""} key={index}>{initial}</b>
      ))}
    </span>
  );
}

const holidayTypeLabels: Record<string, string> = { public: "Public", restricted: "Restricted", optional: "Optional" };
const WEEK_DAYS = [["Mon", 0], ["Tue", 1], ["Wed", 2], ["Thu", 3], ["Fri", 4], ["Sat", 5], ["Sun", 6]] as const;

const fieldError = (message?: string) => message ? <em className="package-field-error">{message}</em> : null;

function RowActions({ kind, onEdit, recordId, status }: { kind: string; onEdit: () => void; recordId: string; status: string }) {
  return (
    <span className="master-row-actions">
      <button className="master-toggle-button" onClick={onEdit} type="button">Edit</button>
      <form action={toggleAttendanceMasterAction}>
        <input name="kind" type="hidden" value={kind} />
        <input name="recordId" type="hidden" value={recordId} />
        <input name="nextStatus" type="hidden" value={status === "active" ? "archived" : "active"} />
        <button className="master-toggle-button" type="submit">{status === "active" ? "Archive" : "Restore"}</button>
      </form>
    </span>
  );
}

function RegisterToolbar({ addLabel, description, onAdd, title }: { addLabel: string; description: string; onAdd: () => void; title: string }) {
  return (
    <div className="master-register-toolbar">
      <div><strong>{title}</strong><small>{description}</small></div>
      <button className="primary-button" onClick={onAdd} type="button">{addLabel}</button>
    </div>
  );
}

function LeaveFields({ record, state }: { record: LeaveTypeRow | null; state: LeaveTypeActionState }) {
  return (
    <>
      <label><span>Code</span><input defaultValue={record?.code ?? ""} maxLength={30} name="code" placeholder="casual" required type="text" />{fieldError(state.fieldErrors.code)}</label>
      <label><span>Name</span><input defaultValue={record?.name ?? ""} maxLength={60} name="name" placeholder="Casual leave" required type="text" />{fieldError(state.fieldErrors.name)}</label>
      <label><span>Annual quota (0 = none)</span><input defaultValue={record?.annualQuotaDays ?? 0} max={365} min={0} name="annualQuotaDays" type="number" />{fieldError(state.fieldErrors.annualQuotaDays)}</label>
      <label>
        <span>How it is granted</span>
        <select defaultValue={record?.accrualMethod ?? "annual"} name="accrualMethod">
          <option value="annual">All at once, in April</option>
          <option value="monthly">A twelfth each completed month</option>
          <option value="none">Not automatically — sanctioned case by case</option>
        </select>
        {fieldError(state.fieldErrors.accrualMethod)}
      </label>
      <label><span>Carry forward up to (0 = none)</span><input defaultValue={record?.carryForwardCap ?? 0} max={365} min={0} name="carryForwardCap" type="number" />{fieldError(state.fieldErrors.carryForwardCap)}</label>
      <label><span>Carried days lapse after (months, blank = never)</span><input defaultValue={record?.carryForwardExpiryMonths ?? ""} max={12} min={1} name="carryForwardExpiryMonths" placeholder="e.g. 3" type="number" />{fieldError(state.fieldErrors.carryForwardExpiryMonths)}</label>
      <label><span>Order</span><input defaultValue={record?.displayOrder ?? 10} max={999} min={0} name="displayOrder" type="number" /></label>
      <div className="form-dialog-toggles">
        <label className="master-checkbox"><input defaultChecked={record ? record.paidByDefault : true} name="paidByDefault" type="checkbox" /><span>Paid by default</span></label>
        <label className="master-checkbox"><input defaultChecked={record ? record.allowsHalfDay : true} name="allowsHalfDay" type="checkbox" /><span>Allows half day</span></label>
        <label className="master-checkbox"><input defaultChecked={record ? record.requiresReason : true} name="requiresReason" type="checkbox" /><span>Requires a reason</span></label>
        <label className="master-checkbox"><input defaultChecked={record ? record.encashableOnExit : false} name="encashableOnExit" type="checkbox" /><span>Encashable when an employee leaves</span></label>
      </div>
    </>
  );
}

function HolidayFields({ record, state }: { record: HolidayRow | null; state: HolidayActionState }) {
  return (
    <>
      <label><span>Date</span><input defaultValue={record?.holidayDate ?? ""} name="holidayDate" required type="date" />{fieldError(state.fieldErrors.holidayDate)}</label>
      <label><span>Name</span><input defaultValue={record?.name ?? ""} maxLength={80} name="name" placeholder="Republic Day" required type="text" />{fieldError(state.fieldErrors.name)}</label>
      <label><span>Type</span><select defaultValue={record?.holidayType ?? "public"} name="holidayType">{holidayTypes.map((type) => <option key={type} value={type}>{holidayTypeLabels[type]}</option>)}</select></label>
      <label><span>State</span><input defaultValue={record?.jurisdictionState ?? "Bihar"} maxLength={40} name="jurisdictionState" required type="text" />{fieldError(state.fieldErrors.jurisdictionState)}</label>
      <p className="master-form-note">Only <b>public</b> holidays are removed from scheduled working days. Editing does not recalculate a month that is already locked.</p>
    </>
  );
}

function ShiftFields({ record, state }: { record: ShiftTypeRow | null; state: ShiftTypeActionState }) {
  return (
    <>
      <label><span>Code</span><input defaultValue={record?.code ?? ""} maxLength={20} name="code" placeholder="GENERAL" required type="text" />{fieldError(state.fieldErrors.code)}</label>
      <label><span>Name</span><input defaultValue={record?.name ?? ""} maxLength={60} name="name" placeholder="General shift" required type="text" />{fieldError(state.fieldErrors.name)}</label>
      <label><span>Starts</span><input defaultValue={record?.startTime ?? "09:30"} name="startTime" required type="time" />{fieldError(state.fieldErrors.startTime)}</label>
      <label><span>Ends</span><input defaultValue={record?.endTime ?? "18:00"} name="endTime" required type="time" />{fieldError(state.fieldErrors.endTime)}</label>
      <label><span>Full day (minutes)</span><input defaultValue={record?.fullDayMinutes ?? 450} max={960} min={60} name="fullDayMinutes" type="number" />{fieldError(state.fieldErrors.fullDayMinutes)}</label>
      <label><span>Half day (minutes)</span><input defaultValue={record?.halfDayMinutes ?? 225} min={30} name="halfDayMinutes" type="number" />{fieldError(state.fieldErrors.halfDayMinutes)}</label>
      <label><span>Late grace (minutes)</span><input defaultValue={record?.lateGraceMinutes ?? 15} max={180} min={0} name="lateGraceMinutes" type="number" />{fieldError(state.fieldErrors.lateGraceMinutes)}</label>
      <fieldset className="master-week-picker">
        <legend>Working week</legend>
        <WeekMaskPicker initialMask={record?.workingWeekMask ?? "1111110"} />
        {fieldError(state.fieldErrors.workingWeekMask)}
      </fieldset>
      <div className="form-dialog-toggles">
        <label className="master-checkbox"><input defaultChecked={record?.isDefault ?? false} name="isDefault" type="checkbox" /><span>Use as the firm default shift</span></label>
      </div>
    </>
  );
}

export default function AttendanceMasters({
  canManage,
  initialTab,
  workspace,
}: {
  canManage: boolean;
  initialTab: Tab;
  workspace: AttendanceMastersWorkspace;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [leaveDialog, setLeaveDialog] = useState<DialogState<LeaveTypeRow>>(null);
  const [holidayDialog, setHolidayDialog] = useState<DialogState<HolidayRow>>(null);
  const [shiftDialog, setShiftDialog] = useState<DialogState<ShiftTypeRow>>(null);
  /*
   * A holiday that lands on a day the firm is already closed costs nothing and
   * gains nobody a day off, which is worth saying on the row. Only the default
   * shift can answer that; without one the claim would be a guess, so it is
   * left unsaid.
   */
  const defaultWeekMask = workspace.shifts
    .find((shift) => shift.isDefault && shift.status === "active")?.workingWeekMask ?? null;

  const [leaveState, leaveAction, leavePending] = useActionState(saveLeaveTypeAction, leaveInitial);
  const [holidayState, holidayAction, holidayPending] = useActionState(saveHolidayAction, holidayInitial);
  const [shiftState, shiftAction, shiftPending] = useActionState(saveShiftTypeAction, shiftInitial);

  const toast = useToast();
  useCloseOnSuccess(leavePending, leaveState, () => { toast.success("Leave type saved."); setLeaveDialog(null); });
  useCloseOnSuccess(holidayPending, holidayState, () => { toast.success("Holiday saved."); setHolidayDialog(null); });
  useCloseOnSuccess(shiftPending, shiftState, () => { toast.success("Shift type saved."); setShiftDialog(null); });

  const leaveRecord = dialogRecord(leaveDialog);
  const holidayRecord = dialogRecord(holidayDialog);
  const shiftRecord = dialogRecord(shiftDialog);

  return (
    <>
      <div className="package-catalogue-tabs" role="tablist">
        {([["leave", "Leave types", workspace.leaveTypes.length], ["holidays", "Holidays", workspace.holidays.length], ["shifts", "Shift types", workspace.shifts.length]] as const).map(([key, label, count]) => (
          <button aria-selected={tab === key} key={key} onClick={() => setTab(key)} role="tab" type="button">
            {label}<span>{count}</span>
          </button>
        ))}
      </div>

      {tab === "leave" && (
        <section className="surface-card client-package-register">
          {canManage && <RegisterToolbar addLabel="Add leave type" description="What employees may request, and how each type is paid." onAdd={() => setLeaveDialog("add")} title="Leave types" />}
          {workspace.leaveTypes.length === 0 ? (
            <div className="package-empty-state"><strong>No leave types defined</strong><p>Employees cannot request leave until at least one type is active.</p></div>
          ) : (
            <div>
              <div className="package-register-head leave-register-head"><span>Leave type</span><span>Pay</span><span>Half day</span><span>Annual quota</span><span>Carry forward</span><span>Status</span><span aria-hidden="true" /></div>
              {workspace.leaveTypes.map((item) => (
                <article className="package-register-row leave-register-row" key={item.id}>
                  <span><strong>{item.name}</strong><small>{item.code}</small></span>
                  <span>{item.paidByDefault ? "Paid" : "Unpaid"}</span>
                  <span>{item.allowsHalfDay ? "Allowed" : "Full days only"}</span>
                  <span>
                    <strong>{item.annualQuotaDays === 0 ? "No quota" : `${item.annualQuotaDays} days`}</strong>
                    <small>{item.annualQuotaDays === 0 ? "Not enforced" : item.accrualMethod === "monthly" ? "Monthly accrual" : item.accrualMethod === "none" ? "Granted case by case" : "Granted in April"}</small>
                  </span>
                  <span>
                    <strong>{item.carryForwardCap === 0 ? "None" : `Up to ${item.carryForwardCap} days`}</strong>
                    <small>{item.carryForwardCap === 0 ? "Unused days end with the year" : item.carryForwardExpiryMonths === null ? "Carried days never lapse" : `Lapse after ${item.carryForwardExpiryMonths} month${item.carryForwardExpiryMonths === 1 ? "" : "s"}`}</small>
                  </span>
                  <StatusBadge tone={item.status === "active" ? "mint" : "neutral"}>{item.status === "active" ? "Active" : "Archived"}</StatusBadge>
                  {canManage ? <RowActions kind="leave" onEdit={() => setLeaveDialog(item)} recordId={item.id} status={item.status} /> : <span />}
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      {tab === "holidays" && (
        <section className="surface-card client-package-register">
          {canManage && <RegisterToolbar addLabel="Add holiday" description="Days the firm is closed. Public holidays leave the scheduled working days." onAdd={() => setHolidayDialog("add")} title="Holidays" />}
          {workspace.holidays.length === 0 ? (
            <div className="package-empty-state"><strong>No holidays in the calendar</strong><p>Public holidays are excluded from scheduled working days once added.</p></div>
          ) : (
            <div>
              <div className="package-register-head holiday-register-head"><span>Date</span><span>Holiday</span><span>Type</span><span>State</span><span>Status</span><span aria-hidden="true" /></div>
              {workspace.holidays.map((item) => (
                <article className={`package-register-row holiday-register-row ${item.holidayDate < workspace.todayKey ? "is-past" : ""}`} key={item.id}>
                  <span>
                    <strong>{formatHoliday(item.holidayDate)}</strong>
                    <small>
                      {weekdayOf(item.holidayDate)}
                      {defaultWeekMask && defaultWeekMask[weekIndexOf(item.holidayDate)] === "0" && " · already a non-working day"}
                    </small>
                  </span>
                  <span><strong>{item.name}</strong></span>
                  <span>{holidayTypeLabels[item.holidayType] ?? item.holidayType}</span>
                  <span>{item.jurisdictionState}</span>
                  <StatusBadge tone={item.status === "active" ? "mint" : "neutral"}>{item.status === "active" ? "Active" : "Archived"}</StatusBadge>
                  {canManage ? <RowActions kind="holiday" onEdit={() => setHolidayDialog(item)} recordId={item.id} status={item.status} /> : <span />}
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      {tab === "shifts" && (
        <section className="surface-card client-package-register">
          {canManage && <RegisterToolbar addLabel="Add shift" description="Timings employees work to. One shift may be the firm default." onAdd={() => setShiftDialog("add")} title="Shift types" />}
          {workspace.shifts.length === 0 ? (
            <div className="package-empty-state"><strong>No shifts defined</strong><p>Employees follow the firm attendance policy until a shift is assigned.</p></div>
          ) : (
            <div>
              <div className="package-register-head shift-register-head"><span>Shift</span><span>Timing</span><span>Working week</span><span>Full / half day</span><span>Status</span><span aria-hidden="true" /></div>
              {workspace.shifts.map((item) => (
                <article className="package-register-row shift-register-row" key={item.id}>
                  <span>
                    <b className="shift-name-line"><strong>{item.name}</strong>{item.isDefault && <i className="checklist-mandatory-chip">Default</i>}</b>
                    <small>{item.code}</small>
                  </span>
                  <span>{item.startTime} – {item.endTime}<small> · {item.lateGraceMinutes}m grace</small></span>
                  <span><WorkingWeek mask={item.workingWeekMask} /></span>
                  <span>{Math.round(item.fullDayMinutes / 60 * 10) / 10}h / {Math.round(item.halfDayMinutes / 60 * 10) / 10}h</span>
                  <StatusBadge tone={item.status === "active" ? "mint" : "neutral"}>{item.status === "active" ? "Active" : "Archived"}</StatusBadge>
                  {canManage ? <RowActions kind="shift" onEdit={() => setShiftDialog(item)} recordId={item.id} status={item.status} /> : <span />}
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      <FormDialog onClose={() => setLeaveDialog(null)} open={leaveDialog !== null} title={leaveRecord ? `Edit ${leaveRecord.name}` : "Add a leave type"}>
        <form action={leaveAction} className="form-dialog-form" key={leaveRecord?.id ?? "new-leave"}>
          <FormDialogBody>
            {leaveState.error && <p className="package-form-banner" role="alert">{leaveState.error}</p>}
            {leaveRecord && <input name="leaveTypeId" type="hidden" value={leaveRecord.id} />}
            {leaveRecord && <input name="status" type="hidden" value={leaveRecord.status} />}
            <LeaveFields record={leaveRecord} state={leaveState} />
          </FormDialogBody>
          <FormDialogActions onCancel={() => setLeaveDialog(null)} pending={leavePending} submitLabel={leaveRecord ? "Save changes" : "Add leave type"} />
        </form>
      </FormDialog>

      <FormDialog onClose={() => setHolidayDialog(null)} open={holidayDialog !== null} title={holidayRecord ? `Edit ${holidayRecord.name}` : "Add a holiday"}>
        <form action={holidayAction} className="form-dialog-form" key={holidayRecord?.id ?? "new-holiday"}>
          <FormDialogBody>
            {holidayState.error && <p className="package-form-banner" role="alert">{holidayState.error}</p>}
            {holidayRecord && <input name="holidayId" type="hidden" value={holidayRecord.id} />}
            {holidayRecord && <input name="status" type="hidden" value={holidayRecord.status} />}
            <HolidayFields record={holidayRecord} state={holidayState} />
          </FormDialogBody>
          <FormDialogActions onCancel={() => setHolidayDialog(null)} pending={holidayPending} submitLabel={holidayRecord ? "Save changes" : "Add holiday"} />
        </form>
      </FormDialog>

      <FormDialog onClose={() => setShiftDialog(null)} open={shiftDialog !== null} title={shiftRecord ? `Edit ${shiftRecord.name}` : "Add a shift"}>
        <form action={shiftAction} className="form-dialog-form" key={shiftRecord?.id ?? "new-shift"}>
          <FormDialogBody>
            {shiftState.error && <p className="package-form-banner" role="alert">{shiftState.error}</p>}
            {shiftRecord && <input name="shiftTypeId" type="hidden" value={shiftRecord.id} />}
            {shiftRecord && <input name="status" type="hidden" value={shiftRecord.status} />}
            <ShiftFields record={shiftRecord} state={shiftState} />
          </FormDialogBody>
          <FormDialogActions onCancel={() => setShiftDialog(null)} pending={shiftPending} submitLabel={shiftRecord ? "Save changes" : "Add shift"} />
        </form>
      </FormDialog>
    </>
  );
}

/** Builds the seven-character mask the schema expects from day checkboxes. */
function WeekMaskPicker({ initialMask }: { initialMask: string }) {
  const [days, setDays] = useState<boolean[]>(() => WEEK_DAYS.map(([, index]) => initialMask[index] === "1"));
  return (
    <>
      <input name="workingWeekMask" type="hidden" value={days.map((on) => (on ? "1" : "0")).join("")} />
      <div className="master-week-days">
        {WEEK_DAYS.map(([label, index]) => (
          <label key={label}>
            <input
              checked={days[index]}
              onChange={(event) => setDays((current) => current.map((value, position) => (position === index ? event.target.checked : value)))}
              type="checkbox"
            />
            <span>{label}</span>
          </label>
        ))}
      </div>
    </>
  );
}

