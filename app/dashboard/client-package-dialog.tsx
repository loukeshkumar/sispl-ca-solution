"use client";

import { useState, type ReactNode } from "react";

import type { ClientPackageWorkspaceData } from "../../lib/packages/repository";
import { AssignmentForm } from "../client-packages/assignment-form";
import { loadClientPackageWorkspace } from "../packages/actions";
import { FormDialog } from "./form-dialog";
import { SkeletonForm } from "./skeleton";
import { useDialogOptions } from "./use-dialog-options";

/**
 * Assigning a package to a client. The workspace carries current assignments as
 * well as the catalogue, so the form can tell a first assignment from a change
 * in terms — fetched when the dialog opens rather than on every render.
 */
export default function ClientPackageDialog({ onClose, open }: { onClose: () => void; open: boolean }) {
  const options = useDialogOptions<ClientPackageWorkspaceData>(open, loadClientPackageWorkspace);

  return (
    <FormDialog
      description="Choose a base package, optional add-ons, agreed price, and effective period."
      onClose={onClose}
      open={open}
      title="Assign client package"
      width="wide"
    >
      {options.loading && <SkeletonForm fields={6} />}
      {options.failed && (
        <p className="form-dialog-status is-error" role="alert">
          The form could not be loaded.{" "}
          <button className="master-toggle-button" onClick={options.retry} type="button">Try again</button>
        </p>
      )}
      {options.data && <AssignmentForm onCancel={onClose} onSaved={onClose} workspace={options.data} />}
    </FormDialog>
  );
}

/** Opens the assignment dialog from a server-rendered page. */
export function ClientPackageDialogButton({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="primary-button" onClick={() => setOpen(true)} type="button">{children}</button>
      <ClientPackageDialog onClose={() => setOpen(false)} open={open} />
    </>
  );
}
