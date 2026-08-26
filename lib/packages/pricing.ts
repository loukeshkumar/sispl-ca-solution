/**
 * What a fixed-fee package implies, beside what it charges.
 *
 * A package was a name and a number. Nothing connected the fee to the work it
 * committed the firm to: the services were listed, the calendar knew how often
 * each fell due, the catalogue held a standard time for each, and rates existed
 * for everybody — and none of it met the price. A retainer was set by feel,
 * renewed by habit, and its margin discovered, if ever, at year end.
 *
 * Two different questions are asked here and answered separately, because one
 * number cannot say both:
 *
 *   margin       fee against what delivery cost      — does it make money
 *   realisation  fee against what the time was worth — how much is given away
 *
 * A package can be comfortably profitable and heavily discounted at once.
 */

export type Frequency = "monthly" | "quarterly" | "annual";

export type BillingCycle = "monthly" | "quarterly" | "annual" | "one_time";

/** How many times a year each cadence comes round. */
export const OCCURRENCES_A_YEAR: Record<Frequency, number> = {
  annual: 1,
  monthly: 12,
  quarterly: 4,
};

/**
 * How many times a year a fee at this cycle is charged.
 *
 * A one-time fee is counted once, which makes an annual comparison of a
 * one-time package meaningful only in its first year — and the screen says so
 * rather than quietly annualising something that never recurs.
 */
export const CHARGES_A_YEAR: Record<BillingCycle, number> = {
  annual: 1,
  monthly: 12,
  one_time: 1,
  quarterly: 4,
};

export type PackageService = {
  /** Null where the firm has not set a standard time for this service. */
  standardMinutes: number | null;
  /** Null where no schedule governs it, so nothing says how often it recurs. */
  frequency: Frequency | null;
  serviceCode: string;
  serviceName: string;
};

export type ServiceEffort = PackageService & {
  minutesAYear: number;
  occurrences: number;
  /** True where the estimate rests on nothing the firm has actually recorded. */
  assumed: boolean;
};

export type ExpectedEffort = {
  /** Services the firm has no standard time or no schedule for. */
  assumedServices: string[];
  minutesAYear: number;
  services: ServiceEffort[];
};

/**
 * The effort a package commits the firm to in a year.
 *
 * A service with no standard time contributes nothing and is named, rather than
 * being guessed at: an estimate built partly on invention reads exactly like one
 * built on record, and the firm would price against it either way.
 */
export function expectedEffort(services: readonly PackageService[]): ExpectedEffort {
  const detailed = services.map((service) => {
    const occurrences = service.frequency ? OCCURRENCES_A_YEAR[service.frequency] : 0;
    const assumed = service.standardMinutes === null || service.frequency === null;
    return {
      ...service,
      assumed,
      minutesAYear: assumed ? 0 : occurrences * service.standardMinutes!,
      occurrences,
    };
  });
  return {
    assumedServices: detailed.filter((service) => service.assumed).map((service) => service.serviceCode),
    minutesAYear: detailed.reduce((total, service) => total + service.minutesAYear, 0),
    services: detailed,
  };
}

export const minutesToPaise = (minutes: number, paisePerHour: number) =>
  Math.round((minutes * paisePerHour) / 60);

export type Margin = {
  costPaise: number;
  marginPaise: number;
  /** Null where nothing was charged, so no percentage is meaningful. */
  percent: number | null;
  revenuePaise: number;
};

export function marginOf(input: { costPaise: number; revenuePaise: number }): Margin {
  const marginPaise = input.revenuePaise - input.costPaise;
  return {
    costPaise: input.costPaise,
    marginPaise,
    percent: input.revenuePaise > 0 ? Math.round((marginPaise / input.revenuePaise) * 100) : null,
    revenuePaise: input.revenuePaise,
  };
}

export type MarginBand = "loss" | "thin" | "healthy" | "strong" | "unknown";

export const BAND_LABELS: Record<MarginBand, string> = {
  healthy: "Healthy",
  loss: "Under water",
  strong: "Strong",
  thin: "Thin",
  unknown: "Not measurable",
};

/**
 * How a margin reads at a glance.
 *
 * `loss` is separated from `thin` because they call for different conversations:
 * a thin margin is a pricing discussion at renewal, and a negative one is a
 * conversation this week.
 */
export function marginBand(margin: Margin): MarginBand {
  if (margin.percent === null) return "unknown";
  if (margin.percent < 0) return "loss";
  if (margin.percent < 20) return "thin";
  if (margin.percent < 50) return "healthy";
  return "strong";
}

export type PackagePricing = {
  /** Fee over a year, whatever cycle it is charged on. */
  annualFeePaise: number;
  expected: ExpectedEffort;
  expectedMargin: Margin;
  /** True where the estimate leans on services the firm has not standardised. */
  incomplete: boolean;
};

/** What the package is worth against what the firm's own standards say it costs. */
export function priceAtDesign(input: {
  billingCycle: BillingCycle;
  costPaisePerHour: number;
  feePaise: number;
  services: readonly PackageService[];
}): PackagePricing {
  const expected = expectedEffort(input.services);
  const annualFeePaise = input.feePaise * CHARGES_A_YEAR[input.billingCycle];
  return {
    annualFeePaise,
    expected,
    expectedMargin: marginOf({
      costPaise: minutesToPaise(expected.minutesAYear, input.costPaisePerHour),
      revenuePaise: annualFeePaise,
    }),
    incomplete: expected.assumedServices.length > 0,
  };
}

export type ActualDelivery = {
  chargeValuePaise: number;
  costPaise: number;
  minutes: number;
};

export type AssignmentStanding = {
  actual: ActualDelivery;
  /** Fee against what delivery cost. Does this package make money. */
  margin: Margin;
  /** Fee against what the time was worth. How much is being given away. */
  realisedPercent: number | null;
  /** Actual minutes against the expected, or null where nothing was expected. */
  effortOverrunPercent: number | null;
  expectedMinutes: number;
  feePaise: number;
};

/**
 * How one client's package has actually gone.
 *
 * Realisation is deliberately not folded into margin. A package delivered at
 * 38% margin and 61% realisation is profitable and heavily discounted at the
 * same time, and a firm that sees only the first will keep renewing it.
 */
export function standingOf(input: {
  actual: ActualDelivery;
  expectedMinutes: number;
  feePaise: number;
}): AssignmentStanding {
  return {
    actual: input.actual,
    effortOverrunPercent: input.expectedMinutes > 0
      ? Math.round(((input.actual.minutes - input.expectedMinutes) / input.expectedMinutes) * 100)
      : null,
    expectedMinutes: input.expectedMinutes,
    feePaise: input.feePaise,
    margin: marginOf({ costPaise: input.actual.costPaise, revenuePaise: input.feePaise }),
    realisedPercent: input.actual.chargeValuePaise > 0
      ? Math.round((input.feePaise / input.actual.chargeValuePaise) * 100)
      : null,
  };
}

const rupees = (paise: number) => `₹${(Math.abs(paise) / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
const hours = (minutes: number) => `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;

/** `104 hours a year · ₹46,800 at cost · ₹53,200 margin (53%)`. */
export function pricingSummary(pricing: PackagePricing): string {
  const base = `${hours(pricing.expected.minutesAYear)} a year · ${rupees(pricing.expectedMargin.costPaise)} at cost`;
  const margin = pricing.expectedMargin.percent === null
    ? "nothing charged"
    : `${rupees(pricing.expectedMargin.marginPaise)} ${pricing.expectedMargin.marginPaise < 0 ? "short" : "margin"} (${pricing.expectedMargin.percent}%)`;
  const caveat = pricing.incomplete
    ? ` · ${pricing.expected.assumedServices.length} service${pricing.expected.assumedServices.length === 1 ? "" : "s"} without a standard`
    : "";
  return `${base} · ${margin}${caveat}`;
}

/** `137:30 delivered · 38% margin · 61% realised · 32% over the estimate`. */
export function standingSummary(standing: AssignmentStanding): string {
  const parts = [`${hours(standing.actual.minutes)} delivered`];
  if (standing.margin.percent !== null) parts.push(`${standing.margin.percent}% margin`);
  if (standing.realisedPercent !== null) parts.push(`${standing.realisedPercent}% realised`);
  if (standing.effortOverrunPercent !== null && standing.effortOverrunPercent !== 0) {
    parts.push(`${Math.abs(standing.effortOverrunPercent)}% ${standing.effortOverrunPercent > 0 ? "over" : "under"} the estimate`);
  }
  return parts.join(" · ");
}

export type PricingRefusal = "no_services" | "no_cost_rate" | "negative_fee";

export const PRICING_REFUSAL_NOTES: Record<PricingRefusal, string> = {
  negative_fee: "A fee cannot be less than nothing.",
  no_cost_rate: "No cost rate is recorded, so what this package costs to deliver cannot be worked out.",
  no_services: "A package with no services in it commits the firm to nothing, and cannot be priced.",
};

export function refusePricing(input: {
  costPaisePerHour: number | null;
  feePaise: number;
  serviceCount: number;
}): PricingRefusal | null {
  if (input.serviceCount === 0) return "no_services";
  if (input.feePaise < 0) return "negative_fee";
  if (input.costPaisePerHour === null || input.costPaisePerHour <= 0) return "no_cost_rate";
  return null;
}
