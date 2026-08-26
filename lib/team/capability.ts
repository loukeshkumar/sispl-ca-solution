/**
 * What people are trusted to do, and what follows from it.
 *
 * A professional firm sells capability, so the question "who can do this?" is
 * the one it answers most often — and until now the software could not answer it
 * at all: the work form knew a job was a tax audit and still offered every
 * member of staff for it. Everything here is pure, so the two rules that carry
 * consequences — a stretch assignment is allowed and recorded, an unqualified
 * reviewer is refused — can be argued about in a test.
 */

/**
 * The ladder, weakest first. It is a ladder and not a set: whoever can review
 * can also prepare, and whoever can sign can do both. Keeping the order in one
 * place is what makes that true everywhere.
 */
export const CAPABILITY_LEVELS = ["learning", "prepare", "review", "sign"] as const;
export type CapabilityLevel = (typeof CAPABILITY_LEVELS)[number];

export const CAPABILITY_LABELS: Record<CapabilityLevel, string> = {
  learning: "Learning",
  prepare: "Can prepare",
  review: "Can review",
  sign: "Can sign",
};

/** What the firm is saying when it records each level. */
export const CAPABILITY_DESCRIPTIONS: Record<CapabilityLevel, string> = {
  learning: "Working on this service under supervision. Not yet trusted with it alone.",
  prepare: "Can be given this work to do.",
  review: "Can be given this work, and can review somebody else's.",
  sign: "Can review, and can put the firm's name to the result.",
};

export const isCapabilityLevel = (value: string): value is CapabilityLevel =>
  (CAPABILITY_LEVELS as readonly string[]).includes(value);

const rank = (level: CapabilityLevel) => CAPABILITY_LEVELS.indexOf(level);

/** True when `level` reaches `required` or stands above it on the ladder. */
export function meets(level: CapabilityLevel | null, required: CapabilityLevel): boolean {
  return level !== null && rank(level) >= rank(required);
}

export type Qualification = "ca" | "cma" | "cs" | "llb" | "ca_inter" | "articled" | "other";

export const QUALIFICATIONS: readonly Qualification[] = ["ca", "cma", "cs", "llb", "ca_inter", "articled", "other"];

export const QUALIFICATION_LABELS: Record<Qualification, string> = {
  ca: "Chartered Accountant",
  cma: "Cost & Management Accountant",
  cs: "Company Secretary",
  llb: "LL.B.",
  ca_inter: "CA (Inter)",
  articled: "Articled assistant",
  other: "Other",
};

export const isQualification = (value: string): value is Qualification =>
  (QUALIFICATIONS as readonly string[]).includes(value);

/** Only a qualified member carries an ICAI membership number. */
export const holdsMembership = (qualification: string) => qualification === "ca";

export type CapabilityRecord = { level: CapabilityLevel; serviceCode: string };

export type MemberCapability = {
  level: CapabilityLevel | null;
  memberId: string;
};

export type AssignmentVerdict = {
  /** Set when the choice is refused outright. */
  blocked: boolean;
  level: CapabilityLevel | null;
  message: string;
  /** Set when the choice is allowed but the firm should know about it. */
  stretch: boolean;
};

const capabilityOf = (records: ReadonlyArray<CapabilityRecord>, serviceCode: string): CapabilityLevel | null =>
  records.find((record) => record.serviceCode.toUpperCase() === serviceCode.toUpperCase())?.level ?? null;

/**
 * Whether this service is governed yet.
 *
 * Capability is enforced per service, and only once the firm has said who may
 * review that service. Treating an empty matrix as "nobody is capable" would
 * lock the reviewer field on the day the feature ships and make the firm fill in
 * a grid before it could file anything — so an unrecorded service simply is not
 * gated, and the gate closes the moment the firm names its first reviewer.
 */
export function serviceIsGoverned(reviewersForService: number): boolean {
  return reviewersForService > 0;
}

/**
 * Giving somebody work they are not yet rated for is a normal thing to do —
 * it is how people learn — so it is allowed, and said out loud.
 */
export function assessAssignee(
  records: ReadonlyArray<CapabilityRecord>,
  serviceCode: string,
  serviceName: string,
): AssignmentVerdict {
  const level = capabilityOf(records, serviceCode);
  if (meets(level, "prepare")) {
    return { blocked: false, level, message: `${CAPABILITY_LABELS[level!]} · ${serviceName}`, stretch: false };
  }
  return {
    blocked: false,
    level,
    message: level === "learning"
      ? `Still learning ${serviceName}. Assigning this is stretch work, and will be recorded as such.`
      : `No recorded capability for ${serviceName}. Assigning this is stretch work, and will be recorded as such.`,
    stretch: true,
  };
}

/**
 * The reviewer is the firm's quality control, so this one is a gate rather than
 * a warning: a review signed off by somebody the firm has not judged competent
 * in that service is not a review, it is a second pair of eyes with no standing.
 */
export function assessReviewer(
  records: ReadonlyArray<CapabilityRecord>,
  serviceCode: string,
  serviceName: string,
  governed: boolean,
): AssignmentVerdict {
  const level = capabilityOf(records, serviceCode);
  if (meets(level, "review")) {
    return { blocked: false, level, message: `${CAPABILITY_LABELS[level!]} · ${serviceName}`, stretch: false };
  }
  if (!governed) {
    return {
      blocked: false,
      level,
      message: `Nobody is recorded as able to review ${serviceName} yet, so this is not being checked.`,
      stretch: false,
    };
  }
  return {
    blocked: true,
    level,
    message: `Cannot review ${serviceName}. Choose someone recorded as able to review it.`,
    stretch: false,
  };
}

export type BenchRow = {
  /** Everyone who can review or sign. The firm's real depth on this service. */
  reviewers: number;
  serviceCode: string;
  serviceName: string;
  /** Everyone who can prepare it or better. */
  capable: number;
  learning: number;
};

export type BenchRisk = "none" | "thin" | "single_point" | "uncovered";

/**
 * Where the firm is one illness away from a problem.
 *
 * A service nobody can review is uncovered; one person is a single point of
 * failure; two is thin. Said plainly, because the point of holding this data is
 * to notice before the deadline does.
 */
export function benchRisk(row: Pick<BenchRow, "reviewers">): BenchRisk {
  if (row.reviewers === 0) return "uncovered";
  if (row.reviewers === 1) return "single_point";
  if (row.reviewers === 2) return "thin";
  return "none";
}

export const BENCH_RISK_LABELS: Record<BenchRisk, string> = {
  none: "Covered",
  thin: "Thin",
  single_point: "One person",
  uncovered: "Nobody",
};

export const BENCH_RISK_NOTES: Record<BenchRisk, string> = {
  none: "Three or more people can review this.",
  thin: "Two reviewers. One absence leaves a single point of failure.",
  single_point: "One reviewer. Their absence stops this service.",
  uncovered: "Nobody can review this service. Work on it cannot be signed off.",
};

/**
 * Members ordered for a picker: capable first, strongest first, then everyone
 * else alphabetically. Sorting rather than hiding, so a manager can still make
 * the call the software did not anticipate.
 */
export function rankMembers<T extends { fullName: string; id: string }>(
  members: readonly T[],
  levelById: ReadonlyMap<string, CapabilityLevel>,
): Array<T & { level: CapabilityLevel | null }> {
  return members
    .map((member) => ({ ...member, level: levelById.get(member.id) ?? null }))
    .sort((left, right) => {
      const gap = (right.level ? rank(right.level) + 1 : 0) - (left.level ? rank(left.level) + 1 : 0);
      return gap !== 0 ? gap : left.fullName.localeCompare(right.fullName);
    });
}
