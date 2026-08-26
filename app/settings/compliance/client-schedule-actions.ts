"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "../../../lib/auth/server";
import { getDatabase } from "../../../lib/dashboard/postgres/pool";
import {
  ClientScheduleError,
  createClientSchedule,
  createExtension,
  deleteClientSchedule,
} from "../../../lib/compliance/client-schedule-repository";

export type ClientScheduleActionState = { error: string; notice: string };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const initial: ClientScheduleActionState = { error: "", notice: "" };

const refresh = () => {
  revalidatePath("/settings/compliance");
  revalidatePath("/");
};

const failure = (error: unknown, fallback: string): ClientScheduleActionState => ({
  error: error instanceof ClientScheduleError ? error.message : fallback,
  notice: "",
});

const wholeNumber = (value: FormDataEntryValue | null) => {
  const parsed = Number(String(value ?? ""));
  return Number.isInteger(parsed) ? parsed : null;
};

export async function saveClientScheduleAction(
  _previous: ClientScheduleActionState,
  formData: FormData,
): Promise<ClientScheduleActionState> {
  const session = await requirePermission("services:manage", "/settings/compliance");
  const legalEntityId = String(formData.get("legalEntityId") ?? "");
  if (!UUID_PATTERN.test(legalEntityId)) return { error: "Choose a client.", notice: "" };

  const mode = String(formData.get("mode") ?? "");
  try {
    await createClientSchedule(getDatabase(), session.tenantId, session.userId, {
      dueDay: mode === "override" ? wholeNumber(formData.get("dueDay")) : null,
      dueMonthOffset: mode === "override" ? wholeNumber(formData.get("dueMonthOffset")) : null,
      effectiveFrom: String(formData.get("effectiveFrom") ?? ""),
      frequency: mode === "override" ? String(formData.get("frequency") ?? "") : null,
      internalLeadDays: mode === "override" ? wholeNumber(formData.get("internalLeadDays")) : null,
      legalEntityId,
      mode,
      note: String(formData.get("note") ?? ""),
      serviceCode: String(formData.get("serviceCode") ?? ""),
    });
  } catch (error) {
    return failure(error, "That schedule could not be saved.");
  }
  refresh();
  return { ...initial, notice: "Schedule recorded. It governs generation from its effective date." };
}

export async function removeClientScheduleAction(
  _previous: ClientScheduleActionState,
  formData: FormData,
): Promise<ClientScheduleActionState> {
  const session = await requirePermission("services:manage", "/settings/compliance");
  const scheduleId = String(formData.get("scheduleId") ?? "");
  if (!UUID_PATTERN.test(scheduleId)) return { error: "That schedule could not be found.", notice: "" };
  try {
    await deleteClientSchedule(getDatabase(), session.tenantId, session.userId, scheduleId);
  } catch (error) {
    return failure(error, "That schedule could not be removed.");
  }
  refresh();
  return { ...initial, notice: "Removed. This client follows the firm schedule again." };
}

/**
 * Recording an extension also applies it, so the notice says how much moved.
 * An extension recorded but not applied leaves the firm exactly where it was.
 */
export async function recordExtensionAction(
  _previous: ClientScheduleActionState,
  formData: FormData,
): Promise<ClientScheduleActionState> {
  const session = await requirePermission("services:manage", "/settings/compliance");
  const rawEntity = String(formData.get("legalEntityId") ?? "");
  try {
    const { moved } = await createExtension(getDatabase(), session.tenantId, session.userId, {
      authority: String(formData.get("authority") ?? ""),
      extendedDueDate: String(formData.get("extendedDueDate") ?? ""),
      legalEntityId: UUID_PATTERN.test(rawEntity) ? rawEntity : null,
      note: String(formData.get("note") ?? ""),
      originalDueDate: String(formData.get("originalDueDate") ?? ""),
      periodKey: String(formData.get("periodKey") ?? ""),
      serviceCode: String(formData.get("serviceCode") ?? ""),
    });
    refresh();
    return {
      ...initial,
      notice: moved === 0
        ? "Recorded. Nothing open matched this period yet, so it will apply as those obligations are raised."
        : `Recorded and applied. ${moved} open obligation${moved === 1 ? "" : "s"} moved; anything already filed was left as it was.`,
    };
  } catch (error) {
    return failure(error, "That extension could not be recorded.");
  }
}
