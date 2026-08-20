import DashboardClient from "./dashboard-client";
import DashboardError from "./dashboard-error";
import { redirect } from "next/navigation";
import { requirePermission } from "../lib/auth/server";
import { hasPermission } from "../lib/auth/authorization";
import { resolveDataSource } from "../lib/dashboard/config";
import { getDashboardDataForConfiguredSource } from "../lib/dashboard/provider";
import { getDatabase } from "../lib/dashboard/postgres/pool";
import { getPostgresDashboardDataForTenant } from "../lib/dashboard/postgres/provider";
import { listDocumentWorkspace, type DocumentWorkspaceData } from "../lib/documents/repository";
import { listEmployees, type EmployeeSummary } from "../lib/team/repository";
import { listTodoWorkspace, type TodoWorkspaceData } from "../lib/todos/repository";
import { getAttendanceWorkspace, type AttendanceWorkspaceData } from "../lib/attendance/repository";
import type { Role } from "../lib/auth/authorization";
import { indiaPeriodKey } from "../lib/attendance/calculations";
import { listSalaryWorkspace, type SalaryWorkspaceData } from "../lib/payroll/repository";
import { listClientPackageWorkspace, listPackageSetupWorkspace, listServiceManagementWorkspace, type ClientPackageWorkspaceData, type PackageSetupWorkspaceData, type ServiceManagementWorkspaceData } from "../lib/packages/repository";
import { listRoleManagementWorkspace, type RoleManagementWorkspace } from "../lib/roles/repository";
import { countUnreadNotifications } from "../lib/notifications/repository";
import { listClientDocumentLibrary, type ClientDocumentLibrary } from "../lib/documents/library";
import { listBillingWorkspace, type BillingWorkspaceData } from "../lib/billing/repository";
import { listRegisterFormOptions, listRegistersWorkspace, type RegistersWorkspaceData } from "../lib/registers/repository";
import { listTimesheetFormOptions, listTimesheetWorkspace, type TimesheetWorkspaceData } from "../lib/timesheets/repository";
import { listInsightsWorkspace, type InsightsWorkspaceData } from "../lib/insights/repository";
import { indiaDateKey } from "../lib/registers/repository";
import { listWorkMembers } from "../lib/work/repository";
import { getCapacityLanes, getQueueTotals, listWorkQueue, type CapacityLane, type QueueTotals, type WorkQueueRow } from "../lib/work/queue";
import { DEFAULT_WORK_QUEUE_PARAMS, parseWorkQueueParams } from "../lib/work/queue-params";
import { canManageAllTasks, getTaskCapacityLanes, getTaskQueueTotals, listTaskQueue, type TaskCapacityLane, type TaskQueueRow, type TaskQueueTotals } from "../lib/tasks/queue";
import { DEFAULT_TASK_QUEUE_PARAMS, parseTaskQueueParams } from "../lib/tasks/queue-params";
import { DEFAULT_TODO_QUEUE_PARAMS, parseTodoQueueParams } from "../lib/todos/queue-params";
import { filterTodoQueue, getTodoLoadStrip } from "../lib/todos/repository";
import type { LoadStripDay } from "../lib/todos/recurrence";
import { listCoverageGaps, listEvidencedWorkItemIds, type CoverageGap } from "../lib/compliance/repository";
import { DEFAULT_COMPLIANCE_PARAMS, parseComplianceParams } from "../lib/compliance/queue-params";
import { DEFAULT_REGISTER_PARAMS, parseRegisterParams } from "../lib/registers/queue-params";
import { DEFAULT_DOCUMENT_PARAMS, parseDocumentParams } from "../lib/documents/queue-params";

export const dynamic = "force-dynamic";

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ attendancePeriod?: string; budget?: string; category?: string; estimate?: string; evidence?: string; filter?: string; layout?: string; owner?: string; priority?: string; q?: string; registerError?: string; saved?: string; scope?: string; service?: string; sort?: string; tab?: string; timesheetError?: string; view?: string; workspace?: string }> }) {
  const source = resolveDataSource(process.env);
  const query = await searchParams;
  const workspace = query.workspace;
  const attendancePeriod = /^\d{4}-(0[1-9]|1[0-2])$/.test(query.attendancePeriod ?? "") ? query.attendancePeriod! : indiaPeriodKey();
  const initialWorkspace = workspace === "clients" ? "Clients" : workspace === "client-documents" ? "Client Documents" : workspace === "work" ? "My work" : workspace === "todos" ? "To-do" : workspace === "attendance" ? "Attendance" : workspace === "salary" ? "Salary" : workspace === "tasks" ? "Tasks" : workspace === "compliance" ? "Compliance" : workspace === "documents" ? "Documents" : workspace === "calendar" ? "Calendar" : workspace === "team" ? "Employees" : workspace === "package-setup" ? "Package Setup" : workspace === "client-packages" ? "Client Packages" : workspace === "service-management" ? "Service Management" : workspace === "user-roles" ? "User Roles Management" : workspace === "billing" ? "Billing" : workspace === "registers" ? "Registers" : workspace === "timesheets" ? "Timesheets" : workspace === "insights" ? "Insights" : "Overview";
  let data;
  let documentWorkspace: DocumentWorkspaceData = { requests: [], documents: [] };
  let clientDocuments: ClientDocumentLibrary = { clients: [], groups: [], totalBytes: 0, totalDocuments: 0 };
  let employees: EmployeeSummary[] = [];
  let todoWorkspace: TodoWorkspaceData = { todos: [], metrics: { open: 0, overdue: 0, dueToday: 0, upcoming: 0, completed: 0 }, categories: [], todayKey: "" };
  let attendanceWorkspace: AttendanceWorkspaceData = { todayKey: "", periodKey: "", policy: { id: null, effectiveFrom: null, fullDayMinutes: 450, halfDayMinutes: 225, lateGraceMinutes: 15, standardStartTime: "09:30", standardEndTime: "18:00", workingWeekMask: "1111110", timeZone: "Asia/Kolkata", jurisdictionState: "Bihar" }, period: null, selfDays: [], selfRequests: [], approvals: [], team: [], metrics: { present: 0, absent: 0, leave: 0, late: 0, missingPunch: 0, pendingRequests: 0 } };
  let salaryWorkspace: SalaryWorkspaceData = { canManage: false, employees: [], metrics: { activeStructures: 0, draftRuns: 0, payableEmployees: 0, publishedPayslips: 0, totalNetPaise: 0 }, ownPayslips: [], periodKey: indiaPeriodKey(), runs: [] };
  let packageSetupWorkspace: PackageSetupWorkspaceData = { metrics: { activePackages: 0, activeServices: 0, archivedPackages: 0, averageFeePaise: 0 }, packages: [], services: [] };
  let clientPackageWorkspace: ClientPackageWorkspaceData = { assignments: [], clients: [], metrics: { activeAssignments: 0, monthlyRecurringPaise: 0, renewalsDue: 0, unassignedClients: 0 }, packages: [], services: [], todayKey: "" };
  let serviceManagementWorkspace: ServiceManagementWorkspaceData = { metrics: { activeServices: 0, archivedServices: 0, categories: 0, packageLinks: 0 }, services: [] };
  let roleManagementWorkspace: RoleManagementWorkspace = { roles: [], superAdmins: [], metrics: { activeAdmins: 0, employeeCategories: 0, protectedPermissions: 0, totalAssigned: 0 } };
  let unreadNotifications = 0;
  let billingWorkspace: BillingWorkspaceData = { invoices: [], metrics: { draftCount: 0, outstandingPaise: 0, overdueCount: 0, overduePaise: 0, collectedThisMonthPaise: 0 }, todayKey: "" };
  let registersWorkspace: RegistersWorkspaceData = { udins: [], certificates: [], notices: [], metrics: { activeUdins: 0, expiringCertificates: 0, expiredCertificates: 0, openNotices: 0, overdueNotices: 0 }, todayKey: "" };
  let registerOptions: Awaited<ReturnType<typeof listRegisterFormOptions>> = { clients: [], members: [], work: [] };
  let timesheetWorkspace: TimesheetWorkspaceData = { canManage: false, periodKey: "", entries: [], engagements: [], metrics: { ownMinutes: 0, ownBillableMinutes: 0, firmMinutes: 0, firmBillableMinutes: 0, entryCount: 0 }, todayKey: "" };
  let timesheetOptions: Awaited<ReturnType<typeof listTimesheetFormOptions>> = { clients: [], work: [], tasks: [] };
  let insightsWorkspace: InsightsWorkspaceData = { signals: [], counts: { critical: 0, warning: 0, info: 0 }, todayKey: "" };
  const workQueueParams = parseWorkQueueParams(query as Record<string, string | undefined>);
  const wantsWorkQueue = initialWorkspace === "My work";
  let workQueueRows: WorkQueueRow[] = [];
  let workQueueTotals: QueueTotals = { active: 0, overdue: 0, review: 0, waiting: 0 };
  let workQueueLanes: CapacityLane[] = [];
  let workQueueMembers: Awaited<ReturnType<typeof listWorkMembers>> = [];
  const taskQueueParams = parseTaskQueueParams(query as Record<string, string | undefined>);
  const wantsTaskQueue = initialWorkspace === "Tasks";
  let taskQueueRows: TaskQueueRow[] = [];
  let taskQueueTotals: TaskQueueTotals = { dueToday: 0, overdue: 0, review: 0, waiting: 0 };
  let taskQueueLanes: TaskCapacityLane[] = [];
  let taskQueueMembers: Awaited<ReturnType<typeof listWorkMembers>> = [];
  const todoQueueParams = parseTodoQueueParams(query as Record<string, string | undefined>);
  let todoLoadStrip: LoadStripDay[] = [];
  const complianceParams = parseComplianceParams(query as Record<string, string | undefined>);
  const wantsCompliance = initialWorkspace === "Compliance";
  let complianceRows: WorkQueueRow[] = [];
  let complianceGaps: CoverageGap[] = [];
  let complianceEvidenced: string[] = [];
  const registerParams = parseRegisterParams(query as Record<string, string | undefined>);
  const documentParams = parseDocumentParams(query as Record<string, string | undefined>);

  if (source === "postgres") {
    const session = await requirePermission("dashboard:read");
    const canReadDocuments = hasPermission(session, "documents:read");
    const wantsClientDocuments = workspace === "client-documents";
    const canReadTasks = hasPermission(session, "tasks:read");
    const canReadTeam = hasPermission(session, "team:read");
    const canReadPackages = hasPermission(session, "packages:read");
    const canManageClientPackages = hasPermission(session, "client_packages:manage");
    const canReadServices = hasPermission(session, "services:read");
    const canReadRoles = hasPermission(session, "roles:read");
    const canReadBilling = hasPermission(session, "billing:read");
    const canReadRegisters = hasPermission(session, "registers:read");
    const canUseTimesheets = hasPermission(session, "timesheets:use");
    if (initialWorkspace === "Billing" && !canReadBilling) redirect("/forbidden");
    if (initialWorkspace === "Registers" && !canReadRegisters) redirect("/forbidden");
    if (initialWorkspace === "Timesheets" && !canUseTimesheets) redirect("/forbidden");
    if ((initialWorkspace === "Documents" || initialWorkspace === "Client Documents") && !canReadDocuments) {
      redirect("/forbidden");
    }
    if ((initialWorkspace === "Tasks" && !canReadTasks) || (initialWorkspace === "Employees" && !canReadTeam)) redirect("/forbidden");
    if ((initialWorkspace === "Package Setup" && !canReadPackages) || (initialWorkspace === "Client Packages" && !canManageClientPackages)) redirect("/forbidden");
    if (initialWorkspace === "Service Management" && !canReadServices) redirect("/forbidden");
    if (initialWorkspace === "User Roles Management" && !canReadRoles) redirect("/forbidden");
    try {
      const todayKey = indiaDateKey();
      [data, documentWorkspace, employees, todoWorkspace, attendanceWorkspace, salaryWorkspace, packageSetupWorkspace, clientPackageWorkspace, serviceManagementWorkspace, roleManagementWorkspace, unreadNotifications, billingWorkspace, registersWorkspace, registerOptions, timesheetWorkspace, timesheetOptions, insightsWorkspace, clientDocuments, workQueueRows, workQueueTotals, workQueueLanes, workQueueMembers, taskQueueRows, taskQueueTotals, taskQueueLanes, taskQueueMembers, todoLoadStrip, complianceRows, complianceGaps, complianceEvidenced] = await Promise.all([
        getPostgresDashboardDataForTenant(session.tenantId),
        canReadDocuments ? listDocumentWorkspace(getDatabase(), session.tenantId) : Promise.resolve(documentWorkspace),
        canReadTeam ? listEmployees(getDatabase(), session.tenantId) : Promise.resolve(employees),
        listTodoWorkspace(getDatabase(), session.tenantId, session.userId),
        initialWorkspace === "Attendance" ? getAttendanceWorkspace(getDatabase(), session.tenantId, session.userId, session.roleKey as Role, attendancePeriod) : Promise.resolve(attendanceWorkspace),
        initialWorkspace === "Salary" ? listSalaryWorkspace(getDatabase(), session.tenantId, session.userId, session.roleKey as Role, indiaPeriodKey()) : Promise.resolve(salaryWorkspace),
        initialWorkspace === "Package Setup" ? listPackageSetupWorkspace(getDatabase(), session.tenantId) : Promise.resolve(packageSetupWorkspace),
        initialWorkspace === "Client Packages" ? listClientPackageWorkspace(getDatabase(), session.tenantId) : Promise.resolve(clientPackageWorkspace),
        initialWorkspace === "Service Management" ? listServiceManagementWorkspace(getDatabase(), session.tenantId) : Promise.resolve(serviceManagementWorkspace),
        initialWorkspace === "User Roles Management" ? listRoleManagementWorkspace(getDatabase(), session.tenantId) : Promise.resolve(roleManagementWorkspace),
        countUnreadNotifications(getDatabase(), session.tenantId, session.userId),
        initialWorkspace === "Billing" ? listBillingWorkspace(getDatabase(), session.tenantId) : Promise.resolve(billingWorkspace),
        initialWorkspace === "Registers" ? listRegistersWorkspace(getDatabase(), session.tenantId) : Promise.resolve(registersWorkspace),
        initialWorkspace === "Registers" ? listRegisterFormOptions(getDatabase(), session.tenantId) : Promise.resolve(registerOptions),
        initialWorkspace === "Timesheets" ? listTimesheetWorkspace(getDatabase(), session.tenantId, session.userId, hasPermission(session, "timesheets:manage")) : Promise.resolve(timesheetWorkspace),
        initialWorkspace === "Timesheets" ? listTimesheetFormOptions(getDatabase(), session.tenantId) : Promise.resolve(timesheetOptions),
        initialWorkspace === "Insights" ? listInsightsWorkspace(getDatabase(), session.tenantId) : Promise.resolve(insightsWorkspace),
        wantsClientDocuments && canReadDocuments ? listClientDocumentLibrary(getDatabase(), session.tenantId) : Promise.resolve(clientDocuments),
        wantsWorkQueue ? listWorkQueue(getDatabase(), session.tenantId, session.userId, workQueueParams, todayKey) : Promise.resolve(workQueueRows),
        wantsWorkQueue ? getQueueTotals(getDatabase(), session.tenantId, session.userId, workQueueParams, todayKey) : Promise.resolve(workQueueTotals),
        wantsWorkQueue && workQueueParams.view === "capacity" ? getCapacityLanes(getDatabase(), session.tenantId, todayKey) : Promise.resolve(workQueueLanes),
        wantsWorkQueue && hasPermission(session, "work:write") ? listWorkMembers(getDatabase(), session.tenantId) : Promise.resolve(workQueueMembers),
        wantsTaskQueue && canReadTasks ? listTaskQueue(getDatabase(), session.tenantId, session.userId, session.roleKey, taskQueueParams) : Promise.resolve(taskQueueRows),
        wantsTaskQueue && canReadTasks ? getTaskQueueTotals(getDatabase(), session.tenantId, session.userId, session.roleKey, taskQueueParams, todayKey) : Promise.resolve(taskQueueTotals),
        wantsTaskQueue && canReadTasks && taskQueueParams.view === "capacity" ? getTaskCapacityLanes(getDatabase(), session.tenantId, todayKey) : Promise.resolve(taskQueueLanes),
        wantsTaskQueue && hasPermission(session, "tasks:assign") ? listWorkMembers(getDatabase(), session.tenantId) : Promise.resolve(taskQueueMembers),
        initialWorkspace === "To-do" ? getTodoLoadStrip(getDatabase(), session.tenantId, session.userId, todayKey) : Promise.resolve(todoLoadStrip),
        wantsCompliance ? listWorkQueue(getDatabase(), session.tenantId, session.userId, { ...DEFAULT_WORK_QUEUE_PARAMS, filter: complianceParams.status, scope: "firm", service: complianceParams.service }, todayKey) : Promise.resolve(complianceRows),
        wantsCompliance ? listCoverageGaps(getDatabase(), session.tenantId, todayKey) : Promise.resolve(complianceGaps),
        wantsCompliance ? listEvidencedWorkItemIds(getDatabase(), session.tenantId).then((ids) => [...ids]) : Promise.resolve(complianceEvidenced),
      ]);
    } catch (error) {
      console.error("PostgreSQL dashboard load failed.", {
        errorType: error instanceof Error ? error.name : "UnknownError",
      });
      return <DashboardError error={error} />;
    }
    return (
      <DashboardClient
        attendance={attendanceWorkspace}
        billing={billingWorkspace}
        insights={insightsWorkspace}
        registerOptions={registerOptions}
        documentParams={documentParams}
        registerParams={registerParams}
        registers={registersWorkspace}
        registerError={query.registerError}
        timesheetError={query.timesheetError}
        timesheetOptions={timesheetOptions}
        timesheets={timesheetWorkspace}
        clientPackages={clientPackageWorkspace}
        data={data}
        clientDocuments={clientDocuments}
        documents={documentWorkspace}
        employees={employees}
        initialWorkspace={initialWorkspace}
        key={initialWorkspace}
        packageSetup={packageSetupWorkspace}
        salary={salaryWorkspace}
        serviceManagement={serviceManagementWorkspace}
        roleManagement={roleManagementWorkspace}
        roleSaved={query.saved}
        todos={todoWorkspace}
        unreadNotifications={unreadNotifications}
        compliance={{ canWrite: hasPermission(session, "work:write"), data, evidenced: complianceEvidenced, gaps: complianceGaps, params: complianceParams, rows: complianceRows, services: [...new Set(complianceRows.map((row) => row.serviceKey.toUpperCase()))].sort(), todayKey: indiaDateKey() }}
        todoQueue={{ loadStrip: todoLoadStrip, params: todoQueueParams, todos: filterTodoQueue(todoWorkspace.todos, todoQueueParams, todoWorkspace.todayKey), workspace: todoWorkspace }}
        taskQueue={{ canAssign: hasPermission(session, "tasks:assign"), canManageAll: canManageAllTasks(session.roleKey), lanes: taskQueueLanes, members: taskQueueMembers, params: taskQueueParams, rows: taskQueueRows, todayKey: indiaDateKey(), totals: taskQueueTotals }}
        workQueue={{ canWrite: hasPermission(session, "work:write"), lanes: workQueueLanes, members: workQueueMembers, params: workQueueParams, rows: workQueueRows, todayKey: indiaDateKey(), totals: workQueueTotals }}
        viewer={{ accessClass: session.accessClass, email: session.email, fullName: session.fullName, permissions: session.permissions, roleKey: session.roleKey, roleName: session.roleName, userId: session.userId }}
      />
    );
  }

  try {
    data = await getDashboardDataForConfiguredSource(process.env);
  } catch (error) {
    throw error;
  }
  todoWorkspace.todayKey = data.todayKey;
  attendanceWorkspace.todayKey = data.todayKey;
  attendanceWorkspace.periodKey = data.todayKey.slice(0, 7);
  clientPackageWorkspace.todayKey = data.todayKey;
  billingWorkspace.todayKey = data.todayKey;
  registersWorkspace.todayKey = data.todayKey;
  timesheetWorkspace.todayKey = data.todayKey;
  insightsWorkspace.todayKey = data.todayKey;
  return <DashboardClient compliance={{ canWrite: false, data, evidenced: [], gaps: [], params: DEFAULT_COMPLIANCE_PARAMS, rows: [], services: [], todayKey: data.todayKey }} todoQueue={{ loadStrip: [], params: DEFAULT_TODO_QUEUE_PARAMS, todos: filterTodoQueue(todoWorkspace.todos, DEFAULT_TODO_QUEUE_PARAMS, todoWorkspace.todayKey), workspace: todoWorkspace }} taskQueue={{ canAssign: false, canManageAll: false, lanes: [], members: [], params: DEFAULT_TASK_QUEUE_PARAMS, rows: [], todayKey: data.todayKey, totals: { dueToday: 0, overdue: 0, review: 0, waiting: 0 } }} workQueue={{ canWrite: false, lanes: [], members: [], params: DEFAULT_WORK_QUEUE_PARAMS, rows: [], todayKey: data.todayKey, totals: { active: 0, overdue: 0, review: 0, waiting: 0 } }} attendance={attendanceWorkspace} billing={billingWorkspace} insights={insightsWorkspace} registerOptions={registerOptions} documentParams={DEFAULT_DOCUMENT_PARAMS} registerParams={DEFAULT_REGISTER_PARAMS} registers={registersWorkspace} timesheetOptions={timesheetOptions} timesheets={timesheetWorkspace} clientDocuments={clientDocuments} clientPackages={clientPackageWorkspace} data={data} documents={documentWorkspace} employees={employees} initialWorkspace={initialWorkspace} key={initialWorkspace} packageSetup={packageSetupWorkspace} roleManagement={roleManagementWorkspace} roleSaved={query.saved} salary={salaryWorkspace} serviceManagement={serviceManagementWorkspace} todos={todoWorkspace} />;
}
