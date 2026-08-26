"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "../../lib/auth/server";
import { getDatabase } from "../../lib/dashboard/postgres/pool";
import {
  AcceptanceError,
  decideAcceptance,
  recordCheck,
  saveLetter,
} from "../../lib/clients/acceptance-repository";

export type AcceptanceActionState = { error: string; notice: string };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const refresh = (legalEntityId: string) => {
  revalidatePath(`/clients/${legalEntityId}`);
  revalidatePath("/clients/[clientId]", "page");
  revalidatePath("/");
};

const failure = (error: unknown, fallback: string): AcceptanceActionState => ({
  error: error instanceof AcceptanceError ? error.message : fallback,
  notice: "",
});

export async function recordCheckAction(
  _previous: AcceptanceActionState,
  formData: FormData,
): Promise<AcceptanceActionState> {
  const session = await requirePermission("clients:write", "/?workspace=clients");
  const legalEntityId = String(formData.get("legalEntityId") ?? "");
  if (!UUID_PATTERN.test(legalEntityId)) return { error: "That client could not be found.", notice: "" };
  try {
    await recordCheck(getDatabase(), session.tenantId, session.userId, legalEntityId, {
      checkKey: String(formData.get("checkKey") ?? ""),
      checkedOn: String(formData.get("checkedOn") ?? ""),
      note: String(formData.get("note") ?? ""),
      outcome: String(formData.get("outcome") ?? ""),
    });
  } catch (error) {
    return failure(error, "That check could not be recorded.");
  }
  refresh(legalEntityId);
  return { error: "", notice: "Check recorded against your name." };
}

/**
 * The decision that turns a prospect into a client, or does not.
 *
 * Accepting sets the entity active, which is what every gate in the system
 * already tests for; nothing else has to know about acceptance at all.
 */
export async function decideAcceptanceAction(
  _previous: AcceptanceActionState,
  formData: FormData,
): Promise<AcceptanceActionState> {
  const session = await requirePermission("clients:write", "/?workspace=clients");
  const legalEntityId = String(formData.get("legalEntityId") ?? "");
  const outcome = String(formData.get("outcome") ?? "");
  if (!UUID_PATTERN.test(legalEntityId)) return { error: "That client could not be found.", notice: "" };
  try {
    await decideAcceptance(getDatabase(), session.tenantId, session.userId, legalEntityId, outcome, String(formData.get("reason") ?? ""));
  } catch (error) {
    return failure(error, "That decision could not be recorded.");
  }
  refresh(legalEntityId);
  return {
    error: "",
    notice: outcome === "accepted"
      ? "Accepted. Work, packages and invoices can now be raised for this client."
      : "Declined. Nothing can be raised against them.",
  };
}

export async function saveLetterAction(
  _previous: AcceptanceActionState,
  formData: FormData,
): Promise<AcceptanceActionState> {
  const session = await requirePermission("clients:write", "/?workspace=clients");
  const legalEntityId = String(formData.get("legalEntityId") ?? "");
  if (!UUID_PATTERN.test(legalEntityId)) return { error: "That client could not be found.", notice: "" };
  const status = String(formData.get("status") ?? "");
  const issuedOn = String(formData.get("issuedOn") ?? "");
  const signedOn = String(formData.get("signedOn") ?? "");
  try {
    await saveLetter(getDatabase(), session.tenantId, session.userId, legalEntityId, {
      feeBasis: String(formData.get("feeBasis") ?? "fixed_retainer"),
      issuedOn: issuedOn || null,
      note: String(formData.get("note") ?? ""),
      periodFrom: String(formData.get("periodFrom") ?? ""),
      periodTo: String(formData.get("periodTo") ?? ""),
      serviceCodes: formData.getAll("serviceCodes").map((value) => String(value)),
      signedOn: signedOn || null,
      status,
    });
  } catch (error) {
    return failure(error, "That letter could not be saved.");
  }
  refresh(legalEntityId);
  return { error: "", notice: "Letter recorded. Work is measured against the services and period it names." };
}
