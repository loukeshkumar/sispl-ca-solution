"use client";

import { useEffect, useRef, useState } from "react";

import { hasPermission, type AuthViewer, type Permission } from "../../lib/auth/authorization";
import ClientDialog from "./client-dialog";
import { DashboardIcon, type DashboardIconName } from "./dashboard-icons";
import DocumentRequestDialog from "./document-request-dialog";
import EmployeeDialog from "./employee-dialog";
import InvoiceDialog from "./invoice-dialog";
import TaskDialog from "./task-dialog";
import WorkDialog from "./work-dialog";

type CreateKey = "client" | "work" | "task" | "document" | "invoice" | "employee";

const entries: Array<{ hint: string; icon: DashboardIconName; key: CreateKey; label: string; permission: Permission }> = [
  { hint: "Add a legal entity and its services", icon: "clients", key: "client", label: "Client", permission: "clients:write" },
  { hint: "Raise a statutory obligation", icon: "work", key: "work", label: "Work item", permission: "work:write" },
  { hint: "Assign office delivery work", icon: "todo", key: "task", label: "Task", permission: "tasks:assign" },
  { hint: "Chase a client dependency", icon: "documents", key: "document", label: "Document request", permission: "documents:write" },
  { hint: "Draft a fee note", icon: "billing", key: "invoice", label: "Invoice", permission: "billing:manage" },
  { hint: "Add someone to the firm", icon: "team", key: "employee", label: "Employee", permission: "team:manage" },
];

/**
 * One place to start any record, from anywhere in the application.
 *
 * The menu only offers what the viewer may actually create — the same
 * permission that guards each workspace guards its entry here, so the menu
 * never advertises a capability that would be refused on submit.
 */
export function CreateMenu({ viewer }: { viewer?: AuthViewer }) {
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState<CreateKey | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const available = entries.filter((entry) => !viewer || hasPermission(viewer, entry.permission));

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const start = (key: CreateKey) => {
    setOpen(false);
    setDialog(key);
  };

  // Someone with no create rights gets no button rather than a dead one.
  if (!available.length) return null;

  return (
    <div className="create-menu" ref={containerRef}>
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        className="create-button"
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <DashboardIcon name="plus" size={18} />
        <span>Create new</span>
      </button>

      {open && (
        <div className="create-menu-panel" role="menu">
          <p className="create-menu-label">START SOMETHING</p>
          {available.map((entry) => (
            <button className="create-menu-item" key={entry.key} onClick={() => start(entry.key)} role="menuitem" type="button">
              <span className={`create-menu-icon tone-${entry.key}`}><DashboardIcon name={entry.icon} size={17} /></span>
              <span><strong>{entry.label}</strong><small>{entry.hint}</small></span>
            </button>
          ))}
        </div>
      )}

      <ClientDialog onClose={() => setDialog(null)} open={dialog === "client"} />
      <WorkDialog onClose={() => setDialog(null)} open={dialog === "work"} />
      <TaskDialog onClose={() => setDialog(null)} open={dialog === "task"} />
      <DocumentRequestDialog onClose={() => setDialog(null)} open={dialog === "document"} />
      <InvoiceDialog onClose={() => setDialog(null)} open={dialog === "invoice"} />
      <EmployeeDialog onClose={() => setDialog(null)} open={dialog === "employee"} />
    </div>
  );
}
