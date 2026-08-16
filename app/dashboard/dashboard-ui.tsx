import type { ReactNode } from "react";

import { DashboardIcon, type DashboardIconName } from "./dashboard-icons";

export function PageTitle({
  actions,
  description,
  eyebrow,
  title,
}: {
  actions?: ReactNode;
  description: string;
  eyebrow: string;
  title: string;
}) {
  return (
    <section className="page-title-row">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1 className="page-title">{title}</h1>
        <p className="page-description">{description}</p>
      </div>
      {actions && <div className="page-title-actions">{actions}</div>}
    </section>
  );
}

export function KpiCard({
  icon,
  label,
  note,
  onClick,
  pressed,
  tone,
  value,
}: {
  icon: DashboardIconName;
  label: string;
  note: string;
  onClick?: () => void;
  pressed?: boolean;
  tone: "red" | "amber" | "blue" | "mint";
  value: string;
}) {
  const contents = (
    <>
      <span className={`kpi-icon tone-${tone}`}><DashboardIcon name={icon} /></span>
      <span className="kpi-copy">
        <span className="kpi-label">{label}</span>
        <strong className="kpi-value">{value}</strong>
        <span className="kpi-note">{note}</span>
      </span>
      <span className={`kpi-spark tone-${tone}`} aria-hidden="true">
        {[38, 54, 44, 72, 61].map((height, index) => <i key={index} style={{ height: `${height}%` }} />)}
      </span>
    </>
  );

  return onClick ? (
    <button aria-pressed={pressed} className="kpi-card" onClick={onClick} type="button">{contents}</button>
  ) : (
    <article className="kpi-card">{contents}</article>
  );
}

export function StatusBadge({ children, tone }: { children: ReactNode; tone: string }) {
  return <span className={`status-badge status-${tone.toLowerCase().replaceAll(" ", "-")}`}>{children}</span>;
}

export function ProgressBar({ label, value }: { label: string; value: number }) {
  const safeValue = Math.min(100, Math.max(0, value));
  return (
    <span
      aria-label={`${label}: ${safeValue}%`}
      aria-valuemax={100}
      aria-valuemin={0}
      aria-valuenow={safeValue}
      className="progress-bar"
      role="progressbar"
    >
      <i style={{ width: `${safeValue}%` }} />
    </span>
  );
}

export function InitialsAvatar({ initials, tone = "violet" }: { initials: string; tone?: string }) {
  return <span aria-hidden="true" className={`initials-avatar avatar-${tone}`}>{initials}</span>;
}
