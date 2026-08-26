import type { DashboardData, WorkStatus } from "./types";

export type ServicePerformancePoint = {
  service: string;
  health: number | null;
  progress: number;
  assignments: number;
};

export type WorkStatusPoint = { status: WorkStatus; value: number };
export type DeadlinePressurePoint = { label: "Overdue" | "Today" | "Next 7 days" | "Later"; value: number };
export type GaugeMetric = { label: string; value: number; detail: string };

const statusOrder: WorkStatus[] = ["Critical", "At risk", "Waiting", "Review", "Completed"];
const dayInMilliseconds = 86_400_000;

function clampPercentage(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
}

function dateKeyToTime(value: string) {
  const time = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(time) ? time : null;
}

export function buildServicePerformance(data: DashboardData): ServicePerformancePoint[] {
  const healthByService = new Map(data.serviceHealth.map((item) => [item.name, clampPercentage(item.value)]));
  const grouped = new Map<string, { progress: number; assignments: number }>();

  for (const item of data.work) {
    if (item.status === "Completed") continue;
    const current = grouped.get(item.service) ?? { progress: 0, assignments: 0 };
    current.progress += clampPercentage(item.progress);
    current.assignments += 1;
    grouped.set(item.service, current);
  }

  return Array.from(grouped, ([service, values]) => ({
    service,
    health: healthByService.get(service) ?? null,
    progress: clampPercentage(values.progress / values.assignments),
    assignments: values.assignments,
  })).sort((left, right) => left.service.localeCompare(right.service));
}

export function buildWorkStatusDistribution(data: DashboardData): WorkStatusPoint[] {
  return statusOrder.map((status) => ({
    status,
    value: data.work.filter((item) => item.status === status).length,
  })).filter((item) => item.value > 0);
}

export function buildDeadlinePressure(data: DashboardData): DeadlinePressurePoint[] {
  const today = dateKeyToTime(data.todayKey);
  const values: DeadlinePressurePoint[] = [
    { label: "Overdue", value: 0 },
    { label: "Today", value: 0 },
    { label: "Next 7 days", value: 0 },
    { label: "Later", value: 0 },
  ];
  if (today === null) return values;

  for (const item of data.work) {
    if (item.status === "Completed") continue;
    const due = dateKeyToTime(item.dueDate);
    if (due === null) continue;
    const difference = Math.round((due - today) / dayInMilliseconds);
    const index = difference < 0 ? 0 : difference === 0 ? 1 : difference <= 7 ? 2 : 3;
    values[index].value += 1;
  }
  return values;
}

export function buildGaugeMetrics(data: DashboardData): GaugeMetric[] {
  const active = data.work.filter((item) => item.status !== "Completed");
  const today = dateKeyToTime(data.todayKey);
  const overdue = today === null ? 0 : active.filter((item) => {
    const due = dateKeyToTime(item.dueDate);
    return due !== null && due < today;
  }).length;
  const overdueRatio = active.length ? (overdue / active.length) * 100 : 0;

  return [
    { label: "Portfolio health", value: clampPercentage(data.metrics.averageHealth), detail: "Average client health" },
    { label: "Overdue ratio", value: clampPercentage(overdueRatio), detail: `${overdue} of ${active.length} active items` },
    { label: "On-time rate", value: clampPercentage(data.metrics.onTimeRate), detail: "Current open work" },
  ];
}
