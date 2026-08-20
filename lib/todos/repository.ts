import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray } from "drizzle-orm";

import { personalTodos } from "../../db/schema";
import type { DashboardDatabase } from "../dashboard/postgres/repository";
import { planBulkTodoChange, type TodoBulkAction, type TodoBulkPlan } from "./bulk";
import type { TodoQueueParams } from "./queue-params";
import { buildLoadStrip, nextDueDate, type LoadStripDay } from "./recurrence";
import type { TodoInput, TodoPriority, TodoStatus } from "./validation";

export class TodoRepositoryError extends Error {
  constructor(public readonly code: "not_found" | "invalid_state") {
    super(code === "not_found" ? "To-do not found or no longer available." : "The to-do cannot move to that state.");
    this.name = "TodoRepositoryError";
  }
}

export type TodoRow = {
  id: string;
  title: string;
  notes: string;
  dueDate: string | null;
  dueTime: string | null;
  priority: TodoPriority;
  category: string;
  status: TodoStatus;
  recurrenceRule: string | null;
  recurrenceInterval: number | null;
  completedAt: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type TodoWorkspaceData = {
  todos: TodoRow[];
  metrics: { open: number; overdue: number; dueToday: number; upcoming: number; completed: number };
  categories: string[];
  todayKey: string;
};

type TodoDatabaseRow = Omit<TodoRow, "priority" | "status" | "completedAt" | "archivedAt" | "createdAt" | "updatedAt"> & {
  priority: string;
  status: string;
  completedAt: Date | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

const priorityRank: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
const statusRank: Record<string, number> = { open: 0, completed: 1, archived: 2 };

export function indiaDateKey(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function buildTodoWorkspace(rows: TodoDatabaseRow[], todayKey = indiaDateKey()): TodoWorkspaceData {
  const todos: TodoRow[] = rows.map((row) => ({
    ...row,
    priority: row.priority as TodoPriority,
    status: row.status as TodoStatus,
    completedAt: row.completedAt?.toISOString() ?? null,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  })).sort((left, right) => {
    const byStatus = (statusRank[left.status] ?? 9) - (statusRank[right.status] ?? 9);
    if (byStatus) return byStatus;
    const leftDue = left.dueDate ?? "9999-12-31";
    const rightDue = right.dueDate ?? "9999-12-31";
    if (leftDue !== rightDue) return leftDue.localeCompare(rightDue);
    const byPriority = (priorityRank[left.priority] ?? 9) - (priorityRank[right.priority] ?? 9);
    if (byPriority) return byPriority;
    return right.updatedAt.localeCompare(left.updatedAt);
  });
  const open = todos.filter((todo) => todo.status === "open");
  return {
    todos,
    metrics: {
      open: open.length,
      overdue: open.filter((todo) => todo.dueDate !== null && todo.dueDate < todayKey).length,
      dueToday: open.filter((todo) => todo.dueDate === todayKey).length,
      upcoming: open.filter((todo) => todo.dueDate !== null && todo.dueDate > todayKey).length,
      completed: todos.filter((todo) => todo.status === "completed").length,
    },
    categories: [...new Set(todos.map((todo) => todo.category).filter(Boolean))].sort((left, right) => left.localeCompare(right)),
    todayKey,
  };
}

function requireIdentity(tenantId: string, ownerUserId: string) {
  if (!tenantId.trim() || !ownerUserId.trim()) throw new Error("Tenant and owner are required.");
}

export async function listTodoWorkspace(database: DashboardDatabase, tenantId: string, ownerUserId: string, todayKey = indiaDateKey()) {
  requireIdentity(tenantId, ownerUserId);
  const rows = await database.select({
    id: personalTodos.id,
    title: personalTodos.title,
    notes: personalTodos.notes,
    dueDate: personalTodos.dueDate,
    dueTime: personalTodos.dueTime,
    priority: personalTodos.priority,
    category: personalTodos.category,
    status: personalTodos.status,
    recurrenceRule: personalTodos.recurrenceRule,
    recurrenceInterval: personalTodos.recurrenceInterval,
    completedAt: personalTodos.completedAt,
    archivedAt: personalTodos.archivedAt,
    createdAt: personalTodos.createdAt,
    updatedAt: personalTodos.updatedAt,
  }).from(personalTodos).where(and(
    eq(personalTodos.tenantId, tenantId),
    eq(personalTodos.ownerUserId, ownerUserId),
  )).orderBy(desc(personalTodos.updatedAt));
  return buildTodoWorkspace(rows, todayKey);
}

export async function getTodo(database: DashboardDatabase, tenantId: string, ownerUserId: string, todoId: string): Promise<TodoRow | null> {
  requireIdentity(tenantId, ownerUserId);
  const [row] = await database.select({
    id: personalTodos.id,
    title: personalTodos.title,
    notes: personalTodos.notes,
    dueDate: personalTodos.dueDate,
    dueTime: personalTodos.dueTime,
    priority: personalTodos.priority,
    category: personalTodos.category,
    status: personalTodos.status,
    recurrenceRule: personalTodos.recurrenceRule,
    recurrenceInterval: personalTodos.recurrenceInterval,
    completedAt: personalTodos.completedAt,
    archivedAt: personalTodos.archivedAt,
    createdAt: personalTodos.createdAt,
    updatedAt: personalTodos.updatedAt,
  }).from(personalTodos).where(and(
    eq(personalTodos.id, todoId),
    eq(personalTodos.tenantId, tenantId),
    eq(personalTodos.ownerUserId, ownerUserId),
  )).limit(1);
  return row ? buildTodoWorkspace([row]).todos[0] ?? null : null;
}

export async function createTodo(database: DashboardDatabase, tenantId: string, ownerUserId: string, input: TodoInput) {
  requireIdentity(tenantId, ownerUserId);
  const id = randomUUID();
  await database.insert(personalTodos).values({ id, tenantId, ownerUserId, ...input, status: "open" });
  return id;
}

export async function updateTodo(database: DashboardDatabase, tenantId: string, ownerUserId: string, todoId: string, input: TodoInput) {
  requireIdentity(tenantId, ownerUserId);
  const [updated] = await database.update(personalTodos).set({ ...input, updatedAt: new Date() }).where(and(
    eq(personalTodos.id, todoId),
    eq(personalTodos.tenantId, tenantId),
    eq(personalTodos.ownerUserId, ownerUserId),
    inArray(personalTodos.status, ["open", "completed"]),
  )).returning({ id: personalTodos.id });
  if (!updated) throw new TodoRepositoryError("not_found");
}

/**
 * Completing a repeating to-do schedules the next one in the same transaction,
 * so the chain can never advance without the completion landing. Generation
 * happens here rather than in a job: a personal reminder you have not dealt
 * with should not breed duplicates on top of itself.
 */
export async function completeTodo(database: DashboardDatabase, tenantId: string, ownerUserId: string, todoId: string) {
  requireIdentity(tenantId, ownerUserId);
  return database.transaction(async (transaction) => {
    const now = new Date();
    const [updated] = await transaction.update(personalTodos).set({ status: "completed", completedAt: now, archivedAt: null, updatedAt: now }).where(and(
      eq(personalTodos.id, todoId),
      eq(personalTodos.tenantId, tenantId),
      eq(personalTodos.ownerUserId, ownerUserId),
      eq(personalTodos.status, "open"),
    )).returning({
      category: personalTodos.category,
      dueDate: personalTodos.dueDate,
      dueTime: personalTodos.dueTime,
      notes: personalTodos.notes,
      priority: personalTodos.priority,
      recurrenceInterval: personalTodos.recurrenceInterval,
      recurrenceRule: personalTodos.recurrenceRule,
      title: personalTodos.title,
    });
    if (!updated) throw new TodoRepositoryError("invalid_state");

    if (!updated.recurrenceRule || !updated.recurrenceInterval || !updated.dueDate) return null;
    const dueDate = nextDueDate(updated.dueDate, updated.recurrenceRule as "day" | "week" | "month", updated.recurrenceInterval);
    if (!dueDate) return null;
    const nextId = randomUUID();
    await transaction.insert(personalTodos).values({
      id: nextId,
      tenantId,
      ownerUserId,
      title: updated.title,
      notes: updated.notes,
      dueDate,
      dueTime: updated.dueTime,
      priority: updated.priority,
      category: updated.category,
      status: "open",
      recurrenceRule: updated.recurrenceRule,
      recurrenceInterval: updated.recurrenceInterval,
    });
    return nextId;
  });
}

export async function reopenTodo(database: DashboardDatabase, tenantId: string, ownerUserId: string, todoId: string) {
  requireIdentity(tenantId, ownerUserId);
  const [updated] = await database.update(personalTodos).set({ status: "open", completedAt: null, archivedAt: null, updatedAt: new Date() }).where(and(
    eq(personalTodos.id, todoId),
    eq(personalTodos.tenantId, tenantId),
    eq(personalTodos.ownerUserId, ownerUserId),
    eq(personalTodos.status, "completed"),
  )).returning({ id: personalTodos.id });
  if (!updated) throw new TodoRepositoryError("invalid_state");
}

export async function archiveTodo(database: DashboardDatabase, tenantId: string, ownerUserId: string, todoId: string) {
  requireIdentity(tenantId, ownerUserId);
  const now = new Date();
  const [updated] = await database.update(personalTodos).set({ status: "archived", completedAt: null, archivedAt: now, updatedAt: now }).where(and(
    eq(personalTodos.id, todoId),
    eq(personalTodos.tenantId, tenantId),
    eq(personalTodos.ownerUserId, ownerUserId),
    inArray(personalTodos.status, ["open", "completed"]),
  )).returning({ id: personalTodos.id });
  if (!updated) throw new TodoRepositoryError("invalid_state");
}

/** Every to-do this owner has, in their own private register. */
function ownedBy(tenantId: string, ownerUserId: string) {
  return and(eq(personalTodos.tenantId, tenantId), eq(personalTodos.ownerUserId, ownerUserId));
}

/**
 * A bulk change across the owner's own to-dos. Ids belonging to anyone else
 * simply do not match the owner predicate, so they are never loaded, never
 * planned, and never written.
 */
export async function applyBulkTodoChange(
  database: DashboardDatabase,
  tenantId: string,
  ownerUserId: string,
  todoIds: string[],
  action: TodoBulkAction,
): Promise<TodoBulkPlan> {
  requireIdentity(tenantId, ownerUserId);
  if (!todoIds.length) return { apply: [], skip: [] };
  return database.transaction(async (transaction) => {
    const current = await transaction.select({
      dueDate: personalTodos.dueDate,
      id: personalTodos.id,
      status: personalTodos.status,
    }).from(personalTodos).where(and(ownedBy(tenantId, ownerUserId), inArray(personalTodos.id, todoIds))).for("update");

    const plan = planBulkTodoChange(current, action);
    const now = new Date();
    for (const item of plan.apply) {
      const set = action.kind === "complete" ? { archivedAt: null, completedAt: now, status: "completed" as const }
        : action.kind === "reopen" ? { archivedAt: null, completedAt: null, status: "open" as const }
        : action.kind === "archive" ? { archivedAt: now, completedAt: null, status: "archived" as const }
        : action.kind === "reschedule" ? { dueDate: item.dueDate! }
        : action.kind === "priority" ? { priority: action.priority }
        : { category: action.category };
      await transaction.update(personalTodos).set({ ...set, updatedAt: now })
        .where(and(ownedBy(tenantId, ownerUserId), eq(personalTodos.id, item.id)));
    }
    return plan;
  });
}

/**
 * Renames a category across the owner's own to-dos. Merging is the same
 * operation with an existing name as the target, so it needs no separate path.
 */
export async function renameTodoCategory(
  database: DashboardDatabase,
  tenantId: string,
  ownerUserId: string,
  from: string,
  to: string,
) {
  requireIdentity(tenantId, ownerUserId);
  const source = from.trim();
  const target = to.trim().replace(/\s+/g, " ").slice(0, 40);
  if (!source) throw new TodoRepositoryError("not_found");
  const updated = await database.update(personalTodos).set({ category: target, updatedAt: new Date() })
    .where(and(ownedBy(tenantId, ownerUserId), eq(personalTodos.category, source)))
    .returning({ id: personalTodos.id });
  return updated.length;
}

/** Counts of the owner's own dated to-dos per day. Reads no other owner's rows. */
export async function getTodoLoadStrip(
  database: DashboardDatabase,
  tenantId: string,
  ownerUserId: string,
  todayKey: string,
  days = 28,
): Promise<LoadStripDay[]> {
  requireIdentity(tenantId, ownerUserId);
  const rows = await database.select({ dueDate: personalTodos.dueDate })
    .from(personalTodos)
    .where(and(ownedBy(tenantId, ownerUserId), eq(personalTodos.status, "open")))
    .orderBy(asc(personalTodos.dueDate));
  return buildLoadStrip(rows, todayKey, days);
}

const PRIORITY_ORDER: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

/**
 * The owner's own to-dos narrowed by the current view. Filtering happens here
 * rather than in the browser so a bookmarked URL reproduces the view instead of
 * re-narrowing whatever the page happened to load.
 */
export function filterTodoQueue(todos: TodoRow[], params: TodoQueueParams, todayKey: string): TodoRow[] {
  const needle = params.q.trim().toLowerCase();
  const matched = todos.filter((todo) => {
    const inView = params.view === "Completed" ? todo.status === "completed"
      : params.view === "Archived" ? todo.status === "archived"
      : todo.status !== "open" ? false
      : params.view === "Today" ? todo.dueDate === todayKey
      : params.view === "Upcoming" ? Boolean(todo.dueDate && todo.dueDate > todayKey)
      : params.view === "Overdue" ? Boolean(todo.dueDate && todo.dueDate < todayKey)
      : true;
    if (!inView) return false;
    if (params.priority !== "all" && todo.priority !== params.priority) return false;
    if (params.category !== "all" && todo.category !== params.category) return false;
    if (needle && !`${todo.title} ${todo.notes} ${todo.category}`.toLowerCase().includes(needle)) return false;
    return true;
  });

  return matched.sort((left, right) => {
    if (params.sort === "priority") {
      const byPriority = (PRIORITY_ORDER[left.priority] ?? 9) - (PRIORITY_ORDER[right.priority] ?? 9);
      if (byPriority) return byPriority;
    }
    if (params.sort === "updated") return right.updatedAt.localeCompare(left.updatedAt);
    // Undated items sort last within their group rather than jumping the queue.
    const leftDue = left.dueDate ?? "9999-12-31";
    const rightDue = right.dueDate ?? "9999-12-31";
    if (leftDue !== rightDue) return leftDue.localeCompare(rightDue);
    return (PRIORITY_ORDER[left.priority] ?? 9) - (PRIORITY_ORDER[right.priority] ?? 9);
  });
}
