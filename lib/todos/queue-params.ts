import { todoPriorities } from "./validation";

export type TodoView = "Today" | "Upcoming" | "Overdue" | "Completed" | "Archived" | "All open";
export type TodoPriorityFilter = "all" | typeof todoPriorities[number];
export type TodoSort = "due" | "priority" | "updated";
export type TodoLayout = "list" | "load";

export type TodoQueueParams = {
  category: string;
  layout: TodoLayout;
  priority: TodoPriorityFilter;
  q: string;
  sort: TodoSort;
  view: TodoView;
};

export const todoViews: readonly TodoView[] = ["All open", "Today", "Upcoming", "Overdue", "Completed", "Archived"];
const PRIORITIES: readonly TodoPriorityFilter[] = ["all", ...todoPriorities];
const SORTS: readonly TodoSort[] = ["due", "priority", "updated"];
const LAYOUTS: readonly TodoLayout[] = ["list", "load"];

/**
 * Fixed, not derived from what happens to be due. The previous default flipped
 * between Today and All open depending on the data, so the same click landed on
 * a different page from one day to the next.
 */
export const DEFAULT_TODO_QUEUE_PARAMS: TodoQueueParams = {
  category: "all", layout: "list", priority: "all", q: "", sort: "due", view: "All open",
};

export const TODO_URGENCY = [
  { key: "overdue", label: "Overdue", note: "Past the date you set" },
  { key: "today", label: "Due today", note: "Close these first" },
  { key: "week", label: "Due this week", note: "Within seven days" },
  { key: "later", label: "Later", note: "Beyond this week" },
  { key: "undated", label: "No date", note: "Nothing scheduled yet" },
] as const;

export type TodoUrgencyKey = typeof TODO_URGENCY[number]["key"];

/**
 * Due dates are nullable here, unlike work items and tasks. Undated items get
 * their own bucket instead of sorting under a synthetic far-future date, where
 * they drop out of view entirely.
 */
export function todoUrgencyKey(dueDate: string | null, todayKey: string): TodoUrgencyKey {
  if (!dueDate) return "undated";
  const days = Math.round((Date.parse(`${dueDate}T00:00:00Z`) - Date.parse(`${todayKey}T00:00:00Z`)) / 86_400_000);
  if (days < 0) return "overdue";
  if (days === 0) return "today";
  if (days <= 7) return "week";
  return "later";
}

function first(raw: Record<string, string | string[] | undefined>, key: string) {
  const value = raw[key];
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

function oneOf<T extends string>(value: string, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

export function parseTodoQueueParams(raw: Record<string, string | string[] | undefined>): TodoQueueParams {
  const category = first(raw, "category").slice(0, 40);
  return {
    category: category || "all",
    layout: oneOf(first(raw, "layout"), LAYOUTS, DEFAULT_TODO_QUEUE_PARAMS.layout),
    priority: oneOf(first(raw, "priority"), PRIORITIES, DEFAULT_TODO_QUEUE_PARAMS.priority),
    q: first(raw, "q").slice(0, 120),
    sort: oneOf(first(raw, "sort"), SORTS, DEFAULT_TODO_QUEUE_PARAMS.sort),
    view: oneOf(first(raw, "view"), todoViews, DEFAULT_TODO_QUEUE_PARAMS.view),
  };
}

export function todoQueueHref(params: Partial<TodoQueueParams>): string {
  const search = new URLSearchParams({ workspace: "todos" });
  const merged = { ...DEFAULT_TODO_QUEUE_PARAMS, ...params };
  for (const key of ["view", "priority", "sort", "layout", "category"] as const) {
    if (merged[key] !== DEFAULT_TODO_QUEUE_PARAMS[key]) search.set(key, merged[key]);
  }
  if (merged.q) search.set("q", merged.q);
  return `/?${search.toString()}`;
}
