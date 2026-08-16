import type { ReactNode } from "react";

import type { DashboardData } from "../../lib/dashboard/types";
import { DashboardIcon, type DashboardIconName } from "./dashboard-icons";
import { InitialsAvatar, ProgressBar } from "./dashboard-ui";

const navigation: Array<{ icon: DashboardIconName; label: string }> = [
  { icon: "overview", label: "Overview" },
  { icon: "work", label: "My work" },
  { icon: "clients", label: "Clients" },
  { icon: "compliance", label: "Compliance" },
  { icon: "documents", label: "Documents" },
  { icon: "calendar", label: "Calendar" },
  { icon: "team", label: "Team" },
  { icon: "billing", label: "Billing" },
  { icon: "insights", label: "Insights" },
];

function SidebarContent({
  active,
  data,
  onClose,
  onNavigate,
}: {
  active: string;
  data: DashboardData;
  onClose: () => void;
  onNavigate: (destination: string) => void;
}) {
  return (
    <div className="sidebar-content">
      <div className="brand-row">
        <span className="brand-mark">S</span>
        <span className="brand-copy"><strong>SISPL</strong><small>CA SOLUTION</small></span>
        <button aria-label="Close navigation" className="sidebar-close icon-button" onClick={onClose} type="button">
          <DashboardIcon name="close" />
        </button>
      </div>

      <div className="firm-summary">
        <InitialsAvatar initials={data.practice.initials} />
        <span className="firm-summary-copy"><small>ACTIVE FIRM</small><strong>{data.practice.name}</strong><span>{data.practice.subtitle}</span></span>
        <DashboardIcon name="chevron" size={16} />
      </div>

      <p className="sidebar-section-label">MAIN MENU</p>
      <nav aria-label="Workspace navigation" className="sidebar-nav">
        {navigation.map((item) => (
          <button
            aria-current={active === item.label ? "page" : undefined}
            aria-label={item.label}
            className={`sidebar-nav-button ${active === item.label ? "is-active" : ""}`}
            key={item.label}
            onClick={() => onNavigate(item.label)}
            title={item.label}
            type="button"
          >
            <DashboardIcon name={item.icon} />
            <span>{item.label}</span>
            {item.label === "My work" && <em>{data.metrics.attentionNeeded}</em>}
          </button>
        ))}
      </nav>

      <section className="practice-health-card">
        <span className="practice-health-icon"><DashboardIcon name="insights" /></span>
        <strong>Practice health</strong>
        <p>Relationship health across the active client portfolio.</p>
        <div className="practice-health-progress">
          <ProgressBar label="Practice health" value={data.metrics.averageHealth} />
          <b>{data.metrics.averageHealth}%</b>
        </div>
      </section>

      <div className="account-summary">
        <InitialsAvatar initials={data.practice.administratorInitials} tone="light" />
        <span><strong>{data.practice.administratorName}</strong><small>{data.practice.administratorRole}</small></span>
        <button aria-label="Account options" className="icon-button" disabled type="button">•••</button>
      </div>
    </div>
  );
}

function CommandBar({
  data,
  onMenuOpen,
  onQueryChange,
  query,
}: {
  data: DashboardData;
  onMenuOpen: () => void;
  onQueryChange: (value: string) => void;
  query: string;
}) {
  return (
    <header className="command-bar">
      <button aria-label="Open navigation" className="menu-button icon-button" onClick={onMenuOpen} type="button">
        <DashboardIcon name="menu" />
      </button>
      <label className="command-search">
        <DashboardIcon name="search" size={18} />
        <input
          aria-label="Search clients, tasks or owners"
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Search clients, tasks or owners..."
          type="search"
          value={query}
        />
        <kbd>Ctrl K</kbd>
      </label>
      <div className="command-actions">
        <button className="financial-year-button" disabled type="button">FY 2026–27 <DashboardIcon name="chevron" size={15} /></button>
        <button aria-label="Notifications" className="notification-button icon-button" disabled type="button">
          <DashboardIcon name="bell" />
          {data.metrics.attentionNeeded > 0 && <i aria-hidden="true" />}
        </button>
        <button className="create-button" disabled type="button"><DashboardIcon name="plus" size={18} /><span>Create new</span></button>
      </div>
    </header>
  );
}

export function DashboardShell({
  active,
  children,
  data,
  menuOpen,
  onMenuClose,
  onMenuOpen,
  onNavigate,
  onQueryChange,
  query,
}: {
  active: string;
  children: ReactNode;
  data: DashboardData;
  menuOpen: boolean;
  onMenuClose: () => void;
  onMenuOpen: () => void;
  onNavigate: (destination: string) => void;
  onQueryChange: (value: string) => void;
  query: string;
}) {
  return (
    <main className="dashboard-shell">
      <aside aria-label="Primary navigation" className={`dashboard-sidebar ${menuOpen ? "is-open" : ""}`}>
        <SidebarContent active={active} data={data} onClose={onMenuClose} onNavigate={onNavigate} />
      </aside>
      {menuOpen && <button aria-label="Close navigation" className="nav-backdrop" onClick={onMenuClose} type="button" />}
      <section className="dashboard-workspace">
        <CommandBar data={data} onMenuOpen={onMenuOpen} onQueryChange={onQueryChange} query={query} />
        <div className="workspace-canvas">{children}</div>
      </section>
    </main>
  );
}
