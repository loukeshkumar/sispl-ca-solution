"use client";

import { useState, type ReactNode } from "react";

import type { InvoiceFormOptions } from "../../lib/billing/repository";
import { loadInvoiceFormOptions } from "../billing/actions";
import InvoiceForm from "../billing/invoice-form";
import { FormDialog } from "./form-dialog";
import { SkeletonForm } from "./skeleton";
import { useDialogOptions } from "./use-dialog-options";

/**
 * Draft-invoice creation. The action navigates to the new invoice on success,
 * because the next step is reviewing and issuing it rather than returning to the
 * list; the dialog closes on the way out.
 */
export default function InvoiceDialog({
  onClose,
  open,
  prefillEntityId,
}: {
  onClose: () => void;
  open: boolean;
  prefillEntityId?: string;
}) {
  const options = useDialogOptions<InvoiceFormOptions>(open, loadInvoiceFormOptions);

  return (
    <FormDialog
      description="Draft the fee note, review it, then issue it to start the receivable."
      onClose={onClose}
      open={open}
      title="Create a draft invoice"
      width="wide"
    >
      {options.loading && <SkeletonForm fields={6} />}
      {options.failed && (
        <p className="form-dialog-status is-error" role="alert">
          The form could not be loaded.{" "}
          <button className="master-toggle-button" onClick={options.retry} type="button">Try again</button>
        </p>
      )}
      {options.data && (
        <InvoiceForm onCancel={onClose} onSaved={onClose} options={options.data} prefillEntityId={prefillEntityId} />
      )}
    </FormDialog>
  );
}

/** Opens the invoice dialog from a server-rendered page. */
export function InvoiceDialogButton({
  children,
  prefillEntityId,
  variant = "primary",
}: {
  children: ReactNode;
  prefillEntityId?: string;
  variant?: "primary" | "secondary";
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className={`${variant}-button`} onClick={() => setOpen(true)} type="button">{children}</button>
      <InvoiceDialog onClose={() => setOpen(false)} open={open} prefillEntityId={prefillEntityId} />
    </>
  );
}
