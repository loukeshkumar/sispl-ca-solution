"use client";

import { useState, type ReactNode } from "react";

import type { ServicePackageView } from "../../lib/packages/repository";
import { loadPackageFormOptions, savePackageAction, type PackageFormOptions } from "../packages/actions";
import { PackageForm } from "../packages/package-form";
import { FormDialog } from "./form-dialog";
import { SkeletonForm } from "./skeleton";
import { useToast } from "./toast";
import { useDialogOptions } from "./use-dialog-options";

/**
 * Package builder. Creating offers only active services; editing keeps the full
 * list so a package that already includes a retired service still round-trips.
 */
export default function PackageDialog({
  initial,
  onClose,
  open,
  packageId,
}: {
  initial?: ServicePackageView;
  onClose: () => void;
  open: boolean;
  packageId?: string;
}) {
  const options = useDialogOptions<PackageFormOptions>(open, loadPackageFormOptions);
  const toast = useToast();
  const confirmSaved = () => { toast.success(packageId ? "New catalogue version saved." : "Package created."); onClose(); };
  const services = options.data
    ? packageId ? options.data.services : options.data.services.filter((service) => service.status === "active")
    : [];

  return (
    <FormDialog
      description="Combine active services with a clear billing cycle and standard fee. Catalogue changes apply only to future client assignments."
      onClose={onClose}
      open={open}
      title={initial ? `Edit ${initial.name}` : "Create package"}
      width="wide"
    >
      {options.loading && <SkeletonForm fields={5} />}
      {options.failed && (
        <p className="form-dialog-status is-error" role="alert">
          The form could not be loaded.{" "}
          <button className="master-toggle-button" onClick={options.retry} type="button">Try again</button>
        </p>
      )}
      {options.data && (
        <PackageForm
          action={savePackageAction}
          initial={initial}
          mode={packageId ? "edit" : "create"}
          onCancel={onClose}
          onSaved={confirmSaved}
          packageId={packageId}
          services={services}
        />
      )}
    </FormDialog>
  );
}

/** Opens the package dialog from a server-rendered page. */
export function PackageDialogButton({
  children,
  className,
  initial,
  packageId,
  variant = "primary",
}: {
  children: ReactNode;
  className?: string;
  initial?: ServicePackageView;
  packageId?: string;
  variant?: "primary" | "secondary";
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className={className ?? `${variant}-button`} onClick={() => setOpen(true)} type="button">{children}</button>
      <PackageDialog initial={initial} onClose={() => setOpen(false)} open={open} packageId={packageId} />
    </>
  );
}
