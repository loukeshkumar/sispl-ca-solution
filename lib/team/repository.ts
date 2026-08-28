import { randomUUID } from "node:crypto";
import { and, asc, count, desc, eq, isNull, ne, notInArray, sql } from "drizzle-orm";

import {
  auditEvents,
  employeeProfiles,
  employeeWorkProfiles,
  officeTasks,
  roleDefinitions,
  tenantMemberships,
  userCredentials,
  userSessions,
  users,
} from "../../db/schema";
import { hashPassword } from "../auth/password";
import { createTemporaryPassword } from "../auth/temporary-password";
import type { AccessClass, Role } from "../auth/authorization";
import type { DashboardDatabase } from "../dashboard/postgres/repository";
import { postExitEncashment } from "../attendance/leave-ledger-repository";
import type { Qualification } from "./capability";
import { blockingItems, defaultProbationEnd, isEmploymentStage, type EmploymentStage } from "./offboarding";
import { buildExitClearance } from "./offboarding-repository";
import type { EmployeeInput } from "./validation";

export class TeamRepositoryError extends Error {
  constructor(public readonly code: "not_found" | "duplicate_email" | "active_tasks" | "self_disable" | "shared_identity" | "invalid_role" | "role_forbidden" | "protected_super_admin" | "self_role_change" | "clearance_blocked" | "clearance_reason" | "invalid_stage" | "no_login") {
    super({
      not_found: "Employee not found.",
      duplicate_email: "An account already uses this email address.",
      active_tasks: "Reassign or complete every open task before disabling this employee.",
      self_disable: "You cannot disable your own employee account.",
      shared_identity: "This identity belongs to more than one firm and requires central account administration.",
      invalid_role: "Choose an active role from this firm.",
      role_forbidden: "Only a Super Admin can create or change an Admin account.",
      protected_super_admin: "Super Admin access is protected and cannot be changed from Employee Management.",
      self_role_change: "You cannot change your own access role.",
      clearance_blocked: "This employee still holds signing custody or open delivery work. Clear those items before disabling the account.",
      clearance_reason: "Some exit items are outstanding. Record why the firm is proceeding anyway.",
      invalid_stage: "Choose a valid employment stage and a date on or after the joining date.",
      no_login: "This employee has no login yet. Generate a temporary password instead.",
    }[code]);
    this.name = "TeamRepositoryError";
  }
}

async function assertExclusiveIdentity(database: Pick<DashboardDatabase, "select">, userId: string) {
  const memberships = await database.select({ id: tenantMemberships.id }).from(tenantMemberships).where(eq(tenantMemberships.userId, userId)).limit(2);
  if (memberships.length > 1) throw new TeamRepositoryError("shared_identity");
}

export type EmployeeSummary = {
  id: string;
  userId: string;
  employeeCode: string;
  fullName: string;
  email: string;
  roleKey: Role;
  accessClass: AccessClass;
  roleDefinitionId: string | null;
  roleName: string;
  status: string;
  designation: string;
  qualification: Qualification;
  membershipNumber: string;
  qualifiedOn: string | null;
  mobileNumber: string;
  joiningDate: string;
  employmentEndDate: string | null;
  employmentStage: EmploymentStage;
  probationEndDate: string | null;
  confirmedOn: string | null;
  noticeStartDate: string | null;
  exitReason: string;
  notes: string;
  loginEnabled: boolean;
  mustChangePassword: boolean;
  activeTaskCount: number;
  overdueTaskCount: number;
};

export type Employee360Data = EmployeeSummary & {
  tasks: Array<{ id: string; title: string; priority: string; status: string; dueDate: string }>;
};

function indiaDateKey(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export async function listEmployees(database: DashboardDatabase, tenantId: string, todayKey = indiaDateKey()): Promise<EmployeeSummary[]> {
  if (!tenantId.trim()) throw new Error("tenantId is required.");
  const rows = await database.select({
    id: employeeProfiles.id,
    userId: users.id,
    employeeCode: employeeProfiles.employeeCode,
    fullName: users.fullName,
    email: users.email,
    roleKey: tenantMemberships.roleKey,
    accessClass: tenantMemberships.accessClass,
    roleDefinitionId: tenantMemberships.roleDefinitionId,
    roleName: roleDefinitions.name,
    status: tenantMemberships.status,
    designation: employeeProfiles.designation,
    qualification: sql<Qualification>`${employeeProfiles.qualification}`,
    membershipNumber: employeeProfiles.membershipNumber,
    qualifiedOn: employeeProfiles.qualifiedOn,
    mobileNumber: employeeProfiles.mobileNumber,
    joiningDate: employeeProfiles.joiningDate,
    employmentStage: sql<EmploymentStage>`${employeeProfiles.employmentStage}`,
    probationEndDate: employeeProfiles.probationEndDate,
    confirmedOn: employeeProfiles.confirmedOn,
    noticeStartDate: employeeProfiles.noticeStartDate,
    exitReason: employeeProfiles.exitReason,
    employmentEndDate: employeeProfiles.employmentEndDate,
    notes: employeeProfiles.notes,
    loginEnabled: sql<boolean>`${userCredentials.userId} is not null`,
    mustChangePassword: sql<boolean>`coalesce(${userCredentials.mustChangePassword}, false)`,
    activeTaskCount: count(officeTasks.id),
    overdueTaskCount: sql<number>`count(${officeTasks.id}) filter (where ${officeTasks.dueDate} < ${todayKey} and ${officeTasks.status} in ('todo', 'in_progress', 'waiting', 'review'))`.mapWith(Number),
  }).from(employeeProfiles)
    .innerJoin(users, eq(users.id, employeeProfiles.userId))
    .innerJoin(tenantMemberships, and(eq(tenantMemberships.tenantId, tenantId), eq(tenantMemberships.userId, employeeProfiles.userId)))
    .leftJoin(roleDefinitions, and(eq(roleDefinitions.tenantId, tenantId), eq(roleDefinitions.id, tenantMemberships.roleDefinitionId)))
    .leftJoin(userCredentials, eq(userCredentials.userId, employeeProfiles.userId))
    .leftJoin(officeTasks, and(
      eq(officeTasks.tenantId, tenantId),
      eq(officeTasks.assigneeId, employeeProfiles.userId),
      notInArray(officeTasks.status, ["completed", "cancelled"]),
    ))
    .where(eq(employeeProfiles.tenantId, tenantId))
    .groupBy(employeeProfiles.id, users.id, tenantMemberships.id, roleDefinitions.name, userCredentials.userId, userCredentials.mustChangePassword)
    .orderBy(asc(users.fullName));
  return rows.map((row) => ({ ...row, accessClass: row.accessClass as AccessClass, roleKey: row.roleKey as Role, roleName: row.accessClass === "super_admin" ? "Super Admin" : row.roleName ?? "Unassigned", activeTaskCount: Number(row.activeTaskCount), overdueTaskCount: Number(row.overdueTaskCount) }));
}

async function resolveRoleAssignment(database: DashboardDatabase, tenantId: string, actorUserId: string, roleDefinitionId?: string, legacyRoleKey?: Role) {
  if (!roleDefinitionId && (!legacyRoleKey || legacyRoleKey === "firm_administrator")) throw new TeamRepositoryError("invalid_role");
  const [[actor], [role]] = await Promise.all([
    database.select({ accessClass: tenantMemberships.accessClass }).from(tenantMemberships).where(and(eq(tenantMemberships.tenantId, tenantId), eq(tenantMemberships.userId, actorUserId), eq(tenantMemberships.status, "active"))).limit(1),
    database.select({ id: roleDefinitions.id, roleClass: roleDefinitions.roleClass, legacyRoleKey: roleDefinitions.legacyRoleKey, name: roleDefinitions.name }).from(roleDefinitions).where(and(
      eq(roleDefinitions.tenantId, tenantId),
      roleDefinitionId ? eq(roleDefinitions.id, roleDefinitionId) : eq(roleDefinitions.key, legacyRoleKey!),
      eq(roleDefinitions.status, "active"),
    )).limit(1),
  ]);
  if (!actor || !role) throw new TeamRepositoryError("invalid_role");
  if (role.roleClass === "admin" && actor.accessClass !== "super_admin") throw new TeamRepositoryError("role_forbidden");
  return { actorAccessClass: actor.accessClass as AccessClass, role: role as { id: string; roleClass: "admin" | "employee"; legacyRoleKey: Exclude<Role, "firm_administrator">; name: string } };
}

export async function getEmployee360(database: DashboardDatabase, tenantId: string, employeeId: string): Promise<Employee360Data | null> {
  if (!tenantId.trim() || !employeeId.trim()) return null;
  const employee = (await listEmployees(database, tenantId)).find((item) => item.id === employeeId);
  if (!employee) return null;
  const tasks = await database.select({
    id: officeTasks.id,
    title: officeTasks.title,
    priority: officeTasks.priority,
    status: officeTasks.status,
    dueDate: officeTasks.dueDate,
  }).from(officeTasks).where(and(
    eq(officeTasks.tenantId, tenantId),
    eq(officeTasks.assigneeId, employee.userId),
  )).orderBy(asc(officeTasks.dueDate), desc(officeTasks.createdAt));
  return { ...employee, tasks };
}

export async function createEmployee(database: DashboardDatabase, tenantId: string, actorUserId: string, input: EmployeeInput) {
  if (!tenantId.trim() || !actorUserId.trim()) throw new Error("Tenant and actor are required.");
  return database.transaction(async (transaction) => {
    await transaction.execute(sql`select pg_advisory_xact_lock(hashtextextended(${tenantId}, 0))`);
    const { role } = await resolveRoleAssignment(transaction, tenantId, actorUserId, input.roleDefinitionId, input.roleKey);
    const [existing] = await transaction.select({ id: users.id }).from(users).where(eq(sql`lower(${users.email})`, input.email)).limit(1);
    if (existing) throw new TeamRepositoryError("duplicate_email");
    const [lastProfile] = await transaction.select({ employeeCode: employeeProfiles.employeeCode }).from(employeeProfiles)
      .where(eq(employeeProfiles.tenantId, tenantId)).orderBy(desc(employeeProfiles.employeeCode)).limit(1);
    const previousOrdinal = Number(lastProfile?.employeeCode.match(/(\d+)$/)?.[1] ?? 0);
    const employeeCode = `EMP-${String(previousOrdinal + 1).padStart(4, "0")}`;
    const userId = randomUUID();
    const membershipId = randomUUID();
    const employeeId = randomUUID();
    await transaction.insert(users).values({ id: userId, email: input.email, fullName: input.fullName, status: "active" });
    await transaction.insert(tenantMemberships).values({ id: membershipId, tenantId, userId, roleKey: role.legacyRoleKey, accessClass: role.roleClass, roleDefinitionId: role.id, status: "active" });
    await transaction.insert(employeeProfiles).values({
      id: employeeId,
      tenantId,
      userId,
      employeeCode,
      designation: input.designation,
      qualification: input.qualification,
      membershipNumber: input.membershipNumber,
      qualifiedOn: input.qualifiedOn,
      mobileNumber: input.mobileNumber,
      joiningDate: input.joiningDate,
      // A new joiner starts on probation. The column defaults to `confirmed`
      // only so profiles that predate the lifecycle read correctly without a
      // migration inventing history; a fresh row has no confirmation date, and
      // `confirmed` without one is refused by the database, as it should be.
      employmentStage: "probation",
      probationEndDate: defaultProbationEnd(input.joiningDate),
      notes: input.notes,
    });
    await transaction.insert(employeeWorkProfiles).values({
      id: randomUUID(), tenantId, employeeUserId: userId, managerUserId: null,
      employmentType: "employee", workLocationState: "Bihar",
    });
    await transaction.insert(auditEvents).values({ tenantId, actorUserId, resourceType: "employee", resourceId: employeeId, action: role.roleClass === "admin" ? "admin.created" : "employee.created", reason: JSON.stringify({ employeeCode, roleId: role.id, roleName: role.name }) });
    return { employeeId, userId };
  });
}

export async function updateEmployee(database: DashboardDatabase, tenantId: string, actorUserId: string, employeeId: string, input: EmployeeInput) {
  await database.transaction(async (transaction) => {
    await transaction.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${tenantId}:attendance`}, 0))`);
    const { actorAccessClass, role } = await resolveRoleAssignment(transaction, tenantId, actorUserId, input.roleDefinitionId, input.roleKey);
    const [employee] = await transaction.select({ userId: employeeProfiles.userId, membershipId: tenantMemberships.id, accessClass: tenantMemberships.accessClass, roleDefinitionId: tenantMemberships.roleDefinitionId }).from(employeeProfiles)
      .innerJoin(tenantMemberships, and(eq(tenantMemberships.tenantId, tenantId), eq(tenantMemberships.userId, employeeProfiles.userId)))
      .where(and(eq(employeeProfiles.id, employeeId), eq(employeeProfiles.tenantId, tenantId))).limit(1).for("update", { of: tenantMemberships });
    if (!employee) throw new TeamRepositoryError("not_found");
    if (employee.accessClass === "super_admin") throw new TeamRepositoryError("protected_super_admin");
    if (employee.userId === actorUserId && employee.roleDefinitionId !== role.id) throw new TeamRepositoryError("self_role_change");
    if ((employee.accessClass === "admin" || role.roleClass === "admin") && actorAccessClass !== "super_admin") throw new TeamRepositoryError("role_forbidden");
    await assertExclusiveIdentity(transaction, employee.userId);
    const [emailOwner] = await transaction.select({ id: users.id }).from(users).where(and(eq(sql`lower(${users.email})`, input.email), ne(users.id, employee.userId))).limit(1);
    if (emailOwner) throw new TeamRepositoryError("duplicate_email");
    await transaction.update(users).set({ email: input.email, fullName: input.fullName }).where(eq(users.id, employee.userId));
    const roleChanged = employee.roleDefinitionId !== role.id || employee.accessClass !== role.roleClass;
    await transaction.update(tenantMemberships).set({ roleKey: role.legacyRoleKey, accessClass: role.roleClass, roleDefinitionId: role.id, ...(roleChanged ? { authorizationVersion: sql`${tenantMemberships.authorizationVersion} + 1` } : {}) }).where(and(eq(tenantMemberships.tenantId, tenantId), eq(tenantMemberships.userId, employee.userId)));
    await transaction.update(employeeProfiles).set({
      designation: input.designation,
      qualification: input.qualification,
      membershipNumber: input.membershipNumber,
      qualifiedOn: input.qualifiedOn,
      mobileNumber: input.mobileNumber,
      joiningDate: input.joiningDate,
      notes: input.notes,
      updatedAt: new Date(),
    }).where(eq(employeeProfiles.id, employeeId));
    if (roleChanged) await transaction.update(userSessions).set({ revokedAt: new Date() }).where(and(eq(userSessions.membershipId, employee.membershipId), isNull(userSessions.revokedAt)));
    await transaction.insert(auditEvents).values({ tenantId, actorUserId, resourceType: "employee", resourceId: employeeId, action: roleChanged ? "employee.role_changed" : "employee.updated", reason: JSON.stringify({ beforeRoleId: employee.roleDefinitionId, afterRoleId: role.id, afterRoleName: role.name }) });
  });
}

export async function provisionEmployeeAccess(database: DashboardDatabase, tenantId: string, actorUserId: string, employeeId: string) {
  const temporaryPassword = createTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);
  await database.transaction(async (transaction) => {
    const [actor] = await transaction.select({ accessClass: tenantMemberships.accessClass }).from(tenantMemberships).where(and(eq(tenantMemberships.tenantId, tenantId), eq(tenantMemberships.userId, actorUserId), eq(tenantMemberships.status, "active"))).limit(1);
    const [employee] = await transaction.select({ userId: employeeProfiles.userId, membershipId: tenantMemberships.id, accessClass: tenantMemberships.accessClass }).from(employeeProfiles)
      .innerJoin(tenantMemberships, and(eq(tenantMemberships.tenantId, tenantId), eq(tenantMemberships.userId, employeeProfiles.userId)))
      .where(and(eq(employeeProfiles.id, employeeId), eq(employeeProfiles.tenantId, tenantId), eq(tenantMemberships.status, "active"))).limit(1);
    if (!employee) throw new TeamRepositoryError("not_found");
    if (employee.accessClass === "super_admin") throw new TeamRepositoryError("protected_super_admin");
    if (employee.accessClass === "admin" && actor?.accessClass !== "super_admin") throw new TeamRepositoryError("role_forbidden");
    await assertExclusiveIdentity(transaction, employee.userId);
    await transaction.insert(userCredentials).values({ userId: employee.userId, passwordHash, mustChangePassword: true })
      .onConflictDoUpdate({ target: userCredentials.userId, set: { passwordHash, mustChangePassword: true, failedLoginAttempts: 0, lockedUntil: null, passwordChangedAt: new Date() } });
    await transaction.update(userSessions).set({ revokedAt: new Date() }).where(and(eq(userSessions.membershipId, employee.membershipId), sql`${userSessions.revokedAt} is null`));
    await transaction.insert(auditEvents).values({ tenantId, actorUserId, resourceType: "employee", resourceId: employeeId, action: "employee.access_provisioned" });
  });
  return temporaryPassword;
}

/**
 * Require a new password at the next sign-in without issuing one.
 *
 * The difference from provisioning is what the person is left holding: a reset
 * hands them a temporary password somebody has to deliver, while expiry leaves
 * the password they already know and only refuses to let them keep it. Sessions
 * still go, so the requirement cannot be outrun by staying signed in.
 */
export async function expireEmployeePassword(database: DashboardDatabase, tenantId: string, actorUserId: string, employeeId: string) {
  await database.transaction(async (transaction) => {
    const [actor] = await transaction.select({ accessClass: tenantMemberships.accessClass }).from(tenantMemberships).where(and(eq(tenantMemberships.tenantId, tenantId), eq(tenantMemberships.userId, actorUserId), eq(tenantMemberships.status, "active"))).limit(1);
    const [employee] = await transaction.select({ userId: employeeProfiles.userId, membershipId: tenantMemberships.id, accessClass: tenantMemberships.accessClass }).from(employeeProfiles)
      .innerJoin(tenantMemberships, and(eq(tenantMemberships.tenantId, tenantId), eq(tenantMemberships.userId, employeeProfiles.userId)))
      .where(and(eq(employeeProfiles.id, employeeId), eq(employeeProfiles.tenantId, tenantId), eq(tenantMemberships.status, "active"))).limit(1);
    if (!employee) throw new TeamRepositoryError("not_found");
    if (employee.accessClass === "super_admin") throw new TeamRepositoryError("protected_super_admin");
    if (employee.accessClass === "admin" && actor?.accessClass !== "super_admin") throw new TeamRepositoryError("role_forbidden");
    await assertExclusiveIdentity(transaction, employee.userId);
    // Nothing to expire on an account that was never given a login.
    const [expired] = await transaction.update(userCredentials).set({ mustChangePassword: true })
      .where(eq(userCredentials.userId, employee.userId)).returning({ userId: userCredentials.userId });
    if (!expired) throw new TeamRepositoryError("no_login");
    await transaction.update(userSessions).set({ revokedAt: new Date() }).where(and(eq(userSessions.membershipId, employee.membershipId), sql`${userSessions.revokedAt} is null`));
    await transaction.insert(auditEvents).values({ tenantId, actorUserId, resourceType: "employee", resourceId: employeeId, action: "employee.password_expired" });
  });
}

/**
 * Move somebody through their employment.
 *
 * Each stage has to be evidenced by the date that put them in it, which the
 * database enforces — a "confirmed" employee with no confirmation date is a
 * claim nobody can check.
 */
export async function setEmploymentStage(
  database: DashboardDatabase,
  tenantId: string,
  actorUserId: string,
  employeeId: string,
  input: { effectiveOn: string; probationEndDate: string | null; reason: string; stage: string },
) {
  if (!isEmploymentStage(input.stage) || input.stage === "exited") throw new TeamRepositoryError("invalid_stage");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.effectiveOn)) throw new TeamRepositoryError("invalid_stage");

  await database.transaction(async (transaction) => {
    const [employee] = await transaction.select({ joiningDate: employeeProfiles.joiningDate, userId: employeeProfiles.userId })
      .from(employeeProfiles)
      .where(and(eq(employeeProfiles.id, employeeId), eq(employeeProfiles.tenantId, tenantId))).limit(1).for("update");
    if (!employee) throw new TeamRepositoryError("not_found");
    if (input.effectiveOn < employee.joiningDate) throw new TeamRepositoryError("invalid_stage");

    const [updated] = await transaction.update(employeeProfiles).set({
      employmentStage: input.stage,
      probationEndDate: input.stage === "probation" ? input.probationEndDate : undefined,
      confirmedOn: input.stage === "confirmed" ? input.effectiveOn : undefined,
      noticeStartDate: input.stage === "notice" ? input.effectiveOn : undefined,
      exitReason: input.stage === "notice" ? input.reason.slice(0, 300) : undefined,
      updatedAt: new Date(),
    }).where(and(eq(employeeProfiles.id, employeeId), eq(employeeProfiles.tenantId, tenantId)))
      .returning({ id: employeeProfiles.id });
    if (!updated) throw new TeamRepositoryError("not_found");

    await transaction.insert(auditEvents).values({
      tenantId, actorUserId, resourceType: "employee", resourceId: employeeId,
      action: `employee.${input.stage}`,
      reason: input.reason.slice(0, 300) || `Effective ${input.effectiveOn}`,
    });
  });
}

export async function disableEmployee(
  database: DashboardDatabase,
  tenantId: string,
  actorUserId: string,
  employeeId: string,
  disabledAt = new Date(),
  clearanceNote = "",
) {
  const attendancePeriodKey = indiaDateKey(disabledAt).slice(0, 7);
  let employeeUserIdOf = "";
  await database.transaction(async (transaction) => {
    await transaction.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${tenantId}:attendance`}, 0))`);
    await transaction.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${tenantId}:attendance:${attendancePeriodKey}`}, 0))`);
    const [actor] = await transaction.select({ accessClass: tenantMemberships.accessClass }).from(tenantMemberships).where(and(eq(tenantMemberships.tenantId, tenantId), eq(tenantMemberships.userId, actorUserId), eq(tenantMemberships.status, "active"))).limit(1);
    const [employee] = await transaction.select({ userId: employeeProfiles.userId, membershipId: tenantMemberships.id, accessClass: tenantMemberships.accessClass }).from(employeeProfiles)
      .innerJoin(tenantMemberships, and(eq(tenantMemberships.tenantId, tenantId), eq(tenantMemberships.userId, employeeProfiles.userId)))
      .where(and(eq(employeeProfiles.id, employeeId), eq(employeeProfiles.tenantId, tenantId)))
      .limit(1).for("update", { of: tenantMemberships });
    if (!employee) throw new TeamRepositoryError("not_found");
    if (employee.accessClass === "super_admin") throw new TeamRepositoryError("protected_super_admin");
    if (employee.accessClass === "admin" && actor?.accessClass !== "super_admin") throw new TeamRepositoryError("role_forbidden");
    if (employee.userId === actorUserId) throw new TeamRepositoryError("self_disable");
    employeeUserIdOf = employee.userId;
    // What the firm would lose track of, worked out rather than remembered.
    // Custody and open delivery refuse the exit outright; softer items can be
    // proceeded past, but only by somebody willing to say why in the record.
    const todayKey = indiaDateKey(disabledAt);
    const clearance = await buildExitClearance(transaction, tenantId, employee.userId, todayKey);
    if (blockingItems(clearance).length > 0) throw new TeamRepositoryError("clearance_blocked");
    const reason = clearanceNote.trim().slice(0, 500);
    if (clearance.needsReason && reason.length < 3) throw new TeamRepositoryError("clearance_reason");
    const [membership] = await transaction.update(tenantMemberships).set({ status: "disabled" }).where(and(
      eq(tenantMemberships.id, employee.membershipId), eq(tenantMemberships.status, "active"),
    )).returning({ id: tenantMemberships.id });
    if (!membership) throw new TeamRepositoryError("not_found");
    await transaction.update(employeeProfiles).set({
      employmentEndDate: todayKey,
      employmentStage: "exited",
      exitClearanceNote: reason,
      updatedAt: disabledAt,
    }).where(and(
      eq(employeeProfiles.tenantId, tenantId), eq(employeeProfiles.userId, employee.userId), sql`${employeeProfiles.employmentEndDate} is null`,
    ));
    await transaction.update(userSessions).set({ revokedAt: disabledAt }).where(and(eq(userSessions.membershipId, membership.id), sql`${userSessions.revokedAt} is null`));
    await transaction.insert(auditEvents).values({
      tenantId, actorUserId, resourceType: "employee", resourceId: employeeId, action: "employee.disabled",
      reason: reason || null,
    });
    if (reason) {
      await transaction.insert(auditEvents).values({
        tenantId, actorUserId, resourceType: "employee", resourceId: employeeId,
        action: "employee.exit_clearance_override",
        reason: `${clearance.items.filter((item) => item.severity === "warning").map((item) => item.title).join("; ")} — ${reason}`,
      });
    }
  });

  // Outside the exit transaction on purpose: settling leave is a payroll act
  // that must not be able to roll back the disabling of an account.
  await postExitEncashment(database, tenantId, actorUserId, employeeUserIdOf, indiaDateKey(disabledAt)).catch(() => []);
}
