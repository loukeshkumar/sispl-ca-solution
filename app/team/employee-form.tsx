"use client";

import { useActionState } from "react";

import { useCloseOnSuccess } from "../dashboard/form-dialog";

import { QUALIFICATION_LABELS, QUALIFICATIONS } from "../../lib/team/capability";
import type { EmployeeActionState, EmployeeInput } from "../../lib/team/validation";
import type { AssignableRole } from "../../lib/roles/repository";

type EmployeeFormAction = (state: EmployeeActionState, formData: FormData) => Promise<EmployeeActionState>;
const initialState: EmployeeActionState = { error: "", fieldErrors: {} };

export default function EmployeeForm({ action, employeeId, initial, mode, onCancel, onSaved, roles }: { action: EmployeeFormAction; employeeId?: string; initial?: Partial<EmployeeInput>; mode: "create" | "edit"; onCancel: () => void; onSaved: () => void; roles: AssignableRole[] }) {
  const [state, formAction, pending] = useActionState(action, initialState);
  useCloseOnSuccess(pending, state, onSaved);
  const fieldA11y = (field: keyof EmployeeActionState["fieldErrors"]) => state.fieldErrors[field]
    ? { "aria-describedby": `${field}-error`, "aria-invalid": true as const }
    : {};
  const error = (field: keyof EmployeeActionState["fieldErrors"]) => state.fieldErrors[field]
    ? <small className="client-form-error" id={`${field}-error`}>{state.fieldErrors[field]}</small>
    : null;
  return (
    <form action={formAction} className="client-editor-form employee-editor-form is-in-dialog">
      {employeeId && <input name="employeeId" type="hidden" value={employeeId} />}
      <section className="client-form-section">
        <div><p className="eyebrow">EMPLOYEE IDENTITY</p><h2>Profile and access role</h2><span>Keep employee identity minimal and use the role to control firm access.</span></div>
        <div className="client-form-grid">
          <label className="client-form-wide"><span>Full name</span><input {...fieldA11y("fullName")} defaultValue={initial?.fullName} maxLength={120} name="fullName" required />{error("fullName")}</label>
          <label><span>Email address</span><input {...fieldA11y("email")} autoCapitalize="none" defaultValue={initial?.email} maxLength={254} name="email" required type="email" />{error("email")}</label>
          <label><span>User role</span><select {...fieldA11y("roleDefinitionId")} defaultValue={initial?.roleDefinitionId ?? ""} name="roleDefinitionId" required><option value="">Choose access role</option>{roles.map((role) => <option key={role.id} value={role.id}>{role.name} · {role.roleClass === "admin" ? "Admin" : "Employee"}</option>)}</select>{error("roleDefinitionId")}<small>Roles are managed in Settings → User Roles Management.</small></label>
          <label><span>Designation</span><input {...fieldA11y("designation")} defaultValue={initial?.designation} maxLength={100} name="designation" placeholder="Audit Associate" required />{error("designation")}</label>
          <label><span>Mobile number</span><input {...fieldA11y("mobileNumber")} defaultValue={initial?.mobileNumber} inputMode="tel" maxLength={18} name="mobileNumber" placeholder="+91 98765 43210" />{error("mobileNumber")}</label>
          <label><span>Joining date</span><input {...fieldA11y("joiningDate")} defaultValue={initial?.joiningDate ?? new Date().toISOString().slice(0, 10)} name="joiningDate" required type="date" />{error("joiningDate")}</label>
          <label className="client-form-wide"><span>Employment notes</span><textarea {...fieldA11y("notes")} defaultValue={initial?.notes} maxLength={500} name="notes" placeholder="Primary responsibilities, expertise, or internal context." />{error("notes")}</label>
        </div>
      </section>

      {/* Designation above is the firm grade. This is the qualification behind
          it, which is what decides who may put the firm's name to a report. */}
      <section className="client-form-section">
        <div><p className="eyebrow">PROFESSIONAL STANDING</p><h2>Qualification</h2><span>What this person is qualified as. Their capability, service by service, is recorded separately.</span></div>
        <div className="client-form-grid">
          <label>
            <span>Qualification</span>
            <select {...fieldA11y("qualification")} defaultValue={initial?.qualification ?? "other"} name="qualification">
              {QUALIFICATIONS.map((value) => <option key={value} value={value}>{QUALIFICATION_LABELS[value]}</option>)}
            </select>
            {error("qualification")}
          </label>
          <label>
            <span>ICAI membership number</span>
            <input {...fieldA11y("membershipNumber")} defaultValue={initial?.membershipNumber} inputMode="numeric" maxLength={6} name="membershipNumber" placeholder="123456" />
            {error("membershipNumber")}
            <small>Six digits. Only a Chartered Accountant holds one.</small>
          </label>
          <label>
            <span>Qualified on</span>
            <input {...fieldA11y("qualifiedOn")} defaultValue={initial?.qualifiedOn ?? ""} name="qualifiedOn" type="date" />
            {error("qualifiedOn")}
          </label>
        </div>
      </section>
      {state.error && <p className="client-form-banner" role="alert">{state.error}</p>}
      <div className="client-form-actions"><button className="secondary-button" onClick={onCancel} type="button">Cancel</button><button className="primary-button" disabled={pending} type="submit">{pending ? "Saving…" : mode === "create" ? "Add employee" : "Save employee"}</button></div>
    </form>
  );
}
