"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type { AuthViewer } from "../../lib/auth/authorization";
import { canOpenWorkspace } from "../../lib/dashboard/navigation";
import { DashboardIcon, type DashboardIconName } from "./dashboard-icons";
import { FormDialog } from "./form-dialog";

export type PaletteDestination = { icon: DashboardIconName; label: string };

/** `g` then this key jumps straight to the workspace, the way mail clients do. */
const jumpKeys: Record<string, string> = {
  a: "Attendance",
  b: "Billing",
  c: "Clients",
  d: "Documents",
  e: "Employees",
  i: "Insights",
  o: "Overview",
  t: "Tasks",
  w: "My work",
};

const shortcutHelp: Array<{ description: string; keys: string[] }> = [
  { description: "Open the command palette", keys: ["Ctrl", "K"] },
  { description: "Open the command palette", keys: ["/"] },
  { description: "Jump to a workspace", keys: ["g", "then a letter"] },
  { description: "Show this list", keys: ["?"] },
  { description: "Close a dialog or the palette", keys: ["Esc"] },
];

/**
 * True when the keystroke belongs to whatever the user is typing into.
 *
 * Without this a single "/" while filling in a client's legal name would open
 * the palette and swallow the character.
 */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName);
}

/** A modal is already showing, so the page's own shortcuts must stay quiet. */
function modalIsOpen(): boolean {
  return Boolean(document.querySelector("dialog[open]"));
}

/**
 * Keyboard navigation for the whole application.
 *
 * Mounted once in the shell, so the shortcuts work on a workspace and on a 360
 * page alike. Every destination is filtered through the same permission rule the
 * sidebar uses, so the palette can never offer a workspace the viewer cannot open.
 */
export function CommandPalette({
  destinations,
  onNavigate,
  viewer,
}: {
  destinations: PaletteDestination[];
  onNavigate: (destination: string) => void;
  viewer?: AuthViewer;
}) {
  const [open, setOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const awaitingJump = useRef<ReturnType<typeof setTimeout> | null>(null);

  const allowed = useMemo(
    () => destinations.filter((item) => canOpenWorkspace(viewer, item.label)),
    [destinations, viewer],
  );
  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle ? allowed.filter((item) => item.label.toLowerCase().includes(needle)) : allowed;
  }, [allowed, query]);

  const go = (label: string) => {
    setOpen(false);
    setQuery("");
    onNavigate(label);
  };

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const typing = isTypingTarget(event.target);
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setQuery("");
        setHighlighted(0);
        setOpen(true);
        return;
      }
      if (typing || event.ctrlKey || event.metaKey || event.altKey) return;

      // A pending "g" turns the next letter into a jump instead of a shortcut.
      if (awaitingJump.current) {
        clearTimeout(awaitingJump.current);
        awaitingJump.current = null;
        const target = jumpKeys[event.key.toLowerCase()];
        if (target && canOpenWorkspace(viewer, target)) {
          event.preventDefault();
          onNavigate(target);
        }
        return;
      }
      if (modalIsOpen()) return;
      if (event.key === "g") {
        awaitingJump.current = setTimeout(() => { awaitingJump.current = null; }, 1200);
        return;
      }
      if (event.key === "/") {
        event.preventDefault();
        setQuery("");
        setHighlighted(0);
        setOpen(true);
        return;
      }
      if (event.key === "?") {
        event.preventDefault();
        setHelpOpen(true);
      }
    };
    document.addEventListener("keydown", handler);
    return () => {
      document.removeEventListener("keydown", handler);
      if (awaitingJump.current) clearTimeout(awaitingJump.current);
    };
  }, [onNavigate, viewer]);

  // FormDialog opens the dialog; opening it moves focus to the close button, so
  // the query field claims focus afterwards and typing starts straight away.
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const move = (delta: number) => {
    setHighlighted((current) => {
      if (!matches.length) return 0;
      return (current + delta + matches.length) % matches.length;
    });
  };

  return (
    <>
      <FormDialog
        description="Search workspaces, or press g then a letter to jump."
        onClose={() => setOpen(false)}
        open={open}
        title="Command palette"
      >
        <div className="command-palette">
          <input
            aria-activedescendant={matches[highlighted] ? `palette-${matches[highlighted].label.replaceAll(" ", "-")}` : undefined}
            aria-controls="command-palette-results"
            aria-expanded="true"
            aria-label="Search workspaces"
            autoComplete="off"
            className="command-palette-input"
            onChange={(event) => { setQuery(event.target.value); setHighlighted(0); }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") { event.preventDefault(); move(1); }
              else if (event.key === "ArrowUp") { event.preventDefault(); move(-1); }
              else if (event.key === "Enter" && matches[highlighted]) { event.preventDefault(); go(matches[highlighted].label); }
            }}
            placeholder="Go to…"
            ref={inputRef}
            role="combobox"
            type="text"
            value={query}
          />
          <ul className="command-palette-results" id="command-palette-results" ref={listRef} role="listbox">
            {matches.map((item, index) => (
              <li
                aria-selected={index === highlighted}
                className={index === highlighted ? "is-highlighted" : undefined}
                id={`palette-${item.label.replaceAll(" ", "-")}`}
                key={item.label}
                role="option"
              >
                <button onClick={() => go(item.label)} onMouseEnter={() => setHighlighted(index)} type="button">
                  <DashboardIcon name={item.icon} size={17} />
                  <span>{item.label}</span>
                </button>
              </li>
            ))}
            {!matches.length && <li className="command-palette-empty">No workspace matches “{query}”.</li>}
          </ul>
        </div>
      </FormDialog>

      <FormDialog
        description="These work anywhere except while you are typing in a field."
        onClose={() => setHelpOpen(false)}
        open={helpOpen}
        title="Keyboard shortcuts"
      >
        <dl className="shortcut-sheet">
          {shortcutHelp.map((shortcut) => (
            <div key={`${shortcut.description}-${shortcut.keys.join("+")}`}>
              <dt>{shortcut.keys.map((key) => <kbd key={key}>{key}</kbd>)}</dt>
              <dd>{shortcut.description}</dd>
            </div>
          ))}
          <div>
            <dt>{Object.keys(jumpKeys).map((key) => <kbd key={key}>g {key}</kbd>)}</dt>
            <dd>{Object.values(jumpKeys).join(", ")}</dd>
          </div>
        </dl>
      </FormDialog>
    </>
  );
}
