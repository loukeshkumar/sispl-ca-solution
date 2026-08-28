import { and, eq, gt, inArray, isNull, sql } from "drizzle-orm";

import {
  authRateLimits,
  roleDefinitions,
  rolePermissions,
  tenantMemberships,
  tenants,
  userCredentials,
  userSessions,
  users,
} from "../../db/schema";
import type { DashboardDatabase } from "../dashboard/postgres/repository";
import { allPermissions, legacyPermissionsForRole, type AccessClass, type Permission } from "./authorization";
import { hashPassword, validateNewPassword, verifyPassword } from "./password";

export type LoginIdentity = {
  accessClass: AccessClass;
  membershipId: string;
  userId: string;
  email: string;
  fullName: string;
  roleKey: string;
  roleDefinitionId: string | null;
  roleName: string;
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  passwordHash: string;
  failedLoginAttempts: number;
  lockedUntil: Date | null;
  mustChangePassword: boolean;
};

export type AuthSession = Omit<LoginIdentity, "passwordHash" | "failedLoginAttempts" | "lockedUntil"> & {
  sessionId: string;
  expiresAt: Date;
  permissions: Permission[];
};

export async function findLoginIdentity(
  database: DashboardDatabase,
  email: string,
  tenantSlug: string,
): Promise<LoginIdentity | null> {
  const normalizedEmail = email.trim().toLowerCase();
  const normalizedSlug = tenantSlug.trim().toLowerCase();
  if (!normalizedEmail || !normalizedSlug) return null;

  const [identity] = await database
    .select({
      membershipId: tenantMemberships.id,
      accessClass: tenantMemberships.accessClass,
      userId: users.id,
      email: users.email,
      fullName: users.fullName,
      roleKey: tenantMemberships.roleKey,
      roleDefinitionId: tenantMemberships.roleDefinitionId,
      roleName: roleDefinitions.name,
      tenantId: tenants.id,
      tenantName: tenants.displayName,
      tenantSlug: tenants.slug,
      passwordHash: userCredentials.passwordHash,
      failedLoginAttempts: userCredentials.failedLoginAttempts,
      lockedUntil: userCredentials.lockedUntil,
      mustChangePassword: userCredentials.mustChangePassword,
    })
    .from(users)
    .innerJoin(userCredentials, eq(userCredentials.userId, users.id))
    .innerJoin(tenantMemberships, eq(tenantMemberships.userId, users.id))
    .leftJoin(roleDefinitions, and(eq(roleDefinitions.tenantId, tenantMemberships.tenantId), eq(roleDefinitions.id, tenantMemberships.roleDefinitionId)))
    .innerJoin(tenants, eq(tenants.id, tenantMemberships.tenantId))
    .where(and(
      eq(sql`lower(${users.email})`, normalizedEmail),
      eq(sql`lower(${tenants.slug})`, normalizedSlug),
      eq(users.status, "active"),
      eq(tenantMemberships.status, "active"),
      eq(tenants.status, "active"),
    ))
    .limit(1);

  if (!identity) return null;
  if (identity.accessClass !== "super_admin" && identity.roleDefinitionId && !identity.roleName) return null;
  return {
    ...identity,
    accessClass: identity.accessClass as AccessClass,
    roleName: identity.accessClass === "super_admin" ? "Super Admin" : identity.roleName ?? "Legacy role",
  };
}

export async function recordFailedLogin(
  database: DashboardDatabase,
  identity: Pick<LoginIdentity, "userId">,
  now = new Date(),
) {
  await database
    .update(userCredentials)
    .set({
      failedLoginAttempts: sql`case when ${userCredentials.failedLoginAttempts} >= 4 then 0 else ${userCredentials.failedLoginAttempts} + 1 end`,
      lockedUntil: sql`case when ${userCredentials.failedLoginAttempts} >= 4 then ${new Date(now.getTime() + 15 * 60_000)}::timestamptz else null end`,
    })
    .where(eq(userCredentials.userId, identity.userId));
}

export async function clearFailedLogins(database: DashboardDatabase, userId: string) {
  await database
    .update(userCredentials)
    .set({ failedLoginAttempts: 0, lockedUntil: null })
    .where(eq(userCredentials.userId, userId));
}

export async function consumeLoginRateLimit(
  database: DashboardDatabase,
  keyHash: string,
  now: Date,
  maximumAttempts: number,
  windowMs = 10 * 60_000,
  blockMs = 15 * 60_000,
) {
  const windowStart = new Date(now.getTime() - windowMs);
  const blockUntil = new Date(now.getTime() + blockMs);
  const [result] = await database.insert(authRateLimits).values({
    keyHash,
    attemptCount: 1,
    windowStartedAt: now,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: authRateLimits.keyHash,
    set: {
      attemptCount: sql`case
        when ${authRateLimits.blockedUntil} > ${now}::timestamptz then ${authRateLimits.attemptCount}
        when ${authRateLimits.windowStartedAt} <= ${windowStart}::timestamptz then 1
        else ${authRateLimits.attemptCount} + 1
      end`,
      windowStartedAt: sql`case when ${authRateLimits.windowStartedAt} <= ${windowStart}::timestamptz then ${now}::timestamptz else ${authRateLimits.windowStartedAt} end`,
      blockedUntil: sql`case
        when ${authRateLimits.blockedUntil} > ${now}::timestamptz then ${authRateLimits.blockedUntil}
        when ${authRateLimits.windowStartedAt} <= ${windowStart}::timestamptz then null
        when ${authRateLimits.attemptCount} + 1 >= ${maximumAttempts} then ${blockUntil}::timestamptz
        else null
      end`,
      updatedAt: now,
    },
  }).returning({ blockedUntil: authRateLimits.blockedUntil });
  return !(result?.blockedUntil && result.blockedUntil > now);
}

export async function clearLoginRateLimits(database: DashboardDatabase, keyHashes: string[]) {
  if (keyHashes.length === 0) return;
  await database.delete(authRateLimits).where(inArray(authRateLimits.keyHash, keyHashes));
}

export async function createSessionRecord(
  database: DashboardDatabase,
  input: { membershipId: string; tokenHash: string; expiresAt: Date },
) {
  const [session] = await database
    .insert(userSessions)
    .values(input)
    .returning({ id: userSessions.id });
  if (!session) throw new Error("The session could not be created.");
  return session.id;
}

export async function findSessionByTokenHash(
  database: DashboardDatabase,
  tokenHash: string,
  now = new Date(),
): Promise<AuthSession | null> {
  if (!tokenHash) return null;

  const [session] = await database
    .select({
      sessionId: userSessions.id,
      expiresAt: userSessions.expiresAt,
      membershipId: tenantMemberships.id,
      accessClass: tenantMemberships.accessClass,
      userId: users.id,
      email: users.email,
      fullName: users.fullName,
      roleKey: tenantMemberships.roleKey,
      roleDefinitionId: tenantMemberships.roleDefinitionId,
      roleName: roleDefinitions.name,
      tenantId: tenants.id,
      tenantName: tenants.displayName,
      tenantSlug: tenants.slug,
      mustChangePassword: userCredentials.mustChangePassword,
    })
    .from(userSessions)
    .innerJoin(tenantMemberships, eq(tenantMemberships.id, userSessions.membershipId))
    .leftJoin(roleDefinitions, and(eq(roleDefinitions.tenantId, tenantMemberships.tenantId), eq(roleDefinitions.id, tenantMemberships.roleDefinitionId), eq(roleDefinitions.status, "active")))
    .innerJoin(users, eq(users.id, tenantMemberships.userId))
    .innerJoin(userCredentials, eq(userCredentials.userId, users.id))
    .innerJoin(tenants, eq(tenants.id, tenantMemberships.tenantId))
    .where(and(
      eq(userSessions.tokenHash, tokenHash),
      gt(userSessions.expiresAt, now),
      isNull(userSessions.revokedAt),
      eq(users.status, "active"),
      eq(tenantMemberships.status, "active"),
      eq(tenants.status, "active"),
    ))
    .limit(1);

  if (!session) return null;
  if (session.accessClass !== "super_admin" && session.roleDefinitionId && !session.roleName) return null;
  const permissions = session.accessClass === "super_admin"
    ? allPermissions
    : session.roleDefinitionId
      ? (await database.select({ key: rolePermissions.permissionKey }).from(rolePermissions).where(and(
          eq(rolePermissions.tenantId, session.tenantId),
          eq(rolePermissions.roleDefinitionId, session.roleDefinitionId),
        ))).map((permission) => permission.key).filter((key): key is Permission => allPermissions.includes(key as Permission))
      : legacyPermissionsForRole(session.roleKey);
  return {
    ...session,
    accessClass: session.accessClass as AccessClass,
    roleName: session.accessClass === "super_admin" ? "Super Admin" : session.roleName ?? "Legacy role",
    permissions,
  };
}

export async function revokeSessionByTokenHash(
  database: DashboardDatabase,
  tokenHash: string,
  revokedAt = new Date(),
) {
  await database
    .update(userSessions)
    .set({ revokedAt })
    .where(and(eq(userSessions.tokenHash, tokenHash), isNull(userSessions.revokedAt)));
}

export class PasswordChangeError extends Error {
  constructor(public readonly code: "no_credential" | "invalid_current" | "invalid_new") {
    super({
      no_credential: "This account has no login to change.",
      invalid_current: "The current password is incorrect.",
      invalid_new: "Choose a different password containing between 12 and 128 characters.",
    }[code]);
    this.name = "PasswordChangeError";
  }
}

/**
 * Replace a password the holder knows.
 *
 * Serves both the forced first sign-in and a voluntary change, because the two
 * differ only in what sent the person here: either way the current password is
 * proved, the new one may not repeat it, and every session is revoked so a
 * stolen cookie does not outlive the password it was issued against.
 *
 * The update is conditional on the hash it read, so two concurrent changes
 * cannot both report success.
 */
export async function changePassword(
  database: DashboardDatabase,
  userId: string,
  currentPassword: string,
  newPassword: string,
) {
  const [credential] = await database.select({
    passwordHash: userCredentials.passwordHash,
  }).from(userCredentials).where(eq(userCredentials.userId, userId)).limit(1);
  if (!credential) throw new PasswordChangeError("no_credential");
  if (!await verifyPassword(currentPassword, credential.passwordHash)) throw new PasswordChangeError("invalid_current");
  if (validateNewPassword(newPassword) || await verifyPassword(newPassword, credential.passwordHash)) {
    throw new PasswordChangeError("invalid_new");
  }
  const passwordHash = await hashPassword(newPassword);
  await database.transaction(async (transaction) => {
    const [changed] = await transaction.update(userCredentials).set({
      passwordHash,
      mustChangePassword: false,
      failedLoginAttempts: 0,
      lockedUntil: null,
      passwordChangedAt: new Date(),
    }).where(and(
      eq(userCredentials.userId, userId),
      eq(userCredentials.passwordHash, credential.passwordHash),
    )).returning({ userId: userCredentials.userId });
    if (!changed) throw new PasswordChangeError("invalid_current");
    const memberships = await transaction.select({ id: tenantMemberships.id }).from(tenantMemberships).where(eq(tenantMemberships.userId, userId));
    if (memberships.length) {
      await transaction.update(userSessions).set({ revokedAt: new Date() }).where(and(
        inArray(userSessions.membershipId, memberships.map((membership) => membership.id)),
        isNull(userSessions.revokedAt),
      ));
    }
  });
}
