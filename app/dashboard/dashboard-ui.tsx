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
  sparkValues,
  tone,
  value,
}: {
  icon: DashboardIconName;
  label: string;
  note: string;
  onClick?: () => void;
  pressed?: boolean;
  sparkValues?: number[];
  tone: "red" | "amber" | "blue" | "mint";
  value: string;
}) {
  const sparkMaximum = Math.max(1, ...(sparkValues ?? []));
  const contents = (
    <>
      <span className={`kpi-icon tone-${tone}`}><DashboardIcon name={icon} /></span>
      <span className="kpi-copy">
        <span className="kpi-label">{label}</span>
        <strong className="kpi-value">{value}</strong>
        <span className="kpi-note">{note}</span>
      </span>
      {sparkValues && sparkValues.length > 0 && <span className={`kpi-spark tone-${tone}`} aria-hidden="true">
        {sparkValues.map((metric, index) => <i key={index} style={{ height: `${Math.max(4, (metric / sparkMaximum) * 100)}%` }} />)}
      </span>}
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

/**
 * An empty region explains why it is empty and what to do about it.
 *
 * "No results" alone leaves the reader guessing whether the filter is too tight,
 * the data has not arrived, or the feature is unused — so a title names the
 * state, the description names the next move, and an optional action performs
 * it. Distinct from a loading skeleton: this is a settled answer, not a wait.
 */
export function EmptyState({
  action,
  description,
  icon = "search",
  title,
}: {
  action?: ReactNode;
  description?: string;
  icon?: DashboardIconName;
  title: string;
}) {
  return (
    <div className="empty-state">
      <span className="empty-state-icon"><DashboardIcon name={icon} size={20} /></span>
      <strong>{title}</strong>
      {description && <p>{description}</p>}
      {action && <div className="empty-state-action">{action}</div>}
    </div>
  );
}
