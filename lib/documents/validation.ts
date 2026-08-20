export const DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;

export const documentMimeTypes = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "text/csv",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
] as const;

export type DocumentRequestFields = {
  description: string;
  dueDate: string;
  legalEntityId: string;
  title: string;
  workItemId: string;
};

export type DocumentRequestInput = Omit<DocumentRequestFields, "workItemId"> & { workItemId: string | null };
export type DocumentActionState = { error: string; fieldErrors: Record<string, string> };
export type DocumentUploadRelationOption = { id: string; legalEntityId: string };

export function reconcileDocumentUploadRelations<
  WorkOption extends DocumentUploadRelationOption,
  RequestOption extends DocumentUploadRelationOption,
>({ legalEntityId, workItemId, requestId, work, requests }: {
  legalEntityId: string;
  workItemId: string;
  requestId: string;
  work: WorkOption[];
  requests: RequestOption[];
}) {
  const availableWork = work.filter((item) => item.legalEntityId === legalEntityId);
  const availableRequests = requests.filter((request) => request.legalEntityId === legalEntityId);
  return {
    work: availableWork,
    requests: availableRequests,
    workItemId: availableWork.some((item) => item.id === workItemId) ? workItemId : "",
    requestId: availableRequests.some((request) => request.id === requestId) ? requestId : "",
  };
}

export function documentUploadRepositoryErrorState(code: string): DocumentActionState | null {
  if (code === "client_not_found") {
    return { error: "Review the highlighted fields.", fieldErrors: { legalEntityId: "The selected client is no longer active. Choose another client." } };
  }
  if (code === "work_not_found") {
    return { error: "Review the highlighted fields.", fieldErrors: { workItemId: "Choose work that belongs to the selected client." } };
  }
  if (code === "request_not_found" || code === "request_closed") {
    return { error: "Review the highlighted fields.", fieldErrors: { requestId: "This request is no longer open. Choose another request." } };
  }
  if (code === "request_mismatch") {
    return {
      error: "Review the highlighted fields.",
      fieldErrors: {
        requestId: "The request does not match the selected work item.",
        workItemId: "Choose work linked to the selected request, or leave this field empty.",
      },
    };
  }
  return null;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function validDateKey(value: string) {
  if (!DATE_PATTERN.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

export function validateDocumentRequestFields(fields: DocumentRequestFields):
  | { success: true; data: DocumentRequestInput }
  | { success: false; fieldErrors: Record<string, string> } {
  const title = fields.title.trim();
  const description = fields.description.trim();
  const fieldErrors: Record<string, string> = {};
  if (!UUID_PATTERN.test(fields.legalEntityId)) fieldErrors.legalEntityId = "Choose an active client.";
  if (fields.workItemId && !UUID_PATTERN.test(fields.workItemId)) fieldErrors.workItemId = "Choose a valid work item.";
  if (title.length < 3 || title.length > 120) fieldErrors.title = "Use 3 to 120 characters.";
  if (description.length > 500) fieldErrors.description = "Use no more than 500 characters.";
  if (!validDateKey(fields.dueDate)) {
    fieldErrors.dueDate = "Enter a valid due date.";
  }
  if (Object.keys(fieldErrors).length) return { success: false, fieldErrors };
  return { success: true, data: { description, dueDate: fields.dueDate, legalEntityId: fields.legalEntityId, title, workItemId: fields.workItemId || null } };
}

export function validateDocumentFile(file: File | null): string | null {
  if (!file || file.size === 0) return "Choose a non-empty file.";
  if (file.size > DOCUMENT_MAX_BYTES) return "The file must be 10 MB or smaller.";
  if (!documentMimeTypes.includes(file.type as typeof documentMimeTypes[number])) {
    return "Upload a PDF, JPG, PNG, CSV, or XLSX file.";
  }
  const extension = `.${file.name.replaceAll("\\", "/").split("/").pop()?.split(".").pop()?.toLowerCase() ?? ""}`;
  const allowedExtensions: Record<typeof documentMimeTypes[number], string[]> = {
    "application/pdf": [".pdf"],
    "image/jpeg": [".jpg", ".jpeg"],
    "image/png": [".png"],
    "text/csv": [".csv"],
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
  };
  if (!allowedExtensions[file.type as typeof documentMimeTypes[number]].includes(extension)) {
    return "The filename extension does not match the selected file type.";
  }
  return null;
}

export function validateDocumentBytes(file: File, bytes: Uint8Array): string | null {
  const startsWith = (...signature: number[]) => signature.every((value, index) => bytes[index] === value);
  if (file.type === "application/pdf" && !startsWith(0x25, 0x50, 0x44, 0x46, 0x2d)) return "The file contents are not a valid PDF signature.";
  if (file.type === "image/jpeg" && !startsWith(0xff, 0xd8, 0xff)) return "The file contents are not a valid JPEG signature.";
  if (file.type === "image/png" && !startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "The file contents are not a valid PNG signature.";
  if (file.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" && !startsWith(0x50, 0x4b, 0x03, 0x04)) return "The file contents are not a valid XLSX container signature.";
  if (file.type === "text/csv") {
    if (bytes.includes(0)) return "CSV uploads must be plain text.";
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      return "CSV uploads must contain valid UTF-8 text.";
    }
  }
  return null;
}

export function safeOriginalFileName(value: string) {
  const leaf = value.replaceAll("\\", "/").split("/").pop()?.trim() ?? "document";
  return leaf.replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, "").slice(0, 180) || "document";
}
