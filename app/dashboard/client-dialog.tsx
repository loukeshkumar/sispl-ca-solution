"use client";

import ClientForm from "../clients/client-form";
import { loadClientFormOptions, saveClientAction, type ClientFormOptions } from "../clients/actions";
import { FormDialog } from "./form-dialog";
import { SkeletonForm } from "./skeleton";
import { useToast } from "./toast";
import { useDialogOptions } from "./use-dialog-options";

type InitialClient = Parameters<typeof ClientForm>[0]["initial"];

/**
 * Client add and edit. Owner and service lists are fetched the first time the
 * dialog opens, so the dashboard never pays for them on a visit that does not
 * open the form.
 */
export default function ClientDialog({
  initial,
  onClose,
  open,
}: {
  initial?: InitialClient;
  onClose: () => void;
  open: boolean;
}) {
  const options = useDialogOptions<ClientFormOptions>(open, loadClientFormOptions);
  const toast = useToast();
  const confirmSaved = () => { toast.success(initial ? "Client updated." : "Client added."); onClose(); };

  return (
    <FormDialog
      description="Legal name, PAN and registrations form the audit record. Services must already exist in the service master."
      onClose={onClose}
      open={open}
      title={initial ? `Edit ${initial.displayName}` : "Add a client"}
      width="wide"
    >
      {options.loading && <SkeletonForm fields={8} />}
      {options.failed && (
        <p className="form-dialog-status is-error" role="alert">
          The form could not be loaded.{" "}
          <button className="master-toggle-button" onClick={options.retry} type="button">Try again</button>
        </p>
      )}
      {options.data && (
        <ClientForm
          action={saveClientAction}
          initial={initial}
          members={options.data.members}
          mode={initial ? "edit" : "create"}
          onCancel={onClose}
          onSaved={confirmSaved}
          services={options.data.services}
        />
      )}
    </FormDialog>
  );
}
