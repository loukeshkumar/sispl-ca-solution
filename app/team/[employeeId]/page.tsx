import Link from "next/link";
import type { CSSProperties } from "react";
import { notFound } from "next/navigation";

import { hasPermission, type Role } from "../../../lib/auth/authorization";
import { requirePermission } from "../../../lib/auth/server";
import { EmployeeDialogButton } from "../../dashboard/employee-dialog";
import { initials } from "../../../lib/dashboard/mapper";
import { CAPABILITY_LABELS } from "../../../lib/team/capability";
import { getDatabase } from "../../../lib/dashboard/postgres/pool";
import { getAttendanceWorkspace } from "../../../lib/attendance/repository";
import { formatPaise } from "../../../lib/payroll/money";
import { getSalaryStructureEditorData } from "../../../lib/payroll/repository";
import { getEmployee360 } from "../../../lib/team/repository";
import { taskStatusLabel } from "../../../lib/tasks/validation";
import { EmptyState, StatusBadge } from "../../dashboard/dashboard-ui";
import { ActivityTimeline } from "./activity-timeline";
import { ProvisionAccess } from "./employee-actions";
import { EmploymentPanel } from "./employment-panel";
import { getActiveBankAccount } from "../../../lib/payroll/bank-accounts";
import { loadOptionalPanel } from "../../../lib/dashboard/optional-panel";
import BankAccountPanel from "../bank-account-panel";
import { CapabilityPanel } from "../capability-panel";
import { listCapabilityServices, listEmployeeCapabilities } from "../../../lib/team/capability-repository";
import { probationOverdue } from "../../../lib/team/offboarding";
import { trainingEvidenceFor } from "../../../lib/training/repository";
import { buildExitClearance } from "../../../lib/team/offboarding-repository";
import { indiaDateKey } from "../../../lib/attendance/calculations";
import { findReportingManager, listEmployeeActivity } from "../../../lib/team/repository";
import { listLeaveBalances } from "../../../lib/attendance/leave-ledger-repository";
import { listFirmUtilisation } from "../../../lib/rates/utilisation-repository";
import { getEmployeeCompliance } from "../../../lib/registers/repository";
import { listTrainingWorkspace } from "../../../lib/training/repository";

export const dynamic = "force-dynamic";

const formatDate = (value: string) => new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
const hours = (minutes: number) => `${Math.round(minutes / 6) / 10}h`;
/** The leave ledger counts half-days; people talk in days. */
const halfDays = (value: number) => (Number.isInteger(value / 2) ? String(value / 2) : (value / 2).toFixed(1));
const statusTone = (status: string) => ({ todo: "blue", in_progress: "blue", waiting: "amber", review: "mint", completed: "mint", cancelled: "red" })[status] ?? "blue";

export default async function Employee360Page({ params, searchParams }: { params: Promise<{ employeeId: string }>; searchParams: Promise<{ disableError?: string }> }) {
  const { employeeId } = await params;
  const session = await requirePermission("team:read", `/team/${employeeId}`);
  const database = getDatabase();
  const employee = await getEmployee360(database, session.tenantId, employeeId);
  if (!employee) notFound();
  const canManage = hasPermission(session, "team:manage");
  const canReviewAttendance = hasPermission(session, "attendance:review");
  const canManageSalary = hasPermission(session, "salary:manage");
  const canReviewTime = hasPermission(session, "timesheets:manage");
  const [attendanceWorkspace, salaryData, bankAccount, capabilities, capabilityServices, trainingEvidence, clearance, activity, leaveBalances, firmUtilisation, compliance, training, manager] = await Promise.all([
    canReviewAttendance ? getAttendanceWorkspace(database, session.tenantId, session.userId, session.roleKey as Role).catch(() => null) : Promise.resolve(null),
    canManageSalary ? getSalaryStructureEditorData(database, session.tenantId, session.userId, employee.userId) : Promise.resolve(null),
    canManageSalary ? loadOptionalPanel("bank-account", () => getActiveBankAccount(database, session.tenantId, employee.userId), null) : Promise.resolve(null),
    listEmployeeCapabilities(database, session.tenantId, employee.userId),
    listCapabilityServices(database, session.tenantId),
    trainingEvidenceFor(database, session.tenantId, employee.userId).catch(() => new Map()),
    // Worked out on every read rather than stored: a checklist that can be ticked
    // without being true is worse than no checklist at all.
    employee.status === "active"
      ? buildExitClearance(database, session.tenantId, employee.userId, indiaDateKey()).catch(() => null)
      : Promise.resolve(null),
    listEmployeeActivity(database, session.tenantId, employee.id).catch(() => []),
    // Somebody's entitlement is theirs; only a reviewer of attendance sees it.
    canReviewAttendance
      ? listLeaveBalances(database, session.tenantId, employee.userId, indiaDateKey()).catch(() => [])
      : Promise.resolve([]),
    // Computed for the firm and read for one person: the same arithmetic the
    // utilisation settings page reports, rather than a second implementation.
    canReviewTime
      ? listFirmUtilisation(database, session.tenantId, indiaDateKey().slice(0, 7)).catch(() => null)
      : Promise.resolve(null),
    getEmployeeCompliance(database, session.tenantId, employee.userId)
      .catch(() => ({ dscHeld: [], udinCount: 0, udinLatest: null, udinRevoked: 0 })),
    listTrainingWorkspace(database, session.tenantId, indiaDateKey()).catch(() => null),
    findReportingManager(database, session.tenantId, employee.userId).catch(() => null),
  ]);
  const attendanceSummary = attendanceWorkspace?.team.find((member) => member.userId === employee.userId) ?? null;
  const monthlyGrossPaise = salaryData?.current?.lines.filter((line) => line.kind === "earning").reduce((sum, line) => sum + line.monthlyAmountPaise, 0) ?? null;
  const personUtilisation = firmUtilisation?.people.find((row) => row.employeeUserId === employee.userId) ?? null;
  const personStanding = training?.members.find((row) => row.employeeUserId === employee.userId) ?? null;
  const disableError = (await searchParams).disableError;
  const todayKey = indiaDateKey();
  // Months rather than a date difference: "1y 4m" answers the question a date
  // makes the reader work out.
  const tenureMonths = Math.max(0, Math.round(
    (Date.parse(`${employee.employmentEndDate ?? todayKey}T00:00:00Z`) - Date.parse(`${employee.joiningDate}T00:00:00Z`))
    / (1000 * 60 * 60 * 24 * 30.44),
  ));
  const tenure = tenureMonths < 12
    ? `${tenureMonths} month${tenureMonths === 1 ? "" : "s"}`
    : `${Math.floor(tenureMonths / 12)}y ${tenureMonths % 12}m`;

  const overdue = employee.tasks.filter((task) => task.dueDate < todayKey && task.status !== "completed" && task.status !== "cancelled");
  const openTasks = [...employee.tasks]
    .filter((task) => task.status !== "completed" && task.status !== "cancelled")
    .sort((left, right) => left.dueDate.localeCompare(right.dueDate));
  const expiredDevices = compliance.dscHeld.filter((item) => item.validUntil <= todayKey);
  const cpe = personStanding?.standing ?? null;

  return (
    <main className="employee-360-shell">
      <Link className="client-360-back" href="/?workspace=team">&larr; Back to Employees</Link>

      <section className="emp-hero">
        <div className="emp-hero-top">
          <span aria-hidden="true" className="emp-avatar">{initials(employee.fullName)}</span>
          <div className="emp-id">
            <p className="eyebrow">EMPLOYEE 360</p>
            <h1>{employee.fullName}</h1>
            <div className="emp-chips">
              <span className="emp-chip is-role">{employee.roleName}</span>
              <span className="emp-chip">{employee.designation}</span>
              <span className="emp-chip">{employee.employeeCode}</span>
              <span className={`emp-chip ${employee.status === "active" ? "is-live" : "is-off"}`}>
                {employee.status !== "active"
                  ? "Disabled"
                  : employee.mustChangePassword
                    ? "Active · password change due"
                    : employee.loginEnabled ? "Active · signs in" : "Active · no login"}
              </span>
            </div>
          </div>
          {canManage && employee.accessClass !== "super_admin" && employee.status === "active" && (
            <div className="emp-actions">
              <EmployeeDialogButton
                employeeId={employee.id}
                initial={{ ...employee, roleDefinitionId: employee.roleDefinitionId ?? undefined }}
                title={`Edit ${employee.fullName}`}
                variant="secondary"
              >
                Edit employee
              </EmployeeDialogButton>
            </div>
          )}
        </div>

        <dl className="emp-facts">
          <div><dt>Joined</dt><dd>{formatDate(employee.joiningDate)}</dd></div>
          <div><dt>Tenure</dt><dd>{tenure}</dd></div>
          <div><dt>Reports to</dt><dd>{manager?.fullName ?? "Not set"}</dd></div>
          <div><dt>Open work</dt><dd>{openTasks.length} task{openTasks.length === 1 ? "" : "s"}{overdue.length ? ` · ${overdue.length} overdue` : ""}</dd></div>
          <div><dt>Email</dt><dd>{employee.email}</dd></div>
          <div><dt>Mobile</dt><dd>{employee.mobileNumber || "Not recorded"}</dd></div>
        </dl>
      </section>

      {disableError === "active-tasks" && <p className="client-form-banner" role="alert">Reassign or close this employee&apos;s active tasks before disabling access.</p>}
      {disableError === "failed" && <p className="client-form-banner" role="alert">The employee could not be disabled. Review their account and try again.</p>}

      <section className="emp-bento">
        {canReviewTime && (
          <article className="emp-card span-7">
            <div className="emp-card-head">
              <h2>Utilisation · {indiaDateKey().slice(0, 7)}</h2>
              <Link href="/?workspace=timesheets">Timesheets</Link>
            </div>
            {!personUtilisation || personUtilisation.utilisationBps === null ? (
              <EmptyState description="Utilisation appears once this employee has scheduled time this month." icon="clock" title="Nothing measured yet" />
            ) : (
              <div className="emp-ring-row">
                <span
                  aria-hidden="true"
                  className="emp-ring"
                  style={{
                    "--ring-colour": personUtilisation.band === "under" ? "var(--red)" : personUtilisation.band === "over" ? "var(--blue)" : "var(--mint)",
                    "--ring-value": Math.min(100, personUtilisation.utilisationBps / 100),
                  } as CSSProperties}
                >
                  <b>{(personUtilisation.utilisationBps / 100).toFixed(1)}%</b>
                </span>
                <div className="emp-ring-legend">
                  <p>
                    {personUtilisation.varianceBps === null || personUtilisation.targetBasisPoints === null
                      ? "No target applies to this person yet."
                      : <>
                        <strong>
                          {Math.abs(personUtilisation.varianceBps / 100).toFixed(1)} points{" "}
                          {personUtilisation.varianceBps < 0 ? "under" : "over"}
                        </strong>{" "}
                        a {(personUtilisation.targetBasisPoints / 100).toFixed(0)}% target
                        {personUtilisation.targetSource === "employee" ? " set for them." : " inherited from their role."}
                      </>}
                  </p>
                  <div className="emp-mini">
                    <div><span>Chargeable</span><strong>{hours(personUtilisation.chargeableMinutes)}</strong></div>
                    <div><span>Available</span><strong>{hours(personUtilisation.availableMinutes)}</strong></div>
                    <div><span>Timesheet</span><strong>{personUtilisation.recordingBps === null ? "—" : `${(personUtilisation.recordingBps / 100).toFixed(0)}% filled`}</strong></div>
                    <div><span>Unrecorded</span><strong className={personUtilisation.missingMinutes > 0 ? "is-attention" : ""}>{hours(personUtilisation.missingMinutes)}</strong></div>
                  </div>
                </div>
              </div>
            )}
          </article>
        )}

        {canReviewAttendance && (
          <article className="emp-card span-5">
            <div className="emp-card-head">
              <h2>Leave left</h2>
              <Link href="/?workspace=attendance">
                {attendanceSummary ? `${attendanceSummary.presentDays} present · ${attendanceSummary.exceptionCount} exceptions` : "Attendance"}
              </Link>
            </div>
            {leaveBalances.length === 0 ? (
              <EmptyState description="Entitlement appears once the firm has active leave types." icon="calendar" title="Nothing recorded" />
            ) : (
              <div className="emp-leave">
                {leaveBalances.slice(0, 4).map((balance) => {
                  const entitled = balance.accruedHalfDays + balance.carriedHalfDays;
                  const measurable = balance.capped && !balance.grantedOnRequest && entitled > 0;
                  return (
                    <div className={`emp-leave-row${measurable && balance.balanceHalfDays <= 0 ? " is-out" : ""}`} key={balance.code}>
                      <span>
                        <strong>{balance.name}</strong>
                        <br />
                        <small>
                          {measurable
                            ? `${halfDays(balance.takenHalfDays)} of ${halfDays(entitled)} taken`
                            : balance.grantedOnRequest ? "Sanctioned per occasion" : "No annual limit"}
                        </small>
                      </span>
                      <b>{halfDays(balance.balanceHalfDays)}</b>
                      {measurable && (
                        <span aria-hidden="true" className="emp-leave-bar">
                          <i style={{ width: `${Math.min(100, (balance.takenHalfDays / entitled) * 100)}%` }} />
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </article>
        )}

        <article className="emp-card span-8">
          <div className="emp-card-head"><h2>Assigned work</h2><span>{employee.tasks.length} on file</span></div>
          {openTasks.length === 0 ? (
            <EmptyState description="Delivery work assigned to this employee appears here." icon="work" title="No open work" />
          ) : (
            <div className="emp-tasks">
              {openTasks.slice(0, 6).map((task) => {
                const late = task.dueDate < todayKey;
                return (
                  <Link className={late ? "is-late" : ""} href={`/tasks/${task.id}`} key={task.id}>
                    <i aria-hidden="true" />
                    <span>
                      <strong>{task.title}</strong>
                      <small>{task.priority} priority · due {formatDate(task.dueDate)}</small>
                    </span>
                    <StatusBadge tone={late ? "red" : statusTone(task.status)}>
                      {late ? "Overdue" : taskStatusLabel(task.status)}
                    </StatusBadge>
                  </Link>
                );
              })}
            </div>
          )}
        </article>

        <article className="emp-card span-4">
          <div className="emp-card-head"><h2>Statutory</h2><Link href="/?workspace=registers">Registers</Link></div>
          <div className="emp-mini">
            <div><span>Devices held</span><strong className={compliance.dscHeld.length ? "is-attention" : ""}>{compliance.dscHeld.length}</strong></div>
            <div><span>UDINs signed</span><strong>{compliance.udinCount}</strong></div>
            <div><span>Revoked</span><strong className={compliance.udinRevoked ? "is-attention" : ""}>{compliance.udinRevoked}</strong></div>
            <div>
              <span>CPE block</span>
              <strong className={cpe && !cpe.block.compliant ? "is-attention" : ""}>
                {cpe ? `${hours(cpe.block.totalMinutes)} / ${hours(cpe.block.totalRequiredMinutes)}` : "—"}
              </strong>
            </div>
          </div>
          {expiredDevices.length > 0 && (
            <p className="emp-alert">
              {expiredDevices.length} signing device{expiredDevices.length === 1 ? "" : "s"} expired, still in their custody.
            </p>
          )}
        </article>

        <article className="emp-card span-5">
          <div className="emp-card-head"><h2>Capability</h2><span>{capabilities.length} recorded</span></div>
          {capabilities.length === 0 ? (
            <EmptyState description="Assessed capability decides who may be given a service and who may sign it." icon="review" title="Nothing assessed" />
          ) : (
            <div className="emp-caps">
              {capabilities.map((capability) => (
                <span
                  className={capability.level === "sign" ? "is-sign" : capability.level === "review" ? "is-review" : ""}
                  key={capability.serviceCode}
                >
                  {capability.serviceName} · {CAPABILITY_LABELS[capability.level]}
                </span>
              ))}
            </div>
          )}
        </article>

        <article className="emp-card span-7">
          <div className="emp-card-head"><h2>Recent history</h2><span>{activity.length} event{activity.length === 1 ? "" : "s"}</span></div>
          <ActivityTimeline entries={activity.slice(0, 4)} />
        </article>

        <article className="emp-card span-12">
          <EmploymentPanel
            canManage={canManage && employee.accessClass !== "super_admin"}
            clearance={clearance}
            employee={{
              confirmedOn: employee.confirmedOn,
              employmentEndDate: employee.employmentEndDate,
              employmentStage: employee.employmentStage,
              exitReason: employee.exitReason,
              id: employee.id,
              joiningDate: employee.joiningDate,
              name: employee.fullName,
              noticeStartDate: employee.noticeStartDate,
              probationEndDate: employee.probationEndDate,
            }}
            probationDue={probationOverdue(employee.employmentStage, employee.probationEndDate, todayKey)}
            todayKey={todayKey}
          />
        </article>

        <article className="emp-card span-7">
          <CapabilityPanel
            canManage={canManage}
            capabilities={capabilities}
            employeeUserId={employee.userId}
            evidence={Object.fromEntries(trainingEvidence)}
            isSelf={employee.userId === session.userId}
            services={capabilityServices}
          />
        </article>

        <article className="emp-card span-5">
          <div className="emp-card-head"><h2>Account access</h2></div>
          <p style={{ color: "var(--muted)", fontSize: "var(--type-supporting)", margin: 0 }}>
            {employee.mustChangePassword
              ? "A temporary password is active. The employee must create a permanent password at first login."
              : employee.loginEnabled
                ? "The employee has completed account setup."
                : "Provision login access when this employee is ready to use the workspace."}
          </p>
          {canManage && employee.accessClass !== "super_admin" && employee.status === "active" && (
            <ProvisionAccess employeeId={employee.id} />
          )}
          {canManageSalary && (
            <div className="emp-mini">
              <div><span>Monthly gross</span><strong>{monthlyGrossPaise === null ? "—" : formatPaise(monthlyGrossPaise)}</strong></div>
              <div><span>Structure</span><strong>{salaryData?.current ? `${salaryData.current.lines.length} lines` : "Not set"}</strong></div>
            </div>
          )}
          {canManageSalary && (
            <Link className="emp-card-head" href={`/salary/structures/${employee.userId}`}>
              <span>{salaryData?.current ? "Create new salary version" : "Configure salary"}</span>
            </Link>
          )}
        </article>

        {canManageSalary && (
          <article className="emp-card span-12">
            <BankAccountPanel account={bankAccount} canManage employeeId={employee.id} employeeUserId={employee.userId} />
          </article>
        )}

        {employee.notes && (
          <article className="emp-card span-12">
            <div className="emp-card-head"><h2>Internal notes</h2></div>
            <p style={{ fontSize: "var(--type-supporting)", margin: 0 }}>{employee.notes}</p>
          </article>
        )}
      </section>
    </main>
  );
}
