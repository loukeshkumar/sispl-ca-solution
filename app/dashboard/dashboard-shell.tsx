"use client";

import Link from "next/link";
import type { FocusEvent as ReactFocusEvent, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, ReactNode, RefObject } from "react";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import { logoutAction } from "../auth-actions";
import { roleLabel, type AuthViewer } from "../../lib/auth/authorization";
import { canOpenWorkspace } from "../../lib/dashboard/navigation";
import { ChangePasswordDialog } from "./change-password-dialog";
import { CommandPalette } from "./command-palette";
import { CreateMenu } from "./create-menu";
import { GlobalSearch } from "./global-search";
import type { DashboardData } from "../../lib/dashboard/types";
import { ThemeToggle } from "../theme/theme-toggle";
import { DashboardIcon, type DashboardIconName } from "./dashboard-icons";
import { InitialsAvatar, ProgressBar } from "./dashboard-ui";

/**
 * A destination. `href` marks one that is a real route rather than a workspace
 * switch, so it navigates as a link instead of through `onNavigate`.
 */
type NavLeaf = { href?: string; icon: DashboardIconName; label: string };
/** A collapsible parent. Its own label never routes, so it may not collide with a leaf. */
type NavGroup = { icon: DashboardIconName; items: NavLeaf[]; label: string };
type NavEntry = NavLeaf | NavGroup;

const isGroup = (entry: NavEntry): entry is NavGroup => "items" in entry;

/**
 * A labelled band of the menu. Fifteen destinations in one list is a wall to
 * scan, so each band also carries a hue that the workspace it leads to repeats:
 * colour tells you which part of the firm you are looking at.
 */
type NavSection = { entries: NavEntry[]; hue: "practice" | "delivery" | "clients" | "firm"; label: string };

/**
 * The sidebar tree.
 *
 * Grouped by what the reader is doing rather than by which module owns the
 * screen. Everything about a person — their record, attendance, pay, recorded
 * effort, and the masters those run on — sits under one parent, so people
 * operations is a single place to go; Settings keeps the commercial masters.
 */
const navigation: NavSection[] = [
  {
    entries: [
      { icon: "overview", label: "Overview" },
      { icon: "insights", label: "Insights" },
      { icon: "calendar", label: "Calendar" },
    ],
    hue: "practice",
    label: "PRACTICE",
  },
  {
    entries: [
      { icon: "work", label: "My work" },
      { icon: "work", label: "Tasks" },
      { icon: "todo", label: "To-do" },
      { icon: "compliance", label: "Compliance" },
      { icon: "documents", label: "Documents" },
      { icon: "documents", label: "Registers" },
    ],
    hue: "delivery",
    label: "DELIVERY",
  },
  {
    entries: [
      {
        icon: "clients",
        // The parent only toggles, so it cannot share the "Clients" routing label.
        items: [
          { icon: "clients", label: "Clients" },
          { icon: "documents", label: "Client Documents" },
        ],
        label: "Client Management",
      },
      { icon: "packageSetup", label: "Package Setup" },
      { icon: "clientPackages", label: "Client Packages" },
      { icon: "billing", label: "Billing" },
    ],
    hue: "clients",
    label: "CLIENTS & REVENUE",
  },
  {
    entries: [
      {
        icon: "team",
        // The day-to-day people workspaces. The masters that configure them are
        // configuration, so they sit with the other masters under Settings.
        items: [
          { icon: "team", label: "Employees" },
          { href: "/team/articleship", icon: "team", label: "Articleship" },
          { href: "/team/training", icon: "insights", label: "Training & CPE" },
          { href: "/team/performance", icon: "review", label: "Performance" },
          { icon: "attendance", label: "Attendance" },
          { icon: "salary", label: "Salary" },
          { icon: "clock", label: "Timesheets" },
        ],
        label: "Employee Management",
      },
      {
        icon: "settings",
        items: [
          { icon: "services", label: "Service Management" },
          { href: "/settings/procedures", icon: "compliance", label: "Work Procedures" },
          { href: "/settings/master-data", icon: "documents", label: "Master Data" },
          { href: "/settings/attendance", icon: "attendance", label: "Attendance Masters" },
          { href: "/settings/rates", icon: "billing", label: "Rate Card" },
          { href: "/settings/utilisation", icon: "insights", label: "Utilisation Targets" },
          { icon: "team", label: "User Roles Management" },
        ],
        label: "Settings",
      },
    ],
    hue: "firm",
    label: "FIRM",
  },
];

const allEntries: NavEntry[] = navigation.flatMap((section) => section.entries);

/** The palette searches destinations, not parents, so groups are flattened away. */
export const paletteDestinations: NavLeaf[] = allEntries.flatMap((entry) => (isGroup(entry) ? entry.items : [entry]));

/**
 * The route behind each destination that is a page rather than a workspace.
 * The sidebar renders those as links, but the palette and the `g` jumps report
 * a label, so both navigate handlers resolve it here instead of keeping their
 * own list — a route missing from that list used to land on the dashboard.
 */
export const destinationRoutes: Record<string, string> = Object.fromEntries(
  paletteDestinations.flatMap((leaf) => (leaf.href ? [[leaf.label, leaf.href]] : [])),
);

const SIDEBAR_STORAGE_KEY = "sispl-sidebar";
const SIDEBAR_CHANGE_EVENT = "sispl-sidebar-change";

function readSidebarMode() {
  return document.documentElement.dataset.sidebar === "rail";
}

/** The server has no viewport and no storage, so it renders the full sidebar. */
function readServerSidebarMode() {
  return false;
}

function subscribeSidebar(onStoreChange: () => void) {
  window.addEventListener(SIDEBAR_CHANGE_EVENT, onStoreChange);
  return () => window.removeEventListener(SIDEBAR_CHANGE_EVENT, onStoreChange);
}

function writeSidebarMode(mode: "rail" | "full") {
  document.documentElement.dataset.sidebar = mode;
  try {
    localStorage.setItem(SIDEBAR_STORAGE_KEY, mode);
  } catch {
    // The sidebar still resizes when browser storage is unavailable.
  }
  window.dispatchEvent(new Event(SIDEBAR_CHANGE_EVENT));
}

function SidebarContent({
  active,
  collapsed,
  data,
  onClose,
  onNavigate,
  onToggleCollapsed,
  viewer,
}: {
  active: string;
  collapsed: boolean;
  data: DashboardData;
  onClose: () => void;
  onNavigate: (destination: string) => void;
  onToggleCollapsed: () => void;
  viewer?: AuthViewer;
}) {
  const navRef = useRef<HTMLElement>(null);
  // Sections and groups are filtered once: a section with nothing left in it must
  // not leave a heading behind, and a group needs at least one openable child.
  const sections = navigation
    .map((section) => ({
      ...section,
      entries: section.entries
        .map((entry) => (isGroup(entry) ? { ...entry, items: entry.items.filter((item) => canOpenWorkspace(viewer, item.label)) } : entry))
        .filter((entry) => (isGroup(entry) ? entry.items.length > 0 : canOpenWorkspace(viewer, entry.label))),
    }))
    .filter((section) => section.entries.length > 0);

  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(
      sections
        .flatMap((section) => section.entries)
        .filter(isGroup)
        .map((group) => [group.label, group.items.some((item) => item.label === active)]),
    ),
  );

  const accountName = viewer?.fullName ?? data.practice.administratorName;
  const accountRole = viewer ? viewer.roleName ?? roleLabel(viewer.roleKey) : data.practice.administratorRole;
  const accountInitials = viewer
    ? viewer.fullName.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("")
    : data.practice.administratorInitials;

  /*
   * In the rail the icon is all there is, so pointing at or focusing a control
   * names it. Positioned against the viewport because the menu scrolls, and a
   * scroll container clips both axes.
   */
  const [tooltip, setTooltip] = useState<{ label: string; top: number } | null>(null);
  const showTooltip = (event: ReactMouseEvent<HTMLElement> | ReactFocusEvent<HTMLElement>) => {
    if (!collapsed) return;
    const target = (event.target as HTMLElement).closest<HTMLElement>("[data-tooltip]");
    const label = target?.dataset.tooltip;
    if (!target || !label) return setTooltip(null);
    const box = target.getBoundingClientRect();
    setTooltip({ label, top: box.top + box.height / 2 });
  };
  const hideTooltip = () => setTooltip(null);

  /**
   * Arrow keys walk the menu. Tab still reaches every item, so this is a
   * shortcut rather than a replacement: the list is long enough that tabbing
   * from the top down to Billing is tedious.
   */
  const moveFocus = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const items = Array.from(navRef.current?.querySelectorAll<HTMLElement>(".sidebar-nav-button") ?? [])
      .filter((item) => item.offsetParent !== null);
    if (!items.length) return;
    const current = items.indexOf(document.activeElement as HTMLElement);
    const next = event.key === "Home" ? 0
      : event.key === "End" ? items.length - 1
      : current < 0 ? 0
      : (current + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    event.preventDefault();
    items[next]?.focus();
  };

  return (
    <div
      className="sidebar-content"
      onBlur={hideTooltip}
      onFocus={showTooltip}
      onMouseLeave={hideTooltip}
      onMouseOver={showTooltip}
    >
      {/* Purely visual: every rail control already carries its own accessible name. */}
      {collapsed && tooltip && <div aria-hidden="true" className="sidebar-tooltip" style={{ top: tooltip.top }}>{tooltip.label}</div>}
      <div className="sidebar-head">
        <div className="brand-row">
          <span className="brand-mark">S</span>
          <span className="brand-copy"><strong>SISPL</strong><small>CA SOLUTION</small></span>
          <button
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-pressed={collapsed}
            className="sidebar-collapse-toggle"
            data-tooltip={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            onClick={onToggleCollapsed}
            type="button"
          >
            <DashboardIcon name="chevron" size={16} />
          </button>
          <button aria-label="Close navigation" className="sidebar-close icon-button" onClick={onClose} type="button">
            <DashboardIcon name="close" />
          </button>
        </div>

        <div className="firm-summary" data-tooltip={data.practice.name}>
          <InitialsAvatar initials={data.practice.initials} />
          <span className="firm-summary-copy"><small>ACTIVE FIRM</small><strong>{data.practice.name}</strong><span>{data.practice.subtitle}</span></span>
          <DashboardIcon name="chevron" size={16} />
        </div>
      </div>

      <nav aria-label="Workspace navigation" className="sidebar-nav" onKeyDown={moveFocus} ref={navRef}>
        {sections.map((section) => (
          <div className="sidebar-section" data-hue={section.hue} key={section.label}>
            <p className="sidebar-section-label">{section.label}</p>
            {section.entries.map((entry) => {
              if (!isGroup(entry)) {
                return (
                  <button
                    aria-current={active === entry.label ? "page" : undefined}
                    aria-label={entry.label}
                    className={`sidebar-nav-button ${active === entry.label ? "is-active" : ""}`}
                    data-tooltip={entry.label}
                    key={entry.label}
                    onClick={() => onNavigate(entry.label)}
                    type="button"
                  >
                    <DashboardIcon name={entry.icon} />
                    <span>{entry.label}</span>
                    {entry.label === "My work" && data.metrics.attentionNeeded > 0 && <em>{data.metrics.attentionNeeded}</em>}
                  </button>
                );
              }
              const groupId = `${entry.label.toLowerCase().replaceAll(" ", "-")}-navigation`;
              const open = openGroups[entry.label] ?? false;
              const holdsActive = entry.items.some((item) => item.label === active);
              return (
                <div className={`sidebar-nav-group ${open ? "is-open" : ""}`} key={entry.label}>
                  <button
                    aria-controls={groupId}
                    aria-expanded={open}
                    className={`sidebar-nav-button sidebar-nav-parent ${holdsActive ? "is-parent-active" : ""}`}
                    data-tooltip={entry.label}
                    onClick={() => setOpenGroups((current) => ({ ...current, [entry.label]: !open }))}
                    type="button"
                  >
                    <DashboardIcon name={entry.icon} />
                    <span>{entry.label}</span>
                    <DashboardIcon name="chevron" size={16} />
                  </button>
                  {/*
                    Closed children leave the accessibility tree and the tab order
                    entirely. In the rail the panel stays inline and indents under
                    its parent rather than flying out, which a scrolling menu would
                    clip.
                  */}
                  <div className="sidebar-subnav" hidden={!open} id={groupId}>
                    {entry.items.map((item) => (item.href ? (
                      <a
                        aria-current={active === item.label ? "page" : undefined}
                        className={`sidebar-nav-button sidebar-subnav-button ${active === item.label ? "is-active" : ""}`}
                        data-tooltip={item.label}
                        href={item.href}
                        key={item.label}
                      >
                        <DashboardIcon name={item.icon} />
                        <span>{item.label}</span>
                      </a>
                    ) : (
                      <button
                        aria-current={active === item.label ? "page" : undefined}
                        aria-label={item.label}
                        className={`sidebar-nav-button sidebar-subnav-button ${active === item.label ? "is-active" : ""}`}
                        key={item.label}
                        data-tooltip={item.label}
                        onClick={() => onNavigate(item.label)}
                        type="button"
                      >
                        <DashboardIcon name={item.icon} />
                        <span>{item.label}</span>
                      </button>
                    )))}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="sidebar-foot">
        <section className="practice-health-card">
          <span className="practice-health-icon"><DashboardIcon name="insights" /></span>
          <strong>Practice health</strong>
          <p>Relationship health across the active client portfolio.</p>
          <div className="practice-health-progress">
            <ProgressBar label="Practice health" value={data.metrics.averageHealth} />
            <b>{data.metrics.averageHealth}%</b>
          </div>
        </section>

        <div className="account-summary" data-tooltip={accountName}>
          <InitialsAvatar initials={accountInitials} tone="light" />
          <span><strong>{accountName}</strong><small>{accountRole}</small></span>
          {viewer ? (
            <div className="account-controls">
              <ChangePasswordDialog />
              <form action={logoutAction}><button className="account-signout" type="submit">Sign out</button></form>
            </div>
          ) : (
            <button aria-label="Account options" className="icon-button" disabled type="button">•••</button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * The Indian financial year runs April to March, so the label cannot be derived
 * from the calendar year alone. Taken from the dashboard's own "today" rather
 * than the browser clock, which would disagree with the data during a request
 * that crosses midnight or comes from another timezone.
 */
function financialYearLabel(todayKey: string): string {
  const [year, month] = todayKey.split("-").map(Number);
  const startYear = month >= 4 ? year : year - 1;
  return `FY ${startYear}–${String(startYear + 1).slice(-2)}`;
}

function CommandBar({
  data,
  menuOpen,
  menuButtonRef,
  onMenuOpen,
  unreadNotifications,
  viewer,
}: {
  data: DashboardData;
  menuOpen: boolean;
  menuButtonRef: RefObject<HTMLButtonElement | null>;
  onMenuOpen: () => void;
  unreadNotifications: number;
  viewer?: AuthViewer;
}) {
  return (
    <header className="command-bar">
      <button aria-controls="primary-navigation" aria-expanded={menuOpen} aria-label="Open navigation" className="menu-button icon-button" onClick={onMenuOpen} ref={menuButtonRef} type="button">
        <DashboardIcon name="menu" />
      </button>

      <GlobalSearch />

      <div className="command-actions">
        {/* Context, not a control: nothing in the application is scoped by it yet. */}
        <span className="financial-year-chip" title="Current Indian financial year">
          <DashboardIcon name="calendar" size={15} />
          {financialYearLabel(data.todayKey)}
        </span>
        {viewer ? (
          <Link
            aria-label={unreadNotifications > 0 ? `Notifications (${unreadNotifications} unread)` : "Notifications"}
            className="notification-button icon-button"
            href="/notifications"
          >
            <DashboardIcon name="bell" />
            {unreadNotifications > 0 && <em>{unreadNotifications > 99 ? "99+" : unreadNotifications}</em>}
          </Link>
        ) : (
          <button aria-label="Notifications" className="notification-button icon-button" disabled type="button">
            <DashboardIcon name="bell" />
          </button>
        )}
        <ThemeToggle />
        <CreateMenu viewer={viewer} />
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
  unreadNotifications = 0,
  viewer,
}: {
  active: string;
  children: ReactNode;
  data: DashboardData;
  menuOpen: boolean;
  onMenuClose: () => void;
  onMenuOpen: () => void;
  onNavigate: (destination: string) => void;
  unreadNotifications?: number;
  viewer?: AuthViewer;
}) {
  const sidebarRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const wasOpenRef = useRef(false);
  const closeRef = useRef(onMenuClose);

  useEffect(() => {
    closeRef.current = onMenuClose;
  }, [onMenuClose]);

  /*
   * The head script writes the width preference to the document before first
   * paint, so the document is the source of truth and React subscribes to it.
   * Deciding again in React would render the sidebar expanded and then snap it
   * to the rail, shifting the workspace sideways in front of the reader.
   */
  const collapsed = useSyncExternalStore(subscribeSidebar, readSidebarMode, readServerSidebarMode);

  const toggleCollapsed = useCallback(() => {
    writeSidebarMode(document.documentElement.dataset.sidebar === "rail" ? "full" : "rail");
  }, []);

  // "[" folds the sidebar away, the way an editor collapses its file tree.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key !== "[" || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName))) return;
      if (document.querySelector("dialog[open]")) return;
      event.preventDefault();
      toggleCollapsed();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [toggleCollapsed]);

  useEffect(() => {
    if (!menuOpen) {
      if (wasOpenRef.current) menuButtonRef.current?.focus();
      wasOpenRef.current = false;
      return;
    }
    wasOpenRef.current = true;
    const sidebar = sidebarRef.current;
    sidebar?.querySelector<HTMLButtonElement>(".sidebar-close")?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab" || !sidebar) return;
      const focusable = Array.from(sidebar.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'));
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [menuOpen]);

  return (
    <main className="dashboard-shell">
      <a className="skip-link" href="#workspace-content">Skip to main content</a>
      <aside aria-label="Primary navigation" className={`dashboard-sidebar ${menuOpen ? "is-open" : ""}`} id="primary-navigation" ref={sidebarRef}>
        <SidebarContent
          active={active}
          collapsed={collapsed}
          data={data}
          onClose={onMenuClose}
          onNavigate={onNavigate}
          onToggleCollapsed={toggleCollapsed}
          viewer={viewer}
        />
      </aside>
      {menuOpen && <button aria-label="Close navigation" className="nav-backdrop" onClick={onMenuClose} type="button" />}
      <section className="dashboard-workspace">
        <CommandBar data={data} menuButtonRef={menuButtonRef} menuOpen={menuOpen} onMenuOpen={onMenuOpen} unreadNotifications={unreadNotifications} viewer={viewer} />
        <div className="workspace-canvas" id="workspace-content" tabIndex={-1}>{children}</div>
        <CommandPalette destinations={paletteDestinations} onNavigate={onNavigate} viewer={viewer} />
      </section>
    </main>
  );
}
