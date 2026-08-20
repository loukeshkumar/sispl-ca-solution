import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, lt, lte, ne } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { auditEvents, dscCertificates, dscCustodyEvents, legalEntities, statutoryNotices, tenantMemberships, udinRegistrations, users, workItems } from "../../db/schema";
import type { DashboardDatabase } from "../dashboard/postgres/repository";
import { planBulkDscMovement, planBulkNoticeChange, type BulkPlan, type DscBulkMovement, type NoticeBulkAction } from "./bulk";
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

export type UdinRow = {
  id: string; udin: string; clientName: string; documentType: string; documentDescription: string;
  signedByName: string; membershipNumber: string; generatedOn: string; status: string; revocationReason: string;
};

export type DscRow = {
  id: string; clientName: string; holderName: string; serialNumber: string; issuingAuthority: string;
  certificateClass: string; validFrom: string; validUntil: string; status: string; custodianName: string | null; storageLocation: string;
};

export type NoticeRow = {
  id: string; clientName: string; authority: string; noticeNumber: string; noticeSection: string; subject: string;
  noticeDate: string; receivedDate: string; responseDueDate: string; status: NoticeStatus; assigneeName: string | null; respondedOn: string | null;
};

export type RegistersWorkspaceData = {
  udins: UdinRow[];
  certificates: DscRow[];
  notices: NoticeRow[];
  metrics: { activeUdins: number; expiringCertificates: number; expiredCertificates: number; openNotices: number; overdueNotices: number };
  todayKey: string;
};

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

export async function listRegistersWorkspace(database: DashboardDatabase, tenantId: string, todayKey = indiaDateKey()): Promise<RegistersWorkspaceData> {
  if (!tenantId.trim()) throw new Error("Tenant is required.");
  const signer = alias(users, "udin_signer");
  const custodian = alias(users, "dsc_custodian");
  const assignee = alias(users, "notice_assignee");
  const [udins, certificates, notices] = await Promise.all([
    database.select({
      id: udinRegistrations.id, udin: udinRegistrations.udin, clientName: legalEntities.displayName,
      documentType: udinRegistrations.documentType, documentDescription: udinRegistrations.documentDescription,
      signedByName: signer.fullName, membershipNumber: udinRegistrations.membershipNumber,
      generatedOn: udinRegistrations.generatedOn, status: udinRegistrations.status, revocationReason: udinRegistrations.revocationReason,
    }).from(udinRegistrations)
      .innerJoin(legalEntities, and(eq(legalEntities.tenantId, udinRegistrations.tenantId), eq(legalEntities.id, udinRegistrations.legalEntityId)))
      .innerJoin(signer, eq(signer.id, udinRegistrations.signedByUserId))
      .where(eq(udinRegistrations.tenantId, tenantId))
      .orderBy(desc(udinRegistrations.generatedOn)),
    database.select({
      id: dscCertificates.id, clientName: legalEntities.displayName, holderName: dscCertificates.holderName,
      serialNumber: dscCertificates.serialNumber, issuingAuthority: dscCertificates.issuingAuthority,
      certificateClass: dscCertificates.certificateClass, validFrom: dscCertificates.validFrom, validUntil: dscCertificates.validUntil,
      status: dscCertificates.status, custodianName: custodian.fullName, storageLocation: dscCertificates.storageLocation,
    }).from(dscCertificates)
      .innerJoin(legalEntities, and(eq(legalEntities.tenantId, dscCertificates.tenantId), eq(legalEntities.id, dscCertificates.legalEntityId)))
      .leftJoin(custodian, eq(custodian.id, dscCertificates.custodianUserId))
      .where(eq(dscCertificates.tenantId, tenantId))
      .orderBy(asc(dscCertificates.validUntil)),
    database.select({
      id: statutoryNotices.id, clientName: legalEntities.displayName, authority: statutoryNotices.authority,
      noticeNumber: statutoryNotices.noticeNumber, noticeSection: statutoryNotices.noticeSection, subject: statutoryNotices.subject,
      noticeDate: statutoryNotices.noticeDate, receivedDate: statutoryNotices.receivedDate, responseDueDate: statutoryNotices.responseDueDate,
      status: statutoryNotices.status, assigneeName: assignee.fullName, respondedOn: statutoryNotices.respondedOn,
    }).from(statutoryNotices)
      .innerJoin(legalEntities, and(eq(legalEntities.tenantId, statutoryNotices.tenantId), eq(legalEntities.id, statutoryNotices.legalEntityId)))
      .leftJoin(assignee, eq(assignee.id, statutoryNotices.assigneeId))
      .where(eq(statutoryNotices.tenantId, tenantId))
      .orderBy(asc(statutoryNotices.responseDueDate)),
  ]);
  const warningKey = addDaysToDateKey(todayKey, DSC_EXPIRY_WARNING_DAYS);
  const liveCertificates = certificates.filter((certificate) => ["in_custody", "issued_out"].includes(certificate.status));
  const openNotices = notices.filter((notice) => ["open", "in_progress"].includes(notice.status));
  return {
    udins,
    certificates,
    notices: notices.map((notice) => ({ ...notice, status: notice.status as NoticeStatus })),
    metrics: {
      activeUdins: udins.filter((entry) => entry.status === "active").length,
      expiringCertificates: liveCertificates.filter((certificate) => certificate.validUntil >= todayKey && certificate.validUntil <= warningKey).length,
      expiredCertificates: liveCertificates.filter((certificate) => certificate.validUntil < todayKey).length,
      openNotices: openNotices.length,
      overdueNotices: openNotices.filter((notice) => notice.responseDueDate < todayKey).length,
    },
    todayKey,
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
