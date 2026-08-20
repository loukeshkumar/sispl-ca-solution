export type RegisterTab = "attention" | "notices" | "dsc" | "udin";

export type RegisterParams = {
  q: string;
  status: string;
  tab: RegisterTab;
};

export const REGISTER_TABS: Array<{ key: RegisterTab; label: string }> = [
  { key: "attention", label: "Needs action" },
  { key: "notices", label: "Notices" },
  { key: "dsc", label: "DSC custody" },
  { key: "udin", label: "UDIN" },
];

const TABS: readonly RegisterTab[] = ["attention", "notices", "dsc", "udin"];

/** Each register has its own vocabulary, so a status is only valid for its tab. */
export const STATUSES_BY_TAB: Record<RegisterTab, readonly string[]> = {
  attention: [],
  notices: ["open", "in_progress", "responded", "closed"],
  dsc: ["in_custody", "issued_out", "expired", "surrendered"],
  udin: ["active", "revoked"],
};

/** The action queue answers the page's real question, so it opens there. */
export const DEFAULT_REGISTER_PARAMS: RegisterParams = { q: "", status: "all", tab: "attention" };

function first(raw: Record<string, string | string[] | undefined>, key: string) {
  const value = raw[key];
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

export function parseRegisterParams(raw: Record<string, string | string[] | undefined>): RegisterParams {
  const rawTab = first(raw, "tab");
  const tab = TABS.includes(rawTab as RegisterTab) ? (rawTab as RegisterTab) : DEFAULT_REGISTER_PARAMS.tab;
  const status = first(raw, "status");
  return {
    q: first(raw, "q").slice(0, 120),
    status: STATUSES_BY_TAB[tab].includes(status) ? status : "all",
    tab,
  };
}

export function registerHref(params: Partial<RegisterParams>): string {
  const search = new URLSearchParams({ workspace: "registers" });
  const merged = { ...DEFAULT_REGISTER_PARAMS, ...params };
  if (merged.tab !== DEFAULT_REGISTER_PARAMS.tab) search.set("tab", merged.tab);
  if (merged.status !== "all") search.set("status", merged.status);
  if (merged.q) search.set("q", merged.q);
  return `/?${search.toString()}`;
}
