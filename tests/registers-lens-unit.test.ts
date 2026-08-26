import assert from "node:assert/strict";
import test from "node:test";

import { buildAttentionQueue, CUSTODY_STALE_DAYS, summariseAttention } from "../lib/registers/attention";
import { certificatesCsv, noticesCsv, toCsv } from "../lib/registers/csv";
import {
  buildExpiryRunway,
  buildNoticeTurnaround,
  buildSignerLoad,
  buildUdinTrend,
  median,
} from "../lib/registers/insights";
import {
  dueChip,
  filterCertificates,
  filterNotices,
  groupByClient,
  noticeBand,
  paginate,
  sortRows,
} from "../lib/registers/lens";
import {
  DEFAULT_REGISTER_PARAMS,
  hasActiveRegisterFilters,
  parseRegisterParams,
  registerHref,
  type RegisterParams,
} from "../lib/registers/queue-params";
import type { DscRow, NoticeRow } from "../lib/registers/repository";

const TODAY = "2026-08-21";
const CLIENT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CLIENT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const MEMBER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const params = (over: Partial<RegisterParams> = {}): RegisterParams => ({ ...DEFAULT_REGISTER_PARAMS, ...over });

const noticeRow = (over: Partial<NoticeRow> = {}): NoticeRow => ({
  assigneeId: MEMBER, assigneeName: "Rahul K.", authority: "income_tax", clientName: "Koshi Infra LLP",
  id: "n1", legalEntityId: CLIENT_A, noticeDate: "2026-08-01", noticeNumber: "ITBA/2026/1",
  noticeSection: "143(2)", receivedDate: "2026-08-05", respondedOn: null, responseDueDate: "2026-08-30",
  responseSummary: "", status: "open", subject: "Scrutiny", ...over,
});

const dscRow = (over: Partial<DscRow> = {}): DscRow => ({
  certificateClass: "class_3", clientName: "Aarav Retail", custodianName: "Asha", custodianUserId: MEMBER,
  holderName: "A. Sharma", id: "d1", issuedOutSince: null, issuingAuthority: "eMudhra",
  legalEntityId: CLIENT_A, notes: "", serialNumber: "SN-1", status: "in_custody",
  storageLocation: "Cabinet 2", validFrom: "2026-01-01", validUntil: "2026-12-31", ...over,
});

/* ---- The action queue's two new risks ---- */

test("a notice nobody owns is raised even though its deadline is comfortable", () => {
  // Twenty-five days out, so no deadline entry; the risk is that it is unowned.
  const queue = buildAttentionQueue({
    certificates: [],
    notices: [{ assigneeName: null, clientName: "Koshi", id: "n1", responseDueDate: "2026-09-15", status: "open", subject: "Scrutiny" }],
    todayKey: TODAY,
  });
  assert.equal(queue.length, 1);
  assert.equal(queue[0]!.risk, "unowned");
  assert.match(queue[0]!.detail, /Nobody is assigned/);
});

test("an unowned notice inside the deadline horizon is listed once, as a deadline", () => {
  // Both risks apply; two rows for one notice would inflate the queue that is
  // meant to shrink the reader's workload.
  const queue = buildAttentionQueue({
    certificates: [],
    notices: [{ assigneeName: null, clientName: "Koshi", id: "n1", responseDueDate: "2026-08-24", status: "open", subject: "Scrutiny" }],
    todayKey: TODAY,
  });
  assert.equal(queue.length, 1);
  assert.equal(queue[0]!.risk, "deadline");
});

test("an unowned notice beyond the horizon is not raised at all", () => {
  const queue = buildAttentionQueue({
    certificates: [],
    notices: [{ assigneeName: null, clientName: "Koshi", id: "n1", responseDueDate: "2026-12-01", status: "open", subject: "Scrutiny" }],
    todayKey: TODAY,
  });
  assert.deepEqual(queue, []);
});

test("a token signed out too long is raised even when its validity is years away", () => {
  const certificate = {
    clientName: "Aarav", holderName: "A. Sharma", id: "d1",
    issuedOutSince: "2026-08-01T09:00:00.000Z", serialNumber: "SN-1", status: "issued_out", validUntil: "2029-01-01",
  };
  const queue = buildAttentionQueue({ certificates: [certificate], notices: [], todayKey: TODAY });
  assert.equal(queue.length, 1);
  assert.equal(queue[0]!.risk, "custody");
  assert.match(queue[0]!.detail, /Signed out 20 days ago/);
});

test("a token out for less than the stale window is left alone", () => {
  const queue = buildAttentionQueue({
    certificates: [{
      clientName: "Aarav", holderName: "A. Sharma", id: "d1",
      issuedOutSince: "2026-08-15T09:00:00.000Z", serialNumber: "SN-1", status: "issued_out", validUntil: "2029-01-01",
    }],
    notices: [], todayKey: TODAY,
  });
  assert.deepEqual(queue, []);
  assert.equal(CUSTODY_STALE_DAYS, 14);
});

test("an expiring token that is also out reports the expiry, not the custody", () => {
  // Expiry is the nearer of the two clocks, and renewing it settles both rows.
  const queue = buildAttentionQueue({
    certificates: [{
      clientName: "Aarav", holderName: "A. Sharma", id: "d1",
      issuedOutSince: "2026-01-01T09:00:00.000Z", serialNumber: "SN-1", status: "issued_out", validUntil: "2026-09-01",
    }],
    notices: [], todayKey: TODAY,
  });
  assert.equal(queue.length, 1);
  assert.equal(queue[0]!.risk, "deadline");
});

test("every queue item links at the entry rather than at its register", () => {
  const queue = buildAttentionQueue({
    certificates: [],
    notices: [{ assigneeName: null, clientName: "K", id: "n1", responseDueDate: "2026-08-22", status: "open", subject: "S" }],
    todayKey: TODAY,
  });
  assert.match(queue[0]!.href, /tab=notices/);
  assert.match(queue[0]!.href, /focus=n1/);
});

test("the queue summary counts each kind of trouble separately", () => {
  const queue = buildAttentionQueue({
    certificates: [{
      clientName: "A", holderName: "H", id: "d1", issuedOutSince: "2026-07-01T00:00:00.000Z",
      serialNumber: "SN-1", status: "issued_out", validUntil: "2029-01-01",
    }],
    notices: [
      { assigneeName: "R", clientName: "K", id: "n1", responseDueDate: "2026-08-01", status: "open", subject: "Late" },
      { assigneeName: "R", clientName: "K", id: "n2", responseDueDate: TODAY, status: "open", subject: "Today" },
      { assigneeName: null, clientName: "K", id: "n3", responseDueDate: "2026-09-10", status: "open", subject: "Unowned" },
    ],
    todayKey: TODAY,
  });
  assert.deepEqual(summariseAttention(queue), { custody: 1, overdue: 1, today: 1, total: 4, unowned: 1 });
});

/* ---- Filters, sorting, grouping, pagination ---- */

test("the owner filter distinguishes a named member from nobody at all", () => {
  const rows = [noticeRow(), noticeRow({ assigneeId: null, assigneeName: null, id: "n2" })];
  assert.deepEqual(filterNotices(rows, params({ owner: MEMBER, tab: "notices" }), TODAY).map((row) => row.id), ["n1"]);
  assert.deepEqual(filterNotices(rows, params({ owner: "unassigned", tab: "notices" }), TODAY).map((row) => row.id), ["n2"]);
});

test("filters compose rather than override one another", () => {
  const rows = [
    noticeRow({ authority: "gst", id: "n1" }),
    noticeRow({ authority: "gst", id: "n2", legalEntityId: CLIENT_B }),
    noticeRow({ authority: "roc", id: "n3" }),
  ];
  const matched = filterNotices(rows, params({ authority: "gst", client: CLIENT_A, tab: "notices" }), TODAY);
  assert.deepEqual(matched.map((row) => row.id), ["n1"]);
});

test("the urgency band filter reads each register's own clock", () => {
  assert.equal(noticeBand("2026-08-01", TODAY), "overdue");
  assert.equal(noticeBand(TODAY, TODAY), "today");
  assert.equal(noticeBand("2026-08-27", TODAY), "week");
  assert.equal(noticeBand("2026-09-30", TODAY), "later");

  const rows = [noticeRow({ id: "late", responseDueDate: "2026-08-01" }), noticeRow({ id: "far" })];
  assert.deepEqual(filterNotices(rows, params({ band: "overdue", tab: "notices" }), TODAY).map((row) => row.id), ["late"]);
});

test("the custodian filter finds certificates nobody is holding", () => {
  const rows = [dscRow(), dscRow({ custodianName: null, custodianUserId: null, id: "d2" })];
  assert.deepEqual(filterCertificates(rows, params({ owner: "unassigned", tab: "dsc" }), TODAY).map((row) => row.id), ["d2"]);
});

test("search reaches the fields a reader actually types", () => {
  const rows = [noticeRow({ id: "n1", subject: "Scrutiny under 143(2)" }), noticeRow({ id: "n2", subject: "Refund" })];
  assert.deepEqual(filterNotices(rows, params({ q: "scrutiny", tab: "notices" }), TODAY).map((row) => row.id), ["n1"]);
  assert.deepEqual(filterNotices(rows, params({ q: "RAHUL", tab: "notices" }), TODAY).length, 2);
});

test("sorting by client still orders each client's rows by their own deadline", () => {
  const rows = [
    noticeRow({ clientName: "Zeta", id: "z1", responseDueDate: "2026-09-01" }),
    noticeRow({ clientName: "Alpha", id: "a2", responseDueDate: "2026-09-05" }),
    noticeRow({ clientName: "Alpha", id: "a1", responseDueDate: "2026-08-25" }),
  ];
  const sorted = sortRows(rows, "client", (row) => row.responseDueDate);
  assert.deepEqual(sorted.map((row) => row.id), ["a1", "a2", "z1"]);
});

test("pagination clamps a page that a filter has scrolled past", () => {
  const rows = Array.from({ length: 30 }, (_, index) => index);
  assert.deepEqual(paginate(rows, 2, 25).items, rows.slice(25));
  // Asking for page 9 of a two-page list shows the last page, never nothing.
  const clamped = paginate(rows, 9, 25);
  assert.equal(clamped.page, 2);
  assert.equal(clamped.from, 26);
  assert.equal(clamped.to, 30);
});

test("an empty register paginates to a single empty page", () => {
  assert.deepEqual(paginate([], 1), { from: 0, items: [], page: 1, pages: 1, to: 0, total: 0 });
});

test("the client lens orders clients by their single most pressing entry", () => {
  const rows = [
    noticeRow({ clientName: "Calm Co", id: "c1", legalEntityId: CLIENT_B, responseDueDate: "2026-09-30" }),
    noticeRow({ clientName: "Late Co", id: "l1", responseDueDate: "2026-08-01" }),
    noticeRow({ clientName: "Late Co", id: "l2", responseDueDate: "2026-09-20" }),
  ];
  const groups = groupByClient(rows, TODAY, (row) => row.responseDueDate);
  assert.deepEqual(groups.map((group) => group.clientName), ["Late Co", "Calm Co"]);
  assert.equal(groups[0]!.overdue, 1);
  assert.equal(groups[0]!.leadDays, -20);
  assert.deepEqual(groups[0]!.items.map((row) => row.id), ["l1", "l2"]);
});

test("the due chip says overdue, today and remaining in the reader's words", () => {
  assert.deepEqual(dueChip(-3), { label: "3d overdue", tone: "overdue" });
  assert.deepEqual(dueChip(0), { label: "Due today", tone: "today" });
  assert.deepEqual(dueChip(1), { label: "Due tomorrow", tone: "soon" });
  assert.deepEqual(dueChip(40), { label: "40d left", tone: "later" });
});

/* ---- URL contract ---- */

test("the extended parameters round-trip through the URL", () => {
  const wanted = params({
    authority: "gst", band: "overdue", client: CLIENT_A, layout: "client",
    owner: "unassigned", page: 3, q: "ROC", sort: "client", status: "in_progress", tab: "notices",
  });
  const parsed = parseRegisterParams(Object.fromEntries(new URL(`http://x${registerHref(wanted)}`).searchParams));
  assert.deepEqual(parsed, wanted);
});

test("a filter that means nothing on this register is dropped rather than applied", () => {
  // Authority is a notice column; carrying it onto the UDIN register would
  // silently filter against a field that does not exist there.
  const parsed = parseRegisterParams({ authority: "gst", band: "overdue", owner: "unassigned", tab: "udin" });
  assert.equal(parsed.authority, "all");
  assert.equal(parsed.band, "all");
  assert.equal(parsed.owner, "all");
});

test("a focus that is not an id is discarded", () => {
  assert.equal(parseRegisterParams({ focus: "../admin", tab: "dsc" }).focus, "");
  assert.equal(parseRegisterParams({ focus: CLIENT_A, tab: "dsc" }).focus, CLIENT_A);
});

test("a nonsense page number falls back to the first page", () => {
  assert.equal(parseRegisterParams({ page: "-4", tab: "dsc" }).page, 1);
  assert.equal(parseRegisterParams({ page: "abc", tab: "dsc" }).page, 1);
  assert.equal(parseRegisterParams({ page: "99999", tab: "dsc" }).page, 400);
});

test("the page knows when it is showing a narrowed view", () => {
  assert.equal(hasActiveRegisterFilters(params()), false);
  assert.equal(hasActiveRegisterFilters(params({ q: "gst" })), true);
  assert.equal(hasActiveRegisterFilters(params({ client: CLIENT_A })), true);
});

/* ---- Analytics ---- */

test("turnaround measures received to answered, and ignores what is unanswered", () => {
  const stats = buildNoticeTurnaround([
    { authority: "gst", receivedDate: "2026-08-01", respondedOn: "2026-08-06", status: "responded" },
    { authority: "gst", receivedDate: "2026-07-01", respondedOn: "2026-08-01", status: "closed" },
    { authority: "gst", receivedDate: "2026-08-01", respondedOn: null, status: "open" },
  ]);
  assert.equal(stats.sample, 2);
  assert.equal(stats.fastest, 5);
  assert.equal(stats.slowest, 31);
  assert.equal(stats.medianDays, 18);
});

test("a response recorded before the notice arrived is discarded, not counted as negative", () => {
  const stats = buildNoticeTurnaround([
    { authority: "gst", receivedDate: "2026-08-10", respondedOn: "2026-08-01", status: "responded" },
  ]);
  assert.equal(stats.sample, 0);
  assert.equal(stats.medianDays, null);
});

test("the median survives an even sample and an empty one", () => {
  assert.equal(median([]), null);
  assert.equal(median([4]), 4);
  assert.equal(median([1, 2, 3, 10]), 2.5);
});

test("the runway buckets only live certificates, and lapsed ones lead", () => {
  const runway = buildExpiryRunway([
    { status: "in_custody", validUntil: "2026-08-01" },
    { status: "issued_out", validUntil: "2026-09-01" },
    { status: "expired", validUntil: "2026-08-01" },
    { status: "in_custody", validUntil: "2027-06-01" },
  ], TODAY);
  const byKey = Object.fromEntries(runway.map((window) => [window.key, window.count]));
  assert.equal(byKey.expired, 1);
  assert.equal(byKey.d30, 1);
  assert.equal(byKey.beyond, 1);
});

test("signer load reports a revocation rate, ordered by volume", () => {
  const signers = buildSignerLoad([
    { generatedOn: "2026-08-01", signedByName: "CA Meera", status: "active" },
    { generatedOn: "2026-08-02", signedByName: "CA Meera", status: "revoked" },
    { generatedOn: "2026-08-03", signedByName: "CA Meera", status: "active" },
    { generatedOn: "2026-08-04", signedByName: "CA Dev", status: "active" },
  ]);
  assert.deepEqual(signers.map((signer) => signer.name), ["CA Meera", "CA Dev"]);
  assert.equal(signers[0]!.total, 3);
  assert.equal(signers[0]!.revocationRate, 33.3);
  assert.equal(signers[1]!.revocationRate, 0);
});

test("the UDIN trend always spans the requested months, including empty ones", () => {
  const trend = buildUdinTrend([{ generatedOn: "2026-08-03", signedByName: "CA Dev", status: "active" }], TODAY, 3);
  assert.deepEqual(trend.map((month) => month.month), ["2026-06", "2026-07", "2026-08"]);
  assert.deepEqual(trend.map((month) => month.active), [0, 0, 1]);
});

/* ---- CSV export ---- */

test("a CSV cell quotes separators and doubles embedded quotes", () => {
  const body = toCsv(["a", "b"], [["Koshi, Infra", 'He said "no"']]);
  assert.match(body, /"Koshi, Infra","He said ""no"""/);
});

test("a leading formula character is neutralised before a spreadsheet reads it", () => {
  // Counterparty names and remarks are free text a client can influence.
  const body = certificatesCsv([dscRow({ holderName: "=cmd|calc" })]);
  assert.match(body, /"'=cmd\|calc"/);
});

test("the notice export carries the fields the page never showed", () => {
  const body = noticesCsv([noticeRow({ respondedOn: "2026-08-20", responseSummary: "Filed reply online", status: "responded" })]);
  assert.match(body, /Response summary/);
  assert.match(body, /Filed reply online/);
});
