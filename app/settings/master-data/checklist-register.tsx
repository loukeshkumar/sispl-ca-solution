"use client";

import { useActionState, useState } from "react";

import type { DocumentChecklistRow, MasterDataWorkspace } from "../../../lib/master-data/repository";
import { type DocumentChecklistActionState } from "../../../lib/master-data/validation";
import { StatusBadge } from "../../dashboard/dashboard-ui";
import {
  dialogRecord,
  FormDialog,
  FormDialogActions,
  FormDialogBody,
  useCloseOnSuccess,
  type DialogState,
} from "../../dashboard/form-dialog";
import { useToast } from "../../dashboard/toast";
import { saveChecklistItemAction } from "./actions";

const initialState: DocumentChecklistActionState = { error: "", fieldErrors: {} };
const fieldError = (message?: string) => message ? <em className="package-field-error">{message}</em> : null;

export default function ChecklistRegister({
  canManage,
  workspace,
}: {
  canManage: boolean;
  workspace: MasterDataWorkspace;
}) {
  const [dialog, setDialog] = useState<DialogState<DocumentChecklistRow>>(null);
  const [state, formAction, pending] = useActionState(saveChecklistItemAction, initialState);
  const toast = useToast();
  useCloseOnSuccess(pending, state, () => { toast.success("Checklist item saved."); setDialog(null); });
  const record = dialogRecord(dialog);

  return (
    <>
      <section className="surface-card client-package-register">
        {canManage && (
          <div className="master-register-toolbar">
            <div>
              <strong>Documents needed</strong>
              <small>Defined once here, then offered whenever a request is raised.</small>
            </div>
            <button className="primary-button" onClick={() => setDialog("add")} type="button">Add document</button>
          </div>
        )}

        {workspace.checklist.length === 0 ? (
          <div className="package-empty-state">
            <strong>No documents defined yet</strong>
            <p>Add the documents you routinely ask clients for, so requests carry consistent titles and instructions.</p>
          </div>
        ) : (
          <div>
            <div className="package-register-head checklist-register-head">
              <span>Document</span><span>Category</span><span>Applies to</span><span>Lead</span><span>Status</span><span aria-hidden="true" />
            </div>
            {workspace.checklist.map((item) => (
              <article className={`package-register-row checklist-register-row ${item.status === "archived" ? "is-archived" : ""}`} key={item.id}>
                <span className="checklist-document-cell">
                  <b>
                    <strong>{item.name}</strong>
                    {item.mandatory && item.status === "active" && <i className="checklist-mandatory-chip">Mandatory</i>}
                  </b>
                  <small title={item.instructions || item.code}>{item.code}{item.instructions ? ` · ${item.instructions}` : ""}</small>
                </span>
                <span>{item.category}</span>
                <span>{item.serviceCode ? `${item.serviceCode}${item.serviceName ? ` · ${item.serviceName}` : ""}` : "Any service"}</span>
                <span>{item.defaultLeadDays} day{item.defaultLeadDays === 1 ? "" : "s"}</span>
                <StatusBadge tone={item.status === "archived" ? "neutral" : "mint"}>{item.status === "archived" ? "Archived" : "Active"}</StatusBadge>
                {canManage
                  ? <button className="master-toggle-button" onClick={() => setDialog(item)} type="button">Edit</button>
                  : <span>View only</span>}
              </article>
            ))}
          </div>
        )}
      </section>

      <FormDialog
        description="These become the pickable options when raising a document request. Archiving keeps history and only removes the item from future requests."
        onClose={() => setDialog(null)}
        open={dialog !== null}
        title={record ? `Edit ${record.name}` : "Add a document"}
      >
        <form action={formAction} className="form-dialog-form" key={record?.id ?? "new-checklist"}>
          <FormDialogBody>
            {state.error && <p className="package-form-banner" role="alert">{state.error}</p>}
            {record && <input name="itemId" type="hidden" value={record.id} />}
            <label><span>Code</span>
              <input defaultValue={record?.code ?? ""} maxLength={30} name="code" placeholder="BANK_STMT" required type="text" />
              {fieldError(state.fieldErrors.code)}
            </label>
            <label><span>Document name</span>
              <input defaultValue={record?.name ?? ""} maxLength={120} name="name" placeholder="Bank statement" required type="text" />
              {fieldError(state.fieldErrors.name)}
            </label>
            <label><span>Category</span>
              <input defaultValue={record?.category ?? "General"} list="checklist-categories" maxLength={40} name="category" required type="text" />
              <datalist id="checklist-categories">
                {workspace.categories.map((category) => <option key={category} value={category} />)}
              </datalist>
              {fieldError(state.fieldErrors.category)}
            </label>
            <label><span>Applies to service</span>
              <select defaultValue={record?.serviceCode ?? ""} name="serviceCode">
                <option value="">Any service</option>
                {workspace.services.map((service) => <option key={service.code} value={service.code}>{service.code} · {service.name}</option>)}
              </select>
              {fieldError(state.fieldErrors.serviceCode)}
            </label>
            <label><span>Ask this many days ahead</span>
              <input defaultValue={record?.defaultLeadDays ?? 7} max={180} min={0} name="defaultLeadDays" required type="number" />
              {fieldError(state.fieldErrors.defaultLeadDays)}
            </label>
            <label><span>Status</span>
              <select defaultValue={record?.status ?? "active"} name="status">
                <option value="active">Active</option>
                <option value="archived">Archived</option>
              </select>
            </label>
            <label className="form-dialog-wide"><span>Standard instructions</span>
              <textarea defaultValue={record?.instructions ?? ""} maxLength={500} name="instructions" placeholder="Period covered, signatures, or format required." rows={2} />
              {fieldError(state.fieldErrors.instructions)}
            </label>
            <div className="form-dialog-toggles">
              <label className="master-checkbox">
                <input defaultChecked={record?.mandatory ?? true} name="mandatory" type="checkbox" />
                <span>Usually mandatory for this engagement</span>
              </label>
            </div>
          </FormDialogBody>
          <FormDialogActions onCancel={() => setDialog(null)} pending={pending} submitLabel={record ? "Save changes" : "Add document"} />
        </form>
      </FormDialog>
    </>
  );
}
