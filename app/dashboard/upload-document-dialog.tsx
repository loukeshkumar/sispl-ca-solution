"use client";

import { useState, type ReactNode } from "react";

import { loadDocumentUploadOptions, type DocumentUploadOptions } from "../documents/actions";
import { DocumentUploadForm } from "../documents/upload-form";
import { FormDialog } from "./form-dialog";
import { SkeletonForm } from "./skeleton";
import { useDialogOptions } from "./use-dialog-options";

/**
 * Uploading a client document. Clients, open work and outstanding requests are
 * fetched the first time the dialog opens rather than on every render.
 */
export default function UploadDocumentDialog({
  initialClientId,
  initialRequestId,
  onClose,
  open,
}: {
  initialClientId?: string;
  initialRequestId?: string;
  onClose: () => void;
  open: boolean;
}) {
  const options = useDialogOptions<DocumentUploadOptions>(open, loadDocumentUploadOptions);

  return (
    <FormDialog
      description="Files are stored against a client, and optionally against the work item or request they answer. 10 MB maximum."
      onClose={onClose}
      open={open}
      title="Upload document"
      width="wide"
    >
      {options.loading && <SkeletonForm fields={5} />}
      {options.failed && (
        <p className="form-dialog-status is-error" role="alert">
          The upload form could not be loaded.{" "}
          <button className="master-toggle-button" onClick={options.retry} type="button">Try again</button>
        </p>
      )}
      {options.data && (
        <DocumentUploadForm
          clients={options.data.clients}
          initialClientId={initialClientId}
          initialRequestId={initialRequestId}
          onCancel={onClose}
          onSaved={onClose}
          requests={options.data.requests}
          work={options.data.work}
        />
      )}
    </FormDialog>
  );
}

/** Opens the upload dialog from a server-rendered page. */
export function UploadDocumentDialogButton({
  children,
  initialClientId,
  initialRequestId,
  variant = "primary",
}: {
  children: ReactNode;
  initialClientId?: string;
  initialRequestId?: string;
  variant?: "primary" | "link";
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className={variant === "link" ? "text-action" : "primary-button"} onClick={() => setOpen(true)} type="button">{children}</button>
      <UploadDocumentDialog initialClientId={initialClientId} initialRequestId={initialRequestId} onClose={() => setOpen(false)} open={open} />
    </>
  );
}
