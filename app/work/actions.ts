"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requirePermission } from "../../lib/auth/server";
import { getDatabase } from "../../lib/dashboard/postgres/pool";
import { completeWorkItem, createWorkItem, listWorkClients, listWorkMembers, updateWorkItem, WorkRepositoryError } from "../../lib/work/repository";
import { validateWorkFields, type WorkActionState, type WorkFormFields } from "../../lib/work/validation";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function workFields(formData: FormData): WorkFormFields {
  const fields = [
    "assigneeId",
    "blockerNote",
    "budgetMinutes",
    "internalDueDate",
    "legalEntityId",
    "missingItemCount",
    "periodKey",
    "progress",
    "reviewerId",
    "serviceKey",
    "statutoryDueDate",
    "status",
  ];
  return Object.fromEntries(fields.map((key) => [key, typeof formData.get(key) === "string" ? formData.get(key) as string : ""]));
}

function writeError(error: unknown): WorkActionState {
  const databaseCode = typeof error === "object" && error && "code" in error ? String(error.code) : "";
  if (databaseCode === "23505") return { error: "This client already has the same service and period work item.", fieldErrors: {} };
  if (error instanceof WorkRepositoryError && error.code === "invalid_service") return { error: error.message, fieldErrors: { serviceKey: "Choose a service included in this client's package." } };
  return { error: "The work item could not be saved. Review the details and try again.", fieldErrors: {} };
}

export type WorkFormOptions = {
  clients: Awaited<ReturnType<typeof listWorkClients>>;
  defaults: { internalDueDate: string; statutoryDueDate: string };
  todayKey: string;
  members: Awaited<ReturnType<typeof listWorkMembers>>;
};

function dateOffset(days: number) {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Loaded when the dialog first opens rather than on every dashboard render.
 * Due-date defaults are computed here so the server and the client agree on
 * "today" — deriving them in the browser would desynchronise hydration.
 */
export async function loadWorkFormOptions(): Promise<WorkFormOptions> {
  const session = await requirePermission("work:write", "/?workspace=work");
  const database = getDatabase();
  const [clients, members] = await Promise.all([
    listWorkClients(database, session.tenantId),
    listWorkMembers(database, session.tenantId),
  ]);
  return { clients, defaults: { internalDueDate: dateOffset(5), statutoryDueDate: dateOffset(7) }, members, todayKey: dateOffset(0) };
}

/**
 * Dialog-driven save: a present `workItemId` makes it an update. Returns clean
 * state instead of redirecting, which is how the dialog knows to close.
 */
export async function saveWorkAction(_previous: WorkActionState, formData: FormData): Promise<WorkActionState> {
  const session = await requirePermission("work:write", "/?workspace=work");
  const rawId = String(formData.get("workItemId") ?? "");
  const workItemId = UUID_PATTERN.test(rawId) ? rawId : null;
  const validation = validateWorkFields(workFields(formData));
  if (!validation.success) return { error: "Review the highlighted fields.", fieldErrors: validation.fieldErrors };
  try {
    if (workItemId) await updateWorkItem(getDatabase(), session.tenantId, session.userId, workItemId, validation.data);
    else await createWorkItem(getDatabase(), session.tenantId, session.userId, validation.data);
  } catch (error) {
    return writeError(error);
  }
  revalidatePath("/");
  if (workItemId) revalidatePath(`/work/${workItemId}`);
  return { error: "", fieldErrors: {} };
}


export async function completeWorkAction(formData: FormData) {
  const value = formData.get("workItemId");
  const workItemId = typeof value === "string" ? value : "";
  const session = await requirePermission("work:write", UUID_PATTERN.test(workItemId) ? `/work/${workItemId}` : "/");
  if (!UUID_PATTERN.test(workItemId)) redirect("/?workspace=work");
  try {
    await completeWorkItem(getDatabase(), session.tenantId, session.userId, workItemId);
  } catch {
    redirect(`/work/${workItemId}`);
  }
  revalidatePath("/");
  revalidatePath(`/work/${workItemId}`);
  redirect(`/work/${workItemId}?toast=work-completed`);
}
