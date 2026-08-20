"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "../../lib/auth/server";
import { getDatabase } from "../../lib/dashboard/postgres/pool";
import { emptyRegisterBulkState, type DscBulkMovement, type NoticeBulkAction, type RegisterBulkState } from "../../lib/registers/bulk";
import { applyBulkDscMovement, applyBulkNoticeChange } from "../../lib/registers/repository";
import { noticeStatuses } from "../../lib/registers/validation";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ids = (formData: FormData, field: string) => formData.getAll(field).map(String).filter((id) => UUID_PATTERN.test(id));

export async function applyBulkNoticeAction(_previous: RegisterBulkState, formData: FormData): Promise<RegisterBulkState> {
  const session = await requirePermission("registers:manage", "/?workspace=registers");
  const kind = String(formData.get("kind") ?? "");
  let action: NoticeBulkAction | null = null;
  if (kind === "status") {
    const status = String(formData.get("status") ?? "");
    if (noticeStatuses.includes(status as never)) action = { kind, status: status as typeof noticeStatuses[number] };
  } else if (kind === "assignee") {
    const memberId = String(formData.get("memberId") ?? "").trim();
    if (!memberId || UUID_PATTERN.test(memberId)) action = { kind, memberId: memberId || null };
  }
  if (!action) return { ...emptyRegisterBulkState, error: "Choose a valid bulk change." };
  const noticeIds = ids(formData, "noticeId");
  if (!noticeIds.length) return { ...emptyRegisterBulkState, error: "Select at least one notice." };

  try {
    const plan = await applyBulkNoticeChange(getDatabase(), session.tenantId, session.userId, noticeIds, action);
    revalidatePath("/");
    return { applied: plan.apply.length, error: "", skipped: plan.skip };
  } catch (error) {
    console.error("Bulk notice change failed.", { errorType: error instanceof Error ? error.name : "UnknownError" });
    return { ...emptyRegisterBulkState, error: "That bulk change could not be applied." };
  }
}

export async function applyBulkDscAction(_previous: RegisterBulkState, formData: FormData): Promise<RegisterBulkState> {
  const session = await requirePermission("registers:manage", "/?workspace=registers");
  const eventType = String(formData.get("eventType") ?? "");
  if (!["issued_out", "returned", "surrendered"].includes(eventType)) {
    return { ...emptyRegisterBulkState, error: "Choose a valid custody movement." };
  }
  const custodianUserId = String(formData.get("custodianUserId") ?? "").trim();
  if (custodianUserId && !UUID_PATTERN.test(custodianUserId)) {
    return { ...emptyRegisterBulkState, error: "Select a valid custodian." };
  }
  const movement: DscBulkMovement = {
    counterpartyName: String(formData.get("counterpartyName") ?? "").trim().slice(0, 120),
    custodianUserId: custodianUserId || null,
    eventType: eventType as DscBulkMovement["eventType"],
  };
  const dscIds = ids(formData, "dscId");
  if (!dscIds.length) return { ...emptyRegisterBulkState, error: "Select at least one certificate." };

  try {
    const plan = await applyBulkDscMovement(getDatabase(), session.tenantId, session.userId, dscIds, movement);
    revalidatePath("/");
    return { applied: plan.apply.length, error: "", skipped: plan.skip };
  } catch (error) {
    console.error("Bulk custody movement failed.", { errorType: error instanceof Error ? error.name : "UnknownError" });
    return { ...emptyRegisterBulkState, error: "That custody movement could not be applied." };
  }
}
