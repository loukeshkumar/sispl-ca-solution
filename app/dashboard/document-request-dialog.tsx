"use client";

import Link from "next/link";

import { useState, type ReactNode } from "react";

import { loadDocumentFormOptions, type DocumentFormOptions } from "../documents/actions";
import { DocumentRequestForm } from "../documents/request-form";
import { FormDialog } from "./form-dialog";
import { SkeletonForm } from "./skeleton";
import { useDialogOptions } from "./use-dialog-options";

/**
 * Raising a document request. Clients, open work, and the checklist master are
 * fetched the first time the dialog opens rather than on every dashboard render.
 */
export default function DocumentRequestDialog({
  initialClientId,
  onClose,
  open,
}: {
  initialClientId?: string;
  onClose: () => void;
  open: boolean;
}) {
  const options = useDialogOptions<DocumentFormOptions>(open, loadDocumentFormOptions);

  return (
    <FormDialog
      description="Create a traceable request against an active client and optional work item. Picking a checklist item fills the title and due date."
      onClose={onClose}
      open={open}
      title="New document request"
      width="wide"
    >
      {options.loading && <SkeletonForm fields={5} />}
      {options.failed && (
        <p className="form-dialog-status is-error" role="alert">
          The form could not be loaded. If this keeps happening your sign-in may have expired.{" "}
          <button className="master-toggle-button" onClick={options.retry} type="button">Try again</button>{" "}
          <Link href="/?workspace=documents">or reload the page</Link>
        </p>
      )}
      {options.data && (
        <DocumentRequestForm
          checklist={options.data.checklist}
          clients={options.data.clients}
          initialClientId={initialClientId}
          onCancel={onClose}
          onSaved={onClose}
          todayKey={options.data.todayKey}
          work={options.data.work}
        />
      )}
    </FormDialog>
  );
}

/** Opens the request dialog from a server-rendered page. */
export function DocumentRequestDialogButton({
  children,
  initialClientId,
  variant = "primary",
}: {
  children: ReactNode;
  initialClientId?: string;
  variant?: "primary" | "secondary";
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className={`${variant}-button`} onClick={() => setOpen(true)} type="button">{children}</button>
      <DocumentRequestDialog initialClientId={initialClientId} onClose={() => setOpen(false)} open={open} />
    </>
  );
}
