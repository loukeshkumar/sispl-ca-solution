"use client";

import { useState, type ReactNode } from "react";

import { loadWorkFormOptions, saveWorkAction, type WorkFormOptions } from "../work/actions";
import WorkForm from "../work/work-form";
import { FormDialog } from "./form-dialog";
import { SkeletonForm } from "./skeleton";
import { useToast } from "./toast";
import { useDialogOptions } from "./use-dialog-options";

type WorkInitial = Parameters<typeof WorkForm>[0]["initial"];

/**
 * Work-item add and edit. Client and member lists are fetched the first time the
 * dialog opens, so a dashboard visit that never creates work pays nothing.
 */
export default function WorkDialog({
  initial,
  legalEntityId,
  onClose,
  open,
  title,
  workItemId,
}: {
  initial?: WorkInitial;
  legalEntityId?: string;
  onClose: () => void;
  open: boolean;
  title?: string;
  workItemId?: string;
}) {
  const options = useDialogOptions<WorkFormOptions>(open, loadWorkFormOptions);
  const toast = useToast();
  const confirmSaved = () => { toast.success(workItemId ? "Work item updated." : "Work item created."); onClose(); };
  const data = options.data;
  // A client passed in from Client 360 only prefills if the firm can still act on it.
  const prefilled = data && legalEntityId && data.clients.some((client) => client.id === legalEntityId) ? legalEntityId : "";

  return (
    <FormDialog
      accent="work-editor-accent"
      description="Set the obligation, ownership, deadlines, and current delivery state. Internal due dates must not exceed the statutory deadline."
      onClose={onClose}
      open={open}
      title={title ?? (workItemId ? "Edit work item" : "Create work item")}
      width="wide"
    >
      {options.loading && <SkeletonForm fields={8} />}
      {options.failed && (
        <p className="form-dialog-status is-error" role="alert">
          The form could not be loaded.{" "}
          <button className="master-toggle-button" onClick={options.retry} type="button">Try again</button>
        </p>
      )}
      {data && (
        <WorkForm
          action={saveWorkAction}
          capability={data.capability}
          clients={data.clients}
          initial={initial ?? { internalDueDate: data.defaults.internalDueDate, legalEntityId: prefilled, statutoryDueDate: data.defaults.statutoryDueDate }}
          members={data.members}
          mode={workItemId ? "edit" : "create"}
          onCancel={onClose}
          onSaved={confirmSaved}
          todayKey={data.todayKey}
          workItemId={workItemId}
        />
      )}
    </FormDialog>
  );
}

/**
 * Opens the work dialog from a server-rendered page. Several workspaces and both
 * 360 pages offer the same action, so the trigger lives with the dialog instead
 * of being re-implemented per surface.
 */
export function WorkDialogButton({
  children,
  initial,
  legalEntityId,
  title,
  variant = "primary",
  workItemId,
}: {
  children: ReactNode;
  initial?: WorkInitial;
  legalEntityId?: string;
  title?: string;
  variant?: "primary" | "secondary";
  workItemId?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className={`${variant}-button`} onClick={() => setOpen(true)} type="button">{children}</button>
      <WorkDialog
        initial={initial}
        legalEntityId={legalEntityId}
        onClose={() => setOpen(false)}
        open={open}
        title={title}
        workItemId={workItemId}
      />
    </>
  );
}
