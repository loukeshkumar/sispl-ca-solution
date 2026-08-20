"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requirePermission } from "../../lib/auth/server";
import { getDatabase } from "../../lib/dashboard/postgres/pool";
import {
  RegisterRepositoryError,
  recordDscCertificate,
  recordDscCustodyMovement,
  recordNotice,
  recordUdin,
  revokeUdin,
  updateNoticeStatus,
} from "../../lib/registers/repository";
import {
  isDateKey,
  noticeStatuses,
  validateDscFields,
  validateNoticeFields,
  validateUdinFields,
  type DscFieldErrors,
  type NoticeFieldErrors,
  type NoticeStatus,
  type UdinFieldErrors,
} from "../../lib/registers/validation";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REGISTERS_URL = "/?workspace=registers";

export type UdinActionState = { error: string; fieldErrors: UdinFieldErrors };
export type DscActionState = { error: string; fieldErrors: DscFieldErrors };
export type NoticeActionState = { error: string; fieldErrors: NoticeFieldErrors };

function fields(formData: FormData) {
  return Object.fromEntries(
    [...formData.entries()].filter(([, value]) => typeof value === "string").map(([key, value]) => [key, String(value)]),
  );
}

function message(error: unknown, fallback: string) {
  return error instanceof RegisterRepositoryError ? error.message : fallback;
}

/*
 * Dialog-driven saves. Each returns clean state rather than redirecting, which
 * is how the dialog knows to close. Register entries are append-only records of
 * something that happened elsewhere, so these create but never update.
 */
export async function saveUdinAction(_previous: UdinActionState, formData: FormData): Promise<UdinActionState> {
  const session = await requirePermission("registers:manage", REGISTERS_URL);
  const validation = validateUdinFields(fields(formData));
  if (!validation.success) return { error: "Review the highlighted fields.", fieldErrors: validation.fieldErrors };
  try {
    await recordUdin(getDatabase(), session.tenantId, session.userId, validation.data);
  } catch (error) {
    return { error: message(error, "The UDIN could not be recorded."), fieldErrors: {} };
  }
  revalidatePath("/");
  return { error: "", fieldErrors: {} };
}

export async function saveDscAction(_previous: DscActionState, formData: FormData): Promise<DscActionState> {
  const session = await requirePermission("registers:manage", REGISTERS_URL);
  const validation = validateDscFields(fields(formData));
  if (!validation.success) return { error: "Review the highlighted fields.", fieldErrors: validation.fieldErrors };
  try {
    await recordDscCertificate(getDatabase(), session.tenantId, session.userId, validation.data);
  } catch (error) {
    return { error: message(error, "The certificate could not be registered."), fieldErrors: {} };
  }
  revalidatePath("/");
  return { error: "", fieldErrors: {} };
}

export async function saveNoticeAction(_previous: NoticeActionState, formData: FormData): Promise<NoticeActionState> {
  const session = await requirePermission("registers:manage", REGISTERS_URL);
  const validation = validateNoticeFields(fields(formData));
  if (!validation.success) return { error: "Review the highlighted fields.", fieldErrors: validation.fieldErrors };
  try {
    await recordNotice(getDatabase(), session.tenantId, session.userId, validation.data);
  } catch (error) {
    return { error: message(error, "The notice could not be recorded."), fieldErrors: {} };
  }
  revalidatePath("/");
  return { error: "", fieldErrors: {} };
}

export async function revokeUdinAction(formData: FormData) {
  const session = await requirePermission("registers:manage", REGISTERS_URL);
  const udinId = String(formData.get("udinId") ?? "");
  const reason = String(formData.get("reason") ?? "").trim().slice(0, 500);
  if (!UUID_PATTERN.test(udinId) || reason.length < 3) redirect(`${REGISTERS_URL}&registerError=reason`);
  try {
    await revokeUdin(getDatabase(), session.tenantId, session.userId, udinId, reason);
  } catch {
    redirect(`${REGISTERS_URL}&registerError=state`);
  }
  revalidatePath("/");
  redirect(REGISTERS_URL);
}

export async function recordDscMovementAction(formData: FormData) {
  const session = await requirePermission("registers:manage", REGISTERS_URL);
  const dscId = String(formData.get("dscId") ?? "");
  const eventType = String(formData.get("eventType") ?? "");
  const custodianUserId = String(formData.get("custodianUserId") ?? "");
  const counterpartyName = String(formData.get("counterpartyName") ?? "").trim().slice(0, 120);
  const remarks = String(formData.get("remarks") ?? "").trim().slice(0, 500);
  if (!UUID_PATTERN.test(dscId) || !["issued_out", "returned", "surrendered"].includes(eventType)) {
    redirect(`${REGISTERS_URL}&registerError=state`);
  }
  try {
    await recordDscCustodyMovement(getDatabase(), session.tenantId, session.userId, {
      dscId,
      eventType: eventType as "issued_out" | "returned" | "surrendered",
      custodianUserId: UUID_PATTERN.test(custodianUserId) ? custodianUserId : null,
      counterpartyName,
      remarks,
    });
  } catch {
    redirect(`${REGISTERS_URL}&registerError=state`);
  }
  revalidatePath("/");
  redirect(REGISTERS_URL);
}

export async function updateNoticeStatusAction(formData: FormData) {
  const session = await requirePermission("registers:manage", REGISTERS_URL);
  const noticeId = String(formData.get("noticeId") ?? "");
  const status = String(formData.get("status") ?? "");
  const respondedOn = String(formData.get("respondedOn") ?? "");
  const responseSummary = String(formData.get("responseSummary") ?? "").trim().slice(0, 2000);
  if (!UUID_PATTERN.test(noticeId) || !noticeStatuses.includes(status as NoticeStatus)) redirect(`${REGISTERS_URL}&registerError=state`);
  const closing = status === "responded" || status === "closed";
  if (closing && !isDateKey(respondedOn)) redirect(`${REGISTERS_URL}&registerError=dates`);
  try {
    await updateNoticeStatus(getDatabase(), session.tenantId, session.userId, noticeId, {
      status: status as NoticeStatus,
      respondedOn: closing ? respondedOn : null,
      responseSummary,
    });
  } catch {
    redirect(`${REGISTERS_URL}&registerError=state`);
  }
  revalidatePath("/");
  redirect(REGISTERS_URL);
}
