"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { PEEK_DEFINITIONS, PEEK_ROW_LIMIT, type PeekKind, type PeekResult } from "../../lib/registers/kpi-peek";
import { FormDialog } from "./form-dialog";

const dateFormatter = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "UTC" });
const formatDate = (value: string) => (value ? dateFormatter.format(new Date(`${value.slice(0, 10)}T00:00:00Z`)) : "—");

/**
 * The list behind one Registers headline figure, opened in place.
 *
 * The figures used to re-filter the whole workspace, which answered "which
 * ones?" by throwing away whatever the reader was already looking at. The panel
 * answers the same question without moving them, and still offers the register
 * itself as an explicit next step rather than as a side effect of a click.
 *
 * `rows` is supplied when the workspace already holds that register in full;
 * otherwise the panel fetches its own list, because a page load only ever
 * carries the register being viewed.
 */
export function RegisterKpiPeek({
  fullHref,
  kind,
  onClose,
  rows,
}: {
  fullHref: string;
  kind: PeekKind | null;
  onClose: () => void;
  rows: PeekResult | null;
}) {
  /**
   * Stamped with the figure it answers, so a reply that arrives after the reader
   * has moved to another figure is discarded by the render rather than needing
   * the effect to reset state and cascade a second render.
   */
  const [answer, setAnswer] = useState<{ error: string; kind: PeekKind; result: PeekResult | null } | null>(null);

  useEffect(() => {
    if (!kind || rows) return;
    const controller = new AbortController();
    fetch(`/registers/peek?kind=${kind}`, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error("unavailable"))))
      .then((result: PeekResult) => setAnswer({ error: "", kind, result }))
      // An aborted request is the panel closing, not a failure worth reporting.
      .catch(() => {
        if (!controller.signal.aborted) {
          setAnswer({ error: "This register could not be read. Reload the page and try again.", kind, result: null });
        }
      });
    return () => controller.abort();
  }, [kind, rows]);

  if (!kind) return null;
  const definition = PEEK_DEFINITIONS[kind];
  const fetched = answer?.kind === kind ? answer : null;
  const error = fetched?.error ?? "";
  const result = rows ?? fetched?.result ?? null;

  return (
    <FormDialog description={definition.description} onClose={onClose} open title={definition.title} width="wide">
      <div className="register-peek-shell">
        <div className="register-peek">
          {error ? <p className="register-peek-state" role="alert">{error}</p>
            : !result ? <p className="register-peek-state">Reading the register…</p>
              : result.rows.length === 0 ? <p className="register-peek-state">{definition.emptyNote}</p>
                : (
                  <ul className="register-peek-list">
                    {result.rows.map((row) => (
                      <li className={`register-peek-row is-${row.tone}`} key={row.id}>
                        {/* Straight at the entry, so the panel is a way in and not a dead end. */}
                        <Link href={row.href} onClick={onClose}>
                          <span><strong>{row.title}</strong><small>{row.subtitle}</small></span>
                          <span className="register-peek-detail">{row.detail || "—"}</span>
                          <span><strong>{formatDate(row.dateKey)}</strong><small>{row.note}</small></span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
        </div>
        <div className="register-peek-foot">
          <span>{result && result.total > result.rows.length
            ? `First ${PEEK_ROW_LIMIT} of ${result.total}`
            : result ? `${result.total} ${result.total === 1 ? "entry" : "entries"}` : ""}</span>
          <Link className="secondary-button" href={fullHref} onClick={onClose}>Open in the register</Link>
        </div>
      </div>
    </FormDialog>
  );
}
