import { randomUUID } from "node:crypto";
import { and, asc, count, eq, inArray, isNull, sql } from "drizzle-orm";

import { auditEvents, employeeProfiles, roleDefinitions, rolePermissions, tenantMemberships, userCredentials, userSessions, users } from "../../db/schema";
import { allPermissions, type AccessClass, type Permission } from "../auth/authorization";
import type { DashboardDatabase } from "../dashboard/postgres/repository";
import { roleKeyFromName, type ManagedRoleClass, type RoleDefinitionInput } from "./validation";

export type AssignableRole = {
  id: string;
  name: string;
  roleClass: ManagedRoleClass;
  legacyRoleKey: "partner" | "manager" | "associate";
};

export type ManagedRoleSummary = AssignableRole & {
  description: string;
  isSystem: boolean;
  key: string;
  memberCount: number;
  permissionCount: number;
  status: "active" | "archived";
  updatedAt: Date;
  version: number;
};

/** Roles carry their permissions so the edit dialog opens without a round trip. */
export type ManagedRoleWithPermissions = ManagedRoleSummary & { permissions: Permission[] };

/**
 * One governed account.
 *
 * `employeeId` is null for a membership with no employee profile behind it, and
 * the credential actions need one, so such a row is shown but not actionable.
 */
export type RoleMember = {
  accessClass: AccessClass;
  email: string;
  employeeId: string | null;
  fullName: string;
  loginEnabled: boolean;
  membershipId: string;
  mustChangePassword: boolean;
  roleName: string;
  userId: string;
};

export type RoleManagementWorkspace = {
  people: RoleMember[];
  roles: ManagedRoleWithPermissions[];
  superAdmins: Array<{ email: string; fullName: string; id: string }>;
  metrics: { activeAdmins: number; employeeCategories: number; protectedPermissions: number; totalAssigned: number };
};

export type RoleDefinitionEditorData = ManagedRoleSummary & { permissions: Permission[] };

export class RoleRepositoryError extends Error {
  constructor(public readonly code: "duplicate" | "forbidden" | "in_use" | "not_found" | "system_role" | "invalid_permissions") {
    super({
      duplicate: "A role with this name already exists.",
      forbidden: "Only a Super Admin can make this access-control change.",
      in_use: "Move assigned users to another role before archiving this role.",
      not_found: "The role could not be found in this firm.",
      system_role: "A system employee category cannot be archived.",
      invalid_permissions: "The selected permissions are not valid for this role class.",
    }[code]);
    this.name = "RoleRepositoryError";
  }
}

const permissionKeys = new Set<string>(allPermissions);
const allowedPermissions = (roleClass: ManagedRoleClass, permissions: Permission[]) => permissions.every((permission) => {
  if (!permissionKeys.has(permission)) return false;
  if (permission === "roles:manage") return false;
  if (roleClass === "employee" && ["team:manage", "attendance:manage", "salary:manage", "packages:manage", "services:manage", "billing:read", "roles:read"].includes(permission)) return false;
  return true;
});

async function assertSuperAdmin(database: DashboardDatabase, tenantId: string, actorUserId: string) {
  const [actor] = await database.select({ id: tenantMemberships.id }).from(tenantMemberships).where(and(
    eq(tenantMemberships.tenantId, tenantId),
    eq(tenantMemberships.userId, actorUserId),
    eq(tenantMemberships.accessClass, "super_admin"),
    eq(tenantMemberships.status, "active"),
  )).limit(1);
  if (!actor) throw new RoleRepositoryError("forbidden");
  return actor;
}

export async function listAssignableRoles(database: DashboardDatabase, tenantId: string, actorAccessClass: AccessClass): Promise<AssignableRole[]> {
  const classes: ManagedRoleClass[] = actorAccessClass === "super_admin" ? ["admin", "employee"] : ["employee"];
  const rows = await database.select({
    id: roleDefinitions.id,
    name: roleDefinitions.name,
    roleClass: roleDefinitions.roleClass,
    legacyRoleKey: roleDefinitions.legacyRoleKey,
  }).from(roleDefinitions).where(and(
    eq(roleDefinitions.tenantId, tenantId),
    eq(roleDefinitions.status, "active"),
    inArray(roleDefinitions.roleClass, classes),
  )).orderBy(asc(roleDefinitions.roleClass), asc(roleDefinitions.name));
  return rows as AssignableRole[];
}

export async function listRoleManagementWorkspace(database: DashboardDatabase, tenantId: string): Promise<RoleManagementWorkspace> {
  const [roles, superAdmins] = await Promise.all([
    database.select({
      id: roleDefinitions.id,
      key: roleDefinitions.key,
      name: roleDefinitions.name,
      description: roleDefinitions.description,
      roleClass: roleDefinitions.roleClass,
      legacyRoleKey: roleDefinitions.legacyRoleKey,
      isSystem: roleDefinitions.isSystem,
      status: roleDefinitions.status,
      version: roleDefinitions.version,
      updatedAt: roleDefinitions.updatedAt,
      permissionCount: sql<number>`count(distinct ${rolePermissions.id})`.mapWith(Number),
      memberCount: sql<number>`count(distinct ${tenantMemberships.id})`.mapWith(Number),
    }).from(roleDefinitions)
      .leftJoin(rolePermissions, and(eq(rolePermissions.tenantId, tenantId), eq(rolePermissions.roleDefinitionId, roleDefinitions.id)))
      .leftJoin(tenantMemberships, and(eq(tenantMemberships.tenantId, tenantId), eq(tenantMemberships.roleDefinitionId, roleDefinitions.id), eq(tenantMemberships.status, "active")))
      .where(eq(roleDefinitions.tenantId, tenantId))
      .groupBy(roleDefinitions.id)
      .orderBy(asc(roleDefinitions.roleClass), asc(roleDefinitions.name)),
    database.select({ id: tenantMemberships.id, email: users.email, fullName: users.fullName }).from(tenantMemberships)
      .innerJoin(users, eq(users.id, tenantMemberships.userId))
      .where(and(eq(tenantMemberships.tenantId, tenantId), eq(tenantMemberships.accessClass, "super_admin"), eq(tenantMemberships.status, "active")))
      .orderBy(asc(users.fullName)),
  ]);
  // Starts from the membership rather than the employee profile, so an account
  // governed by a role still appears when nobody has filled in its profile.
  const people = await database.select({
    accessClass: tenantMemberships.accessClass,
    email: users.email,
    employeeId: employeeProfiles.id,
    fullName: users.fullName,
    loginEnabled: sql<boolean>`${userCredentials.userId} is not null`,
    membershipId: tenantMemberships.id,
    mustChangePassword: sql<boolean>`coalesce(${userCredentials.mustChangePassword}, false)`,
    roleName: roleDefinitions.name,
    userId: users.id,
  }).from(tenantMemberships)
    .innerJoin(users, eq(users.id, tenantMemberships.userId))
    .leftJoin(roleDefinitions, and(eq(roleDefinitions.tenantId, tenantId), eq(roleDefinitions.id, tenantMemberships.roleDefinitionId)))
    .leftJoin(employeeProfiles, and(eq(employeeProfiles.tenantId, tenantId), eq(employeeProfiles.userId, tenantMemberships.userId)))
    .leftJoin(userCredentials, eq(userCredentials.userId, tenantMemberships.userId))
    .where(and(eq(tenantMemberships.tenantId, tenantId), eq(tenantMemberships.status, "active")))
    .orderBy(asc(users.fullName));

  const grantRows = await database.select({ roleDefinitionId: rolePermissions.roleDefinitionId, permissionKey: rolePermissions.permissionKey })
    .from(rolePermissions).where(eq(rolePermissions.tenantId, tenantId));
  const grantsByRole = new Map<string, Permission[]>();
  for (const grant of grantRows) {
    if (!allPermissions.includes(grant.permissionKey as Permission)) continue;
    grantsByRole.set(grant.roleDefinitionId, [...(grantsByRole.get(grant.roleDefinitionId) ?? []), grant.permissionKey as Permission]);
  }
  const typedRoles = (roles as ManagedRoleSummary[]).map((role) => ({ ...role, permissions: grantsByRole.get(role.id) ?? [] }));
  return {
    people: people.map((person) => ({
      ...person,
      accessClass: person.accessClass as AccessClass,
      roleName: person.accessClass === "super_admin" ? "Super Admin" : person.roleName ?? "Unassigned",
    })),
    roles: typedRoles,
    superAdmins,
    metrics: {
      activeAdmins: superAdmins.length + typedRoles.filter((role) => role.roleClass === "admin").reduce((sum, role) => sum + role.memberCount, 0),
      employeeCategories: typedRoles.filter((role) => role.roleClass === "employee" && role.status === "active").length,
      protectedPermissions: allPermissions.filter((permission) => permission === "roles:manage" || permission.includes("approve") || permission.includes("manage")).length,
      totalAssigned: superAdmins.length + typedRoles.reduce((sum, role) => sum + role.memberCount, 0),
    },
  };
}

export async function getRoleDefinitionEditorData(database: DashboardDatabase, tenantId: string, roleId: string): Promise<RoleDefinitionEditorData | null> {
  const [role] = await database.select({
    id: roleDefinitions.id,
    key: roleDefinitions.key,
    name: roleDefinitions.name,
    description: roleDefinitions.description,
    roleClass: roleDefinitions.roleClass,
    legacyRoleKey: roleDefinitions.legacyRoleKey,
    isSystem: roleDefinitions.isSystem,
    status: roleDefinitions.status,
    version: roleDefinitions.version,
    updatedAt: roleDefinitions.updatedAt,
    memberCount: count(tenantMemberships.id),
  }).from(roleDefinitions)
    .leftJoin(tenantMemberships, and(eq(tenantMemberships.tenantId, tenantId), eq(tenantMemberships.roleDefinitionId, roleDefinitions.id), eq(tenantMemberships.status, "active")))
    .where(and(eq(roleDefinitions.tenantId, tenantId), eq(roleDefinitions.id, roleId)))
    .groupBy(roleDefinitions.id)
    .limit(1);
  if (!role) return null;
  const permissions = await database.select({ key: rolePermissions.permissionKey }).from(rolePermissions).where(and(
    eq(rolePermissions.tenantId, tenantId), eq(rolePermissions.roleDefinitionId, roleId),
  )).orderBy(asc(rolePermissions.permissionKey));
  return { ...role, permissionCount: permissions.length, permissions: permissions.map((item) => item.key).filter((key): key is Permission => permissionKeys.has(key)) } as RoleDefinitionEditorData;
}

export async function createRoleDefinition(database: DashboardDatabase, tenantId: string, actorUserId: string, input: RoleDefinitionInput) {
  if (!allowedPermissions(input.roleClass, input.permissions)) throw new RoleRepositoryError("invalid_permissions");
  return database.transaction(async (transaction) => {
    await assertSuperAdmin(transaction, tenantId, actorUserId);
    const id = randomUUID();
    const keyBase = roleKeyFromName(input.name);
    try {
      await transaction.insert(roleDefinitions).values({
        id, tenantId, key: keyBase, name: input.name, description: input.description, roleClass: input.roleClass,
        legacyRoleKey: input.roleClass === "admin" ? "partner" : input.legacyRoleKey,
        createdByUserId: actorUserId,
      });
    } catch (error) {
      if ((error as { code?: string }).code === "23505") throw new RoleRepositoryError("duplicate");
      throw error;
    }
    if (input.permissions.length) await transaction.insert(rolePermissions).values(input.permissions.map((permissionKey) => ({ tenantId, roleDefinitionId: id, permissionKey })));
    await transaction.insert(auditEvents).values({
      tenantId, actorUserId, resourceType: "role_definition", resourceId: id, action: "role.created",
      reason: JSON.stringify({ name: input.name, roleClass: input.roleClass, permissions: input.permissions }),
    });
    return id;
  });
}

export async function updateRoleDefinition(database: DashboardDatabase, tenantId: string, actorUserId: string, roleId: string, input: RoleDefinitionInput) {
  if (!allowedPermissions(input.roleClass, input.permissions)) throw new RoleRepositoryError("invalid_permissions");
  await database.transaction(async (transaction) => {
    await assertSuperAdmin(transaction, tenantId, actorUserId);
    const [existing] = await transaction.select().from(roleDefinitions).where(and(eq(roleDefinitions.tenantId, tenantId), eq(roleDefinitions.id, roleId))).limit(1).for("update");
    if (!existing) throw new RoleRepositoryError("not_found");
    if (existing.roleClass !== input.roleClass) throw new RoleRepositoryError("invalid_permissions");
    const beforePermissions = await transaction.select({ key: rolePermissions.permissionKey }).from(rolePermissions).where(and(eq(rolePermissions.tenantId, tenantId), eq(rolePermissions.roleDefinitionId, roleId)));
    try {
      await transaction.update(roleDefinitions).set({
        name: existing.isSystem ? existing.name : input.name,
        description: input.description,
        legacyRoleKey: input.roleClass === "admin" ? "partner" : input.legacyRoleKey,
        version: sql`${roleDefinitions.version} + 1`,
        updatedAt: new Date(),
      }).where(and(eq(roleDefinitions.tenantId, tenantId), eq(roleDefinitions.id, roleId)));
    } catch (error) {
      if ((error as { code?: string }).code === "23505") throw new RoleRepositoryError("duplicate");
      throw error;
    }
    await transaction.delete(rolePermissions).where(and(eq(rolePermissions.tenantId, tenantId), eq(rolePermissions.roleDefinitionId, roleId)));
    if (input.permissions.length) await transaction.insert(rolePermissions).values(input.permissions.map((permissionKey) => ({ tenantId, roleDefinitionId: roleId, permissionKey })));
    const memberships = await transaction.select({ id: tenantMemberships.id }).from(tenantMemberships).where(and(eq(tenantMemberships.tenantId, tenantId), eq(tenantMemberships.roleDefinitionId, roleId), eq(tenantMemberships.status, "active")));
    if (memberships.length) {
      await transaction.update(tenantMemberships).set({ authorizationVersion: sql`${tenantMemberships.authorizationVersion} + 1` }).where(and(eq(tenantMemberships.tenantId, tenantId), eq(tenantMemberships.roleDefinitionId, roleId)));
      await transaction.update(userSessions).set({ revokedAt: new Date() }).where(and(inArray(userSessions.membershipId, memberships.map((membership) => membership.id)), isNull(userSessions.revokedAt)));
    }
    await transaction.insert(auditEvents).values({
      tenantId, actorUserId, resourceType: "role_definition", resourceId: roleId, action: "role.updated",
      reason: JSON.stringify({ before: { name: existing.name, permissions: beforePermissions.map((item) => item.key) }, after: { name: input.name, permissions: input.permissions }, affectedUsers: memberships.length }),
    });
  });
}

export async function archiveRoleDefinition(database: DashboardDatabase, tenantId: string, actorUserId: string, roleId: string) {
  await database.transaction(async (transaction) => {
    await assertSuperAdmin(transaction, tenantId, actorUserId);
    const [role] = await transaction.select().from(roleDefinitions).where(and(eq(roleDefinitions.tenantId, tenantId), eq(roleDefinitions.id, roleId))).limit(1).for("update");
    if (!role) throw new RoleRepositoryError("not_found");
    if (role.isSystem) throw new RoleRepositoryError("system_role");
    const [assigned] = await transaction.select({ value: count() }).from(tenantMemberships).where(and(eq(tenantMemberships.tenantId, tenantId), eq(tenantMemberships.roleDefinitionId, roleId), eq(tenantMemberships.status, "active")));
    if (Number(assigned?.value ?? 0) > 0) throw new RoleRepositoryError("in_use");
    await transaction.update(roleDefinitions).set({ status: "archived", version: sql`${roleDefinitions.version} + 1`, updatedAt: new Date() }).where(eq(roleDefinitions.id, roleId));
    await transaction.insert(auditEvents).values({ tenantId, actorUserId, resourceType: "role_definition", resourceId: roleId, action: "role.archived", reason: role.name });
  });
}
