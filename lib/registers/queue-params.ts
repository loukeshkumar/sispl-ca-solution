export type RegisterTab = "attention" | "notices" | "dsc" | "udin" | "insights";
export type RegisterLayout = "list" | "client";
export type RegisterSort = "due" | "client" | "recent";

/**
 * Every lens the page offers lives in the URL, so a view can be bookmarked,
 * shared with the colleague who has to act on it, and reloaded after a server
 * action without losing where the reader was.
 */
export type RegisterParams = {
  authority: string;
  band: string;
  client: string;
  focus: string;
  layout: RegisterLayout;
  owner: string;
  page: number;
  q: string;
  sort: RegisterSort;
  status: string;
  tab: RegisterTab;
};

export const REGISTER_TABS: Array<{ key: RegisterTab; label: string }> = [
  { key: "attention", label: "Needs action" },
  { key: "notices", label: "Notices" },
  { key: "dsc", label: "DSC custody" },
  { key: "udin", label: "UDIN" },
  { key: "insights", label: "Insights" },
];

const TABS: readonly RegisterTab[] = ["attention", "notices", "dsc", "udin", "insights"];
const LAYOUTS: readonly RegisterLayout[] = ["list", "client"];
const SORTS: readonly RegisterSort[] = ["due", "client", "recent"];

/** One screen of rows. Large enough to scan, small enough to stay responsive. */
export const REGISTER_PAGE_SIZE = 25;

/** Each register has its own vocabulary, so a status is only valid for its tab. */
export const STATUSES_BY_TAB: Record<RegisterTab, readonly string[]> = {
  attention: [],
  notices: ["open", "in_progress", "responded", "closed"],
  dsc: ["in_custody", "issued_out", "expired", "surrendered"],
  udin: ["active", "revoked"],
  insights: [],
};

/**
 * Urgency bands differ by register because the underlying clock differs: a
 * notice runs to a response deadline, a certificate runs to its validity.
 */
export const BANDS_BY_TAB: Record<RegisterTab, ReadonlyArray<{ key: string; label: string }>> = {
  attention: [],
  notices: [
    { key: "overdue", label: "Overdue" },
    { key: "today", label: "Due today" },
    { key: "week", label: "This week" },
    { key: "later", label: "Later" },
  ],
  dsc: [
    { key: "expired", label: "Past validity" },
    { key: "imminent", label: "Within 7 days" },
    { key: "soon", label: "Within 30 days" },
    { key: "later", label: "Later" },
  ],
  udin: [],
  insights: [],
};

/** Only the notice register carries an issuing authority. */
export const AUTHORITY_FILTERS = ["income_tax", "gst", "tds", "roc", "other"] as const;

/** Sorting is offered where rows have a shared clock to sort against. */
export const SORTABLE_TABS: readonly RegisterTab[] = ["notices", "dsc", "udin"];

/** Grouping by client is only meaningful for the two chase-style registers. */
export const CLIENT_LENS_TABS: readonly RegisterTab[] = ["notices", "dsc"];

/** The action queue answers the page's real question, so it opens there. */
export const DEFAULT_REGISTER_PARAMS: RegisterParams = {
  authority: "all",
  band: "all",
  client: "all",
  focus: "",
  layout: "list",
  owner: "all",
  page: 1,
  q: "",
  sort: "due",
  status: "all",
  tab: "attention",
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function first(raw: Record<string, string | string[] | undefined>, key: string) {
  const value = raw[key];
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

/** An id-shaped filter is either a real id, the "unassigned" sentinel, or absent. */
function idFilter(value: string, sentinel?: string) {
  if (sentinel && value === sentinel) return value;
  return UUID_PATTERN.test(value) ? value : "all";
}

export function parseRegisterParams(raw: Record<string, string | string[] | undefined>): RegisterParams {
  const rawTab = first(raw, "tab");
  const tab = TABS.includes(rawTab as RegisterTab) ? (rawTab as RegisterTab) : DEFAULT_REGISTER_PARAMS.tab;
  const status = first(raw, "status");
  const band = first(raw, "band");
  const authority = first(raw, "authority");
  const layout = first(raw, "layout");
  const sort = first(raw, "sort");
  const page = Number.parseInt(first(raw, "page"), 10);
  return {
    // Authority only narrows the notice register; carrying it elsewhere would
    // silently filter a register that has no such column.
    authority: tab === "notices" && (AUTHORITY_FILTERS as readonly string[]).includes(authority) ? authority : "all",
    band: BANDS_BY_TAB[tab].some((entry) => entry.key === band) ? band : "all",
    client: idFilter(first(raw, "client")),
    focus: idFilter(first(raw, "focus")) === "all" ? "" : first(raw, "focus"),
    layout: CLIENT_LENS_TABS.includes(tab) && LAYOUTS.includes(layout as RegisterLayout)
      ? (layout as RegisterLayout)
      : DEFAULT_REGISTER_PARAMS.layout,
    owner: tab === "notices" || tab === "dsc" ? idFilter(first(raw, "owner"), "unassigned") : "all",
    page: Number.isFinite(page) && page > 1 ? Math.min(page, 400) : 1,
    q: first(raw, "q").slice(0, 120),
    sort: SORTABLE_TABS.includes(tab) && SORTS.includes(sort as RegisterSort) ? (sort as RegisterSort) : DEFAULT_REGISTER_PARAMS.sort,
    status: STATUSES_BY_TAB[tab].includes(status) ? status : "all",
    tab,
  };
}

export function registerHref(params: Partial<RegisterParams>): string {
  const search = new URLSearchParams({ workspace: "registers" });
  const merged = { ...DEFAULT_REGISTER_PARAMS, ...params };
  if (merged.tab !== DEFAULT_REGISTER_PARAMS.tab) search.set("tab", merged.tab);
  if (merged.status !== "all") search.set("status", merged.status);
  if (merged.band !== "all") search.set("band", merged.band);
  if (merged.client !== "all") search.set("client", merged.client);
  if (merged.owner !== "all") search.set("owner", merged.owner);
  if (merged.authority !== "all") search.set("authority", merged.authority);
  if (merged.layout !== DEFAULT_REGISTER_PARAMS.layout) search.set("layout", merged.layout);
  if (merged.sort !== DEFAULT_REGISTER_PARAMS.sort) search.set("sort", merged.sort);
  if (merged.q) search.set("q", merged.q);
  if (merged.page > 1) search.set("page", String(merged.page));
  if (merged.focus) search.set("focus", merged.focus);
  return `/?${search.toString()}`;
}

/**
 * Changing what is being looked at invalidates where the reader was in the
 * list, so every filter link resets the page and closes any open detail.
 */
export function registerFilterHref(params: RegisterParams, change: Partial<RegisterParams>): string {
  return registerHref({ ...params, focus: "", page: 1, ...change });
}

/** True when anything beyond the tab itself is narrowing the register. */
export function hasActiveRegisterFilters(params: RegisterParams): boolean {
  return params.status !== "all" || params.band !== "all" || params.client !== "all"
    || params.owner !== "all" || params.authority !== "all" || params.q !== "";
}
