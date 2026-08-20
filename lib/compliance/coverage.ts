export type EntitlementWindow = {
  effectiveFrom: string;
  effectiveTo: string | null;
  legalEntityId: string;
  serviceCode: string;
};

/**
 * Whether a client was engaged for a service on a given date.
 *
 * Coverage asks this per period rather than once for today. Applying today's
 * entitlements to past periods would report months of missed filings against a
 * client who was only engaged last week, and a compliance page that cries wolf
 * gets ignored — including when the gap is real.
 */
export function isEntitledAt(window: EntitlementWindow, dateKey: string) {
  if (dateKey < window.effectiveFrom) return false;
  return window.effectiveTo === null || dateKey <= window.effectiveTo;
}

export type ExpectedObligation = {
  internalDueDate: string;
  legalEntityId: string;
  periodKey: string;
  serviceKey: string;
  statutoryDueDate: string;
};

export type RaisedObligation = { legalEntityId: string; periodKey: string; serviceKey: string };

/**
 * The composite key the database itself uses for uniqueness
 * (tenant, entity, service, period). Service keys are compared case-insensitively
 * because seeded work carries keys like `gstr_3b` while generated work carries
 * `GST`; a case-sensitive match would report every seeded obligation as missing.
 */
const coverageKey = (item: RaisedObligation) => `${item.legalEntityId}::${item.serviceKey.toUpperCase()}::${item.periodKey}`;

/** Expected obligations with no work item raised against them. */
export function diffCoverage(expected: ExpectedObligation[], raised: RaisedObligation[]): ExpectedObligation[] {
  const seen = new Set(raised.map(coverageKey));
  return expected.filter((obligation) => !seen.has(coverageKey(obligation)));
}
