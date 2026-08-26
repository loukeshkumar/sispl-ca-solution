/**
 * Practice signals.
 *
 * Deterministic, grounded detection over data the firm already holds. Every
 * signal states the evidence that produced it, so a partner can verify it rather
 * than trust it. Nothing here predicts or infers — a natural-language layer could
 * sit on top later, but the answers themselves must stay checkable.
 */

import type { FirmUtilisation } from "../rates/utilisation";

export type SignalSeverity = "critical" | "warning" | "info";
export type SignalCategory = "delivery" | "receivables" | "clients" | "team" | "registers";

export type PracticeSignal = {
  id: string;
  category: SignalCategory;
  severity: SignalSeverity;
  title: string;
  detail: string;
  evidence: string;
  actionHref: string | null;
};

export type SignalWorkItem = {
  id: string;
  clientName: string;
  serviceKey: string;
  periodKey: string;
  statutoryDueDate: string;
  status: string;
  assigneeName: string | null;
};

export type SignalInvoice = { id: string; invoiceNumber: string; clientName: string; totalPaise: number; dueDate: string | null; status: string };
export type SignalClient = { id: string; name: string; healthScore: number; riskStatus: string; openObligations: number };
export type SignalTimeEntry = { employeeUserId: string; employeeName: string; minutes: number; billable: boolean };
export type SignalCertificate = { id: string; holderName: string; serialNumber: string; validUntil: string; status: string };
export type SignalNotice = { id: string; noticeNumber: string; clientName: string; responseDueDate: string; status: string };

export type SignalInputs = {
  workItems: SignalWorkItem[];
  invoices: SignalInvoice[];
  clients: SignalClient[];
  timeEntries: SignalTimeEntry[];
  certificates: SignalCertificate[];
  notices: SignalNotice[];
  /** Absent when the caller did not measure it; the signal then stays quiet. */
  utilisation?: FirmUtilisation | null;
  todayKey: string;
};

const SEVERITY_RANK: Record<SignalSeverity, number> = { critical: 0, warning: 1, info: 2 };

function daysBetween(fromKey: string, toKey: string) {
  return Math.round((Date.parse(`${toKey}T00:00:00Z`) - Date.parse(`${fromKey}T00:00:00Z`)) / 86_400_000);
}

function formatPaise(paise: number) {
  return `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function serviceLabel(serviceKey: string) {
  return serviceKey.replaceAll("_", " ").toUpperCase();
}

/** Obligations already past their statutory date, grouped so one alert covers a service. */
export function detectOverdueObligations(input: SignalInputs): PracticeSignal[] {
  const overdue = input.workItems.filter((item) => item.status !== "completed" && item.statutoryDueDate < input.todayKey);
  if (overdue.length === 0) return [];
  const byService = new Map<string, SignalWorkItem[]>();
  for (const item of overdue) {
    byService.set(item.serviceKey, [...(byService.get(item.serviceKey) ?? []), item]);
  }
  return [...byService.entries()].map(([serviceKey, items]) => {
    const worst = items.reduce((latest, item) => (item.statutoryDueDate < latest.statutoryDueDate ? item : latest));
    const slippage = daysBetween(worst.statutoryDueDate, input.todayKey);
    return {
      id: `overdue-${serviceKey}`,
      category: "delivery" as const,
      severity: slippage >= 15 ? ("critical" as const) : ("warning" as const),
      title: `${items.length} ${serviceLabel(serviceKey)} obligation${items.length === 1 ? "" : "s"} past the statutory date`,
      detail: `The oldest is ${slippage} day${slippage === 1 ? "" : "s"} overdue.`,
      evidence: `${worst.clientName} · ${worst.periodKey} · due ${worst.statutoryDueDate}${worst.assigneeName ? ` · ${worst.assigneeName}` : " · unassigned"}`,
      actionHref: `/work/${worst.id}`,
    };
  });
}

/** Work with no owner cannot slip to anyone, which is how deadlines are missed. */
export function detectUnassignedWork(input: SignalInputs): PracticeSignal[] {
  const unassigned = input.workItems.filter((item) => item.status !== "completed" && !item.assigneeName);
  if (unassigned.length === 0) return [];
  const soonest = unassigned.reduce((earliest, item) => (item.statutoryDueDate < earliest.statutoryDueDate ? item : earliest));
  return [{
    id: "unassigned-work",
    category: "delivery",
    severity: unassigned.some((item) => daysBetween(input.todayKey, item.statutoryDueDate) <= 7) ? "critical" : "warning",
    title: `${unassigned.length} open obligation${unassigned.length === 1 ? "" : "s"} have no owner`,
    detail: "Unowned work has nobody accountable for the deadline.",
    evidence: `Earliest: ${soonest.clientName} · ${serviceLabel(soonest.serviceKey)} ${soonest.periodKey} · due ${soonest.statutoryDueDate}`,
    actionHref: `/work/${soonest.id}`,
  }];
}

const AGEING_BUCKETS = [90, 60, 30] as const;

export function detectReceivablesAgeing(input: SignalInputs): PracticeSignal[] {
  const outstanding = input.invoices.filter((invoice) => invoice.status === "issued" && invoice.dueDate !== null && invoice.dueDate < input.todayKey);
  if (outstanding.length === 0) return [];
  for (const threshold of AGEING_BUCKETS) {
    const aged = outstanding.filter((invoice) => daysBetween(invoice.dueDate!, input.todayKey) >= threshold);
    if (aged.length === 0) continue;
    const total = aged.reduce((sum, invoice) => sum + invoice.totalPaise, 0);
    const oldest = aged.reduce((earliest, invoice) => (invoice.dueDate! < earliest.dueDate! ? invoice : earliest));
    return [{
      id: `receivables-${threshold}`,
      category: "receivables",
      severity: threshold >= 60 ? "critical" : "warning",
      title: `${formatPaise(total)} outstanding for more than ${threshold} days`,
      detail: `${aged.length} invoice${aged.length === 1 ? "" : "s"} past due by ${threshold} days or more.`,
      evidence: `Oldest: ${oldest.invoiceNumber} · ${oldest.clientName} · due ${oldest.dueDate}`,
      actionHref: `/billing/${oldest.id}`,
    }];
  }
  const total = outstanding.reduce((sum, invoice) => sum + invoice.totalPaise, 0);
  return [{
    id: "receivables-overdue",
    category: "receivables",
    severity: "info",
    title: `${formatPaise(total)} is past its payment due date`,
    detail: `${outstanding.length} invoice${outstanding.length === 1 ? "" : "s"} awaiting collection.`,
    evidence: `Oldest due ${outstanding.reduce((earliest, invoice) => (invoice.dueDate! < earliest.dueDate! ? invoice : earliest)).dueDate}`,
    actionHref: "/?workspace=billing",
  }];
}

export function detectClientRisk(input: SignalInputs): PracticeSignal[] {
  const critical = input.clients.filter((client) => client.riskStatus === "critical");
  if (critical.length === 0) return [];
  const worst = critical.reduce((lowest, client) => (client.healthScore < lowest.healthScore ? client : lowest));
  return [{
    id: "client-risk",
    category: "clients",
    severity: "warning",
    title: `${critical.length} client relationship${critical.length === 1 ? "" : "s"} at critical health`,
    detail: "Critical health combines service readiness, deadlines, and outstanding dependencies.",
    evidence: `Lowest: ${worst.name} at ${worst.healthScore}/100 with ${worst.openObligations} open obligation${worst.openObligations === 1 ? "" : "s"}`,
    actionHref: `/clients/${worst.id}`,
  }];
}

/**
 * Utilisation against the target the firm set, not against each other.
 *
 * This used to compare everyone to the team median, which sounds reasonable and
 * answers the wrong question: a team that collectively records half of what it
 * works has a perfectly healthy median. It also went silent whenever the median
 * was zero — the one case that most needed saying out loud.
 *
 * Two distinct signals come out of the same measurement, and they are not the
 * same problem: time not sold, and time not recorded at all. The second is
 * raised first, because until the timesheets are in, the first is a guess.
 */
export function detectUtilisationGap(input: SignalInputs): PracticeSignal[] {
  const utilisation = input.utilisation;
  if (!utilisation || utilisation.people.length === 0) return [];
  const signals: PracticeSignal[] = [];

  if (utilisation.missingTimesheets > 0) {
    const worst = [...utilisation.people]
      .filter((person) => person.availableMinutes > 0)
      .sort((left, right) => right.missingMinutes - left.missingMinutes)[0];
    signals.push({
      id: "utilisation-unrecorded",
      category: "team",
      severity: "warning",
      title: `${utilisation.missingTimesheets} employee${utilisation.missingTimesheets === 1 ? "" : "s"} have substantially unrecorded time`,
      detail: "Utilisation, engagement cost, and unbilled value are all understated until the timesheets are in.",
      evidence: worst
        ? `${worst.fullName} recorded ${Math.round(worst.recordedMinutes / 60)}h of ${Math.round(worst.availableMinutes / 60)}h available`
        : "",
      actionHref: "/?workspace=timesheets",
    });
  }

  const below = utilisation.people.filter((person) => person.band === "under");
  if (below.length > 0) {
    const worst = below.reduce((lowest, person) => (person.varianceBps! < lowest.varianceBps! ? person : lowest));
    signals.push({
      id: "utilisation-below-target",
      category: "team",
      severity: "info",
      title: `${below.length} employee${below.length === 1 ? "" : "s"} below their utilisation target`,
      detail: "Chargeable time is short of what the firm planned to sell.",
      evidence: `${worst.fullName} at ${(worst.utilisationBps! / 100).toFixed(1)}% against a target of ${(worst.targetBasisPoints! / 100).toFixed(1)}%`,
      actionHref: "/?workspace=timesheets",
    });
  }

  // Nobody measured is itself the finding: the number cannot be managed to.
  if (utilisation.unmeasured === utilisation.people.length && utilisation.people.length > 0) {
    signals.push({
      id: "utilisation-no-target",
      category: "team",
      severity: "info",
      title: "No utilisation targets are set, so nobody is measured",
      detail: "Utilisation is only meaningful against a figure the firm committed to in advance.",
      evidence: `${utilisation.people.length} active employees, none with a target`,
      actionHref: "/settings/utilisation",
    });
  }

  return signals;
}

export function detectRegisterRisk(input: SignalInputs): PracticeSignal[] {
  const signals: PracticeSignal[] = [];
  const live = input.certificates.filter((certificate) => ["in_custody", "issued_out"].includes(certificate.status));
  const expired = live.filter((certificate) => certificate.validUntil < input.todayKey);
  if (expired.length > 0) {
    const oldest = expired.reduce((earliest, certificate) => (certificate.validUntil < earliest.validUntil ? certificate : earliest));
    signals.push({
      id: "dsc-expired",
      category: "registers",
      severity: "critical",
      title: `${expired.length} digital signature${expired.length === 1 ? "" : "s"} held by the firm have expired`,
      detail: "An expired token cannot sign and must be renewed or surrendered.",
      evidence: `Oldest: ${oldest.holderName} · ${oldest.serialNumber} · expired ${oldest.validUntil}`,
      actionHref: "/?workspace=registers",
    });
  }
  const openNotices = input.notices.filter((notice) => ["open", "in_progress"].includes(notice.status) && notice.responseDueDate < input.todayKey);
  if (openNotices.length > 0) {
    const worst = openNotices.reduce((earliest, notice) => (notice.responseDueDate < earliest.responseDueDate ? notice : earliest));
    signals.push({
      id: "notice-overdue",
      category: "registers",
      severity: "critical",
      title: `${openNotices.length} statutory notice${openNotices.length === 1 ? "" : "s"} are past their response deadline`,
      detail: "A lapsed response window can escalate the proceeding.",
      evidence: `Oldest: ${worst.noticeNumber} · ${worst.clientName} · due ${worst.responseDueDate}`,
      actionHref: "/?workspace=registers",
    });
  }
  return signals;
}

export function buildPracticeSignals(input: SignalInputs): PracticeSignal[] {
  return [
    ...detectOverdueObligations(input),
    ...detectUnassignedWork(input),
    ...detectReceivablesAgeing(input),
    ...detectClientRisk(input),
    ...detectUtilisationGap(input),
    ...detectRegisterRisk(input),
  ].sort((left, right) => {
    const bySeverity = SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity];
    return bySeverity !== 0 ? bySeverity : left.title.localeCompare(right.title);
  });
}
