import { NextResponse } from "next/server";

import { authorizeRoutePermission } from "../../../lib/auth/server";
import { getDatabase } from "../../../lib/dashboard/postgres/pool";
import { buildPeek, isPeekKind, PEEK_DEFINITIONS } from "../../../lib/registers/kpi-peek";
import { indiaDateKey, listRegisterExportRows } from "../../../lib/registers/repository";

/**
 * The rows behind one Registers KPI figure.
 *
 * The workspace only ever loads the register it is showing, so a figure for one
 * of the other two has nothing on the client to open. Rather than fetching all
 * three registers on every page load to serve a panel that is usually never
 * opened, the panel asks for its own list when it needs one.
 */
export async function GET(request: Request) {
  const authorization = await authorizeRoutePermission("registers:read");
  if (!authorization.ok) {
    return NextResponse.json(
      { error: "The register is unavailable." },
      { status: authorization.reason === "authentication_required" ? 401 : 403 },
    );
  }

  const kind = new URL(request.url).searchParams.get("kind") ?? "";
  if (!isPeekKind(kind) || kind === "attention") {
    // The action queue always travels with the page; asking for it here would
    // mean the caller has lost track of what it already holds.
    return NextResponse.json({ error: "Choose a register figure to open." }, { status: 400 });
  }

  const todayKey = indiaDateKey();
  const source = PEEK_DEFINITIONS[kind].source;
  const exported = await listRegisterExportRows(
    getDatabase(),
    authorization.session.tenantId,
    source === "certificates" ? "dsc" : source === "udins" ? "udin" : "notices",
  );
  const peek = exported.kind === "notices" ? buildPeek(kind, { notices: exported.rows }, todayKey)
    : exported.kind === "dsc" ? buildPeek(kind, { certificates: exported.rows }, todayKey)
      : buildPeek(kind, { udins: exported.rows }, todayKey);

  return NextResponse.json(peek, { headers: { "Cache-Control": "private, no-store" } });
}
