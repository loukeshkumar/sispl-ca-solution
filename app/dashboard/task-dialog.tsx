"use client";

import { useState, type ReactNode } from "react";

import { loadTaskFormOptions, saveTaskAction, type TaskFormOptions } from "../tasks/actions";
import TaskForm from "../tasks/task-form";
import { FormDialog } from "./form-dialog";
import { SkeletonForm } from "./skeleton";
import { useToast } from "./toast";
import { useDialogOptions } from "./use-dialog-options";

type TaskInitial = Parameters<typeof TaskForm>[0]["initial"];

/**
 * Task assignment and edit. Member, client, and open-work lists are fetched the
 * first time the dialog opens rather than on every dashboard render.
 */
export default function TaskDialog({
  initial,
  onClose,
  open,
  taskId,
  title,
}: {
  initial?: TaskInitial;
  onClose: () => void;
  open: boolean;
  taskId?: string;
  title?: string;
}) {
  const options = useDialogOptions<TaskFormOptions>(open, loadTaskFormOptions);
  const toast = useToast();
  const confirmSaved = () => { toast.success(taskId ? "Task updated." : "Task assigned."); onClose(); };

  return (
    <FormDialog
      description="Give the assignee a clear outcome, due date, reviewer, and business context. Completion and cancellation stay on the task itself."
      onClose={onClose}
      open={open}
      title={title ?? (taskId ? "Edit task" : "Assign a task")}
      width="wide"
    >
      {options.loading && <SkeletonForm fields={7} />}
      {options.failed && (
        <p className="form-dialog-status is-error" role="alert">
          The form could not be loaded.{" "}
          <button className="master-toggle-button" onClick={options.retry} type="button">Try again</button>
        </p>
      )}
      {options.data && (
        <TaskForm
          action={saveTaskAction}
          initial={initial}
          mode={taskId ? "edit" : "create"}
          onCancel={onClose}
          onSaved={confirmSaved}
          options={options.data}
          taskId={taskId}
        />
      )}
    </FormDialog>
  );
}

/** Opens the task dialog from a server-rendered page. */
export function TaskDialogButton({
  children,
  initial,
  taskId,
  title,
  variant = "primary",
}: {
  children: ReactNode;
  initial?: TaskInitial;
  taskId?: string;
  title?: string;
  variant?: "primary" | "secondary";
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className={`${variant}-button`} onClick={() => setOpen(true)} type="button">{children}</button>
      <TaskDialog initial={initial} onClose={() => setOpen(false)} open={open} taskId={taskId} title={title} />
    </>
  );
}
