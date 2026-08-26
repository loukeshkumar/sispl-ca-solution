"use client";

import { useState, type ReactNode } from "react";

import { loadEmployeeFormOptions, saveEmployeeAction, type EmployeeFormOptions } from "../team/actions";
import EmployeeForm from "../team/employee-form";
import { FormDialog } from "./form-dialog";
import { SkeletonForm } from "./skeleton";
import { useToast } from "./toast";
import { useDialogOptions } from "./use-dialog-options";

type EmployeeInitial = Parameters<typeof EmployeeForm>[0]["initial"];

/**
 * Employee add and edit. Assignable roles are fetched the first time the dialog
 * opens; login access is still provisioned separately from Employee 360.
 */
export default function EmployeeDialog({
  employeeId,
  initial,
  onClose,
  open,
  title,
}: {
  employeeId?: string;
  initial?: EmployeeInitial;
  onClose: () => void;
  open: boolean;
  title?: string;
}) {
  const options = useDialogOptions<EmployeeFormOptions>(open, loadEmployeeFormOptions);
  const toast = useToast();
  const confirmSaved = () => { toast.success(employeeId ? "Employee updated." : "Employee added."); onClose(); };

  return (
    <FormDialog
      description="Keep employee identity minimal and use the role to control firm access. Secure login is provisioned from Employee 360."
      onClose={onClose}
      open={open}
      title={title ?? (employeeId ? "Edit employee" : "Add employee")}
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
        <EmployeeForm
          action={saveEmployeeAction}
          employeeId={employeeId}
          initial={initial}
          mode={employeeId ? "edit" : "create"}
          onCancel={onClose}
          onSaved={confirmSaved}
          roles={options.data.roles}
        />
      )}
    </FormDialog>
  );
}

/** Opens the employee dialog from a server-rendered page. */
export function EmployeeDialogButton({
  children,
  employeeId,
  initial,
  title,
  variant = "primary",
}: {
  children: ReactNode;
  employeeId?: string;
  initial?: EmployeeInitial;
  title?: string;
  variant?: "primary" | "secondary";
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className={`${variant}-button`} onClick={() => setOpen(true)} type="button">{children}</button>
      <EmployeeDialog employeeId={employeeId} initial={initial} onClose={() => setOpen(false)} open={open} title={title} />
    </>
  );
}
