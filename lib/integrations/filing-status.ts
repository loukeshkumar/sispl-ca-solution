/**
 * Seam for automated filing-status retrieval.
 *
 * Recording acknowledgements by hand works today and is the system of record.
 * Automated retrieval needs credentials SISPL does not ship with: GSTN access is
 * granted through a licensed GSP, and income-tax status needs ERI credentials.
 * Until one is configured the resolver reports `unavailable` — it never invents a
 * status, because a fabricated acknowledgement is worse than none.
 */

export type FilingPortal = "gstn" | "income_tax" | "traces" | "mca" | "other";

export type FilingStatusQuery = {
  portal: FilingPortal;
  registrationKey: string;
  filingType: string;
  periodKey: string;
};

export type FilingStatusResult =
  | { ok: true; acknowledgementNumber: string; filedOn: string; portalStatus: "filed" | "filed_late" | "processed" | "defective" | "rejected" }
  | { ok: false; reason: "unavailable" | "not_found" | "provider_error" };

export type FilingStatusProvider = {
  portal: FilingPortal;
  fetchStatus: (query: FilingStatusQuery) => Promise<FilingStatusResult>;
};

export type FilingStatusConfiguration = { providers: FilingStatusProvider[] };

const emptyConfiguration: FilingStatusConfiguration = { providers: [] };

let configuration: FilingStatusConfiguration = emptyConfiguration;

/** Registers real portal clients once credentials exist. Tests use this too. */
export function configureFilingStatusProviders(next: FilingStatusConfiguration) {
  configuration = next;
}

export function resetFilingStatusProviders() {
  configuration = emptyConfiguration;
}

export function isFilingStatusAutomated(portal: FilingPortal) {
  return configuration.providers.some((provider) => provider.portal === portal);
}

export async function fetchFilingStatus(query: FilingStatusQuery): Promise<FilingStatusResult> {
  const provider = configuration.providers.find((candidate) => candidate.portal === query.portal);
  if (!provider) return { ok: false, reason: "unavailable" };
  try {
    return await provider.fetchStatus(query);
  } catch {
    return { ok: false, reason: "provider_error" };
  }
}
