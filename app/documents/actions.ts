"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requirePermission } from "../../lib/auth/server";
import { getDatabase } from "../../lib/dashboard/postgres/pool";
import { cancelDocumentRequest, createDocumentRequest, createPendingDocumentUpload, discardPendingDocumentUpload, DocumentRepositoryError, finalizePendingDocumentUpload } from "../../lib/documents/repository";
import { listDocumentFormOptions, listDocumentWorkspace } from "../../lib/documents/repository";
import { listActiveChecklistOptions } from "../../lib/master-data/repository";
import { loadOptionalPanel } from "../../lib/dashboard/optional-panel";
import { indiaDateKey } from "../../lib/registers/repository";
import { commitStagedDocument, removeDocumentFile, removeStagedDocument, stageDocumentFile } from "../../lib/documents/storage";
import { documentUploadRepositoryErrorState, safeOriginalFileName, validateDocumentBytes, validateDocumentFile, validateDocumentRequestFields, type DocumentActionState, type DocumentRequestFields } from "../../lib/documents/validation";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function stringField(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function actionError(message = "The document workflow could not be saved. Review the details and try again."): DocumentActionState {
  return { error: message, fieldErrors: {} };
}

export type DocumentFormOptions = Awaited<ReturnType<typeof listDocumentFormOptions>> & {
  checklist: Awaited<ReturnType<typeof listActiveChecklistOptions>>;
  todayKey: string;
};

/** Loaded when the dialog first opens rather than on every dashboard render. */
export async function loadDocumentFormOptions(): Promise<DocumentFormOptions> {
  const session = await requirePermission("documents:write", "/?workspace=documents");
  const [options, checklist] = await Promise.all([
    listDocumentFormOptions(getDatabase(), session.tenantId),
    // The checklist only speeds the form up; raising a request must work without it.
    loadOptionalPanel("document-checklist", () => listActiveChecklistOptions(getDatabase(), session.tenantId), []),
  ]);
  return { ...options, checklist, todayKey: indiaDateKey() };
}

export type DocumentUploadOptions = Awaited<ReturnType<typeof listDocumentFormOptions>> & {
  requests: Array<{ clientName: string; id: string; legalEntityId: string; title: string }>;
};

/** Loaded when the upload dialog first opens rather than on every render. */
export async function loadDocumentUploadOptions(): Promise<DocumentUploadOptions> {
  const session = await requirePermission("documents:write", "/?workspace=client-documents");
  const database = getDatabase();
  const [options, workspace] = await Promise.all([
    listDocumentFormOptions(database, session.tenantId),
    listDocumentWorkspace(database, session.tenantId),
  ]);
  return {
    ...options,
    // Only open requests can be fulfilled by an upload.
    requests: workspace.requests
      .filter((request) => request.status === "requested")
      .map(({ clientName, id, legalEntityId, title }) => ({ clientName, id, legalEntityId, title })),
  };
}

export async function createDocumentRequestAction(_previous: DocumentActionState, formData: FormData): Promise<DocumentActionState> {
  const session = await requirePermission("documents:write", "/?workspace=documents");
  const fields: DocumentRequestFields = {
    description: stringField(formData, "description"), dueDate: stringField(formData, "dueDate"),
    legalEntityId: stringField(formData, "legalEntityId"), title: stringField(formData, "title"), workItemId: stringField(formData, "workItemId"),
  };
  const validation = validateDocumentRequestFields(fields);
  if (!validation.success) return { error: "Review the highlighted fields.", fieldErrors: validation.fieldErrors };
  try {
    await createDocumentRequest(getDatabase(), session.tenantId, session.userId, validation.data);
  } catch {
    return actionError();
  }
  revalidatePath("/");
  redirect("/?workspace=documents");
}

export async function uploadDocumentAction(_previous: DocumentActionState, formData: FormData): Promise<DocumentActionState> {
  const session = await requirePermission("documents:write", "/?workspace=documents");
  const legalEntityId = stringField(formData, "legalEntityId");
  const workItemId = stringField(formData, "workItemId");
  const requestId = stringField(formData, "requestId");
  const fileValue = formData.get("document");
  const file = fileValue instanceof File ? fileValue : null;
  const fieldErrors: Record<string, string> = {};
  if (!UUID_PATTERN.test(legalEntityId)) fieldErrors.legalEntityId = "Choose an active client.";
  if (workItemId && !UUID_PATTERN.test(workItemId)) fieldErrors.workItemId = "Choose a valid work item.";
  if (requestId && !UUID_PATTERN.test(requestId)) fieldErrors.requestId = "Choose a valid request.";
  const fileError = validateDocumentFile(file);
  if (fileError) fieldErrors.document = fileError;
  if (Object.keys(fieldErrors).length || !file) return { error: "Review the highlighted fields.", fieldErrors };

  let stored: Awaited<ReturnType<typeof stageDocumentFile>> | null = null;
  let documentId = "";
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const contentError = validateDocumentBytes(file, bytes);
    if (contentError) return { error: "The file contents do not match the selected format.", fieldErrors: { document: contentError } };
    stored = await stageDocumentFile(session.tenantId, bytes);
    documentId = await createPendingDocumentUpload(getDatabase(), session.tenantId, session.userId, {
      legalEntityId, workItemId: workItemId || null, requestId: requestId || null,
      originalName: safeOriginalFileName(file.name), mimeType: file.type, sizeBytes: file.size, ...stored,
    });
    await commitStagedDocument(session.tenantId, stored.storageName);
    await finalizePendingDocumentUpload(getDatabase(), session.tenantId, session.userId, documentId);
  } catch (error) {
    const discarded = documentId ? await discardPendingDocumentUpload(getDatabase(), session.tenantId, documentId).catch(() => null) : null;
    if (!documentId || discarded) {
      if (stored) {
        await Promise.all([
          removeStagedDocument(session.tenantId, stored.storageName),
          removeDocumentFile(session.tenantId, stored.storageName),
        ]);
      }
    } else {
      revalidatePath("/");
      redirect("/?workspace=documents");
    }
    if (error instanceof DocumentRepositoryError) {
      const relationshipError = documentUploadRepositoryErrorState(error.code);
      if (relationshipError) return relationshipError;
    }
    return actionError("The file could not be stored. Confirm the client, request, and file details, then try again.");
  }
  revalidatePath("/");
  redirect("/?workspace=documents");
}

export async function cancelDocumentRequestAction(formData: FormData) {
  const requestId = stringField(formData, "requestId");
  const session = await requirePermission("documents:write", "/?workspace=documents");
  if (UUID_PATTERN.test(requestId)) {
    try {
      await cancelDocumentRequest(getDatabase(), session.tenantId, session.userId, requestId);
    } catch {
      // The workspace remains the safe recovery destination for stale requests.
    }
  }
  revalidatePath("/");
  redirect("/?workspace=documents");
}
