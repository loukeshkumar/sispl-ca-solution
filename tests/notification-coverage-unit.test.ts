import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { buildDeadlineNotificationDrafts, type NotificationType } from "../lib/notifications/repository";

/**
 * A notification type that nothing emits is a promise the software does not
 * keep: the constraint says the firm sends it, and nobody ever receives one.
 * Two of these sat unnoticed because nothing could see them — the declaration
 * and the emission lived in different files and neither knew about the other.
 */

const DEADLINE_TYPES: NotificationType[] = [
  "work_item_due",
  "work_item_overdue",
  "document_request_overdue",
  "invoice_overdue",
  "dsc_expiring",
  "notice_due",
  "work_dependency_overdue",
];

/** Raised at the moment the thing happens, in the module that owns the event. */
const INLINE_TYPES: Record<string, NotificationType[]> = {
  "lib/attendance/repository.ts": ["attendance_request_raised", "attendance_request_decided"],
  "lib/dependencies/repository.ts": ["work_dependency_cleared"],
  "lib/escalation/repository.ts": ["work_item_escalated"],
  "lib/payroll/repository.ts": ["payslip_published"],
  "lib/tasks/repository.ts": ["task_assigned"],
};

const ALL_TYPES = [...DEADLINE_TYPES, ...Object.values(INLINE_TYPES).flat()];

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("the schema and the type union list exactly the same notification types", async () => {
  const schema = await read("db/schema.ts");
  const constraint = /notifications_type_check[^`]*`[^`]*in \(([^)]*)\)/.exec(schema);
  assert.ok(constraint, "the check constraint must be findable");
  const declared = [...constraint[1]!.matchAll(/'([a-z_]+)'/g)].map((match) => match[1]!);
  assert.deepEqual([...declared].sort(), [...ALL_TYPES].sort(), "the database and this test must agree on the list");
});

test("the deadline scan raises every type it is responsible for", () => {
  const drafts = buildDeadlineNotificationDrafts({
    workItems: [
      { id: "11111111-1111-4111-8111-111111111111", assigneeId: "a", entityName: "Aarav Retail", serviceKey: "gstr_3b", periodKey: "July 2026", statutoryDueDate: "2026-08-26" },
      { id: "22222222-2222-4222-8222-222222222222", assigneeId: "a", entityName: "Koshi Infra", serviceKey: "gstr_1", periodKey: "June 2026", statutoryDueDate: "2026-08-01" },
    ],
    documentRequests: [
      { id: "33333333-3333-4333-8333-333333333333", requestedByUserId: "b", entityName: "Neelam Foods", title: "Bank statements", dueDate: "2026-08-01" },
    ],
    invoices: [
      { id: "44444444-4444-4444-8444-444444444444", createdByUserId: "c", entityName: "Saanvi Exports", invoiceNumber: "INV-1", dueDate: "2026-08-01" },
    ],
    registerAlerts: [
      { id: "55555555-5555-4555-8555-555555555555", kind: "dsc_expiring", label: "SN-1", dueDate: "2026-09-01", recipientUserId: "d" },
      { id: "66666666-6666-4666-8666-666666666666", kind: "notice_due", label: "ITBA/1", dueDate: "2026-08-01", recipientUserId: "d" },
    ],
    dependencies: [
      { assigneeId: "a", clientName: "Aarav Retail", expectedOn: "2026-08-01", id: "77777777-7777-4777-8777-777777777777", periodKey: "July 2026", serviceKey: "gstr_3b", title: "Bank statement", workItemId: "11111111-1111-4111-8111-111111111111" },
    ],
    todayKey: "2026-08-25",
  });

  const raised = new Set(drafts.map((draft) => draft.type));
  for (const type of DEADLINE_TYPES) {
    assert.ok(raised.has(type), `${type} is declared but the deadline scan never raises it`);
  }
});

test("every deadline draft carries a dedupe key, so a nightly re-run cannot resend", () => {
  const drafts = buildDeadlineNotificationDrafts({
    workItems: [{ id: "11111111-1111-4111-8111-111111111111", assigneeId: "a", entityName: "Aarav Retail", serviceKey: "gstr_3b", periodKey: "July 2026", statutoryDueDate: "2026-08-01" }],
    documentRequests: [],
    todayKey: "2026-08-25",
  });
  assert.ok(drafts.length > 0);
  for (const draft of drafts) {
    assert.ok(draft.dedupeKey, `${draft.type} must be deduped; the scan runs every night against the same data`);
  }
});

test("every inline notification type is actually raised in the module that owns its event", async () => {
  // The finding this test exists for: `payslip_published` and
  // `attendance_request_decided` were declared and emitted by nothing, so an
  // employee learned of a decision or a payslip by logging in and looking.
  for (const [path, types] of Object.entries(INLINE_TYPES)) {
    const source = await read(path);
    for (const type of types) {
      assert.match(source, new RegExp(`type: "${type}"`), `${type} is declared but never raised in ${path}`);
    }
  }
});

test("a decision on a request always tells the person who raised it", async () => {
  const source = await read("lib/attendance/repository.ts");
  // Both decision paths, not only the leave one.
  assert.equal(
    [...source.matchAll(/type: "attendance_request_decided"/g)].length, 2,
    "leave and correction decisions must each notify",
  );
  assert.match(source, /recipientUserId: request\.employeeUserId/, "addressed to whoever raised it");
});

test("a raised request always reaches somebody who can decide it", async () => {
  const source = await read("lib/attendance/repository.ts");
  assert.equal(
    [...source.matchAll(/type: "attendance_request_raised" as const/g)].length, 2,
    "leave and correction requests must each notify a reviewer",
  );
  // A request from somebody with no manager still has to reach someone, or it
  // sits unseen — which is the situation this whole change is about.
  assert.match(source, /firm_administrator", "partner"/, "falls back to tenant-wide reviewers");
});

test("publishing payslips notifies every employee in the run, once each", async () => {
  const source = await read("lib/payroll/repository.ts");
  assert.match(source, /type: "payslip_published" as const/);
  assert.match(
    source,
    /dedupeKey: `payslip_published:\$\{runId\}:\$\{entry\.employeeUserId\}`/,
    "keyed per run and employee, so a republish cannot send a second copy",
  );
});
