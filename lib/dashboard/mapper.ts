import type {
  DashboardClient,
  DashboardData,
  DashboardRecords,
  DashboardWorkItem,
  DataSource,
  RiskStatus,
  WorkStatus,
} from "./types";

const SERVICE_LABELS: Record<string, string> = {
  tds_26q: "TDS 26Q",
  gstr_3b: "GSTR-3B",
  monthly_close: "Monthly close",
  form_10b: "Form 10B",
};

const WORK_STATUS: Record<DashboardRecords["workItems"][number]["status"], WorkStatus> = {
  critical: "Critical",
  at_risk: "At risk",
  waiting: "Waiting",
  review: "Review",
};

const COLOR_BY_STATUS: Record<WorkStatus, DashboardWorkItem["color"]> = {
  Critical: "violet",
  "At risk": "blue",
  Waiting: "orange",
  Review: "green",
};

const DAY_MS = 86_400_000;

export function initials(name: string) {
  const words = name.match(/[\p{L}\p{N}]+/gu) ?? [];
  return words.slice(0, 2).map((word) => word[0]?.toUpperCase()).join("");
}

function dateKeyInIndia(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function dayDifference(dateKey: string, todayKey: string) {
  return Math.round((Date.parse(`${dateKey}T00:00:00Z`) - Date.parse(`${todayKey}T00:00:00Z`)) / DAY_MS);
}

function shortDate(dateKey: string) {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(
    new Date(`${dateKey}T00:00:00Z`),
  );
}

function dueLabels(dateKey: string, todayKey: string) {
  const difference = dayDifference(dateKey, todayKey);
  if (difference === 0) return { due: "Today", detail: "Due today", relative: "Today" };
  if (difference === 1) return { due: "Tomorrow", detail: "Tomorrow", relative: "Tomorrow" };
  if (difference < 0) {
    const days = Math.abs(difference);
    return { due: shortDate(dateKey), detail: `${days} day${days === 1 ? "" : "s"} overdue`, relative: `${days}d overdue` };
  }
  return { due: shortDate(dateKey), detail: `${difference} days left`, relative: `${difference} days` };
}

function monthYear(dateKey: string) {
  return new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${dateKey}T00:00:00Z`),
  );
}

function titleDate(now: Date) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(now);
}

export function mapDashboardRecords(
  records: DashboardRecords,
  now = new Date(),
  source: DataSource = "demo",
): DashboardData {
  const todayKey = dateKeyInIndia(now);
  const workByEntity = new Map<string, DashboardRecords["workItems"]>();
  for (const item of records.workItems) {
    const existing = workByEntity.get(item.legalEntityId) ?? [];
    existing.push(item);
    workByEntity.set(item.legalEntityId, existing);
  }

  const work: DashboardWorkItem[] = [...records.workItems]
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    .map((item) => {
      const status = WORK_STATUS[item.status];
      const labels = dueLabels(item.dueDate, todayKey);
      return {
        id: item.id,
        client: item.clientName,
        initials: initials(item.clientName),
        service: SERVICE_LABELS[item.serviceKey] ?? item.serviceKey,
        period: item.periodKey,
        owner: item.ownerName,
        ownerInitials: initials(item.ownerName),
        due: labels.due,
        dueDetail: labels.detail,
        dueDate: item.dueDate,
        status,
        note: item.blockerNote,
        progress: item.progress,
        color: COLOR_BY_STATUS[status],
      };
    });

  const clients: DashboardClient[] = records.clients.map((client) => {
    const nextWork = [...(workByEntity.get(client.id) ?? [])].sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
    const risk = `${client.riskStatus[0]?.toUpperCase()}${client.riskStatus.slice(1)}` as RiskStatus;
    return {
      id: client.id,
      name: client.legalName,
      displayName: client.displayName,
      short: initials(client.legalName),
      type: client.entityType,
      pan: client.maskedPan,
      gstins: client.gstRegistrations,
      owner: client.ownerName,
      services: client.services,
      health: client.healthScore,
      risk,
      next: nextWork
        ? `${SERVICE_LABELS[nextWork.serviceKey] ?? nextWork.serviceKey} · ${dueLabels(nextWork.dueDate, todayKey).due}`
        : "No open obligation",
      missing: nextWork?.missingItems ?? 0,
      city: client.city,
      joined: monthYear(client.relationshipStart),
    };
  });

  const serviceScores = new Map<string, number[]>();
  for (const client of records.clients) {
    for (const service of client.services) {
      const scores = serviceScores.get(service) ?? [];
      scores.push(client.healthScore);
      serviceScores.set(service, scores);
    }
  }

  const administrator = records.members.find((member) => member.roleKey === "firm_administrator") ?? records.members[0];
  const overdue = records.workItems.filter((item) => dayDifference(item.dueDate, todayKey) < 0).length;
  const nonOverdue = Math.max(0, records.workItems.length - overdue);
  const healthyClients = clients.filter((client) => client.risk === "Healthy").length;
  const averageHealth = clients.length
    ? Math.round(clients.reduce((sum, client) => sum + client.health, 0) / clients.length)
    : 0;

  return {
    source,
    generatedAt: now.toISOString(),
    titleDate: titleDate(now),
    practice: {
      name: records.tenant.displayName,
      legalName: records.tenant.legalName,
      initials: initials(records.tenant.displayName),
      subtitle: "Chartered Accountants",
      administratorName: administrator?.fullName ?? "Firm administrator",
      administratorRole: "Firm administrator",
      administratorInitials: initials(administrator?.fullName ?? "Firm administrator"),
      activeTeamMembers: records.members.filter((member) => member.status === "active").length,
    },
    metrics: {
      clientGroups: new Set(records.clients.map((client) => client.clientGroupId)).size,
      legalEntities: records.clients.length,
      gstRegistrations: records.clients.reduce((sum, client) => sum + client.gstRegistrations, 0),
      healthyPercentage: clients.length ? Math.round((healthyClients / clients.length) * 100) : 0,
      attentionClients: clients.filter((client) => client.risk !== "Healthy").length,
      criticalClients: clients.filter((client) => client.risk === "Critical").length,
      overdue,
      dueThisWeek: records.workItems.filter((item) => {
        const difference = dayDifference(item.dueDate, todayKey);
        return difference >= 0 && difference <= 7;
      }).length,
      waitingOnClient: records.workItems.filter((item) => item.status === "waiting").length,
      pendingReview: records.workItems.filter((item) => item.status === "review").length,
      completed: 0,
      onTimeRate: records.workItems.length ? Math.round((nonOverdue / records.workItems.length) * 100) : 100,
      attentionNeeded: records.workItems.length,
      averageHealth,
    },
    clients,
    work,
    deadlines: work.map((item) => {
      const date = new Date(`${item.dueDate}T00:00:00Z`);
      const related = records.workItems.filter((candidate) => candidate.dueDate === item.dueDate && candidate.serviceKey === records.workItems.find((raw) => raw.id === item.id)?.serviceKey);
      return {
        id: item.id,
        day: new Intl.DateTimeFormat("en-GB", { day: "2-digit", timeZone: "UTC" }).format(date),
        month: new Intl.DateTimeFormat("en-GB", { month: "short", timeZone: "UTC" }).format(date).toUpperCase(),
        label: item.service,
        summary: `${related.length} client${related.length === 1 ? "" : "s"} · ${item.status}`,
        relative: dueLabels(item.dueDate, todayKey).relative,
        urgent: dayDifference(item.dueDate, todayKey) <= 2,
      };
    }),
    serviceHealth: [...serviceScores.entries()]
      .map(([name, scores]) => ({ name, value: Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length) }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 4),
  };
}
