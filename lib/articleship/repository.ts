import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import {
  articleshipPolicies,
  articleshipRegistrations,
  attendanceDays,
  auditEvents,
  employeeProfiles,
  tenantMemberships,
  users,
} from "../../db/schema";
import type { DashboardDatabase } from "../dashboard/postgres/repository";
import { rateInForce } from "../rates/valuation";
import {
  alertsFor,
  computeTerm,
  isArticleshipStatus,
  type ArticleshipAlert,
  type ArticleshipPolicy,
  type ArticleshipStatus,
  type ArticleshipTerm,
} from "./register";

/**
 * Reading and writing the articleship register.
 *
 * Leave is read from the attendance register rather than kept separately: the
 * days an article was on leave are already recorded, and a second count would
 * only ever be a second answer.
 */

export class ArticleshipError extends Error {
  constructor(public readonly code:
    | "not_found" | "already_active" | "invalid_dates" | "invalid_status"
    | "principal_not_qualified" | "not_active" | "policy_missing") {
    super({
      not_found: "That articleship registration was not found.",
      already_active: "This article already has a live registration. End it before starting another.",
      invalid_dates: "Check the dates: an articleship cannot end before it began.",
      invalid_status: "Choose how the registration ended.",
      principal_not_qualified: "A principal must be a Chartered Accountant with a membership number on record.",
      not_active: "This registration has already ended.",
      policy_missing: "Set the firm's articleship policy before registering an article.",
    }[code]);
    this.name = "ArticleshipError";
  }
}

const DEFAULT_POLICY = {
  confirmed: false,
  effectiveFrom: "",
  leaveFraction: { denominator: 6, numerator: 1 },
  trainingMonths: 24,
} satisfies ArticleshipPolicy;

/**
 * The policy in force on a date.
 *
 * Falls back to an unconfirmed placeholder rather than refusing to render, so a
 * firm that has not configured anything still sees a register — with the figures
 * plainly marked as unchecked.
 */
export async function policyInForce(
  database: DashboardDatabase,
  tenantId: string,
  dateKey: string,
): Promise<ArticleshipPolicy> {
  const rows = await database.select({
    confirmed: articleshipPolicies.confirmed,
    effectiveFrom: articleshipPolicies.effectiveFrom,
    leaveFractionDenominator: articleshipPolicies.leaveFractionDenominator,
    leaveFractionNumerator: articleshipPolicies.leaveFractionNumerator,
    trainingMonths: articleshipPolicies.trainingMonths,
  }).from(articleshipPolicies).where(eq(articleshipPolicies.tenantId, tenantId));

  const current = rateInForce(rows, dateKey);
  if (!current) return DEFAULT_POLICY;
  return {
    confirmed: current.confirmed,
    effectiveFrom: current.effectiveFrom,
    leaveFraction: { denominator: current.leaveFractionDenominator, numerator: current.leaveFractionNumerator },
    trainingMonths: current.trainingMonths,
  };
}

export async function listPolicies(database: DashboardDatabase, tenantId: string) {
  return database.select({
    confirmed: articleshipPolicies.confirmed,
    effectiveFrom: articleshipPolicies.effectiveFrom,
    id: articleshipPolicies.id,
    leaveFractionDenominator: articleshipPolicies.leaveFractionDenominator,
    leaveFractionNumerator: articleshipPolicies.leaveFractionNumerator,
    note: articleshipPolicies.note,
    trainingMonths: articleshipPolicies.trainingMonths,
  }).from(articleshipPolicies)
    .where(eq(articleshipPolicies.tenantId, tenantId))
    .orderBy(desc(articleshipPolicies.effectiveFrom));
}

export type ArticleshipRow = {
  alerts: ArticleshipAlert[];
  articleName: string;
  articleUserId: string;
  commencedOn: string;
  deedDate: string | null;
  endReason: string;
  endedOn: string | null;
  form103Date: string | null;
  form108Date: string | null;
  form109Date: string | null;
  id: string;
  industrialTrainingEmployer: string;
  industrialTrainingFrom: string | null;
  industrialTrainingTo: string | null;
  note: string;
  principalMembership: string;
  principalName: string;
  principalUserId: string;
  registrationNumber: string;
  status: ArticleshipStatus;
  term: ArticleshipTerm;
  trainingMonths: number;
};

const article = alias(users, "article_user");
const principal = alias(users, "principal_user");
const principalProfile = alias(employeeProfiles, "principal_profile");

/**
 * Days of approved leave inside each registration's window.
 *
 * Counted from the attendance register — the same rows the leave workflow
 * writes — so the articleship figure cannot disagree with the attendance one.
 */
async function leaveDaysByArticle(
  database: DashboardDatabase,
  tenantId: string,
  windows: ReadonlyArray<{ articleUserId: string; from: string; id: string; to: string }>,
): Promise<Map<string, number>> {
  if (windows.length === 0) return new Map();
  const earliest = windows.reduce((min, row) => (row.from < min ? row.from : min), windows[0]!.from);
  const latest = windows.reduce((max, row) => (row.to > max ? row.to : max), windows[0]!.to);

  const rows = await database.select({
    attendanceDate: attendanceDays.attendanceDate,
    employeeUserId: attendanceDays.employeeUserId,
    halfDays: sql<number>`(${attendanceDays.paidHalfDays} + ${attendanceDays.lopHalfDays})`.mapWith(Number),
  }).from(attendanceDays).where(and(
    eq(attendanceDays.tenantId, tenantId),
    eq(attendanceDays.status, "leave"),
    inArray(attendanceDays.employeeUserId, [...new Set(windows.map((row) => row.articleUserId))]),
    gte(attendanceDays.attendanceDate, earliest),
    lte(attendanceDays.attendanceDate, latest),
  ));

  const byRegistration = new Map<string, number>();
  for (const window of windows) {
    const halfDays = rows
      .filter((row) => row.employeeUserId === window.articleUserId
        && row.attendanceDate >= window.from && row.attendanceDate <= window.to)
      .reduce((total, row) => total + row.halfDays, 0);
    // Half-days round up: half a day of leave is still a day the article was
    // not in the office for part of, and ICAI counts leave in days.
    byRegistration.set(window.id, Math.ceil(halfDays / 2));
  }
  return byRegistration;
}

export async function listArticleshipRegister(
  database: DashboardDatabase,
  tenantId: string,
  todayKey: string,
  articleUserId?: string,
): Promise<ArticleshipRow[]> {
  const scope = articleUserId
    ? and(eq(articleshipRegistrations.tenantId, tenantId), eq(articleshipRegistrations.articleUserId, articleUserId))
    : eq(articleshipRegistrations.tenantId, tenantId);

  const rows = await database.select({
    articleName: article.fullName,
    articleUserId: articleshipRegistrations.articleUserId,
    commencedOn: articleshipRegistrations.commencedOn,
    deedDate: articleshipRegistrations.deedDate,
    endReason: articleshipRegistrations.endReason,
    endedOn: articleshipRegistrations.endedOn,
    form103Date: articleshipRegistrations.form103Date,
    form108Date: articleshipRegistrations.form108Date,
    form109Date: articleshipRegistrations.form109Date,
    id: articleshipRegistrations.id,
    industrialTrainingEmployer: articleshipRegistrations.industrialTrainingEmployer,
    industrialTrainingFrom: articleshipRegistrations.industrialTrainingFrom,
    industrialTrainingTo: articleshipRegistrations.industrialTrainingTo,
    note: articleshipRegistrations.note,
    principalMembership: principalProfile.membershipNumber,
    principalName: principal.fullName,
    principalUserId: articleshipRegistrations.principalUserId,
    registrationNumber: articleshipRegistrations.registrationNumber,
    status: articleshipRegistrations.status,
    trainingMonths: articleshipRegistrations.trainingMonths,
  }).from(articleshipRegistrations)
    .innerJoin(article, eq(article.id, articleshipRegistrations.articleUserId))
    .innerJoin(principal, eq(principal.id, articleshipRegistrations.principalUserId))
    .leftJoin(principalProfile, and(
      eq(principalProfile.tenantId, articleshipRegistrations.tenantId),
      eq(principalProfile.userId, articleshipRegistrations.principalUserId),
    ))
    .where(scope)
    .orderBy(desc(articleshipRegistrations.commencedOn));

  const policy = await policyInForce(database, tenantId, todayKey);
  const leaveDays = await leaveDaysByArticle(database, tenantId, rows.map((row) => ({
    articleUserId: row.articleUserId,
    from: row.commencedOn,
    id: row.id,
    to: row.endedOn ?? todayKey,
  })));

  return rows.map((row) => {
    const status = row.status as ArticleshipStatus;
    const term = computeTerm({
      commencedOn: row.commencedOn,
      endedOn: row.endedOn,
      leaveDaysTaken: leaveDays.get(row.id) ?? 0,
      leaveFraction: policy.leaveFraction,
      status,
      todayKey,
      trainingMonths: row.trainingMonths,
    });
    return {
      ...row,
      alerts: alertsFor({ form103Date: row.form103Date, status, term }),
      principalMembership: row.principalMembership ?? "",
      status,
      term,
    };
  });
}

export type RegistrationInput = {
  articleUserId: string;
  commencedOn: string;
  deedDate: string | null;
  form103Date: string | null;
  note: string;
  principalUserId: string;
  registrationNumber: string;
};

/**
 * Register an article under a principal.
 *
 * The principal has to be a member with a membership number on file — the whole
 * register exists so the firm can evidence who trained whom, and "trained under
 * somebody who may or may not be a CA" evidences nothing.
 */
export async function registerArticle(
  database: DashboardDatabase,
  tenantId: string,
  actorUserId: string,
  input: RegistrationInput,
) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.commencedOn)) throw new ArticleshipError("invalid_dates");

  return database.transaction(async (transaction) => {
    const [principalRecord] = await transaction.select({
      membershipNumber: employeeProfiles.membershipNumber,
      qualification: employeeProfiles.qualification,
    }).from(employeeProfiles).where(and(
      eq(employeeProfiles.tenantId, tenantId),
      eq(employeeProfiles.userId, input.principalUserId),
    )).limit(1);
    if (!principalRecord) throw new ArticleshipError("not_found");
    if (principalRecord.qualification !== "ca" || !principalRecord.membershipNumber) {
      throw new ArticleshipError("principal_not_qualified");
    }

    const [existing] = await transaction.select({ id: articleshipRegistrations.id })
      .from(articleshipRegistrations).where(and(
        eq(articleshipRegistrations.tenantId, tenantId),
        eq(articleshipRegistrations.articleUserId, input.articleUserId),
        eq(articleshipRegistrations.status, "active"),
      )).limit(1);
    if (existing) throw new ArticleshipError("already_active");

    // Looked up by commencement, not by today: the term an article agreed to is
    // the one in force when they started, whatever the firm changed afterwards.
    const policy = await policyInForce(transaction, tenantId, input.commencedOn);
    const [saved] = await transaction.insert(articleshipRegistrations).values({
      tenantId,
      articleUserId: input.articleUserId,
      principalUserId: input.principalUserId,
      status: "active",
      commencedOn: input.commencedOn,
      // Snapshotted, so revising the policy never moves an existing term.
      trainingMonths: policy.trainingMonths,
      registrationNumber: input.registrationNumber.slice(0, 40),
      deedDate: input.deedDate,
      form103Date: input.form103Date,
      note: input.note.slice(0, 500),
      createdByUserId: actorUserId,
    }).returning({ id: articleshipRegistrations.id });

    await transaction.insert(auditEvents).values({
      tenantId, actorUserId, resourceType: "articleship_registration", resourceId: saved!.id,
      action: "articleship.registered",
      reason: `Commenced ${input.commencedOn} for ${policy.trainingMonths} months`,
    });
    return saved!.id;
  });
}

export type EndRegistrationInput = {
  endedOn: string;
  formDate: string | null;
  reason: string;
  registrationId: string;
  status: Exclude<ArticleshipStatus, "active">;
};

/**
 * End a registration: completed, transferred out, or terminated.
 *
 * A transfer is not an edit of the principal — it closes this registration and
 * leaves the article free to be registered again, so the chain stays intact.
 */
export async function endRegistration(
  database: DashboardDatabase,
  tenantId: string,
  actorUserId: string,
  input: EndRegistrationInput,
) {
  // The type already narrows this, but the value arrives from a form.
  if (!isArticleshipStatus(input.status) || (input.status as string) === "active") throw new ArticleshipError("invalid_status");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.endedOn)) throw new ArticleshipError("invalid_dates");

  await database.transaction(async (transaction) => {
    const [current] = await transaction.select({
      commencedOn: articleshipRegistrations.commencedOn,
      status: articleshipRegistrations.status,
    }).from(articleshipRegistrations).where(and(
      eq(articleshipRegistrations.tenantId, tenantId),
      eq(articleshipRegistrations.id, input.registrationId),
    )).limit(1).for("update");
    if (!current) throw new ArticleshipError("not_found");
    if (current.status !== "active") throw new ArticleshipError("not_active");
    if (input.endedOn < current.commencedOn) throw new ArticleshipError("invalid_dates");
    // Completion is evidenced by Form 108; the database refuses it otherwise.
    if (input.status === "completed" && !input.formDate) throw new ArticleshipError("invalid_dates");

    await transaction.update(articleshipRegistrations).set({
      status: input.status,
      endedOn: input.endedOn,
      endReason: input.reason.slice(0, 300),
      form108Date: input.status === "completed" ? input.formDate : null,
      form109Date: input.status === "completed" ? null : input.formDate,
      updatedAt: new Date(),
    }).where(and(
      eq(articleshipRegistrations.tenantId, tenantId),
      eq(articleshipRegistrations.id, input.registrationId),
    ));

    await transaction.insert(auditEvents).values({
      tenantId, actorUserId, resourceType: "articleship_registration", resourceId: input.registrationId,
      action: `articleship.${input.status}`,
      reason: input.reason.slice(0, 300) || `Ended ${input.endedOn}`,
    });
  });
}

export type IndustrialTrainingInput = {
  employer: string;
  from: string | null;
  registrationId: string;
  to: string | null;
};

export async function recordIndustrialTraining(
  database: DashboardDatabase,
  tenantId: string,
  actorUserId: string,
  input: IndustrialTrainingInput,
) {
  if ((input.from === null) !== (input.to === null)) throw new ArticleshipError("invalid_dates");
  if (input.from && input.to && input.to < input.from) throw new ArticleshipError("invalid_dates");

  await database.transaction(async (transaction) => {
    const [updated] = await transaction.update(articleshipRegistrations).set({
      industrialTrainingEmployer: input.from ? input.employer.slice(0, 160) : "",
      industrialTrainingFrom: input.from,
      industrialTrainingTo: input.to,
      updatedAt: new Date(),
    }).where(and(
      eq(articleshipRegistrations.tenantId, tenantId),
      eq(articleshipRegistrations.id, input.registrationId),
    )).returning({ id: articleshipRegistrations.id });
    if (!updated) throw new ArticleshipError("not_found");

    await transaction.insert(auditEvents).values({
      tenantId, actorUserId, resourceType: "articleship_registration", resourceId: input.registrationId,
      action: "articleship.industrial_training",
      reason: input.from ? `${input.employer} from ${input.from} to ${input.to}` : "Cleared",
    });
  });
}

export type ArticleshipPolicyInput = {
  confirmed: boolean;
  effectiveFrom: string;
  leaveFractionDenominator: number;
  leaveFractionNumerator: number;
  note: string;
  trainingMonths: number;
};

export async function saveArticleshipPolicy(
  database: DashboardDatabase,
  tenantId: string,
  actorUserId: string,
  input: ArticleshipPolicyInput,
) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.effectiveFrom)) throw new ArticleshipError("invalid_dates");
  return database.transaction(async (transaction) => {
    const [saved] = await transaction.insert(articleshipPolicies).values({
      tenantId,
      effectiveFrom: input.effectiveFrom,
      trainingMonths: input.trainingMonths,
      leaveFractionNumerator: input.leaveFractionNumerator,
      leaveFractionDenominator: input.leaveFractionDenominator,
      confirmed: input.confirmed,
      note: input.note.slice(0, 500),
      createdByUserId: actorUserId,
    }).onConflictDoUpdate({
      target: [articleshipPolicies.tenantId, articleshipPolicies.effectiveFrom],
      set: {
        trainingMonths: input.trainingMonths,
        leaveFractionNumerator: input.leaveFractionNumerator,
        leaveFractionDenominator: input.leaveFractionDenominator,
        confirmed: input.confirmed,
        note: input.note.slice(0, 500),
        updatedAt: new Date(),
      },
    }).returning({ id: articleshipPolicies.id });

    await transaction.insert(auditEvents).values({
      tenantId, actorUserId, resourceType: "articleship_policy", resourceId: saved!.id,
      action: "articleship.policy_set",
      reason: `${input.trainingMonths} months, leave ${input.leaveFractionNumerator}/${input.leaveFractionDenominator}${input.confirmed ? ", confirmed against ICAI" : ", unconfirmed"}`,
    });
    return saved!.id;
  });
}

/** Members who may act as a principal, and the articles who may be registered. */
export async function listArticleshipSubjects(database: DashboardDatabase, tenantId: string) {
  const members = await database.select({
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
    .orderBy(asc(users.fullName));

  return {
    articles: members.filter((member) => member.qualification === "articled"),
    principals: members.filter((member) => member.qualification === "ca" && member.membershipNumber !== ""),
  };
}
