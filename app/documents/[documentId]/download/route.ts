import { NextResponse } from "next/server";
import { createHash } from "node:crypto";

import { authorizeRoutePermission } from "../../../../lib/auth/server";
import { getDatabase } from "../../../../lib/dashboard/postgres/pool";
import { getDocumentMetadata } from "../../../../lib/documents/repository";
import { readDocumentFile } from "../../../../lib/documents/storage";
import { safeOriginalFileName } from "../../../../lib/documents/validation";

export const dynamic = "force-dynamic";

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
  try {
    const bytes = await readDocumentFile(session.tenantId, document.storageName);
    if (bytes.byteLength !== document.sizeBytes || createHash("sha256").update(bytes).digest("hex") !== document.sha256) {
      return NextResponse.json({ error: "The stored file failed its integrity check." }, { status: 410 });
    }
    const name = safeOriginalFileName(document.originalName).replaceAll('"', "'");
    return new NextResponse(bytes, { headers: {
      "Content-Disposition": `attachment; filename="${name}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Content-Length": String(document.sizeBytes), "Content-Type": "application/octet-stream",
      "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
    } });
  } catch {
    return NextResponse.json({ error: "The stored file is unavailable." }, { status: 410 });
  }
}
