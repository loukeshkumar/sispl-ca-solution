import { taskPriorities } from "./validation";

export type TaskScope = "mine" | "reviewing" | "assigned" | "firm";
export type TaskStatusFilter = "Active" | "Waiting" | "Review" | "Completed" | "Cancelled";
export type TaskPriorityFilter = "all" | typeof taskPriorities[number];
export type TaskView = "list" | "board" | "capacity";
export type TaskSort = "due" | "priority" | "assignee";

export type TaskQueueParams = {
  estimate: "over" | null;
  owner: string | null;
  priority: TaskPriorityFilter;
  q: string;
  scope: TaskScope;
  sort: TaskSort;
  status: TaskStatusFilter;
  view: TaskView;
};

const SCOPES: readonly TaskScope[] = ["mine", "reviewing", "assigned", "firm"];
const STATUSES: readonly TaskStatusFilter[] = ["Active", "Waiting", "Review", "Completed", "Cancelled"];
const PRIORITIES: readonly TaskPriorityFilter[] = ["all", ...taskPriorities];
const VIEWS: readonly TaskView[] = ["list", "board", "capacity"];
const SORTS: readonly TaskSort[] = ["due", "priority", "assignee"];
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const DEFAULT_TASK_QUEUE_PARAMS: TaskQueueParams = {
  estimate: null, owner: null, priority: "all", q: "", scope: "mine", sort: "due", status: "Active", view: "list",
};

/** Urgent first. An unknown value sorts last rather than ahead of a real one. */
export function priorityRank(priority: string) {
  const index = (taskPriorities as readonly string[]).indexOf(priority);
  return index < 0 ? taskPriorities.length : taskPriorities.length - 1 - index;
}

const SCOPE_LABELS: Array<{ key: TaskScope; label: string }> = [
  { key: "mine", label: "Assigned to me" },
  { key: "reviewing", label: "I review" },
  { key: "assigned", label: "Assigned by me" },
  { key: "firm", label: "Whole firm" },
];

/**
 * The access floor lets a viewer without task administration see only tasks
 * assigned to them, so every other scope would return an empty list forever.
 * Offering a tab that can never fill is worse than not offering it.
 */
export function availableTaskScopes(canManageAllTasks: boolean) {
  return canManageAllTasks ? SCOPE_LABELS : SCOPE_LABELS.filter((scope) => scope.key === "mine");
}

function first(raw: Record<string, string | string[] | undefined>, key: string) {
  const value = raw[key];
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

function oneOf<T extends string>(value: string, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

export function parseTaskQueueParams(raw: Record<string, string | string[] | undefined>): TaskQueueParams {
  const scope = oneOf(first(raw, "scope"), SCOPES, DEFAULT_TASK_QUEUE_PARAMS.scope);
  const owner = first(raw, "owner");
  return {
    estimate: first(raw, "estimate") === "over" ? "over" : null,
    // Under every scope but firm the owner is already fixed, so an owner value
    // is ignored rather than intersected into an empty result.
    owner: scope === "firm" && UUID_PATTERN.test(owner) ? owner : null,
    priority: oneOf(first(raw, "priority"), PRIORITIES, DEFAULT_TASK_QUEUE_PARAMS.priority),
    q: first(raw, "q").slice(0, 120),
    scope,
    sort: oneOf(first(raw, "sort"), SORTS, DEFAULT_TASK_QUEUE_PARAMS.sort),
    status: oneOf(first(raw, "status"), STATUSES, DEFAULT_TASK_QUEUE_PARAMS.status),
    view: oneOf(first(raw, "view"), VIEWS, DEFAULT_TASK_QUEUE_PARAMS.view),
  };
}

export function taskQueueHref(params: Partial<TaskQueueParams>): string {
  const search = new URLSearchParams({ workspace: "tasks" });
  const merged = { ...DEFAULT_TASK_QUEUE_PARAMS, ...params };
  for (const key of ["scope", "status", "priority", "sort", "view"] as const) {
    if (merged[key] !== DEFAULT_TASK_QUEUE_PARAMS[key]) search.set(key, merged[key]);
  }
  if (merged.q) search.set("q", merged.q);
  if (merged.owner && merged.scope === "firm") search.set("owner", merged.owner);
  if (merged.estimate) search.set("estimate", merged.estimate);
  return `/?${search.toString()}`;
}

export const TASK_QUEUE_PRESETS = [
  { key: "my-overdue", label: "My overdue", params: { scope: "mine", status: "Active" } },
  { key: "urgent", label: "Urgent", params: { priority: "urgent", scope: "firm" } },
  { key: "awaiting", label: "Awaiting something", params: { scope: "firm", status: "Waiting" } },
  { key: "my-reviews", label: "Ready for my review", params: { scope: "reviewing", status: "Review" } },
  { key: "over-estimate", label: "Over estimate", params: { estimate: "over", scope: "firm" } },
] as const satisfies ReadonlyArray<{ key: string; label: string; params: Partial<TaskQueueParams> }>;
