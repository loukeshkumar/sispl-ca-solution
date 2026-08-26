import { and, eq, ilike, or } from "drizzle-orm";

import { documentRequests, invoices, legalEntities, officeTasks, tenantMemberships, users, workItems } from "../../db/schema";
import type { DashboardDatabase } from "../dashboard/postgres/repository";

export type SearchGroup = "Clients" | "Work" | "Tasks" | "Documents" | "Invoices" | "Employees";

export type SearchHit = {
  group: SearchGroup;
  href: string;
  id: string;
  meta: string;
  title: string;
};

/** Per group, so one noisy entity cannot crowd the rest out of the panel. */
const PER_GROUP_LIMIT = 5;

/**
 * Escapes a user's text so it matches literally inside a LIKE pattern.
 *
 * Without this a search for "100%" would match every row, and a stray backslash
 * would change how the rest of the pattern is read. Parameterisation stops SQL
 * injection; this stops the *pattern* being injected.
 */
function likeTerm(term: string): string {
  return `%${term.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
}

/**
 * Searches every record type the viewer is allowed to open, in one round trip.
 *
 * Each group is gated on the same permission that guards its workspace, so the
 * header can never surface the existence of a record the reader could not open
 * by navigating. Groups the viewer lacks are not queried at all rather than
 * queried and filtered, so an unauthorised group costs nothing.
 *
 * Only fields a person would actually search by are returned. Identifiers that
 * happen to be indexed alongside them — PAN, GSTIN, mobile numbers — are never
 * selected, so they cannot leak through a result list.
 */
export async function searchEverything(
  database: DashboardDatabase,
  tenantId: string,
  rawQuery: string,
  allowed: { billing: boolean; clients: boolean; documents: boolean; tasks: boolean; team: boolean; work: boolean },
): Promise<SearchHit[]> {
  const term = rawQuery.trim();
  // Two characters is the point where a prefix stops matching most of the table.
  if (term.length < 2) return [];
  const pattern = likeTerm(term.slice(0, 80));

  const queries: Array<Promise<SearchHit[]>> = [];

  if (allowed.clients) {
    queries.push(
      database
        .select({ city: legalEntities.city, displayName: legalEntities.displayName, entityType: legalEntities.entityType, id: legalEntities.id, status: legalEntities.status })
        .from(legalEntities)
        .where(and(
          eq(legalEntities.tenantId, tenantId),
          or(ilike(legalEntities.displayName, pattern), ilike(legalEntities.legalName, pattern), ilike(legalEntities.city, pattern)),
        ))
        .limit(PER_GROUP_LIMIT)
        .then((rows) => rows.map((row) => ({
          group: "Clients" as const,
          href: `/clients/${row.id}`,
          id: row.id,
          meta: `${row.entityType} · ${row.city}${row.status === "archived" ? " · Archived" : ""}`,
          title: row.displayName,
        }))),
    );
  }

  if (allowed.work) {
    queries.push(
      database
        .select({ client: legalEntities.displayName, id: workItems.id, periodKey: workItems.periodKey, serviceKey: workItems.serviceKey, status: workItems.status })
        .from(workItems)
        .innerJoin(legalEntities, and(eq(legalEntities.tenantId, workItems.tenantId), eq(legalEntities.id, workItems.legalEntityId)))
        .where(and(
          eq(workItems.tenantId, tenantId),
          or(ilike(workItems.serviceKey, pattern), ilike(workItems.periodKey, pattern), ilike(legalEntities.displayName, pattern)),
        ))
        .limit(PER_GROUP_LIMIT)
        .then((rows) => rows.map((row) => ({
          group: "Work" as const,
          href: `/work/${row.id}`,
          id: row.id,
          meta: `${row.client} · ${row.periodKey} · ${row.status.replaceAll("_", " ")}`,
          title: row.serviceKey.replaceAll("_", " ").toUpperCase(),
        }))),
    );
  }

  if (allowed.tasks) {
    queries.push(
      database
        .select({ dueDate: officeTasks.dueDate, id: officeTasks.id, priority: officeTasks.priority, status: officeTasks.status, title: officeTasks.title })
        .from(officeTasks)
        .where(and(eq(officeTasks.tenantId, tenantId), ilike(officeTasks.title, pattern)))
        .limit(PER_GROUP_LIMIT)
        .then((rows) => rows.map((row) => ({
          group: "Tasks" as const,
          href: `/tasks/${row.id}`,
          id: row.id,
          meta: `${row.status.replaceAll("_", " ")} · ${row.priority} · due ${row.dueDate}`,
          title: row.title,
        }))),
    );
  }

  if (allowed.documents) {
    queries.push(
      database
        .select({ client: legalEntities.displayName, dueDate: documentRequests.dueDate, id: documentRequests.id, status: documentRequests.status, title: documentRequests.title })
        .from(documentRequests)
        .innerJoin(legalEntities, and(eq(legalEntities.tenantId, documentRequests.tenantId), eq(legalEntities.id, documentRequests.legalEntityId)))
        .where(and(eq(documentRequests.tenantId, tenantId), ilike(documentRequests.title, pattern)))
        .limit(PER_GROUP_LIMIT)
        .then((rows) => rows.map((row) => ({
          group: "Documents" as const,
          href: "/?workspace=documents",
          id: row.id,
          meta: `${row.client} · ${row.status} · due ${row.dueDate}`,
          title: row.title,
        }))),
    );
  }

  if (allowed.billing) {
    queries.push(
      database
        .select({ client: legalEntities.displayName, id: invoices.id, invoiceNumber: invoices.invoiceNumber, periodLabel: invoices.periodLabel, status: invoices.status })
        .from(invoices)
        .innerJoin(legalEntities, and(eq(legalEntities.tenantId, invoices.tenantId), eq(legalEntities.id, invoices.legalEntityId)))
        .where(and(
          eq(invoices.tenantId, tenantId),
          or(ilike(invoices.invoiceNumber, pattern), ilike(invoices.periodLabel, pattern), ilike(legalEntities.displayName, pattern)),
        ))
        .limit(PER_GROUP_LIMIT)
        .then((rows) => rows.map((row) => ({
          group: "Invoices" as const,
          href: `/billing/${row.id}`,
          id: row.id,
          meta: `${row.client} · ${row.periodLabel} · ${row.status}`,
          title: row.invoiceNumber,
        }))),
    );
  }

  if (allowed.team) {
    queries.push(
      database
        .select({ email: users.email, fullName: users.fullName, id: users.id, status: users.status })
        .from(users)
        // Joined through the membership table so a name only ever resolves within
        // the caller's own firm; `users` itself is global.
        .innerJoin(tenantMemberships, eq(tenantMemberships.userId, users.id))
        .where(and(
          eq(tenantMemberships.tenantId, tenantId),
          or(ilike(users.fullName, pattern), ilike(users.email, pattern)),
        ))
        .limit(PER_GROUP_LIMIT)
        .then((rows) => rows.map((row) => ({
          group: "Employees" as const,
          href: `/team/${row.id}`,
          id: row.id,
          meta: `${row.email}${row.status === "active" ? "" : ` · ${row.status}`}`,
          title: row.fullName,
        }))),
    );
  }

  const settled = await Promise.all(queries);
  return settled.flat();
}
