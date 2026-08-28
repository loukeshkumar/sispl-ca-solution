import { permissionDefinitions, type Permission, type Role } from "../auth/authorization";

export type ManagedRoleClass = "admin" | "employee";
export type RoleDefinitionInput = {
  description: string;
  legacyRoleKey: Exclude<Role, "firm_administrator">;
  name: string;
  permissions: Permission[];
  roleClass: ManagedRoleClass;
};
/** What the people register shows after a credential action. */
export type MemberAccessState = { error: string; employeeId?: string; expired?: boolean; temporaryPassword?: string };

export type RoleDefinitionActionState = {
  error: string;
  fieldErrors: Partial<Record<"description" | "legacyRoleKey" | "name" | "permissions" | "roleClass", string>>;
};

const validScopes = ["partner", "manager", "associate"] as const;

export function validateRoleDefinitionForm(formData: FormData):
  | { success: true; data: RoleDefinitionInput }
  | { success: false; fieldErrors: RoleDefinitionActionState["fieldErrors"] } {
  const name = String(formData.get("name") ?? "").trim().replace(/\s+/g, " ");
  const description = String(formData.get("description") ?? "").trim().replace(/\s+/g, " ");
  const roleClass = String(formData.get("roleClass") ?? "");
  const requestedScope = String(formData.get("legacyRoleKey") ?? "");
  const legacyRoleKey = roleClass === "admin" ? "partner" : requestedScope;
  const requestedPermissions = [...new Set(formData.getAll("permissions").map(String))];
  const fieldErrors: RoleDefinitionActionState["fieldErrors"] = {};

  if (name.length < 2 || name.length > 80) fieldErrors.name = "Enter a role name between 2 and 80 characters.";
  if (description.length > 240) fieldErrors.description = "Keep the description within 240 characters.";
  if (roleClass !== "admin" && roleClass !== "employee") fieldErrors.roleClass = "Choose Admin or Employee.";
  if (!validScopes.includes(legacyRoleKey as typeof validScopes[number])) fieldErrors.legacyRoleKey = "Choose a valid operational scope.";

  const definitionMap = new Map(permissionDefinitions.map((definition) => [definition.key, definition]));
  const invalidPermission = requestedPermissions.find((permission) => {
    const definition = definitionMap.get(permission as Permission);
    return !definition || !definition.allowedFor.includes(roleClass as never);
  });
  if (invalidPermission) fieldErrors.permissions = "One or more permissions are not available for this role class.";
  const permissions = requestedPermissions.filter((permission): permission is Permission => definitionMap.has(permission as Permission));
  if (!permissions.includes("dashboard:read")) fieldErrors.permissions = "Every active role must include workspace access.";

  if (Object.keys(fieldErrors).length) return { success: false, fieldErrors };
  return {
    success: true,
    data: {
      description,
      legacyRoleKey: legacyRoleKey as RoleDefinitionInput["legacyRoleKey"],
      name,
      permissions,
      roleClass: roleClass as ManagedRoleClass,
    },
  };
}

export function roleKeyFromName(name: string) {
  const key = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 48);
  return key || "role";
}
