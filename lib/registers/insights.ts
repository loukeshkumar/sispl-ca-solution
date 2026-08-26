const DAY_MS = 86_400_000;

const dayDifference = (dateKey: string, todayKey: string) => Math.round(
  (Date.parse(`${dateKey}T00:00:00Z`) - Date.parse(`${todayKey}T00:00:00Z`)) / DAY_MS,
);

/** Whole months back from a date key, as an ordered list of `YYYY-MM` keys. */
function monthKeys(todayKey: string, count: number): string[] {
  const [year, month] = todayKey.split("-").map(Number);
  const keys: string[] = [];
  for (let offset = count - 1; offset >= 0; offset -= 1) {
    const date = new Date(Date.UTC(year!, (month! - 1) - offset, 1));
    keys.push(`${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return keys;
}

const monthLabel = (key: string) => new Intl.DateTimeFormat("en-IN", { month: "short", timeZone: "UTC", year: "2-digit" })
  .format(new Date(`${key}-01T00:00:00Z`));

/** The middle value, which survives one pathological case in a way a mean does not. */
export function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]!
    : Math.round(((sorted[middle - 1]! + sorted[middle]!) / 2) * 10) / 10;
}

export type TurnaroundNotice = {
  authority: string;
  receivedDate: string;
  respondedOn: string | null;
  status: string;
};

export type TurnaroundStats = {
  buckets: Array<{ count: number; label: string }>;
  fastest: number | null;
  medianDays: number | null;
  sample: number;
  slowest: number | null;
};

const TURNAROUND_BUCKETS: Array<{ label: string; test: (days: number) => boolean }> = [
  { label: "≤ 7d", test: (days) => days <= 7 },
  { label: "8–15d", test: (days) => days > 7 && days <= 15 },
  { label: "16–30d", test: (days) => days > 15 && days <= 30 },
  { label: "31–60d", test: (days) => days > 30 && days <= 60 },
  { label: "60d+", test: (days) => days > 60 },
];

/**
 * How long the firm actually takes to answer a notice, measured from the day it
 * was received to the day it was answered. Only answered notices count: an open
 * one has no turnaround yet, and folding it in would flatter the number.
 */
export function buildNoticeTurnaround(notices: TurnaroundNotice[]): TurnaroundStats {
  const durations: number[] = [];
  for (const notice of notices) {
    if (!notice.respondedOn) continue;
    const days = dayDifference(notice.respondedOn, notice.receivedDate);
    // A response recorded before the notice arrived is a data error, not a
    // negative turnaround; counting it would drag the median below zero.
    if (days < 0) continue;
    durations.push(days);
  }
  return {
    buckets: TURNAROUND_BUCKETS.map((bucket) => ({
      count: durations.filter((days) => bucket.test(days)).length,
      label: bucket.label,
    })),
    fastest: durations.length ? Math.min(...durations) : null,
    medianDays: median(durations),
    sample: durations.length,
    slowest: durations.length ? Math.max(...durations) : null,
  };
}

export type RunwayCertificate = { status: string; validUntil: string };

const RUNWAY_WINDOWS: Array<{ key: string; label: string; upper: number }> = [
  { key: "expired", label: "Lapsed", upper: -1 },
  { key: "d30", label: "0–30d", upper: 30 },
  { key: "d60", label: "31–60d", upper: 60 },
  { key: "d90", label: "61–90d", upper: 90 },
  { key: "d180", label: "91–180d", upper: 180 },
  { key: "beyond", label: "180d+", upper: Number.POSITIVE_INFINITY },
];

/**
 * When the firm's signing capability runs out. Renewals are procurement, not a
 * same-day task, so the useful question is how much of the estate falls due in
 * each quarter — not just what expires this month.
 */
export function buildExpiryRunway(certificates: RunwayCertificate[], todayKey: string) {
  const live = certificates.filter((certificate) => ["in_custody", "issued_out"].includes(certificate.status));
  return RUNWAY_WINDOWS.map((window, index) => {
    const lower = index === 0 ? Number.NEGATIVE_INFINITY : RUNWAY_WINDOWS[index - 1]!.upper;
    return {
      count: live.filter((certificate) => {
        const days = dayDifference(certificate.validUntil, todayKey);
        return days > lower && days <= window.upper;
      }).length,
      key: window.key,
      label: window.label,
    };
  });
}

export type SignerUdin = { generatedOn: string; signedByName: string; status: string };

/**
 * UDIN volume by month. ICAI scrutiny is about the pattern of signing over
 * time, so the trend matters more than any single month's figure.
 */
export function buildUdinTrend(udins: SignerUdin[], todayKey: string, months = 6) {
  const keys = monthKeys(todayKey, months);
  return keys.map((key) => {
    const inMonth = udins.filter((entry) => entry.generatedOn.slice(0, 7) === key);
    return {
      active: inMonth.filter((entry) => entry.status === "active").length,
      label: monthLabel(key),
      month: key,
      revoked: inMonth.filter((entry) => entry.status === "revoked").length,
    };
  });
}

/**
 * Who is signing, and how much of it was withdrawn. A signer with a revocation
 * rate well above the firm's is the row a partner wants to look at.
 */
export function buildSignerLoad(udins: SignerUdin[], limit = 6) {
  const bySigner = new Map<string, { active: number; name: string; revoked: number; total: number }>();
  for (const entry of udins) {
    const existing = bySigner.get(entry.signedByName)
      ?? { active: 0, name: entry.signedByName, revoked: 0, total: 0 };
    existing.total += 1;
    if (entry.status === "revoked") existing.revoked += 1; else existing.active += 1;
    bySigner.set(entry.signedByName, existing);
  }
  return [...bySigner.values()]
    .map((signer) => ({
      ...signer,
      revocationRate: signer.total ? Math.round((signer.revoked / signer.total) * 1000) / 10 : 0,
    }))
    .sort((left, right) => right.total - left.total || left.name.localeCompare(right.name))
    .slice(0, limit);
}

export type AuthorityNotice = { authority: string; responseDueDate: string; status: string };

const AUTHORITY_LABELS: Record<string, string> = {
  income_tax: "Income tax", gst: "GST", tds: "TDS", roc: "ROC", other: "Other",
};

/** Where the notice pressure is coming from, and how much of it is already late. */
export function buildAuthorityLoad(notices: AuthorityNotice[], todayKey: string) {
  const byAuthority = new Map<string, { authority: string; label: string; open: number; overdue: number; total: number }>();
  for (const notice of notices) {
    const existing = byAuthority.get(notice.authority)
      ?? { authority: notice.authority, label: AUTHORITY_LABELS[notice.authority] ?? notice.authority, open: 0, overdue: 0, total: 0 };
    existing.total += 1;
    if (["open", "in_progress"].includes(notice.status)) {
      existing.open += 1;
      if (notice.responseDueDate < todayKey) existing.overdue += 1;
    }
    byAuthority.set(notice.authority, existing);
  }
  return [...byAuthority.values()].sort((left, right) => right.total - left.total || left.label.localeCompare(right.label));
}

export type CustodyCertificate = {
  clientName: string;
  holderName: string;
  id: string;
  issuedOutSince?: string | null;
  serialNumber: string;
  status: string;
};

/**
 * Tokens that are out, longest first. This is the list somebody has to work
 * through with a phone; ordering it by how long the trail has been open is the
 * whole value.
 */
export function buildCustodyOutliers(certificates: CustodyCertificate[], todayKey: string, limit = 8) {
  return certificates
    .filter((certificate) => certificate.status === "issued_out" && certificate.issuedOutSince)
    .map((certificate) => ({
      clientName: certificate.clientName,
      days: Math.abs(dayDifference(certificate.issuedOutSince!.slice(0, 10), todayKey)),
      holderName: certificate.holderName,
      id: certificate.id,
      serialNumber: certificate.serialNumber,
    }))
    .sort((left, right) => right.days - left.days)
    .slice(0, limit);
}

export type RegisterInsightsInput = {
  certificates: Array<RunwayCertificate & CustodyCertificate>;
  notices: Array<TurnaroundNotice & AuthorityNotice>;
  todayKey: string;
  udins: SignerUdin[];
};

export type RegisterInsights = {
  authorities: ReturnType<typeof buildAuthorityLoad>;
  custody: ReturnType<typeof buildCustodyOutliers>;
  runway: ReturnType<typeof buildExpiryRunway>;
  signers: ReturnType<typeof buildSignerLoad>;
  trend: ReturnType<typeof buildUdinTrend>;
  turnaround: TurnaroundStats;
};

/** Everything the Insights tab renders, computed once from rows already loaded. */
export function buildRegisterInsights({ certificates, notices, todayKey, udins }: RegisterInsightsInput): RegisterInsights {
  return {
    authorities: buildAuthorityLoad(notices, todayKey),
    custody: buildCustodyOutliers(certificates, todayKey),
    runway: buildExpiryRunway(certificates, todayKey),
    signers: buildSignerLoad(udins),
    trend: buildUdinTrend(udins, todayKey),
    turnaround: buildNoticeTurnaround(notices),
  };
}
