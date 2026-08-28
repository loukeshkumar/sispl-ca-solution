import Link from "next/link";
import { notFound } from "next/navigation";

import { accessClassLabel, hasPermission, type Role } from "../../../lib/auth/authorization";
import { requirePermission } from "../../../lib/auth/server";
import { EmployeeDialogButton } from "../../dashboard/employee-dialog";
import { initials } from "../../../lib/dashboard/mapper";
import { getDatabase } from "../../../lib/dashboard/postgres/pool";
import { getAttendanceWorkspace } from "../../../lib/attendance/repository";
import { formatPaise } from "../../../lib/payroll/money";
import { getSalaryStructureEditorData } from "../../../lib/payroll/repository";
import { getEmployee360 } from "../../../lib/team/repository";
import { taskStatusLabel } from "../../../lib/tasks/validation";
import { EmptyState, InitialsAvatar, KpiCard, StatusBadge } from "../../dashboard/dashboard-ui";
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
import { listEmployeeActivity } from "../../../lib/team/repository";
import { WorkspaceTabs } from "../../dashboard/workspace-tabs";
import { listLeaveBalances } from "../../../lib/attendance/leave-ledger-repository";
import { ActivityTimeline } from "./activity-timeline";
import { listFirmUtilisation } from "../../../lib/rates/utilisation-repository";
import { LeaveEntitlement } from "./leave-entitlement";
import { UtilisationPanel } from "./utilisation-panel";

export const dynamic = "force-dynamic";

const formatDate = (value: string) => new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
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
  const [attendanceWorkspace, salaryData, bankAccount, capabilities, capabilityServices, trainingEvidence, clearance, activity, leaveBalances, firmUtilisation] = await Promise.all([
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
  ]);
  const attendanceSummary = attendanceWorkspace?.team.find((member) => member.userId === employee.userId) ?? null;
  const monthlyGrossPaise = salaryData?.current?.lines.filter((line) => line.kind === "earning").reduce((sum, line) => sum + line.monthlyAmountPaise, 0) ?? null;
  const personUtilisation = firmUtilisation?.people.find((row) => row.employeeUserId === employee.userId) ?? null;
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

  return (
    <main className="employee-360-shell">
      <header className="client-360-header">
        <Link href="/?workspace=team">&larr; Back to Employees</Link>
        <div className="client-360-title-row">
          <div className="client-360-identity">
            <InitialsAvatar initials={initials(employee.fullName)} />
            <span><p className="eyebrow">EMPLOYEE 360</p><h1>Employee 360 · {employee.fullName}</h1><small>{employee.employeeCode} · {employee.designation}</small></span>
          </div>
          {canManage && employee.accessClass !== "super_admin" && employee.status === "active" && <div className="client-360-actions"><EmployeeDialogButton employeeId={employee.id} initial={{ ...employee, roleDefinitionId: employee.roleDefinitionId ?? undefined }} title={`Edit ${employee.fullName}`} variant="secondary">Edit employee</EmployeeDialogButton></div>}
        </div>
      </header>

      {disableError === "active-tasks" && <p className="client-form-banner" role="alert">Reassign or close this employee&apos;s active tasks before disabling access.</p>}
      {disableError === "failed" && <p className="client-form-banner" role="alert">The employee could not be disabled. Review their account and try again.</p>}

      <section className="kpi-grid employee-360-kpis">
        <KpiCard
          icon="work"
          label="OPEN WORK"
          note={`${employee.tasks.length} task${employee.tasks.length === 1 ? "" : "s"} on file`}
          tone={employee.overdueTaskCount ? "amber" : "blue"}
          value={String(employee.activeTaskCount).padStart(2, "0")}
        />
        <KpiCard
          icon="alert"
          label="OVERDUE"
          note="Past their due date"
          tone={employee.overdueTaskCount ? "red" : "mint"}
          value={String(employee.overdueTaskCount).padStart(2, "0")}
        />
        <KpiCard
          icon="team"
          label="TENURE"
          note={`Joined ${formatDate(employee.joiningDate)}`}
          tone="blue"
          value={tenure}
        />
        <KpiCard
          icon="settings"
          label="ACCESS"
          note={employee.mustChangePassword ? "Temporary password active" : employee.loginEnabled ? "Signs in normally" : "No login provisioned"}
          tone={employee.status !== "active" ? "red" : employee.loginEnabled ? "mint" : "amber"}
          value={employee.status !== "active" ? "Off" : employee.loginEnabled ? "On" : "None"}
        />
      </section>

      <section className="employee-360-grid">
        <article className="surface-card employee-360-main">
          <div className="employee-overview-heading"><div><p className="eyebrow">EMPLOYMENT PROFILE</p><h2>{employee.designation}</h2></div><StatusBadge tone={employee.status === "active" ? "mint" : "red"}>{employee.status === "active" ? "Active" : "Disabled"}</StatusBadge></div>
          <WorkspaceTabs
            ariaLabel="Employee views"
            tabs={[
              {
                content: (
                  <>
                    <div className="client-360-detail-grid employee-detail-grid">
                      <div><span>Employee code</span><strong>{employee.employeeCode}</strong></div>
                      <div><span>User role</span><strong>{employee.roleName}</strong><small>{accessClassLabel(employee.accessClass)}</small></div>
                      <div><span>Email</span><strong>{employee.email}</strong></div>
                      <div><span>Mobile</span><strong>{employee.mobileNumber || "Not recorded"}</strong></div>
                      <div><span>Joining date</span><strong>{formatDate(employee.joiningDate)}</strong></div>
                      <div><span>{employee.employmentEndDate ? "Employment ended" : "Open workload"}</span><strong>{employee.employmentEndDate ? formatDate(employee.employmentEndDate) : `${employee.activeTaskCount} tasks`}</strong></div>
                    </div>
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
                    {employee.notes && <section className="employee-notes"><p className="eyebrow">INTERNAL NOTES</p><p>{employee.notes}</p></section>}
                  </>
                ),
                id: "profile",
                label: "Profile",
              },
              {
                content: (
                  <CapabilityPanel
                    canManage={canManage}
                    capabilities={capabilities}
                    employeeUserId={employee.userId}
                    evidence={Object.fromEntries(trainingEvidence)}
                    isSelf={employee.userId === session.userId}
                    services={capabilityServices}
                  />
                ),
                id: "capability",
                label: "Capability",
              },
              {
                badge: employee.tasks.length,
                content: (
                  <>
                    {canReviewTime && <UtilisationPanel periodKey={indiaDateKey().slice(0, 7)} person={personUtilisation} />}
                  <section className="employee-task-register">
                    <div className="employee-overview-heading"><div><p className="eyebrow">ASSIGNED WORK</p><h2>Task register</h2></div><span>{employee.tasks.length} total</span></div>
                    <div className="employee-task-list">
                      {employee.tasks.map((task) => <Link href={`/tasks/${task.id}`} key={task.id}><span><strong>{task.title}</strong><small>{task.priority} priority · Due {formatDate(task.dueDate)}</small></span><StatusBadge tone={statusTone(task.status)}>{taskStatusLabel(task.status)}</StatusBadge></Link>)}
                      {!employee.tasks.length && <EmptyState description="Delivery work assigned to this employee appears here." icon="work" title="No tasks assigned" />}
                    </div>
                  </section>
                  </>
                ),
                id: "work",
                label: "Work",
              },
              {
                content: (
                  <>
                    {canReviewAttendance && <LeaveEntitlement balances={leaveBalances} leaveYear={leaveBalances[0]?.leaveYear ?? null} />}
                    {(attendanceSummary || canManageSalary) && <section className="employee-people-operations">
                      {attendanceSummary && <article><div><p className="eyebrow">ATTENDANCE</p><h3>Attendance overview</h3><span>Current monthly exception view</span></div><dl><div><dt>Present days</dt><dd>{attendanceSummary.presentDays}</dd></div><div><dt>Exceptions</dt><dd>{attendanceSummary.exceptionCount}</dd></div></dl><Link href="/?workspace=attendance">Open attendance</Link></article>}
                      {canManageSalary && <article><div><p className="eyebrow">CONFIDENTIAL PAYROLL</p><h3>Salary structure</h3><span>{salaryData?.current ? `Effective ${salaryData.current.effectiveFrom}` : "Not configured"}</span></div><dl><div><dt>Monthly gross</dt><dd>{monthlyGrossPaise === null ? "—" : formatPaise(monthlyGrossPaise)}</dd></div><div><dt>Components</dt><dd>{salaryData?.current?.lines.length ?? 0}</dd></div></dl><Link href={`/salary/structures/${employee.userId}`}>{salaryData?.current ? "Create new version" : "Configure salary"}</Link></article>}
                    </section>}
                    {canManageSalary && <BankAccountPanel account={bankAccount} canManage employeeId={employee.id} employeeUserId={employee.userId} />}
                  </>
                ),
                id: "people",
                label: "People ops",
              },
              {
                badge: activity.length,
                content: <ActivityTimeline entries={activity} />,
                id: "history",
                label: "History",
              },
            ]}
          />
        </article>

        <aside className="surface-card employee-access-card">
          <p className="eyebrow">ACCOUNT ACCESS</p>
          <h2>{employee.loginEnabled ? "Login enabled" : "Login not provisioned"}</h2>
          <p>{employee.mustChangePassword ? "A temporary password is active. The employee must create a permanent password at first login." : employee.loginEnabled ? "The employee has completed account setup." : "Provision login access when this employee is ready to use the workspace."}</p>
          <dl><div><dt>Account</dt><dd>{employee.status === "active" ? "Active" : "Disabled"}</dd></div><div><dt>Access</dt><dd>{employee.loginEnabled ? "Enabled" : "Not enabled"}</dd></div><div><dt>Overdue assignments</dt><dd>{employee.overdueTaskCount}</dd></div></dl>
          {canManage && employee.accessClass !== "super_admin" && employee.status === "active" && <section className="employee-provision-section"><h3>Provision login access</h3><p>Generating a password invalidates existing sessions and requires a password change.</p><ProvisionAccess employeeId={employee.id} /></section>}
        </aside>
      </section>
    </main>
  );
}
