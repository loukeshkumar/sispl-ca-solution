const DAY_MS = 86_400_000;

const dayKey = (isoOrKey: string) => isoOrKey.slice(0, 10);

/** Whole days between a creation stamp and today, never negative. */
function ageInDays(createdAt: string, todayKey: string) {
  const created = Date.parse(`${dayKey(createdAt)}T00:00:00Z`);
  if (Number.isNaN(created)) return null;
  return Math.max(0, Math.round((Date.parse(`${todayKey}T00:00:00Z`) - created) / DAY_MS));
}

/**
 * How long a client has been sitting on a request. The difference between a
 * nudge and an escalation is age, and the register never showed it.
 */
export function ageLabel(createdAt: string, todayKey: string) {
  const days = ageInDays(createdAt, todayKey);
  if (days === null) return "";
  if (days === 0) return "asked today";
  if (days === 1) return "asked yesterday";
  return `asked ${days} days ago`;
}

export type ChaseRequest = {
  clientName: string;
  createdAt: string;
  dueDate: string;
  id: string;
  legalEntityId: string;
  status: string;
  title: string;
};

export type ChaseGroup = {
  clientName: string;
  items: ChaseRequest[];
  legalEntityId: string;
  oldestDays: number;
  oldestLabel: string;
};

/**
 * Chasing happens per client — one call covering four documents — but the
 * register is per request. Groups are ordered by the longest wait, because that
 * is the client who gets called first.
 */
export function groupRequestsByClient(requests: ChaseRequest[], todayKey: string): ChaseGroup[] {
  const groups = new Map<string, ChaseGroup>();
  for (const request of requests) {
    const existing = groups.get(request.legalEntityId);
    const days = ageInDays(request.createdAt, todayKey) ?? 0;
    if (!existing) {
      groups.set(request.legalEntityId, {
        clientName: request.clientName,
        items: [request],
        legalEntityId: request.legalEntityId,
        oldestDays: days,
        oldestLabel: ageLabel(request.createdAt, todayKey),
        });
      continue;
    }
    existing.items.push(request);
    if (days > existing.oldestDays) {
      existing.oldestDays = days;
      existing.oldestLabel = ageLabel(request.createdAt, todayKey);
    }
  }
  return [...groups.values()]
    .map((group) => ({ ...group, items: [...group.items].sort((left, right) => left.dueDate.localeCompare(right.dueDate)) }))
    .sort((left, right) => right.oldestDays - left.oldestDays || left.clientName.localeCompare(right.clientName));
}
