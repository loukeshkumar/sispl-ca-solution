"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * The application's modal primitive.
 *
 * Built on the native `<dialog>` in modal mode, so the focus trap, Escape
 * handling, the backdrop, and inert page content behind it come from the
 * platform rather than hand-written JavaScript. Every close route — Escape, the
 * backdrop, the header button, a Cancel button — ends in the same `onClose`.
 *
 * Layout is fixed by the primitive: a pinned header, a scrolling body, and a
 * pinned action bar, so a long form never scrolls its own Save button away.
 */
export function FormDialog({
  accent,
  children,
  description,
  onClose,
  open,
  title,
  width = "regular",
}: {
  /** Opt-in visual treatment. Omitted by default, so no existing dialog changes. */
  accent?: string;
  children: ReactNode;
  description?: string;
  onClose: () => void;
  open: boolean;
  title: string;
  width?: "regular" | "wide";
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      aria-label={title}
      className={`form-dialog is-${width}${accent ? ` is-accent-${accent}` : ""}`}
      onClick={(event) => {
        // A click landing on the dialog itself is the backdrop; the panel stops its own.
        if (event.target === dialogRef.current) onClose();
      }}
      onClose={onClose}
      ref={dialogRef}
    >
      <div className="form-dialog-panel">
        <header className="form-dialog-header">
          <div>
            <h2>{title}</h2>
            {description && <p>{description}</p>}
          </div>
          <button aria-label="Close" className="form-dialog-close" onClick={onClose} type="button">&times;</button>
        </header>
        {children}
      </div>
    </dialog>
  );
}

/** Scrolling field area. Everything between the header and the action bar. */
export function FormDialogBody({ children, columns = 2 }: { children: ReactNode; columns?: 1 | 2 }) {
  return <div className={`form-dialog-body is-columns-${columns}`}>{children}</div>;
}

/** Pinned action bar. `submitLabel` switches automatically between add and save. */
export function FormDialogActions({
  onCancel,
  pending,
  submitLabel,
}: {
  onCancel: () => void;
  pending: boolean;
  submitLabel: string;
}) {
  return (
    <div className="form-dialog-actions">
      <button className="secondary-button" onClick={onCancel} type="button">Cancel</button>
      <button className="primary-button" disabled={pending} type="submit">{pending ? "Saving…" : submitLabel}</button>
    </div>
  );
}

/** Groups checkboxes so they read as one set instead of a ragged grid column. */
export function FormDialogToggles({ children }: { children: ReactNode }) {
  return <div className="form-dialog-toggles">{children}</div>;
}

/**
 * A successful server action redirects, so it never reports success back to the
 * client. Closing when a submission finishes without errors covers both paths;
 * closing on submit instead would dismiss the dialog on a validation failure.
 */
export function useCloseOnSuccess(
  pending: boolean,
  state: { error: string; fieldErrors: Record<string, unknown> },
  close: () => void,
) {
  const wasPending = useRef(false);
  useEffect(() => {
    if (wasPending.current && !pending && !state.error && Object.keys(state.fieldErrors).length === 0) close();
    wasPending.current = pending;
  });
}

/** `null` closed · `"add"` a blank record · otherwise the record being edited. */
export type DialogState<T> = null | "add" | T;
export const dialogRecord = <T,>(state: DialogState<T>): T | null => (state && state !== "add" ? state : null);
