import { hasPermission, type AuthViewer, type Permission } from "../auth/authorization";

/**
 * Which permission each workspace needs.
 *
 * The sidebar and the command palette both offer navigation, so the rule lives
 * here rather than in either of them: a palette that lists a workspace the
 * sidebar hides would hand the user a door they cannot open, and would leak the
 * existence of a module their role is not entitled to.
 *
 * Every destination belongs to this map or to `openWorkspaces`. A destination
 * in neither is visible to every role by accident, so a test asserts the two
 * lists together cover the sidebar.
 */
export const workspacePermissions: Record<string, Permission> = {
  Articleship: "team:read",
  Attendance: "attendance:use",
  "Attendance Masters": "attendance:use",
  Billing: "billing:read",
  Clients: "clients:write",
  "Client Documents": "documents:read",
  "Client Packages": "client_packages:manage",
  Compliance: "services:read",
  Documents: "documents:read",
  Employees: "team:read",
  Insights: "billing:read",
  "Master Data": "services:read",
  "Package Setup": "packages:read",
  "Rate Card": "billing:read",
  Registers: "registers:read",
  Salary: "salary:read:own",
  "Service Management": "services:read",
  Tasks: "tasks:read",
  Timesheets: "timesheets:use",
  "Training & CPE": "team:read",
  "User Roles Management": "roles:read",
  "Utilisation Targets": "timesheets:manage",
  "Work Procedures": "services:read",
};

/**
 * Destinations every signed-in person reaches, because each shows that person
 * their own work rather than the firm's. Performance belongs here too: an
 * employee without `performance:review` still reads the reviews written about
 * them, which the page filters down to.
 */
export const openWorkspaces: ReadonlySet<string> = new Set([
  "Calendar",
  "My work",
  "Overview",
  "Performance",
  "To-do",
]);

/** A subject `hasPermission` can read: a viewer, or the session behind one. */
type PermissionSubject = Pick<AuthViewer, "permissions" | "roleKey">;

/** True when this viewer may open the workspace. An absent viewer sees everything. */
export function canOpenWorkspace(viewer: PermissionSubject | undefined, label: string): boolean {
  const permission = workspacePermissions[label];
  if (!permission || !viewer) return true;
  return hasPermission(viewer, permission);
}
