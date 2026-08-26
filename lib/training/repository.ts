import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";

import {
  auditEvents,
  cpePolicies,
  employeeProfiles,
  serviceCatalog,
  tenantMemberships,
  trainingRecords,
  users,
} from "../../db/schema";
import type { DashboardDatabase } from "../dashboard/postgres/repository";
import { rateInForce } from "../rates/valuation";
import {
  bandFor,
  computeStanding,
  isCpeCategory,
  isLearningType,
  type CpeCategory,
  type CpePolicy,
  type CpeStanding,
  type LearningType,
  type StandingBand,
  type TrainingEntry,
} from "./cpe";

/**
 * Reading and writing the training log.
 *
 * One log for everybody; whether an entry counts towards a CPE obligation is
 * decided here, on the way out, from the learning type and whether the person is
 * a member. Nothing has to be filed twice.
 */

export class TrainingError extends Error {
  constructor(public readonly code: "not_found" | "invalid_type" | "invalid_dates" | "invalid_hours" | "unknown_service") {
    super({
      not_found: "That training record was not found.",
      invalid_type: "Choose whether this was structured, unstructured, or a course.",
      invalid_dates: "Enter a valid completion date.",
      invalid_hours: "Enter the duration in hours, for example 6 or 6.5.",
      unknown_service: "Choose a service from the firm's service master, or leave it blank.",
    }[code]);
    this.name = "TrainingError";
  }
}

/**
 * Placeholder hours, plainly unconfirmed.
 *
 * A firm that has configured nothing still sees a working page, with every
 * figure marked as unchecked rather than presented as the requirement.
 */
const DEFAULT_POLICIES: Record<CpeCategory, CpePolicy> = {
  in_practice: {
    blockStructuredMinutes: 60 * 60, blockTotalMinutes: 120 * 60, blockYears: 3,
    category: "in_practice", confirmed: false, effectiveFrom: "",
    yearlyStructuredMinutes: 20 * 60, yearlyTotalMinutes: 20 * 60,
  },
  not_in_practice: {
    blockStructuredMinutes: 0, blockTotalMinutes: 60 * 60, blockYears: 3,
    category: "not_in_practice", confirmed: false, effectiveFrom: "",
    yearlyStructuredMinutes: 0, yearlyTotalMinutes: 15 * 60,
  },
  exempt: {
    blockStructuredMinutes: 0, blockTotalMinutes: 0, blockYears: 3,
    category: "exempt", confirmed: false, effectiveFrom: "",
    yearlyStructuredMinutes: 0, yearlyTotalMinutes: 0,
  },
};

export async function listCpePolicies(database: DashboardDatabase, tenantId: string) {
  return database.select({
    blockStructuredMinutes: cpePolicies.blockStructuredMinutes,
    blockTotalMinutes: cpePolicies.blockTotalMinutes,
    blockYears: cpePolicies.blockYears,
    category: cpePolicies.category,
    confirmed: cpePolicies.confirmed,
    effectiveFrom: cpePolicies.effectiveFrom,
    id: cpePolicies.id,
    note: cpePolicies.note,
    yearlyStructuredMinutes: cpePolicies.yearlyStructuredMinutes,
    yearlyTotalMinutes: cpePolicies.yearlyTotalMinutes,
  }).from(cpePolicies)
    .where(eq(cpePolicies.tenantId, tenantId))
    .orderBy(asc(cpePolicies.category), desc(cpePolicies.effectiveFrom));
}

/** The policy for each category in force on a date, falling back to placeholders. */
export async function policiesInForce(
  database: DashboardDatabase,
  tenantId: string,
  dateKey: string,
): Promise<Record<CpeCategory, CpePolicy>> {
  const rows = await listCpePolicies(database, tenantId);
  const resolved = { ...DEFAULT_POLICIES };
  for (const category of Object.keys(DEFAULT_POLICIES) as CpeCategory[]) {
    const current = rateInForce(rows.filter((row) => row.category === category), dateKey);
    if (current) resolved[category] = { ...current, category };
  }
  return resolved;
}

export type TrainingRow = {
  completedOn: string;
  employeeName: string;
  employeeUserId: string;
  id: string;
  learningType: LearningType;
  minutes: number;
  note: string;
  provider: string;
  serviceCode: string;
  serviceName: string | null;
  certificateReference: string;
  title: string;
};

export async function listTrainingRecords(
  database: DashboardDatabase,
  tenantId: string,
  options: { employeeUserId?: string; fromYear?: number } = {},
): Promise<TrainingRow[]> {
  const filters = [eq(trainingRecords.tenantId, tenantId)];
  if (options.employeeUserId) filters.push(eq(trainingRecords.employeeUserId, options.employeeUserId));
  if (options.fromYear) filters.push(gte(trainingRecords.completedOn, `${options.fromYear}-01-01`));

  const rows = await database.select({
    certificateReference: trainingRecords.certificateReference,
    completedOn: trainingRecords.completedOn,
    employeeName: users.fullName,
    employeeUserId: trainingRecords.employeeUserId,
    id: trainingRecords.id,
    learningType: trainingRecords.learningType,
    minutes: trainingRecords.minutes,
    note: trainingRecords.note,
    provider: trainingRecords.provider,
    serviceCode: trainingRecords.serviceCode,
    serviceName: serviceCatalog.name,
    title: trainingRecords.title,
  }).from(trainingRecords)
    .innerJoin(users, eq(users.id, trainingRecords.employeeUserId))
    .leftJoin(serviceCatalog, and(
      eq(serviceCatalog.tenantId, trainingRecords.tenantId),
      sql`upper(${serviceCatalog.code}) = upper(${trainingRecords.serviceCode})`,
    ))
    .where(and(...filters))
    .orderBy(desc(trainingRecords.completedOn), desc(trainingRecords.createdAt));

  return rows.map((row) => ({ ...row, learningType: row.learningType as LearningType }));
}

export type MemberStanding = {
  band: StandingBand;
  category: CpeCategory;
  employeeUserId: string;
  fullName: string;
  /** Null for anybody who is not a member with an obligation. */
  standing: CpeStanding | null;
  /** All logged minutes, obligation or not, so non-members still show effort. */
  totalLoggedMinutes: number;
};

export type TrainingWorkspace = {
  members: MemberStanding[];
  policies: Record<CpeCategory, CpePolicy>;
  /** False while any category the firm actually uses is unchecked. */
  policiesConfirmed: boolean;
  records: TrainingRow[];
  year: number;
};

export async function listTrainingWorkspace(
  database: DashboardDatabase,
  tenantId: string,
  todayKey: string,
): Promise<TrainingWorkspace> {
  const year = Number(todayKey.slice(0, 4));
  const policies = await policiesInForce(database, tenantId, todayKey);
  const earliestYear = year - Math.max(...Object.values(policies).map((policy) => policy.blockYears)) + 1;

  const [people, records] = await Promise.all([
    database.select({
      cpeCategory: employeeProfiles.cpeCategory,
      fullName: users.fullName,
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
    listTrainingRecords(database, tenantId, { fromYear: earliestYear }),
  ]);

  const entriesByPerson = new Map<string, TrainingEntry[]>();
  for (const record of records) {
    const existing = entriesByPerson.get(record.employeeUserId) ?? [];
    existing.push({ completedOn: record.completedOn, learningType: record.learningType, minutes: record.minutes });
    entriesByPerson.set(record.employeeUserId, existing);
  }

  const members: MemberStanding[] = people.map((person) => {
    const entries = entriesByPerson.get(person.userId) ?? [];
    const category = (isCpeCategory(person.cpeCategory) ? person.cpeCategory : "in_practice") as CpeCategory;
    // Only a Chartered Accountant carries the obligation. Everybody else keeps
    // a log, which is the point of having one log rather than two.
    const obliged = person.qualification === "ca" && category !== "exempt";
    const standing = obliged ? computeStanding(entries, policies[category], year) : null;
    return {
      band: bandFor(standing),
      category,
      employeeUserId: person.userId,
      fullName: person.fullName,
      standing,
      totalLoggedMinutes: entries
        .filter((entry) => Number(entry.completedOn.slice(0, 4)) === year)
        .reduce((total, entry) => total + entry.minutes, 0),
    };
  });

  const usedCategories = new Set(members.filter((member) => member.standing).map((member) => member.category));
  return {
    members,
    policies,
    policiesConfirmed: [...usedCategories].every((category) => policies[category].confirmed),
    records,
    year,
  };
}

export type TrainingInput = {
  certificateReference: string;
  completedOn: string;
  employeeUserId: string;
  learningType: string;
  minutes: number;
  note: string;
  provider: string;
  serviceCode: string;
  title: string;
};

export async function recordTraining(
  database: DashboardDatabase,
  tenantId: string,
  actorUserId: string,
  input: TrainingInput,
) {
  if (!isLearningType(input.learningType)) throw new TrainingError("invalid_type");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.completedOn)) throw new TrainingError("invalid_dates");
  if (!Number.isInteger(input.minutes) || input.minutes < 1 || input.minutes > 12_000) throw new TrainingError("invalid_hours");
  const serviceCode = input.serviceCode.trim().toUpperCase();

  return database.transaction(async (transaction) => {
    const [member] = await transaction.select({ userId: employeeProfiles.userId }).from(employeeProfiles)
      .where(and(eq(employeeProfiles.tenantId, tenantId), eq(employeeProfiles.userId, input.employeeUserId))).limit(1);
    if (!member) throw new TrainingError("not_found");

    if (serviceCode) {
      const [service] = await transaction.select({ code: serviceCatalog.code }).from(serviceCatalog)
        .where(and(eq(serviceCatalog.tenantId, tenantId), sql`upper(${serviceCatalog.code}) = ${serviceCode}`)).limit(1);
      if (!service) throw new TrainingError("unknown_service");
    }

    const [saved] = await transaction.insert(trainingRecords).values({
      tenantId,
      employeeUserId: input.employeeUserId,
      title: input.title.trim().slice(0, 200),
      provider: input.provider.slice(0, 160),
      learningType: input.learningType,
      completedOn: input.completedOn,
      minutes: input.minutes,
      serviceCode,
      certificateReference: input.certificateReference.slice(0, 80),
      note: input.note.slice(0, 500),
      recordedByUserId: actorUserId,
    }).returning({ id: trainingRecords.id });

    await transaction.insert(auditEvents).values({
      tenantId, actorUserId, resourceType: "training_record", resourceId: saved!.id,
      action: "training.recorded",
      reason: `${input.title.trim().slice(0, 120)} · ${(input.minutes / 60).toFixed(1)}h ${input.learningType}`,
    });
    return saved!.id;
  });
}

export async function removeTraining(
  database: DashboardDatabase,
  tenantId: string,
  actorUserId: string,
  recordId: string,
) {
  await database.transaction(async (transaction) => {
    const [removed] = await transaction.delete(trainingRecords)
      .where(and(eq(trainingRecords.tenantId, tenantId), eq(trainingRecords.id, recordId)))
      .returning({ id: trainingRecords.id, title: trainingRecords.title });
    if (!removed) throw new TrainingError("not_found");
    await transaction.insert(auditEvents).values({
      tenantId, actorUserId, resourceType: "training_record", resourceId: removed.id,
      action: "training.removed", reason: removed.title,
    });
  });
}

export type CpePolicyInput = {
  blockStructuredMinutes: number;
  blockTotalMinutes: number;
  blockYears: number;
  category: string;
  confirmed: boolean;
  effectiveFrom: string;
  note: string;
  yearlyStructuredMinutes: number;
  yearlyTotalMinutes: number;
};

export async function saveCpePolicy(
  database: DashboardDatabase,
  tenantId: string,
  actorUserId: string,
  input: CpePolicyInput,
) {
  if (!isCpeCategory(input.category)) throw new TrainingError("invalid_type");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.effectiveFrom)) throw new TrainingError("invalid_dates");
  if (input.yearlyStructuredMinutes > input.yearlyTotalMinutes) throw new TrainingError("invalid_hours");
  if (input.blockStructuredMinutes > input.blockTotalMinutes) throw new TrainingError("invalid_hours");

  return database.transaction(async (transaction) => {
    const [saved] = await transaction.insert(cpePolicies).values({
      tenantId,
      category: input.category,
      effectiveFrom: input.effectiveFrom,
      yearlyStructuredMinutes: input.yearlyStructuredMinutes,
      yearlyTotalMinutes: input.yearlyTotalMinutes,
      blockYears: input.blockYears,
      blockStructuredMinutes: input.blockStructuredMinutes,
      blockTotalMinutes: input.blockTotalMinutes,
      confirmed: input.confirmed,
      note: input.note.slice(0, 500),
      createdByUserId: actorUserId,
    }).onConflictDoUpdate({
      target: [cpePolicies.tenantId, cpePolicies.category, cpePolicies.effectiveFrom],
      set: {
        yearlyStructuredMinutes: input.yearlyStructuredMinutes,
        yearlyTotalMinutes: input.yearlyTotalMinutes,
        blockYears: input.blockYears,
        blockStructuredMinutes: input.blockStructuredMinutes,
        blockTotalMinutes: input.blockTotalMinutes,
        confirmed: input.confirmed,
        note: input.note.slice(0, 500),
        updatedAt: new Date(),
      },
    }).returning({ id: cpePolicies.id });

    await transaction.insert(auditEvents).values({
      tenantId, actorUserId, resourceType: "cpe_policy", resourceId: saved!.id,
      action: "cpe.policy_set",
      reason: `${input.category}: ${(input.yearlyTotalMinutes / 60).toFixed(0)}h a year${input.confirmed ? ", confirmed" : ", unconfirmed"}`,
    });
    return saved!.id;
  });
}

/** Training linked to a service, shown as evidence beside a capability rating. */
export async function trainingEvidenceFor(
  database: DashboardDatabase,
  tenantId: string,
  employeeUserId: string,
): Promise<Map<string, Array<{ completedOn: string; minutes: number; title: string }>>> {
  const rows = await database.select({
    completedOn: trainingRecords.completedOn,
    minutes: trainingRecords.minutes,
    serviceCode: trainingRecords.serviceCode,
    title: trainingRecords.title,
  }).from(trainingRecords).where(and(
    eq(trainingRecords.tenantId, tenantId),
    eq(trainingRecords.employeeUserId, employeeUserId),
    sql`${trainingRecords.serviceCode} <> ''`,
  )).orderBy(desc(trainingRecords.completedOn));

  const byService = new Map<string, Array<{ completedOn: string; minutes: number; title: string }>>();
  for (const row of rows) {
    const code = row.serviceCode.toUpperCase();
    const existing = byService.get(code) ?? [];
    existing.push({ completedOn: row.completedOn, minutes: row.minutes, title: row.title });
    byService.set(code, existing);
  }
  return byService;
}

export const listTrainingSubjects = async (database: DashboardDatabase, tenantId: string, userIds: readonly string[]) =>
  userIds.length === 0 ? [] : database.select({ fullName: users.fullName, id: users.id }).from(users)
    .where(inArray(users.id, [...userIds]));

export const trainingBetween = async (database: DashboardDatabase, tenantId: string, from: string, to: string) =>
  database.select({ id: trainingRecords.id }).from(trainingRecords).where(and(
    eq(trainingRecords.tenantId, tenantId),
    gte(trainingRecords.completedOn, from),
    lte(trainingRecords.completedOn, to),
  ));
