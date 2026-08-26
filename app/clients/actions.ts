"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requirePermission } from "../../lib/auth/server";
import { getDatabase } from "../../lib/dashboard/postgres/pool";
import { archiveClient, ClientRepositoryError, createClient, listActiveClientOwners, updateClient } from "../../lib/clients/repository";
import { listActiveServiceOptions } from "../../lib/packages/repository";
import { validateClientFields, type ClientActionState, type ClientFormFields } from "../../lib/clients/validation";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function clientFields(formData: FormData): ClientFormFields {
  return {
    city: formData.get("city") as string,
    displayName: formData.get("displayName") as string,
    entityType: formData.get("entityType") as string,
    gstRegistrations: formData.get("gstRegistrations") as string,
    healthScore: formData.get("healthScore") as string,
    legalName: formData.get("legalName") as string,
    maskedPan: formData.get("maskedPan") as string,
    ownerId: formData.get("ownerId") as string,
    relationshipStart: formData.get("relationshipStart") as string,
    riskStatus: formData.get("riskStatus") as string,
    services: formData.getAll("services") as string[],
  };
}

function writeError(error: unknown): ClientActionState {
  const databaseCode = typeof error === "object" && error && "code" in error ? String(error.code) : "";
  if (databaseCode === "23505") {
    return { error: "A client with the same legal name already exists in this firm.", fieldErrors: {} };
  }
  if (error instanceof ClientRepositoryError && error.code === "invalid_service") return { error: error.message, fieldErrors: { services: "Choose active services from Service Management." } };
  return { error: "The client could not be saved. Review the details and try again.", fieldErrors: {} };
}

export type ClientFormOptions = {
  members: Awaited<ReturnType<typeof listActiveClientOwners>>;
  services: Awaited<ReturnType<typeof listActiveServiceOptions>>;
};

/** Loaded when the dialog first opens rather than on every dashboard render. */
export async function loadClientFormOptions(): Promise<ClientFormOptions> {
  const session = await requirePermission("clients:write", "/?workspace=clients");
  const database = getDatabase();
  const [members, services] = await Promise.all([
    listActiveClientOwners(database, session.tenantId),
    listActiveServiceOptions(database, session.tenantId),
  ]);
  return { members, services };
}

/**
 * Dialog-driven save: a present `clientId` makes it an update. Returns clean
 * state instead of redirecting, which is how the dialog knows to close.
 */
export async function saveClientAction(_previous: ClientActionState, formData: FormData): Promise<ClientActionState> {
  const session = await requirePermission("clients:write", "/?workspace=clients");
  const rawId = String(formData.get("clientId") ?? "");
  const clientId = UUID_PATTERN.test(rawId) ? rawId : null;
  const validation = validateClientFields(clientFields(formData));
  if (!validation.success) return { error: "Review the highlighted fields.", fieldErrors: validation.fieldErrors };
  try {
    if (clientId) await updateClient(getDatabase(), session.tenantId, session.userId, clientId, validation.data);
    else await createClient(getDatabase(), session.tenantId, session.userId, validation.data);
  } catch (error) {
    return writeError(error);
  }
  revalidatePath("/");
  return { error: "", fieldErrors: {} };
}


export async function archiveClientAction(formData: FormData) {
  const clientIdValue = formData.get("clientId");
  const clientId = typeof clientIdValue === "string" ? clientIdValue : "";
  const session = await requirePermission("clients:write", UUID_PATTERN.test(clientId) ? `/clients/${clientId}` : "/");
  if (!UUID_PATTERN.test(clientId)) redirect("/?workspace=clients");

  try {
    await archiveClient(getDatabase(), session.tenantId, session.userId, clientId);
  } catch (error) {
    if (error instanceof ClientRepositoryError && error.code === "active_obligations") {
      redirect(`/clients/${clientId}?archiveError=active-obligations`);
    }
    redirect(`/clients/${clientId}`);
  }
  revalidatePath("/");
  redirect("/?workspace=clients&toast=client-archived");
}
