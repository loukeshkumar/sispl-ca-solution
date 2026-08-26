"use client";

import { useActionState, useState } from "react";

import type { Clearance, EmploymentStage } from "../../../lib/team/offboarding";
import { STAGE_LABELS, STAGE_TONE } from "../../../lib/team/offboarding";
import type { EmployeeActionState } from "../../../lib/team/validation";
import { disableEmployeeAction, setEmploymentStageAction } from "../actions";
import { StatusBadge } from "../../dashboard/dashboard-ui";

const initialState: EmployeeActionState = { error: "", fieldErrors: {} };

const formatDate = (value: string | null) => (value
  ? new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`))
  : "—");

const SEVERITY_TONE = { blocking: "red", warning: "amber", note: "blue" } as const;

/**
 * Where somebody is in their employment, and what the firm still holds of
 * theirs.
 *
 * The clearance is not a list anybody maintains — it is worked out from the
 * registers, the work queue and the leave ledger every time this page is read,
 * which is the only kind of checklist that cannot be ticked without being true.
 */
export function EmploymentPanel({
  canManage,
  clearance,
  employee,
  probationDue,
  todayKey,
}: {
  canManage: boolean;
  /** Absent while the employee is still active and nobody has asked to exit them. */
  clearance: Clearance | null;
  employee: {
    confirmedOn: string | null;
    employmentEndDate: string | null;
    employmentStage: EmploymentStage;
    exitReason: string;
    id: string;
    joiningDate: string;
    name: string;
    noticeStartDate: string | null;
    probationEndDate: string | null;
  };
  /** True when probation ran out and nobody decided either way. */
  probationDue: boolean;
  todayKey: string;
}) {
  const [stageState, changeStage, changingStage] = useActionState(setEmploymentStageAction, initialState);
  const [disableState, disable, disabling] = useActionState(disableEmployeeAction, initialState);
  const [stage, setStage] = useState<"probation" | "confirmed" | "notice">(
    employee.employmentStage === "probation" ? "confirmed" : "notice",
  );

  const exited = employee.employmentStage === "exited";
  const blocking = clearance?.items.filter((item) => item.severity === "blocking") ?? [];
  const error = stageState.error || disableState.error;

  return (
    <section className="surface-card employment-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">EMPLOYMENT</p>
          <h2>Stage and clearance</h2>
          <span>{employee.name} joined {formatDate(employee.joiningDate)}</span>
        </div>
        <StatusBadge tone={STAGE_TONE[employee.employmentStage]}>{STAGE_LABELS[employee.employmentStage]}</StatusBadge>
      </div>

      {error && <p className="client-form-banner" role="alert">{error}</p>}

      {probationDue && (
        <p className="employment-overdue" role="status">
          Probation ended {formatDate(employee.probationEndDate)} and nobody has confirmed or ended the employment.
        </p>
      )}

      <dl className="employment-facts">
        <div><dt>Joined</dt><dd>{formatDate(employee.joiningDate)}</dd></div>
        <div><dt>Probation ends</dt><dd>{formatDate(employee.probationEndDate)}</dd></div>
        <div><dt>Confirmed</dt><dd>{formatDate(employee.confirmedOn)}</dd></div>
        <div><dt>Notice began</dt><dd>{formatDate(employee.noticeStartDate)}</dd></div>
        <div><dt>Last day</dt><dd>{formatDate(employee.employmentEndDate)}</dd></div>
        {employee.exitReason && <div className="employment-facts-wide"><dt>Reason for leaving</dt><dd>{employee.exitReason}</dd></div>}
      </dl>

      {canManage && !exited && (
        <form action={changeStage} className="employment-form">
          <input name="employeeId" type="hidden" value={employee.id} />
          <label>
            <span>Move to</span>
            <select name="stage" onChange={(event) => setStage(event.target.value as typeof stage)} value={stage}>
              <option value="probation">On probation</option>
              <option value="confirmed">Confirmed</option>
              <option value="notice">Serving notice</option>
            </select>
          </label>
          <label>
            <span>{stage === "probation" ? "Probation ends" : "Effective from"}</span>
            <input defaultValue={todayKey} name="effectiveOn" required type="date" />
          </label>
          {stage === "probation" && (
            <label>
              <span>Probation end date</span>
              <input defaultValue={employee.probationEndDate ?? ""} name="probationEndDate" required type="date" />
            </label>
          )}
          {stage === "notice" && (
            <label className="employment-form-wide">
              <span>Reason for leaving</span>
              <input maxLength={300} name="reason" placeholder="Resignation, end of articleship, or other" type="text" />
            </label>
          )}
          <button className="secondary-button" disabled={changingStage} type="submit">
            {changingStage ? "Saving…" : "Update stage"}
          </button>
        </form>
      )}

      {clearance && !exited && (
        <div className="employment-clearance">
          <h3>Exit clearance</h3>
          {clearance.clear ? (
            <p className="employment-clear">Nothing is outstanding. Disabling the account is safe.</p>
          ) : (
            <ul className="employment-clearance-list">
              {clearance.items.map((item) => (
                <li className={`employment-clearance-item is-${item.severity}`} key={item.id}>
                  <span>
                    <strong>{item.title}</strong>
                    <small>{item.detail}</small>
                    <small className="employment-clearance-action">{item.action}</small>
                  </span>
                  <StatusBadge tone={SEVERITY_TONE[item.severity]}>
                    {item.severity === "blocking" ? "Blocks exit" : item.severity === "warning" ? "Needs a decision" : "For information"}
                  </StatusBadge>
                </li>
              ))}
            </ul>
          )}

          {canManage && (
            <form
              action={disable}
              className="employment-disable"
              onSubmit={(event) => {
                if (!window.confirm(`Disable ${employee.name}? They will immediately lose access.`)) event.preventDefault();
              }}
            >
              <input name="employeeId" type="hidden" value={employee.id} />
              {clearance.needsReason && (
                <label>
                  <span>Why the firm is proceeding anyway</span>
                  <input
                    maxLength={500}
                    minLength={3}
                    name="clearanceNote"
                    placeholder="Who is covering, and what happens to the rest"
                    required
                    type="text"
                  />
                </label>
              )}
              <button className="danger-button" disabled={disabling || blocking.length > 0} type="submit">
                {disabling ? "Disabling…" : blocking.length > 0 ? "Blocked by clearance" : "Disable employee"}
              </button>
            </form>
          )}
        </div>
      )}
    </section>
  );
}
