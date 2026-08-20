"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requirePermission } from "../../lib/auth/server";
import { getDatabase } from "../../lib/dashboard/postgres/pool";
import {
  cancelOfficeTask,
  completeOfficeTask,
  createOfficeTask,
  reopenOfficeTask,
  listTaskFormOptions,
  TaskRepositoryError,
  updateOfficeTask,
  updateOwnTaskStatus,
} from "../../lib/tasks/repository";
import { validateOfficeTaskFields, validateTaskSelfUpdateFields, type OfficeTaskFormFields, type TaskActionState } from "../../lib/tasks/validation";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fieldNames = ["assigneeId", "blockerNote", "description", "dueDate", "estimateMinutes", "legalEntityId", "priority", "reviewerId", "status", "title", "workItemId"];
const taskFields = (formData: FormData): OfficeTaskFormFields => Object.fromEntries(fieldNames.map((field) => [field, typeof formData.get(field) === "string" ? String(formData.get(field)) : ""]));

const repositoryError = (error: unknown): TaskActionState => ({
  error: error instanceof TaskRepositoryError ? error.message : "The task could not be saved. Review the details and try again.",
  fieldErrors: {},
});

export type TaskFormOptions = Awaited<ReturnType<typeof listTaskFormOptions>>;

/** Loaded when the dialog first opens rather than on every dashboard render. */
export async function loadTaskFormOptions(): Promise<TaskFormOptions> {
  const session = await requirePermission("tasks:assign", "/?workspace=tasks");
  return listTaskFormOptions(getDatabase(), session.tenantId);
}

/**
 * Dialog-driven save: a present `taskId` makes it an update. Returns clean state
 * instead of redirecting, which is how the dialog knows to close.
 */
export async function saveTaskAction(_previous: TaskActionState, formData: FormData): Promise<TaskActionState> {
  const session = await requirePermission("tasks:assign", "/?workspace=tasks");
  const rawId = String(formData.get("taskId") ?? "");
  const taskId = UUID_PATTERN.test(rawId) ? rawId : null;
  const validation = validateOfficeTaskFields(taskFields(formData));
  if (!validation.success) return { error: "Review the highlighted fields.", fieldErrors: validation.fieldErrors };
  if (["completed", "cancelled"].includes(validation.data.status)) return { error: "Use the task completion or cancellation control for terminal states.", fieldErrors: { status: "Select an active workflow state." } };
  try {
    if (taskId) await updateOfficeTask(getDatabase(), session.tenantId, session.userId, taskId, validation.data);
    else await createOfficeTask(getDatabase(), session.tenantId, session.userId, validation.data);
  } catch (error) {
    return repositoryError(error);
  }
  revalidatePath("/");
  if (taskId) revalidatePath(`/tasks/${taskId}`);
  return { error: "", fieldErrors: {} };
}


export async function updateOwnTaskAction(taskId: string, _previous: TaskActionState, formData: FormData): Promise<TaskActionState> {
  const session = await requirePermission("tasks:update:own", `/tasks/${taskId}`);
  if (!UUID_PATTERN.test(taskId)) return { error: "The task reference is invalid.", fieldErrors: {} };
  const validation = validateTaskSelfUpdateFields(taskFields(formData));
  if (!validation.success) return { error: "Review the task status.", fieldErrors: validation.fieldErrors };
  try {
    await updateOwnTaskStatus(getDatabase(), session.tenantId, session.userId, taskId, validation.data);
  } catch (error) {
    return repositoryError(error);
  }
  revalidatePath("/");
  revalidatePath(`/tasks/${taskId}`);
  return { error: "", fieldErrors: {} };
}

async function terminalAction(formData: FormData, operation: "complete" | "cancel" | "reopen") {
  const taskId = String(formData.get("taskId") ?? "");
  const session = await requirePermission("tasks:assign", UUID_PATTERN.test(taskId) ? `/tasks/${taskId}` : "/?workspace=tasks");
  if (!UUID_PATTERN.test(taskId)) redirect("/?workspace=tasks");
  const execute = operation === "complete" ? completeOfficeTask : operation === "cancel" ? cancelOfficeTask : reopenOfficeTask;
  try {
    await execute(getDatabase(), session.tenantId, session.userId, taskId);
  } catch {
    redirect(`/tasks/${taskId}?actionError=failed`);
  }
  revalidatePath("/");
  revalidatePath(`/tasks/${taskId}`);
  redirect(`/tasks/${taskId}?toast=task-${operation === "complete" ? "completed" : operation === "cancel" ? "cancelled" : "reopened"}`);
}

export const completeTaskAction = async (formData: FormData) => terminalAction(formData, "complete");
export const cancelTaskAction = async (formData: FormData) => terminalAction(formData, "cancel");
export const reopenTaskAction = async (formData: FormData) => terminalAction(formData, "reopen");
