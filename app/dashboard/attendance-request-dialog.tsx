"use client";

import { useState, type ReactNode } from "react";

import AttendanceRequestForm from "../attendance/request-form";
import { FormDialog } from "./form-dialog";

type RequestMode = "leave" | "correction";

/**
 * Leave and attendance-correction requests. The two share a dialog with a mode
 * switch, since an employee raising one often means the other; no options need
 * loading, so the form renders immediately.
 */
export default function AttendanceRequestDialog({
  initialMode,
  onClose,
  open,
}: {
  initialMode: RequestMode;
  onClose: () => void;
  open: boolean;
}) {
  const [mode, setMode] = useState<RequestMode>(initialMode);
  const [wasOpen, setWasOpen] = useState(open);
  // Reopening starts from the mode the trigger asked for, not the last tab used.
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open && mode !== initialMode) setMode(initialMode);
  }

  return (
    <FormDialog
      description="Every request keeps its original values, reviewer, and decision history."
      onClose={onClose}
      open={open}
      title="Request attendance change"
    >
      <div className="attendance-request-switch">
        <button aria-current={mode === "leave" ? "true" : undefined} onClick={() => setMode("leave")} type="button">Leave request</button>
        <button aria-current={mode === "correction" ? "true" : undefined} onClick={() => setMode("correction")} type="button">Attendance correction</button>
      </div>
      {/* Remounting on mode change clears the previous form's fields and errors. */}
      <AttendanceRequestForm key={mode} mode={mode} onCancel={onClose} onSaved={onClose} />
    </FormDialog>
  );
}

/** Opens the attendance-request dialog from a server-rendered page. */
export function AttendanceRequestDialogButton({
  children,
  initialMode,
  variant = "primary",
}: {
  children: ReactNode;
  initialMode: RequestMode;
  variant?: "primary" | "secondary";
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className={`${variant}-button`} onClick={() => setOpen(true)} type="button">{children}</button>
      <AttendanceRequestDialog initialMode={initialMode} onClose={() => setOpen(false)} open={open} />
    </>
  );
}
