import { hasPermission, type AuthViewer, type Permission } from "../auth/authorization";

/**
 * Which permission each workspace needs.
 *
 * The sidebar and the command palette both offer navigation, so the rule lives
 * here rather than in either of them: a palette that lists a workspace the
 * sidebar hides would hand the user a door they cannot open, and would leak the
 * existence of a module their role is not entitled to.
 *
 * Workspaces absent from this map are open to anyone who can read the dashboard.
 */
export const workspacePermissions: Record<string, Permission> = {
  "Attendance Masters": "attendance:use",
  Billing: "billing:read",
  "Client Documents": "documents:read",
  "Client Packages": "client_packages:manage",
  Documents: "documents:read",
  Employees: "team:read",
  "Master Data": "services:read",
  "Package Setup": "packages:read",
  Registers: "registers:read",
  "Service Management": "services:read",
  Tasks: "tasks:read",
  Timesheets: "timesheets:use",
  "User Roles Management": "roles:read",
};

/** True when this viewer may open the workspace. An absent viewer sees everything. */
export function canOpenWorkspace(viewer: AuthViewer | undefined, label: string): boolean {
  const permission = workspacePermissions[label];
  if (!permission || !viewer) return true;
  return hasPermission(viewer, permission);
}
