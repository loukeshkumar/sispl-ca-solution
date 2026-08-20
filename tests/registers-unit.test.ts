import assert from "node:assert/strict";
import test from "node:test";

import { validateDscFields, validateNoticeFields, validateUdinFields } from "../lib/registers/validation";
import { addDaysToDateKey } from "../lib/registers/repository";
import { buildDeadlineNotificationDrafts } from "../lib/notifications/repository";

const ENTITY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MEMBER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TODAY = "2026-08-17";

const udinFields = {
  legalEntityId: ENTITY, udin: "26123456abcdef7890", documentType: "tax_audit",
  documentDescription: "Form 3CB-3CD for FY 2025-26", membershipNumber: "123456",
  signedByUserId: MEMBER, generatedOn: "2026-08-15",
};

const dscFields = {
  legalEntityId: ENTITY, holderName: "  Asha   Menon ", serialNumber: "EMU-2026-0099",
  issuingAuthority: "eMudhra", certificateClass: "class_3", validFrom: "2026-01-01",
  validUntil: "2027-12-31", custodianUserId: MEMBER, storageLocation: "Cabinet 2", notes: "",
};

const noticeFields = {
  legalEntityId: ENTITY, authority: "income_tax", noticeNumber: "ITBA/AST/2026/0042",
  noticeSection: "143(1)", subject: "Proposed adjustment to returned income",
  noticeDate: "2026-08-01", receivedDate: "2026-08-05", responseDueDate: "2026-08-25", assigneeId: MEMBER,
};

test("UDIN validation accepts the 18-character ICAI format and normalises case", () => {
  const result = validateUdinFields(udinFields);
  assert.ok(result.success);
  assert.equal(result.data.udin, "26123456ABCDEF7890");
  assert.equal(result.data.workItemId, null);
});

test("UDIN validation rejects malformed UDINs and membership numbers", () => {
  assert.ok(!validateUdinFields({ ...udinFields, udin: "TOO-SHORT" }).success);
  assert.ok(!validateUdinFields({ ...udinFields, udin: "2612345_abcdef7890" }).success);
  const badMembership = validateUdinFields({ ...udinFields, membershipNumber: "12A456" });
  assert.ok(!badMembership.success);
  assert.ok(badMembership.fieldErrors.membershipNumber);
});

test("DSC validation normalises the holder name and enforces validity order", () => {
  const result = validateDscFields(dscFields);
  assert.ok(result.success);
  assert.equal(result.data.holderName, "Asha Menon");

  const reversed = validateDscFields({ ...dscFields, validUntil: "2025-01-01" });
  assert.ok(!reversed.success);
  assert.ok(reversed.fieldErrors.validUntil);
});

test("DSC validation refuses to store credentials alongside custody details", () => {
  for (const notes of ["Token PIN is 1234", "password: hunter2", "keeps the private key here"]) {
    const result = validateDscFields({ ...dscFields, notes });
    assert.ok(!result.success, `notes "${notes}" must be rejected`);
    assert.match(result.fieldErrors.notes ?? "", /Never record DSC PINs/);
  }
  assert.ok(!validateDscFields({ ...dscFields, storageLocation: "drawer, OTP card inside" }).success);
});

test("notice validation enforces issue, receipt, and response date order", () => {
  assert.ok(validateNoticeFields(noticeFields).success);
  const receivedEarly = validateNoticeFields({ ...noticeFields, receivedDate: "2026-07-30" });
  assert.ok(!receivedEarly.success);
  assert.ok(receivedEarly.fieldErrors.receivedDate);
  const dueEarly = validateNoticeFields({ ...noticeFields, responseDueDate: "2026-08-02" });
  assert.ok(!dueEarly.success);
  assert.ok(dueEarly.fieldErrors.responseDueDate);
});

test("register alerts become deduped expiry and response notifications", () => {
  const drafts = buildDeadlineNotificationDrafts({
    workItems: [],
    documentRequests: [],
    registerAlerts: [
      { id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", label: "DSC EMU-2026-0099 for Asha Menon", dueDate: "2026-09-01", recipientUserId: MEMBER, kind: "dsc_expiring" },
      { id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", label: "Notice ITBA/AST/2026/0042", dueDate: "2026-08-10", recipientUserId: MEMBER, kind: "notice_due" },
    ],
    todayKey: TODAY,
  });
  assert.equal(drafts.length, 2);
  assert.equal(drafts[0].type, "dsc_expiring");
  assert.equal(drafts[0].resourceType, "dsc_certificate");
  assert.match(drafts[0].title, /expires on 2026-09-01/);
  assert.equal(drafts[1].type, "notice_due");
  assert.equal(drafts[1].resourceType, "statutory_notice");
  assert.match(drafts[1].title, /response is overdue/);
  assert.equal(drafts[1].dedupeKey, "notice_due:dddddddd-dddd-4ddd-8ddd-dddddddddddd:2026-08-10");
});

test("register date arithmetic crosses month boundaries", () => {
  assert.equal(addDaysToDateKey("2026-08-17", 30), "2026-09-16");
  assert.equal(addDaysToDateKey("2026-12-20", 30), "2027-01-19");
});
