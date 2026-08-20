export type ComplianceView = "register" | "matrix" | "gaps";
export type ComplianceStatusFilter = "All" | "Overdue" | "Due this week" | "Critical" | "At risk" | "Waiting" | "Review";
export type EvidenceFilter = "all" | "missing";

export type ComplianceParams = {
  evidence: EvidenceFilter;
  service: string | null;
  status: ComplianceStatusFilter;
  view: ComplianceView;
};

const VIEWS: readonly ComplianceView[] = ["register", "matrix", "gaps"];
const STATUSES: readonly ComplianceStatusFilter[] = ["All", "Overdue", "Due this week", "Critical", "At risk", "Waiting", "Review"];
const SERVICE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{1,59}$/;

export const DEFAULT_COMPLIANCE_PARAMS: ComplianceParams = {
  evidence: "all", service: null, status: "All", view: "register",
};

function first(raw: Record<string, string | string[] | undefined>, key: string) {
  const value = raw[key];
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

function oneOf<T extends string>(value: string, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

export function parseComplianceParams(raw: Record<string, string | string[] | undefined>): ComplianceParams {
  const service = first(raw, "service");
  return {
    evidence: first(raw, "evidence") === "missing" ? "missing" : "all",
    service: SERVICE_PATTERN.test(service) ? service.toUpperCase() : null,
    status: oneOf(first(raw, "status"), STATUSES, DEFAULT_COMPLIANCE_PARAMS.status),
    view: oneOf(first(raw, "view"), VIEWS, DEFAULT_COMPLIANCE_PARAMS.view),
  };
}

export function complianceHref(params: Partial<ComplianceParams>): string {
  const search = new URLSearchParams({ workspace: "compliance" });
  const merged = { ...DEFAULT_COMPLIANCE_PARAMS, ...params };
  for (const key of ["view", "status", "evidence"] as const) {
    if (merged[key] !== DEFAULT_COMPLIANCE_PARAMS[key]) search.set(key, merged[key]);
  }
  if (merged.service) search.set("service", merged.service);
  return `/?${search.toString()}`;
}

export const COMPLIANCE_PRESETS = [
  { key: "overdue", label: "Overdue", params: { status: "Overdue" } },
  { key: "review", label: "Ready for review", params: { status: "Review" } },
  { key: "no-evidence", label: "Filed without evidence", params: { evidence: "missing" } },
  { key: "gaps", label: "Not raised", params: { view: "gaps" } },
] as const satisfies ReadonlyArray<{ key: string; label: string; params: Partial<ComplianceParams> }>;
