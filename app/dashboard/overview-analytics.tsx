"use client";

import { useEffect, useState } from "react";
import {
  Area,
  Bar,
  BarChart,
  Cell,
  ComposedChart,
  Pie,
  PieChart,
  RadialBar,
  RadialBarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  buildDeadlinePressure,
  buildGaugeMetrics,
  buildServicePerformance,
  buildWorkStatusDistribution,
} from "../../lib/dashboard/analytics";
import type { DashboardData } from "../../lib/dashboard/types";

const statusColors = [
  "var(--chart-critical)",
  "var(--chart-warning)",
  "var(--chart-waiting)",
  "var(--chart-review)",
  "var(--chart-complete)",
];

function useReducedMotion() {
  const [reducedMotion, setReducedMotion] = useState(true);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  return reducedMotion;
}

function AnalyticsHeading({ eyebrow, title, detail }: { eyebrow: string; title: string; detail: string }) {
  return (
    <header className="analytics-card-heading">
      <div><p className="eyebrow">{eyebrow}</p><h2>{title}</h2></div>
      <span>{detail}</span>
    </header>
  );
}

export function OverviewAnalytics({ data }: { data: DashboardData }) {
  const reducedMotion = useReducedMotion();
  const services = buildServicePerformance(data);
  const deadlines = buildDeadlinePressure(data);
  const statuses = buildWorkStatusDistribution(data);
  const gauges = buildGaugeMetrics(data);
  const tooltipStyle = {
    background: "var(--glass-strong)",
    border: "1px solid var(--glass-border)",
    borderRadius: "12px",
    boxShadow: "var(--shadow-card)",
    color: "var(--ink)",
  };

  return (
    <section aria-label="Practice analytics" className="overview-analytics">
      <article className="analytics-card service-performance-card surface-card">
        <AnalyticsHeading detail={`${services.length} active services`} eyebrow="BENCHMARK" title="Service performance" />
        {services.length > 0 ? <>
          <div aria-label="Service performance chart" className="analytics-chart analytics-chart-large" role="img">
            <ResponsiveContainer height="100%" width="100%">
              <ComposedChart data={services} margin={{ bottom: 0, left: -22, right: 10, top: 16 }}>
                <defs>
                  <linearGradient id="serviceProgressFill" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="var(--accent)" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <XAxis axisLine={false} dataKey="service" tick={{ fill: "var(--muted)", fontSize: 12 }} tickLine={false} />
                <YAxis axisLine={false} domain={[0, 100]} tick={{ fill: "var(--muted)", fontSize: 12 }} tickLine={false} />
                <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--chart-hover)" }} />
                <Bar dataKey="health" fill="var(--chart-bar)" isAnimationActive={!reducedMotion} name="Service health" radius={[7, 7, 2, 2]} />
                <Area dataKey="progress" fill="url(#serviceProgressFill)" isAnimationActive={!reducedMotion} name="Work progress" stroke="var(--accent)" strokeWidth={2.5} type="monotone" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <ul className="analytics-text-summary">
            {services.map((service) => <li key={service.service}><strong>{service.service}</strong><span>{service.health === null ? "Health unavailable" : `${service.health}% health`} · {service.progress}% progress · {service.assignments} active</span></li>)}
          </ul>
        </> : <p className="analytics-empty">No active service data is available.</p>}
      </article>

      <div className="analytics-side-stack">
        <article className="analytics-card surface-card">
          <AnalyticsHeading detail={`${data.metrics.attentionNeeded} open`} eyebrow="DEADLINES" title="Pressure horizon" />
          <div aria-label="Deadline pressure chart" className="analytics-chart analytics-chart-compact" role="img">
            <ResponsiveContainer height="100%" width="100%">
              <BarChart data={deadlines} margin={{ bottom: 0, left: -24, right: 4, top: 12 }}>
                <XAxis axisLine={false} dataKey="label" tick={{ fill: "var(--muted)", fontSize: 11 }} tickLine={false} />
                <YAxis allowDecimals={false} axisLine={false} tick={{ fill: "var(--muted)", fontSize: 11 }} tickLine={false} />
                <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--chart-hover)" }} />
                <Bar dataKey="value" fill="var(--chart-warning)" isAnimationActive={!reducedMotion} name="Work items" radius={[6, 6, 2, 2]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <ul aria-label="Deadline pressure values" className="deadline-chart-summary analytics-text-summary">
            {deadlines.map((deadline) => <li key={deadline.label}><span>{deadline.label}</span><strong>{deadline.value}</strong></li>)}
          </ul>
        </article>

        <article className="analytics-card status-distribution-card surface-card">
          <AnalyticsHeading detail={`${data.work.length} total`} eyebrow="WORKFLOW" title="Status distribution" />
          {statuses.length > 0 ? <div className="status-distribution-body">
            <div aria-label="Work status distribution chart" className="analytics-donut" role="img">
              <ResponsiveContainer height="100%" width="100%">
                <PieChart>
                  <Pie cx="50%" cy="50%" data={statuses} dataKey="value" innerRadius={42} isAnimationActive={!reducedMotion} nameKey="status" outerRadius={62} paddingAngle={3} stroke="none">
                    {statuses.map((status, index) => <Cell fill={statusColors[index % statusColors.length]} key={status.status} />)}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle} />
                </PieChart>
              </ResponsiveContainer>
              <span><strong>{data.metrics.attentionNeeded}</strong><small>open</small></span>
            </div>
            <ul className="status-chart-legend analytics-text-summary">
              {statuses.map((status, index) => <li key={status.status}><i style={{ background: statusColors[index % statusColors.length] }} /><span>{status.status}</span><strong>{status.value}</strong></li>)}
            </ul>
          </div> : <p className="analytics-empty">No work status data is available.</p>}
        </article>
      </div>

      <section aria-label="Practice performance gauges" className="analytics-gauge-grid">
        {gauges.map((gauge, index) => <article className="analytics-gauge surface-card" key={gauge.label}>
          <div className="gauge-visual" role="img" aria-label={`${gauge.label}: ${gauge.value}%`}>
            <ResponsiveContainer height="100%" width="100%">
              <RadialBarChart data={[{ value: gauge.value, fill: index === 1 ? "var(--chart-warning)" : "var(--accent)" }]} endAngle={-270} innerRadius="76%" outerRadius="100%" startAngle={90}>
                <RadialBar background={{ fill: "var(--chart-track)" }} cornerRadius={8} dataKey="value" isAnimationActive={!reducedMotion} />
              </RadialBarChart>
            </ResponsiveContainer>
            <strong>{gauge.value}%</strong>
          </div>
          <div><strong>{gauge.label}</strong><span>{gauge.detail}</span></div>
        </article>)}
      </section>
    </section>
  );
}
