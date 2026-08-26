import { NextResponse } from "next/server";

import { authorizeRoutePermission } from "../../../lib/auth/server";
import { getDatabase } from "../../../lib/dashboard/postgres/pool";
import { certificatesCsv, noticesCsv, registerExportFilename, udinsCsv } from "../../../lib/registers/csv";
import { indiaDateKey, listRegisterExportRows } from "../../../lib/registers/repository";

const EXPORTABLE = ["notices", "dsc", "udin"] as const;

/**
 * The whole of one register as CSV.
 *
 * A statutory register that cannot be handed to a reviewer is only half a
 * register, so this exports every row rather than the page being viewed — a
 * partial file would be read as the complete record.
 */
export async function GET(request: Request) {
  const authorization = await authorizeRoutePermission("registers:read");
  if (!authorization.ok) {
    return NextResponse.json(
      { error: "The register export is unavailable." },
      { status: authorization.reason === "authentication_required" ? 401 : 403 },
    );
  }

  const tab = new URL(request.url).searchParams.get("tab") ?? "";
  if (!(EXPORTABLE as readonly string[]).includes(tab)) {
    return NextResponse.json({ error: "Choose a register to export." }, { status: 400 });
  }

  const todayKey = indiaDateKey();
  const exported = await listRegisterExportRows(getDatabase(), authorization.session.tenantId, tab as typeof EXPORTABLE[number]);
  const body = exported.kind === "notices" ? noticesCsv(exported.rows)
    : exported.kind === "dsc" ? certificatesCsv(exported.rows)
      : udinsCsv(exported.rows);

  return new NextResponse(body, {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": `attachment; filename="${registerExportFilename(tab, todayKey)}"`,
      "Content-Type": "text/csv; charset=utf-8",
    },
  });
}
