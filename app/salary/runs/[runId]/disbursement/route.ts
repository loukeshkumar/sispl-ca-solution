import { NextResponse } from "next/server";

import { authorizeRoutePermission } from "../../../../../lib/auth/server";
import { getDatabase } from "../../../../../lib/dashboard/postgres/pool";
import { buildDisbursementCsv } from "../../../../../lib/payroll/disbursement";
import { DisbursementError, prepareDisbursement, recordDisbursementBatch } from "../../../../../lib/payroll/disbursement-repository";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Generating the bank file is a money-adjacent action, so it requires the same
 * authority as approving payroll rather than merely preparing it.
 */
export async function GET(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const authorization = await authorizeRoutePermission("salary:approve");
  if (!authorization.ok) {
    if (authorization.reason === "password_change_required") return NextResponse.redirect(new URL("/account/change-password", request.url), 307);
    return NextResponse.json(
      { error: authorization.reason === "authentication_required" ? "Authentication required." : "Permission denied." },
      { status: authorization.reason === "authentication_required" ? 401 : 403 },
    );
  }
  const { session } = authorization;
  const { runId } = await params;
  if (!UUID_PATTERN.test(runId)) return NextResponse.json({ error: "Invalid payroll run reference." }, { status: 400 });

  try {
    const prepared = await prepareDisbursement(getDatabase(), session.tenantId, runId);
    const { batchReference } = await recordDisbursementBatch(getDatabase(), session.tenantId, session.userId, {
      runId: prepared.runId,
      periodKey: prepared.periodKey,
      paymentDate: prepared.payDate,
      batch: prepared.batch,
    });
    const csv = buildDisbursementCsv(prepared.batch, { paymentDate: prepared.payDate });
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${batchReference}.csv"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "X-Disbursement-Excluded": String(prepared.batch.exclusions.length),
      },
    });
  } catch (error) {
    if (error instanceof DisbursementError) {
      // The message is safe: it never contains an account number.
      return NextResponse.json({ error: error.message }, { status: error.code === "not_found" ? 404 : 409 });
    }
    console.error("Disbursement generation failed.", { errorType: error instanceof Error ? error.name : "UnknownError" });
    return NextResponse.json({ error: "The disbursement file could not be generated." }, { status: 500 });
  }
}
