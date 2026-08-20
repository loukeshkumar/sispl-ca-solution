import { NextResponse } from "next/server";
import { createHash } from "node:crypto";

import { authorizeRoutePermission } from "../../../../lib/auth/server";
import { getDatabase } from "../../../../lib/dashboard/postgres/pool";
import { canViewInline } from "../../../../lib/documents/library";
import { getDocumentMetadata } from "../../../../lib/documents/repository";
import { readDocumentFile } from "../../../../lib/documents/storage";
import { safeOriginalFileName } from "../../../../lib/documents/validation";

export const dynamic = "force-dynamic";

/**
 * Serves a stored document for viewing in the browser.
 *
 * Inline delivery is the dangerous half of "view and download": a file served
 * inline runs in this application's origin, so an uploaded .html or .svg could
 * execute script against the signed-in session. Three things prevent that:
 *
 *  - only an allow-list of inert types is ever served inline; anything else is
 *    refused here and offered as a download instead,
 *  - the Content-Type is taken from that allow-list rather than from the stored
 *    value, so a mislabelled upload cannot pick its own handler, and
 *  - a sandbox CSP plus `nosniff` stop scripts, plugins and same-origin access
 *    even if a file slips through as an allowed type.
 *
 * The stored bytes are re-hashed before serving, so a file altered on disk
 * fails rather than being handed to the reader.
 */
export async function GET(request: Request, { params }: { params: Promise<{ documentId: string }> }) {
  const authorization = await authorizeRoutePermission("documents:read");
  if (!authorization.ok) {
    if (authorization.reason === "password_change_required") return NextResponse.redirect(new URL("/account/change-password", request.url), 307);
    return NextResponse.json({ error: authorization.reason === "authentication_required" ? "Authentication required." : "Permission denied." }, { status: authorization.reason === "authentication_required" ? 401 : 403 });
  }
  const { session } = authorization;
  const { documentId } = await params;
  const document = await getDocumentMetadata(getDatabase(), session.tenantId, documentId);
  if (!document) return NextResponse.json({ error: "Document not found." }, { status: 404 });

  const mimeType = document.mimeType.toLowerCase();
  if (!canViewInline(mimeType)) {
    return NextResponse.json({ error: "This file type cannot be previewed. Download it instead." }, { status: 415 });
  }

  try {
    const bytes = await readDocumentFile(session.tenantId, document.storageName);
    if (bytes.byteLength !== document.sizeBytes || createHash("sha256").update(bytes).digest("hex") !== document.sha256) {
      return NextResponse.json({ error: "The stored file failed its integrity check." }, { status: 410 });
    }
    const name = safeOriginalFileName(document.originalName).replaceAll('"', "'");
    return new NextResponse(bytes, { headers: {
      "Cache-Control": "private, no-store",
      // Inert even if an allowed type were ever made to carry active content.
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; object-src 'none'; script-src 'none'; style-src 'unsafe-inline'; sandbox",
      "Content-Disposition": `inline; filename="${name}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Content-Length": String(document.sizeBytes),
      "Content-Type": mimeType,
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "SAMEORIGIN",
    } });
  } catch {
    return NextResponse.json({ error: "The stored file is unavailable." }, { status: 410 });
  }
}
