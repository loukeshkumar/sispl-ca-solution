"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requirePermission } from "../../lib/auth/server";
import { getDatabase } from "../../lib/dashboard/postgres/pool";
import { archiveTodo, completeTodo, createTodo, reopenTodo, TodoRepositoryError, updateTodo } from "../../lib/todos/repository";
import { validateTodoFields, type TodoActionState, type TodoFormFields } from "../../lib/todos/validation";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fieldNames = ["title", "notes", "dueDate", "dueTime", "priority", "category"] as const;

const todoFields = (formData: FormData): TodoFormFields => Object.fromEntries(
  fieldNames.map((field) => [field, typeof formData.get(field) === "string" ? String(formData.get(field)) : ""]),
);

const actionError = (error: unknown): TodoActionState => ({
  error: error instanceof TodoRepositoryError ? error.message : "The to-do could not be saved. Review the details and try again.",
  fieldErrors: {},
});

/**
 * Dialog-driven save: a present `todoId` makes it an update. It returns clean
 * state rather than redirecting, which is how the dialog knows to close.
 */
export async function saveTodoAction(_previous: TodoActionState, formData: FormData): Promise<TodoActionState> {
  const session = await requirePermission("dashboard:read", "/?workspace=todos");
  const rawId = String(formData.get("todoId") ?? "");
  const todoId = UUID_PATTERN.test(rawId) ? rawId : null;
  const validation = validateTodoFields(todoFields(formData));
  if (!validation.success) return { error: "Review the highlighted fields.", fieldErrors: validation.fieldErrors };
  try {
    if (todoId) await updateTodo(getDatabase(), session.tenantId, session.userId, todoId, validation.data);
    else await createTodo(getDatabase(), session.tenantId, session.userId, validation.data);
  } catch (error) {
    return actionError(error);
  }
  revalidatePath("/");
  return { error: "", fieldErrors: {} };
}

export async function createTodoAction(_previous: TodoActionState, formData: FormData): Promise<TodoActionState> {
  const session = await requirePermission("dashboard:read", "/todos/new");
  const validation = validateTodoFields(todoFields(formData));
  if (!validation.success) return { error: "Review the highlighted fields.", fieldErrors: validation.fieldErrors };
  try {
    await createTodo(getDatabase(), session.tenantId, session.userId, validation.data);
  } catch (error) {
    return actionError(error);
  }
  revalidatePath("/");
  redirect("/?workspace=todos");
}

export async function updateTodoAction(todoId: string, _previous: TodoActionState, formData: FormData): Promise<TodoActionState> {
  const session = await requirePermission("dashboard:read", `/todos/${todoId}/edit`);
  if (!UUID_PATTERN.test(todoId)) return { error: "The to-do reference is invalid.", fieldErrors: {} };
  const validation = validateTodoFields(todoFields(formData));
  if (!validation.success) return { error: "Review the highlighted fields.", fieldErrors: validation.fieldErrors };
  try {
    await updateTodo(getDatabase(), session.tenantId, session.userId, todoId, validation.data);
  } catch (error) {
    return actionError(error);
  }
  revalidatePath("/");
  revalidatePath(`/todos/${todoId}/edit`);
  redirect("/?workspace=todos");
}

function safeReturnPath(value: FormDataEntryValue | null) {
  return value === "/" ? "/" : "/?workspace=todos";
}

async function transitionTodo(formData: FormData, operation: "complete" | "reopen" | "archive") {
  const todoId = String(formData.get("todoId") ?? "");
  const returnTo = safeReturnPath(formData.get("returnTo"));
  const session = await requirePermission("dashboard:read", returnTo);
  if (!UUID_PATTERN.test(todoId)) redirect(returnTo);
  const execute = operation === "complete" ? completeTodo : operation === "reopen" ? reopenTodo : archiveTodo;
  try {
    await execute(getDatabase(), session.tenantId, session.userId, todoId);
  } catch {
    redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}todoError=state`);
  }
  revalidatePath("/");
  redirect(returnTo);
}

export async function completeTodoAction(formData: FormData) {
  return transitionTodo(formData, "complete");
}

export async function reopenTodoAction(formData: FormData) {
  return transitionTodo(formData, "reopen");
}

export async function archiveTodoAction(formData: FormData) {
  return transitionTodo(formData, "archive");
}
