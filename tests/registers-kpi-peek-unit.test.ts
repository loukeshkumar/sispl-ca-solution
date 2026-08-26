import assert from "node:assert/strict";
import test from "node:test";

import { buildAttentionQueue } from "../lib/registers/attention";
import { buildPeek, isPeekKind, PEEK_DEFINITIONS, PEEK_ROW_LIMIT } from "../lib/registers/kpi-peek";
import type { DscRow, NoticeRow, UdinRow } from "../lib/registers/repository";

const TODAY = "2026-08-21";

const notice = (over: Partial<NoticeRow> = {}): NoticeRow => ({
  assigneeId: "u1",
  assigneeName: "Rahul K.",
  authority: "income_tax",
  clientName: "Koshi Infra LLP",
  id: "n1",
  legalEntityId: "c1",
  noticeDate: "2026-08-01",
  noticeNumber: "ITBA/2026/1",
  noticeSection: "143(2)",
  receivedDate: "2026-08-02",
  respondedOn: null,
  responseDueDate: "2026-08-30",
  responseSummary: "",
  status: "open",
  subject: "Scrutiny",
  ...over,
});

const certificate = (over: Partial<DscRow> = {}): DscRow => ({
  certificateClass: "class_3",
  clientName: "Aarav Retail Pvt. Ltd.",
  custodianName: "A. Sharma",
  custodianUserId: "u1",
  holderName: "A. Sharma",
  id: "d1",
  issuedOutSince: null,
  issuingAuthority: "eMudhra",
  legalEntityId: "c1",
  notes: "",
  serialNumber: "SN-1",
  status: "in_custody",
  storageLocation: "Cabinet A",
  validFrom: "2025-01-01",
  validUntil: "2026-09-10",
  ...over,
});

const udin = (over: Partial<UdinRow> = {}): UdinRow => ({
  clientName: "Koshi Infra LLP",
  documentDescription: "FY26 tax audit",
  documentType: "tax_audit",
  generatedOn: "2026-08-01",
  id: "u1",
  legalEntityId: "c1",
  membershipNumber: "123456",
  revocationReason: "",
  signedByName: "CA S. Rao",
  status: "active",
  udin: "26123456ABCDEF1234",
  ...over,
});

test("the open-notices list counts exactly what the figure above it counts", () => {
  // The metric is `open` plus `in_progress`; a list built on `open` alone would
  // contradict the number that opened it.
  const rows = [
    notice({ id: "a", status: "open" }),
    notice({ id: "b", status: "in_progress" }),
    notice({ id: "c", status: "responded" }),
    notice({ id: "d", status: "closed" }),
  ];
  const peek = buildPeek("notices", { notices: rows }, TODAY);
  assert.equal(peek.total, 2);
  assert.deepEqual(peek.rows.map((row) => row.id), ["a", "b"]);
});

test("outstanding notices lead with the soonest response date and flag the overdue", () => {
  const peek = buildPeek("notices", {
    notices: [
      notice({ id: "later", responseDueDate: "2026-09-30" }),
      notice({ id: "overdue", responseDueDate: "2026-08-10" }),
      notice({ id: "week", responseDueDate: "2026-08-25" }),
    ],
  }, TODAY);
  assert.deepEqual(peek.rows.map((row) => row.id), ["overdue", "week", "later"]);
  assert.equal(peek.rows[0].tone, "red");
  assert.equal(peek.rows[2].tone, "blue");
});

test("an unassigned notice says so rather than leaving the owner blank", () => {
  const peek = buildPeek("notices", { notices: [notice({ assigneeId: null, assigneeName: null })] }, TODAY);
  assert.match(peek.rows[0].note, /Unassigned/);
});

test("every peek row links straight at the entry, not at its register", () => {
  const peek = buildPeek("notices", { notices: [notice({ id: "n9" })] }, TODAY);
  assert.equal(peek.rows[0].href, "/?workspace=registers&tab=notices&focus=n9");
});

test("the DSC list is the live certificates lapsing within thirty days, and no others", () => {
  const peek = buildPeek("dsc", {
    certificates: [
      certificate({ id: "lapsed", validUntil: "2026-08-01" }),
      certificate({ id: "imminent", validUntil: "2026-08-25" }),
      certificate({ id: "soon", validUntil: "2026-09-15" }),
      certificate({ id: "later", validUntil: "2026-12-01" }),
      certificate({ id: "surrendered", status: "surrendered", validUntil: "2026-09-01" }),
    ],
  }, TODAY);
  // Already lapsed is a different figure; surrendered is not a live certificate.
  assert.deepEqual(peek.rows.map((row) => row.id), ["imminent", "soon"]);
  assert.equal(peek.rows[0].tone, "red");
  assert.equal(peek.rows[1].tone, "amber");
});

test("a certificate still signed out says so in the list", () => {
  const peek = buildPeek("dsc", {
    certificates: [certificate({ id: "out", issuedOutSince: "2026-08-01", status: "issued_out", validUntil: "2026-09-01" })],
  }, TODAY);
  assert.match(peek.rows[0].note, /signed out/);
});

test("the UDIN list is active registrations, most recent first", () => {
  const peek = buildPeek("udin", {
    udins: [
      udin({ generatedOn: "2026-07-01", id: "old" }),
      udin({ generatedOn: "2026-08-15", id: "new" }),
      udin({ id: "revoked", status: "revoked" }),
    ],
  }, TODAY);
  assert.deepEqual(peek.rows.map((row) => row.id), ["new", "old"]);
});

test("the action queue peek carries the queue's own reason and destination", () => {
  const queue = buildAttentionQueue({
    certificates: [],
    notices: [{ assigneeName: null, clientName: "Koshi Infra LLP", id: "n1", responseDueDate: "2026-08-10", status: "open", subject: "Scrutiny" }],
    todayKey: TODAY,
  });
  const peek = buildPeek("attention", { attention: queue }, TODAY);
  assert.equal(peek.total, queue.length);
  assert.equal(peek.rows[0].href, queue[0].href);
  assert.ok(peek.rows[0].note.length > 0, "the risk must be named, not left to the colour");
});

test("a list longer than the panel reports its true size rather than its prefix", () => {
  const rows = Array.from({ length: PEEK_ROW_LIMIT + 12 }, (_unused, index) => notice({
    id: `n${index}`,
    responseDueDate: "2026-08-30",
  }));
  const peek = buildPeek("notices", { notices: rows }, TODAY);
  assert.equal(peek.rows.length, PEEK_ROW_LIMIT);
  assert.equal(peek.total, PEEK_ROW_LIMIT + 12);
});

test("a peek with nothing behind it is empty, not a crash", () => {
  for (const kind of ["attention", "notices", "dsc", "udin"] as const) {
    assert.deepEqual(buildPeek(kind, {}, TODAY), { rows: [], total: 0 });
  }
});

test("only the four register figures name a peek", () => {
  assert.ok(isPeekKind("notices"));
  assert.ok(!isPeekKind("insights"));
  for (const kind of ["attention", "notices", "dsc", "udin"] as const) {
    assert.ok(PEEK_DEFINITIONS[kind].title.length > 0);
    assert.ok(PEEK_DEFINITIONS[kind].emptyNote.length > 0);
  }
});
