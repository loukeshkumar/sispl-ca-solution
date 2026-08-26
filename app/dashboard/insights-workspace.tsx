"use client";

import { AlertTriangle, CircleCheck, Info, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import type { InsightsWorkspaceData } from "../../lib/insights/repository";
import type { SignalCategory, SignalSeverity } from "../../lib/insights/signals";
import { KpiCard, PageTitle } from "./dashboard-ui";

const categoryLabels: Record<SignalCategory, string> = {
  delivery: "Delivery",
  receivables: "Receivables",
  clients: "Clients",
  team: "Team",
  registers: "Registers",
};

const severityIcon: Record<SignalSeverity, typeof Info> = {
  critical: AlertTriangle,
  warning: TriangleAlert,
  info: Info,
};

const filters = ["All", "Critical", "Warning", "Info"] as const;

export function InsightsWorkspace({ data }: { data: InsightsWorkspaceData }) {
  const [filter, setFilter] = useState<typeof filters[number]>("All");
  const visible = useMemo(
    () => data.signals.filter((signal) => filter === "All" || signal.severity === filter.toLowerCase()),
    [data.signals, filter],
  );

  return <section className="insights-workspace">
    <PageTitle
      description="Signals computed from the firm's own records. Each one names the evidence behind it so it can be verified, not just trusted."
      eyebrow="PRACTICE INTELLIGENCE"
      title="Insights"
    />

    <section className="package-kpi-grid kpi-grid">
      <KpiCard icon="alert" label="CRITICAL" note="Needs attention today" tone="red" value={String(data.counts.critical).padStart(2, "0")} />
      <KpiCard icon="clock" label="WARNING" note="Slipping but recoverable" tone="amber" value={String(data.counts.warning).padStart(2, "0")} />
      <KpiCard icon="insights" label="INFORMATIONAL" note="Worth reviewing" tone="blue" value={String(data.counts.info).padStart(2, "0")} />
      <KpiCard icon="compliance" label="AS AT" note="Signals recomputed on load" tone="mint" value={data.todayKey} />
    </section>

    <section className="surface-card insights-panel">
      <div className="package-register-toolbar">
        <div className="service-status-filter" role="group" aria-label="Signal severity filter">
          {filters.map((name) => (
            <button aria-pressed={filter === name} key={name} onClick={() => setFilter(name)} type="button">{name}</button>
          ))}
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="package-empty-state">
          <CircleCheck aria-hidden="true" />
          <strong>{data.signals.length === 0 ? "No signals raised" : `No ${filter.toLowerCase()} signals`}</strong>
          <p>{data.signals.length === 0 ? "Nothing in delivery, receivables, clients, team effort, or the registers is flagging today." : "Try a different severity."}</p>
        </div>
      ) : (
        <ul className="insight-list">
          {visible.map((signal) => {
            const Icon = severityIcon[signal.severity];
            return (
              <li className={`insight-item is-${signal.severity}`} key={signal.id}>
                <span className="insight-icon"><Icon aria-hidden="true" /></span>
                <div className="insight-body">
                  <div className="insight-heading">
                    <strong>{signal.title}</strong>
                    <span className="insight-category">{categoryLabels[signal.category]}</span>
                  </div>
                  <p>{signal.detail}</p>
                  <small className="insight-evidence">{signal.evidence}</small>
                </div>
                {signal.actionHref && <Link className="row-action-link" href={signal.actionHref}>Open</Link>}
              </li>
            );
          })}
        </ul>
      )}
    </section>

    <p className="package-control-note-text">
      Signals are deterministic rules over current records, recomputed each time this page loads. They are not predictions and
      they do not replace review.
    </p>
  </section>;
}
