"use client";

import { AlertTriangle, Check, LockKeyhole, UsersRound } from "lucide-react";
import { useActionState, useMemo, useState } from "react";

import { permissionDefinitions, type Permission } from "../../lib/auth/authorization";
import type { ManagedRoleWithPermissions } from "../../lib/roles/repository";
import type { ManagedRoleClass, RoleDefinitionActionState } from "../../lib/roles/validation";
import { archiveRoleDefinitionAction, saveRoleDefinitionAction } from "../settings/roles/actions";
import { FormDialog, FormDialogBody, useCloseOnSuccess, type DialogState } from "./form-dialog";
import { useToast } from "./toast";

const initialState: RoleDefinitionActionState = { error: "", fieldErrors: {} };

const scopeOptions = [
  { value: "associate", label: "Own and assigned work", note: "Access is limited to the employee and assigned resources." },
  { value: "manager", label: "Team and direct reports", note: "Adds manager-level visibility for reporting lines and assigned teams." },
  { value: "partner", label: "Firm-wide business scope", note: "Business data across the firm, without identity administration." },
] as const;

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
  const [selected, setSelected] = useState<Set<Permission>>(() => new Set(record?.permissions ?? ["dashboard:read"]));
  const visible = useMemo(() => permissionDefinitions.filter((permission) => permission.allowedFor.includes(roleClass as never)), [roleClass]);
  const grouped = useMemo(() => Map.groupBy(visible, (permission) => permission.module), [visible]);
  const highRisk = visible.filter((permission) => selected.has(permission.key) && "risk" in permission).length;

  const toggle = (permission: Permission) => setSelected((current) => {
    const next = new Set(current);
    if (permission === "dashboard:read") return next;
    if (next.has(permission)) next.delete(permission); else next.add(permission);
    return next;
  });

  return (
    <form action={formAction} className="form-dialog-form">
      <FormDialogBody columns={1}>
        {state.error && <p className="package-form-banner" role="alert">{state.error}</p>}
        {record && <input name="roleId" type="hidden" value={record.id} />}

        <div className="role-dialog-grid">
          <label><span>Role name</span>
            <input defaultValue={record?.name} disabled={record?.isSystem} maxLength={80} name="name" required />
            {record?.isSystem && <input name="name" type="hidden" value={record.name} />}
            {state.fieldErrors.name && <em className="package-field-error">{state.fieldErrors.name}</em>}
          </label>
          <label><span>Description</span>
            <textarea defaultValue={record?.description} maxLength={240} name="description" placeholder="Explain when this role should be assigned." rows={2} />
            {state.fieldErrors.description && <em className="package-field-error">{state.fieldErrors.description}</em>}
          </label>
        </div>

        <fieldset className="role-dialog-fieldset">
          <legend>User class</legend>
          <div className="role-class-options">
            {(["employee", "admin"] as const).map((value) => (
              <label className={roleClass === value ? "is-selected" : ""} key={value}>
                <input
                  checked={roleClass === value}
                  disabled={Boolean(record)}
                  name="roleClass"
                  onChange={() => { setRoleClass(value); setSelected(new Set(["dashboard:read"])); }}
                  type="radio"
                  value={value}
                />
                <span>{value === "admin" ? <LockKeyhole aria-hidden="true" /> : <UsersRound aria-hidden="true" />}</span>
                <strong>{value === "admin" ? "Admin" : "Employee category"}</strong>
                <small>{value === "admin" ? "Created and assigned only by Super Admin" : "One category is assigned to each employee"}</small>
              </label>
            ))}
            {record && <input name="roleClass" type="hidden" value={record.roleClass} />}
          </div>
          {state.fieldErrors.roleClass && <p className="role-inline-error" role="alert">{state.fieldErrors.roleClass}</p>}
        </fieldset>

        {roleClass === "employee" ? (
          <fieldset className="role-dialog-fieldset">
            <legend>Resource scope</legend>
            <div className="role-scope-options">
              {scopeOptions.map((scope) => (
                <label key={scope.value}>
                  <input defaultChecked={(record?.legacyRoleKey ?? "associate") === scope.value} name="legacyRoleKey" type="radio" value={scope.value} />
                  <span><strong>{scope.label}</strong><small>{scope.note}</small></span>
                </label>
              ))}
            </div>
            {state.fieldErrors.legacyRoleKey && <p className="role-inline-error" role="alert">{state.fieldErrors.legacyRoleKey}</p>}
          </fieldset>
        ) : <input name="legacyRoleKey" type="hidden" value="partner" />}

        <fieldset className="role-dialog-fieldset">
          <legend>
            Permissions
            <b className="role-dialog-count">
              {selected.size} selected
              {highRisk > 0 && <i><AlertTriangle aria-hidden="true" />{highRisk} high-impact</i>}
            </b>
          </legend>
          <div className="permission-groups">
            {[...grouped.entries()].map(([module, permissions]) => (
              <fieldset key={module}>
                <legend>{module}</legend>
                <div>
                  {permissions.map((permission) => {
                    const locked = permission.key === "dashboard:read";
                    const checked = selected.has(permission.key);
                    return (
                      <label className={checked ? "is-selected" : ""} key={permission.key}>
                        <input checked={checked} disabled={locked} onChange={() => toggle(permission.key)} type="checkbox" />
                        <input disabled={!checked} name="permissions" type="hidden" value={checked ? permission.key : ""} />
                        <span className="permission-check">{checked && <Check aria-hidden="true" />}</span>
                        <span>
                          <strong>{permission.label}{"risk" in permission && <em>{permission.risk === "critical" ? "Reserved" : "High impact"}</em>}</strong>
                          <small>{permission.description}</small>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            ))}
          </div>
          {state.fieldErrors.permissions && <p className="role-inline-error" role="alert">{state.fieldErrors.permissions}</p>}
        </fieldset>
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
