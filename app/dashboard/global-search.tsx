"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";

import type { SearchHit } from "../../lib/search/repository";
import { searchAction } from "../search/actions";
import { DashboardIcon } from "./dashboard-icons";

const GROUP_ORDER = ["Clients", "Work", "Tasks", "Documents", "Invoices", "Employees"] as const;

/**
 * One search box for the whole application.
 *
 * Every record type the reader may open is queried at once and grouped, so the
 * header is the way into any record rather than a filter on whichever workspace
 * happens to be showing. Entitlement is decided on the server from the session;
 * this component never says what it is allowed to see.
 */
export function GlobalSearch() {
  const router = useRouter();
  const listId = useId();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  // Every keystroke starts a request; only the newest one may write to state.
  const latest = useRef(0);

  useEffect(() => {
    const term = query.trim();
    const ticket = (latest.current += 1);
    // Typing is faster than the database; waiting a beat avoids a query per key.
    // Every state write lives inside this callback, so the effect itself never
    // sets state synchronously and cannot cascade a render.
    const timer = setTimeout(() => {
      if (term.length < 2) {
        if (latest.current === ticket) { setHits([]); setBusy(false); }
        return;
      }
      setBusy(true);
      searchAction(term)
        .then((results) => {
          if (latest.current !== ticket) return;
          setHits(results);
          setHighlighted(0);
        })
        .catch(() => { if (latest.current === ticket) setHits([]); })
        .finally(() => { if (latest.current === ticket) setBusy(false); });
    }, 180);
    return () => clearTimeout(timer);
  }, [query]);

  // A click anywhere else dismisses the panel, the way every other menu does.
  useEffect(() => {
    if (!open) return;
    const handler = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const grouped = GROUP_ORDER
    .map((group) => ({ group, items: hits.filter((hit) => hit.group === group) }))
    .filter((section) => section.items.length > 0);
  const flat = grouped.flatMap((section) => section.items);

  const go = (hit: SearchHit) => {
    setOpen(false);
    setQuery("");
    setHits([]);
    router.push(hit.href);
  };

  const showPanel = open && query.trim().length >= 2;

  return (
    <div className="global-search" ref={containerRef}>
      <label className="command-search">
        <DashboardIcon name="search" size={18} />
        <input
          aria-activedescendant={showPanel && flat[highlighted] ? `${listId}-${flat[highlighted].id}` : undefined}
          aria-autocomplete="list"
          aria-controls={listId}
          aria-expanded={showPanel}
          aria-label="Search clients, work, tasks, documents, invoices and people"
          autoComplete="off"
          onChange={(event) => { setQuery(event.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={(event) => {
            if (event.key === "Escape") { setOpen(false); return; }
            if (!flat.length) return;
            if (event.key === "ArrowDown") { event.preventDefault(); setHighlighted((current) => (current + 1) % flat.length); }
            else if (event.key === "ArrowUp") { event.preventDefault(); setHighlighted((current) => (current - 1 + flat.length) % flat.length); }
            else if (event.key === "Enter") { event.preventDefault(); go(flat[highlighted]); }
          }}
          placeholder="Search anything — clients, work, tasks, invoices…"
          ref={inputRef}
          role="combobox"
          type="search"
          value={query}
        />
        {busy && <span aria-hidden="true" className="global-search-busy" />}
      </label>

      {showPanel && (
        <div className="global-search-panel" id={listId} role="listbox">
          {!flat.length && !busy && <p className="global-search-empty">Nothing matches “{query.trim()}”.</p>}
          {grouped.map((section) => (
            <div className="global-search-group" key={section.group}>
              <p className="global-search-group-label">{section.group}</p>
              {section.items.map((hit) => {
                const index = flat.indexOf(hit);
                return (
                  <button
                    aria-selected={index === highlighted}
                    className={`global-search-hit ${index === highlighted ? "is-highlighted" : ""}`}
                    id={`${listId}-${hit.id}`}
                    key={hit.id}
                    onClick={() => go(hit)}
                    onMouseEnter={() => setHighlighted(index)}
                    role="option"
                    type="button"
                  >
                    <strong>{hit.title}</strong>
                    <small>{hit.meta}</small>
                  </button>
                );
              })}
            </div>
          ))}
          <p className="global-search-hint"><kbd>↑</kbd><kbd>↓</kbd> to move · <kbd>Enter</kbd> to open · <kbd>Esc</kbd> to close</p>
        </div>
      )}
    </div>
  );
}
