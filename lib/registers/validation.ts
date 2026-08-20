export const udinDocumentTypes = ["tax_audit", "statutory_audit", "gst_audit", "certificate", "itr_filing", "roc_filing", "other"] as const;
export const dscCertificateClasses = ["class_2", "class_3", "dgft"] as const;
export const noticeAuthorities = ["income_tax", "gst", "tds", "roc", "other"] as const;
export const noticeStatuses = ["open", "in_progress", "responded", "closed"] as const;

export type UdinDocumentType = typeof udinDocumentTypes[number];
export type DscCertificateClass = typeof dscCertificateClasses[number];
export type NoticeAuthority = typeof noticeAuthorities[number];
export type NoticeStatus = typeof noticeStatuses[number];

export type UdinInput = {
  legalEntityId: string;
  workItemId: string | null;
  udin: string;
  documentType: UdinDocumentType;
  documentDescription: string;
  membershipNumber: string;
  signedByUserId: string;
  generatedOn: string;
};

export type DscInput = {
  legalEntityId: string;
  holderName: string;
  serialNumber: string;
  issuingAuthority: string;
  certificateClass: DscCertificateClass;
  validFrom: string;
  validUntil: string;
  custodianUserId: string;
  storageLocation: string;
  notes: string;
};

export type NoticeInput = {
  legalEntityId: string;
  workItemId: string | null;
  authority: NoticeAuthority;
  noticeNumber: string;
  noticeSection: string;
  subject: string;
  noticeDate: string;
  receivedDate: string;
  responseDueDate: string;
  assigneeId: string | null;
};

export type RegisterFields = Record<string, string | undefined>;
export type FieldErrors<K extends string> = Partial<Record<K, string>>;
export type RegisterActionState<K extends string> = { error: string; fieldErrors: FieldErrors<K> };

export type UdinFieldErrors = FieldErrors<keyof UdinInput>;
export type DscFieldErrors = FieldErrors<keyof DscInput>;
export type NoticeFieldErrors = FieldErrors<keyof NoticeInput>;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UDIN_PATTERN = /^[0-9]{8}[A-Za-z0-9]{10}$/;
const MEMBERSHIP_PATTERN = /^[0-9]{6}$/;
const SERIAL_PATTERN = /^[A-Za-z0-9:_-]{4,64}$/;
const SECRET_HINT = /\b(pin|password|passphrase|otp|private\s*key)\b/i;

function text(fields: RegisterFields, key: string) {
  return fields[key]?.trim() ?? "";
}

export function isDateKey(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

export function validateUdinFields(fields: RegisterFields):
  | { success: true; data: UdinInput }
  | { success: false; fieldErrors: UdinFieldErrors } {
  const legalEntityId = text(fields, "legalEntityId");
  const workItemId = text(fields, "workItemId");
  const udin = text(fields, "udin").toUpperCase();
  const documentType = text(fields, "documentType");
  const documentDescription = text(fields, "documentDescription");
  const membershipNumber = text(fields, "membershipNumber");
  const signedByUserId = text(fields, "signedByUserId");
  const generatedOn = text(fields, "generatedOn");
  const fieldErrors: UdinFieldErrors = {};

  if (!UUID_PATTERN.test(legalEntityId)) fieldErrors.legalEntityId = "Select an active client.";
  if (workItemId && !UUID_PATTERN.test(workItemId)) fieldErrors.workItemId = "Select a valid work item.";
  if (!UDIN_PATTERN.test(udin)) fieldErrors.udin = "Enter the 18-character UDIN generated on the ICAI portal.";
  if (!udinDocumentTypes.includes(documentType as UdinDocumentType)) fieldErrors.documentType = "Select the signed document type.";
  if (documentDescription.length < 2 || documentDescription.length > 200) fieldErrors.documentDescription = "Describe the signed document in 2 to 200 characters.";
  if (!MEMBERSHIP_PATTERN.test(membershipNumber)) fieldErrors.membershipNumber = "Enter the six-digit ICAI membership number.";
  if (!UUID_PATTERN.test(signedByUserId)) fieldErrors.signedByUserId = "Select the signing member.";
  if (!isDateKey(generatedOn)) fieldErrors.generatedOn = "Enter the date the UDIN was generated.";

  if (Object.keys(fieldErrors).length) return { success: false, fieldErrors };
  return {
    success: true,
    data: { legalEntityId, workItemId: workItemId || null, udin, documentType: documentType as UdinDocumentType, documentDescription, membershipNumber, signedByUserId, generatedOn },
  };
}

export function validateDscFields(fields: RegisterFields):
  | { success: true; data: DscInput }
  | { success: false; fieldErrors: DscFieldErrors } {
  const legalEntityId = text(fields, "legalEntityId");
  const holderName = text(fields, "holderName").replace(/\s+/g, " ");
  const serialNumber = text(fields, "serialNumber");
  const issuingAuthority = text(fields, "issuingAuthority");
  const certificateClass = text(fields, "certificateClass");
  const validFrom = text(fields, "validFrom");
  const validUntil = text(fields, "validUntil");
  const custodianUserId = text(fields, "custodianUserId");
  const storageLocation = text(fields, "storageLocation");
  const notes = text(fields, "notes");
  const fieldErrors: DscFieldErrors = {};

  if (!UUID_PATTERN.test(legalEntityId)) fieldErrors.legalEntityId = "Select an active client.";
  if (holderName.length < 2 || holderName.length > 120) fieldErrors.holderName = "Enter the certificate holder's name.";
  if (!SERIAL_PATTERN.test(serialNumber)) fieldErrors.serialNumber = "Enter the certificate serial or token identifier.";
  if (issuingAuthority.length < 2 || issuingAuthority.length > 120) fieldErrors.issuingAuthority = "Enter the issuing certifying authority.";
  if (!dscCertificateClasses.includes(certificateClass as DscCertificateClass)) fieldErrors.certificateClass = "Select the certificate class.";
  if (!isDateKey(validFrom)) fieldErrors.validFrom = "Enter the validity start date.";
  if (!isDateKey(validUntil)) fieldErrors.validUntil = "Enter the validity end date.";
  if (isDateKey(validFrom) && isDateKey(validUntil) && validUntil < validFrom) fieldErrors.validUntil = "Validity cannot end before it starts.";
  if (!UUID_PATTERN.test(custodianUserId)) fieldErrors.custodianUserId = "Select the employee holding the token.";
  if (storageLocation.length > 160) fieldErrors.storageLocation = "Storage location cannot exceed 160 characters.";
  if (notes.length > 1000) fieldErrors.notes = "Notes cannot exceed 1000 characters.";
  // The register records custody only. Credentials must never be stored with the certificate.
  if (SECRET_HINT.test(notes) || SECRET_HINT.test(storageLocation)) {
    fieldErrors.notes = "Never record DSC PINs, passwords, or private keys. Store custody details only.";
  }

  if (Object.keys(fieldErrors).length) return { success: false, fieldErrors };
  return {
    success: true,
    data: { legalEntityId, holderName, serialNumber, issuingAuthority, certificateClass: certificateClass as DscCertificateClass, validFrom, validUntil, custodianUserId, storageLocation, notes },
  };
}

export function validateNoticeFields(fields: RegisterFields):
  | { success: true; data: NoticeInput }
  | { success: false; fieldErrors: NoticeFieldErrors } {
  const legalEntityId = text(fields, "legalEntityId");
  const workItemId = text(fields, "workItemId");
  const authority = text(fields, "authority");
  const noticeNumber = text(fields, "noticeNumber");
  const noticeSection = text(fields, "noticeSection");
  const subject = text(fields, "subject");
  const noticeDate = text(fields, "noticeDate");
  const receivedDate = text(fields, "receivedDate");
  const responseDueDate = text(fields, "responseDueDate");
  const assigneeId = text(fields, "assigneeId");
  const fieldErrors: NoticeFieldErrors = {};

  if (!UUID_PATTERN.test(legalEntityId)) fieldErrors.legalEntityId = "Select an active client.";
  if (workItemId && !UUID_PATTERN.test(workItemId)) fieldErrors.workItemId = "Select a valid work item.";
  if (!noticeAuthorities.includes(authority as NoticeAuthority)) fieldErrors.authority = "Select the issuing authority.";
  if (noticeNumber.length < 2 || noticeNumber.length > 80) fieldErrors.noticeNumber = "Enter the notice reference number.";
  if (noticeSection.length > 60) fieldErrors.noticeSection = "Section cannot exceed 60 characters.";
  if (subject.length < 2 || subject.length > 200) fieldErrors.subject = "Summarise the notice in 2 to 200 characters.";
  if (!isDateKey(noticeDate)) fieldErrors.noticeDate = "Enter the notice date.";
  if (!isDateKey(receivedDate)) fieldErrors.receivedDate = "Enter the date the notice was received.";
  if (!isDateKey(responseDueDate)) fieldErrors.responseDueDate = "Enter the response deadline.";
  if (isDateKey(noticeDate) && isDateKey(receivedDate) && receivedDate < noticeDate) fieldErrors.receivedDate = "A notice cannot be received before it was issued.";
  if (isDateKey(receivedDate) && isDateKey(responseDueDate) && responseDueDate < receivedDate) fieldErrors.responseDueDate = "The response deadline cannot precede receipt.";
  if (assigneeId && !UUID_PATTERN.test(assigneeId)) fieldErrors.assigneeId = "Select a valid owner.";

  if (Object.keys(fieldErrors).length) return { success: false, fieldErrors };
  return {
    success: true,
    data: { legalEntityId, workItemId: workItemId || null, authority: authority as NoticeAuthority, noticeNumber, noticeSection, subject, noticeDate, receivedDate, responseDueDate, assigneeId: assigneeId || null },
  };
}
