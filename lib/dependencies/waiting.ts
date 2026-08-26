/**
 * Dependencies as records rather than prose.
 *
 * `waiting` was a status with a note beside it: "Bank statement awaited". That
 * sentence cannot be counted, cannot be chased, and cannot tell anybody it has
 * been satisfied — so work stayed in `waiting` after the wait had ended, and the
 * only way to learn otherwise was to ask the person holding it.
 *
 * A dependency names what is awaited, who owes it, and when it is expected. Two
 * of the three kinds close themselves, which is the half the note could never
 * do: nothing noticed arrival.
 */

export type DependencyKind = "client_request" | "work_item" | "external";

export const DEPENDENCY_KINDS: readonly DependencyKind[] = ["client_request", "work_item", "external"];

export const KIND_LABELS: Record<DependencyKind, string> = {
  client_request: "Client deliverable",
  external: "External party",
  work_item: "Predecessor work",
};

/** How each kind stops being outstanding. Shown so nobody chases the wrong one. */
export const KIND_CLEARS: Record<DependencyKind, string> = {
  client_request: "Clears when the document request is received",
  external: "Cleared by hand when it arrives",
  work_item: "Clears when that obligation completes",
};

export const isDependencyKind = (value: string): value is DependencyKind =>
  (DEPENDENCY_KINDS as readonly string[]).includes(value);

export type Dependency = {
  clearedAt: string | null;
  expectedOn: string;
  id: string;
  kind: DependencyKind;
  title: string;
};

export type DependencyStanding = {
  /** Open dependencies, soonest expected first. What the firm is chasing. */
  open: Dependency[];
  /** Open and already past the date it was expected. */
  overdue: Dependency[];
  /** True when something was outstanding and no longer is. */
  settled: boolean;
  /** The soonest date anything is still expected, or null when nothing is. */
  nextExpectedOn: string | null;
  cleared: number;
};

/**
 * Where the work stands with everything it waits on.
 *
 * `settled` is deliberately not "there is nothing open" — work that never had a
 * dependency has nothing open either, and telling its assignee it is unblocked
 * would be noise. Settled means a wait ended.
 */
export function standingOf(dependencies: readonly Dependency[], todayKey: string): DependencyStanding {
  const open = dependencies
    .filter((dependency) => dependency.clearedAt === null)
    .sort((left, right) => (left.expectedOn === right.expectedOn
      ? left.title.localeCompare(right.title)
      : left.expectedOn.localeCompare(right.expectedOn)));
  const cleared = dependencies.length - open.length;
  return {
    cleared,
    nextExpectedOn: open[0]?.expectedOn ?? null,
    open,
    overdue: open.filter((dependency) => dependency.expectedOn < todayKey),
    settled: open.length === 0 && cleared > 0,
  };
}

export type WaitingRefusal = "no_dependency";

export const WAITING_REFUSAL_NOTES: Record<WaitingRefusal, string> = {
  no_dependency: "Record what this work is waiting on before setting it to Waiting.",
};

/**
 * Whether `waiting` is a claim the record supports.
 *
 * The status meant whatever the note beside it said. Now it means there is at
 * least one thing outstanding, and a status that outlives its dependencies is
 * refused rather than left to be noticed.
 */
export function refuseWaiting(input: { openCount: number; status: string }): WaitingRefusal | null {
  if (input.status !== "waiting") return null;
  return input.openCount === 0 ? "no_dependency" : null;
}

export type RaiseRefusal =
  | "title_required" | "unknown_kind" | "no_target" | "self_dependency"
  | "cycle" | "date_required" | "duplicate" | "predecessor_completed" | "request_closed";

export const RAISE_REFUSAL_NOTES: Record<RaiseRefusal, string> = {
  cycle: "That obligation is already waiting on this one, directly or through a chain. Neither could ever start.",
  date_required: "Say when this is expected. A wait with no date cannot be chased.",
  duplicate: "This work is already waiting on that.",
  no_target: "Choose the request, the obligation, or name the party this waits on.",
  predecessor_completed: "That obligation is already complete, so nothing is waiting on it.",
  request_closed: "That document request is already closed.",
  self_dependency: "Work cannot wait on itself.",
  title_required: "Say what is awaited, in the words you would use asking for it.",
  unknown_kind: "Choose what kind of thing this waits on.",
};

/**
 * Whether the dependency can be raised.
 *
 * `cycle` is the one worth stating plainly: A waiting on B while B waits on A
 * is not a slow project, it is a deadlock nobody can see from either end. The
 * caller walks the chain and passes what it found.
 */
export function refuseRaise(input: {
  expectedOn: string;
  kind: string;
  openDuplicate: boolean;
  predecessorStatus: string | null;
  reachesSelf: boolean;
  requestStatus: string | null;
  target: string | null;
  title: string;
  workItemId: string;
}): RaiseRefusal | null {
  if (!isDependencyKind(input.kind)) return "unknown_kind";
  if (input.title.trim().length < 3) return "title_required";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.expectedOn)) return "date_required";
  if (!input.target) return "no_target";
  if (input.kind === "work_item") {
    if (input.target === input.workItemId) return "self_dependency";
    if (input.predecessorStatus === "completed") return "predecessor_completed";
    if (input.reachesSelf) return "cycle";
  }
  if (input.kind === "client_request" && input.requestStatus !== "requested") return "request_closed";
  if (input.openDuplicate) return "duplicate";
  return null;
}

/**
 * Does following `waits on` from `startId` ever arrive back at `targetId`?
 *
 * Depth-first over the edges the caller loaded, guarding against cycles that
 * already exist so a bad row cannot make this run forever.
 */
export function reaches(
  edges: ReadonlyMap<string, readonly string[]>,
  startId: string,
  targetId: string,
): boolean {
  const seen = new Set<string>();
  const stack = [startId];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current === targetId) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    stack.push(...(edges.get(current) ?? []));
  }
  return false;
}

/** `2 outstanding · next expected 12 Dec` — how somebody would say it. */
export function waitingSummary(standing: DependencyStanding, formatDate: (key: string) => string): string {
  if (standing.open.length === 0) {
    return standing.settled ? "Nothing outstanding" : "No dependencies recorded";
  }
  const overdue = standing.overdue.length > 0 ? ` · ${standing.overdue.length} overdue` : "";
  return `${standing.open.length} outstanding · next expected ${formatDate(standing.nextExpectedOn!)}${overdue}`;
}

/**
 * What the assignee is told when the last one clears.
 *
 * Deliberately not a status change: the work stays where the firm put it, and a
 * person decides what to do now the wait is over.
 */
export function clearedNotice(input: { clientName: string; periodKey: string; serviceKey: string }) {
  return {
    body: "Nothing is outstanding on it any more. It is yours to pick up.",
    // Deliberately not "is no longer waiting": the workflow status is a separate
    // thing a person sets, and this must not read as a claim about it.
    title: `Everything you were waiting on for ${input.serviceKey} · ${input.clientName} · ${input.periodKey} has arrived`,
  };
}
