"use client";

import { AlertTriangle, Building2, Check, ChevronRight, LockKeyhole, Minus, Search, UserRound, UsersRound, X } from "lucide-react";
import { useActionState, useMemo, useState } from "react";

import { permissionDefinitions, type Permission } from "../../lib/auth/authorization";
import type { ManagedRoleWithPermissions } from "../../lib/roles/repository";
import type { ManagedRoleClass, RoleDefinitionActionState } from "../../lib/roles/validation";
import { archiveRoleDefinitionAction, saveRoleDefinitionAction } from "../settings/roles/actions";
import { FormDialog, FormDialogBody, useCloseOnSuccess, type DialogState } from "./form-dialog";
import { useToast } from "./toast";

type PermissionDefinition = (typeof permissionDefinitions)[number];

const initialState: RoleDefinitionActionState = { error: "", fieldErrors: {} };

/** Held by every role: without it the workspace itself is unreachable. */
const basePermission: Permission = "dashboard:read";

const classOptions = [
  { value: "employee", Icon: UsersRound, label: "Employee category", note: "One category is assigned to each employee." },
  { value: "admin", Icon: LockKeyhole, label: "Admin", note: "Created and assigned only by Super Admin." },
] as const;

const scopeOptions = [
  { value: "associate", Icon: UserRound, label: "Own and assigned work", note: "Limited to the employee and the resources assigned to them." },
  { value: "manager", Icon: UsersRound, label: "Team and direct reports", note: "Adds manager-level visibility for reporting lines and assigned teams." },
  { value: "partner", Icon: Building2, label: "Firm-wide business scope", note: "Business data across the firm, without identity administration." },
] as const;

/** The badge a row carries in the matrix, or nothing for an ordinary permission. */
function tagFor(permission: PermissionDefinition) {
  if (permission.key === basePermission) return { text: "Always on", tone: "is-locked" };
  if (!("risk" in permission)) return null;
  return { text: permission.risk === "critical" ? "Reserved" : "High impact", tone: "is-risk" };
}

/**
 * Role editing in a dialog. The permission matrix is wide, so this uses the
 * `wide` dialog and a single-column body that the matrix spans.
 */
export default function RoleDialog({
  dialog,
  onClose,
}: {
  dialog: DialogState<ManagedRoleWithPermissions>;
  onClose: () => void;
}) {
  const record = dialog && dialog !== "add" ? dialog : null;
  const [state, formAction, pending] = useActionState(saveRoleDefinitionAction, initialState);
  const toast = useToast();
  useCloseOnSuccess(pending, state, () => { toast.success("Role saved."); onClose(); });

  return (
    <FormDialog
      accent="role-access"
      description="Permissions are deny-by-default. Changing a role revokes the sessions of everyone assigned to it, so reductions apply on their next request."
      onClose={onClose}
      open={dialog !== null}
      title={record ? `Edit ${record.name}` : "Create an access role"}
      width="wide"
    >
      {/* Sits outside the edit form so the archive submit is a separate action. */}
      {record && !record.isSystem && (
        <form action={archiveRoleDefinitionAction} id="archive-role-form">
          <input name="roleId" type="hidden" value={record.id} />
        </form>
      )}
      <RoleForm
        formAction={formAction}
        key={record?.id ?? "new-role"}
        onClose={onClose}
        pending={pending}
        record={record}
        state={state}
      />
    </FormDialog>
  );
}

function RoleForm({
  formAction,
  onClose,
  pending,
  record,
  state,
}: {
  formAction: (formData: FormData) => void;
  onClose: () => void;
  pending: boolean;
  record: ManagedRoleWithPermissions | null;
  state: RoleDefinitionActionState;
}) {
  const [roleClass, setRoleClass] = useState<ManagedRoleClass>((record?.roleClass as ManagedRoleClass) ?? "employee");
  const [selected, setSelected] = useState<Set<Permission>>(() => new Set(record?.permissions ?? [basePermission]));
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());

  const visible = useMemo(() => permissionDefinitions.filter((permission) => permission.allowedFor.includes(roleClass as never)), [roleClass]);
  const term = query.trim().toLowerCase();
  const matched = useMemo(
    () => (term ? visible.filter((permission) => `${permission.module} ${permission.label} ${permission.description}`.toLowerCase().includes(term)) : visible),
    [term, visible],
  );
  const grouped = useMemo(() => Map.groupBy(matched, (permission) => permission.module), [matched]);
  // Only what the class allows is submitted, so a stale grant cannot fail validation.
  const granted = visible.filter((permission) => selected.has(permission.key));
  const highRisk = granted.filter((permission) => "risk" in permission).length;

  const toggle = (permission: Permission) => setSelected((current) => {
    if (permission === basePermission) return current;
    const next = new Set(current);
    if (next.has(permission)) next.delete(permission); else next.add(permission);
    return next;
  });

  // Bulk edits only touch what is on screen, so an active filter narrows them too.
  const apply = (permissions: readonly PermissionDefinition[], grant: boolean) => setSelected((current) => {
    const next = new Set(current);
    for (const permission of permissions) {
      if (permission.key === basePermission) continue;
      if (grant) next.add(permission.key); else next.delete(permission.key);
    }
    return next;
  });

  const modules = [...grouped.keys()];
  // A filter forces every matching node open: a hidden match reads as no match.
  const isOpen = (module: string) => Boolean(term) || !collapsed.has(module);
  const anyOpen = modules.some(isOpen);
  const toggleNode = (module: string) => setCollapsed((current) => {
    const next = new Set(current);
    if (next.has(module)) next.delete(module); else next.add(module);
    return next;
  });

  return (
    <form action={formAction} className="form-dialog-form role-dialog-form">
      <FormDialogBody columns={1}>
        {state.error && <p className="package-form-banner" role="alert">{state.error}</p>}
        {record && <input name="roleId" type="hidden" value={record.id} />}
        {/* One hidden input per grant, so filtering the matrix never drops a selection. */}
        {granted.map((permission) => <input key={permission.key} name="permissions" type="hidden" value={permission.key} />)}

        <div className="role-dialog-grid">
          <label><span>Role name</span>
            <input defaultValue={record?.name} disabled={record?.isSystem} maxLength={80} name="name" placeholder="e.g. Audit associate" required />
            {record?.isSystem && <input name="name" type="hidden" value={record.name} />}
            {state.fieldErrors.name && <em className="package-field-error">{state.fieldErrors.name}</em>}
          </label>
          <label><span>Description</span>
            <textarea defaultValue={record?.description} maxLength={240} name="description" placeholder="Explain when this role should be assigned." rows={2} />
            {state.fieldErrors.description && <em className="package-field-error">{state.fieldErrors.description}</em>}
          </label>
        </div>

        <fieldset className="role-dialog-section">
          <legend>
            User class
            {record && <span className="role-section-hint">Fixed after creation</span>}
          </legend>
          <div className="role-class-options">
            {classOptions.map((option) => (
              <label className={`role-option${roleClass === option.value ? " is-selected" : ""}`} key={option.value}>
                <input
                  checked={roleClass === option.value}
                  disabled={Boolean(record)}
                  name="roleClass"
                  onChange={() => { setRoleClass(option.value); setSelected(new Set([basePermission])); }}
                  type="radio"
                  value={option.value}
                />
                <span className="role-option-head">
                  <span className="role-option-icon"><option.Icon aria-hidden="true" /></span>
                  <span aria-hidden="true" className="role-option-mark" />
                </span>
                <strong>{option.label}</strong>
                <small>{option.note}</small>
              </label>
            ))}
            {record && <input name="roleClass" type="hidden" value={record.roleClass} />}
          </div>
          {state.fieldErrors.roleClass && <p className="role-inline-error" role="alert">{state.fieldErrors.roleClass}</p>}
        </fieldset>

        {roleClass === "employee" ? (
          <fieldset className="role-dialog-section">
            <legend>
              Resource scope
              <span className="role-section-hint">How far the permissions below reach</span>
            </legend>
            <div className="role-scope-options">
              {scopeOptions.map((scope) => (
                <label className="role-option" key={scope.value}>
                  <input defaultChecked={(record?.legacyRoleKey ?? "associate") === scope.value} name="legacyRoleKey" type="radio" value={scope.value} />
                  <span className="role-option-head">
                    <span className="role-option-icon"><scope.Icon aria-hidden="true" /></span>
                    <span aria-hidden="true" className="role-option-mark" />
                  </span>
                  <strong>{scope.label}</strong>
                  <small>{scope.note}</small>
                </label>
              ))}
            </div>
            {state.fieldErrors.legacyRoleKey && <p className="role-inline-error" role="alert">{state.fieldErrors.legacyRoleKey}</p>}
          </fieldset>
        ) : <input name="legacyRoleKey" type="hidden" value="partner" />}

        <div aria-labelledby="role-permission-heading" className="role-dialog-section" role="group">
          <div className="role-permission-bar">
            <div className="role-permission-title">
              <h3 id="role-permission-heading">Permissions</h3>
              <span aria-live="polite" className="role-permission-counts">
                <span className="role-count-pill"><b>{granted.length}</b> of {visible.length} selected</span>
                {highRisk > 0 && <span className="role-risk-pill"><AlertTriangle aria-hidden="true" />{highRisk} high-impact</span>}
              </span>
            </div>
            <div className="role-permission-toolbar">
              <span className="role-permission-search">
                <Search aria-hidden="true" />
                <input
                  aria-label="Filter permissions"
                  onChange={(event) => setQuery(event.target.value)}
                  // Enter inside a filter box would otherwise submit the whole form.
                  onKeyDown={(event) => { if (event.key === "Enter") event.preventDefault(); }}
                  placeholder="Filter permissions…"
                  type="search"
                  value={query}
                />
                {query && (
                  <button aria-label="Clear filter" className="role-search-clear" onClick={() => setQuery("")} type="button">
                    <X aria-hidden="true" />
                  </button>
                )}
              </span>
              <span className="role-permission-bulk">
                <button disabled={Boolean(term)} onClick={() => setCollapsed(anyOpen ? new Set(modules) : new Set())} type="button">
                  {anyOpen ? "Collapse all" : "Expand all"}
                </button>
                <button onClick={() => apply(matched, true)} type="button">Select {term ? "matches" : "all"}</button>
                <button onClick={() => apply(matched, false)} type="button">Clear</button>
              </span>
            </div>
          </div>

          {matched.length === 0 ? (
            <p className="role-permission-empty">No permission matches “{query.trim()}”.</p>
          ) : (
            <div className="permission-tree">
              {[...grouped.entries()].map(([module, permissions]) => {
                const openable = permissions.filter((permission) => permission.key !== basePermission);
                const chosen = permissions.filter((permission) => selected.has(permission.key)).length;
                const allOn = chosen === permissions.length;
                const expanded = isOpen(module);
                return (
                  <div className={`permission-node${expanded ? " is-open" : ""}`} key={module}>
                    <div className="permission-node-head">
                      <button aria-expanded={expanded} className="permission-node-toggle" onClick={() => toggleNode(module)} type="button">
                        <ChevronRight aria-hidden="true" />
                        <span>{module}</span>
                      </button>
                      <span className="permission-node-count">{chosen}/{permissions.length}</span>
                      {/* The node checkbox reflects every child but only ever moves the unlocked ones. */}
                      <label className={`permission-node-select${allOn ? " is-selected" : chosen > 0 ? " is-part" : ""}`}>
                        <input
                          checked={allOn}
                          disabled={openable.length === 0}
                          onChange={() => apply(openable, !allOn)}
                          ref={(node) => { if (node) node.indeterminate = chosen > 0 && !allOn; }}
                          type="checkbox"
                        />
                        <span aria-hidden="true" className="permission-check">
                          {allOn ? <Check /> : chosen > 0 ? <Minus /> : null}
                        </span>
                        <span className="sr-only">Select all {module} permissions</span>
                      </label>
                    </div>
                    {expanded && (
                      <div className="permission-node-children">
                        {permissions.map((permission) => {
                          const locked = permission.key === basePermission;
                          const checked = selected.has(permission.key);
                          const tag = tagFor(permission);
                          return (
                            <label
                              className={`permission-leaf${checked ? " is-selected" : ""}${locked ? " is-locked" : ""}`}
                              key={permission.key}
                            >
                              <input checked={checked} disabled={locked} onChange={() => toggle(permission.key)} type="checkbox" />
                              <span aria-hidden="true" className="permission-check">{checked && <Check />}</span>
                              <span className="permission-leaf-name">
                                {permission.label}
                                {tag && <em className={`permission-tag ${tag.tone}`}>{tag.text}</em>}
                              </span>
                              <small>{permission.description}</small>
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {state.fieldErrors.permissions && <p className="role-inline-error" role="alert">{state.fieldErrors.permissions}</p>}
        </div>
      </FormDialogBody>
      <div className="form-dialog-actions role-dialog-actions">
        {/* Archiving is its own action, so it sits outside the save submit. */}
        {record && !record.isSystem && record.status === "active" && (
          <button
            className="master-toggle-button role-archive-button"
            form="archive-role-form"
            type="submit"
          >
            Archive role
          </button>
        )}
        <button className="secondary-button" onClick={onClose} type="button">Cancel</button>
        <button className="primary-button" disabled={pending} type="submit">{pending ? "Saving…" : record ? "Save role changes" : "Create role"}</button>
      </div>
    </form>
  );
}
