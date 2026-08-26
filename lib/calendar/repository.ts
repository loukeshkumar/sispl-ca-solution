import { and, eq, gte, inArray, lte, ne, notInArray, or, sql } from "drizzle-orm";

import {
  documentRequests,
  dscCertificates,
  holidayCalendar,
  invoices,
  leaveRequests,
  legalEntities,
  officeTasks,
  personalTodos,
  serviceCatalog,
  statutoryNotices,
  tenantMemberships,
  users,
  workItems,
} from "../../db/schema";
import {
  listActiveScheduleRules,
  listClientScheduleOverrides,
  listComplianceExtensions,
  listEntitledServices,
} from "../compliance/repository";
import { buildRecurringWorkDrafts } from "../compliance/recurrence";
import type { DashboardDatabase } from "../dashboard/postgres/repository";
import { dayDifference } from "./dates";
import { calendarFacets, summariseCalendar, type CalendarEvent, type CalendarSummary } from "./events";
import type { CalendarLayer } from "./queue-params";

export function indiaDateKey(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export type CalendarWorkspaceData = {
  clients: Array<{ id: string; name: string }>;
  events: CalendarEvent[];
  /** Layers this reader is permitted to see at all, whatever they filter to. */
  permittedLayers: CalendarLayer[];
  owners: Array<{ id: string; name: string }>;
  rangeFrom: string;
  rangeTo: string;
  summary: CalendarSummary;
  /** Active members, the denominator for every capacity warning. */
  teamSize: number;
  todayKey: string;
};

export function emptyCalendarWorkspace(todayKey = indiaDateKey()): CalendarWorkspaceData {
  return {
    clients: [],
    events: [],
    owners: [],
    permittedLayers: [],
    rangeFrom: todayKey,
    rangeTo: todayKey,
    summary: { dueThisWeek: 0, dueToday: 0, overdue: 0, provisional: 0, unassigned: 0 },
    teamSize: 0,
    todayKey,
  };
}

/** Statuses that mean the item is still owed, per source. */
const OPEN_WORK_STATUSES = ["critical", "at_risk", "waiting", "review"];
const OPEN_TASK_STATUSES = ["todo", "in_progress", "waiting", "review"];
const OPEN_NOTICE_STATUSES = ["open", "in_progress"];
const LIVE_DSC_STATUSES = ["in_custody", "issued_out"];

const WORK_STATUS_LABELS: Record<string, string> = {
  critical: "Critical",
  at_risk: "At risk",
  waiting: "Waiting on client",
  review: "In review",
  completed: "Completed",
};

const TASK_STATUS_LABELS: Record<string, string> = {
  todo: "To do",
  in_progress: "In progress",
  waiting: "Blocked",
  review: "In review",
  completed: "Completed",
  cancelled: "Cancelled",
};

const NOTICE_AUTHORITY_LABELS: Record<string, string> = {
  income_tax: "Income Tax",
  gst: "GST",
  tds: "TDS",
  roc: "ROC",
  other: "Authority",
};

const INVOICE_STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  issued: "Issued",
  paid: "Paid",
  cancelled: "Cancelled",
};

const LEAVE_PORTION_LABELS: Record<string, string> = {
  full: "Full day",
  first_half: "First half",
  second_half: "Second half",
};

/**
 * The window a query covers.
 *
 * Two clauses, not one. The range is what the reader is looking at; the second
 * clause pulls in everything still open from before it, because a missed filing
 * that scrolls out of the window is a missed filing nobody is reminded of again.
 */
function inWindow(column: Parameters<typeof gte>[0], statusColumn: Parameters<typeof inArray>[0], openStatuses: string[], range: CalendarRange) {
  return or(
    and(gte(column, range.from), lte(column, range.to)),
    and(inArray(statusColumn, openStatuses), sql`${column} < ${range.todayKey}`),
  );
}

export type CalendarRange = { from: string; to: string; todayKey: string };

function rupeeLabel(paise: number) {
  return `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

async function loadWorkEvents(database: DashboardDatabase, tenantId: string, range: CalendarRange): Promise<CalendarEvent[]> {
  const rows = await database.select({
    assigneeId: workItems.assigneeId,
    clientId: workItems.legalEntityId,
    clientName: legalEntities.displayName,
    dueDate: workItems.statutoryDueDate,
    id: workItems.id,
    internalDueDate: workItems.internalDueDate,
    originalDueDate: workItems.originalStatutoryDueDate,
    ownerName: users.fullName,
    periodKey: workItems.periodKey,
    progress: workItems.progress,
    serviceKey: workItems.serviceKey,
    serviceName: serviceCatalog.name,
    status: workItems.status,
  }).from(workItems)
    .innerJoin(legalEntities, and(eq(legalEntities.tenantId, workItems.tenantId), eq(legalEntities.id, workItems.legalEntityId)))
    .leftJoin(users, eq(users.id, workItems.assigneeId))
    .leftJoin(serviceCatalog, and(eq(serviceCatalog.tenantId, workItems.tenantId), sql`lower(${serviceCatalog.code}) = lower(${workItems.serviceKey})`))
    .where(and(eq(workItems.tenantId, tenantId), inWindow(workItems.statutoryDueDate, workItems.status, OPEN_WORK_STATUSES, range)));

  return rows.map((row) => ({
    action: row.status === "completed" ? null : { kind: "work" as const, id: row.id },
    amountPaise: null,
    clientId: row.clientId,
    clientName: row.clientName,
    dateKey: row.dueDate,
    endKey: row.dueDate,
    estimateMinutes: null,
    href: `/work/${row.id}`,
    key: `work:${row.id}`,
    layer: "work" as CalendarLayer,
    open: row.status !== "completed",
    ownerId: row.assigneeId ?? "",
    ownerName: row.ownerName ?? "",
    provisional: false,
    status: row.status,
    statusLabel: WORK_STATUS_LABELS[row.status] ?? row.status,
    subtitle: [
      row.periodKey,
      // An extended date is only trustworthy if the calendar says it moved.
      row.originalDueDate && row.originalDueDate !== row.dueDate ? `moved from ${row.originalDueDate}` : "",
      row.internalDueDate && row.internalDueDate < row.dueDate ? `internal ${row.internalDueDate}` : "",
    ].filter(Boolean).join(" · "),
    title: row.serviceName ?? row.serviceKey.toUpperCase(),
  }));
}

async function loadTaskEvents(database: DashboardDatabase, tenantId: string, range: CalendarRange): Promise<CalendarEvent[]> {
  const rows = await database.select({
    assigneeId: officeTasks.assigneeId,
    clientId: officeTasks.legalEntityId,
    clientName: legalEntities.displayName,
    dueDate: officeTasks.dueDate,
    estimateMinutes: officeTasks.estimateMinutes,
    id: officeTasks.id,
    ownerName: users.fullName,
    priority: officeTasks.priority,
    status: officeTasks.status,
    title: officeTasks.title,
  }).from(officeTasks)
    .leftJoin(legalEntities, and(eq(legalEntities.tenantId, officeTasks.tenantId), eq(legalEntities.id, officeTasks.legalEntityId)))
    .leftJoin(users, eq(users.id, officeTasks.assigneeId))
    .where(and(
      eq(officeTasks.tenantId, tenantId),
      ne(officeTasks.status, "cancelled"),
      inWindow(officeTasks.dueDate, officeTasks.status, OPEN_TASK_STATUSES, range),
    ));

  return rows.map((row) => ({
    action: row.status === "completed" ? null : { kind: "task" as const, id: row.id },
    amountPaise: null,
    clientId: row.clientId ?? "",
    clientName: row.clientName ?? "Internal",
    dateKey: row.dueDate,
    endKey: row.dueDate,
    estimateMinutes: row.estimateMinutes,
    href: `/tasks/${row.id}`,
    key: `task:${row.id}`,
    layer: "tasks" as CalendarLayer,
    open: row.status !== "completed",
    ownerId: row.assigneeId,
    ownerName: row.ownerName ?? "",
    provisional: false,
    status: row.status,
    statusLabel: TASK_STATUS_LABELS[row.status] ?? row.status,
    subtitle: [row.priority !== "normal" ? `${row.priority} priority` : "", row.clientName ?? ""].filter(Boolean).join(" · "),
    title: row.title,
  }));
}

/**
 * Only the reader's own to-dos. They are personal by construction, and a
 * calendar that leaked them across the firm would be the last time anybody
 * wrote one down.
 */
async function loadTodoEvents(database: DashboardDatabase, tenantId: string, viewerUserId: string, viewerName: string, range: CalendarRange): Promise<CalendarEvent[]> {
  const rows = await database.select({
    dueDate: personalTodos.dueDate,
    dueTime: personalTodos.dueTime,
    category: personalTodos.category,
    id: personalTodos.id,
    priority: personalTodos.priority,
    recurrenceRule: personalTodos.recurrenceRule,
    status: personalTodos.status,
    title: personalTodos.title,
  }).from(personalTodos)
    .where(and(
      eq(personalTodos.tenantId, tenantId),
      eq(personalTodos.ownerUserId, viewerUserId),
      ne(personalTodos.status, "archived"),
      sql`${personalTodos.dueDate} is not null`,
      or(
        and(gte(personalTodos.dueDate, range.from), lte(personalTodos.dueDate, range.to)),
        and(eq(personalTodos.status, "open"), sql`${personalTodos.dueDate} < ${range.todayKey}`),
      ),
    ));

  return rows.filter((row) => row.dueDate).map((row) => ({
    action: row.status === "completed" ? null : { kind: "todo" as const, id: row.id },
    amountPaise: null,
    clientId: "",
    clientName: "",
    dateKey: row.dueDate!,
    endKey: row.dueDate!,
    estimateMinutes: null,
    href: `/todos/${row.id}/edit`,
    key: `todo:${row.id}`,
    layer: "todos" as CalendarLayer,
    open: row.status === "open",
    ownerId: viewerUserId,
    ownerName: viewerName,
    provisional: false,
    status: row.status,
    statusLabel: row.status === "completed" ? "Done" : "Open",
    subtitle: [row.dueTime ?? "", row.category, row.recurrenceRule ? `repeats ${row.recurrenceRule}ly` : ""].filter(Boolean).join(" · "),
    title: row.title,
  }));
}

async function loadDocumentEvents(database: DashboardDatabase, tenantId: string, range: CalendarRange): Promise<CalendarEvent[]> {
  const rows = await database.select({
    clientId: documentRequests.legalEntityId,
    clientName: legalEntities.displayName,
    dueDate: documentRequests.dueDate,
    id: documentRequests.id,
    ownerId: documentRequests.requestedByUserId,
    ownerName: users.fullName,
    status: documentRequests.status,
    title: documentRequests.title,
  }).from(documentRequests)
    .innerJoin(legalEntities, and(eq(legalEntities.tenantId, documentRequests.tenantId), eq(legalEntities.id, documentRequests.legalEntityId)))
    .leftJoin(users, eq(users.id, documentRequests.requestedByUserId))
    .where(and(
      eq(documentRequests.tenantId, tenantId),
      ne(documentRequests.status, "cancelled"),
      or(
        and(gte(documentRequests.dueDate, range.from), lte(documentRequests.dueDate, range.to)),
        and(eq(documentRequests.status, "requested"), sql`${documentRequests.dueDate} < ${range.todayKey}`),
      ),
    ));

  return rows.map((row) => ({
    action: null,
    amountPaise: null,
    clientId: row.clientId,
    clientName: row.clientName,
    dateKey: row.dueDate,
    endKey: row.dueDate,
    estimateMinutes: null,
    href: "/?workspace=documents&scope=chase",
    key: `document:${row.id}`,
    layer: "documents" as CalendarLayer,
    open: row.status === "requested",
    ownerId: row.ownerId,
    ownerName: row.ownerName ?? "",
    provisional: false,
    status: row.status,
    statusLabel: row.status === "requested" ? "Awaiting client" : "Received",
    subtitle: `Requested from ${row.clientName}`,
    title: row.title,
  }));
}

async function loadInvoiceEvents(database: DashboardDatabase, tenantId: string, range: CalendarRange): Promise<CalendarEvent[]> {
  const rows = await database.select({
    clientId: invoices.legalEntityId,
    clientName: legalEntities.displayName,
    dueDate: invoices.dueDate,
    id: invoices.id,
    invoiceNumber: invoices.invoiceNumber,
    periodLabel: invoices.periodLabel,
    status: invoices.status,
    totalPaise: invoices.totalPaise,
  }).from(invoices)
    .innerJoin(legalEntities, and(eq(legalEntities.tenantId, invoices.tenantId), eq(legalEntities.id, invoices.legalEntityId)))
    .where(and(
      eq(invoices.tenantId, tenantId),
      notInArray(invoices.status, ["draft", "cancelled"]),
      sql`${invoices.dueDate} is not null`,
      or(
        and(gte(invoices.dueDate, range.from), lte(invoices.dueDate, range.to)),
        and(eq(invoices.status, "issued"), sql`${invoices.dueDate} < ${range.todayKey}`),
      ),
    ));

  return rows.filter((row) => row.dueDate).map((row) => ({
    action: null,
    amountPaise: row.totalPaise,
    clientId: row.clientId,
    clientName: row.clientName,
    dateKey: row.dueDate!,
    endKey: row.dueDate!,
    estimateMinutes: null,
    href: "/?workspace=billing",
    key: `invoice:${row.id}`,
    layer: "invoices" as CalendarLayer,
    open: row.status === "issued",
    ownerId: "",
    ownerName: "",
    provisional: false,
    status: row.status,
    statusLabel: INVOICE_STATUS_LABELS[row.status] ?? row.status,
    subtitle: `${row.invoiceNumber} · ${row.periodLabel} · ${rupeeLabel(row.totalPaise)}`,
    title: `Invoice due — ${row.clientName}`,
  }));
}

async function loadNoticeEvents(database: DashboardDatabase, tenantId: string, range: CalendarRange): Promise<CalendarEvent[]> {
  const rows = await database.select({
    assigneeId: statutoryNotices.assigneeId,
    authority: statutoryNotices.authority,
    clientId: statutoryNotices.legalEntityId,
    clientName: legalEntities.displayName,
    dueDate: statutoryNotices.responseDueDate,
    id: statutoryNotices.id,
    noticeNumber: statutoryNotices.noticeNumber,
    ownerName: users.fullName,
    status: statutoryNotices.status,
    subject: statutoryNotices.subject,
  }).from(statutoryNotices)
    .innerJoin(legalEntities, and(eq(legalEntities.tenantId, statutoryNotices.tenantId), eq(legalEntities.id, statutoryNotices.legalEntityId)))
    .leftJoin(users, eq(users.id, statutoryNotices.assigneeId))
    .where(and(
      eq(statutoryNotices.tenantId, tenantId),
      inWindow(statutoryNotices.responseDueDate, statutoryNotices.status, OPEN_NOTICE_STATUSES, range),
    ));

  return rows.map((row) => ({
    action: null,
    amountPaise: null,
    clientId: row.clientId,
    clientName: row.clientName,
    dateKey: row.dueDate,
    endKey: row.dueDate,
    estimateMinutes: null,
    href: `/?workspace=registers&tab=notices&focus=${row.id}`,
    key: `notice:${row.id}`,
    layer: "notices" as CalendarLayer,
    open: OPEN_NOTICE_STATUSES.includes(row.status),
    ownerId: row.assigneeId ?? "",
    ownerName: row.ownerName ?? "",
    provisional: false,
    status: row.status,
    statusLabel: row.status === "in_progress" ? "In progress" : row.status === "responded" ? "Responded" : row.status === "closed" ? "Closed" : "Open",
    subtitle: `${row.noticeNumber} · ${row.subject}`,
    title: `${NOTICE_AUTHORITY_LABELS[row.authority] ?? row.authority} response`,
  }));
}

async function loadDscEvents(database: DashboardDatabase, tenantId: string, range: CalendarRange): Promise<CalendarEvent[]> {
  const rows = await database.select({
    clientId: dscCertificates.legalEntityId,
    clientName: legalEntities.displayName,
    custodianId: dscCertificates.custodianUserId,
    holderName: dscCertificates.holderName,
    id: dscCertificates.id,
    ownerName: users.fullName,
    serialNumber: dscCertificates.serialNumber,
    status: dscCertificates.status,
    validUntil: dscCertificates.validUntil,
  }).from(dscCertificates)
    .innerJoin(legalEntities, and(eq(legalEntities.tenantId, dscCertificates.tenantId), eq(legalEntities.id, dscCertificates.legalEntityId)))
    .leftJoin(users, eq(users.id, dscCertificates.custodianUserId))
    .where(and(
      eq(dscCertificates.tenantId, tenantId),
      inArray(dscCertificates.status, LIVE_DSC_STATUSES),
      gte(dscCertificates.validUntil, range.from),
      lte(dscCertificates.validUntil, range.to),
    ));

  return rows.map((row) => ({
    action: null,
    amountPaise: null,
    clientId: row.clientId,
    clientName: row.clientName,
    dateKey: row.validUntil,
    endKey: row.validUntil,
    estimateMinutes: null,
    href: `/?workspace=registers&tab=dsc&focus=${row.id}`,
    key: `dsc:${row.id}`,
    layer: "dsc" as CalendarLayer,
    open: true,
    ownerId: row.custodianId ?? "",
    ownerName: row.ownerName ?? "",
    provisional: false,
    status: row.status,
    statusLabel: row.status === "issued_out" ? "Signed out" : "In custody",
    subtitle: `${row.holderName} · ${row.serialNumber}`,
    title: "DSC validity ends",
  }));
}

async function loadHolidayEvents(database: DashboardDatabase, tenantId: string, range: CalendarRange): Promise<CalendarEvent[]> {
  const rows = await database.select({
    holidayDate: holidayCalendar.holidayDate,
    holidayType: holidayCalendar.holidayType,
    id: holidayCalendar.id,
    jurisdictionState: holidayCalendar.jurisdictionState,
    name: holidayCalendar.name,
  }).from(holidayCalendar)
    .where(and(
      eq(holidayCalendar.tenantId, tenantId),
      eq(holidayCalendar.status, "active"),
      gte(holidayCalendar.holidayDate, range.from),
      lte(holidayCalendar.holidayDate, range.to),
    ));

  return rows.map((row) => ({
    action: null,
    amountPaise: null,
    clientId: "",
    clientName: "",
    dateKey: row.holidayDate,
    endKey: row.holidayDate,
    estimateMinutes: null,
    href: "/settings/attendance",
    key: `holiday:${row.id}`,
    layer: "holidays" as CalendarLayer,
    open: false,
    ownerId: "",
    ownerName: "",
    provisional: false,
    status: row.holidayType,
    statusLabel: row.holidayType === "public" ? "Office closed" : row.holidayType === "restricted" ? "Restricted holiday" : "Optional holiday",
    subtitle: row.jurisdictionState,
    title: row.name,
  }));
}

/**
 * Approved leave only. A pending request is a plan, and shading the grid for a
 * day off nobody has granted would have the firm scheduling around a fiction.
 */
async function loadLeaveEvents(database: DashboardDatabase, tenantId: string, range: CalendarRange): Promise<CalendarEvent[]> {
  const rows = await database.select({
    dateFrom: leaveRequests.dateFrom,
    dateTo: leaveRequests.dateTo,
    dayPortion: leaveRequests.dayPortion,
    employeeUserId: leaveRequests.employeeUserId,
    id: leaveRequests.id,
    leaveType: leaveRequests.leaveType,
    ownerName: users.fullName,
  }).from(leaveRequests)
    .innerJoin(users, eq(users.id, leaveRequests.employeeUserId))
    .where(and(
      eq(leaveRequests.tenantId, tenantId),
      eq(leaveRequests.status, "approved"),
      lte(leaveRequests.dateFrom, range.to),
      gte(leaveRequests.dateTo, range.from),
    ));

  return rows.map((row) => ({
    action: null,
    amountPaise: null,
    clientId: "",
    clientName: "",
    dateKey: row.dateFrom,
    endKey: row.dateTo,
    estimateMinutes: null,
    href: "/?workspace=attendance",
    key: `leave:${row.id}`,
    layer: "leave" as CalendarLayer,
    open: false,
    ownerId: row.employeeUserId,
    ownerName: row.ownerName,
    provisional: false,
    status: row.dayPortion,
    statusLabel: LEAVE_PORTION_LABELS[row.dayPortion] ?? row.dayPortion,
    subtitle: row.leaveType.replace(/_/g, " "),
    title: `${row.ownerName} away`,
  }));
}

/**
 * Obligations the recurring calendar will raise but has not yet.
 *
 * Shown as provisional rather than as work, because they are not work: nobody
 * owns them, nothing has been recorded against them, and a calendar that
 * presented a projection as a commitment would be lying about the firm's load.
 */
async function loadForecastEvents(database: DashboardDatabase, tenantId: string, range: CalendarRange): Promise<CalendarEvent[]> {
  const [schedules, entitlements, overrides, extensions, raised, clients] = await Promise.all([
    listActiveScheduleRules(database, tenantId, range.todayKey),
    listEntitledServices(database, tenantId, range.todayKey),
    listClientScheduleOverrides(database, tenantId),
    listComplianceExtensions(database, tenantId),
    database.select({
      legalEntityId: workItems.legalEntityId,
      periodKey: workItems.periodKey,
      serviceKey: workItems.serviceKey,
    }).from(workItems).where(eq(workItems.tenantId, tenantId)),
    database.select({ id: legalEntities.id, name: legalEntities.displayName }).from(legalEntities).where(and(
      eq(legalEntities.tenantId, tenantId), eq(legalEntities.status, "active"),
    )),
  ]);

  const nameById = new Map(clients.map((client) => [client.id, client.name]));
  const alreadyRaised = new Set(raised.map((row) => `${row.legalEntityId}:${row.serviceKey.toUpperCase()}:${row.periodKey}`));
  // The horizon is the loaded window, so stepping forward a month reveals the
  // forecast for it rather than an empty grid the generator will later fill.
  const lookaheadDays = Math.max(0, dayDifference(range.to, range.todayKey));

  return buildRecurringWorkDrafts({ entitlements, extensions, lookaheadDays, overrides, schedules, todayKey: range.todayKey })
    .filter((draft) => !alreadyRaised.has(`${draft.legalEntityId}:${draft.serviceKey}:${draft.periodKey}`))
    .filter((draft) => draft.statutoryDueDate >= range.from && draft.statutoryDueDate <= range.to)
    .map((draft) => ({
      action: null,
      amountPaise: null,
      clientId: draft.legalEntityId,
      clientName: nameById.get(draft.legalEntityId) ?? "Unknown client",
      dateKey: draft.statutoryDueDate,
      endKey: draft.statutoryDueDate,
      estimateMinutes: null,
      href: "/?workspace=compliance",
      key: `forecast:${draft.legalEntityId}:${draft.serviceKey}:${draft.periodKey}`,
      layer: "forecast" as CalendarLayer,
      open: true,
      ownerId: "",
      ownerName: "",
      provisional: true,
      status: "forecast",
      statusLabel: "Not yet raised",
      subtitle: `${draft.periodKey} · ${draft.source === "client" ? "client schedule" : "firm schedule"}`,
      title: draft.serviceKey,
    }));
}

async function countActiveMembers(database: DashboardDatabase, tenantId: string) {
  const [row] = await database.select({ total: sql<number>`count(*)::int` }).from(tenantMemberships).where(and(
    eq(tenantMemberships.tenantId, tenantId),
    eq(tenantMemberships.status, "active"),
  ));
  return row?.total ?? 0;
}

/**
 * Every dated thing the firm owes, on one timeline.
 *
 * Each layer is queried only when the reader is permitted to see it: the
 * calendar aggregates across registers with different permissions, and joining
 * them onto one grid must not become a way around any of them.
 */
export async function listCalendarWorkspace(
  database: DashboardDatabase,
  tenantId: string,
  viewer: { name: string; userId: string },
  options: { from: string; permittedLayers: CalendarLayer[]; to: string; todayKey?: string },
): Promise<CalendarWorkspaceData> {
  if (!tenantId.trim()) throw new Error("Tenant is required.");
  const todayKey = options.todayKey ?? indiaDateKey();
  const range: CalendarRange = { from: options.from, to: options.to, todayKey };
  const permitted = new Set(options.permittedLayers);
  const none = Promise.resolve<CalendarEvent[]>([]);

  const [work, forecast, tasks, todos, documents, invoiceRows, notices, dsc, holidays, leave, teamSize] = await Promise.all([
    permitted.has("work") ? loadWorkEvents(database, tenantId, range) : none,
    permitted.has("forecast") ? loadForecastEvents(database, tenantId, range) : none,
    permitted.has("tasks") ? loadTaskEvents(database, tenantId, range) : none,
    permitted.has("todos") ? loadTodoEvents(database, tenantId, viewer.userId, viewer.name, range) : none,
    permitted.has("documents") ? loadDocumentEvents(database, tenantId, range) : none,
    permitted.has("invoices") ? loadInvoiceEvents(database, tenantId, range) : none,
    permitted.has("notices") ? loadNoticeEvents(database, tenantId, range) : none,
    permitted.has("dsc") ? loadDscEvents(database, tenantId, range) : none,
    permitted.has("holidays") ? loadHolidayEvents(database, tenantId, range) : none,
    permitted.has("leave") ? loadLeaveEvents(database, tenantId, range) : none,
    countActiveMembers(database, tenantId),
  ]);

  const events = [...work, ...forecast, ...tasks, ...todos, ...documents, ...invoiceRows, ...notices, ...dsc, ...holidays, ...leave];
  const facets = calendarFacets(events);
  return {
    clients: facets.clients,
    events,
    owners: facets.owners,
    permittedLayers: options.permittedLayers,
    rangeFrom: options.from,
    rangeTo: options.to,
    summary: summariseCalendar(events, todayKey),
    teamSize,
    todayKey,
  };
}
