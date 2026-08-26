export const roles = ["firm_administrator", "partner", "manager", "associate"] as const;

export type Role = typeof roles[number];
export const accessClasses = ["super_admin", "admin", "employee"] as const;
export type AccessClass = typeof accessClasses[number];

export const permissionDefinitions = [
  { key: "dashboard:read", module: "Workspace", label: "Open workspace", description: "Use the authenticated practice workspace.", allowedFor: ["admin", "employee"] },
  { key: "clients:write", module: "Clients", label: "Manage clients", description: "Create, edit, and archive client records.", allowedFor: ["admin", "employee"] },
  { key: "work:write", module: "Delivery", label: "Manage work", description: "Create and update compliance work items.", allowedFor: ["admin", "employee"] },
  { key: "documents:read", module: "Documents", label: "View documents", description: "View accessible client documents and requests.", allowedFor: ["admin", "employee"] },
  { key: "documents:write", module: "Documents", label: "Manage documents", description: "Request, upload, and maintain client documents.", allowedFor: ["admin", "employee"] },
  { key: "team:read", module: "Employees", label: "View employees", description: "View employee profiles and work allocation.", allowedFor: ["admin", "employee"] },
  { key: "team:manage", module: "Employees", label: "Manage employees", description: "Create and maintain employee profiles. Admin accounts remain Super Admin-only.", allowedFor: ["admin"], risk: "high" },
  { key: "tasks:read", module: "Tasks", label: "View tasks", description: "View tasks within the assigned operational scope.", allowedFor: ["admin", "employee"] },
  { key: "tasks:assign", module: "Tasks", label: "Assign tasks", description: "Create, assign, and review office tasks.", allowedFor: ["admin", "employee"] },
  { key: "tasks:update:own", module: "Tasks", label: "Update own tasks", description: "Update tasks assigned to the signed-in employee.", allowedFor: ["admin", "employee"] },
  { key: "attendance:use", module: "Attendance", label: "Use attendance", description: "Record attendance and submit personal requests.", allowedFor: ["admin", "employee"] },
  { key: "attendance:review", module: "Attendance", label: "Review attendance", description: "Review requests within the assigned team scope.", allowedFor: ["admin", "employee"] },
  { key: "attendance:manage", module: "Attendance", label: "Manage attendance", description: "Maintain attendance policy, periods, and manual records.", allowedFor: ["admin"], risk: "high" },
  { key: "salary:read:own", module: "Salary", label: "View own salary", description: "View the employee's own published payslips.", allowedFor: ["admin", "employee"] },
  { key: "salary:manage", module: "Salary", label: "Prepare payroll", description: "Maintain salary structures and prepare payroll runs.", allowedFor: ["admin"], risk: "high" },
  { key: "salary:approve", module: "Salary", label: "Approve payroll", description: "Approve payroll runs subject to separation-of-duty controls.", allowedFor: ["admin", "employee"], risk: "high" },
  { key: "packages:read", module: "Packages", label: "View packages", description: "View service packages and pricing.", allowedFor: ["admin", "employee"] },
  { key: "packages:manage", module: "Packages", label: "Manage packages", description: "Create and maintain service packages.", allowedFor: ["admin"], risk: "high" },
  { key: "services:read", module: "Services", label: "View service master", description: "View the firm's service catalog.", allowedFor: ["admin", "employee"] },
  { key: "services:manage", module: "Services", label: "Manage service master", description: "Create and maintain master services.", allowedFor: ["admin"], risk: "high" },
  { key: "client_packages:manage", module: "Packages", label: "Assign client packages", description: "Assign, change, and cancel client packages.", allowedFor: ["admin", "employee"] },
  { key: "billing:read", module: "Billing", label: "View billing", description: "View firm billing and commercial summaries.", allowedFor: ["admin"], risk: "high" },
  { key: "billing:manage", module: "Billing", label: "Manage billing", description: "Create, issue, and settle client invoices.", allowedFor: ["admin"], risk: "high" },
  { key: "registers:read", module: "Registers", label: "View statutory registers", description: "View the UDIN, DSC custody, and notice registers.", allowedFor: ["admin", "employee"] },
  { key: "registers:manage", module: "Registers", label: "Manage statutory registers", description: "Record UDINs, DSC custody movements, and statutory notices.", allowedFor: ["admin", "employee"] },
  { key: "timesheets:use", module: "Timesheets", label: "Record own time", description: "Record and maintain the signed-in employee's own time entries.", allowedFor: ["admin", "employee"] },
  { key: "timesheets:manage", module: "Timesheets", label: "Review firm time", description: "Review recorded time and engagement effort across the firm.", allowedFor: ["admin", "employee"] },
  { key: "performance:review", module: "Employees", label: "Write performance reviews", description: "Draft, share, and read performance reviews for the assigned team scope.", allowedFor: ["admin", "employee"], risk: "high" },
  { key: "roles:read", module: "Access control", label: "View roles", description: "View role definitions and effective permission summaries.", allowedFor: ["admin"], risk: "high" },
  { key: "roles:manage", module: "Access control", label: "Manage roles", description: "Create and change Admin and Employee roles. Reserved for Super Admin.", allowedFor: [], risk: "critical" },
] as const;

export type Permission = typeof permissionDefinitions[number]["key"];
export const allPermissions = permissionDefinitions.map((permission) => permission.key) as Permission[];

export type AuthViewer = {
  accessClass?: AccessClass;
  email: string;
  fullName: string;
  permissions?: readonly Permission[];
  roleName?: string;
  roleKey: string;
  userId?: string;
};

const permissionsByRole: Record<Role, ReadonlySet<Permission>> = {
  firm_administrator: new Set(allPermissions),
  partner: new Set(["dashboard:read", "clients:write", "work:write", "documents:read", "documents:write", "team:read", "team:manage", "performance:review", "tasks:read", "tasks:assign", "tasks:update:own", "attendance:use", "attendance:review", "attendance:manage", "salary:read:own", "salary:manage", "salary:approve", "packages:read", "packages:manage", "services:read", "services:manage", "client_packages:manage", "billing:read", "billing:manage", "registers:read", "registers:manage", "timesheets:use", "timesheets:manage"]),
  manager: new Set(["dashboard:read", "clients:write", "work:write", "documents:read", "documents:write", "team:read", "performance:review", "tasks:read", "tasks:assign", "tasks:update:own", "attendance:use", "attendance:review", "salary:read:own", "packages:read", "services:read", "client_packages:manage", "registers:read", "registers:manage", "timesheets:use", "timesheets:manage"]),
  associate: new Set(["dashboard:read", "tasks:read", "tasks:update:own", "attendance:use", "salary:read:own", "registers:read", "timesheets:use"]),
};

export function isRole(value: string): value is Role {
  return roles.includes(value as Role);
}

/**
 * The single source of truth for memberships that predate role definitions.
 * Session resolution and `hasPermission` must agree, otherwise a legacy account
 * is granted more through one path than the other.
 */
export function legacyPermissionsForRole(roleKey: string): Permission[] {
  return isRole(roleKey) ? [...permissionsByRole[roleKey]] : [];
}

export function hasPermission(subject: string | Pick<AuthViewer, "permissions" | "roleKey">, permission: Permission) {
  if (typeof subject !== "string" && subject.permissions) return subject.permissions.includes(permission);
  const role = typeof subject === "string" ? subject : subject.roleKey;
  return isRole(role) && permissionsByRole[role].has(permission);
}

export function roleLabel(role: string) {
  const labels: Record<Role, string> = {
    firm_administrator: "Firm administrator",
    partner: "Partner",
    manager: "Manager",
    associate: "Associate",
  };
  return isRole(role) ? labels[role] : "Team member";
}

export function accessClassLabel(accessClass: AccessClass) {
  return ({ super_admin: "Super Admin", admin: "Admin", employee: "Employee" } as const)[accessClass];
}
