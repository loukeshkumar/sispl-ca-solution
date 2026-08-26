"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requirePermission } from "../../../lib/auth/server";
import { getDatabase } from "../../../lib/dashboard/postgres/pool";
import { createInvoiceFromTime, TimeBillingError } from "../../../lib/billing/time-billing-repository";

export type FromTimeActionState = { error: string };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Lines arrive as parallel arrays keyed by index, which is how a form posts a
 * repeated group. The entry ids travel with them so the server claims exactly
 * what the person was looking at, not whatever is unbilled by the time it runs.
 */
export async function createFromTimeAction(
  _previous: FromTimeActionState,
  formData: FormData,
): Promise<FromTimeActionState> {
  const session = await requirePermission("billing:manage", "/?workspace=billing");
  const legalEntityId = String(formData.get("legalEntityId") ?? "");
  if (!UUID_PATTERN.test(legalEntityId)) return { error: "Choose a client." };

  const descriptions = formData.getAll("lineDescription").map((value) => String(value));
  const amounts = formData.getAll("lineAmount").map((value) => String(value));
  const entryIdGroups = formData.getAll("lineEntryIds").map((value) => String(value));
  const reasons = formData.getAll("lineWriteOffReason").map((value) => String(value));

  const lines = descriptions.map((description, index) => ({
    amountPaise: Math.round(Number(amounts[index] ?? "0") * 100),
    description,
    entryIds: (entryIdGroups[index] ?? "").split(",").filter(Boolean),
    writeOffReason: reasons[index] ?? "",
  })).filter((line) => line.entryIds.length > 0);

  if (lines.some((line) => !Number.isFinite(line.amountPaise))) return { error: "Enter each amount in rupees." };

  let invoiceId: string;
  try {
    invoiceId = await createInvoiceFromTime(getDatabase(), session.tenantId, session.userId, {
      legalEntityId,
      lines,
      notes: String(formData.get("notes") ?? ""),
      periodFrom: String(formData.get("periodFrom") ?? ""),
      periodLabel: String(formData.get("periodLabel") ?? ""),
      periodTo: String(formData.get("periodTo") ?? ""),
    });
  } catch (error) {
    return { error: error instanceof TimeBillingError ? error.message : "That invoice could not be drafted." };
  }
  revalidatePath("/");
  revalidatePath("/billing/from-time");
  redirect(`/billing/${invoiceId}`);
}
