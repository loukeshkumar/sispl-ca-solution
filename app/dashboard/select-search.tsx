"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Below this, the native menu is faster than typing. Yes/no and four-way
 * choices stay native; anything that is really a list becomes searchable.
 * A select can override the rule with `data-search="always"` or `"never"`.
 */
const MIN_OPTIONS = 5;

type Choice = { disabled: boolean; label: string; value: string };
type Target = { choices: Choice[]; label: string; select: HTMLSelectElement };

/**
 * React tracks the last value it wrote to an input and ignores a change event
 * when the DOM still appears to hold it. Assigning through the prototype setter
 * bypasses that per-element tracker, so React sees a genuine change and the
 * form's own `onChange` runs exactly as if a person had used the native menu.
 */
function commitValue(select: HTMLSelectElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
  if (setter) setter.call(select, value);
  else select.value = value;
  select.dispatchEvent(new Event("input", { bubbles: true }));
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

function eligible(select: HTMLSelectElement): boolean {
  if (select.disabled || select.multiple || select.size > 1) return false;
  const mode = select.dataset.search;
  if (mode === "never") return false;
  if (mode === "always") return true;
  return select.options.length >= MIN_OPTIONS;
}

/** The visible label for the control, so the panel can name what is being chosen. */
function labelFor(select: HTMLSelectElement): string {
  if (select.getAttribute("aria-label")) return select.getAttribute("aria-label") ?? "";
  const wrapping = select.closest("label")?.querySelector("span");
  if (wrapping?.textContent) return wrapping.textContent.trim();
  const described = select.id ? document.querySelector(`label[for="${CSS.escape(select.id)}"]`) : null;
  return described?.textContent?.trim() ?? "Choose an option";
}

function read(select: HTMLSelectElement): Choice[] {
  return Array.from(select.options).map((option) => ({
    disabled: option.disabled,
    label: option.textContent?.trim() ?? option.value,
    value: option.value,
  }));
}

/**
 * Makes every long dropdown in the application searchable.
 *
 * Mounted once, it listens on the document rather than wrapping each control,
 * so the 73 existing selects and every one added later behave the same with no
 * per-form work. The native `<select>` stays in the DOM and remains the value
 * the form submits — this only replaces the *menu*, so validation, server
 * actions and the browser's own autofill are untouched.
 */
export function SelectSearch() {
  const [target, setTarget] = useState<Target | null>(null);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // Held in a ref so dismissal never has to reach into a state updater, which
  // React may run twice and which must stay free of side effects.
  const openFor = useRef<HTMLSelectElement | null>(null);
  const swallowClick = useRef(false);

  const open = useCallback((select: HTMLSelectElement, initialQuery = "") => {
    select.focus({ preventScroll: true });
    setQuery(initialQuery);
    setHighlighted(0);
    openFor.current = select;
    setAnchor(select.getBoundingClientRect());
    setTarget({ choices: read(select), label: labelFor(select), select });
  }, []);

  const close = useCallback((restoreFocus = true) => {
    const select = openFor.current;
    openFor.current = null;
    setTarget(null);
    setAnchor(null);
    setQuery("");
    if (restoreFocus) select?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      const node = event.target as HTMLElement | null;
      /*
       * Dismissal is handled here rather than with a covering backdrop element.
       * A backdrop appears between mousedown and mouseup, and the browser then
       * fires the click on the nearest common ancestor of the two — the
       * <dialog> — which its own backdrop-close handler read as "clicked
       * outside" and used to shut the whole modal.
       */
      if (openFor.current && !panelRef.current?.contains(node)) {
        // The click that follows belongs to this dismissal, not to whatever is
        // underneath, or a modal would close along with the panel.
        swallowClick.current = true;
        close();
        return;
      }
      const select = node?.closest?.("select");
      if (!(select instanceof HTMLSelectElement) || !eligible(select)) return;
      // Suppress the native menu so the two do not open on top of each other.
      event.preventDefault();
      open(select);
    };

    const onClickCapture = (event: MouseEvent) => {
      if (!swallowClick.current) return;
      swallowClick.current = false;
      event.preventDefault();
      event.stopPropagation();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      const select = event.target;
      if (!(select instanceof HTMLSelectElement) || !eligible(select)) return;
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
        event.preventDefault();
        open(select);
        return;
      }
      // Typing a character goes straight into the filter, as it would in the
      // native menu — except here it searches the whole label, not just the start.
      if (event.key.length === 1 && /\S/.test(event.key)) {
        event.preventDefault();
        open(select, event.key);
      }
    };

    document.addEventListener("mousedown", onPointerDown, true);
    document.addEventListener("click", onClickCapture, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("mousedown", onPointerDown, true);
      document.removeEventListener("click", onClickCapture, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [close, open]);

  /*
   * The panel is positioned against the viewport, so anything that moves the
   * control underneath it has to move the panel too. Following the control is
   * better than dismissing: a capture-phase scroll listener on `window` also
   * receives scrolls from inside the panel's own option list, so dismissing on
   * any scroll made the panel close the moment someone scrolled it.
   */
  useEffect(() => {
    if (!target) return;
    const follow = (event: Event) => {
      if (panelRef.current?.contains(event.target as Node)) return;
      if (!target.select.isConnected) return close(false);
      const rect = target.select.getBoundingClientRect();
      // Scrolled out of sight: there is no longer anything to anchor to.
      if (rect.bottom < 0 || rect.top > window.innerHeight) return close(false);
      setAnchor(rect);
    };
    window.addEventListener("resize", follow);
    window.addEventListener("scroll", follow, true);
    return () => {
      window.removeEventListener("resize", follow);
      window.removeEventListener("scroll", follow, true);
    };
  }, [close, target]);

  /*
   * `preventScroll` matters here: focusing the field would otherwise scroll it
   * into view, and that scroll was itself being read as "the page moved, close
   * the panel" — so the panel dismissed itself the instant it opened.
   */
  useEffect(() => {
    if (target) inputRef.current?.focus({ preventScroll: true });
  }, [target]);

  const matches = useMemo(() => {
    if (!target) return [];
    const needle = query.trim().toLowerCase();
    return needle ? target.choices.filter((choice) => choice.label.toLowerCase().includes(needle)) : target.choices;
  }, [query, target]);

  if (!target || !anchor) return null;

  const choose = (choice: Choice) => {
    if (choice.disabled) return;
    commitValue(target.select, choice.value);
    close();
  };

  const selectable = matches.filter((choice) => !choice.disabled);
  const active = selectable[highlighted];
  const move = (delta: number) => {
    if (!selectable.length) return;
    setHighlighted((current) => (current + delta + selectable.length) % selectable.length);
  };

  // Anchored below the control, flipped above when there is no room.
  const spaceBelow = window.innerHeight - anchor.bottom;
  const flip = spaceBelow < 280 && anchor.top > spaceBelow;
  const style = {
    left: Math.max(12, Math.min(anchor.left, window.innerWidth - Math.max(anchor.width, 260) - 12)),
    minWidth: Math.max(anchor.width, 260),
    ...(flip ? { bottom: window.innerHeight - anchor.top + 6 } : { top: anchor.bottom + 6 }),
  };

  const panel = (
    <div className="select-search-panel" ref={panelRef} style={style}>
        <label className="select-search-field">
          <span className="sr-only">{`Search ${target.label}`}</span>
          <input
            aria-activedescendant={active ? `select-search-${active.value || "blank"}` : undefined}
            aria-controls="select-search-list"
            aria-expanded="true"
            aria-label={`Search ${target.label}`}
            autoComplete="off"
            onChange={(event) => { setQuery(event.target.value); setHighlighted(0); }}
            onKeyDown={(event) => {
              if (event.key === "Escape") { event.preventDefault(); close(); }
              else if (event.key === "ArrowDown") { event.preventDefault(); move(1); }
              else if (event.key === "ArrowUp") { event.preventDefault(); move(-1); }
              else if (event.key === "Enter") { event.preventDefault(); if (active) choose(active); }
              else if (event.key === "Tab") close();
            }}
            placeholder={`Search ${target.label.toLowerCase()}…`}
            ref={inputRef}
            role="combobox"
            type="text"
            value={query}
          />
        </label>
        <ul className="select-search-list" id="select-search-list" role="listbox">
          {matches.map((choice) => {
            const index = selectable.indexOf(choice);
            return (
              <li key={choice.value || `blank-${choice.label}`}>
                <button
                  aria-selected={choice.value === target.select.value}
                  className={`select-search-option ${index >= 0 && index === highlighted ? "is-highlighted" : ""} ${choice.disabled ? "is-disabled" : ""}`}
                  disabled={choice.disabled}
                  id={`select-search-${choice.value || "blank"}`}
                  onClick={() => choose(choice)}
                  onMouseEnter={() => { if (index >= 0) setHighlighted(index); }}
                  role="option"
                  type="button"
                >
                  {choice.label}
                  {choice.value === target.select.value && <em aria-hidden="true">Selected</em>}
                </button>
              </li>
            );
          })}
          {!matches.length && <li className="select-search-empty">No option matches “{query.trim()}”.</li>}
      </ul>
    </div>
  );

  /*
   * A modal <dialog> renders in the top layer, above every z-index, so a panel
   * appended to <body> would be hidden behind it. Rendering inside the open
   * dialog keeps the panel with its control.
   */
  const host = target.select.closest("dialog[open]") ?? document.body;
  return createPortal(panel, host);
}
