"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { ClientDocumentsWorkspace } from "./dashboard/client-documents-workspace";
import { ClientsWorkspace, type ClientSegment } from "./dashboard/clients-workspace";
import { ComplianceWorkspace } from "./dashboard/compliance-workspace";
import { CalendarWorkspace } from "./dashboard/calendar-workspace";
import { DashboardShell } from "./dashboard/dashboard-shell";
import { DocumentsWorkspace } from "./dashboard/documents-workspace";
import { OverviewWorkspace, type OverviewFilter } from "./dashboard/overview-workspace";
import { WorkWorkspace } from "./dashboard/work-workspace";
import { TasksWorkspace } from "./dashboard/tasks-workspace";
import { TeamWorkspace } from "./dashboard/team-workspace";
import { TodosWorkspace } from "./dashboard/todos-workspace";
import { AttendanceWorkspace } from "./dashboard/attendance-workspace";
import { SalaryWorkspace } from "./dashboard/salary-workspace";
import { PackageSetupWorkspace } from "./dashboard/package-setup-workspace";
import { ClientPackagesWorkspace } from "./dashboard/client-packages-workspace";
import { ServiceManagementWorkspace } from "./dashboard/service-management-workspace";
import { UserRolesWorkspace } from "./dashboard/user-roles-workspace";
import { BillingWorkspace } from "./dashboard/billing-workspace";
import { RegistersWorkspace } from "./dashboard/registers-workspace";
import { TimesheetsWorkspace } from "./dashboard/timesheets-workspace";
import { InsightsWorkspace } from "./dashboard/insights-workspace";
import { hasPermission, type AuthViewer } from "../lib/auth/authorization";
import type { DashboardData } from "../lib/dashboard/types";
import { matchesClientHealthFilter, matchesWorkFilter } from "../lib/dashboard/filters";
import type { DocumentWorkspaceData } from "../lib/documents/repository";
import type { EmployeeSummary } from "../lib/team/repository";
import type { TodoWorkspaceData } from "../lib/todos/repository";
import type { AttendanceWorkspaceData } from "../lib/attendance/repository";
import type { ClientDocumentLibrary } from "../lib/documents/library";
import type { SalaryWorkspaceData } from "../lib/payroll/repository";
import type { ClientPackageWorkspaceData, PackageSetupWorkspaceData, ServiceManagementWorkspaceData } from "../lib/packages/repository";
import type { RoleManagementWorkspace } from "../lib/roles/repository";
import type { BillingWorkspaceData } from "../lib/billing/repository";
import type { RegistersWorkspaceData } from "../lib/registers/repository";
import type { TimesheetWorkspaceData } from "../lib/timesheets/repository";
import type { InsightsWorkspaceData } from "../lib/insights/repository";
import type { RegisterFormOptions as RegisterOptions } from "./dashboard/register-dialogs";
import type { TaskQueueViewData } from "./dashboard/tasks-workspace";
import type { WorkQueueViewData } from "./dashboard/work-workspace";

type WorkspaceName = "Overview" | "Clients" | "Client Documents" | "My work" | "To-do" | "Attendance" | "Salary" | "Tasks" | "Compliance" | "Documents" | "Calendar" | "Employees" | "Package Setup" | "Client Packages" | "Service Management" | "User Roles Management" | "Billing" | "Registers" | "Timesheets" | "Insights";

type TimesheetOptions = { clients: Array<{ id: string; name: string }>; work: Array<{ id: string; label: string }>; tasks: Array<{ id: string; title: string }> };

export default function DashboardClient({ taskQueue, workQueue, attendance, billing, clientDocuments, clientPackages, data, documents, employees, initialWorkspace = "Overview", insights, packageSetup, registerError, registerOptions, registers, roleManagement, roleSaved, salary, serviceManagement, timesheetError, timesheetOptions, timesheets, todos, unreadNotifications = 0, viewer }: { taskQueue: TaskQueueViewData; workQueue: WorkQueueViewData; attendance: AttendanceWorkspaceData; billing: BillingWorkspaceData; clientDocuments: ClientDocumentLibrary; insights: InsightsWorkspaceData; registerError?: string; registerOptions: RegisterOptions; registers: RegistersWorkspaceData; timesheetError?: string; timesheetOptions: TimesheetOptions; timesheets: TimesheetWorkspaceData; clientPackages: ClientPackageWorkspaceData; data: DashboardData; documents: DocumentWorkspaceData; employees: EmployeeSummary[]; initialWorkspace?: WorkspaceName; packageSetup: PackageSetupWorkspaceData; roleManagement: RoleManagementWorkspace; roleSaved?: string; salary: SalaryWorkspaceData; serviceManagement: ServiceManagementWorkspaceData; todos: TodoWorkspaceData; unreadNotifications?: number; viewer?: AuthViewer }) {
  const router = useRouter();
  const [active, setActive] = useState<string>(initialWorkspace);
  const [filter, setFilter] = useState<OverviewFilter>("All");
  const [query, setQuery] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [selectedId, setSelectedId] = useState(data.clients[0]?.id ?? "");
  const [segment, setSegment] = useState<ClientSegment>("All clients");
  const [clientQuery, setClientQuery] = useState("");

  const items = useMemo(() => data.work.filter((item) => {
    return (
    matchesWorkFilter(item, filter, data.todayKey)
    && (!query || `${item.client} ${item.service} ${item.owner}`.toLowerCase().includes(query.toLowerCase()))
    );
  }), [data.todayKey, data.work, filter, query]);

  const visibleClients = useMemo(() => data.clients.filter((client) => (
    matchesClientHealthFilter(client, segment)
    && (!clientQuery || `${client.name} ${client.pan}`.toLowerCase().includes(clientQuery.toLowerCase()))
  )), [clientQuery, data.clients, segment]);

  const selected = visibleClients.find((client) => client.id === selectedId) ?? visibleClients[0];
  const canWriteWork = Boolean(viewer && hasPermission(viewer, "work:write"));
  const canWriteDocuments = Boolean(viewer && hasPermission(viewer, "documents:write"));
  const navigate = (destination: string) => {
    const workspace = ({ Clients: "clients", "Client Documents": "client-documents", "My work": "work", "To-do": "todos", Attendance: "attendance", Salary: "salary", Tasks: "tasks", Compliance: "compliance", Documents: "documents", Calendar: "calendar", Employees: "team", "Package Setup": "package-setup", "Client Packages": "client-packages", "Service Management": "service-management", "User Roles Management": "user-roles", Billing: "billing", Registers: "registers", Timesheets: "timesheets", Insights: "insights" } as Record<string, string>)[destination];
    setActive(destination);
    setMenuOpen(false);
    router.push(workspace ? `/?workspace=${workspace}` : "/");
  };

  return (
    <DashboardShell
      active={active}
      data={data}
      menuOpen={menuOpen}
      onMenuClose={() => setMenuOpen(false)}
      onMenuOpen={() => setMenuOpen(true)}
      onNavigate={navigate}
      unreadNotifications={unreadNotifications}
      viewer={viewer}
    >
      {active === "Clients" ? (
        <ClientsWorkspace
          canWriteClients={Boolean(viewer && hasPermission(viewer, "clients:write"))}
          canWriteDocuments={canWriteDocuments}
          clients={visibleClients}
          data={data}
          onClientSelect={setSelectedId}
          onQueryChange={setClientQuery}
          onSegmentChange={setSegment}
          query={clientQuery}
          segment={segment}
          selected={selected}
        />
      ) : active === "My work" ? (
        <WorkWorkspace {...workQueue} canWrite={workQueue.canWrite && canWriteWork} />
      ) : active === "To-do" ? (
        <TodosWorkspace workspace={todos} />
      ) : active === "Attendance" ? (
        <AttendanceWorkspace canManage={Boolean(viewer && hasPermission(viewer, "attendance:manage"))} canReview={Boolean(viewer && hasPermission(viewer, "attendance:review"))} workspace={attendance} />
      ) : active === "Salary" ? (
        <SalaryWorkspace canApprove={Boolean(viewer && hasPermission(viewer, "salary:approve"))} data={salary} />
      ) : active === "Tasks" ? (
        <TasksWorkspace {...taskQueue} canAssign={taskQueue.canAssign && Boolean(viewer && hasPermission(viewer, "tasks:assign"))} />
      ) : active === "Compliance" ? (
        <ComplianceWorkspace canWrite={canWriteWork} data={data} />
      ) : active === "Client Documents" ? (
        <ClientDocumentsWorkspace canWrite={canWriteDocuments} library={clientDocuments} />
      ) : active === "Documents" ? (
        <DocumentsWorkspace canWrite={canWriteDocuments} todayKey={data.todayKey} workspace={documents} />
      ) : active === "Calendar" ? (
        <CalendarWorkspace canWrite={canWriteWork} data={data} />
      ) : active === "Employees" ? (
        <TeamWorkspace canManage={Boolean(viewer && hasPermission(viewer, "team:manage"))} employees={employees} />
      ) : active === "Package Setup" ? (
        <PackageSetupWorkspace canManage={Boolean(viewer && hasPermission(viewer, "packages:manage"))} workspace={packageSetup} />
      ) : active === "Client Packages" ? (
        <ClientPackagesWorkspace workspace={clientPackages} />
      ) : active === "Service Management" ? (
        <ServiceManagementWorkspace canManage={Boolean(viewer && hasPermission(viewer, "services:manage"))} workspace={serviceManagement} />
      ) : active === "User Roles Management" ? (
        <UserRolesWorkspace canManage={Boolean(viewer && hasPermission(viewer, "roles:manage"))} saved={roleSaved} workspace={roleManagement} />
      ) : active === "Billing" ? (
        <BillingWorkspace canManage={Boolean(viewer && hasPermission(viewer, "billing:manage"))} data={billing} />
      ) : active === "Registers" ? (
        <RegistersWorkspace
          canManage={Boolean(viewer && hasPermission(viewer, "registers:manage"))}
          data={registers}
          options={registerOptions}
          registerError={registerError}
        />
      ) : active === "Timesheets" ? (
        <TimesheetsWorkspace data={timesheets} options={timesheetOptions} timesheetError={timesheetError} viewerUserId={viewer?.userId} />
      ) : active === "Insights" ? (
        <InsightsWorkspace data={insights} />
      ) : (
        <OverviewWorkspace
          active={active}
          data={data}
          filter={filter}
          items={items}
          onFilterChange={setFilter}
          onOpenMyWork={() => navigate("My work")}
          onQueryChange={setQuery}
          query={query}
          todos={todos}
        />
      )}
    </DashboardShell>
  );
}
