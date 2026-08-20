import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";

import type { DashboardData } from "../lib/dashboard/types";

const data: DashboardData = {
  source: "postgres",
  generatedAt: "2026-08-16T08:00:00.000Z",
  todayKey: "2026-08-16",
  titleDate: "16 Aug 2026",
  practice: {
    name: "Sharma & Kumar",
    legalName: "Sharma & Kumar",
    initials: "SK",
    subtitle: "Chartered Accountants",
    administratorName: "Loukesh Kumar",
    administratorRole: "Firm Administrator",
    administratorInitials: "LK",
    activeTeamMembers: 5,
  },
  metrics: {
    clientGroups: 3,
    legalEntities: 4,
    gstRegistrations: 6,
    healthyPercentage: 50,
    attentionClients: 2,
    criticalClients: 1,
    overdue: 1,
    dueThisWeek: 2,
    waitingOnClient: 1,
    pendingReview: 1,
    completed: 1,
    onTimeRate: 50,
    attentionNeeded: 3,
    averageHealth: 75,
  },
  clients: [],
  work: [
    { id: "1", client: "Alpha", initials: "A", service: "TDS", period: "Q1", owner: "R", ownerInitials: "R", due: "15 Aug", dueDetail: "Overdue", dueDate: "2026-08-15", status: "Critical", note: "", progress: 60, color: "violet" },
    { id: "2", client: "Beta", initials: "B", service: "TDS", period: "Q4", owner: "R", ownerInitials: "R", due: "1 Apr", dueDetail: "Done", dueDate: "2026-04-01", status: "Completed", note: "", progress: 100, color: "blue" },
    { id: "3", client: "Gamma", initials: "G", service: "GST", period: "Jul", owner: "N", ownerInitials: "N", due: "Today", dueDetail: "Today", dueDate: "2026-08-16", status: "Waiting", note: "", progress: 40, color: "orange" },
    { id: "4", client: "Delta", initials: "D", service: "GST", period: "Jul", owner: "N", ownerInitials: "N", due: "20 Aug", dueDetail: "4 days", dueDate: "2026-08-20", status: "Review", note: "", progress: 80, color: "green" },
    { id: "5", client: "Echo", initials: "E", service: "Books", period: "Aug", owner: "P", ownerInitials: "P", due: "30 Aug", dueDetail: "14 days", dueDate: "2026-08-30", status: "At risk", note: "", progress: 20, color: "violet" },
  ],
  deadlines: [],
  serviceHealth: [
    { name: "TDS", value: 80 },
    { name: "GST", value: 90 },
    { name: "Books", value: 70 },
    { name: "Audit", value: 95 },
  ],
};

test("dashboard analytics group live service health and active assignment progress", async () => {
  assert.ok(existsSync("lib/dashboard/analytics.ts"), "analytics module should exist");
  const { buildServicePerformance, buildWorkStatusDistribution } = await import("../lib/dashboard/analytics");

  assert.deepEqual(buildServicePerformance(data), [
    { service: "Books", health: 70, progress: 20, assignments: 1 },
    { service: "GST", health: 90, progress: 60, assignments: 2 },
    { service: "TDS", health: 80, progress: 60, assignments: 1 },
  ]);
  assert.deepEqual(buildWorkStatusDistribution(data), [
    { status: "Critical", value: 1 },
    { status: "At risk", value: 1 },
    { status: "Waiting", value: 1 },
    { status: "Review", value: 1 },
    { status: "Completed", value: 1 },
  ]);

  const partialHealth = buildServicePerformance({
    ...data,
    serviceHealth: data.serviceHealth.filter((service) => service.name !== "Books"),
  });
  assert.equal(partialHealth.find((service) => service.service === "Books")?.health, null);
});

test("dashboard analytics derive deadline pressure and clamped gauges without fake history", async () => {
  assert.ok(existsSync("lib/dashboard/analytics.ts"), "analytics module should exist");
  const { buildDeadlinePressure, buildGaugeMetrics } = await import("../lib/dashboard/analytics");

  assert.deepEqual(buildDeadlinePressure(data), [
    { label: "Overdue", value: 1 },
    { label: "Today", value: 1 },
    { label: "Next 7 days", value: 1 },
    { label: "Later", value: 1 },
  ]);
  assert.deepEqual(buildGaugeMetrics(data), [
    { label: "Portfolio health", value: 75, detail: "Average client health" },
    { label: "Overdue ratio", value: 25, detail: "1 of 4 active items" },
    { label: "On-time rate", value: 50, detail: "Current open work" },
  ]);

  assert.deepEqual(buildDeadlinePressure({ ...data, work: [] }), [
    { label: "Overdue", value: 0 },
    { label: "Today", value: 0 },
    { label: "Next 7 days", value: 0 },
    { label: "Later", value: 0 },
  ]);
  assert.equal(buildGaugeMetrics({ ...data, metrics: { ...data.metrics, averageHealth: 120, onTimeRate: -4, overdue: 0 }, work: [] })[0]?.value, 100);
});
