import { NextResponse } from "next/server";

import { authorizeRoutePermission } from "../../../../lib/auth/server";
import { getDatabase } from "../../../../lib/dashboard/postgres/pool";
import { loadTallyInvoiceExport, loadTallyLedgerExport } from "../../../../lib/filings/repository";
import { buildTallyLedgerXml, buildTallySalesVoucherXml } from "../../../../lib/integrations/tally";

export const dynamic = "force-dynamic";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: Request) {
  const authorization = await authorizeRoutePermission("billing:read");
  if (!authorization.ok) {
    if (authorization.reason === "password_change_required") return NextResponse.redirect(new URL("/account/change-password", request.url), 307);
    return NextResponse.json(
      { error: authorization.reason === "authentication_required" ? "Authentication required." : "Permission denied." },
      { status: authorization.reason === "authentication_required" ? 401 : 403 },
    );
  }
  const { session } = authorization;
  const url = new URL(request.url);
  const dataset = url.searchParams.get("dataset") ?? "invoices";
  if (dataset !== "invoices" && dataset !== "ledgers") {
    return NextResponse.json({ error: "dataset must be invoices or ledgers." }, { status: 400 });
  }
  const from = url.searchParams.get("from") ?? "";
  const to = url.searchParams.get("to") ?? "";
  if (dataset === "invoices" && (!DATE_PATTERN.test(from) || !DATE_PATTERN.test(to) || to < from)) {
    return NextResponse.json({ error: "Provide a valid from and to date." }, { status: 400 });
  }
  try {
    const xml = dataset === "ledgers"
      ? buildTallyLedgerXml(await loadTallyLedgerExport(getDatabase(), session.tenantId))
      : buildTallySalesVoucherXml(await loadTallyInvoiceExport(getDatabase(), session.tenantId, { from, to }));
    const fileName = dataset === "ledgers" ? "sispl-tally-ledgers.xml" : `sispl-tally-invoices-${from}-to-${to}.xml`;
    return new NextResponse(xml, {
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("Tally export failed.", { errorType: error instanceof Error ? error.name : "UnknownError" });
    return NextResponse.json({ error: "The export could not be generated." }, { status: 500 });
  }
}
