"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";

import type { AuthViewer } from "../lib/auth/authorization";
import type { DashboardData } from "../lib/dashboard/types";
import { DashboardShell } from "./dashboard/dashboard-shell";

const workspaceUrls: Record<string, string> = {
  Overview: "/",
  "My work": "/?workspace=work",
  "To-do": "/?workspace=todos",
  Attendance: "/?workspace=attendance",
  Salary: "/?workspace=salary",
  Tasks: "/?workspace=tasks",
  Clients: "/?workspace=clients",
  "Client Documents": "/?workspace=client-documents",
  "Package Setup": "/?workspace=package-setup",
  "Client Packages": "/?workspace=client-packages",
  "Service Management": "/?workspace=service-management",
  "Master Data": "/settings/master-data",
  "Attendance Masters": "/settings/attendance",
  "User Roles Management": "/?workspace=user-roles",
  Billing: "/?workspace=billing",
  Insights: "/?workspace=insights",
  Registers: "/?workspace=registers",
  Timesheets: "/?workspace=timesheets",
  Compliance: "/?workspace=compliance",
  Documents: "/?workspace=documents",
  Calendar: "/?workspace=calendar",
  Employees: "/?workspace=team",
};

export default function AuthenticatedWorkspaceShell({ active, children, data, unreadNotifications = 0, viewer }: { active: string; children: ReactNode; data: DashboardData; unreadNotifications?: number; viewer: AuthViewer }) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <DashboardShell
      active={active}
      data={data}
      menuOpen={menuOpen}
      onMenuClose={() => setMenuOpen(false)}
      onMenuOpen={() => setMenuOpen(true)}
      onNavigate={(destination) => {
        setMenuOpen(false);
        router.push(workspaceUrls[destination] ?? "/");
      }}
      unreadNotifications={unreadNotifications}
      viewer={viewer}
    >
      <div className="workspace-route-content">{children}</div>
    </DashboardShell>
  );
}
