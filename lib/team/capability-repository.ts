import { and, asc, eq, inArray, sql } from "drizzle-orm";

import { auditEvents, employeeCapabilities, employeeProfiles, serviceCatalog, tenantMemberships, users } from "../../db/schema";
import type { DashboardDatabase } from "../dashboard/postgres/repository";
import {
  benchRisk,
  isCapabilityLevel,
  meets,
  type BenchRow,
  type CapabilityLevel,
  type CapabilityRecord,
} from "./capability";

/**
 * Reading and writing what people are trusted to do.
 *
 * Capability is held against the service master's own codes, so the join to a
 * work item is direct: a work item's service resolves to a catalogue code, and
 * that code is what a capability is recorded against.
 */

export class CapabilityError extends Error {
  constructor(public readonly code: "not_found" | "self_assessment" | "unknown_service" | "invalid_level") {
    super({
      not_found: "That employee is not part of this firm.",
      self_assessment: "You cannot assess your own capability.",
      unknown_service: "Choose a service from the firm's service master.",
      invalid_level: "Choose a capability level.",
    }[code]);
    this.name = "CapabilityError";
  }
}

export type ServiceOption = { code: string; name: string; category: string };

export type CapabilityView = CapabilityRecord & {
  assessedByName: string;
  assessedOn: string;
  note: string;
  serviceName: string;
};

export type EmployeeCapabilityProfile = {
  capabilities: CapabilityView[];
  employeeUserId: string;
  fullName: string;
};

export async function listCapabilityServices(database: DashboardDatabase, tenantId: string): Promise<ServiceOption[]> {
  const rows = await database.select({
    category: serviceCatalog.category, code: serviceCatalog.code, name: serviceCatalog.name,
  }).from(serviceCatalog)
    .where(and(eq(serviceCatalog.tenantId, tenantId), eq(serviceCatalog.status, "active")))
    .orderBy(asc(serviceCatalog.category), asc(serviceCatalog.name));
  return rows.map((row) => ({ category: row.category, code: row.code.toUpperCase(), name: row.name }));
}

/** Everything recorded for one person, for the capability editor. */
export async function listEmployeeCapabilities(
  database: DashboardDatabase,
  tenantId: string,
  employeeUserId: string,
): Promise<CapabilityView[]> {
  const assessor = { id: users.id, fullName: users.fullName };
  const rows = await database.select({
    assessedByName: assessor.fullName,
    assessedOn: employeeCapabilities.assessedOn,
    level: employeeCapabilities.level,
    note: employeeCapabilities.note,
    serviceCode: employeeCapabilities.serviceCode,
    serviceName: serviceCatalog.name,
  }).from(employeeCapabilities)
    .leftJoin(users, eq(users.id, employeeCapabilities.assessedByUserId))
    .leftJoin(serviceCatalog, and(
      eq(serviceCatalog.tenantId, employeeCapabilities.tenantId),
      sql`upper(${serviceCatalog.code}) = upper(${employeeCapabilities.serviceCode})`,
    ))
    .where(and(eq(employeeCapabilities.tenantId, tenantId), eq(employeeCapabilities.employeeUserId, employeeUserId)))
    .orderBy(asc(employeeCapabilities.serviceCode));

  return rows.map((row) => ({
    assessedByName: row.assessedByName ?? "—",
    assessedOn: row.assessedOn,
    level: row.level as CapabilityLevel,
    note: row.note,
    serviceCode: row.serviceCode.toUpperCase(),
    // A capability outlives the catalogue entry it was recorded against; say so
    // rather than rendering an empty cell nobody can interpret.
    serviceName: row.serviceName ?? `${row.serviceCode} (retired service)`,
  }));
}

/** The whole matrix, for the bench view. */
export async function listCapabilityMatrix(database: DashboardDatabase, tenantId: string) {
  const [services, rows, members] = await Promise.all([
    listCapabilityServices(database, tenantId),
    database.select({
      employeeUserId: employeeCapabilities.employeeUserId,
      level: employeeCapabilities.level,
      serviceCode: employeeCapabilities.serviceCode,
    }).from(employeeCapabilities).where(eq(employeeCapabilities.tenantId, tenantId)),
    database.select({
      designation: employeeProfiles.designation,
      fullName: users.fullName,
      membershipNumber: employeeProfiles.membershipNumber,
      qualification: employeeProfiles.qualification,
      userId: employeeProfiles.userId,
    }).from(employeeProfiles)
      .innerJoin(users, eq(users.id, employeeProfiles.userId))
      .innerJoin(tenantMemberships, and(
        eq(tenantMemberships.tenantId, employeeProfiles.tenantId),
        eq(tenantMemberships.userId, employeeProfiles.userId),
      ))
      .where(and(eq(employeeProfiles.tenantId, tenantId), eq(tenantMemberships.status, "active")))
      .orderBy(asc(users.fullName)),
  ]);

  const byMember = new Map<string, Map<string, CapabilityLevel>>();
  for (const row of rows) {
    const code = row.serviceCode.toUpperCase();
    const existing = byMember.get(row.employeeUserId) ?? new Map<string, CapabilityLevel>();
    existing.set(code, row.level as CapabilityLevel);
    byMember.set(row.employeeUserId, existing);
  }

  const bench: BenchRow[] = services.map((service) => {
    const levels = [...byMember.values()].map((map) => map.get(service.code) ?? null);
    const row = {
      capable: levels.filter((level) => meets(level, "prepare")).length,
      learning: levels.filter((level) => level === "learning").length,
      reviewers: levels.filter((level) => meets(level, "review")).length,
      serviceCode: service.code,
      serviceName: service.name,
    };
    return row;
  });

  return {
    bench: bench.map((row) => ({ ...row, risk: benchRisk(row) })),
    members: members.map((member) => ({
      designation: member.designation,
      fullName: member.fullName,
      levels: Object.fromEntries(byMember.get(member.userId) ?? new Map()) as Record<string, CapabilityLevel>,
      membershipNumber: member.membershipNumber,
      qualification: member.qualification,
      userId: member.userId,
    })),
    services,
  };
}

export type CapabilityMatrix = Awaited<ReturnType<typeof listCapabilityMatrix>>;

export type CapabilityInput = { level: string; note: string; serviceCode: string };

/**
 * Record or revise one capability. Assessing is an act with an author and a
 * date, so both are stamped and the change is audited — a capability nobody
 * owns is not a control anybody can rely on.
 */
export async function saveEmployeeCapability(
  database: DashboardDatabase,
  tenantId: string,
  actorUserId: string,
  employeeUserId: string,
  input: CapabilityInput,
  todayKey: string,
) {
  if (actorUserId === employeeUserId) throw new CapabilityError("self_assessment");
  if (!isCapabilityLevel(input.level)) throw new CapabilityError("invalid_level");
  const serviceCode = input.serviceCode.trim().toUpperCase();

  return database.transaction(async (transaction) => {
    const [member] = await transaction.select({ userId: employeeProfiles.userId }).from(employeeProfiles)
      .where(and(eq(employeeProfiles.tenantId, tenantId), eq(employeeProfiles.userId, employeeUserId))).limit(1);
    if (!member) throw new CapabilityError("not_found");

    const [service] = await transaction.select({ code: serviceCatalog.code, name: serviceCatalog.name })
      .from(serviceCatalog).where(and(
        eq(serviceCatalog.tenantId, tenantId),
        eq(serviceCatalog.status, "active"),
        sql`upper(${serviceCatalog.code}) = ${serviceCode}`,
      )).limit(1);
    if (!service) throw new CapabilityError("unknown_service");

    const [saved] = await transaction.insert(employeeCapabilities).values({
      tenantId, employeeUserId, serviceCode, level: input.level,
      assessedByUserId: actorUserId, assessedOn: todayKey, note: input.note.slice(0, 500),
    }).onConflictDoUpdate({
      target: [employeeCapabilities.tenantId, employeeCapabilities.employeeUserId, employeeCapabilities.serviceCode],
      set: { level: input.level, assessedByUserId: actorUserId, assessedOn: todayKey, note: input.note.slice(0, 500), updatedAt: new Date() },
    }).returning({ id: employeeCapabilities.id });

    await transaction.insert(auditEvents).values({
      tenantId, actorUserId, resourceType: "employee_capability", resourceId: saved!.id,
      action: "capability.assessed", reason: `${service.name}: ${input.level}`,
    });
    return saved!.id;
  });
}

export async function removeEmployeeCapability(
  database: DashboardDatabase,
  tenantId: string,
  actorUserId: string,
  employeeUserId: string,
  serviceCode: string,
) {
  const code = serviceCode.trim().toUpperCase();
  await database.transaction(async (transaction) => {
    const [removed] = await transaction.delete(employeeCapabilities).where(and(
      eq(employeeCapabilities.tenantId, tenantId),
      eq(employeeCapabilities.employeeUserId, employeeUserId),
      sql`upper(${employeeCapabilities.serviceCode}) = ${code}`,
    )).returning({ id: employeeCapabilities.id });
    if (!removed) throw new CapabilityError("not_found");
    await transaction.insert(auditEvents).values({
      tenantId, actorUserId, resourceType: "employee_capability", resourceId: removed.id,
      action: "capability.withdrawn", reason: code,
    });
  });
}

/** Capability for a set of members against one service, for a picker. */
export async function levelsForService(
  database: DashboardDatabase,
  tenantId: string,
  serviceCode: string,
): Promise<Map<string, CapabilityLevel>> {
  const rows = await database.select({
    employeeUserId: employeeCapabilities.employeeUserId,
    level: employeeCapabilities.level,
  }).from(employeeCapabilities).where(and(
    eq(employeeCapabilities.tenantId, tenantId),
    sql`upper(${employeeCapabilities.serviceCode}) = ${serviceCode.toUpperCase()}`,
  ));
  return new Map(rows.map((row) => [row.employeeUserId, row.level as CapabilityLevel]));
}

/**
 * Which services the firm has begun to govern.
 *
 * A service with at least one recorded reviewer is one the firm has taken a view
 * on, and the reviewer gate applies to it. Everything else stays open, so the
 * matrix can be filled in at the firm's own pace instead of all at once.
 */
export async function governedServices(database: DashboardDatabase, tenantId: string): Promise<Set<string>> {
  const rows = await database.select({ serviceCode: employeeCapabilities.serviceCode })
    .from(employeeCapabilities).where(and(
      eq(employeeCapabilities.tenantId, tenantId),
      inArray(employeeCapabilities.level, ["review", "sign"]),
    ));
  return new Set(rows.map((row) => row.serviceCode.toUpperCase()));
}

/**
 * The whole matrix, flat, for a form that can switch service while it is open.
 *
 * A firm has tens of people and tens of services, so this is a few hundred rows
 * at most — cheaper to send once than to re-fetch every time the service select
 * changes, and it keeps the picker honest without a round trip.
 */
export async function listCapabilityIndex(database: DashboardDatabase, tenantId: string) {
  const rows = await database.select({
    level: employeeCapabilities.level,
    memberId: employeeCapabilities.employeeUserId,
    serviceCode: employeeCapabilities.serviceCode,
  }).from(employeeCapabilities).where(eq(employeeCapabilities.tenantId, tenantId));

  const levels = rows.map((row) => ({
    level: row.level as CapabilityLevel,
    memberId: row.memberId,
    serviceCode: row.serviceCode.toUpperCase(),
  }));
  const governed = [...new Set(levels.filter((row) => meets(row.level, "review")).map((row) => row.serviceCode))];
  return { governed, levels };
}

export type CapabilityIndex = Awaited<ReturnType<typeof listCapabilityIndex>>;

/** One member's capability for one service, for a server-side gate. */
export async function capabilityFor(
  database: DashboardDatabase,
  tenantId: string,
  employeeUserId: string,
  serviceCode: string,
): Promise<CapabilityLevel | null> {
  const [row] = await database.select({ level: employeeCapabilities.level })
    .from(employeeCapabilities).where(and(
      eq(employeeCapabilities.tenantId, tenantId),
      eq(employeeCapabilities.employeeUserId, employeeUserId),
      sql`upper(${employeeCapabilities.serviceCode}) = ${serviceCode.toUpperCase()}`,
    )).limit(1);
  return row ? (row.level as CapabilityLevel) : null;
}
