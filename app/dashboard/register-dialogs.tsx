"use client";

import { useActionState } from "react";

import {
  dscCertificateClasses,
  noticeAuthorities,
  udinDocumentTypes,
} from "../../lib/registers/validation";
import {
  saveDscAction,
  saveNoticeAction,
  saveUdinAction,
  type DscActionState,
  type NoticeActionState,
  type UdinActionState,
} from "../registers/actions";
import { FormDialog, FormDialogActions, FormDialogBody, useCloseOnSuccess } from "./form-dialog";
import { useToast } from "./toast";

export type RegisterDialogKind = null | "udin" | "dsc" | "notice";

export type RegisterFormOptions = {
  clients: Array<{ id: string; name: string }>;
  members: Array<{ id: string; name: string }>;
  work: Array<{ id: string; legalEntityId: string; label: string }>;
};

const documentTypeLabels: Record<string, string> = {
  tax_audit: "Tax audit report", statutory_audit: "Statutory audit report", gst_audit: "GST audit",
  certificate: "Certificate", itr_filing: "ITR filing", roc_filing: "ROC filing", other: "Other",
};
const authorityLabels: Record<string, string> = {
  income_tax: "Income tax", gst: "GST", tds: "TDS", roc: "ROC", other: "Other",
};
const classLabels: Record<string, string> = { class_2: "Class 2", class_3: "Class 3", dgft: "DGFT" };

// Typed per action, otherwise `fieldErrors` infers as `{}` and every lookup fails.
const udinInitial: UdinActionState = { error: "", fieldErrors: {} };
const dscInitial: DscActionState = { error: "", fieldErrors: {} };
const noticeInitial: NoticeActionState = { error: "", fieldErrors: {} };
const fieldError = (message?: string) => message ? <em className="package-field-error">{message}</em> : null;

/**
 * The three register entry dialogs. Register rows are records of something that
 * happened elsewhere — a UDIN generated on the ICAI portal, a token received, a
 * notice served — so these create entries but never edit them; corrections go
 * through the explicit revoke and status actions on the row.
 */
export default function RegisterDialogs({
  onClose,
  open,
  options,
  todayKey,
}: {
  onClose: () => void;
  open: RegisterDialogKind;
  options: RegisterFormOptions;
  todayKey: string;
}) {
  const [udinState, udinAction, udinPending] = useActionState(saveUdinAction, udinInitial);
  const [dscState, dscAction, dscPending] = useActionState(saveDscAction, dscInitial);
  const [noticeState, noticeAction, noticePending] = useActionState(saveNoticeAction, noticeInitial);
  const toast = useToast();
  useCloseOnSuccess(udinPending, udinState, () => { toast.success("UDIN recorded."); onClose(); });
  useCloseOnSuccess(dscPending, dscState, () => { toast.success("DSC registered."); onClose(); });
  useCloseOnSuccess(noticePending, noticeState, () => { toast.success("Notice logged."); onClose(); });

  const clientOptions = options.clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>);
  const memberOptions = options.members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>);
  const workOptions = options.work.map((item) => <option key={item.id} value={item.id}>{item.label}</option>);

  return (
    <>
      <FormDialog
        description="SISPL records UDINs generated on the ICAI portal. It does not generate or validate them with ICAI."
        onClose={onClose}
        open={open === "udin"}
        title="Record a UDIN"
      >
        <form action={udinAction} className="form-dialog-form">
          <FormDialogBody>
            {udinState.error && <p className="package-form-banner" role="alert">{udinState.error}</p>}
            <label><span>UDIN</span><input maxLength={18} minLength={18} name="udin" placeholder="18-character UDIN" required type="text" />{fieldError(udinState.fieldErrors.udin)}</label>
            <label><span>Client</span><select defaultValue="" name="legalEntityId" required><option disabled value="">Select a client</option>{clientOptions}</select>{fieldError(udinState.fieldErrors.legalEntityId)}</label>
            <label><span>Document type</span><select defaultValue="certificate" name="documentType">{udinDocumentTypes.map((type) => <option key={type} value={type}>{documentTypeLabels[type]}</option>)}</select></label>
            <label><span>Linked obligation</span><select defaultValue="" name="workItemId"><option value="">None</option>{workOptions}</select></label>
            <label><span>Signing member</span><select defaultValue="" name="signedByUserId" required><option disabled value="">Select the signing member</option>{memberOptions}</select>{fieldError(udinState.fieldErrors.signedByUserId)}</label>
            <label><span>ICAI membership number</span><input inputMode="numeric" maxLength={6} name="membershipNumber" placeholder="123456" required type="text" />{fieldError(udinState.fieldErrors.membershipNumber)}</label>
            <label><span>Generated on</span><input defaultValue={todayKey} name="generatedOn" required type="date" />{fieldError(udinState.fieldErrors.generatedOn)}</label>
            <label className="form-dialog-wide"><span>Document description</span><input maxLength={200} name="documentDescription" placeholder="e.g. Form 3CB-3CD for FY 2025-26" required type="text" />{fieldError(udinState.fieldErrors.documentDescription)}</label>
          </FormDialogBody>
          <FormDialogActions onCancel={onClose} pending={udinPending} submitLabel="Record UDIN" />
        </form>
      </FormDialog>

      <FormDialog
        description="Record custody only. Never enter DSC PINs, passwords, or private keys into this register."
        onClose={onClose}
        open={open === "dsc"}
        title="Register a digital signature"
      >
        <form action={dscAction} className="form-dialog-form">
          <FormDialogBody>
            {dscState.error && <p className="package-form-banner" role="alert">{dscState.error}</p>}
            <label><span>Client</span><select defaultValue="" name="legalEntityId" required><option disabled value="">Select a client</option>{clientOptions}</select>{fieldError(dscState.fieldErrors.legalEntityId)}</label>
            <label><span>Certificate holder</span><input maxLength={120} name="holderName" placeholder="Name printed on the DSC" required type="text" />{fieldError(dscState.fieldErrors.holderName)}</label>
            <label><span>Serial or token identifier</span><input maxLength={64} name="serialNumber" required type="text" />{fieldError(dscState.fieldErrors.serialNumber)}</label>
            <label><span>Issuing authority</span><input maxLength={120} name="issuingAuthority" placeholder="e.g. eMudhra" required type="text" />{fieldError(dscState.fieldErrors.issuingAuthority)}</label>
            <label><span>Class</span><select defaultValue="class_3" name="certificateClass">{dscCertificateClasses.map((value) => <option key={value} value={value}>{classLabels[value]}</option>)}</select></label>
            <label><span>Custodian</span><select defaultValue="" name="custodianUserId" required><option disabled value="">Who holds the token</option>{memberOptions}</select>{fieldError(dscState.fieldErrors.custodianUserId)}</label>
            <label><span>Valid from</span><input defaultValue={todayKey} name="validFrom" required type="date" />{fieldError(dscState.fieldErrors.validFrom)}</label>
            <label><span>Valid until</span><input name="validUntil" required type="date" />{fieldError(dscState.fieldErrors.validUntil)}</label>
            <label className="form-dialog-wide"><span>Storage location</span><input maxLength={160} name="storageLocation" placeholder="e.g. Cabinet 2, tray B" type="text" />{fieldError(dscState.fieldErrors.storageLocation)}</label>
            <label className="form-dialog-wide"><span>Notes</span><textarea maxLength={1000} name="notes" rows={2} />{fieldError(dscState.fieldErrors.notes)}</label>
          </FormDialogBody>
          <FormDialogActions onCancel={onClose} pending={dscPending} submitLabel="Register certificate" />
        </form>
      </FormDialog>

      <FormDialog
        description="Record the notice and its response deadline so the firm is alerted before it lapses."
        onClose={onClose}
        open={open === "notice"}
        title="Log a statutory notice"
      >
        <form action={noticeAction} className="form-dialog-form">
          <FormDialogBody>
            {noticeState.error && <p className="package-form-banner" role="alert">{noticeState.error}</p>}
            <label><span>Client</span><select defaultValue="" name="legalEntityId" required><option disabled value="">Select a client</option>{clientOptions}</select>{fieldError(noticeState.fieldErrors.legalEntityId)}</label>
            <label><span>Authority</span><select defaultValue="income_tax" name="authority">{noticeAuthorities.map((value) => <option key={value} value={value}>{authorityLabels[value]}</option>)}</select></label>
            <label><span>Notice number</span><input maxLength={80} name="noticeNumber" required type="text" />{fieldError(noticeState.fieldErrors.noticeNumber)}</label>
            <label><span>Section</span><input maxLength={60} name="noticeSection" placeholder="e.g. 143(1)" type="text" />{fieldError(noticeState.fieldErrors.noticeSection)}</label>
            <label><span>Notice date</span><input name="noticeDate" required type="date" />{fieldError(noticeState.fieldErrors.noticeDate)}</label>
            <label><span>Received on</span><input defaultValue={todayKey} name="receivedDate" required type="date" />{fieldError(noticeState.fieldErrors.receivedDate)}</label>
            <label><span>Response due</span><input name="responseDueDate" required type="date" />{fieldError(noticeState.fieldErrors.responseDueDate)}</label>
            <label><span>Owner</span><select defaultValue="" name="assigneeId"><option value="">Unassigned</option>{memberOptions}</select></label>
            <label><span>Linked obligation</span><select defaultValue="" name="workItemId"><option value="">None</option>{workOptions}</select></label>
            <label className="form-dialog-wide"><span>Subject</span><input maxLength={200} name="subject" placeholder="What the notice asks for" required type="text" />{fieldError(noticeState.fieldErrors.subject)}</label>
          </FormDialogBody>
          <FormDialogActions onCancel={onClose} pending={noticePending} submitLabel="Log notice" />
        </form>
      </FormDialog>
    </>
  );
}
