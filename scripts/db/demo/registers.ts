/**
 * UDIN, DSC custody and statutory notices.
 *
 * These also close a standing divergence: the development database has held
 * hand-seeded register rows that `seed.ts` never created, so a fresh clone did
 * not match the machine the feature was built on. Everything here goes through
 * the register services, so the DSC movement trail is real rather than a row
 * asserting that a movement happened.
 */
import { eq } from "drizzle-orm";

import { dscCertificates, legalEntities, statutoryNotices, udinRegistrations } from "../../../db/schema";
import type { DashboardDatabase } from "../../../lib/dashboard/postgres/repository";
import {
  recordDscCertificate,
  recordDscCustodyMovement,
  recordNotice,
  recordUdin,
  updateNoticeStatus,
} from "../../../lib/registers/repository";
import type { DemoContext } from "./context";

function shiftDays(dateKey: string, days: number) {
  const shifted = new Date(`${dateKey}T00:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

export async function seedDemoRegisters(database: DashboardDatabase, context: DemoContext) {
  const { todayKey } = context.calendar;
  const { administratorId, partnerId } = context.actors;
  const clients = await database.select({ id: legalEntities.id }).from(legalEntities)
    .where(eq(legalEntities.tenantId, context.tenantId)).orderBy(legalEntities.displayName);
  if (!clients.length) throw new Error("No clients found; run db:seed:local first.");

  let udinCount = 0;
  const [existingUdin] = await database.select({ id: udinRegistrations.id }).from(udinRegistrations)
    .where(eq(udinRegistrations.tenantId, context.tenantId)).limit(1);
  if (!existingUdin) {
    const udins = [
      { documentType: "tax_audit" as const, documentDescription: "Form 3CD for the year under audit" },
      { documentType: "certificate" as const, documentDescription: "Net worth certificate" },
      { documentType: "statutory_audit" as const, documentDescription: "Statutory audit report" },
    ];
    for (const [index, entry] of udins.entries()) {
      await recordUdin(database, context.tenantId, administratorId, {
        legalEntityId: clients[index % clients.length].id,
        workItemId: null,
        // Fictitious: an 18-digit form that is not a number ICAI issued.
        udin: `26${String(100000 + index).padStart(6, "0")}AAAAAA${String(1000 + index)}`,
        documentType: entry.documentType,
        documentDescription: entry.documentDescription,
        membershipNumber: "123456",
        signedByUserId: partnerId,
        generatedOn: shiftDays(todayKey, -20 - index * 9),
      });
      udinCount += 1;
    }
  }

  let dscCount = 0;
  const [existingDsc] = await database.select({ id: dscCertificates.id }).from(dscCertificates)
    .where(eq(dscCertificates.tenantId, context.tenantId)).limit(1);
  if (!existingDsc) {
    // One comfortably valid, one close to expiry so the alert surface is populated.
    const certificates = [
      { holderName: "Aarav Retail — Director", validUntil: shiftDays(todayKey, 400), movement: true },
      { holderName: "Koshi Infra — Designated Partner", validUntil: shiftDays(todayKey, 21), movement: false },
    ];
    for (const [index, certificate] of certificates.entries()) {
      const dscId = await recordDscCertificate(database, context.tenantId, administratorId, {
        legalEntityId: clients[index % clients.length].id,
        holderName: certificate.holderName,
        serialNumber: `DSC-DEMO-${1000 + index}`,
        issuingAuthority: "eMudhra",
        certificateClass: "class_3",
        validFrom: shiftDays(todayKey, -300),
        validUntil: certificate.validUntil,
        custodianUserId: administratorId,
        storageLocation: "Firm safe, drawer 2",
        // The register records custody and expiry only. PINs and private keys
        // are rejected by validation and must never be entered.
        notes: "Held for filing use.",
      });
      dscCount += 1;
      if (certificate.movement && typeof dscId === "string") {
        await recordDscCustodyMovement(database, context.tenantId, administratorId, {
          dscId,
          eventType: "issued_out",
          custodianUserId: partnerId,
          counterpartyName: "Priya M.",
          remarks: "Taken for ROC filing.",
        });
        await recordDscCustodyMovement(database, context.tenantId, administratorId, {
          dscId,
          eventType: "returned",
          custodianUserId: administratorId,
          counterpartyName: "Priya M.",
          remarks: "Returned to the firm safe.",
        });
      }
    }
  }

  let noticeCount = 0;
  const [existingNotice] = await database.select({ id: statutoryNotices.id }).from(statutoryNotices)
    .where(eq(statutoryNotices.tenantId, context.tenantId)).limit(1);
  if (!existingNotice) {
    const notices = [
      { authority: "gst" as const, section: "61", subject: "Scrutiny of returns", advanceTo: "in_progress" as const, dueIn: 9 },
      { authority: "income_tax" as const, section: "143(1)(a)", subject: "Proposed adjustment", advanceTo: "responded" as const, dueIn: 25 },
      { authority: "tds" as const, section: "200A", subject: "Short deduction intimation", advanceTo: null, dueIn: 4 },
    ];
    for (const [index, notice] of notices.entries()) {
      const noticeId = await recordNotice(database, context.tenantId, administratorId, {
        legalEntityId: clients[index % clients.length].id,
        workItemId: null,
        authority: notice.authority,
        noticeNumber: `DEMO/${notice.authority.toUpperCase()}/${2026 + index}`,
        noticeSection: notice.section,
        subject: notice.subject,
        noticeDate: shiftDays(todayKey, -14 - index * 5),
        receivedDate: shiftDays(todayKey, -12 - index * 5),
        responseDueDate: shiftDays(todayKey, notice.dueIn),
        assigneeId: context.actors.managerIds[index % Math.max(1, context.actors.managerIds.length)] ?? null,
      });
      if (notice.advanceTo && typeof noticeId === "string") {
        await updateNoticeStatus(database, context.tenantId, administratorId, noticeId, {
          status: notice.advanceTo,
          respondedOn: notice.advanceTo === "responded" ? shiftDays(todayKey, -2) : null,
          responseSummary: "Seeded demonstration progress.",
        });
      }
      noticeCount += 1;
    }
  }

  return { udin: udinCount, dsc: dscCount, notices: noticeCount };
}
