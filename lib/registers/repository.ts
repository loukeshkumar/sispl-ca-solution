import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, lt, lte, ne, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { auditEvents, dscCertificates, dscCustodyEvents, legalEntities, statutoryNotices, tenantMemberships, udinRegistrations, users, workItems } from "../../db/schema";
import type { DashboardDatabase } from "../dashboard/postgres/repository";
import { buildAttentionQueue, type AttentionItem } from "./attention";
import { planBulkDscMovement, planBulkNoticeChange, type BulkPlan, type DscBulkMovement, type NoticeBulkAction } from "./bulk";
import { buildRegisterInsights, type RegisterInsights } from "./insights";
import type { RegisterTab } from "./queue-params";
import type { DscInput, NoticeInput, NoticeStatus, UdinInput } from "./validation";

export class RegisterRepositoryError extends Error {
  constructor(public readonly code: "not_found" | "duplicate" | "invalid_state" | "invalid_member") {
    super(
      code === "not_found" ? "The register entry was not found."
        : code === "duplicate" ? "That reference is already recorded for this firm."
          : code === "invalid_member" ? "Select an active member of this firm."
            : "The register entry cannot move to that state.",
    );
    this.name = "RegisterRepositoryError";
  }
}

export function indiaDateKey(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function addDaysToDateKey(dateKey: string, days: number) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

export const DSC_EXPIRY_WARNING_DAYS = 30;

/**
 * How many rows of one register a single page load will carry. Beyond this the
 * reader is searching, not scanning, and the workspace says so rather than
 * quietly showing a prefix of the truth.
 */
export const REGISTER_ROW_LIMIT = 500;

export type UdinRow = {
  id: string; legalEntityId: string; udin: string; clientName: string; documentType: string; documentDescription: string;
  signedByName: string; membershipNumber: string; generatedOn: string; status: string; revocationReason: string;
};

export type DscRow = {
  id: string; legalEntityId: string; clientName: string; holderName: string; serialNumber: string; issuingAuthority: string;
  certificateClass: string; validFrom: string; validUntil: string; status: string; custodianUserId: string | null;
  custodianName: string | null; storageLocation: string; notes: string;
  /** When the token is out, the day it left. Null when it is not out. */
  issuedOutSince: string | null;
};

export type NoticeRow = {
  id: string; legalEntityId: string; clientName: string; authority: string; noticeNumber: string; noticeSection: string; subject: string;
  noticeDate: string; receivedDate: string; responseDueDate: string; status: NoticeStatus; assigneeId: string | null;
  assigneeName: string | null; respondedOn: string | null; responseSummary: string;
};

export type RegisterCounts = { attention: number; dsc: number; notices: number; udin: number };

export type RegistersWorkspaceData = {
  /** Ranked across all registers, and always present — it drives the tab badge. */
  attention: AttentionItem[];
  certificates: DscRow[];
  counts: RegisterCounts;
  insights: RegisterInsights | null;
  /** Which register was fetched in full. The others are deliberately empty. */
  loadedTab: RegisterTab;
  metrics: { activeUdins: number; expiringCertificates: number; expiredCertificates: number; openNotices: number; overdueNotices: number };
  notices: NoticeRow[];
  todayKey: string;
  /** True when the loaded register hit `REGISTER_ROW_LIMIT`. */
  truncated: boolean;
  udins: UdinRow[];
};

export const emptyRegistersWorkspace = (todayKey = ""): RegistersWorkspaceData => ({
  attention: [],
  certificates: [],
  counts: { attention: 0, dsc: 0, notices: 0, udin: 0 },
  insights: null,
  loadedTab: "attention",
  metrics: { activeUdins: 0, expiringCertificates: 0, expiredCertificates: 0, openNotices: 0, overdueNotices: 0 },
  notices: [],
  todayKey,
  truncated: false,
  udins: [],
});

function requireActor(tenantId: string, actorUserId: string) {
  if (!tenantId.trim() || !actorUserId.trim()) throw new Error("Tenant and actor are required.");
}

async function assertActiveMember(database: Pick<DashboardDatabase, "select">, tenantId: string, userId: string | null) {
  if (!userId) return;
  const [member] = await database.select({ userId: tenantMemberships.userId }).from(tenantMemberships).where(and(
    eq(tenantMemberships.tenantId, tenantId), eq(tenantMemberships.userId, userId), eq(tenantMemberships.status, "active"),
  )).limit(1);
  if (!member) throw new RegisterRepositoryError("invalid_member");
}

async function assertActiveClient(database: Pick<DashboardDatabase, "select">, tenantId: string, legalEntityId: string) {
  const [client] = await database.select({ id: legalEntities.id }).from(legalEntities).where(and(
    eq(legalEntities.tenantId, tenantId), eq(legalEntities.id, legalEntityId), eq(legalEntities.status, "active"),
  )).limit(1);
  if (!client) throw new RegisterRepositoryError("not_found");
}

/*
 * Column sets, shared by the workspace loader and the CSV export so the two can
 * never drift into disagreeing about what a register row contains.
 */
const udinColumns = (signer: ReturnType<typeof alias>) => ({
  id: udinRegistrations.id, legalEntityId: udinRegistrations.legalEntityId, udin: udinRegistrations.udin,
  clientName: legalEntities.displayName, documentType: udinRegistrations.documentType,
  documentDescription: udinRegistrations.documentDescription, signedByName: signer.fullName,
  membershipNumber: udinRegistrations.membershipNumber, generatedOn: udinRegistrations.generatedOn,
  status: udinRegistrations.status, revocationReason: udinRegistrations.revocationReason,
});

const dscColumns = (custodian: ReturnType<typeof alias>) => ({
  id: dscCertificates.id, legalEntityId: dscCertificates.legalEntityId, clientName: legalEntities.displayName,
  holderName: dscCertificates.holderName, serialNumber: dscCertificates.serialNumber,
  issuingAuthority: dscCertificates.issuingAuthority, certificateClass: dscCertificates.certificateClass,
  validFrom: dscCertificates.validFrom, validUntil: dscCertificates.validUntil, status: dscCertificates.status,
  custodianUserId: dscCertificates.custodianUserId, custodianName: custodian.fullName,
  storageLocation: dscCertificates.storageLocation, notes: dscCertificates.notes,
});

const noticeColumns = (assignee: ReturnType<typeof alias>) => ({
  id: statutoryNotices.id, legalEntityId: statutoryNotices.legalEntityId, clientName: legalEntities.displayName,
  authority: statutoryNotices.authority, noticeNumber: statutoryNotices.noticeNumber,
  noticeSection: statutoryNotices.noticeSection, subject: statutoryNotices.subject,
  noticeDate: statutoryNotices.noticeDate, receivedDate: statutoryNotices.receivedDate,
  responseDueDate: statutoryNotices.responseDueDate, status: statutoryNotices.status,
  assigneeId: statutoryNotices.assigneeId, assigneeName: assignee.fullName,
  respondedOn: statutoryNotices.respondedOn, responseSummary: statutoryNotices.responseSummary,
});

const udinQuery = (database: DashboardDatabase, tenantId: string) => {
  const signer = alias(users, "udin_signer");
  return database.select(udinColumns(signer)).from(udinRegistrations)
    .innerJoin(legalEntities, and(eq(legalEntities.tenantId, udinRegistrations.tenantId), eq(legalEntities.id, udinRegistrations.legalEntityId)))
    .innerJoin(signer, eq(signer.id, udinRegistrations.signedByUserId))
    .where(eq(udinRegistrations.tenantId, tenantId))
    .orderBy(desc(udinRegistrations.generatedOn));
};

const dscQuery = (database: DashboardDatabase, tenantId: string) => {
  const custodian = alias(users, "dsc_custodian");
  return database.select(dscColumns(custodian)).from(dscCertificates)
    .innerJoin(legalEntities, and(eq(legalEntities.tenantId, dscCertificates.tenantId), eq(legalEntities.id, dscCertificates.legalEntityId)))
    .leftJoin(custodian, eq(custodian.id, dscCertificates.custodianUserId))
    .where(eq(dscCertificates.tenantId, tenantId))
    .orderBy(asc(dscCertificates.validUntil));
};

const noticeQuery = (database: DashboardDatabase, tenantId: string) => {
  const assignee = alias(users, "notice_assignee");
  return database.select(noticeColumns(assignee)).from(statutoryNotices)
    .innerJoin(legalEntities, and(eq(legalEntities.tenantId, statutoryNotices.tenantId), eq(legalEntities.id, statutoryNotices.legalEntityId)))
    .leftJoin(assignee, eq(assignee.id, statutoryNotices.assigneeId))
    .where(eq(statutoryNotices.tenantId, tenantId))
    .orderBy(asc(statutoryNotices.responseDueDate));
};

/**
 * When each certificate currently out of custody was last signed out. Expiry
 * and custody are separate clocks and the certificate row only carries the
 * first, so the second has to come from the trail that records it.
 */
async function loadIssuedOutSince(database: DashboardDatabase, tenantId: string) {
  const rows = await database.select({
    dscId: dscCustodyEvents.dscId,
    since: sql<string>`max(${dscCustodyEvents.occurredAt})`,
  }).from(dscCustodyEvents)
    .innerJoin(dscCertificates, and(eq(dscCertificates.tenantId, dscCustodyEvents.tenantId), eq(dscCertificates.id, dscCustodyEvents.dscId)))
    .where(and(
      eq(dscCustodyEvents.tenantId, tenantId),
      eq(dscCustodyEvents.eventType, "issued_out"),
      eq(dscCertificates.status, "issued_out"),
    ))
    .groupBy(dscCustodyEvents.dscId);
  return new Map(rows.map((row) => [row.dscId, new Date(row.since).toISOString()]));
}

const withCustodyClock = (rows: Array<Omit<DscRow, "issuedOutSince">>, since: Map<string, string>): DscRow[] =>
  rows.map((row) => ({ ...row, issuedOutSince: since.get(row.id) ?? null }));

const asNoticeRows = (rows: Array<Omit<NoticeRow, "status"> & { status: string }>): NoticeRow[] =>
  rows.map((row) => ({ ...row, status: row.status as NoticeStatus }));

/**
 * Everything the Registers workspace needs for one page load.
 *
 * Only the register being looked at is fetched in full. The other two report
 * their size through count aggregates, and the action queue is built from a
 * deliberately narrow slice — nothing outstanding is ever more than a month
 * away. Loading all three registers in their entirety to render one of them was
 * costing four times the rows for no benefit to the reader.
 */
export async function listRegistersWorkspace(
  database: DashboardDatabase,
  tenantId: string,
  options: { tab?: RegisterTab; todayKey?: string } = {},
): Promise<RegistersWorkspaceData> {
  requireTenant(tenantId);
  const todayKey = options.todayKey ?? indiaDateKey();
  const tab = options.tab ?? "attention";
  const warningKey = addDaysToDateKey(todayKey, DSC_EXPIRY_WARNING_DAYS);
  const attentionHorizon = addDaysToDateKey(todayKey, DSC_EXPIRY_WARNING_DAYS);
  const assignee = alias(users, "queue_assignee");

  const [tallies, issuedOutSince, queueCertificates, queueNotices, udins, certificates, notices] = await Promise.all([
    // Three aggregates replace three full table scans in JavaScript.
    Promise.all([
      database.select({
        active: sql<number>`count(*) filter (where ${udinRegistrations.status} = 'active')::int`,
        total: sql<number>`count(*)::int`,
      }).from(udinRegistrations).where(eq(udinRegistrations.tenantId, tenantId)),
      database.select({
        expired: sql<number>`count(*) filter (where ${dscCertificates.status} in ('in_custody','issued_out') and ${dscCertificates.validUntil} < ${todayKey})::int`,
        expiring: sql<number>`count(*) filter (where ${dscCertificates.status} in ('in_custody','issued_out') and ${dscCertificates.validUntil} >= ${todayKey} and ${dscCertificates.validUntil} <= ${warningKey})::int`,
        total: sql<number>`count(*)::int`,
      }).from(dscCertificates).where(eq(dscCertificates.tenantId, tenantId)),
      database.select({
        open: sql<number>`count(*) filter (where ${statutoryNotices.status} in ('open','in_progress'))::int`,
        overdue: sql<number>`count(*) filter (where ${statutoryNotices.status} in ('open','in_progress') and ${statutoryNotices.responseDueDate} < ${todayKey})::int`,
        total: sql<number>`count(*)::int`,
      }).from(statutoryNotices).where(eq(statutoryNotices.tenantId, tenantId)),
    ]),
    loadIssuedOutSince(database, tenantId),
    // Live certificates that either lapse inside the window or are out on loan.
    database.select({
      clientName: legalEntities.displayName, holderName: dscCertificates.holderName, id: dscCertificates.id,
      serialNumber: dscCertificates.serialNumber, status: dscCertificates.status, validUntil: dscCertificates.validUntil,
    }).from(dscCertificates)
      .innerJoin(legalEntities, and(eq(legalEntities.tenantId, dscCertificates.tenantId), eq(legalEntities.id, dscCertificates.legalEntityId)))
      .where(and(
        eq(dscCertificates.tenantId, tenantId),
        inArray(dscCertificates.status, ["in_custody", "issued_out"]),
        or(lte(dscCertificates.validUntil, attentionHorizon), eq(dscCertificates.status, "issued_out")),
      )),
    // Outstanding notices that are due inside the window, or that nobody owns.
    database.select({
      assigneeName: assignee.fullName, clientName: legalEntities.displayName, id: statutoryNotices.id,
      responseDueDate: statutoryNotices.responseDueDate, status: statutoryNotices.status, subject: statutoryNotices.subject,
    }).from(statutoryNotices)
      .innerJoin(legalEntities, and(eq(legalEntities.tenantId, statutoryNotices.tenantId), eq(legalEntities.id, statutoryNotices.legalEntityId)))
      .leftJoin(assignee, eq(assignee.id, statutoryNotices.assigneeId))
      .where(and(
        eq(statutoryNotices.tenantId, tenantId),
        inArray(statutoryNotices.status, ["open", "in_progress"]),
        or(lte(statutoryNotices.responseDueDate, attentionHorizon), isNull(statutoryNotices.assigneeId)),
      )),
    tab === "udin" || tab === "insights" ? udinQuery(database, tenantId).limit(REGISTER_ROW_LIMIT) : Promise.resolve([]),
    tab === "dsc" || tab === "insights" ? dscQuery(database, tenantId).limit(REGISTER_ROW_LIMIT) : Promise.resolve([]),
    tab === "notices" || tab === "insights" ? noticeQuery(database, tenantId).limit(REGISTER_ROW_LIMIT) : Promise.resolve([]),
  ]);

  const [[udinTally], [dscTally], [noticeTally]] = tallies;
  const dscRows = withCustodyClock(certificates, issuedOutSince);
  const noticeRows = asNoticeRows(notices);
  const attention = buildAttentionQueue({
    certificates: queueCertificates.map((row) => ({ ...row, issuedOutSince: issuedOutSince.get(row.id) ?? null })),
    notices: queueNotices,
    todayKey,
  });

  return {
    attention,
    certificates: dscRows,
    counts: {
      attention: attention.length,
      dsc: dscTally?.total ?? 0,
      notices: noticeTally?.total ?? 0,
      udin: udinTally?.total ?? 0,
    },
    insights: tab === "insights"
      ? buildRegisterInsights({ certificates: dscRows, notices: noticeRows, todayKey, udins })
      : null,
    loadedTab: tab,
    metrics: {
      activeUdins: udinTally?.active ?? 0,
      expiringCertificates: dscTally?.expiring ?? 0,
      expiredCertificates: dscTally?.expired ?? 0,
      openNotices: noticeTally?.open ?? 0,
      overdueNotices: noticeTally?.overdue ?? 0,
    },
    notices: noticeRows,
    todayKey,
    truncated: udins.length === REGISTER_ROW_LIMIT || dscRows.length === REGISTER_ROW_LIMIT || noticeRows.length === REGISTER_ROW_LIMIT,
    udins,
  };
}

export async function listRegisterFormOptions(database: DashboardDatabase, tenantId: string) {
  const [clients, members, work] = await Promise.all([
    database.select({ id: legalEntities.id, name: legalEntities.displayName }).from(legalEntities)
      .where(and(eq(legalEntities.tenantId, tenantId), eq(legalEntities.status, "active"))).orderBy(asc(legalEntities.displayName)),
    database.select({ id: users.id, name: users.fullName }).from(tenantMemberships)
      .innerJoin(users, eq(users.id, tenantMemberships.userId))
      .where(and(eq(tenantMemberships.tenantId, tenantId), eq(tenantMemberships.status, "active"))).orderBy(asc(users.fullName)),
    database.select({ id: workItems.id, legalEntityId: workItems.legalEntityId, serviceKey: workItems.serviceKey, periodKey: workItems.periodKey })
      .from(workItems).where(and(eq(workItems.tenantId, tenantId), ne(workItems.status, "completed"))).orderBy(asc(workItems.statutoryDueDate)),
  ]);
  return {
    clients,
    members,
    work: work.map((item) => ({ id: item.id, legalEntityId: item.legalEntityId, label: `${item.serviceKey.replaceAll("_", " ").toUpperCase()} · ${item.periodKey}` })),
  };
}

export async function recordUdin(database: DashboardDatabase, tenantId: string, actorUserId: string, input: UdinInput) {
  requireActor(tenantId, actorUserId);
  return database.transaction(async (transaction) => {
    await assertActiveClient(transaction, tenantId, input.legalEntityId);
    await assertActiveMember(transaction, tenantId, input.signedByUserId);
    const id = randomUUID();
    const inserted = await transaction.insert(udinRegistrations).values({
      id, tenantId, ...input, status: "active", recordedByUserId: actorUserId,
    }).onConflictDoNothing().returning({ id: udinRegistrations.id });
    if (inserted.length === 0) throw new RegisterRepositoryError("duplicate");
    await transaction.insert(auditEvents).values({ tenantId, actorUserId, resourceType: "udin", resourceId: id, action: "udin.recorded", reason: input.udin });
    return id;
  });
}

export async function revokeUdin(database: DashboardDatabase, tenantId: string, actorUserId: string, udinId: string, reason: string) {
  requireActor(tenantId, actorUserId);
  await database.transaction(async (transaction) => {
    const [updated] = await transaction.update(udinRegistrations).set({
      status: "revoked", revocationReason: reason, revokedAt: new Date(), updatedAt: new Date(),
    }).where(and(eq(udinRegistrations.id, udinId), eq(udinRegistrations.tenantId, tenantId), eq(udinRegistrations.status, "active")))
      .returning({ id: udinRegistrations.id });
    if (!updated) throw new RegisterRepositoryError("invalid_state");
    await transaction.insert(auditEvents).values({ tenantId, actorUserId, resourceType: "udin", resourceId: udinId, action: "udin.revoked", reason });
  });
}

export async function recordDscCertificate(database: DashboardDatabase, tenantId: string, actorUserId: string, input: DscInput) {
  requireActor(tenantId, actorUserId);
  return database.transaction(async (transaction) => {
    await assertActiveClient(transaction, tenantId, input.legalEntityId);
    await assertActiveMember(transaction, tenantId, input.custodianUserId);
    const id = randomUUID();
    const inserted = await transaction.insert(dscCertificates).values({
      id, tenantId, ...input, status: "in_custody", recordedByUserId: actorUserId,
    }).onConflictDoNothing().returning({ id: dscCertificates.id });
    if (inserted.length === 0) throw new RegisterRepositoryError("duplicate");
    await transaction.insert(dscCustodyEvents).values({
      tenantId, dscId: id, eventType: "received", custodianUserId: input.custodianUserId,
      counterpartyName: input.holderName, remarks: "Certificate received into firm custody.", recordedByUserId: actorUserId,
    });
    await transaction.insert(auditEvents).values({ tenantId, actorUserId, resourceType: "dsc_certificate", resourceId: id, action: "dsc.registered", reason: input.serialNumber });
    return id;
  });
}

const custodyTransitions: Record<string, { status: string; requiresCustodian: boolean }> = {
  issued_out: { status: "issued_out", requiresCustodian: false },
  returned: { status: "in_custody", requiresCustodian: true },
  surrendered: { status: "surrendered", requiresCustodian: false },
};

export async function recordDscCustodyMovement(
  database: DashboardDatabase,
  tenantId: string,
  actorUserId: string,
  input: { dscId: string; eventType: "issued_out" | "returned" | "surrendered"; custodianUserId: string | null; counterpartyName: string; remarks: string },
) {
  requireActor(tenantId, actorUserId);
  const transition = custodyTransitions[input.eventType];
  if (!transition) throw new RegisterRepositoryError("invalid_state");
  await database.transaction(async (transaction) => {
    const [certificate] = await transaction.select({ id: dscCertificates.id, status: dscCertificates.status })
      .from(dscCertificates).where(and(eq(dscCertificates.id, input.dscId), eq(dscCertificates.tenantId, tenantId))).limit(1).for("update");
    if (!certificate) throw new RegisterRepositoryError("not_found");
    if (["surrendered", "expired"].includes(certificate.status)) throw new RegisterRepositoryError("invalid_state");
    if (input.eventType === "issued_out" && certificate.status !== "in_custody") throw new RegisterRepositoryError("invalid_state");
    if (input.eventType === "returned" && certificate.status !== "issued_out") throw new RegisterRepositoryError("invalid_state");
    if (transition.requiresCustodian) await assertActiveMember(transaction, tenantId, input.custodianUserId);
    await transaction.update(dscCertificates).set({
      status: transition.status,
      custodianUserId: transition.requiresCustodian ? input.custodianUserId : null,
      updatedAt: new Date(),
    }).where(and(eq(dscCertificates.id, input.dscId), eq(dscCertificates.tenantId, tenantId)));
    await transaction.insert(dscCustodyEvents).values({
      tenantId, dscId: input.dscId, eventType: input.eventType,
      custodianUserId: transition.requiresCustodian ? input.custodianUserId : null,
      counterpartyName: input.counterpartyName, remarks: input.remarks, recordedByUserId: actorUserId,
    });
    await transaction.insert(auditEvents).values({
      tenantId, actorUserId, resourceType: "dsc_certificate", resourceId: input.dscId,
      action: `dsc.${input.eventType}`, reason: input.counterpartyName || null,
    });
  });
}

export async function listDscCustodyTrail(database: DashboardDatabase, tenantId: string, dscId: string) {
  const custodian = alias(users, "custody_user");
  const rows = await database.select({
    id: dscCustodyEvents.id, eventType: dscCustodyEvents.eventType, custodianName: custodian.fullName,
    counterpartyName: dscCustodyEvents.counterpartyName, remarks: dscCustodyEvents.remarks, occurredAt: dscCustodyEvents.occurredAt,
  }).from(dscCustodyEvents)
    .leftJoin(custodian, eq(custodian.id, dscCustodyEvents.custodianUserId))
    .where(and(eq(dscCustodyEvents.tenantId, tenantId), eq(dscCustodyEvents.dscId, dscId)))
    .orderBy(desc(dscCustodyEvents.occurredAt));
  return rows.map((row) => ({ ...row, occurredAt: row.occurredAt.toISOString() }));
}

const AUDIT_RESOURCE: Record<"udin" | "dsc" | "notice", string> = {
  dsc: "dsc_certificate",
  notice: "statutory_notice",
  udin: "udin",
};

export type RegisterAuditEntry = { action: string; actorName: string | null; id: string; occurredAt: string; reason: string | null };
export type RegisterCustodyEntry = {
  counterpartyName: string; custodianName: string | null; eventType: string; id: string; occurredAt: string; remarks: string;
};

export type RegisterDetail = {
  audit: RegisterAuditEntry[];
  clientName: string;
  /** Only ever populated for a certificate; the other registers have no chain. */
  custody: RegisterCustodyEntry[];
  facts: Array<{ label: string; value: string }>;
  id: string;
  kind: "udin" | "dsc" | "notice";
  subtitle: string;
  title: string;
};

async function loadAuditTrail(database: DashboardDatabase, tenantId: string, resourceType: string, resourceId: string) {
  const actor = alias(users, "audit_actor");
  const rows = await database.select({
    action: auditEvents.action, actorName: actor.fullName, id: auditEvents.id,
    occurredAt: auditEvents.occurredAt, reason: auditEvents.reason,
  }).from(auditEvents)
    .leftJoin(actor, eq(actor.id, auditEvents.actorUserId))
    .where(and(
      eq(auditEvents.tenantId, tenantId),
      eq(auditEvents.resourceType, resourceType),
      eq(auditEvents.resourceId, resourceId),
    ))
    .orderBy(desc(auditEvents.occurredAt))
    .limit(50);
  return rows.map((row) => ({ ...row, occurredAt: row.occurredAt.toISOString() }));
}

/**
 * Everything recorded about one register entry.
 *
 * The registers already wrote a custody chain and an audit trail on every
 * action; until now neither was readable from the page that produced them, so
 * the control existed in the database and nowhere a reviewer could see it.
 */
export async function loadRegisterDetail(
  database: DashboardDatabase,
  tenantId: string,
  kind: "udin" | "dsc" | "notice",
  id: string,
): Promise<RegisterDetail | null> {
  requireTenant(tenantId);
  const audit = loadAuditTrail(database, tenantId, AUDIT_RESOURCE[kind], id);

  if (kind === "udin") {
    const signer = alias(users, "detail_signer");
    const [row] = await database.select(udinColumns(signer)).from(udinRegistrations)
      .innerJoin(legalEntities, and(eq(legalEntities.tenantId, udinRegistrations.tenantId), eq(legalEntities.id, udinRegistrations.legalEntityId)))
      .innerJoin(signer, eq(signer.id, udinRegistrations.signedByUserId))
      .where(and(eq(udinRegistrations.tenantId, tenantId), eq(udinRegistrations.id, id))).limit(1);
    if (!row) return null;
    return {
      audit: await audit,
      clientName: row.clientName,
      custody: [],
      facts: [
        { label: "Document", value: row.documentDescription },
        { label: "Document type", value: row.documentType.replaceAll("_", " ") },
        { label: "Signed by", value: `${row.signedByName} · M. No. ${row.membershipNumber}` },
        { label: "Generated on", value: row.generatedOn },
        { label: "Status", value: row.status },
        // Written on revoke and, until now, never shown anywhere.
        ...(row.revocationReason ? [{ label: "Revocation reason", value: row.revocationReason }] : []),
      ],
      id: row.id,
      kind,
      subtitle: row.clientName,
      title: row.udin,
    };
  }

  if (kind === "dsc") {
    const custodian = alias(users, "detail_custodian");
    const [row] = await database.select(dscColumns(custodian)).from(dscCertificates)
      .innerJoin(legalEntities, and(eq(legalEntities.tenantId, dscCertificates.tenantId), eq(legalEntities.id, dscCertificates.legalEntityId)))
      .leftJoin(custodian, eq(custodian.id, dscCertificates.custodianUserId))
      .where(and(eq(dscCertificates.tenantId, tenantId), eq(dscCertificates.id, id))).limit(1);
    if (!row) return null;
    const [trail, auditRows] = await Promise.all([listDscCustodyTrail(database, tenantId, id), audit]);
    return {
      audit: auditRows,
      clientName: row.clientName,
      custody: trail,
      facts: [
        { label: "Holder", value: row.holderName },
        { label: "Serial", value: row.serialNumber },
        { label: "Class", value: row.certificateClass.replaceAll("_", " ") },
        { label: "Issuing authority", value: row.issuingAuthority },
        { label: "Validity", value: `${row.validFrom} to ${row.validUntil}` },
        { label: "Custody", value: row.status.replaceAll("_", " ") },
        { label: "Custodian", value: row.custodianName ?? "—" },
        { label: "Stored at", value: row.storageLocation || "—" },
        ...(row.notes ? [{ label: "Notes", value: row.notes }] : []),
      ],
      id: row.id,
      kind,
      subtitle: row.clientName,
      title: `${row.serialNumber} · ${row.holderName}`,
    };
  }

  const assignee = alias(users, "detail_assignee");
  const [row] = await database.select(noticeColumns(assignee)).from(statutoryNotices)
    .innerJoin(legalEntities, and(eq(legalEntities.tenantId, statutoryNotices.tenantId), eq(legalEntities.id, statutoryNotices.legalEntityId)))
    .leftJoin(assignee, eq(assignee.id, statutoryNotices.assigneeId))
    .where(and(eq(statutoryNotices.tenantId, tenantId), eq(statutoryNotices.id, id))).limit(1);
  if (!row) return null;
  return {
    audit: await audit,
    clientName: row.clientName,
    custody: [],
    facts: [
      { label: "Subject", value: row.subject },
      { label: "Authority", value: row.authority.replaceAll("_", " ") },
      ...(row.noticeSection ? [{ label: "Section", value: row.noticeSection }] : []),
      { label: "Dated", value: row.noticeDate },
      { label: "Received", value: row.receivedDate },
      { label: "Response due", value: row.responseDueDate },
      { label: "Owner", value: row.assigneeName ?? "Unassigned" },
      { label: "Status", value: row.status.replaceAll("_", " ") },
      ...(row.respondedOn ? [{ label: "Responded on", value: row.respondedOn }] : []),
      // Captured by the status action and previously invisible on the page.
      ...(row.responseSummary ? [{ label: "Response summary", value: row.responseSummary }] : []),
    ],
    id: row.id,
    kind,
    subtitle: row.clientName,
    title: row.noticeNumber,
  };
}

/** Full, unpaginated rows for one register. Used only by the CSV export. */
export async function listRegisterExportRows(database: DashboardDatabase, tenantId: string, tab: "notices" | "dsc" | "udin") {
  requireTenant(tenantId);
  if (tab === "udin") return { kind: tab, rows: await udinQuery(database, tenantId) } as const;
  if (tab === "notices") return { kind: tab, rows: asNoticeRows(await noticeQuery(database, tenantId)) } as const;
  const [rows, since] = await Promise.all([dscQuery(database, tenantId), loadIssuedOutSince(database, tenantId)]);
  return { kind: tab, rows: withCustodyClock(rows, since) } as const;
}

export async function recordNotice(database: DashboardDatabase, tenantId: string, actorUserId: string, input: NoticeInput) {
  requireActor(tenantId, actorUserId);
  return database.transaction(async (transaction) => {
    await assertActiveClient(transaction, tenantId, input.legalEntityId);
    await assertActiveMember(transaction, tenantId, input.assigneeId);
    const id = randomUUID();
    const inserted = await transaction.insert(statutoryNotices).values({
      id, tenantId, ...input, status: "open", recordedByUserId: actorUserId,
    }).onConflictDoNothing().returning({ id: statutoryNotices.id });
    if (inserted.length === 0) throw new RegisterRepositoryError("duplicate");
    await transaction.insert(auditEvents).values({ tenantId, actorUserId, resourceType: "statutory_notice", resourceId: id, action: "notice.recorded", reason: input.noticeNumber });
    return id;
  });
}

export async function updateNoticeStatus(
  database: DashboardDatabase,
  tenantId: string,
  actorUserId: string,
  noticeId: string,
  input: { status: NoticeStatus; respondedOn: string | null; responseSummary: string },
) {
  requireActor(tenantId, actorUserId);
  const closing = input.status === "responded" || input.status === "closed";
  await database.transaction(async (transaction) => {
    const [updated] = await transaction.update(statutoryNotices).set({
      status: input.status,
      respondedOn: closing ? input.respondedOn : null,
      responseSummary: input.responseSummary,
      updatedAt: new Date(),
    }).where(and(
      eq(statutoryNotices.id, noticeId), eq(statutoryNotices.tenantId, tenantId), ne(statutoryNotices.status, "closed"),
    )).returning({ id: statutoryNotices.id });
    if (!updated) throw new RegisterRepositoryError("invalid_state");
    await transaction.insert(auditEvents).values({
      tenantId, actorUserId, resourceType: "statutory_notice", resourceId: noticeId,
      action: "notice.status_updated", reason: input.status,
    });
  });
}

/**
 * Moves certificates past their validity to `expired` and records the transition
 * in the custody trail, so a lapsed token cannot sit indefinitely as "in custody".
 */
export async function expireLapsedCertificates(database: DashboardDatabase, tenantId: string, actorUserId: string | null = null, todayKey = indiaDateKey()) {
  requireTenant(tenantId);
  const lapsed = await database.select({ id: dscCertificates.id, serialNumber: dscCertificates.serialNumber, custodianUserId: dscCertificates.custodianUserId })
    .from(dscCertificates).where(and(
      eq(dscCertificates.tenantId, tenantId),
      inArray(dscCertificates.status, ["in_custody", "issued_out"]),
      lt(dscCertificates.validUntil, todayKey),
    ));
  if (lapsed.length === 0) return 0;
  for (const certificate of lapsed) {
    await database.transaction(async (transaction) => {
      const [updated] = await transaction.update(dscCertificates)
        .set({ status: "expired", custodianUserId: null, updatedAt: new Date() })
        .where(and(
          eq(dscCertificates.tenantId, tenantId),
          eq(dscCertificates.id, certificate.id),
          inArray(dscCertificates.status, ["in_custody", "issued_out"]),
        )).returning({ id: dscCertificates.id });
      if (!updated) return;
      await transaction.insert(dscCustodyEvents).values({
        tenantId, dscId: certificate.id, eventType: "expired",
        custodianUserId: null, counterpartyName: "",
        remarks: `Validity lapsed on or before ${todayKey}.`,
        recordedByUserId: actorUserId,
      });
      await transaction.insert(auditEvents).values({
        tenantId, actorUserId, resourceType: "dsc_certificate", resourceId: certificate.id,
        action: "dsc.expired", reason: certificate.serialNumber,
      });
    });
  }
  return lapsed.length;
}

function requireTenant(tenantId: string) {
  if (!tenantId.trim()) throw new Error("Tenant is required.");
}

export type RegisterAlertRow = { id: string; label: string; dueDate: string; recipientUserId: string; kind: "dsc_expiring" | "notice_due" };

export async function loadRegisterAlertRows(database: DashboardDatabase, tenantId: string, todayKey = indiaDateKey()): Promise<RegisterAlertRow[]> {
  const [certificates, notices] = await Promise.all([
    database.select({
      id: dscCertificates.id, serialNumber: dscCertificates.serialNumber, holderName: dscCertificates.holderName,
      validUntil: dscCertificates.validUntil, custodianUserId: dscCertificates.custodianUserId, recordedByUserId: dscCertificates.recordedByUserId,
    }).from(dscCertificates).where(and(
      eq(dscCertificates.tenantId, tenantId),
      inArray(dscCertificates.status, ["in_custody", "issued_out"]),
      lte(dscCertificates.validUntil, addDaysToDateKey(todayKey, DSC_EXPIRY_WARNING_DAYS)),
    )),
    database.select({
      id: statutoryNotices.id, noticeNumber: statutoryNotices.noticeNumber, responseDueDate: statutoryNotices.responseDueDate,
      assigneeId: statutoryNotices.assigneeId, recordedByUserId: statutoryNotices.recordedByUserId,
    }).from(statutoryNotices).where(and(
      eq(statutoryNotices.tenantId, tenantId),
      inArray(statutoryNotices.status, ["open", "in_progress"]),
      lte(statutoryNotices.responseDueDate, addDaysToDateKey(todayKey, 3)),
    )),
  ]);
  return [
    ...certificates.map((certificate) => ({
      id: certificate.id,
      label: `DSC ${certificate.serialNumber} for ${certificate.holderName}`,
      dueDate: certificate.validUntil,
      recipientUserId: certificate.custodianUserId ?? certificate.recordedByUserId,
      kind: "dsc_expiring" as const,
    })),
    ...notices.map((notice) => ({
      id: notice.id,
      label: `Notice ${notice.noticeNumber}`,
      dueDate: notice.responseDueDate,
      recipientUserId: notice.assigneeId ?? notice.recordedByUserId,
      kind: "notice_due" as const,
    })),
  ];
}

/**
 * A bulk change across statutory notices. The whole selection is validated
 * before anything is written, so a skipped record carries a reason rather than
 * taking the batch down with it.
 */
export async function applyBulkNoticeChange(
  database: DashboardDatabase,
  tenantId: string,
  actorUserId: string,
  noticeIds: string[],
  action: NoticeBulkAction,
): Promise<BulkPlan> {
  requireActor(tenantId, actorUserId);
  if (!noticeIds.length) return { apply: [], skip: [] };
  return database.transaction(async (transaction) => {
    if (action.kind === "assignee") await assertActiveMember(transaction, tenantId, action.memberId);
    const current = await transaction.select({
      assigneeId: statutoryNotices.assigneeId,
      id: statutoryNotices.id,
      status: statutoryNotices.status,
    }).from(statutoryNotices).where(and(
      eq(statutoryNotices.tenantId, tenantId),
      inArray(statutoryNotices.id, noticeIds),
    )).for("update");

    const plan = planBulkNoticeChange(current, action);
    const now = new Date();
    for (const item of plan.apply) {
      // respondedOn is part of the record's meaning, not decoration: it must be
      // set when a notice is answered and cleared when it is reopened.
      const set = action.kind === "assignee"
        ? { assigneeId: action.memberId }
        : {
          respondedOn: action.status === "responded" || action.status === "closed"
            ? now.toISOString().slice(0, 10)
            : null,
          status: action.status,
        };
      await transaction.update(statutoryNotices).set({ ...set, updatedAt: now })
        .where(and(eq(statutoryNotices.id, item.id), eq(statutoryNotices.tenantId, tenantId)));
      await transaction.insert(auditEvents).values({
        tenantId,
        actorUserId,
        resourceType: "statutory_notice",
        resourceId: item.id,
        action: `notice.bulk.${action.kind}`,
        reason: "Changed from a Registers bulk action",
      });
    }
    return plan;
  });
}

/**
 * Moves several certificates through the same custody event. Each one still
 * writes its own custody-trail row — the trail is the control, so a batch must
 * never collapse it into a single entry.
 */
export async function applyBulkDscMovement(
  database: DashboardDatabase,
  tenantId: string,
  actorUserId: string,
  dscIds: string[],
  movement: DscBulkMovement,
): Promise<BulkPlan> {
  requireActor(tenantId, actorUserId);
  if (!dscIds.length) return { apply: [], skip: [] };
  return database.transaction(async (transaction) => {
    if (movement.eventType === "returned") await assertActiveMember(transaction, tenantId, movement.custodianUserId ?? null);
    const current = await transaction.select({ id: dscCertificates.id, status: dscCertificates.status })
      .from(dscCertificates).where(and(
        eq(dscCertificates.tenantId, tenantId),
        inArray(dscCertificates.id, dscIds),
      )).for("update");

    const plan = planBulkDscMovement(current, movement);
    const requiresCustodian = movement.eventType === "returned";
    const nextStatus = movement.eventType === "returned" ? "in_custody" : movement.eventType;
    for (const item of plan.apply) {
      await transaction.update(dscCertificates).set({
        custodianUserId: requiresCustodian ? movement.custodianUserId ?? null : null,
        status: nextStatus,
        updatedAt: new Date(),
      }).where(and(eq(dscCertificates.id, item.id), eq(dscCertificates.tenantId, tenantId)));
      await transaction.insert(dscCustodyEvents).values({
        tenantId,
        dscId: item.id,
        eventType: movement.eventType,
        custodianUserId: requiresCustodian ? movement.custodianUserId ?? null : null,
        counterpartyName: movement.counterpartyName,
        remarks: "Recorded from a Registers bulk action",
        recordedByUserId: actorUserId,
      });
      await transaction.insert(auditEvents).values({
        tenantId,
        actorUserId,
        resourceType: "dsc_certificate",
        resourceId: item.id,
        action: `dsc.${movement.eventType}`,
        reason: movement.counterpartyName || null,
      });
    }
    return plan;
  });
}
