"use client";

import { useRef, useState, type ReactNode } from "react";

export type WorkspaceTab = {
  /** Shown as a count beside the label; omitted when zero. */
  badge?: number;
  content: ReactNode;
  id: string;
  label: string;
};

/**
 * Splits a workspace into views for one audience at a time.
 *
 * A page that stacks an employee's own record, the whole firm's register, and
 * the configuration behind both is three jobs in one scroll; the reader has to
 * work out which panels are theirs. Tabs make that decision once, up front.
 *
 * Follows the tabs pattern: arrow keys move between tabs, Home and End jump to
 * the ends, and only the selected tab is in the tab order, so Tab moves out of
 * the tablist and into the panel rather than through every other tab.
 */
export function WorkspaceTabs({ ariaLabel, defaultTab, tabs }: { ariaLabel: string; defaultTab?: string; tabs: WorkspaceTab[] }) {
  const [active, setActive] = useState(defaultTab ?? tabs[0]?.id ?? "");
  const listRef = useRef<HTMLDivElement>(null);

  const current = tabs.find((tab) => tab.id === active) ?? tabs[0];
  if (!current) return null;

  const move = (delta: number) => {
    const index = tabs.findIndex((tab) => tab.id === current.id);
    const next = tabs[(index + delta + tabs.length) % tabs.length];
    setActive(next.id);
    listRef.current?.querySelector<HTMLButtonElement>(`#tab-${next.id}`)?.focus();
  };

  const jump = (index: number) => {
    const next = tabs.at(index);
    if (!next) return;
    setActive(next.id);
    listRef.current?.querySelector<HTMLButtonElement>(`#tab-${next.id}`)?.focus();
  };

  return (
    <div className="workspace-tabs">
      <div
        aria-label={ariaLabel}
        className="workspace-tablist"
        onKeyDown={(event) => {
          if (event.key === "ArrowRight") { event.preventDefault(); move(1); }
          else if (event.key === "ArrowLeft") { event.preventDefault(); move(-1); }
          else if (event.key === "Home") { event.preventDefault(); jump(0); }
          else if (event.key === "End") { event.preventDefault(); jump(-1); }
        }}
        ref={listRef}
        role="tablist"
      >
        {tabs.map((tab) => (
          <button
            aria-controls={`panel-${tab.id}`}
            aria-selected={tab.id === current.id}
            className={`workspace-tab ${tab.id === current.id ? "is-active" : ""}`}
            id={`tab-${tab.id}`}
            key={tab.id}
            onClick={() => setActive(tab.id)}
            role="tab"
            tabIndex={tab.id === current.id ? 0 : -1}
            type="button"
          >
            {tab.label}
            {Boolean(tab.badge) && <em>{tab.badge}</em>}
          </button>
        ))}
      </div>
      <div aria-labelledby={`tab-${current.id}`} className="workspace-tabpanel" id={`panel-${current.id}`} role="tabpanel" tabIndex={0}>
        {current.content}
      </div>
    </div>
  );
}
