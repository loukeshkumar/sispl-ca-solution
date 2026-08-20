import assert from "node:assert/strict";
import test from "node:test";

import { checklistDueDate, validateDocumentChecklistFields } from "../lib/master-data/validation";

const base = {
  code: "bank_stmt",
  name: "  Bank   statement ",
  category: "Accounting",
  instructions: "All accounts for the period.",
  serviceCode: "books",
  defaultLeadDays: "7",
  mandatory: "on",
  status: "active",
};

test("checklist validation normalises the code, name, and service reference", () => {
  const result = validateDocumentChecklistFields(base);
  assert.ok(result.success);
  assert.equal(result.data.code, "BANK_STMT");
  assert.equal(result.data.name, "Bank statement");
  assert.equal(result.data.serviceCode, "BOOKS");
  assert.equal(result.data.mandatory, true);
  assert.equal(result.data.defaultLeadDays, 7);
});

test("a code typed with spaces becomes a usable underscore code", () => {
  const result = validateDocumentChecklistFields({ ...base, code: "board resolution" });
  assert.ok(result.success);
  assert.equal(result.data.code, "BOARD_RESOLUTION");
});

test("category and lead days fall back to sensible defaults rather than failing", () => {
  const result = validateDocumentChecklistFields({ ...base, category: "", defaultLeadDays: "" });
  assert.ok(result.success);
  assert.equal(result.data.category, "General");
  assert.equal(result.data.defaultLeadDays, 7);
});

test("an unlinked checklist item is allowed and applies to any service", () => {
  const result = validateDocumentChecklistFields({ ...base, serviceCode: "" });
  assert.ok(result.success);
  assert.equal(result.data.serviceCode, "");
});

test("the mandatory flag is off unless the checkbox was actually ticked", () => {
  const unticked = validateDocumentChecklistFields({ ...base, mandatory: "" });
  assert.ok(unticked.success);
  assert.equal(unticked.data.mandatory, false);
});

test("checklist validation rejects unusable codes, names, lead days, and statuses", () => {
  assert.ok(!validateDocumentChecklistFields({ ...base, code: "X" }).success);
  assert.ok(!validateDocumentChecklistFields({ ...base, code: "bad code!" }).success);
  assert.ok(!validateDocumentChecklistFields({ ...base, name: "A" }).success);
  assert.ok(!validateDocumentChecklistFields({ ...base, defaultLeadDays: "181" }).success);
  assert.ok(!validateDocumentChecklistFields({ ...base, defaultLeadDays: "-1" }).success);
  assert.ok(!validateDocumentChecklistFields({ ...base, serviceCode: "not a service" }).success);
  assert.ok(!validateDocumentChecklistFields({ ...base, status: "deleted" }).success);
  assert.ok(!validateDocumentChecklistFields({ ...base, instructions: "x".repeat(501) }).success);
  assert.ok(validateDocumentChecklistFields({ ...base, defaultLeadDays: "0" }).success);
  assert.ok(validateDocumentChecklistFields({ ...base, status: "archived" }).success);
});

test("the suggested due date is the lead time ahead of today, across month ends", () => {
  assert.equal(checklistDueDate("2026-08-17", 7), "2026-08-24");
  assert.equal(checklistDueDate("2026-08-28", 7), "2026-09-04");
  assert.equal(checklistDueDate("2026-12-28", 7), "2027-01-04");
  assert.equal(checklistDueDate("2026-08-17", 0), "2026-08-17");
});
