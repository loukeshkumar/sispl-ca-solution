"use server";

import { cookies, headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { auditEvents } from "../../db/schema";
import { getDatabase } from "../../lib/dashboard/postgres/pool";
import { hashPassword, verifyPassword } from "../../lib/auth/password";
import { getLoginRateLimits } from "../../lib/auth/rate-limit";
import { consumeLoginRateLimit } from "../../lib/auth/repository";
import { createSessionToken, hashSessionToken, isSessionToken } from "../../lib/auth/tokens";
import {
  changePortalPassword,
  clearFailedPortalLogins,
  createPortalSessionRecord,
  findPortalLoginIdentity,
  getPortalDocumentRequest,
  recordFailedPortalLogin,
  revokePortalSessionByTokenHash,
} from "../../lib/portal/repository";
import {
  clearPortalSessionCookie,
  PORTAL_SESSION_COOKIE_NAME,
  PORTAL_SESSION_DURATION_MS,
  requirePortalSession,
  setPortalSessionCookie,
} from "../../lib/portal/server";
import { validatePortalPassword, type PortalPasswordActionState } from "../../lib/portal/validation";
import { createPendingDocumentUpload, discardPendingDocumentUpload, DocumentRepositoryError, finalizePendingDocumentUpload } from "../../lib/documents/repository";
import { commitStagedDocument, removeDocumentFile, removeStagedDocument, stageDocumentFile } from "../../lib/documents/storage";
import { safeOriginalFileName, validateDocumentBytes, validateDocumentFile, type DocumentActionState } from "../../lib/documents/validation";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const INVALID_LOGIN = "The email, password, or firm ID is incorrect, or the account is temporarily locked.";

export type PortalLoginState = { error: string };

function textField(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function rawField(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

export async function portalLoginAction(_previous: PortalLoginState, formData: FormData): Promise<PortalLoginState> {
  const email = textField(formData, "email").toLowerCase();
  const password = rawField(formData, "password");
  const tenantSlug = textField(formData, "tenantSlug").toLowerCase();
  const database = getDatabase();
  let token = "";
  let expiresAt = new Date();

  try {
    const now = new Date();
    const rateLimits = getLoginRateLimits(await headers(), process.env);
    const decisions = await Promise.all(rateLimits.map((limit) => consumeLoginRateLimit(database, limit.keyHash, now, limit.maximumAttempts)));
    if (decisions.some((allowed) => !allowed)) {
      await verifyPassword(password, "invalid");
      return { error: INVALID_LOGIN };
    }
    if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 254 || password.length > 128 || !/^[a-z0-9-]{2,80}$/.test(tenantSlug)) {
      await verifyPassword(password, "invalid");
      return { error: INVALID_LOGIN };
    }
    const identity = await findPortalLoginIdentity(database, email, tenantSlug);
    const locked = Boolean(identity?.lockedUntil && identity.lockedUntil > now);
    const validPassword = await verifyPassword(password, identity?.passwordHash ?? "invalid");
    if (!identity || locked || !validPassword) {
      if (identity && !locked) await recordFailedPortalLogin(database, identity.portalUserId, now);
      return { error: INVALID_LOGIN };
    }
    await clearFailedPortalLogins(database, identity.portalUserId);
    token = createSessionToken();
    expiresAt = new Date(now.getTime() + PORTAL_SESSION_DURATION_MS);
    await createPortalSessionRecord(database, {
      tenantId: identity.tenantId,
      portalUserId: identity.portalUserId,
      tokenHash: hashSessionToken(token),
      expiresAt,
    });
  } catch {
    return { error: "Sign-in is temporarily unavailable. Try again shortly." };
  }

  await setPortalSessionCookie(token, expiresAt);
  redirect("/portal");
}

export async function portalLogoutAction() {
  const cookieStore = await cookies();
  const token = cookieStore.get(PORTAL_SESSION_COOKIE_NAME)?.value ?? "";
  if (isSessionToken(token)) {
    try {
      await revokePortalSessionByTokenHash(getDatabase(), hashSessionToken(token));
    } catch {
      // The cookie is still cleared when the database is unavailable.
    }
  }
  await clearPortalSessionCookie();
  redirect("/portal/login");
}

export async function portalChangePasswordAction(_previous: PortalPasswordActionState, formData: FormData): Promise<PortalPasswordActionState> {
  const session = await requirePortalSession({ allowPasswordChange: true });
  const password = rawField(formData, "password");
  const confirmPassword = rawField(formData, "confirmPassword");
  const fieldErrors = validatePortalPassword(password, confirmPassword);
  if (Object.keys(fieldErrors).length) return { error: "Review the highlighted fields.", fieldErrors };
  try {
    await changePortalPassword(getDatabase(), session.tenantId, session.portalUserId, await hashPassword(password));
  } catch {
    return { error: "The password could not be changed. Try again.", fieldErrors: {} };
  }
  await clearPortalSessionCookie();
  redirect("/portal/login?passwordChanged=1");
}

export async function portalUploadAction(_previous: DocumentActionState, formData: FormData): Promise<DocumentActionState> {
  const session = await requirePortalSession();
  const requestId = textField(formData, "requestId");
  const fileValue = formData.get("document");
  const file = fileValue instanceof File ? fileValue : null;
  const fieldErrors: Record<string, string> = {};
  if (!UUID_PATTERN.test(requestId)) fieldErrors.requestId = "Choose an open request.";
  const fileError = validateDocumentFile(file);
  if (fileError) fieldErrors.document = fileError;
  if (Object.keys(fieldErrors).length || !file) return { error: "Review the highlighted fields.", fieldErrors };

  const database = getDatabase();
  const request = await getPortalDocumentRequest(database, session.tenantId, session.legalEntityId, requestId);
  if (!request) return { error: "That request is no longer open.", fieldErrors: { requestId: "Choose an open request." } };

  let stored: Awaited<ReturnType<typeof stageDocumentFile>> | null = null;
  let documentId = "";
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const contentError = validateDocumentBytes(file, bytes);
    if (contentError) return { error: "The file contents do not match the selected format.", fieldErrors: { document: contentError } };
    stored = await stageDocumentFile(session.tenantId, bytes);
    documentId = await createPendingDocumentUpload(database, session.tenantId, request.requestedByUserId, {
      legalEntityId: session.legalEntityId,
      workItemId: request.workItemId,
      requestId,
      originalName: safeOriginalFileName(file.name),
      mimeType: file.type,
      sizeBytes: file.size,
      ...stored,
    });
    await commitStagedDocument(session.tenantId, stored.storageName);
    await finalizePendingDocumentUpload(database, session.tenantId, request.requestedByUserId, documentId);
    await database.insert(auditEvents).values({
      tenantId: session.tenantId,
      actorUserId: null,
      resourceType: "document",
      resourceId: documentId,
      action: "document.client_uploaded",
      reason: `Uploaded through the client portal by ${session.email}`,
    });
  } catch (error) {
    const discarded = documentId ? await discardPendingDocumentUpload(database, session.tenantId, documentId).catch(() => null) : null;
    if (!documentId || discarded) {
      if (stored) {
        await Promise.all([
          removeStagedDocument(session.tenantId, stored.storageName),
          removeDocumentFile(session.tenantId, stored.storageName),
        ]);
      }
    } else {
      revalidatePath("/portal");
      redirect("/portal?uploaded=1");
    }
    if (error instanceof DocumentRepositoryError) {
      return { error: "That request is no longer open.", fieldErrors: {} };
    }
    return { error: "The file could not be uploaded. Check the file and try again.", fieldErrors: {} };
  }
  revalidatePath("/portal");
  redirect("/portal?uploaded=1");
}
