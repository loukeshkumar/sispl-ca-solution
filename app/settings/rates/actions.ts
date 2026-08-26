"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "../../../lib/auth/server";
import { indiaDateKey } from "../../../lib/attendance/calculations";
import { getDatabase } from "../../../lib/dashboard/postgres/pool";
import {
  RateError,
  removeClientRateOverride,
  saveClientRateOverride,
  saveEmployeeRate,
} from "../../../lib/rates/repository";

export type RateActionState = { error: string; fieldErrors: Record<string, string> };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const refresh = () => {
  revalidatePath("/settings/rates");
  revalidatePath("/");
};

const failure = (error: unknown): RateActionState => ({
  error: error instanceof RateError ? error.message : "That rate could not be saved. Refresh and try again.",
  fieldErrors: {},
});

/**
 * Rupees on the form, paise in the database.
 *
 * Money is never a float here, so the conversion happens once, at the boundary,
 * and anything that is not a clean amount is refused rather than rounded into
 * something the firm did not type.
 */
function rupeesToPaise(raw: string): number | null {
  const cleaned = raw.replace(/[,\s₹]/g, "");
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(cleaned)) return null;
  return Math.round(Number(cleaned) * 100);
}

export async function saveRateAction(_previous: RateActionState, formData: FormData): Promise<RateActionState> {
  const session = await requirePermission("billing:manage", "/settings/rates");
  const employeeUserId = String(formData.get("employeeUserId") ?? "");
  const effectiveFrom = String(formData.get("effectiveFrom") ?? "") || indiaDateKey();
  const charge = rupeesToPaise(String(formData.get("chargeRupees") ?? ""));
  const rawCost = String(formData.get("costRupees") ?? "").trim();
  const cost = rawCost === "" ? null : rupeesToPaise(rawCost);

  if (!UUID_PATTERN.test(employeeUserId)) return { error: "Choose an employee.", fieldErrors: {} };
  if (charge === null) return { error: "Review the highlighted fields.", fieldErrors: { chargeRupees: "Enter an hourly rate, for example 3500 or 3500.50." } };
  if (rawCost !== "" && cost === null) return { error: "Review the highlighted fields.", fieldErrors: { costRupees: "Enter an hourly cost, or leave it blank to derive it from payroll." } };

  try {
    await saveEmployeeRate(getDatabase(), session.tenantId, session.userId, {
      chargePaisePerHour: charge,
      costPaisePerHour: cost,
      effectiveFrom,
      employeeUserId,
      note: String(formData.get("note") ?? ""),
    });
  } catch (error) {
    return failure(error);
  }
  refresh();
  return { error: "", fieldErrors: {} };
}

export async function saveOverrideAction(_previous: RateActionState, formData: FormData): Promise<RateActionState> {
  const session = await requirePermission("billing:manage", "/settings/rates");
  const employeeUserId = String(formData.get("employeeUserId") ?? "");
  const legalEntityId = String(formData.get("legalEntityId") ?? "");
  const effectiveFrom = String(formData.get("effectiveFrom") ?? "") || indiaDateKey();
  const charge = rupeesToPaise(String(formData.get("chargeRupees") ?? ""));

  if (!UUID_PATTERN.test(employeeUserId)) return { error: "Choose an employee.", fieldErrors: {} };
  if (!UUID_PATTERN.test(legalEntityId)) return { error: "Choose a client.", fieldErrors: {} };
  if (charge === null) return { error: "Review the highlighted fields.", fieldErrors: { chargeRupees: "Enter the negotiated hourly rate." } };

  try {
    await saveClientRateOverride(getDatabase(), session.tenantId, session.userId, {
      chargePaisePerHour: charge,
      effectiveFrom,
      employeeUserId,
      legalEntityId,
      note: String(formData.get("note") ?? ""),
    });
  } catch (error) {
    return failure(error);
  }
  refresh();
  return { error: "", fieldErrors: {} };
}

export async function removeOverrideAction(_previous: RateActionState, formData: FormData): Promise<RateActionState> {
  const session = await requirePermission("billing:manage", "/settings/rates");
  const overrideId = String(formData.get("overrideId") ?? "");
  if (!UUID_PATTERN.test(overrideId)) return { error: "Choose a rate to withdraw.", fieldErrors: {} };
  try {
    await removeClientRateOverride(getDatabase(), session.tenantId, session.userId, overrideId);
  } catch (error) {
    return failure(error);
  }
  refresh();
  return { error: "", fieldErrors: {} };
}
