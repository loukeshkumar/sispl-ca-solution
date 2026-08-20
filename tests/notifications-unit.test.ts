import assert from "node:assert/strict";
import test from "node:test";

import { addDaysToDateKey, buildDeadlineNotificationDrafts } from "../lib/notifications/repository";

const TODAY = "2026-08-17";

const workItem = (overrides: Partial<Parameters<typeof buildDeadlineNotificationDrafts>[0]["workItems"][number]> = {}) => ({
  id: "11111111-1111-4111-8111-111111111111",
  serviceKey: "gst_filings",
  periodKey: "2026-07",
  statutoryDueDate: "2026-08-20",
  entityName: "Aurora Textiles Private Limited",
  assigneeId: "22222222-2222-4222-8222-222222222222",
  ...overrides,
});

const documentRequest = (overrides: Partial<Parameters<typeof buildDeadlineNotificationDrafts>[0]["documentRequests"][number]> = {}) => ({
  id: "33333333-3333-4333-8333-333333333333",
  title: "July purchase register",
  dueDate: "2026-08-10",
  entityName: "Aurora Textiles Private Limited",
  requestedByUserId: "44444444-4444-4444-8444-444444444444",
  ...overrides,
});

test("date key arithmetic crosses month and year boundaries", () => {
  assert.equal(addDaysToDateKey("2026-08-30", 3), "2026-09-02");
  assert.equal(addDaysToDateKey("2026-12-31", 1), "2027-01-01");
  assert.equal(addDaysToDateKey("2026-03-01", -1), "2026-02-28");
});

test("work items due within the three-day window produce due notifications with stable dedupe keys", () => {
  const drafts = buildDeadlineNotificationDrafts({ workItems: [workItem()], documentRequests: [], todayKey: TODAY });
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].type, "work_item_due");
  assert.equal(drafts[0].recipientUserId, "22222222-2222-4222-8222-222222222222");
  assert.equal(drafts[0].resourceType, "work_item");
  assert.equal(drafts[0].dedupeKey, "work_item_due:11111111-1111-4111-8111-111111111111:2026-08-20");
  assert.match(drafts[0].title, /GST FILINGS/);
  assert.match(drafts[0].title, /Aurora Textiles/);
});

test("work items past their statutory due date produce overdue notifications", () => {
  const drafts = buildDeadlineNotificationDrafts({ workItems: [workItem({ statutoryDueDate: "2026-08-15" })], documentRequests: [], todayKey: TODAY });
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].type, "work_item_overdue");
  assert.equal(drafts[0].dedupeKey, "work_item_overdue:11111111-1111-4111-8111-111111111111:2026-08-15");
});

test("work items due beyond the window or without an assignee are skipped", () => {
  const drafts = buildDeadlineNotificationDrafts({
    workItems: [
      workItem({ statutoryDueDate: "2026-08-21" }),
      workItem({ id: "55555555-5555-4555-8555-555555555555", assigneeId: null }),
    ],
    documentRequests: [],
    todayKey: TODAY,
  });
  assert.equal(drafts.length, 0);
});

test("a work item due exactly today is a due notification, not overdue", () => {
  const drafts = buildDeadlineNotificationDrafts({ workItems: [workItem({ statutoryDueDate: TODAY })], documentRequests: [], todayKey: TODAY });
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].type, "work_item_due");
});

test("issued invoices past their due date notify their creator once per due date", () => {
  const invoice = {
    id: "77777777-7777-4777-8777-777777777777",
    invoiceNumber: "INV-00042",
    dueDate: "2026-08-10",
    entityName: "Aurora Textiles Private Limited",
    createdByUserId: "88888888-8888-4888-8888-888888888888",
  };
  const drafts = buildDeadlineNotificationDrafts({
    workItems: [],
    documentRequests: [],
    invoices: [invoice, { ...invoice, id: "99999999-9999-4999-8999-999999999999", dueDate: TODAY }],
    todayKey: TODAY,
  });
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].type, "invoice_overdue");
  assert.equal(drafts[0].resourceType, "invoice");
  assert.equal(drafts[0].recipientUserId, invoice.createdByUserId);
  assert.equal(drafts[0].dedupeKey, "invoice_overdue:77777777-7777-4777-8777-777777777777:2026-08-10");
});

test("document requests are notified only after the due date passes and target the requester", () => {
  const drafts = buildDeadlineNotificationDrafts({
    workItems: [],
    documentRequests: [documentRequest(), documentRequest({ id: "66666666-6666-4666-8666-666666666666", dueDate: TODAY })],
    todayKey: TODAY,
  });
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].type, "document_request_overdue");
  assert.equal(drafts[0].recipientUserId, "44444444-4444-4444-8444-444444444444");
  assert.equal(drafts[0].resourceType, "document_request");
  assert.equal(drafts[0].dedupeKey, "document_request_overdue:33333333-3333-4333-8333-333333333333:2026-08-10");
});
