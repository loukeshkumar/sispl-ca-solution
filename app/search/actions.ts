"use server";

import { hasPermission } from "../../lib/auth/authorization";
import { requirePermission } from "../../lib/auth/server";
import { getDatabase } from "../../lib/dashboard/postgres/pool";
import { searchEverything, type SearchHit } from "../../lib/search/repository";

/**
 * The header's search, for every record type at once.
 *
 * Entitlement is decided here from the session rather than passed in from the
 * browser: the client says what to look for, never what it is allowed to see.
 */
export async function searchAction(query: string): Promise<SearchHit[]> {
  const session = await requirePermission("dashboard:read");
  return searchEverything(getDatabase(), session.tenantId, String(query ?? ""), {
    billing: hasPermission(session, "billing:read"),
    clients: hasPermission(session, "dashboard:read"),
    documents: hasPermission(session, "documents:read"),
    tasks: hasPermission(session, "tasks:read"),
    team: hasPermission(session, "team:read"),
    work: hasPermission(session, "dashboard:read"),
  });
}
