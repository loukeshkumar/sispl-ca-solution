import type { DashboardClient, DashboardWorkItem, WorkStatus } from "./types";

export type WorkFilter = "All" | "Overdue" | "Due this week" | WorkStatus;
export type ClientHealthFilter = "All clients" | "Healthy" | "Need attention" | "Watch" | "Critical";

/**
 * Whole days from today to a due date; negative when it has passed.
 *
 * Parsed at midnight UTC so the answer does not change with the reader's
 * timezone — a deadline is a date, not a moment.
 */
export const dayDifference = (dateKey: string, todayKey: string) => (
  (Date.parse(`${dateKey}T00:00:00Z`) - Date.parse(`${todayKey}T00:00:00Z`)) / 86_400_000
);

export function matchesWorkFilter(item: Pick<DashboardWorkItem, "dueDate" | "status">, filter: WorkFilter, todayKey: string) {
  const dueInDays = dayDifference(item.dueDate, todayKey);
  return filter === "All"
    || (filter === "Overdue" && dueInDays < 0)
    || (filter === "Due this week" && dueInDays >= 0 && dueInDays <= 7)
    || item.status === filter;
}

export function matchesClientHealthFilter(client: Pick<DashboardClient, "risk">, filter: ClientHealthFilter) {
  return filter === "All clients"
    || (filter === "Need attention" ? client.risk !== "Healthy" : client.risk === filter);
}
