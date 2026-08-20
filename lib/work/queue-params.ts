import type { WorkFilter } from "../dashboard/filters";

export type WorkScope = "mine" | "reviewing" | "firm";
export type WorkView = "list" | "board" | "capacity";
export type WorkSort = "due" | "progress" | "client";

export type WorkQueueParams = {
  budget: "over" | null;
  filter: WorkFilter;
  /** A member UUID, or the literal "unassigned" to select work with no assignee. */
  owner: string | null;
  q: string;
  scope: WorkScope;
  service: string | null;
  sort: WorkSort;
  view: WorkView;
};

const SCOPES: readonly WorkScope[] = ["mine", "reviewing", "firm"];
const VIEWS: readonly WorkView[] = ["list", "board", "capacity"];
const SORTS: readonly WorkSort[] = ["due", "progress", "client"];
const FILTERS: readonly WorkFilter[] = ["All", "Overdue", "Due this week", "Critical", "At risk", "Waiting", "Review"];
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SERVICE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{1,59}$/;

export const UNASSIGNED_OWNER = "unassigned";

export const DEFAULT_WORK_QUEUE_PARAMS: WorkQueueParams = {
  budget: null, filter: "All", owner: null, q: "", scope: "mine", service: null, sort: "due", view: "list",
};

/** Repeated query parameters take the first value; a malformed value is not an error, it is a default. */
function first(raw: Record<string, string | string[] | undefined>, key: string) {
  const value = raw[key];
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

function oneOf<T extends string>(value: string, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

export function parseWorkQueueParams(raw: Record<string, string | string[] | undefined>): WorkQueueParams {
  const scope = oneOf(first(raw, "scope"), SCOPES, DEFAULT_WORK_QUEUE_PARAMS.scope);
  const owner = first(raw, "owner");
  const service = first(raw, "service");
  return {
    budget: first(raw, "budget") === "over" ? "over" : null,
    filter: oneOf(first(raw, "filter"), FILTERS, DEFAULT_WORK_QUEUE_PARAMS.filter),
    // Under mine/reviewing the owner is already the viewer, so an owner value is
    // ignored rather than intersected — a pasted link cannot silently return nothing.
    owner: scope === "firm" && (owner === UNASSIGNED_OWNER || UUID_PATTERN.test(owner)) ? owner : null,
    q: first(raw, "q").slice(0, 120),
    scope,
    service: SERVICE_PATTERN.test(service) ? service : null,
    sort: oneOf(first(raw, "sort"), SORTS, DEFAULT_WORK_QUEUE_PARAMS.sort),
    view: oneOf(first(raw, "view"), VIEWS, DEFAULT_WORK_QUEUE_PARAMS.view),
  };
}

/**
 * Defaults are omitted so a shared link stays readable, and parsing restores
 * them. Every view of this workspace is addressable, which is what makes
 * "paste the link when handing work over" work at all.
 */
export function workQueueHref(params: Partial<WorkQueueParams>): string {
  const search = new URLSearchParams({ workspace: "work" });
  const merged = { ...DEFAULT_WORK_QUEUE_PARAMS, ...params };
  for (const key of ["scope", "filter", "sort", "view"] as const) {
    if (merged[key] !== DEFAULT_WORK_QUEUE_PARAMS[key]) search.set(key, merged[key]);
  }
  if (merged.q) search.set("q", merged.q);
  if (merged.owner && merged.scope === "firm") search.set("owner", merged.owner);
  if (merged.service) search.set("service", merged.service);
  if (merged.budget) search.set("budget", merged.budget);
  return `/?${search.toString()}`;
}

export const WORK_QUEUE_PRESETS = [
  { key: "my-overdue", label: "My overdue", params: { filter: "Overdue", scope: "mine" } },
  { key: "awaiting-client", label: "Awaiting client", params: { filter: "Waiting", scope: "firm" } },
  { key: "my-reviews", label: "Ready for my review", params: { filter: "Review", scope: "reviewing" } },
  { key: "over-budget", label: "Over budget", params: { budget: "over", scope: "firm" } },
  { key: "unassigned", label: "Unassigned", params: { owner: UNASSIGNED_OWNER, scope: "firm" } },
] as const satisfies ReadonlyArray<{ key: string; label: string; params: Partial<WorkQueueParams> }>;
