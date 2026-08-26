import assert from "node:assert/strict";
import test from "node:test";

import { validateWorkFields, workServiceEntitlementCode } from "../lib/work/validation";

const validFields = {
  assigneeId: "20000000-0000-4000-8000-000000000002",
  blockerNote: "Invoices awaited from client",
  internalDueDate: "2026-08-18",
  legalEntityId: "40000000-0000-4000-8000-000000000001",
  periodKey: "August 2026",
  progress: "45",
  reviewerId: "20000000-0000-4000-8000-000000000003",
  serviceKey: "gstr_3b",
  statutoryDueDate: "2026-08-20",
  status: "waiting",
};

test("work validation produces a normalized open workflow model", () => {
  const result = validateWorkFields(validFields);
  assert.equal(result.success, true);
  if (!result.success) return;
  assert.equal(result.data.progress, 45);
  assert.equal(result.data.status, "waiting");
});

test("waiting is no longer justified by a sentence in the form", () => {
  // The note used to be the whole record of what was awaited. Whether work may
  // sit in Waiting now depends on the dependencies recorded against it, which a
  // form cannot see, so the repository refuses it instead.
  const result = validateWorkFields({ ...validFields, blockerNote: "" });
  assert.equal(result.success, true);
  if (!result.success) return;
  assert.equal(result.data.status, "waiting");
});

test("work validation enforces deadline order and separation of duties", () => {
  const result = validateWorkFields({
    ...validFields,
    internalDueDate: "2026-08-21",
    reviewerId: validFields.assigneeId,
  });
  assert.equal(result.success, false);
  if (result.success) return;
  assert.match(result.fieldErrors.internalDueDate ?? "", /cannot be after/);
  assert.match(result.fieldErrors.reviewerId ?? "", /different from the assignee/);
});

test("open workflows cannot claim completed progress", () => {
  const result = validateWorkFields({ ...validFields, progress: "100", status: "review" });
  assert.equal(result.success, false);
  if (result.success) return;
  assert.match(result.fieldErrors.progress ?? "", /between 0 and 99/);
});

test("work services map to client package entitlements and reject out-of-scope creation", () => {
  assert.equal(workServiceEntitlementCode("gstr_3b"), "GST");
  assert.equal(workServiceEntitlementCode("monthly_close"), "BOOKS");
  assert.equal(validateWorkFields(validFields, ["gstr_3b"]).success, true);
  const rejected = validateWorkFields(validFields, ["tds_26q"]);
  assert.equal(rejected.success, false);
  if (!rejected.success) assert.match(rejected.fieldErrors.serviceKey ?? "", /client's active package/);
});

test("work validation accepts current service-master codes", () => {
  const result = validateWorkFields({ ...validFields, serviceKey: "VIRTUAL_CFO" }, ["VIRTUAL_CFO"]);
  assert.equal(result.success, true);
  assert.equal(workServiceEntitlementCode("VIRTUAL_CFO"), "VIRTUAL_CFO");
});

test("work budget is null when the field is left blank", () => {
  const result = validateWorkFields({ ...validFields, budgetMinutes: "" });
  assert.equal(result.success, true);
  assert.equal(result.success && result.data.budgetMinutes, null);
});

test("work budget accepts a whole number of minutes", () => {
  const result = validateWorkFields({ ...validFields, budgetMinutes: "90" });
  assert.equal(result.success && result.data.budgetMinutes, 90);
});

test("work budget rejects zero and non-integers", () => {
  for (const value of ["0", "-1", "12.5", "100001"]) {
    const result = validateWorkFields({ ...validFields, budgetMinutes: value });
    assert.equal(result.success, false, `expected ${value} to be rejected`);
  }
});
