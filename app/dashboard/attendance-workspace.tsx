"use client";

import Link from "next/link";
import { useActionState } from "react";
import { CalendarCheck, Clock3, LogIn, LogOut, ShieldCheck, UserCheck, Wallet } from "lucide-react";

import type { AttendanceWorkspaceData } from "../../lib/attendance/repository";
import {
  checkInAttendanceAction, checkOutAttendanceAction, createAttendancePolicyAction, decideAttendanceRequestAction, lockAttendancePeriodAction,
  prepareAttendancePeriodAction, reopenAttendancePeriodAction,
  reviewAttendancePeriodAction, updateEmployeeWorkProfileAction, type AttendanceActionState,
} from "../attendance/actions";
import { AttendanceMatrixGrid } from "./attendance-matrix";
import { AttendanceRequestDialogButton } from "./attendance-request-dialog";
import { EmptyState, KpiCard, PageTitle, StatusBadge } from "./dashboard-ui";
import { WorkspaceTabs, type WorkspaceTab } from "./workspace-tabs";

const initialState: AttendanceActionState = { error: "", fieldErrors: {} };
const statusLabel = (status: string) => ({ present: "Present", absent: "Absent", leave: "On leave", half_day: "Half day", late: "Late", missing_punch: "Missing punch", weekly_off: "Weekly off", holiday: "Holiday", wfh: "Work from home", tour: "Client duty" })[status] ?? status;
const statusTone = (status: string) => status === "absent" || status === "missing_punch" ? "red" : status === "late" || status === "half_day" ? "amber" : status === "leave" ? "blue" : "mint";
const timeLabel = (value: string | null) => value ? new Intl.DateTimeFormat("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" }).format(new Date(value)) : "—";
const shiftPeriod = (periodKey: string, delta: number) => {
  const [year, month] = periodKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
};

function AttendanceClock({ workspace }: { workspace: AttendanceWorkspaceData }) {
  const today = workspace.selfDays.find((day) => day.attendanceDate === workspace.todayKey);
  const open = Boolean(today?.firstCheckIn && !today.lastCheckOut);
  const currentMonth = workspace.periodKey === workspace.todayKey.slice(0, 7);
  return <section className="attendance-clock-card surface-card"><div className="attendance-clock-icon">{open ? <LogOut aria-hidden="true" /> : <LogIn aria-hidden="true" />}</div><div><p className="eyebrow">TODAY · {workspace.todayKey}</p><h2>{currentMonth ? today ? statusLabel(today.status) : "Not checked in" : "Historical register"}</h2><span>{currentMonth ? today?.firstCheckIn ? `In ${timeLabel(today.firstCheckIn)} · Out ${timeLabel(today.lastCheckOut)}` : `Standard day ${workspace.policy.standardStartTime}–${workspace.policy.standardEndTime}` : "Return to the current month to use check-in controls."}</span></div><form action={open ? checkOutAttendanceAction : checkInAttendanceAction}><button className="primary-button" disabled={!currentMonth || Boolean(today?.lastCheckOut) || workspace.period?.status === "locked"} type="submit">{today?.lastCheckOut ? "DAY COMPLETE" : open ? "CHECK OUT" : "CHECK IN"}</button></form></section>;
}

function PeriodControl({ workspace }: { workspace: AttendanceWorkspaceData }) {
  return <section className="attendance-period-card surface-card"><div><p className="eyebrow">MONTH CONTROL</p><h2>{workspace.periodKey}</h2><span>Attendance is the controlled payroll input.</span></div><StatusBadge tone={workspace.period?.status === "locked" ? "mint" : workspace.period?.status === "review" ? "amber" : "blue"}>{workspace.period?.status ?? "Not prepared"}</StatusBadge><div className="attendance-period-actions">{!workspace.period && <form action={prepareAttendancePeriodAction}><input name="periodKey" type="hidden" value={workspace.periodKey} /><button className="secondary-button" type="submit">Prepare month</button></form>}{workspace.period?.status === "open" && <form action={reviewAttendancePeriodAction}><input name="periodId" type="hidden" value={workspace.period.id} /><button className="secondary-button" type="submit">Start review</button></form>}{workspace.period?.status === "review" && <form action={lockAttendancePeriodAction}><input name="periodId" type="hidden" value={workspace.period.id} /><button className="primary-button" type="submit">Lock attendance</button></form>}{workspace.period?.status === "locked" && <form action={reopenAttendancePeriodAction}><input name="periodId" type="hidden" value={workspace.period.id} /><input aria-label="Reason for reopening" name="reason" placeholder="Reason for reopening" required /><button className="secondary-button" type="submit">Reopen month</button></form>}</div></section>;
}

function AttendanceSettings({ workspace }: { workspace: AttendanceWorkspaceData }) {
  const [policyState, policyAction, policyPending] = useActionState(createAttendancePolicyAction, initialState);
  const [profileState, profileAction, profilePending] = useActionState(updateEmployeeWorkProfileAction, initialState);
  const activeTeam = workspace.team.filter((employee) => employee.membershipStatus === "active");
  return <section className="attendance-settings-grid"><form action={profileAction} className="attendance-settings-card surface-card"><div><p className="eyebrow">REPORTING &amp; CLASSIFICATION</p><h2>Employee work profile</h2><span>Reporting lines control manager approval access.</span></div><label><span>Employee</span><select name="employeeUserId" required><option value="">Choose employee</option>{activeTeam.map((employee) => <option key={employee.userId} value={employee.userId}>{employee.fullName}</option>)}</select></label><label><span>Reporting manager</span><select name="managerUserId"><option value="">No reporting manager</option>{activeTeam.map((employee) => <option key={employee.userId} value={employee.userId}>{employee.fullName}</option>)}</select></label><label><span>Employment type</span><select name="employmentType"><option value="employee">Employee</option><option value="articled_assistant">Articled assistant</option></select></label><label><span>Work location</span><input defaultValue="Bihar" name="workLocationState" required /></label><button className="secondary-button" disabled={profilePending} type="submit">{profilePending ? "Saving..." : "Save work profile"}</button>{profileState.error && <p role="alert">{profileState.error}</p>}</form>
    <form action={policyAction} className="attendance-settings-card surface-card"><div><p className="eyebrow">EFFECTIVE-DATED POLICY</p><h2>Attendance policy</h2><span>Create a future version without rewriting history.</span></div><label><span>Effective from</span><input name="effectiveFrom" required type="date" /></label><label><span>State / UT</span><input defaultValue={workspace.policy.jurisdictionState} name="jurisdictionState" required /></label><input name="timeZone" type="hidden" value="Asia/Kolkata" /><label><span>Working week (Mon–Sun)</span><input defaultValue={workspace.policy.workingWeekMask} maxLength={7} name="workingWeekMask" required /></label><label><span>Standard start</span><input defaultValue={workspace.policy.standardStartTime} name="standardStartTime" required type="time" /></label><label><span>Standard end</span><input defaultValue={workspace.policy.standardEndTime} name="standardEndTime" required type="time" /></label><label><span>Late grace (minutes)</span><input defaultValue={workspace.policy.lateGraceMinutes} min={0} name="lateGraceMinutes" required type="number" /></label><label><span>Full day (minutes)</span><input defaultValue={workspace.policy.fullDayMinutes} min={60} name="fullDayMinutes" required type="number" /></label><label><span>Half day (minutes)</span><input defaultValue={workspace.policy.halfDayMinutes} min={30} name="halfDayMinutes" required type="number" /></label><button className="secondary-button" disabled={policyPending} type="submit">{policyPending ? "Saving..." : "Create policy version"}</button>{policyState.error && <p role="alert">{policyState.error}</p>}</form>
    <p className="attendance-setup-link">Leave types, holidays and shifts live in <Link href="/settings/attendance">Settings → Attendance Masters</Link>.</p></section>;
}

/** Half-days are how attendance counts; days are how people talk. */
const asDays = (halfDays: number) => {
  const days = halfDays / 2;
  return Number.isInteger(days) ? String(days) : days.toFixed(1);
};

/**
 * What the employee has left, before they ask for more.
 *
 * The quota was collected in the leave masters and enforced nowhere, so leave
 * was approved without anyone seeing the number. A balance that only appears in
 * a refusal is a balance nobody can plan against.
 */
function LeaveBalancePanel({ balances }: { balances: AttendanceWorkspaceData["leaveBalances"] }) {
  if (balances.length === 0) return null;
  return (
    <section className="attendance-balance-panel surface-card">
      <div className="panel-heading">
        <div><p className="eyebrow">ENTITLEMENT</p><h2>Leave balance</h2><span>{balances[0]!.leaveYear}</span></div>
        <Wallet aria-hidden="true" />
      </div>
      <ul className="attendance-balance-list">
        {balances.map((balance) => (
          <li className={balance.balanceHalfDays < 0 ? "is-negative" : balance.capped && !balance.grantedOnRequest && balance.balanceHalfDays === 0 ? "is-spent" : undefined} key={balance.code}>
            <span>
              <strong>{balance.name}</strong>
              <small>
                {!balance.capped ? "Not capped by the firm"
                  : balance.grantedOnRequest && balance.balanceHalfDays === 0 ? "Sanctioned when the occasion arises"
                    : `${asDays(balance.accruedHalfDays + balance.carriedHalfDays)} entitled · ${asDays(balance.takenHalfDays)} taken${balance.carriedHalfDays > 0 ? ` · ${asDays(balance.carriedHalfDays)} carried` : ""}`}
              </small>
            </span>
            <span className="attendance-balance-figure">
              <strong>{!balance.capped ? "—" : balance.grantedOnRequest && balance.balanceHalfDays === 0 ? "—" : asDays(balance.balanceHalfDays)}</strong>
              <small>{!balance.capped ? "no limit" : balance.grantedOnRequest && balance.balanceHalfDays === 0 ? "on request" : "left"}</small>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** My own month and my own requests — the only view every employee has. */
function MyAttendance({ workspace }: { workspace: AttendanceWorkspaceData }) {
  return <section className="attendance-main-grid">
    <div className="attendance-register surface-card"><div className="panel-heading"><div><p className="eyebrow">MONTHLY ATTENDANCE</p><h2>Your register</h2><span>Your daily record for {workspace.periodKey}</span></div><CalendarCheck aria-hidden="true" /></div><div className="attendance-calendar">{workspace.selfDays.map((day) => <article className="attendance-mobile-card" key={day.id}><span>{day.attendanceDate.slice(-2)}</span><div><strong>{statusLabel(day.status)}</strong><small>{timeLabel(day.firstCheckIn)}–{timeLabel(day.lastCheckOut)}</small></div><StatusBadge tone={statusTone(day.status)}>{statusLabel(day.status)}</StatusBadge></article>)}{!workspace.selfDays.length && <EmptyState description="Check in, or ask your manager to prepare the month, to begin your register." icon="attendance" title="No attendance recorded yet" />}</div></div>
    <aside className="attendance-side-stack"><LeaveBalancePanel balances={workspace.leaveBalances} /><section className="attendance-requests surface-card"><div className="panel-heading"><div><p className="eyebrow">YOUR REQUESTS</p><h2>Request history</h2></div></div>{workspace.selfRequests.map((request) => <article key={request.id}><div><strong>{request.kind === "leave" ? "Leave" : "Correction"} · {request.dateLabel}</strong><span>{request.detail} · {request.reason}</span></div><StatusBadge tone={request.status === "approved" ? "mint" : request.status === "rejected" ? "red" : "amber"}>{request.status}</StatusBadge></article>)}{!workspace.selfRequests.length && <EmptyState description="Leave and correction requests you raise appear here with their decision history." icon="waiting" title="No requests yet" />}</section></aside>
  </section>;
}

/**
 * One pending request, with the entitlement it would spend.
 *
 * A reviewer may still approve leave the employee has not earned — firms grant
 * exceptions and always will — but the reason becomes part of the record rather
 * than a conversation nobody can find later.
 */
function ApprovalRow({ request }: { request: AttendanceWorkspaceData["approvals"][number] }) {
  const quota = request.quota;
  const exceeds = Boolean(quota && quota.exceedsByHalfDays > 0);
  return (
    <article>
      <UserCheck aria-hidden="true" />
      <div>
        <strong>{request.employeeName}</strong>
        <span>{request.kind} · {request.dateLabel} · {request.detail}</span>
        <small>{request.reason}</small>
        {quota && !quota.uncapped && (
          <small className={exceeds ? "attendance-quota-note is-over" : "attendance-quota-note"}>
            {exceeds
              ? `Costs ${asDays(quota.costHalfDays)}d · ${asDays(quota.remainingHalfDays)}d left · exceeds by ${asDays(quota.exceedsByHalfDays)}d`
              : `Costs ${asDays(quota.costHalfDays)}d · ${asDays(quota.remainingHalfDays)}d left`}
          </small>
        )}
      </div>
      <form action={decideAttendanceRequestAction}>
        <input name="requestId" type="hidden" value={request.id} />
        <input name="kind" type="hidden" value={request.kind} />
        <input name="decisionNote" type="hidden" value="Reviewed in attendance queue" />
        {exceeds && (
          <input
            aria-label={`Reason for approving ${request.employeeName} beyond entitlement`}
            className="attendance-quota-reason"
            maxLength={500}
            minLength={3}
            name="quotaExceptionReason"
            placeholder="Why approve beyond entitlement?"
            required
            type="text"
          />
        )}
        <button className="secondary-button" formNoValidate name="decision" type="submit" value="rejected">Reject</button>
        <button className="primary-button" name="decision" type="submit" value="approved">Approve</button>
      </form>
    </article>
  );
}

function ApprovalQueue({ workspace }: { workspace: AttendanceWorkspaceData }) {
  return <>
    <section className="attendance-approval-panel surface-card"><div className="panel-heading"><div><p className="eyebrow">REVIEW QUEUE</p><h2>Approval queue</h2><span>{workspace.approvals.length} pending requests</span></div><ShieldCheck aria-hidden="true" /></div><div className="attendance-approval-list">{workspace.approvals.map((request) => <ApprovalRow key={`${request.kind}-${request.id}`} request={request} />)}{!workspace.approvals.length && <EmptyState description="Nothing is waiting on your review right now." icon="review" title="Approval queue is clear" />}</div></section>
    <section className="attendance-team-panel surface-card"><div className="panel-heading"><div><p className="eyebrow">TEAM ATTENDANCE</p><h2>Exceptions by employee</h2><span>Reportee-scoped summary for {workspace.periodKey}</span></div><Clock3 aria-hidden="true" /></div><div className="attendance-team-list">{workspace.team.map((employee) => <article key={employee.userId}><div><strong>{employee.fullName}</strong><span>{employee.employeeCode} · {employee.designation}{employee.membershipStatus !== "active" ? ` · Former employee${employee.employmentEndDate ? ` · ended ${employee.employmentEndDate}` : ""}` : ""}</span></div><span><strong>{employee.presentDays}</strong><small>present</small></span><span className={employee.exceptionCount ? "text-danger" : ""}><strong>{employee.exceptionCount}</strong><small>exceptions</small></span></article>)}{!workspace.team.length && <EmptyState description="Employees with a reporting line to you appear here." icon="team" title="No reportees yet" />}</div></section>
  </>;
}

export function AttendanceWorkspace({ canManage, canReview, workspace }: { canManage: boolean; canReview: boolean; workspace: AttendanceWorkspaceData }) {
  /*
   * One view per audience. Previously an employee scrolled past the firm's
   * whole register and two configuration forms to reach their own record, and
   * attendance could be recorded in two different places.
   */
  const tabs: WorkspaceTab[] = [
    { content: <div className="attendance-today-grid"><AttendanceClock workspace={workspace} />{canManage && <PeriodControl workspace={workspace} />}</div>, id: "today", label: "Today" },
    ...(canManage ? [{ content: <AttendanceMatrixGrid periodKey={workspace.periodKey} />, id: "register", label: "Month register" }] : []),
    { content: <MyAttendance workspace={workspace} />, id: "mine", label: "My attendance" },
    ...(canReview ? [{ badge: workspace.approvals.length, content: <ApprovalQueue workspace={workspace} />, id: "approvals", label: "Approvals" }] : []),
    ...(canManage ? [{ content: <AttendanceSettings workspace={workspace} />, id: "setup", label: "Setup" }] : []),
  ];

  return <div className="attendance-workspace">
    <PageTitle
      actions={<div className="attendance-title-actions"><nav aria-label="Attendance month" className="attendance-month-nav"><Link aria-label="Previous month" href={`/?workspace=attendance&attendancePeriod=${shiftPeriod(workspace.periodKey, -1)}`}>&larr;</Link><strong>{workspace.periodKey}</strong><Link aria-label="Next month" href={`/?workspace=attendance&attendancePeriod=${shiftPeriod(workspace.periodKey, 1)}`}>&rarr;</Link><Link href="/?workspace=attendance">Current</Link></nav><AttendanceRequestDialogButton initialMode="correction" variant="secondary">Request correction</AttendanceRequestDialogButton><AttendanceRequestDialogButton initialMode="leave">Request leave</AttendanceRequestDialogButton></div>}
      description="Clock your day, mark the firm's register, and close an auditable month for payroll."
      eyebrow="PEOPLE OPERATIONS"
      title="Attendance"
    />
    <section aria-label="Attendance metrics" className="attendance-kpi-grid kpi-grid"><KpiCard icon="review" label="PRESENT" note="Current month" tone="mint" value={String(workspace.metrics.present).padStart(2, "0")} /><KpiCard icon="clock" label="LATE" note="After configured grace" tone="amber" value={String(workspace.metrics.late).padStart(2, "0")} /><KpiCard icon="calendar" label="ON LEAVE" note="Approved leave days" tone="blue" value={String(workspace.metrics.leave).padStart(2, "0")} /><KpiCard icon="alert" label="MISSING PUNCH" note="Needs correction" tone="red" value={String(workspace.metrics.missingPunch).padStart(2, "0")} /></section>
    {/* Marking the register is the job someone with manage rights came to do. */}
    <WorkspaceTabs ariaLabel="Attendance views" defaultTab={canManage ? "register" : "today"} tabs={tabs} />
  </div>;
}
